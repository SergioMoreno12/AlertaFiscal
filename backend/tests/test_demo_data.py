"""Tests of the semi-synthetic demo data command (Phase 5, Step 12)."""
from __future__ import annotations

import shutil
from decimal import Decimal
from pathlib import Path

import pytest

from test_forecasting import _post, _purge_company

ROOT = Path(__file__).resolve().parents[2]
SERIES = ROOT / "ml" / "data" / "processed" / "monthly_series.csv"
MANIFEST = ROOT / "ml" / "data" / "processed" / "split_manifest.csv"
GLOBAL_ARTIFACT = ROOT / "backend" / "model_artifacts" / "model_global.json"

pytestmark = pytest.mark.skipif(not SERIES.exists(), reason="The Phase 2 dataset is not in this checkout.")


@pytest.fixture()
def demo(app, tmp_path):
    from app.demo_data import load_demo
    from app.extensions import db
    from app.models import User

    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    shutil.copyfile(GLOBAL_ARTIFACT, artifacts / "model_global.json")
    previous = app.config["FORECAST_ARTIFACT_DIR"]
    app.config["FORECAST_ARTIFACT_DIR"] = str(artifacts)
    with app.app_context():
        first = load_demo(SERIES, MANIFEST, "a@example.com", None)
    yield first
    app.config["FORECAST_ARTIFACT_DIR"] = previous
    for company in first["companies"]:
        _purge_company(app, company["company_id"])


def test_demo_load_creates_labeled_companies_with_monthly_documents(app, demo):
    from app.extensions import db
    from app.models import Company, IncomeDocument

    assert len(demo["companies"]) == 6
    months = {item["source_id"]: item["months_loaded"] for item in demo["companies"]}
    assert months["C0252"] == 4
    assert all(value == 34 for key, value in months.items() if key != "C0252")
    with app.app_context():
        for item in demo["companies"]:
            company = db.session.get(Company, item["company_id"])
            assert company.name.endswith("(semi-synthetic demo)")
            assert company.nit == f"DEMO-{item['source_id']}"
        retail = next(item for item in demo["companies"] if item["source_id"] == "C0017")
        first = (
            db.session.query(IncomeDocument)
            .filter_by(company_id=retail["company_id"])
            .order_by(IncomeDocument.issue_date)
            .first()
        )
        # Dataset month 2023-01 moves to 2024-01; millions of COP become pesos.
        assert first.issue_date.year == 2024 and first.issue_date.month == 1
        assert first.total == Decimal(first.total).quantize(Decimal("0.01"))
        assert first.total > Decimal("1000000")


def test_demo_load_is_idempotent_and_can_add_months(app, demo):
    from app.demo_data import load_demo

    with app.app_context():
        again = load_demo(SERIES, MANIFEST, "a@example.com", None)
        assert all(item["documents_added"] == 0 for item in again["companies"])
        more = load_demo(SERIES, MANIFEST, "a@example.com", None, through=35)
    added = {item["source_id"]: item["documents_added"] for item in more["companies"]}
    assert added["C0017"] == 2  # one income and one expense document for month 35
    assert added["C0252"] == 2  # the short company moves its window by one month


def test_demo_companies_show_model_and_manual_mode(auth, demo):
    retail = next(item for item in demo["companies"] if item["source_id"] == "C0017")
    short = next(item for item in demo["companies"] if item["source_id"] == "C0252")

    ok = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{retail['company_id']}/forecasts/model",
               {"horizon_months": 6}).get_json()
    assert ok["available"] is True
    assert ok["scope"] == "global"
    assert ok["monthly"][0]["month"] == "2026-11"

    manual = _post(auth["client"], auth["csrf"], f"/api/v1/companies/{short['company_id']}/forecasts/model",
                   {"horizon_months": 6}).get_json()
    assert manual["available"] is False
    assert manual["code"] == "insufficient_history"
    assert manual["details"]["months_available"] == 4
