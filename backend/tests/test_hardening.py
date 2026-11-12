"""Regression tests for the final review: error handling, input validation and data rules."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from test_forecasting import _post
from test_forecasting_ml import _run, company_with_history, global_dir  # noqa: F401 (fixtures)


@pytest.fixture(autouse=True)
def _leave_company_1_as_found(app):
    """Other suites count the rows of company 1, so every row created here is removed."""
    from sqlalchemy import func

    from app.extensions import db
    from app.models import (
        AuditEvent,
        ExpenseDocument,
        FiscalPlan,
        FiscalPlanVersion,
        IncomeDocument,
        IncomeReceipt,
    )

    models = (IncomeReceipt, IncomeDocument, ExpenseDocument, FiscalPlanVersion, FiscalPlan, AuditEvent)
    with app.app_context():
        before = {model: db.session.query(func.coalesce(func.max(model.id), 0)).scalar() for model in models}
    yield
    with app.app_context():
        for model in models:
            db.session.query(model).filter(model.company_id == 1, model.id > before[model]).delete(
                synchronize_session=False
            )
        db.session.commit()


def _headers(auth):
    return {"X-CSRF-Token": auth["csrf"]}


def _income(auth, number: str, total: str = "1000.00", date: str = "2026-09-10"):
    response = auth["client"].post(
        "/api/v1/companies/1/income",
        json={"doc_number": number, "issue_date": date, "subtotal": total, "tax_amount": "0"},
        headers=_headers(auth),
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()


# ---------- HTTP errors keep their status code ----------

def test_malformed_json_is_a_client_error_not_a_500(auth):
    response = auth["client"].post(
        "/api/v1/companies/1/alerts/evaluate",
        data="{not json",
        headers={**_headers(auth), "Content-Type": "application/json"},
    )
    # The route ignores the body; the point is that nothing turns into a 500.
    assert response.status_code < 500


def test_oversized_body_is_rejected_with_413(auth):
    response = auth["client"].post(
        "/api/v1/companies/1/income",
        data="x" * (2 * 1024 * 1024),
        headers={**_headers(auth), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.get_json()["error"]["code"] == "request_entity_too_large"


def test_invalid_pagination_returns_422(auth):
    response = auth["client"].get("/api/v1/companies/1/income?page=abc")
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "invalid_payload"


# ---------- Input validation ----------

def test_manual_forecast_rejects_a_non_numeric_growth(auth):
    response = _post(
        auth["client"], auth["csrf"], "/api/v1/companies/1/forecasts",
        {"horizon_months": 3, "income_growth_percent": "ten"},
    )
    assert response.status_code == 422
    assert "income_growth_percent" in response.get_json()["error"]["message"]


def test_model_forecast_rejects_a_non_integer_horizon(auth):
    response = _post(auth["client"], auth["csrf"], "/api/v1/companies/1/forecasts/model", {"horizon_months": "x"})
    assert response.status_code == 422


def test_amount_too_large_for_the_column_is_rejected(auth):
    response = auth["client"].post(
        "/api/v1/companies/1/income",
        json={"doc_number": "FV-HUGE", "issue_date": "2026-09-10", "subtotal": "1e20", "tax_amount": "0"},
        headers=_headers(auth),
    )
    assert response.status_code == 422


def test_receipt_cannot_exceed_the_outstanding_balance(auth):
    income = _income(auth, "FV-PARTIAL", "1000.00")
    client = auth["client"]
    first = client.post(
        "/api/v1/companies/1/receipts",
        json={"income_id": income["id"], "amount": "600.00", "received_on": "2026-09-15"},
        headers=_headers(auth),
    )
    assert first.status_code == 201
    assert first.get_json()["income_status"] == "pending"

    too_much = client.post(
        "/api/v1/companies/1/receipts",
        json={"income_id": income["id"], "amount": "500.00", "received_on": "2026-09-16"},
        headers=_headers(auth),
    )
    assert too_much.status_code == 422
    assert "400.00" in too_much.get_json()["error"]["message"]

    rest = client.post(
        "/api/v1/companies/1/receipts",
        json={"income_id": income["id"], "amount": "400.00", "received_on": "2026-09-16"},
        headers=_headers(auth),
    )
    assert rest.status_code == 201
    assert rest.get_json()["income_status"] == "collected"

    detail = client.get(f"/api/v1/companies/1/income/{income['id']}").get_json()
    assert detail["receipts"][0]["received_on"] == "2026-09-15"  # calendar date, no time zone

    again = client.post(
        "/api/v1/companies/1/receipts",
        json={"income_id": income["id"], "amount": "1.00", "received_on": "2026-09-17"},
        headers=_headers(auth),
    )
    assert again.status_code == 409


def test_void_expense_is_not_modified(app, auth):
    from app.extensions import db
    from app.models import ExpenseDocument

    with app.app_context():
        row = ExpenseDocument(
            company_id=1, doc_number="FC-VOID", issue_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            category="Operations", description="original", subtotal=10, tax_amount=0, total=10, status="void",
        )
        db.session.add(row)
        db.session.commit()
        expense_id = row.id

    response = auth["client"].patch(
        f"/api/v1/companies/1/expenses/{expense_id}", json={"description": "changed"}, headers=_headers(auth)
    )
    assert response.status_code == 409
    with app.app_context():
        assert db.session.get(ExpenseDocument, expense_id).description == "original"


# ---------- Plans ----------

def test_reviewing_an_old_version_does_not_mark_the_plan_reviewed(auth):
    client = auth["client"]
    plan = _post(client, auth["csrf"], "/api/v1/companies/1/plans",
                 {"projected_income": "100", "projected_expenses": "50"}).get_json()
    assert plan["name"] == "Tax plan"
    first_version_id = plan["version"]["id"]
    _post(client, auth["csrf"], f"/api/v1/companies/1/plans/{plan['id']}/versions",
          {"projected_income": "110", "projected_expenses": "55"})

    reviewed = _post(client, auth["csrf"],
                     f"/api/v1/companies/1/plans/{plan['id']}/versions/{first_version_id}/review", {})
    assert reviewed.status_code == 200
    assert reviewed.get_json()["status"] == "draft"  # version 2 is still a draft


# ---------- Audit ----------

def test_audit_events_carry_the_actor_name(auth):
    _income(auth, "FV-AUDIT")
    items = auth["client"].get("/api/v1/companies/1/audit").get_json()["items"]
    assert items and items[0]["actor_name"] == "User A"


# ---------- Forecast inputs ----------

def test_model_forecast_ignores_the_month_in_progress(auth, global_dir, company_with_history):  # noqa: F811
    from app.extensions import db  # noqa: F401

    company_id, months, _, _ = company_with_history("partial", 9)
    today = datetime.now(timezone.utc)
    # A tiny, half-recorded current month must not become the last input of the model.
    auth["client"].post(
        f"/api/v1/companies/{company_id}/income",
        json={"doc_number": "PARTIAL-NOW", "issue_date": today.strftime("%Y-%m-%d"), "subtotal": "1", "tax_amount": "0"},
        headers=_headers(auth),
    )
    status, body = _run(auth, company_id)
    assert status == 201, body
    assert body["history_period"]["to"] == months[-1]
    assert body["history_months"] == len(months)


def test_forecast_errors_do_not_expose_server_paths(app, auth, company_with_history, tmp_path):  # noqa: F811
    empty = tmp_path / "no-artifacts"
    empty.mkdir()
    previous = app.config["FORECAST_ARTIFACT_DIR"]
    app.config["FORECAST_ARTIFACT_DIR"] = str(empty)
    try:
        company_id, _, _, _ = company_with_history("nopath", 8)
        status, body = _run(auth, company_id)
    finally:
        app.config["FORECAST_ARTIFACT_DIR"] = previous
    assert status == 200
    assert body["code"] == "model_not_trained"
    assert str(empty) not in str(body)
    assert body["details"]["artifact"] == f"model_company{company_id}.json"


# ---------- Login ----------

def test_unknown_email_and_wrong_password_get_the_same_answer(client):
    token = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "x" * 12},
                          headers={"X-CSRF-Token": token})
    wrong = client.post("/api/v1/auth/login", json={"email": "b@example.com", "password": "x" * 12},
                        headers={"X-CSRF-Token": token})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.get_json()["error"]["code"] == wrong.get_json()["error"]["code"] == "invalid_credentials"


def test_login_works_with_a_fresh_token_while_a_stale_session_cookie_remains(app, client):
    """A failed logout leaves the session cookie; the page has lost its token and must still sign in."""
    first = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    login = client.post("/api/v1/auth/login", json={"email": "b@example.com", "password": "Password12345"},
                        headers={"X-CSRF-Token": first})
    assert login.status_code == 200

    fresh = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    again = client.post("/api/v1/auth/login", json={"email": "b@example.com", "password": "Password12345"},
                        headers={"X-CSRF-Token": fresh})
    assert again.status_code == 200

    # Other writes stay bound to the session: a signed token that this session did not ask
    # for (here, one issued to another browser and planted as the cookie) is rejected.
    unbound = app.test_client().get("/api/v1/auth/csrf").get_json()["csrf_token"]
    client.set_cookie(app.config["CSRF_COOKIE_NAME"], unbound)
    blocked = client.post("/api/v1/companies/2/alerts", json={"title": "x"}, headers={"X-CSRF-Token": unbound})
    assert blocked.status_code == 403
    # Logout only needs the signed token in the header and the cookie.
    allowed = client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": unbound})
    assert allowed.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
