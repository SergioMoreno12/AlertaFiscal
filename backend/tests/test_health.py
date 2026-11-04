def test_live(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_ready_with_database(client):
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ready"
    assert body["database"] in ("sqlite-dev", "postgresql")


def test_ready_does_not_leak_credentials(app):
    with app.test_client() as client:
        body = client.get("/health/ready").get_json()
    assert "DATABASE_URL" not in str(body)
    assert "password" not in str(body).lower()
