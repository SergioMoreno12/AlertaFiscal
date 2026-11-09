import re
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

# Simple in-memory limiter: valid for 1 process. In production with several
# replicas it must move to a shared store (documented in docs/erp/security.md).
_attempts: dict[str, list[float]] = {}


def _rate_limited(key: str, limit: int | None = None) -> bool:
    window = current_app.config["LOGIN_WINDOW_MINUTES"] * 60
    now = time.time()
    hits = [t for t in _attempts.get(key, []) if now - t < window]
    _attempts[key] = hits
    return len(hits) >= (limit or current_app.config["LOGIN_MAX_ATTEMPTS"])


def _register_attempt(key: str) -> None:
    _attempts.setdefault(key, []).append(time.time())
    if len(_attempts) > 10000:  # keep the in-memory limiter bounded
        window = current_app.config["LOGIN_WINDOW_MINUTES"] * 60
        now = time.time()
        for stale in [k for k, hits in _attempts.items() if not hits or now - hits[-1] >= window]:
            _attempts.pop(stale, None)


_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("not-a-real-password-" + str(time.time()))
    return _DUMMY_HASH


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
        return error("invalid_credentials", "Invalid credentials", 401)

    key = f"{request.remote_addr}:{email}"
    if _rate_limited(key):
        return error("too_many_attempts", "Too many attempts. Try again later.", 429)

    user = db.session.query(User).filter_by(email=email).first()
    # Verify against a dummy hash when the user does not exist, so the response time
    # does not reveal which emails are registered.
    stored_hash = user.password_hash if user is not None else _dummy_hash()
    password_ok = verify_password(stored_hash, password)
    if user is None or not user.is_active or not password_ok:
        _register_attempt(key)
        current_app.logger.info("login_failed email_domain=%s", email.split("@")[-1])
        return error("invalid_credentials", "Invalid credentials", 401)

    # Rotation: any previous session of this cookie is revoked.
    old_token = request.cookies.get(current_app.config["SESSION_COOKIE_NAME"])
    if old_token:
        from ...security import _hash_token

        previous = db.session.query(Session).filter_by(token_hash=_hash_token(old_token)).first()
        if previous and previous.revoked_at is None:
            previous.revoked_at = datetime.now(timezone.utc)

    return _start_session(user, "auth.login")


def _start_session(user: User, action: str, status: int = 200):
    """Open a session for ``user`` and return the response with both cookies set."""
    session, token, csrf_token = create_session(user)
    memberships = (
        db.session.query(CompanyMembership)
        .filter_by(user_id=user.id, is_active=True)
        .join(CompanyMembership.company)
        .all()
    )
    record_audit(None, action, f"user:{user.id}", {"session_id": session.id})

    response = jsonify({"user": _serialize_user(user, memberships), "csrf_token": csrf_token})
    response.status_code = status
    response.set_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        token,
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite=current_app.config["COOKIE_SAMESITE"],
        path="/",
    )
    return set_csrf_cookie(response, csrf_token)


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 10


@auth_bp.post("/register")
def register():
    """Public sign-up: creates the user and, when given, a first company with the user as admin."""
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    full_name = str(data.get("full_name", "")).strip()
    password = str(data.get("password", ""))

    key = f"register:{request.remote_addr}"
    if _rate_limited(key, current_app.config["REGISTER_MAX_ATTEMPTS"]):
        return error("too_many_attempts", "Too many attempts. Try again later.", 429)

    problems = {}
    if not EMAIL_RE.match(email) or len(email) > 255:
        problems["email"] = "Enter a valid email"
    if len(full_name) < 3 or len(full_name) > 160:
        problems["full_name"] = "The name must have between 3 and 160 characters"
    if len(password) < MIN_PASSWORD or len(password) > 200:
        problems["password"] = "The password must have at least 10 characters"
    if problems:
        return error("invalid_payload", next(iter(problems.values())), 422, problems)

    _register_attempt(key)
    if db.session.query(User).filter_by(email=email).first() is not None:
        return error("email_taken", "An account with that email already exists. Sign in instead.", 409)

    user = User(email=email, full_name=full_name, password_hash=hash_password(password))
    db.session.add(user)
    db.session.flush()

    company_data = data.get("company")
    if isinstance(company_data, dict) and company_data:
        from ..companies.routes import create_company_for

        result = create_company_for(user, company_data)
        if isinstance(result, tuple):  # an error response
            g.force_rollback = True
            return result

    return _start_session(user, "auth.register", 201)


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
        return error("unauthorized", "Session required", 401)
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
        return error("unauthorized", "Session required", 401)
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
        return error("unauthorized", "Session required", 401)
    target = db.session.get(Session, session_id)
    if target is None or target.user_id != user.id:
        return error("not_found", "Session not found", 404)
    target.revoked_at = datetime.now(timezone.utc)
    record_audit(None, "auth.session_revoked", f"session:{session_id}")
    return jsonify({"status": "revoked"})


@auth_bp.post("/password-reset/request")
def password_reset_request():
    """Generic request: it does not reveal whether the email exists.

    No email provider is configured; in development the token is written to
    the server log (never to the HTTP response).
    """
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    if email:
        user = db.session.query(User).filter_by(email=email).first()
        if user is not None:
            current_app.logger.info("password_reset_requested user_id=%s", user.id)
    return jsonify({"status": "ok", "message": "If the email exists, we sent instructions."})
