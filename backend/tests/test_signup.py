"""Sign-up, company creation, members and monthly totals."""
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture(autouse=True)
def _reset_limiter():
    from app.modules.auth import routes

    routes._attempts.clear()
    yield
    routes._attempts.clear()


def _csrf(client):
    return client.get("/api/v1/auth/csrf").get_json()["csrf_token"]


def _unique_nit():
    return "9" + str(uuid.uuid4().int)[:8] + "-1"


def _register(client, email=None, company=True):
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "full_name": "Test User", "password": "Password12345"}
    if company:
        body["company"] = {"name": "Mi Pyme SAS", "nit": _unique_nit(), "sector": "Retail", "size": "Small"}
    response = client.post("/api/v1/auth/register", json=body, headers={"X-CSRF-Token": _csrf(client)})
    return response, email


def _months_back(n):
    now = datetime.now(timezone.utc)
    year, month = now.year, now.month
    out = []
    for _ in range(n):
        month -= 1
        if month == 0:
            year, month = year - 1, 12
        out.append(f"{year:04d}-{month:02d}")
    return list(reversed(out))


def test_register_creates_user_company_and_session(client):
    response, email = _register(client)
    assert response.status_code == 201, response.get_json()
    user = response.get_json()["user"]
    assert user["email"] == email
    assert len(user["companies"]) == 1
    assert user["companies"][0]["role"] == "admin"
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.get_json()["user"]["email"] == email


def test_register_rejects_duplicate_email_and_short_password(client):
    _, email = _register(client)
    again, _ = _register(client, email=email)
    assert again.status_code == 409
    weak = client.post(
        "/api/v1/auth/register",
        json={"email": "weak@example.com", "full_name": "Weak", "password": "short"},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert weak.status_code == 422


def test_register_with_taken_nit_creates_nothing(client):
    nit = _unique_nit()
    first = client.post(
        "/api/v1/auth/register",
        json={"email": f"n1-{uuid.uuid4().hex[:6]}@example.com", "full_name": "One", "password": "Password12345",
              "company": {"name": "Uno SAS", "nit": nit}},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert first.status_code == 201
    other = client.application.test_client()
    email = f"n2-{uuid.uuid4().hex[:6]}@example.com"
    second = other.post(
        "/api/v1/auth/register",
        json={"email": email, "full_name": "Two", "password": "Password12345", "company": {"name": "Dos SAS", "nit": nit}},
        headers={"X-CSRF-Token": _csrf(other)},
    )
    assert second.status_code == 409
    # The user was rolled back with the company, so the same email can sign up again.
    retry = other.post(
        "/api/v1/auth/register",
        json={"email": email, "full_name": "Two", "password": "Password12345"},
        headers={"X-CSRF-Token": _csrf(other)},
    )
    assert retry.status_code == 201


def test_new_user_sees_only_own_companies(client):
    response, _ = _register(client)
    own = response.get_json()["user"]["companies"][0]["id"]
    token = response.get_json()["csrf_token"]
    listed = client.get("/api/v1/companies").get_json()["items"]
    assert [c["id"] for c in listed] == [own]
    created = client.post(
        "/api/v1/companies",
        json={"name": "Segunda SAS", "nit": _unique_nit(), "sector": "Services", "size": "Micro"},
        headers={"X-CSRF-Token": token},
    )
    assert created.status_code == 201
    assert len(client.get("/api/v1/companies").get_json()["items"]) == 2


def test_admin_adds_member_and_keeps_one_admin(client, app):
    other = app.test_client()
    _, member_email = _register(other, company=False)

    response, _ = _register(client)
    company_id = response.get_json()["user"]["companies"][0]["id"]
    token = response.get_json()["csrf_token"]
    headers = {"X-CSRF-Token": token}

    missing = client.post(f"/api/v1/companies/{company_id}/members", json={"email": "nobody@example.com"}, headers=headers)
    assert missing.status_code == 404

    added = client.post(
        f"/api/v1/companies/{company_id}/members", json={"email": member_email, "role": "contador"}, headers=headers
    )
    assert added.status_code == 201
    members = client.get(f"/api/v1/companies/{company_id}/members").get_json()["items"]
    assert {m["email"] for m in members} >= {member_email}

    admin_row = next(m for m in members if m["role"] == "admin")
    demote = client.patch(f"/api/v1/companies/{company_id}/members/{admin_row['id']}", json={"role": "auxiliar"}, headers=headers)
    assert demote.status_code == 409

    # The new member now sees the company, but cannot manage members.
    assert company_id in [c["id"] for c in other.get("/api/v1/companies").get_json()["items"]]
    assert other.get(f"/api/v1/companies/{company_id}/members").status_code == 403


def test_monthly_totals_feed_the_model_history(client):
    response, _ = _register(client)
    company_id = response.get_json()["user"]["companies"][0]["id"]
    headers = {"X-CSRF-Token": response.get_json()["csrf_token"]}
    months = _months_back(8)
    body = {"months": [{"month": m, "income": "50000000", "expenses": "30000000"} for m in months]}
    saved = client.post(f"/api/v1/companies/{company_id}/monthly-totals", json=body, headers=headers)
    assert saved.status_code == 200, saved.get_json()
    data = saved.get_json()
    assert data["closed_months"] == 8
    assert all(item["from_monthly_form"] for item in data["items"])
    assert data["items"][0]["income"] == "50000000.00"

    # Saving a month again replaces its amount instead of adding a second document.
    client.post(
        f"/api/v1/companies/{company_id}/monthly-totals",
        json={"months": [{"month": months[0], "income": "10", "expenses": "5"}]},
        headers=headers,
    )
    items = client.get(f"/api/v1/companies/{company_id}/monthly-totals").get_json()["items"]
    assert items[0]["income"] == "10.00"

    future = client.post(
        f"/api/v1/companies/{company_id}/monthly-totals",
        json={"months": [{"month": "2099-01", "income": "1", "expenses": "1"}]},
        headers=headers,
    )
    assert future.status_code == 422


def test_monthly_totals_are_isolated(client, app):
    response, _ = _register(client)
    company_id = response.get_json()["user"]["companies"][0]["id"]
    stranger = app.test_client()
    _register(stranger)
    assert stranger.get(f"/api/v1/companies/{company_id}/monthly-totals").status_code in (403, 404)
