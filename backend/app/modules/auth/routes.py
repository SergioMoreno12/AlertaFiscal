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
    new_password_reset_token,
    user_for_reset_token,
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
    # A page reload loses the token kept in memory, and on a separate frontend domain
    # the page cannot read the cookie either. Bind the new token to the current session
    # so the next write is accepted instead of failing until the user logs in again.
    session = getattr(g, "session_row", None)
    if session is not None:
        from ...security import _hash_token

        session.csrf_hash = _hash_token(token)
        db.session.commit()
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


def _password_problem(password: str) -> str | None:
    if len(password) < MIN_PASSWORD or len(password) > 200:
        return "The password must have at least 10 characters"
    return None


def _revoke_sessions(user_id: int, keep_id: int | None = None) -> None:
    now = datetime.now(timezone.utc)
    query = db.session.query(Session).filter(Session.user_id == user_id, Session.revoked_at.is_(None))
    if keep_id is not None:
        query = query.filter(Session.id != keep_id)
    for row in query.all():
        row.revoked_at = now


@auth_bp.post("/password")
def change_password():
    """Change the password of the signed-in user. Every other session is closed."""
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Session required", 401)
    key = f"password:{user.id}"
    if _rate_limited(key):
        return error("too_many_attempts", "Too many attempts. Try again later.", 429)
    data = get_json()
    current = str(data.get("current_password", ""))
    new = str(data.get("new_password", ""))
    if not verify_password(user.password_hash, current):
        _register_attempt(key)
        return error(
            "wrong_password", "The current password is not correct", 422, {"current_password": "invalid"}
        )
    problem = _password_problem(new)
    if problem:
        return error("invalid_payload", problem, 422, {"new_password": "invalid"})
    if new == current:
        return error(
            "invalid_payload", "The new password must be different from the current one", 422, {"new_password": "same"}
        )
    user.password_hash = hash_password(new)
    session = getattr(g, "session_row", None)
    _revoke_sessions(user.id, keep_id=session.id if session is not None else None)
    record_audit(None, "auth.password_changed", f"user:{user.id}")
    return jsonify({"status": "ok"})


def mail_configured() -> bool:
    return bool(current_app.config.get("RESEND_API_KEY") and current_app.config.get("MAIL_FROM"))


def send_mail(to: str, subject: str, text: str) -> bool:
    """Send a plain-text email through the Resend HTTP API. Returns False when it fails."""
    import json
    import urllib.request

    body = json.dumps(
        {"from": current_app.config["MAIL_FROM"], "to": [to], "subject": subject, "text": text}
    ).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {current_app.config['RESEND_API_KEY']}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:  # fixed https URL
            return 200 <= response.status < 300
    except Exception:
        current_app.logger.exception("password_reset_mail_failed")
        return False


@auth_bp.get("/password-reset/available")
def password_reset_available():
    return jsonify({"available": mail_configured()})


@auth_bp.post("/password-reset/request")
def password_reset_request():
    """Generic request: the answer never reveals whether the email exists.

    The link travels by email only; it is never written to the response or to the log.
    """
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    key = f"reset:{request.remote_addr}"
    if _rate_limited(key):
        return error("too_many_attempts", "Too many attempts. Try again later.", 429)
    _register_attempt(key)
    if email and mail_configured():
        user = db.session.query(User).filter_by(email=email).first()
        if user is not None and user.is_active:
            token = new_password_reset_token(user)
            link = f"{current_app.config['FRONTEND_ORIGIN'].rstrip('/')}/#restablecer={token}"
            send_mail(
                user.email,
                "AlertaFiscal: restablece tu contraseña / reset your password",
                "Recibimos una solicitud para restablecer la contraseña de tu cuenta de AlertaFiscal.\n"
                f"Abre este enlace (vence en 30 minutos):\n{link}\n\n"
                "Si no la pediste, ignora este mensaje; tu contraseña no cambia.\n\n"
                "We received a request to reset your AlertaFiscal password. "
                "Open the link above within 30 minutes. If you did not ask for it, ignore this message.",
            )
            current_app.logger.info("password_reset_requested user_id=%s", user.id)
    return jsonify({"status": "ok", "message": "If the email exists, we sent instructions."})


@auth_bp.post("/password-reset/confirm")
def password_reset_confirm():
    data = get_json()
    key = f"reset-confirm:{request.remote_addr}"
    if _rate_limited(key):
        return error("too_many_attempts", "Too many attempts. Try again later.", 429)
    user = user_for_reset_token(str(data.get("token", "")))
    if user is None:
        _register_attempt(key)
        return error("invalid_token", "The link is not valid or has expired. Ask for a new one.", 400)
    new = str(data.get("new_password", ""))
    problem = _password_problem(new)
    if problem:
        return error("invalid_payload", problem, 422, {"new_password": "invalid"})
    user.password_hash = hash_password(new)
    _revoke_sessions(user.id)
    g.current_user = user
    record_audit(None, "auth.password_reset", f"user:{user.id}")
    return jsonify({"status": "ok"})
