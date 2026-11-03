import os
from datetime import timedelta
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - python-dotenv es dependencia declarada
    load_dotenv = None

# backend/app/config.py -> backend/.env
BACKEND_DIR = Path(__file__).resolve().parent.parent

# Debe ejecutarse ANTES de evaluar los atributos de Config. `override=False`
# respeta variables ya exportadas en la terminal o inyectadas por el proveedor.
# AF_SKIP_DOTENV=1 permite probar la configuración sin leer backend/.env.
if load_dotenv is not None and os.environ.get("AF_SKIP_DOTENV", "").strip().lower() not in ("1", "true", "yes"):
    load_dotenv(BACKEND_DIR / ".env", override=False)


def _normalize_db_url(url: str) -> str:
    """Acepta URLs de Render/Supabase y fuerza el driver psycopg 3."""
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
                "SECRET_KEY es obligatoria en producción y debe tener al menos 32 caracteres "
                "aleatorios (no uses el valor de ejemplo)."
            )
    else:
        SECRET_KEY = SECRET_KEY or "dev-only-change-me"

    # ── Base de datos ────────────────────────────────────────────────
    # PostgreSQL es el modo normal. SQLite solo se habilita con DB_MODE=sqlite
    # y nunca en producción. No se activa un fallback silencioso.
    # DB_IS_DEMO marca el modo SQLite explícito de demo/pruebas; NO significa
    # que el sistema haya caído a SQLite automáticamente.
    DB_MODE_REQUESTED = os.environ.get("DB_MODE", "").strip().lower()
    if DB_MODE_REQUESTED in ("postgres", "postgresql"):
        DB_MODE_REQUESTED = "postgresql"
    if DB_MODE_REQUESTED not in ("", "postgresql", "sqlite"):
        raise RuntimeError("DB_MODE inválido. Valores admitidos: postgresql o sqlite.")

    _raw_db_url = os.environ.get("DATABASE_URL", "").strip()
    _is_sqlite_url = _raw_db_url.startswith("sqlite:")

    if _is_prod() and (DB_MODE_REQUESTED == "sqlite" or _is_sqlite_url):
        raise RuntimeError("SQLite está prohibido en producción. Configura DATABASE_URL de PostgreSQL.")

    if _raw_db_url:
        SQLALCHEMY_DATABASE_URI = _normalize_db_url(_raw_db_url)
        if _is_sqlite_url:
            if DB_MODE_REQUESTED != "sqlite":
                raise RuntimeError(
                    "DATABASE_URL apunta a SQLite. Para usarla debes declarar DB_MODE=sqlite "
                    "de forma explícita; este modo es solo para demo/pruebas locales."
                )
            DB_MODE = "sqlite"
            DB_IS_DEMO = True
        elif SQLALCHEMY_DATABASE_URI.startswith(("postgresql://", "postgresql+psycopg://")):
            if DB_MODE_REQUESTED == "sqlite":
                raise RuntimeError("DB_MODE=sqlite no es compatible con una DATABASE_URL de PostgreSQL.")
            DB_MODE = "postgresql"
            DB_IS_DEMO = False
        else:
            raise RuntimeError(
                "DATABASE_URL debe usar postgresql+psycopg:// (o sqlite:// con DB_MODE=sqlite). "
                "No se admite otro motor."
            )
    elif DB_MODE_REQUESTED == "sqlite" and not _is_prod():
        SQLALCHEMY_DATABASE_URI = "sqlite:///dev.db"
        DB_MODE = "sqlite"
        DB_IS_DEMO = True
    else:
        raise RuntimeError(
            "DATABASE_URL no está definida. El modo normal requiere PostgreSQL, por ejemplo "
            "'postgresql+psycopg://usuario:clave@127.0.0.1:5433/alertafiscal'. "
            "Para una demo aislada con SQLite declara DB_MODE=sqlite de forma explícita."
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
        # TLS es opcional en local (PostgreSQL en Docker sin certificado).
        # En Supabase debe configurarse según la guía del proveedor.
        if DB_SSLMODE:
            _connect_args["sslmode"] = DB_SSLMODE
        if DB_SSLROOTCERT:
            _connect_args["sslrootcert"] = DB_SSLROOTCERT
        if DB_SCHEMA:
            # Esquema dedicado opcional; debe existir y estar en el search_path.
            _connect_args["options"] = f"-csearch_path={DB_SCHEMA}"
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

    # CORS: lista explícita, nunca "*"
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

    # Límites
    MAX_PAGE_SIZE = 100
    DEFAULT_PAGE_SIZE = 20
    LOGIN_MAX_ATTEMPTS = _env_int("LOGIN_MAX_ATTEMPTS", 10, minimum=1)
    LOGIN_WINDOW_MINUTES = _env_int("LOGIN_WINDOW_MINUTES", 15, minimum=1)

    # ── Pronóstico ML ────────────────────────────────────────────────
    # El artefacto se entrena offline con ml/train.py y se lee en caliente.
    # Flask nunca entrena ni importa scikit-learn.
    FORECAST_ARTIFACT_DIR = os.environ.get(
        "FORECAST_ARTIFACT_DIR", str(BACKEND_DIR.parent / "ml" / "artifacts")
    ).strip()
    FORECAST_PLAN_DIFF_PCT = _env_int("FORECAST_PLAN_DIFF_PCT", 15, minimum=0, maximum=100)
    OBLIGATION_DUE_SOON_DAYS = _env_int("OBLIGATION_DUE_SOON_DAYS", 10, minimum=1, maximum=90)

    JSON_SORT_KEYS = False
