import json
import logging
import os
import uuid
from pathlib import Path
import click
from flask import Flask, g, jsonify, request
from werkzeug.middleware.proxy_fix import ProxyFix

# config.py loads backend/.env before its attributes are evaluated.
from .config import Config
from .extensions import db, migrate
from .security import resolve_session, validate_csrf


def _is_dev() -> bool:
    return os.environ.get("APP_ENV", "development").lower() not in ("production", "prod")


def create_app(config_class: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        app.logger.warning(
            "DB: explicit SQLite (DB_MODE=sqlite). Only for local demos and tests; "
            "normal mode and production require PostgreSQL (DATABASE_URL)."
        )
    else:
        app.logger.info(
            "DB: PostgreSQL (pool_size=%s, max_overflow=%s, schema=%s)",
            app.config.get("DB_POOL_SIZE"),
            app.config.get("DB_MAX_OVERFLOW"),
            app.config.get("DB_SCHEMA") or "public",
        )

    # Render passes the real IP in X-Forwarded-*; trust is limited to 1 hop.
    if not _is_dev() or os.environ.get("TRUST_PROXY", "false").lower() == "true":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    db.init_app(app)
    migrate.init_app(app, db)

    from .db_schema import configure_schema_selection

    with app.app_context():
        configure_schema_selection(db.engine, app.config.get("DB_SCHEMA"))

    from .common.health import health_bp
    from .modules.alerts.routes import alerts_bp
    from .modules.auth.routes import auth_bp
    from .modules.companies.routes import companies_bp
    from .modules.context.routes import context_bp
    from .modules.dashboard.routes import dashboard_bp
    from .modules.movements.routes import movements_bp
    from .modules.planning.routes import planning_bp
    from .modules.tracking.routes import tracking_bp

    for bp in (
        health_bp,
        auth_bp,
        companies_bp,
        dashboard_bp,
        movements_bp,
        planning_bp,
        tracking_bp,
        alerts_bp,
        context_bp,
    ):
        app.register_blueprint(bp)

    _register_hooks(app)
    _register_errors(app)
    _register_cli(app)

    return app


def _register_hooks(app: Flask) -> None:
    @app.before_request
    def _before():
        g.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]

        if request.method == "OPTIONS":
            return None

        resolve_session()

        mutating = request.method in ("POST", "PUT", "PATCH", "DELETE")
        if mutating and request.path.startswith("/api/"):
            if not validate_csrf():
                g.force_rollback = True
                return (
                    jsonify(
                        {
                            "error": {
                                "code": "csrf_failed",
                                "message": "Missing or invalid CSRF token",
                                "request_id": g.request_id,
                            }
                        }
                    ),
                    403,
                )
        return None

    @app.after_request
    def _after(response):
        origin = request.headers.get("Origin", "")
        allowed = app.config["ALLOWED_ORIGINS"]
        if origin and origin.rstrip("/") in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token, X-Request-ID"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Vary"] = "Origin"

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if app.config["COOKIE_SECURE"]:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        response.headers["X-Request-ID"] = getattr(g, "request_id", "")

        # Commit only if the operation succeeded.
        if response.status_code < 400:
            try:
                db.session.commit()
            except Exception:  # pragma: no cover
                db.session.rollback()
        else:
            db.session.rollback()

        return response

    @app.teardown_appcontext
    def _teardown(exc):
        db.session.remove()


def _register_errors(app: Flask) -> None:
    @app.errorhandler(404)
    def _404(_e):
        return jsonify({"error": {"code": "not_found", "message": "Recurso no encontrado"}}), 404

    @app.errorhandler(405)
    def _405(_e):
        return jsonify({"error": {"code": "method_not_allowed", "message": "Method not allowed"}}), 405

    @app.errorhandler(PermissionError)
    def _perm(_e):
        return jsonify({"error": {"code": "forbidden", "message": "Not authorized for this company"}}), 403

    @app.errorhandler(ValueError)
    def _value(e):
        return jsonify({"error": {"code": "invalid_payload", "message": str(e)}}), 422

    @app.errorhandler(Exception)
    def _unhandled(e):
        db.session.rollback()
        app.logger.exception("unhandled_error", extra={"request_id": getattr(g, "request_id", None)})
        return jsonify({"error": {"code": "server_error", "message": "Error interno"}}), 500


def _register_cli(app: Flask) -> None:
    @app.cli.command("seed-demo")
    @click.option(
        "--yes",
        is_flag=True,
        help="Confirm that demo data will be loaded (required unless SEED_CONFIRM=1).",
    )
    def seed_demo_command(yes: bool):
        """Load fictitious demo data (idempotent, never automatic)."""
        from .seed import seed_demo

        confirmed = yes or os.environ.get("SEED_CONFIRM", "").strip().lower() in ("1", "true", "yes")
        if not confirmed:
            raise click.ClickException(
                "Load cancelled. This command inserts fictitious data. "
                "Run 'flask seed-demo --yes' or set SEED_CONFIRM=1 to confirm."
            )
        summary = seed_demo()
        click.echo(summary)

    @app.cli.command("create-admin")
    def create_admin_command():
        """Create an administrator user without sample data."""
        import getpass

        from .models import Company, CompanyMembership, User
        from .security import hash_password

        email = input("Email: ").strip().lower()
        name = input("Full name: ").strip()
        password = getpass.getpass("Password (min. 10): ")
        if len(password) < 10:
            print("Password too short")
            return
        company_name = input("Company: ").strip() or "My company"
        nit = input("NIT: ").strip() or "000.000.000-0"

        user = db.session.query(User).filter_by(email=email).first()
        if user is None:
            user = User(email=email, full_name=name or email, password_hash=hash_password(password))
            db.session.add(user)
            db.session.flush()
        company = db.session.query(Company).filter_by(nit=nit).first()
        if company is None:
            company = Company(name=company_name, nit=nit)
            db.session.add(company)
            db.session.flush()
        if not db.session.query(CompanyMembership).filter_by(user_id=user.id, company_id=company.id).first():
            db.session.add(CompanyMembership(user_id=user.id, company_id=company.id, role="admin"))
        db.session.commit()
        print("Usuario administrador listo")

    @app.cli.command("context-load")
    @click.argument("manifest", type=click.Path(exists=True, dir_okay=False, path_type=Path))
    @click.option("--dry-run", is_flag=True, help="Validate the manifest without writing to the database.")
    @click.option("--replace", is_flag=True, help="Reload the aggregates of the version.")
    def context_load_command(manifest: Path, dry_run: bool, replace: bool):
        """Load an external context manifest (idempotent, no alerts)."""
        from .modules.context.loader import load_manifest_file

        result = load_manifest_file(manifest, dry_run=dry_run, replace=replace)
        click.echo(json.dumps(result, ensure_ascii=False, indent=2, default=str))
