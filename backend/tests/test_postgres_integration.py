"""Integration tests against a real PostgreSQL.

They are skipped if TEST_DATABASE_URL is not set: they are never replaced by SQLite.
The test database schema is recreated with the Alembic migrations.
"""

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set"),
]


def _login(app, email: str = "a@example.com", password: str = "Password12345"):
    client = app.test_client()
    token = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 200, response.get_json()
    return client, response.get_json()["csrf_token"]


def _post(client, token, path, payload=None):
    return client.post(path, json=payload or {}, headers={"X-CSRF-Token": token})


def test_database_is_postgresql_and_migrated(app):
    from app.extensions import db

    with app.app_context():
        assert db.engine.dialect.name == "postgresql"
        tables = set(inspect(db.engine).get_table_names())
        assert {"alembic_version", "companies", "income_documents", "fiscal_plans"} <= tables
        version = db.session.execute(text("select version_num from alembic_version")).scalar()
        # The Alembic head includes the seasonal forecast method.
        assert version == "d4e8a1b2c3f5"
        assert {"external_sources", "external_dataset_versions", "tax_collections", "sector_benchmarks"} <= tables


def test_health_ready_reports_postgres(app):
    response = app.test_client().get("/health/ready")
    assert response.status_code == 200
    body = response.get_json()
    assert body == {"status": "ready", "database": "postgresql", "demo": False}


def test_money_uses_numeric_and_decimal(app, auth):
    client, token = auth["client"], auth["csrf"]
    doc = f"PG-MONEY-{uuid.uuid4().hex[:8]}"
    response = _post(
        client,
        token,
        "/api/v1/companies/1/income",
        {
            "doc_number": doc,
            "issue_date": "2026-10-01",
            "subtotal": "1234.56",
            "tax_amount": "234.56",
            "total": "1469.12",
        },
    )
    assert response.status_code == 201, response.get_json()

    from app.extensions import db

    with app.app_context():
        amount, column_type = db.session.execute(
            text("select total, pg_typeof(total)::text from income_documents where doc_number = :doc"),
            {"doc": doc},
        ).one()
        assert isinstance(amount, Decimal)
        assert amount == Decimal("1469.12")
        assert column_type == "numeric"


def test_calendar_dates_roundtrip_without_timezone_shift(app, auth):
    client, token = auth["client"], auth["csrf"]
    doc = f"PG-DATE-{uuid.uuid4().hex[:8]}"
    created = _post(
        client,
        token,
        "/api/v1/companies/1/income",
        {
            "doc_number": doc,
            "issue_date": "2026-10-01",
            "subtotal": "10.00",
            "tax_amount": "0.00",
        },
    )
    assert created.status_code == 201, created.get_json()
    income_id = created.get_json()["id"]

    detail = client.get(f"/api/v1/companies/1/income/{income_id}").get_json()
    assert detail["issue_date"] == "2026-10-01"

    from app.extensions import db

    with app.app_context():
        stored = db.session.execute(
            text("select issue_date::date from income_documents where id = :id"), {"id": income_id}
        ).scalar()
        assert stored == date(2026, 10, 1)


def test_foreign_keys_are_enforced(app):
    from app.extensions import db
    from app.models import CompanyMembership

    with app.app_context():
        db.session.add(CompanyMembership(user_id=1, company_id=999999, role="admin"))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_unique_document_constraint_and_rollback(app, auth):
    client, token = auth["client"], auth["csrf"]
    doc = f"PG-UNIQUE-{uuid.uuid4().hex[:8]}"
    payload = {
        "doc_number": doc,
        "issue_date": "2026-10-02",
        "subtotal": "100.00",
        "tax_amount": "19.00",
    }
    assert _post(client, token, "/api/v1/companies/1/income", payload).status_code == 201
    duplicate = _post(client, token, "/api/v1/companies/1/income", payload)
    assert duplicate.status_code == 409

    from app.extensions import db
    from app.models import IncomeDocument

    with app.app_context():
        count = db.session.query(IncomeDocument).filter_by(company_id=1, doc_number=doc).count()
        assert count == 1


def test_role_permissions_are_read_from_postgres(app):
    from app.extensions import db
    from app.models import CompanyMembership, User
    from app.security import hash_password

    email = f"aux-{uuid.uuid4().hex[:8]}@example.com"
    with app.app_context():
        user = User(email=email, full_name="Auxiliar", password_hash=hash_password("Password12345"))
        db.session.add(user)
        db.session.flush()
        db.session.add(CompanyMembership(user_id=user.id, company_id=1, role="auxiliar"))
        db.session.commit()

    client, token = _login(app, email=email)
    # Lectura permitida; escritura reservada a contador/admin.
    assert client.get("/api/v1/companies/1/plans").status_code == 200
    denied = _post(
        client,
        token,
        "/api/v1/companies/1/plans",
        {"name": "No permitido", "period": "2026-10", "projected_income": "1.00"},
    )
    assert denied.status_code == 403


def test_sessions_and_csrf(app):
    client, token = _login(app)
    assert client.get("/api/v1/auth/me").status_code == 200

    # Without a session cookie there is no access.
    assert app.test_client().get("/api/v1/auth/me").status_code == 401

    # Without a CSRF token the request is rejected before the view runs.
    without_csrf = app.test_client()
    token2 = without_csrf.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    assert (
        without_csrf.post(
            "/api/v1/auth/login", json={"email": "a@example.com", "password": "Password12345"}
        ).status_code
        == 403
    )
    assert (
        without_csrf.post(
            "/api/v1/auth/login",
            json={"email": "a@example.com", "password": "Password12345"},
            headers={"X-CSRF-Token": token2},
        ).status_code
        == 200
    )
    # The first client stays authenticated independently.
    assert client.get("/api/v1/auth/me").status_code == 200
    assert token


def test_plan_reserve_alert_comment_and_obligation_persist(app, auth):
    client, token = auth["client"], auth["csrf"]
    suffix = uuid.uuid4().hex[:8]

    plan_response = _post(
        client,
        token,
        "/api/v1/companies/1/plans",
        {
            "name": f"Plan PG {suffix}",
            "period": "2026-10",
            "projected_income": "5000000.00",
            "projected_expenses": "3000000.00",
            "estimated_reserve": "600000.00",
            "assumptions": {"inflacion": "0.05"},
        },
    )
    assert plan_response.status_code == 201, plan_response.get_json()
    plan = plan_response.get_json()
    version_id = plan["version"]["id"]

    reviewed = _post(
        client, token, f"/api/v1/companies/1/plans/{plan['id']}/versions/{version_id}/review"
    )
    assert reviewed.status_code == 200
    assert reviewed.get_json()["version"]["status"] == "reviewed"

    reserve = _post(
        client,
        token,
        "/api/v1/companies/1/reserve-entries",
        {"amount": "150000.50", "reserved_on": "2026-10-20", "plan_version_id": version_id, "note": "Reserva PG"},
    )
    assert reserve.status_code == 201, reserve.get_json()

    alert_response = _post(
        client,
        token,
        "/api/v1/companies/1/alerts",
        {"title": f"PG alert {suffix}", "priority": "alta", "origin": "plan"},
    )
    assert alert_response.status_code == 201
    alert_id = alert_response.get_json()["id"]

    comment = _post(
        client, token, f"/api/v1/companies/1/alerts/{alert_id}/comments", {"body": "Comentario PG"}
    )
    assert comment.status_code == 201

    obligation = _post(
        client,
        token,
        "/api/v1/companies/1/obligations",
        {
            "name": f"IVA PG {suffix}",
            "period": "2026-10",
            "due_date": "2026-11-15",
            "estimated_amount": "250000.00",
        },
    )
    assert obligation.status_code == 201

    # A new login checks that the data was stored and related.
    fresh_client, _ = _login(app)
    detail = fresh_client.get(f"/api/v1/companies/1/plans/{plan['id']}").get_json()
    assert detail["name"] == f"Plan PG {suffix}"
    assert detail["versions"][0]["estimated_reserve"] == "600000.00"

    reserves = fresh_client.get("/api/v1/companies/1/reserve-entries").get_json()
    assert any(item["id"] == reserve.get_json()["id"] for item in reserves["items"])

    alert = fresh_client.get(f"/api/v1/companies/1/alerts/{alert_id}").get_json()
    assert [c["body"] for c in alert["comments"]] == ["Comentario PG"]

    obligations = fresh_client.get("/api/v1/companies/1/obligations?status=pending").get_json()
    assert any(item["name"] == f"IVA PG {suffix}" for item in obligations["items"])

    audit = fresh_client.get("/api/v1/companies/1/audit?page_size=100").get_json()
    actions = {item["action"] for item in audit["items"]}
    assert {"plan.create", "plan.review", "reserve.create", "alert.create", "alert.comment", "obligation.create"} <= actions


def test_company_isolation_on_postgres(app, auth):
    client = auth["client"]
    assert client.get("/api/v1/companies/2").status_code == 403
    assert client.get("/api/v1/companies/2/dashboard").status_code == 403
    assert client.get("/api/v1/companies/2/income").status_code == 403

    other_client, other_token = _login(app, email="b@example.com")
    assert other_client.get("/api/v1/companies/1/income").status_code == 403
    assert (
        _post(
            other_client,
            other_token,
            "/api/v1/companies/1/income",
            {"doc_number": f"CROSS-{uuid.uuid4().hex[:8]}", "issue_date": "2026-10-01"},
        ).status_code
        == 403
    )
