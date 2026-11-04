def test_company_list_only_own(auth):
    response = auth["client"].get("/api/v1/companies")
    assert response.status_code == 200
    names = [c["name"] for c in response.get_json()["items"]]
    assert names == ["Company A"]


def test_user_cannot_access_other_company(auth):
    client = auth["client"]
    # Company 2 exists, but the user has no membership.
    assert client.get("/api/v1/companies/2").status_code == 403
    assert client.get("/api/v1/companies/2/dashboard").status_code == 403
    assert client.get("/api/v1/companies/2/income").status_code == 403


def test_nonexistent_company_is_denied(auth):
    assert auth["client"].get("/api/v1/companies/999").status_code == 403
