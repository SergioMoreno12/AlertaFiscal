import os
from datetime import timedelta
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - python-dotenv is a declared dependency
    load_dotenv = None

# backend/app/config.py -> backend/.env
BACKEND_DIR = Path(__file__).resolve().parent.parent

# Must run BEFORE the Config attributes are evaluated. `override=False`
# respects variables already exported in the shell or injected by the host.
# AF_SKIP_DOTENV=1 lets tests check the configuration without reading backend/.env.
if load_dotenv is not None and os.environ.get("AF_SKIP_DOTENV", "").strip().lower() not in ("1", "true", "yes"):
    load_dotenv(BACKEND_DIR / ".env", override=False)


def _normalize_db_url(url: str) -> str:
    """Accept Render/Supabase URLs and force the psycopg 3 driver."""
    url = url.strip()
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    if maximum is not None:
        value = min(value, maximum)
    return value


def _is_prod() -> bool:
    return os.environ.get("APP_ENV", "development").strip().lower() in ("production", "prod")


class Config:
    APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
    DEBUG = not _is_prod()

    SECRET_KEY = os.environ.get("SECRET_KEY", "").strip()
    if _is_prod():
        if not SECRET_KEY or SECRET_KEY in {"dev-only-change-me", "dev-change-me-please"} or len(SECRET_KEY) < 32:
            raise RuntimeError(
                "SECRET_KEY is required in production and must have at least 32 random "
                "characters (do not use the example value)."
            )
    else:
        SECRET_KEY = SECRET_KEY or "dev-only-change-me"

    # ── Database ─────────────────────────────────────────────────────
    # PostgreSQL is the normal mode. SQLite is enabled only with DB_MODE=sqlite
    # and never in production. There is no silent fallback.
    # DB_IS_DEMO marks the explicit SQLite demo/test mode; it does NOT mean
    # that the system fell back to SQLite automatically.
    DB_MODE_REQUESTED = os.environ.get("DB_MODE", "").strip().lower()
    if DB_MODE_REQUESTED in ("postgres", "postgresql"):
        DB_MODE_REQUESTED = "postgresql"
    if DB_MODE_REQUESTED not in ("", "postgresql", "sqlite"):
        raise RuntimeError("Invalid DB_MODE. Allowed values: postgresql or sqlite.")

    _raw_db_url = os.environ.get("DATABASE_URL", "").strip()
    _is_sqlite_url = _raw_db_url.startswith("sqlite:")

    if _is_prod() and (DB_MODE_REQUESTED == "sqlite" or _is_sqlite_url):
        raise RuntimeError("SQLite is not allowed in production. Set a PostgreSQL DATABASE_URL.")

    if _raw_db_url:
        SQLALCHEMY_DATABASE_URI = _normalize_db_url(_raw_db_url)
        if _is_sqlite_url:
            if DB_MODE_REQUESTED != "sqlite":
                raise RuntimeError(
                    "DATABASE_URL points to SQLite. To use it you must set DB_MODE=sqlite "
                    "explicitly; this mode is only for local demos and tests."
                )
            DB_MODE = "sqlite"
            DB_IS_DEMO = True
        elif SQLALCHEMY_DATABASE_URI.startswith(("postgresql://", "postgresql+psycopg://")):
            if DB_MODE_REQUESTED == "sqlite":
                raise RuntimeError("DB_MODE=sqlite is not compatible with a PostgreSQL DATABASE_URL.")
            DB_MODE = "postgresql"
            DB_IS_DEMO = False
        else:
            raise RuntimeError(
                "DATABASE_URL must use postgresql+psycopg:// (or sqlite:// with DB_MODE=sqlite). "
                "No other engine is supported."
            )
    elif DB_MODE_REQUESTED == "sqlite" and not _is_prod():
        SQLALCHEMY_DATABASE_URI = "sqlite:///dev.db"
        DB_MODE = "sqlite"
        DB_IS_DEMO = True
    else:
        raise RuntimeError(
            "DATABASE_URL is not set. Normal mode requires PostgreSQL, for example "
            "'postgresql+psycopg://user:password@127.0.0.1:5433/alertafiscal'. "
            "For an isolated SQLite demo set DB_MODE=sqlite explicitly."
        )

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    DB_POOL_SIZE = _env_int("DB_POOL_SIZE", 5, minimum=1, maximum=20)
    DB_MAX_OVERFLOW = _env_int("DB_MAX_OVERFLOW", 5, minimum=0, maximum=20)
    DB_POOL_TIMEOUT = _env_int("DB_POOL_TIMEOUT", 15, minimum=1, maximum=120)
    DB_POOL_RECYCLE = _env_int("DB_POOL_RECYCLE", 1800, minimum=60)
    DB_CONNECT_TIMEOUT = _env_int("DB_CONNECT_TIMEOUT", 5, minimum=1, maximum=60)
    DB_SCHEMA = os.environ.get("DB_SCHEMA", "").strip()
    DB_SSLMODE = os.environ.get("DB_SSLMODE", "").strip()
    DB_SSLROOTCERT = os.environ.get("DB_SSLROOTCERT", "").strip()

    if DB_MODE == "postgresql":
        _connect_args: dict[str, object] = {"connect_timeout": DB_CONNECT_TIMEOUT}
        # TLS is optional locally (PostgreSQL in Docker without a certificate).
        # On Supabase configure it following the provider's guide.
        if DB_SSLMODE:
            _connect_args["sslmode"] = DB_SSLMODE
        if DB_SSLROOTCERT:
            _connect_args["sslrootcert"] = DB_SSLROOTCERT
        # DB_SCHEMA is applied per physical connection by app.db_schema.
        # The libpq `options` startup parameter is ignored by the Supabase
        # session pooler, so it must not be used for search_path selection.
        SQLALCHEMY_ENGINE_OPTIONS = {
            "pool_pre_ping": True,
            "pool_size": DB_POOL_SIZE,
            "max_overflow": DB_MAX_OVERFLOW,
            "pool_timeout": DB_POOL_TIMEOUT,
            "pool_recycle": DB_POOL_RECYCLE,
            "connect_args": _connect_args,
        }
    else:
        SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # Sesiones
    SESSION_IDLE_MINUTES = _env_int("SESSION_IDLE_MINUTES", 120, minimum=5)
    SESSION_ABSOLUTE_HOURS = _env_int("SESSION_ABSOLUTE_HOURS", 12, minimum=1)
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=SESSION_IDLE_MINUTES)

    # Cookies
    COOKIE_SECURE = _is_prod() or _env_flag("COOKIE_SECURE", False)
    COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "None" if _is_prod() else "Lax")
    SESSION_COOKIE_NAME = "__Host-af_session" if (COOKIE_SECURE and COOKIE_SAMESITE == "Lax") else "af_session"
    CSRF_COOKIE_NAME = "__Host-af_csrf" if (COOKIE_SECURE and COOKIE_SAMESITE == "Lax") else "af_csrf"

    # CORS: explicit list, never "*"
    FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173").strip()
    ALLOWED_ORIGINS = sorted(
        {
            origin.strip().rstrip("/")
            for origin in (
                [FRONTEND_ORIGIN] + os.environ.get("CORS_ORIGINS", "").split(",")
            )
            if origin and origin.strip()
        }
    )

    # Password recovery by email (optional). Without RESEND_API_KEY and MAIL_FROM no email
    # is sent and the sign-in page does not offer the recovery link.
    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
    MAIL_FROM = os.environ.get("MAIL_FROM", "").strip()

    # Limits
    MAX_PAGE_SIZE = 100
    DEFAULT_PAGE_SIZE = 20
    LOGIN_MAX_ATTEMPTS = _env_int("LOGIN_MAX_ATTEMPTS", 10, minimum=1)
    # New accounts per IP in the same window (public sign-up).
    REGISTER_MAX_ATTEMPTS = _env_int("REGISTER_MAX_ATTEMPTS", 20, minimum=1)
    LOGIN_WINDOW_MINUTES = _env_int("LOGIN_WINDOW_MINUTES", 15, minimum=1)

    # ── ML forecast ──────────────────────────────────────────────────
    # Artifacts are trained offline and read at request time; Flask never trains or
    # imports scikit-learn. The default folder is committed inside backend/ because
    # Render builds from backend/ (rootDir) and ml/artifacts/ would not exist there.
    FORECAST_ARTIFACT_DIR = os.environ.get(
        "FORECAST_ARTIFACT_DIR", str(BACKEND_DIR / "model_artifacts")
    ).strip()
    FORECAST_PLAN_DIFF_PCT = _env_int("FORECAST_PLAN_DIFF_PCT", 15, minimum=0, maximum=100)
    OBLIGATION_DUE_SOON_DAYS = _env_int("OBLIGATION_DUE_SOON_DAYS", 10, minimum=1, maximum=90)

    JSON_SORT_KEYS = False
