"""Tests of forecast monitoring (Phase 6). Case ids refer to docs/06_test_cases.md."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from test_forecasting import _month_start, _post
from test_forecasting_ml import _run, company_with_history, global_dir  # noqa: F401 (fixtures)


def _add_month(app, company_id: int, month: str, income: float, expenses: float, tag: str) -> None:
    from app.extensions import db
    from app.models import ExpenseDocument, IncomeDocument

    with app.app_context():
        db.session.add(IncomeDocument(company_id=company_id, doc_number=f"MI-{tag}-{month}",
                                      issue_date=_month_start(month), description="Late sale",
                                      subtotal=income, tax_amount=0, total=income, status="collected"))
        db.session.add(ExpenseDocument(company_id=company_id, doc_number=f"ME-{tag}-{month}",
                                       issue_date=_month_start(month), category="Operations",
                                       description="Late expense", subtotal=expenses, tax_amount=0,
                                       total=expenses, status="paid", reviewed=True))
        db.session.commit()


def _rows(app, company_id: int):
    from app.extensions import db
    from app.models import ForecastMonitoring

    with app.app_context():
        return (db.session.query(ForecastMonitoring).filter_by(company_id=company_id)
                .order_by(ForecastMonitoring.forecast_month, ForecastMonitoring.target).all())


def _refresh(app, company_id: int, today=date(2026, 11, 4)) -> int:
    from app.extensions import db
    from app.modules.monitoring.service import refresh_company

    with app.app_context():
        count = refresh_company(company_id, today=today)
        db.session.commit()
        return count


# ---------- Thresholds (cases 8 and 10) ----------

@pytest.mark.parametrize(
    "ratio, level",
    [("0", "normal"), ("0.9999", "normal"), ("1.0", "normal"), ("1.0001", "watch"),
     ("1.5", "watch"), ("1.5001", "degraded"), ("10", "degraded")],
)
def test_thresholds_are_closed_intervals_without_gaps(ratio, level):
    from app.modules.monitoring.service import level_for_ratio

    assert level_for_ratio(Decimal(ratio)) == level


def test_error_exactly_equal_to_the_reference_is_normal():
    from app.modules.monitoring.service import REFERENCE_NORMALIZED_ERROR_PCT, level_for_error

    for target, reference in REFERENCE_NORMALIZED_ERROR_PCT.items():
        assert level_for_error(target, reference)[0] == "normal"
        assert level_for_error(target, reference * Decimal("1.5"))[0] == "watch"


# ---------- Recording and actual values (cases 6, 7) ----------

def test_predictions_are_recorded_when_a_run_is_created(app, auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("rec", 12)
    status, body = _run(auth, company_id)
    assert status == 201
    rows = _rows(app, company_id)
    assert len(rows) == 12  # 6 months x 2 targets
    assert {row.status for row in rows} == {"pending"}
    assert {row.forecast_run_id for row in rows} == {body["id"]}
    first = next(r for r in rows if r.target == "income" and r.forecast_month == body["monthly"][0]["month"])
    assert f"{Decimal(str(first.predicted_value)):.2f}" == body["monthly"][0]["projected_income"]
    assert first.model_version == body["model_version"]


def test_actual_value_that_never_arrives_stays_pending(app, auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("never", 12)
    _run(auth, company_id)
    assert _refresh(app, company_id) == 0
    assert {row.status for row in _rows(app, company_id)} == {"pending"}


def test_open_month_is_not_resolved_even_with_documents(app, auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("open", 12)
    _, body = _run(auth, company_id)
    month = body["monthly"][0]["month"]  # 2026-01
    _add_month(app, company_id, month, 120_000_000, 90_000_000, "open")
    assert _refresh(app, company_id, today=date(2026, 1, 20)) == 0  # January is still open


def test_late_actual_value_is_computed_when_it_arrives(app, auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("late", 12)
    _, body = _run(auth, company_id)
    month = body["monthly"][0]["month"]
    assert _refresh(app, company_id) == 0
    predicted = float(body["monthly"][0]["projected_income"])
    _add_month(app, company_id, month, predicted, float(body["monthly"][0]["projected_expenses"]), "late")
    assert _refresh(app, company_id) == 2
    resolved = [row for row in _rows(app, company_id) if row.forecast_month == month]
    assert all(row.status == "normal" for row in resolved)
    assert all(Decimal(str(row.absolute_error)) == Decimal("0.00") for row in resolved)


def test_new_income_document_resolves_monitoring_through_the_api(app, auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("api", 12)
    _, body = _run(auth, company_id)
    month = body["monthly"][0]["month"]
    _post(auth["client"], auth["csrf"], f"/api/v1/companies/{company_id}/income",
          {"doc_number": f"API-{month}", "issue_date": f"{month}-10", "subtotal": "120000000.00",
           "tax_amount": "0.00", "status": "collected"})
    view = auth["client"].get(f"/api/v1/companies/{company_id}/monitoring").get_json()
    income_row = next(r for r in view["rows"] if r["target"] == "income" and r["forecast_month"] == month)
    assert income_row["actual_value"] == "120000000.00"
    assert income_row["status"] in ("normal", "watch", "degraded")


# ---------- Rolling status (cases 9, 10) ----------

def _resolve_with_ratio(app, auth, company_id, body, months, ratio, tag):
    """Register actual values whose normalized error is ``ratio`` x the reference."""
    from app.modules.monitoring.service import REFERENCE_NORMALIZED_ERROR_PCT

    scale = float(_rows(app, company_id)[0].scale_value)
    for point in body["monthly"][:months]:
        inc = float(point["projected_income"]) + ratio * float(REFERENCE_NORMALIZED_ERROR_PCT["income"]) / 100 * scale
        exp = float(point["projected_expenses"]) + ratio * float(REFERENCE_NORMALIZED_ERROR_PCT["expenses"]) / 100 * scale
        _add_month(app, company_id, point["month"], inc, exp, tag)
    _refresh(app, company_id)


def _status(app, company_id):
    from app.modules.monitoring.service import company_status

    with app.app_context():
        return company_status(company_id)


@pytest.mark.parametrize("ratio, expected", [(0.5, "normal"), (1.25, "watch"), (2.0, "degraded")])
def test_status_follows_the_rolling_error(app, auth, global_dir, company_with_history, ratio, expected):
    company_id, _, _, _ = company_with_history(f"roll{ratio}", 12)
    _, body = _run(auth, company_id)
    _resolve_with_ratio(app, auth, company_id, body, 3, ratio, f"r{ratio}")
    status = _status(app, company_id)
    assert status["targets"]["income"]["status"] == expected
    assert status["targets"]["expenses"]["status"] == expected
    assert status["status"] == expected
    assert len(status["targets"]["income"]["months_used"]) == 3


def test_status_moves_from_normal_to_watch_to_degraded(app, auth, global_dir, company_with_history):
    from app.modules.monitoring.service import REFERENCE_NORMALIZED_ERROR_PCT

    company_id, _, _, _ = company_with_history("move", 12)
    _, body = _run(auth, company_id)
    scale = float(_rows(app, company_id)[0].scale_value)
    seen = []
    for index, ratio in enumerate((0.5, 2.5, 4.0)):
        point = body["monthly"][index]
        err_inc = ratio * float(REFERENCE_NORMALIZED_ERROR_PCT["income"]) / 100 * scale
        err_exp = ratio * float(REFERENCE_NORMALIZED_ERROR_PCT["expenses"]) / 100 * scale
        _add_month(app, company_id, point["month"], float(point["projected_income"]) + err_inc,
                   float(point["projected_expenses"]) + err_exp, f"mv{index}")
        _refresh(app, company_id)
        seen.append(_status(app, company_id)["targets"]["income"]["status"])
    # rolling means: 0.5 -> (0.5+2.5)/2 = 1.5 -> (0.5+2.5+4.0)/3 = 2.33
    assert seen == ["normal", "watch", "degraded"]


def test_small_and_large_company_with_same_percentage_get_the_same_status(app, auth, global_dir,
                                                                          company_with_history):
    small_income = [10_000_000.0 + 100_000 * i for i in range(12)]
    large_income = [1_000_000_000.0 + 10_000_000 * i for i in range(12)]
    small, _, _, _ = company_with_history("small", 12, income=small_income, expenses=[x * 0.7 for x in small_income])
    large, _, _, _ = company_with_history("large", 12, income=large_income, expenses=[x * 0.7 for x in large_income])
    _, small_body = _run(auth, small)
    _, large_body = _run(auth, large)
    _resolve_with_ratio(app, auth, small, small_body, 2, 1.3, "sm")
    _resolve_with_ratio(app, auth, large, large_body, 2, 1.3, "lg")
    s, l = _status(app, small), _status(app, large)
    assert s["targets"]["income"]["status"] == l["targets"]["income"]["status"] == "watch"
    assert s["targets"]["income"]["rolling_normalized_error_pct"] == pytest.approx(
        l["targets"]["income"]["rolling_normalized_error_pct"], rel=1e-3)


# ---------- Endpoint, operations and isolation (cases 11, 12, 15) ----------

def test_monitoring_endpoint_shows_status_version_date_and_operations(app, auth, global_dir, company_with_history):
    company_id, _, _, _ = company_with_history("view", 12)
    _run(auth, company_id)
    short, _, _, _ = company_with_history("viewshort", 4)
    _run(auth, short)
    view = auth["client"].get(f"/api/v1/companies/{company_id}/monitoring").get_json()
    assert view["status"] == "pending"
    assert view["model_version"] == "global-20261103-84df89b5"
    assert view["last_forecast_at"]
    assert view["thresholds"]["watch"] == "1.0 < ratio <= 1.5"
    assert view["operations"]["outcomes"] == {"success": 1}
    assert view["operations"]["latency_ms"]["p50"] is not None
    other = auth["client"].get(f"/api/v1/companies/{short}/monitoring").get_json()
    assert other["operations"]["outcomes"] == {"insufficient_history": 1}
    assert other["rows"] == []


def test_inputs_changed_flag_is_reported(app, auth, global_dir, company_with_history):
    from app.extensions import db
    from app.models import ForecastRun

    company_id, _, _, _ = company_with_history("flag", 12)
    _, body = _run(auth, company_id)
    with app.app_context():
        run = db.session.get(ForecastRun, body["id"])
        run.assumptions = {**run.assumptions, "inputs_changed_since_training": True}
        db.session.commit()
    view = auth["client"].get(f"/api/v1/companies/{company_id}/monitoring").get_json()
    assert view["inputs_changed_since_training"] is True


def test_monitoring_of_another_company_is_forbidden(auth):
    response = auth["client"].get("/api/v1/companies/2/monitoring")
    assert response.status_code == 403


def test_purge_removes_only_data_older_than_the_retention(app, auth, global_dir, company_with_history):
    from datetime import datetime, timedelta, timezone

    from app.extensions import db
    from app.models import ForecastServiceEvent
    from app.modules.monitoring.service import purge_expired

    company_id, _, _, _ = company_with_history("purge", 12)
    _run(auth, company_id)  # forecast months 2026-01..2026-06, one service event now
    with app.app_context():
        db.session.add(ForecastServiceEvent(company_id=company_id, outcome="success", latency_ms=5,
                                            model_version="old",
                                            created_at=datetime.now(timezone.utc) - timedelta(days=200)))
        db.session.commit()
        preview = purge_expired(today=date(2028, 4, 15), dry_run=True)
        assert preview["months_before"] == "2026-04"
        assert preview["monitoring_rows"] == 6  # 2026-01..2026-03, two targets
        assert preview["service_events"] >= 1
        assert len(_rows(app, company_id)) == 12  # dry run deletes nothing
        purge_expired(today=date(2028, 4, 15))
        db.session.commit()
    assert sorted({row.forecast_month for row in _rows(app, company_id)}) == ["2026-04", "2026-05", "2026-06"]
