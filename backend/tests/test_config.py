"""Pruebas de los guards de configuración (sin conectar a bases de datos)."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _run_config(overrides: dict[str, str | None]):
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "APP_ENV",
            "DATABASE_URL",
            "DB_MODE",
            "SECRET_KEY",
            "DB_SCHEMA",
            "DB_SSLMODE",
            "DB_SSLROOTCERT",
        }
    }
    env["AF_SKIP_DOTENV"] = "1"
    env["PYTHONPATH"] = str(BACKEND_DIR)
    for key, value in overrides.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return subprocess.run(
        [sys.executable, "-c", "from app.config import Config; print(Config.DB_MODE)"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_normal_dev_requires_database_url():
    result = _run_config({"APP_ENV": "development"})
    assert result.returncode != 0
    assert "DATABASE_URL no está definida" in result.stderr


def test_sqlite_requires_explicit_mode():
    result = _run_config(
        {
            "APP_ENV": "development",
            "DATABASE_URL": "sqlite:///temporal.db",
        }
    )
    assert result.returncode != 0
    assert "DB_MODE=sqlite" in result.stderr


def test_sqlite_explicit_demo_mode_is_allowed():
    result = _run_config(
        {
            "APP_ENV": "development",
            "DB_MODE": "sqlite",
            "DATABASE_URL": "sqlite:///temporal.db",
        }
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "sqlite"


def test_production_rejects_sqlite():
    result = _run_config(
        {
            "APP_ENV": "production",
            "DB_MODE": "sqlite",
            "SECRET_KEY": "x" * 48,
            "DATABASE_URL": "sqlite:///temporal.db",
        }
    )
    assert result.returncode != 0
    assert "SQLite está prohibido" in result.stderr


def test_production_requires_database_url():
    result = _run_config({"APP_ENV": "production", "SECRET_KEY": "x" * 48})
    assert result.returncode != 0
    assert "DATABASE_URL no está definida" in result.stderr


def test_production_requires_strong_secret_key():
    result = _run_config(
        {
            "APP_ENV": "production",
            "DB_MODE": "postgresql",
            "SECRET_KEY": "corto",
            "DATABASE_URL": "postgresql+psycopg://u:p@127.0.0.1:5432/db",
        }
    )
    assert result.returncode != 0
    assert "SECRET_KEY" in result.stderr


@pytest.mark.parametrize("app_env", ["production", "prod"])
def test_production_accepts_postgres_with_strong_secret(app_env):
    result = _run_config(
        {
            "APP_ENV": app_env,
            "SECRET_KEY": "x" * 48,
            "DATABASE_URL": "postgresql://u:p@127.0.0.1:5432/db",
        }
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "postgresql"


def test_sqlite_health_reports_explicit_demo(tmp_path):
    """SQLite solo existe con opt-in: /health/ready debe decir demo=true, no fallback."""
    db_path = tmp_path / "health.db"
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"APP_ENV", "DATABASE_URL", "DB_MODE", "SECRET_KEY", "DB_SCHEMA", "DB_SSLMODE", "DB_SSLROOTCERT"}
    }
    env.update(
        {
            "AF_SKIP_DOTENV": "1",
            "PYTHONPATH": str(BACKEND_DIR),
            "APP_ENV": "development",
            "DB_MODE": "sqlite",
            "DATABASE_URL": f"sqlite:///{db_path.as_posix()}",
        }
    )
    code = (
        "import json;"
        "from app import create_app;"
        "app = create_app();"
        "app.config.update(TESTING=True);"
        "r = app.test_client().get('/health/ready');"
        "print(r.status_code);"
        "print(json.dumps(r.get_json(), sort_keys=True))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    lines = result.stdout.strip().splitlines()
    assert lines[0] == "200"
    assert lines[1] == '{"database": "sqlite-dev", "demo": true, "status": "ready"}'
