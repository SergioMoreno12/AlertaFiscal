def test_create_and_list_income(auth):
    client, token = auth["client"], auth["csrf"]
    payload = {
        "doc_number": "FV-001",
        "issue_date": "2026-10-01",
        "description": "Test sale",
        "subtotal": "1000000.00",
        "tax_amount": "190000.00",
        "total": "1190000.00",
    }
    created = client.post("/api/v1/companies/1/income", json=payload, headers={"X-CSRF-Token": token})
    assert created.status_code == 201, created.get_json()
    assert created.get_json()["total"] == "1190000.00"

    listed = client.get("/api/v1/companies/1/income")
    assert listed.status_code == 200
    assert listed.get_json()["pagination"]["total"] == 1


def test_duplicate_document_conflict(auth):
    client, token = auth["client"], auth["csrf"]
    payload = {
        "doc_number": "FV-DUP",
        "issue_date": "2026-10-02",
        "subtotal": "100.00",
        "tax_amount": "19.00",
    }
    assert client.post("/api/v1/companies/1/income", json=payload, headers={"X-CSRF-Token": token}).status_code == 201
    duplicate = client.post("/api/v1/companies/1/income", json=payload, headers={"X-CSRF-Token": token})
    assert duplicate.status_code == 409


def test_money_precision_is_preserved(auth):
    client, token = auth["client"], auth["csrf"]
    payload = {
        "doc_number": "FV-CENT",
        "issue_date": "2026-10-03",
        "subtotal": "0.10",
        "tax_amount": "0.02",
    }
    created = client.post("/api/v1/companies/1/income", json=payload, headers={"X-CSRF-Token": token})
    assert created.status_code == 201
    assert created.get_json()["total"] == "0.12"
    assert created.get_json()["subtotal"] == "0.10"


def test_receipt_marks_income_as_collected(auth):
    client, token = auth["client"], auth["csrf"]
    income = client.post(
        "/api/v1/companies/1/income",
        json={
            "doc_number": "FV-COBRO",
            "issue_date": "2026-10-04",
            "subtotal": "1000.00",
            "tax_amount": "0.00",
        },
        headers={"X-CSRF-Token": token},
    ).get_json()
    receipt = client.post(
        "/api/v1/companies/1/receipts",
        json={"income_id": income["id"], "amount": "1000.00", "received_on": "2026-10-05"},
        headers={"X-CSRF-Token": token},
    )
    assert receipt.status_code == 201
    assert receipt.get_json()["income_status"] == "collected"


def test_dashboard_aggregates(auth):
    response = auth["client"].get("/api/v1/companies/1/dashboard")
    assert response.status_code == 200
    body = response.get_json()
    assert "totals" in body and "monthly" in body
    assert body["totals"]["income"] is not None


def test_forecast_requires_history(auth):
    response = auth["client"].post(
        "/api/v1/companies/1/forecasts", json={"horizon_months": 3}, headers={"X-CSRF-Token": auth["csrf"]}
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["available"] is False
    assert "Insufficient history" in body["reason"]


def test_plan_versions_are_immutable_after_review(auth):
    client, token = auth["client"], auth["csrf"]
    plan = client.post(
        "/api/v1/companies/1/plans",
        json={"name": "Plan", "period": "2026-10", "projected_income": "1000.00", "projected_expenses": "600.00"},
        headers={"X-CSRF-Token": token},
    ).get_json()
    version_id = plan["version"]["id"]

    reviewed = client.post(
        f"/api/v1/companies/1/plans/{plan['id']}/versions/{version_id}/review",
        headers={"X-CSRF-Token": token},
    )
    assert reviewed.status_code == 200
    assert reviewed.get_json()["version"]["status"] == "reviewed"

    again = client.post(
        f"/api/v1/companies/1/plans/{plan['id']}/versions/{version_id}/review",
        headers={"X-CSRF-Token": token},
    )
    assert again.status_code == 409
