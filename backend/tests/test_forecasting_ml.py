"""Tests of the global model integration (Phase 5, Steps 7-11).

They use the evaluated artifact committed in ``backend/model_artifacts/`` and check:
the global model is the default, a company artifact wins, the 6-month minimum, invalid
artifacts, the zero-scale rule, parity with scikit-learn and the SHA-256 evaluated in Phase 4.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from test_forecasting import _month_start, _post, _purge_company, _write_artifact

BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BACKEND_DIR / "model_artifacts"
GLOBAL_ARTIFACT = MODEL_DIR / "model_global.json"
PARITY_CASES = MODEL_DIR / "parity_cases.json"
TEST_REPORT = BACKEND_DIR.parent / "ml" / "artifacts" / "test_report.json"

# Recorded in docs/04_evaluation_report.md and in Phase 4's test_report.json.
EVALUATED_SHA256 = "18e6872588ec387e853d11665f354c37312a8188893c93f204a6bbc9aeb0663e"
EVALUATED_VERSION = "global-20261103-84df89b5"


def _months(count: int, start: str = "2025-01") -> list[str]:
    year, month = (int(part) for part in start.split("-"))
    out = []
    for _ in range(count):
        out.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            month, year = 1, year + 1
    return out


@pytest.fixture()
def global_dir(app, tmp_path):
    """Artifact folder with only the evaluated global model (no company artifacts)."""
    directory = tmp_path / "global-only"
    directory.mkdir()
    shutil.copyfile(GLOBAL_ARTIFACT, directory / "model_global.json")
    previous = app.config["FORECAST_ARTIFACT_DIR"]
    app.config["FORECAST_ARTIFACT_DIR"] = str(directory)
    yield directory
    app.config["FORECAST_ARTIFACT_DIR"] = previous


@pytest.fixture()
def company_with_history(app):
    """Factory: a company of the shared user with ``count`` months of income and expenses."""
    from app.extensions import db
    from app.models import Company, CompanyMembership, ExpenseDocument, IncomeDocument, User

    created: list[int] = []

    def factory(suffix: str, count: int, income=None, expenses=None):
        months = _months(count)
        income = income or [100_000_000.0 + 2_000_000 * i for i in range(count)]
        expenses = expenses or [70_000_000.0 + 1_500_000 * i for i in range(count)]
        with app.app_context():
            user = db.session.query(User).filter_by(email="a@example.com").one()
            company = Company(name=f"Global model company {suffix}", nit=f"GM-{suffix}")
            db.session.add(company)
            db.session.flush()
            db.session.add(CompanyMembership(user_id=user.id, company_id=company.id, role="admin"))
            for index, month in enumerate(months):
                db.session.add(IncomeDocument(
                    company_id=company.id, doc_number=f"GI-{suffix}-{index}", issue_date=_month_start(month),
                    description="Monthly sale", subtotal=income[index], tax_amount=0, total=income[index],
                    status="collected"))
                db.session.add(ExpenseDocument(
                    company_id=company.id, doc_number=f"GE-{suffix}-{index}", issue_date=_month_start(month),
                    category="Operations", description="Monthly expense", subtotal=expenses[index],
                    tax_amount=0, total=expenses[index], status="paid", reviewed=True))
            db.session.commit()
            created.append(company.id)
            return company.id, months, income, expenses

    yield factory
    for company_id in created:
        _purge_company(app, company_id)


def _run(auth, company_id: int, horizon: int = 6):
    response = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts/model",
                     {"horizon_months": horizon})
    return response.status_code, response.get_json()


# ---------- The evaluated file ----------

def test_deployed_artifact_has_the_evaluated_sha256():
    from app.modules.planning.forecasting import file_sha256

    assert file_sha256(GLOBAL_ARTIFACT) == EVALUATED_SHA256
    if TEST_REPORT.exists():
        report = json.loads(TEST_REPORT.read_text(encoding="utf-8"))
        assert report["artifact_sha256"] == EVALUATED_SHA256
        assert report["model_version"] == EVALUATED_VERSION
        assert report["verdict"] == "accepted"


def test_parity_with_scikit_learn():
    """The backend reproduces the scikit-learn forecasts of parity_cases.json (relative 1e-6)."""
    from app.modules.planning.forecasting import forecast_values

    artifact = json.loads(GLOBAL_ARTIFACT.read_text(encoding="utf-8"))
    cases = json.loads(PARITY_CASES.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 5
    worst = 0.0
    for case in cases:
        for target in ("income", "expenses"):
            expected = case["expected"][target]
            got = forecast_values(artifact, target, case["history"][target], case["last_month"], len(expected))
            for (_, value), reference in zip(got, expected):
                worst = max(worst, abs(value - reference) / max(abs(reference), 1e-9))
            rounded = [round(value, 2) for _, value in got]
            assert rounded == case["expected_rounded"][target]
    assert worst <= 1e-6


def test_backend_never_imports_scikit_learn():
    for path in (BACKEND_DIR / "app").rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "sklearn" not in source and "joblib" not in source, path
    assert "sklearn" not in sys.modules


# ---------- Behavior through the API ----------

def test_global_model_is_used_when_the_company_has_no_artifact(auth, global_dir, company_with_history):
    company_id, months, _, _ = company_with_history("default", 12)
    status, body = _run(auth, company_id)
    assert status == 201, body
    assert body["available"] is True
    assert body["model_version"] == EVALUATED_VERSION
    assert body["method"] == "random_forest"
    assert body["scope"] == "global"
    assert body["artifact_sha256"] == EVALUATED_SHA256
    assert body["is_demo"] is True
    assert body["assumptions"]["scope"] == "global"
    assert body["assumptions"]["artifact_file"] == "model_global.json"
    assert len(body["monthly"]) == 6
    assert body["monthly"][0]["month"] == "2026-01"
    assert all(float(item["projected_income"]) > 0 for item in body["monthly"])


def test_global_horizon_is_capped_at_the_evaluated_six_months(auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("horizon", 8)
    status, body = _run(auth, company_id, horizon=12)
    assert status == 201, body
    assert body["horizon_months"] == 6
    assert len(body["monthly"]) == 6


def test_company_artifact_wins_over_the_global_model(app, auth, global_dir, company_with_history):
    company_id, months, income, expenses = company_with_history("override", 12)
    _write_artifact(global_dir, company_id, "override", months, income, expenses)
    status, body = _run(auth, company_id, horizon=3)
    assert status == 201, body
    assert body["scope"] == "company"
    assert body["model_version"] == "test-20261030T000000Z"
    assert body["assumptions"]["artifact_file"] == f"model_company{company_id}.json"


def test_exactly_six_months_is_enough(auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("six", 6)
    status, body = _run(auth, company_id)
    assert status == 201, body
    assert body["assumptions"]["history_months"] == 6


def test_fewer_than_six_months_returns_insufficient_history(auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("four", 4)
    status, body = _run(auth, company_id)
    assert status == 200
    assert body["available"] is False
    assert body["code"] == "insufficient_history"
    assert body["manual_available"] is True
    assert body["details"] == {"required_months": 6, "months_available": 4}


def test_company_without_documents_returns_insufficient_history(auth, global_dir, company_with_history, app):
    from app.extensions import db
    from app.models import Company, CompanyMembership, User

    with app.app_context():
        user = db.session.query(User).filter_by(email="a@example.com").one()
        company = Company(name="Global model company empty", nit="GM-empty")
        db.session.add(company)
        db.session.flush()
        db.session.add(CompanyMembership(user_id=user.id, company_id=company.id, role="admin"))
        db.session.commit()
        company_id = company.id
    try:
        status, body = _run(auth, company_id)
        assert status == 200
        assert body["code"] == "insufficient_history"
        assert body["details"]["months_available"] == 0
    finally:
        _purge_company(app, company_id)


def test_zero_scale_is_insufficient_history(auth, global_dir, company_with_history):
    income = [5_000_000.0] * 6 + [0.0] * 3
    expenses = [4_000_000.0] * 9
    company_id, _, _, _ = company_with_history("zero", 9, income=income, expenses=expenses)
    status, body = _run(auth, company_id)
    assert status == 200
    assert body["available"] is False
    assert body["code"] == "insufficient_history"
    assert "zero or negative" in body["reason"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda a: a.update(scope="company"),
        lambda a: a["feature_spec"].update(features=["t", "lag1"]),
        lambda a: a["feature_spec"].update(normalization={"type": "z_score"}),
        lambda a: a["targets"]["income"].update(selected_model="mlp"),
        lambda a: a.update(schema_version=2),
    ],
    ids=["scope", "features", "normalization", "unsupported-model", "schema"],
)
def test_invalid_global_artifact_returns_artifact_invalid(auth, global_dir, company_with_history, mutate):
    artifact = json.loads(GLOBAL_ARTIFACT.read_text(encoding="utf-8"))
    mutate(artifact)
    (global_dir / "model_global.json").write_text(json.dumps(artifact), encoding="utf-8")
    company_id, _, _, _ = company_with_history("invalid", 8)
    status, body = _run(auth, company_id)
    assert status == 200
    assert body["available"] is False
    assert body["code"] == "artifact_invalid"
    assert body["manual_available"] is True


def test_corrupt_global_artifact_keeps_the_erp_working(auth, global_dir, company_with_history):
    (global_dir / "model_global.json").write_text("{not json", encoding="utf-8")
    company_id, _, _, _ = company_with_history("corrupt", 8)
    status, body = _run(auth, company_id)
    assert status == 200
    assert body["code"] == "artifact_invalid"
    dashboard = auth["client"].get(f"/api/v1/companies/{company_id}/dashboard")
    assert dashboard.status_code == 200
    manual = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/forecasts", {"horizon_months": 3})
    assert manual.status_code in (200, 201)


# ---------- Alert rule A1 (docs/03_alert_rules.md) ----------

def test_loss_month_alert_lists_every_projected_loss_month(auth, global_dir, company_with_history):
    income = [50_000_000.0] * 12
    expenses = [62_000_000.0] * 12
    company_id, _, _, _ = company_with_history("loss", 12, income=income, expenses=expenses)
    status, body = _run(auth, company_id)
    assert status == 201, body
    losses = [p for p in body["monthly"] if float(p["projected_expenses"]) > float(p["projected_income"])]
    assert losses

    _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    alerts = auth["client"].get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"]
    alert = next(a for a in alerts if a["title"] == "Projected loss months in the latest forecast")
    assert alert["origin"] == "proyeccion"
    for point in losses:
        assert f"Month {point['month']}" in alert["description"]

    # Evaluating again updates the same open alert instead of creating a duplicate.
    _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    alerts = auth["client"].get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"]
    assert sum(1 for a in alerts if a["title"] == "Projected loss months in the latest forecast") == 1


def test_loss_month_alert_does_not_fire_without_losses(auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("profit", 12)
    status, body = _run(auth, company_id)
    assert status == 201, body
    assert all(float(p["projected_expenses"]) <= float(p["projected_income"]) for p in body["monthly"])
    _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/alerts/evaluate", {})
    alerts = auth["client"].get(f"/api/v1/companies/{company_id}/alerts").get_json()["items"]
    assert not any(a["title"] == "Projected loss months in the latest forecast" for a in alerts)
