import time
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request

from ...common.http import error, get_json, record_audit
from ...extensions import db
from ...models import CompanyMembership, Session, User
from ...security import (
    clear_session_cookie,
    create_session,
    hash_password,
    new_csrf_token,
    set_csrf_cookie,
    verify_password,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")

# Limitador simple en memoria: válido para 1 proceso. En producción con varias
# réplicas debe moverse a un almacén compartido (documentado en docs/security.md).
_attempts: dict[str, list[float]] = {}


def _rate_limited(key: str) -> bool:
    window = current_app.config["LOGIN_WINDOW_MINUTES"] * 60
    now = time.time()
    hits = [t for t in _attempts.get(key, []) if now - t < window]
    _attempts[key] = hits
    return len(hits) >= current_app.config["LOGIN_MAX_ATTEMPTS"]


def _register_attempt(key: str) -> None:
    _attempts.setdefault(key, []).append(time.time())


def _serialize_user(user: User, memberships) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "companies": [
            {
                "id": m.company.id,
                "name": m.company.name,
                "nit": m.company.nit,
                "role": m.role,
            }
            for m in memberships
        ],
    }


@auth_bp.get("/csrf")
def csrf():
    token = new_csrf_token()
    response = jsonify({"csrf_token": token})
    return set_csrf_cookie(response, token)


@auth_bp.post("/login")
def login():
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return error("invalid_credentials", "Credenciales inválidas", 401)

    key = f"{request.remote_addr}:{email}"
    if _rate_limited(key):
        return error("too_many_attempts", "Demasiados intentos. Intenta más tarde.", 429)

    user = db.session.query(User).filter_by(email=email).first()
    if user is None or not user.is_active or not verify_password(user.password_hash, password):
        _register_attempt(key)
        current_app.logger.info("login_failed email_domain=%s", email.split("@")[-1])
        return error("invalid_credentials", "Credenciales inválidas", 401)

    # Rotación: cualquier sesión previa de esta cookie se revoca.
    old_token = request.cookies.get(current_app.config["SESSION_COOKIE_NAME"])
    if old_token:
        from ...security import _hash_token

        previous = db.session.query(Session).filter_by(token_hash=_hash_token(old_token)).first()
        if previous and previous.revoked_at is None:
            previous.revoked_at = datetime.now(timezone.utc)

    session, token, csrf_token = create_session(user)
    memberships = (
        db.session.query(CompanyMembership)
        .filter_by(user_id=user.id, is_active=True)
        .join(CompanyMembership.company)
        .all()
    )
    record_audit(None, "auth.login", f"user:{user.id}", {"session_id": session.id})

    response = jsonify({"user": _serialize_user(user, memberships), "csrf_token": csrf_token})
    response.set_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        token,
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite=current_app.config["COOKIE_SAMESITE"],
        path="/",
    )
    return set_csrf_cookie(response, csrf_token)


@auth_bp.post("/logout")
def logout():
    session = getattr(g, "session_row", None)
    if session is not None:
        session.revoked_at = datetime.now(timezone.utc)
        record_audit(None, "auth.logout", f"session:{session.id}")
    response = jsonify({"status": "ok"})
    return clear_session_cookie(response)


@auth_bp.get("/me")
def me():
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Sesión requerida", 401)
    memberships = (
        db.session.query(CompanyMembership)
        .filter_by(user_id=user.id, is_active=True)
        .join(CompanyMembership.company)
        .all()
    )
    return jsonify({"user": _serialize_user(user, memberships)})


@auth_bp.get("/sessions")
def list_sessions():
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Sesión requerida", 401)
    current = getattr(g, "session_row", None)
    rows = (
        db.session.query(Session)
        .filter(Session.user_id == user.id, Session.revoked_at.is_(None))
        .order_by(Session.last_seen_at.desc())
        .all()
    )
    return jsonify(
        {
            "items": [
                {
                    "id": s.id,
                    "current": bool(current and s.id == current.id),
                    "ip_address": s.ip_address,
                    "user_agent": s.user_agent,
                    "last_seen_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
                    "expires_at": s.expires_at.isoformat() if s.expires_at else None,
                }
                for s in rows
            ]
        }
    )


@auth_bp.delete("/sessions/<int:session_id>")
def revoke_session(session_id: int):
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Sesión requerida", 401)
    target = db.session.get(Session, session_id)
    if target is None or target.user_id != user.id:
        return error("not_found", "Sesión no encontrada", 404)
    target.revoked_at = datetime.now(timezone.utc)
    record_audit(None, "auth.session_revoked", f"session:{session_id}")
    return jsonify({"status": "revoked"})


@auth_bp.post("/password-reset/request")
def password_reset_request():
    """Solicitud genérica: no revela si el correo existe.

    No hay proveedor de correo configurado; en desarrollo el token se registra
    en el log del servidor (nunca en la respuesta HTTP).
    """
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    if email:
        user = db.session.query(User).filter_by(email=email).first()
        if user is not None:
            current_app.logger.info("password_reset_requested user_id=%s", user.id)
    return jsonify({"status": "ok", "message": "Si el correo existe, enviamos instrucciones."})
