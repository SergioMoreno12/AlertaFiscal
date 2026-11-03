from flask import Blueprint, current_app, jsonify
from sqlalchemy import text

from ..extensions import db

health_bp = Blueprint("health", __name__)


def _engine_label() -> str:
    if current_app.config.get("DB_IS_DEMO"):
        return "sqlite-dev"
    return current_app.config.get("DB_MODE", "postgresql")


def _payload(status: str) -> dict:
    # `demo` indica SQLite habilitado EXPLÍCITAMENTE para demo/pruebas locales.
    # No es un fallback automático: la app no cambia de motor por sí sola.
    # `database` siempre muestra el motor real en uso.
    return {
        "status": status,
        "database": _engine_label(),
        "demo": bool(current_app.config.get("DB_IS_DEMO")),
    }


@health_bp.route("/health/live", methods=["GET"])
def health_live():
    return jsonify({"status": "ok", "service": "alertafiscal-api"}), 200


@health_bp.route("/health/ready", methods=["GET"])
def health_ready():
    try:
        db.session.execute(text("SELECT 1"))
        return jsonify(_payload("ready")), 200
    except Exception as exc:
        # No incluir URL, usuario ni contraseña. Solo el tipo de error.
        current_app.logger.warning("db_not_ready error_type=%s", type(exc).__name__)
        return jsonify(_payload("not_ready")), 503
