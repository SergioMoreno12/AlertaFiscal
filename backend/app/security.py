"""Seguridad: hash de contraseñas, sesiones revocables y CSRF."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import current_app, g, jsonify, request

from .extensions import db
from .models import CompanyMembership, Session, User

# ── Hash de contraseñas (Argon2id si está disponible; scrypt como respaldo) ──
try:
    from argon2 import PasswordHasher
    from argon2.exceptions import InvalidHashError, VerifyMismatchError

    _ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2, hash_len=32, salt_len=16)
    PASSWORD_SCHEME = "argon2id"

    def hash_password(raw: str) -> str:
        return _ph.hash(raw)

    def verify_password(stored: str, raw: str) -> bool:
        try:
            return _ph.verify(stored, raw)
        except (VerifyMismatchError, InvalidHashError, Exception):
            return False

except ImportError:  # pragma: no cover - solo si argon2-cffi no está instalado
    from werkzeug.security import check_password_hash, generate_password_hash

    PASSWORD_SCHEME = "scrypt"

    def hash_password(raw: str) -> str:
        return generate_password_hash(raw, method="scrypt")

    def verify_password(stored: str, raw: str) -> bool:
        try:
            return check_password_hash(stored, raw)
        except Exception:
            return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# ── CSRF (double submit con firma HMAC) ──


def new_csrf_token() -> str:
    raw = secrets.token_urlsafe(32)
    sig = hmac.new(current_app.config["SECRET_KEY"].encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{raw}.{sig}"


def _csrf_signature_valid(token: str) -> bool:
    try:
        raw, sig = token.rsplit(".", 1)
    except ValueError:
        return False
    expected = hmac.new(current_app.config["SECRET_KEY"].encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(sig, expected)


def set_csrf_cookie(response, token: str):
    response.set_cookie(
        current_app.config["CSRF_COOKIE_NAME"],
        token,
        httponly=False,
        secure=current_app.config["COOKIE_SECURE"],
        samesite=current_app.config["COOKIE_SAMESITE"],
        path="/",
        max_age=60 * 60 * 12,
    )
    return response


def validate_csrf() -> bool:
    header = request.headers.get("X-CSRF-Token", "")
    cookie = request.cookies.get(current_app.config["CSRF_COOKIE_NAME"], "")
    if not header or not cookie:
        return False
    if not hmac.compare_digest(header, cookie):
        return False
    if not _csrf_signature_valid(header):
        return False
    session = getattr(g, "session_row", None)
    if session is not None:
        return hmac.compare_digest(session.csrf_hash, _hash_token(header))
    return True


# ── Sesiones ──


def create_session(user: User) -> tuple[Session, str, str]:
    token = secrets.token_urlsafe(32)
    csrf = new_csrf_token()
    now = datetime.now(timezone.utc)
    session = Session(
        user_id=user.id,
        token_hash=_hash_token(token),
        csrf_hash=_hash_token(csrf),
        ip_address=(request.remote_addr or "")[:64],
        user_agent=(request.user_agent.string or "")[:255],
        last_seen_at=now,
        expires_at=now + timedelta(minutes=current_app.config["SESSION_IDLE_MINUTES"]),
        absolute_expires_at=now + timedelta(hours=current_app.config["SESSION_ABSOLUTE_HOURS"]),
    )
    db.session.add(session)
    db.session.flush()
    return session, token, csrf


def resolve_session() -> Session | None:
    token = request.cookies.get(current_app.config["SESSION_COOKIE_NAME"])
    if not token:
        return None
    session = db.session.query(Session).filter_by(token_hash=_hash_token(token)).first()
    if session is None or session.revoked_at is not None:
        return None
    now = datetime.now(timezone.utc)
    if _utc(session.expires_at) <= now or _utc(session.absolute_expires_at) <= now:
        return None
    user = db.session.get(User, session.user_id)
    if user is None or not user.is_active:
        return None
    session.last_seen_at = now
    session.expires_at = min(
        now + timedelta(minutes=current_app.config["SESSION_IDLE_MINUTES"]),
        _utc(session.absolute_expires_at),
    )
    g.current_user = user
    g.session_row = session
    return session


def clear_session_cookie(response):
    response.delete_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        path="/",
        secure=current_app.config["COOKIE_SECURE"],
        samesite=current_app.config["COOKIE_SAMESITE"],
    )
    return response


def require_auth(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if getattr(g, "current_user", None) is None:
            return jsonify({"error": {"code": "unauthorized", "message": "Sesión requerida"}}), 401
        return view(*args, **kwargs)

    return wrapper


def membership_for(company_id: int) -> CompanyMembership | None:
    user = getattr(g, "current_user", None)
    if user is None:
        return None
    return (
        db.session.query(CompanyMembership)
        .filter_by(user_id=user.id, company_id=company_id, is_active=True)
        .first()
    )
