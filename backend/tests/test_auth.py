def test_login_without_csrf_is_rejected(client):
    response = client.post(
        "/api/v1/auth/login", json={"email": "a@example.com", "password": "Password12345"}
    )
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "csrf_failed"


def test_login_wrong_password_generic(client):
    token = client.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "a@example.com", "password": "wrong"},
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 401
    assert response.get_json()["error"]["message"] == "Credenciales inválidas"


def test_login_and_me(auth):
    response = auth["client"].get("/api/v1/auth/me")
    assert response.status_code == 200
    user = response.get_json()["user"]
    assert user["email"] == "a@example.com"
    assert len(user["companies"]) == 1
    assert user["companies"][0]["role"] == "admin"


def test_logout_revokes_session(auth):
    client, token = auth["client"], auth["csrf"]
    assert client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": token}).status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_requires_session(client):
    assert client.get("/api/v1/auth/me").status_code == 401
