"""Editing and deleting records, company data and passwords."""
import uuid

BASE = "/api/v1/companies/1"


def _h(token):
    return {"X-CSRF-Token": token}


def _income(client, token, number, **extra):
    payload = {"doc_number": number, "issue_date": "2025-03-10", "subtotal": "1000.00", "tax_amount": "190.00"}
    payload.update(extra)
    response = client.post(f"{BASE}/income", json=payload, headers=_h(token))
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def _expense(client, token, number):
    response = client.post(
        f"{BASE}/expenses",
        json={"doc_number": number, "issue_date": "2025-03-11", "subtotal": "500.00", "tax_amount": "0.00"},
        headers=_h(token),
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def test_income_can_be_edited(auth):
    client, token = auth["client"], auth["csrf"]
    row = _income(client, token, "ED-I-1")
    edited = client.patch(
        f"{BASE}/income/{row['id']}",
        json={"doc_number": "ED-I-1B", "issue_date": "2025-04-02", "subtotal": "2000.00", "tax_amount": "380.00",
              "description": "Fixed"},
        headers=_h(token),
    )
    assert edited.status_code == 200, edited.get_json()
    body = edited.get_json()
    assert body["doc_number"] == "ED-I-1B"
    assert body["issue_date"] == "2025-04-02"
    assert body["total"] == "2380.00"
    assert body["description"] == "Fixed"


def test_income_edit_rejects_a_number_already_in_use(auth):
    client, token = auth["client"], auth["csrf"]
    _income(client, token, "ED-I-2")
    other = _income(client, token, "ED-I-3")
    clash = client.patch(f"{BASE}/income/{other['id']}", json={"doc_number": "ED-I-2"}, headers=_h(token))
    assert clash.status_code == 409
    # The failed edit left the document untouched.
    assert client.get(f"{BASE}/income/{other['id']}").get_json()["doc_number"] == "ED-I-3"


def test_income_total_cannot_drop_below_what_was_collected(auth):
    client, token = auth["client"], auth["csrf"]
    row = _income(client, token, "ED-I-4", tax_amount="0.00")
    receipt = client.post(
        f"{BASE}/receipts",
        json={"income_id": row["id"], "amount": "600.00", "received_on": "2025-03-12"},
        headers=_h(token),
    )
    assert receipt.status_code == 201
    too_low = client.patch(
        f"{BASE}/income/{row['id']}", json={"subtotal": "500.00", "tax_amount": "0.00"}, headers=_h(token)
    )
    assert too_low.status_code == 422
    exact = client.patch(
        f"{BASE}/income/{row['id']}", json={"subtotal": "600.00", "tax_amount": "0.00"}, headers=_h(token)
    )
    assert exact.status_code == 200
    assert exact.get_json()["status"] == "collected"


def test_income_can_be_deleted_with_its_receipts(auth):
    client, token = auth["client"], auth["csrf"]
    row = _income(client, token, "ED-I-5", tax_amount="0.00")
    client.post(
        f"{BASE}/receipts",
        json={"income_id": row["id"], "amount": "100.00", "received_on": "2025-03-12"},
        headers=_h(token),
    )
    deleted = client.delete(f"{BASE}/income/{row['id']}", headers=_h(token))
    assert deleted.status_code == 200, deleted.get_json()
    assert client.get(f"{BASE}/income/{row['id']}").status_code == 404
    # The number is free again.
    _income(client, token, "ED-I-5")


def test_expense_can_be_edited_and_deleted(auth):
    client, token = auth["client"], auth["csrf"]
    row = _expense(client, token, "ED-E-1")
    edited = client.patch(
        f"{BASE}/expenses/{row['id']}",
        json={"subtotal": "750.00", "tax_amount": "0.00", "category": "Rent", "issue_date": "2025-05-01"},
        headers=_h(token),
    )
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["total"] == "750.00"
    assert edited.get_json()["category"] == "Rent"
    assert edited.get_json()["issue_date"] == "2025-05-01"
    assert client.delete(f"{BASE}/expenses/{row['id']}", headers=_h(token)).status_code == 200
    listed = client.get(f"{BASE}/expenses?page_size=100").get_json()["items"]
    assert all(item["id"] != row["id"] for item in listed)


def test_records_of_another_company_cannot_be_edited_or_deleted(auth):
    client, token = auth["client"], auth["csrf"]
    row = _income(client, token, "ED-I-6")
    other = "/api/v1/companies/2"
    assert client.patch(f"{other}/income/{row['id']}", json={"description": "x"}, headers=_h(token)).status_code in (403, 404)
    assert client.delete(f"{other}/income/{row['id']}", headers=_h(token)).status_code in (403, 404)
    assert client.get(f"{BASE}/income/{row['id']}").status_code == 200


def test_a_month_of_the_monthly_form_can_be_deleted(auth):
    client, token = auth["client"], auth["csrf"]
    saved = client.post(
        f"{BASE}/monthly-totals",
        json={"months": [{"month": "2019-01", "income": "100.00", "expenses": "40.00"},
                         {"month": "2019-02", "income": "200.00", "expenses": "50.00"}]},
        headers=_h(token),
    )
    assert saved.status_code == 200, saved.get_json()
    removed = client.delete(f"{BASE}/monthly-totals/2019-01", headers=_h(token))
    assert removed.status_code == 200, removed.get_json()
    months = {item["month"]: item for item in removed.get_json()["items"]}
    assert "2019-01" not in months or months["2019-01"]["income"] == "0.00"
    assert months["2019-02"]["income"] == "200.00"
    assert client.delete(f"{BASE}/monthly-totals/2019-01", headers=_h(token)).status_code == 404
    assert client.delete(f"{BASE}/monthly-totals/nope", headers=_h(token)).status_code == 422
    client.delete(f"{BASE}/monthly-totals/2019-02", headers=_h(token))


def test_monthly_total_documents_are_not_edited_as_documents(auth):
    client, token = auth["client"], auth["csrf"]
    client.post(
        f"{BASE}/monthly-totals",
        json={"months": [{"month": "2019-03", "income": "100.00", "expenses": "40.00"}]},
        headers=_h(token),
    )
    rows = client.get(f"{BASE}/income?from=2019-03-01&to=2019-03-31").get_json()["items"]
    monthly = next(item for item in rows if item["doc_number"] == "MONTH-I-2019-03")
    assert client.patch(f"{BASE}/income/{monthly['id']}", json={"subtotal": "1.00"}, headers=_h(token)).status_code == 409
    client.delete(f"{BASE}/monthly-totals/2019-03", headers=_h(token))


def test_obligation_can_be_edited_and_deleted(auth):
    client, token = auth["client"], auth["csrf"]
    created = client.post(
        f"{BASE}/obligations",
        json={"name": "IVA", "period": "2025-1", "due_date": "2025-03-14"},
        headers=_h(token),
    )
    assert created.status_code == 201, created.get_json()
    oid = created.get_json()["id"]
    edited = client.patch(
        f"{BASE}/obligations/{oid}",
        json={"name": "IVA bimestral", "period": "2025-2", "due_date": "2025-05-15", "estimated_amount": "900.00"},
        headers=_h(token),
    )
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["name"] == "IVA bimestral"
    assert edited.get_json()["due_date"] == "2025-05-15"
    assert client.patch(f"{BASE}/obligations/{oid}", json={"due_date": "soon"}, headers=_h(token)).status_code == 422
    assert client.delete(f"{BASE}/obligations/{oid}", headers=_h(token)).status_code == 200
    assert all(item["id"] != oid for item in client.get(f"{BASE}/obligations").get_json()["items"])


def test_company_data_can_be_edited_by_its_admin(app, auth):
    from app.extensions import db
    from app.models import Company

    client, token = auth["client"], auth["csrf"]
    with app.app_context():
        if db.session.query(Company).filter_by(nit="900555444-1").first() is None:
            db.session.add(Company(name="Unrelated", nit="900555444-1"))
            db.session.commit()
    edited = client.patch(
        "/api/v1/companies/1", json={"name": "Company A SAS", "sector": "Services", "size": "Medium"}, headers=_h(token)
    )
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["name"] == "Company A SAS"
    assert edited.get_json()["sector"] == "Services"
    # The NIT of another company is refused, and another company cannot be edited.
    assert client.patch("/api/v1/companies/1", json={"nit": "900555444-1"}, headers=_h(token)).status_code == 409
    assert client.patch("/api/v1/companies/2", json={"name": "Hijacked"}, headers=_h(token)).status_code in (403, 404)
    assert client.patch("/api/v1/companies/1", json={"sector": "Nope"}, headers=_h(token)).status_code == 422
    client.patch("/api/v1/companies/1", json={"name": "Company A"}, headers=_h(token))


def _new_user(app):
    """A fresh signed-in user, so password tests never touch the shared accounts."""
    client = app.test_client()
    token = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    email = f"pw-{uuid.uuid4().hex[:10]}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "full_name": "Password Tester", "password": "FirstPassword1"},
        headers=_h(token),
    )
    assert response.status_code == 201, response.get_json()
    return client, response.get_json()["csrf_token"], email


def _login(app, email, password):
    client = app.test_client()
    token = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    return client.post("/api/v1/auth/login", json={"email": email, "password": password}, headers=_h(token))


def test_password_change_requires_the_current_password(app):
    client, token, email = _new_user(app)
    other_session = _login(app, email, "FirstPassword1")
    assert other_session.status_code == 200

    wrong = client.post(
        "/api/v1/auth/password",
        json={"current_password": "nope-nope-nope", "new_password": "SecondPassword2"},
        headers=_h(token),
    )
    assert wrong.status_code == 422
    short = client.post(
        "/api/v1/auth/password",
        json={"current_password": "FirstPassword1", "new_password": "short"},
        headers=_h(token),
    )
    assert short.status_code == 422

    changed = client.post(
        "/api/v1/auth/password",
        json={"current_password": "FirstPassword1", "new_password": "SecondPassword2"},
        headers=_h(token),
    )
    assert changed.status_code == 200, changed.get_json()
    # This session stays open; the old password stops working and the new one works.
    assert client.get("/api/v1/auth/me").status_code == 200
    assert _login(app, email, "FirstPassword1").status_code == 401
    assert _login(app, email, "SecondPassword2").status_code == 200


def test_password_change_closes_the_other_sessions(app):
    client, token, email = _new_user(app)
    second = app.test_client()
    csrf = second.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    assert second.post(
        "/api/v1/auth/login", json={"email": email, "password": "FirstPassword1"}, headers=_h(csrf)
    ).status_code == 200
    assert second.get("/api/v1/auth/me").status_code == 200
    client.post(
        "/api/v1/auth/password",
        json={"current_password": "FirstPassword1", "new_password": "SecondPassword2"},
        headers=_h(token),
    )
    assert second.get("/api/v1/auth/me").status_code == 401


def test_password_reset_link_works_once(app, monkeypatch):
    from app.modules.auth import routes as auth_routes

    _client, _token, email = _new_user(app)
    sent = []
    monkeypatch.setitem(app.config, "BREVO_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "MAIL_FROM", "AlertaFiscal <no-reply@example.com>")
    monkeypatch.setattr(auth_routes, "send_mail", lambda to, subject, text: sent.append((to, text)) or True)

    anon = app.test_client()
    csrf = anon.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    assert anon.get("/api/v1/auth/password-reset/available").get_json() == {"available": True}

    unknown = anon.post("/api/v1/auth/password-reset/request", json={"email": "nobody@example.com"}, headers=_h(csrf))
    known = anon.post("/api/v1/auth/password-reset/request", json={"email": email}, headers=_h(csrf))
    # Same answer for both, and the link is never in the response.
    assert unknown.status_code == known.status_code == 200
    assert unknown.get_json() == known.get_json()
    assert len(sent) == 1 and sent[0][0] == email
    reset_token = sent[0][1].split("#restablecer=")[1].split()[0]
    assert reset_token not in known.get_data(as_text=True)

    bad = anon.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token + "x", "new_password": "ThirdPassword3"},
        headers=_h(csrf),
    )
    assert bad.status_code == 400
    done = anon.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "new_password": "ThirdPassword3"},
        headers=_h(csrf),
    )
    assert done.status_code == 200, done.get_json()
    again = anon.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": reset_token, "new_password": "FourthPassword4"},
        headers=_h(csrf),
    )
    assert again.status_code == 400
    assert _login(app, email, "ThirdPassword3").status_code == 200
    assert _login(app, email, "FirstPassword1").status_code == 401


def test_password_reset_sends_nothing_when_mail_is_not_configured(app, monkeypatch):
    from app.modules.auth import routes as auth_routes

    _client, _token, email = _new_user(app)
    sent = []
    monkeypatch.setitem(app.config, "BREVO_API_KEY", "")
    monkeypatch.setattr(auth_routes, "send_mail", lambda *args: sent.append(args) or True)
    anon = app.test_client()
    csrf = anon.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    assert anon.get("/api/v1/auth/password-reset/available").get_json() == {"available": False}
    assert anon.post("/api/v1/auth/password-reset/request", json={"email": email}, headers=_h(csrf)).status_code == 200
    assert sent == []


def test_send_mail_builds_the_brevo_request(app, monkeypatch):
    import json
    import urllib.request

    from app.modules.auth import routes as auth_routes

    captured = {}

    class _Response:
        status = 201

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = {key.lower(): value for key, value in req.header_items()}
        captured["body"] = json.loads(req.data)
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with app.app_context():
        monkeypatch.setitem(app.config, "BREVO_API_KEY", "test-key")
        monkeypatch.setitem(app.config, "MAIL_FROM", "AlertaFiscal <no-reply@example.com>")
        assert auth_routes.mail_configured() is True
        assert auth_routes.send_mail("someone@example.com", "Subject", "Body") is True
        assert captured["url"] == "https://api.brevo.com/v3/smtp/email"
        assert captured["headers"]["api-key"] == "test-key"
        assert captured["body"] == {
            "sender": {"name": "AlertaFiscal", "email": "no-reply@example.com"},
            "to": [{"email": "someone@example.com"}],
            "subject": "Subject",
            "textContent": "Body",
        }

        # A bare address works too; something that is not an address counts as not configured.
        monkeypatch.setitem(app.config, "MAIL_FROM", "no-reply@example.com")
        assert auth_routes.mail_configured() is True
        monkeypatch.setitem(app.config, "MAIL_FROM", "AlertaFiscal")
        assert auth_routes.mail_configured() is False
        assert auth_routes.send_mail("someone@example.com", "Subject", "Body") is False
