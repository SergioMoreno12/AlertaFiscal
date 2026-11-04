import os
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()

os.environ.setdefault("APP_ENV", "testing")
os.environ.pop("DB_SCHEMA", None)
# Never read backend/.env during tests: it may hold the Supabase connection string.
os.environ["AF_SKIP_DOTENV"] = "1"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}

if TEST_DATABASE_URL:
    # Real integration: PostgreSQL. Never replaced silently by SQLite.
    from sqlalchemy.engine import make_url

    _test_url = make_url(TEST_DATABASE_URL)
    _db_name = _test_url.database or ""
    if _test_url.get_backend_name() != "postgresql":
        raise RuntimeError("TEST_DATABASE_URL must point to PostgreSQL (not SQLite).")
    if not (_db_name.endswith("_test") or _db_name.startswith("test_")):
        raise RuntimeError(
            "Destructive guard: the TEST_DATABASE_URL database name must end in "
            "'_test' or start with 'test_'. The tests recreate the schema."
        )
    if (_test_url.host or "") not in LOOPBACK_HOSTS:
        # The tests drop and recreate the schema: only a local database is allowed,
        # never Supabase or any other remote host.
        raise RuntimeError("TEST_DATABASE_URL must point to a local database (localhost).")
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["DB_MODE"] = "postgresql"
else:
    # Fast unit and API tests: explicit temporary SQLite, never dev.db.
    _fd, _sqlite_path = tempfile.mkstemp(suffix=".db")
    os.close(_fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{_sqlite_path}"
    os.environ["DB_MODE"] = "sqlite"


def _seed_base_data() -> None:
    from app.extensions import db
    from app.models import Company, CompanyMembership, User
    from app.security import hash_password

    if db.session.query(User).filter_by(email="a@example.com").first() is not None:
        return

    u1 = User(email="a@example.com", full_name="User A", password_hash=hash_password("Password12345"))
    u2 = User(email="b@example.com", full_name="User B", password_hash=hash_password("Password12345"))
    c1 = Company(name="Company A", nit="111")
    c2 = Company(name="Company B", nit="222")
    db.session.add_all([u1, u2, c1, c2])
    db.session.flush()
    db.session.add_all(
        [
            CompanyMembership(user_id=u1.id, company_id=c1.id, role="admin"),
            CompanyMembership(user_id=u2.id, company_id=c2.id, role="admin"),
        ]
    )
    db.session.commit()


def _reset_database(application) -> None:
    """Leave the schema as freshly migrated. Used only with a validated TEST_DATABASE_URL."""
    from sqlalchemy import text

    from app.extensions import db

    with application.app_context():
        if TEST_DATABASE_URL:
            db.session.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            db.session.execute(text("CREATE SCHEMA public"))
            db.session.commit()
            from flask_migrate import upgrade

            upgrade(directory=str(BACKEND_DIR / "migrations"))
        else:
            db.drop_all()
            db.create_all()
        _seed_base_data()


@pytest.fixture(scope="session")
def app():
    from app import create_app

    application = create_app()
    application.config.update(TESTING=True, COOKIE_SECURE=False, COOKIE_SAMESITE="Lax")
    _reset_database(application)

    yield application

    from app.extensions import db

    with application.app_context():
        if TEST_DATABASE_URL:
            from sqlalchemy import text

            db.session.remove()
            db.session.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            db.session.execute(text("CREATE SCHEMA public"))
            db.session.commit()
        db.session.remove()

    if not TEST_DATABASE_URL:
        try:
            os.unlink(_sqlite_path)
        except OSError:
            pass


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def auth(client):
    """Return an authenticated client with helpers for CSRF requests."""

    def csrf():
        return client.get("/api/v1/auth/csrf").get_json()["csrf_token"]

    token = csrf()
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "a@example.com", "password": "Password12345"},
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 200, response.get_json()
    token = response.get_json()["csrf_token"]
    return {"client": client, "csrf": token}
