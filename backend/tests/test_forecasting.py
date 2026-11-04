"""Pruebas del motor de proyección y de las alertas que usan el modelo.

Cubren el contrato del artefacto JSON, la predicción real desde el artefacto,
la persistencia de la corrida, los errores explícitos, la deduplicación de
alertas y el resumen del dashboard. No entrenan ni simulan modelos: construyen
artefactos de prueba y verifican que las entradas del ERP llegan al predictor.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest


def _month_keys(count: int = 13, start_year: int = 2025, start_month: int = 1) -> list[str]:
    months = []
    year, month = start_year, start_month
    for _ in range(count):
        months.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            month = 1
            year += 1
    return months


def _month_start(month: str) -> datetime:
    year, number = (int(part) for part in month.split("-"))
    return datetime(year, number, 1, tzinfo=timezone.utc)


def _write_artifact(
    directory: Path,
    company_id: int,
    company_name: str,
    months: list[str],
    income: list[float],
    expenses: list[float],
    income_coefficient: float = 1.0,
    expense_coefficient: float = 1.0,
) -> Path:
    from app.modules.planning.forecasting import history_signature

    signature = history_signature(months, income, expenses)
    metric = {"mae": 1000.0, "rmse": 1000.0, "mape_percent": 1.0}

    def target(coefficient: float) -> dict:
        return {
            "selected_model": "linear_regression",
            "selection_metric": "mae",
            "metrics": metric,
            "all_metrics": {"linear_regression": metric},
            "models": {
                "linear_regression": {
                    "params": {"coefficients": [coefficient], "intercept": 0.0},
                    "metrics": metric,
                }
            },
            "forecast": [],
        }

    artifact = {
        "schema_version": 1,
        "artifact_kind": "alertafiscal_monthly_forecast",
        "company_id": company_id,
        "company_name": company_name,
        "trained_at": "2026-10-30T00:00:00+00:00",
        "model_version": "test-20261030T000000Z",
        "horizon_months": 3,
        "feature_spec": {"features": ["lag1"], "lags": 1, "season_length": 12},
        "history": {
            "months": months,
            "income": income,
            "expenses": expenses,
            "signature": signature,
            "months_available": len(months),
            "period": {"from": months[0], "to": months[-1]},
        },
        "targets": {
            "income": target(income_coefficient),
            "expenses": target(expense_coefficient),
        },
        "evaluation": {
            "method": "temporal_holdout",
            "test_months": 3,
            "train_rows": max(len(months) - 4, 0),
            "selection_metric": "mae",
        },
        "data_provenance": {
            "kind": "demo",
            "is_demo": True,
            "warning": "Datos sintéticos de prueba; no validan una empresa real.",
        },
        "disclaimer": "Proyección orientativa. No es una liquidación oficial.",
    }
    path = directory / f"model_company{company_id}.json"
    path.write_text(json.dumps(artifact, ensure_ascii=False), encoding="utf-8")
    return path


def _seed_company(app, tmp_path: Path, suffix: str, count: int = 13):
    """Crea una empresa aislada con historial mensual y su artefacto."""
    from app.extensions import db
    from app.models import Company, CompanyMembership, ExpenseDocument, IncomeDocument, User

    with app.app_context():
        user = db.session.query(User).filter_by(email="a@example.com").one()
        company = Company(name=f"Empresa ML {suffix}", nit=f"ML-{suffix}")
        db.session.add(company)
        db.session.flush()
        db.session.add(CompanyMembership(user_id=user.id, company_id=company.id, role="admin"))

        months = _month_keys(count)
        income = [1_000_000.0 + index * 10_000 for index in range(count)]
        expenses = [600_000.0 + index * 5_000 for index in range(count)]
        for index, month in enumerate(months):
            db.session.add(
                IncomeDocument(
                    company_id=company.id,
                    doc_number=f"I-{suffix}-{index}",
                    issue_date=_month_start(month),
                    description="Venta mensual",
                    subtotal=income[index],
                    tax_amount=0,
                    total=income[index],
                    status="collected",
                )
            )
            db.session.add(
                ExpenseDocument(
                    company_id=company.id,
                    doc_number=f"E-{suffix}-{index}",
                    issue_date=_month_start(month),
                    category="Operación",
                    description="Gasto mensual",
                    subtotal=expenses[index],
                    tax_amount=0,
                    total=expenses[index],
                    status="paid",
                    reviewed=False,
                )
            )
        db.session.commit()

        artifact_dir = tmp_path / f"artifacts-{suffix}"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        _write_artifact(
            artifact_dir,
            company.id,
            company.name,
            months,
            [round(value, 2) for value in income],
            [round(value, 2) for value in expenses],
        )
        app.config["FORECAST_ARTIFACT_DIR"] = str(artifact_dir)
        return company.id, months, income, expenses


def _post(client, token, path, payload=None):
    return client.post(path, json=payload or {}, headers={"X-CSRF-Token": token})


def _purge_company(app, company_id: int) -> None:
    """Borra la empresa de prueba y sus filas hijas.

    Las pruebas de esta suite crean empresas reales para el usuario compartido;
    sin limpieza, ``test_isolation`` vería empresas ajenas a «Empresa A» y los
    identificadores de plan podrían reutilizarse con versiones huérfanas.
    """
    from app.extensions import db
    from app.models import Company

    with app.app_context():
        for table in reversed(db.metadata.sorted_tables):
            if "company_id" in table.c:
                db.session.execute(table.delete().where(table.c.company_id == company_id))
        db.session.execute(Company.__table__.delete().where(Company.__table__.c.id == company_id))
        db.session.commit()


@pytest.fixture()
def ml_company(app, tmp_path):
    """Fábrica de empresas aisladas que se eliminan al terminar cada prueba."""
    created: list[int] = []

    def factory(suffix: str, count: int = 13):
        company_id, months, income, expenses = _seed_company(app, tmp_path, suffix, count)
        created.append(company_id)
        return company_id, months, income, expenses

    yield factory
    for company_id in created:
        _purge_company(app, company_id)


def test_model_forecast_missing_artifact_is_explicit(auth, app, ml_company, tmp_path):
    company_id, _, _, _ = ml_company("sin-modelo")
    empty = tmp_path / "vacio"
    empty.mkdir()
    app.config["FORECAST_ARTIFACT_DIR"] = str(empty)

    response = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 3})
    assert response.status_code == 200
    body = response.get_json()
    assert body["available"] is False
    assert body["code"] == "model_not_trained"
    assert body["manual_available"] is True
    assert "modelo entrenado" in body["reason"]


def test_model_forecast_rejects_artifact_from_another_company(auth, app, ml_company):
    company_id, _, _, _ = ml_company("otra-empresa")
    artifact_dir = Path(app.config["FORECAST_ARTIFACT_DIR"])
    artifact = json.loads((artifact_dir / f"model_company{company_id}.json").read_text(encoding="utf-8"))
    artifact["company_id"] = company_id + 999
    (artifact_dir / f"model_company{company_id}.json").write_text(json.dumps(artifact), encoding="utf-8")

    response = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {})
    assert response.status_code == 200
    assert response.get_json()["code"] == "artifact_company_mismatch"


def test_model_forecast_persists_run_and_predicts_from_artifact(auth, app, ml_company):
    company_id, months, income, expenses = ml_company("persistencia")

    response = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 3})
    assert response.status_code == 201, response.get_json()
    body = response.get_json()
    assert body["available"] is True
    assert body["method"] == "linear"
    assert body["model_version"] == "test-20261030T000000Z"
    assert body["horizon_months"] == 3
    assert body["is_demo"] is True
    assert len(body["monthly"]) == 3
    # El modelo lineal de prueba predice el último valor observado (lag1).
    assert body["monthly"][0]["projected_income"] == f"{income[-1]:.2f}"
    assert body["monthly"][0]["projected_expenses"] == f"{expenses[-1]:.2f}"
    assert body["projected_income"] == f"{income[-1] * 3:.2f}"
    assert body["assumptions"]["source"] == "ml_artifact"
    assert body["models"]["income"]["selected_model"] == "linear_regression"

    listed = auth["client"].get(f"/api/v1/companies/{company_id}/forecasts")
    assert listed.status_code == 200
    runs = listed.get_json()["items"]
    assert len(runs) == 1
    assert runs[0]["model_version"] == "test-20261030T000000Z"
    assert runs[0]["assumptions"]["history_months"] == len(months)


def test_list_forecasts_exposes_same_detail_as_creation(auth, app, ml_company):
    """El listado debe devolver el detalle ya guardado, no solo el resumen."""
    company_id, months, _, _ = ml_company("listado-detalle")

    created = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 3})
    assert created.status_code == 201, created.get_json()
    body = created.get_json()

    listed = auth["client"].get(f"/api/v1/companies/{company_id}/forecasts")
    assert listed.status_code == 200
    item = listed.get_json()["items"][0]

    for key in (
        "monthly",
        "models",
        "trained_at",
        "history_months",
        "history_period",
        "data_provenance",
        "method_label",
        "projected_result",
        "is_demo",
        "assumptions",
    ):
        assert item[key] == body[key], key

    assert len(item["monthly"]) == 3
    assert item["history_months"] == len(months)
    assert item["models"]["income"]["selected_model"] == "linear_regression"
    # No se exponen parámetros internos del modelo.
    assert set(item["models"]["income"]) == {"selected_model", "label", "metrics", "all_metrics"}


def test_list_forecasts_tolerates_manual_run_without_ml_metadata(auth, app, ml_company):
    """Corridas manuales/antiguas sin supuestos ML no deben romper el listado."""
    from app.extensions import db
    from app.models import ForecastRun

    company_id, _, _, _ = ml_company("manual-antigua")
    with app.app_context():
        run = ForecastRun(
            company_id=company_id,
            method="manual",
            horizon_months=2,
            cutoff_date=_month_start("2026-01"),
            assumptions={},
            projected_income=1000,
            projected_expenses=400,
            model_version=None,
        )
        db.session.add(run)
        db.session.commit()
        run_id = run.id

    listed = auth["client"].get(f"/api/v1/companies/{company_id}/forecasts")
    assert listed.status_code == 200
    item = listed.get_json()["items"][0]
    assert item["id"] == run_id
    assert item["monthly"] == []
    assert item["models"] == {}
    assert item["trained_at"] is None
    assert item["history_months"] is None
    assert item["data_provenance"] == {}
    assert item["method_label"] == "Promedio manual"
    assert item["projected_result"] == "600.00"


def test_list_forecasts_isolated_between_companies(auth, app, ml_company):
    """El listado de otra empresa no debe ser accesible ni filtrar corridas."""
    company_id, _, _, _ = ml_company("aislamiento-listado")
    created = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 1})
    assert created.status_code == 201, created.get_json()

    other = app.test_client()
    token = other.get("/api/v1/auth/csrf").get_json()["csrf_token"]
    login = other.post(
        "/api/v1/auth/login",
        json={"email": "b@example.com", "password": "Password12345"},
        headers={"X-CSRF-Token": token},
    )
    assert login.status_code == 200, login.get_json()

    forbidden = other.get(f"/api/v1/companies/{company_id}/forecasts")
    assert forbidden.status_code == 403


def test_model_forecast_uses_current_inputs(auth, app, ml_company):
    company_id, months, income, _ = ml_company("entradas")
    from app.extensions import db
    from app.models import IncomeDocument

    first = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 1})
    assert first.status_code == 201
    assert first.get_json()["projected_income"] == f"{income[-1]:.2f}"

    with app.app_context():
        document = (
            db.session.query(IncomeDocument)
            .filter(IncomeDocument.company_id == company_id, IncomeDocument.doc_number == f"I-entradas-{len(months) - 1}")
            .one()
        )
        document.total = 9_999_999
        document.subtotal = 9_999_999
        db.session.commit()

    second = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 1})
    assert second.status_code == 201
    assert second.get_json()["projected_income"] == "9999999.00"
    # La corrida usa las entradas actuales y además marca que el artefacto se
    # entrenó con un historial distinto.
    assert second.get_json()["stale_inputs"] is True


def test_model_forecast_insufficient_history(auth, app, ml_company):
    company_id, months, income, expenses = ml_company("corto", count=13)
    from app.extensions import db
    from app.models import ExpenseDocument, IncomeDocument

    with app.app_context():
        db.session.query(IncomeDocument).filter(IncomeDocument.company_id == company_id).delete()
        db.session.query(ExpenseDocument).filter(ExpenseDocument.company_id == company_id).delete()
        db.session.add(
            IncomeDocument(
                company_id=company_id,
                doc_number="I-unico",
                issue_date=_month_start(months[-1]),
                subtotal=1000,
                tax_amount=0,
                total=1000,
                status="collected",
            )
        )
        db.session.commit()

    response = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model", {})
    assert response.status_code == 200
    body = response.get_json()
    assert body["available"] is False
    assert body["code"] == "insufficient_history"
    assert body["details"]["required_months"] >= 2


def test_alerts_evaluate_deduplicates_and_dashboard_reads_them(auth, app, ml_company):
    company_id, months, _, _ = ml_company("alertas")
    client, token = auth["client"], auth["csrf"]

    plan = _post(
        client,
        token,
        f"/api/v1/companies/{company_id}/plans",
        {
            "name": "Plan ML",
            "period": "2025-02",
            "projected_income": "1000000.00",
            "projected_expenses": "600000.00",
            "estimated_reserve": "5000000.00",
        },
    )
    assert plan.status_code == 201, plan.get_json()

    forecast = _post(client, token, f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 3})
    assert forecast.status_code == 201
    assert forecast.get_json()["monthly"][0]["month"] == "2026-02"

    first = _post(client, token, f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    assert first.status_code == 200, first.get_json()
    first_body = first.get_json()
    assert first_body["created"] >= 1

    second = _post(client, token, f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    second_body = second.get_json()
    assert second_body["created"] == 0
    assert second_body["updated"] >= 1

    alerts = client.get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"]
    titles = {alert["title"] for alert in alerts}
    assert "Reserva por debajo de la meta del plan" in titles
    assert "Gastos pendientes de revisión" in titles
    reserve_alert = next(alert for alert in alerts if alert["title"] == "Reserva por debajo de la meta del plan")
    assert reserve_alert["origin"] == "plan"
    assert reserve_alert["action"]["label"] == "Abrir plan"
    assert reserve_alert["action"]["screen"] == "planificacion"

    before = len(alerts)
    dashboard = client.get(f"/api/v1/companies/{company_id}/dashboard")
    assert dashboard.status_code == 200
    body = dashboard.get_json()
    assert body["latest_forecast"]["id"] == forecast.get_json()["id"]
    assert body["reserve"]["has_target"] is True
    assert body["reserve"]["pending"] == "5000000.00"
    assert len(body["review_now"]) >= 1
    assert body["review_now"][0]["action"]["screen"] in ("planificacion", "gastos", "proyecciones", "obligaciones")
    after = len(client.get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"])
    assert after == before, "GET /dashboard no debe escribir alertas"


def test_stale_forecast_alert_after_inputs_change(auth, app, ml_company):
    company_id, months, _, _ = ml_company("desactualizada")
    client, token = auth["client"], auth["csrf"]

    forecast = _post(client, token, f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 2})
    assert forecast.status_code == 201

    from app.extensions import db
    from app.models import IncomeDocument

    with app.app_context():
        document = (
            db.session.query(IncomeDocument)
            .filter(IncomeDocument.company_id == company_id, IncomeDocument.doc_number == f"I-desactualizada-{len(months) - 1}")
            .one()
        )
        document.total = 4_321_000
        document.subtotal = 4_321_000
        db.session.commit()

    result = _post(client, token, f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    assert result.status_code == 200
    alerts = client.get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"]
    stale = next(alert for alert in alerts if alert["title"] == "Proyección desactualizada por cambios en las entradas")
    assert stale["origin"] == "proyeccion"
    assert stale["action"]["label"] == "Revisar proyección"
    assert stale["action"]["screen"] == "proyecciones"
    assert "Qué ocurrió" in stale["description"]
    assert "Qué revisar" in stale["description"]


def test_forecast_vs_plan_alert_compares_same_period(auth, app, ml_company):
    company_id, _, income, expenses = ml_company("comparacion")
    client, token = auth["client"], auth["csrf"]

    forecast = _post(client, token, f"/api/v1/companies/{company_id}/forecasts/model", {"horizon_months": 1})
    assert forecast.status_code == 201
    point = forecast.get_json()["monthly"][0]
    plan = _post(
        client,
        token,
        f"/api/v1/companies/{company_id}/plans",
        {
            "name": "Plan comparación",
            "period": point["month"],
            "projected_income": "100.00",
            "projected_expenses": "50.00",
            "estimated_reserve": "0.00",
        },
    )
    assert plan.status_code == 201

    _post(client, token, f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    alerts = client.get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"]
    comparison = next(
        alert for alert in alerts if alert["title"] == f"Diferencia entre proyección y plan para {point['month']}"
    )
    assert comparison["origin"] == "proyeccion"
    assert "umbral configurado" in comparison["description"]
    assert "no es un impuesto" in comparison["description"]
