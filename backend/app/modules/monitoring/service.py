"""Forecast monitoring logic (Phase 6). See docs/06_monitoring.md.

1. ``record_predictions`` stores one row per target and forecast month when a model run is created.
2. ``refresh_company`` fills the actual value of every closed month the ERP history covers, then
   computes the absolute error, the normalized error and the row status. A month whose actual
   value has not arrived stays ``pending``; if it arrives late, the next refresh resolves it.
3. ``company_status`` computes the rolling normalized error per target over the last
   ``ROLLING_MONTHS`` resolved months and compares it with the Phase 4 reference.

Monitoring observes: it never changes the model, the metrics or the forecasts.
Everything is stored in PostgreSQL (never in local files: Render's disk is ephemeral).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from ...extensions import db
from ...models import ForecastMonitoring, ForecastRun, ForecastServiceEvent
from ..planning.forecasting import monthly_history

TARGETS = ("income", "expenses")

# Reference errors from Phase 4 (docs/04_evaluation_report.md, section 8): median normalized MAE
# of the global model on holdout companies, the scenario closest to a new company in the app.
REFERENCE_NORMALIZED_ERROR_PCT = {"income": Decimal("12.34"), "expenses": Decimal("11.75")}
REFERENCE_SOURCE = "Phase 4 official run, holdout test, median normalized MAE (eval-final-run)"

# Thresholds as closed intervals on ratio = normalized error / reference (docs/06_monitoring.md):
#   normal   : 0   <= ratio <= 1.0
#   watch    : 1.0 <  ratio <= 1.5
#   degraded : 1.5 <  ratio
# Every non-negative number belongs to exactly one level; there are no gaps or overlaps.
WATCH_FROM = Decimal("1.0")
DEGRADED_FROM = Decimal("1.5")
ROLLING_MONTHS = 3
STATUS_ORDER = {"pending": -1, "normal": 0, "watch": 1, "degraded": 2}


def level_for_ratio(ratio: Decimal) -> str:
    if ratio <= WATCH_FROM:
        return "normal"
    if ratio <= DEGRADED_FROM:
        return "watch"
    return "degraded"


def level_for_error(target: str, normalized_error_pct: Decimal) -> tuple[str, Decimal]:
    ratio = (normalized_error_pct / REFERENCE_NORMALIZED_ERROR_PCT[target]).quantize(Decimal("0.0001"))
    return level_for_ratio(ratio), ratio


def _month_label(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def record_predictions(run: ForecastRun, history: dict) -> int:
    """Store the monitoring rows of a model run from the monthly values stored in the run."""
    income_history = [Decimal(str(value)) for value in history["income"]]
    scale = (sum(income_history, Decimal("0")) / len(income_history)) if income_history else Decimal("0")
    if scale <= 0:
        return 0  # without a positive income scale the normalized error is undefined
    monthly = (run.assumptions or {}).get("monthly") or []
    count = 0
    for step, point in enumerate(monthly, start=1):
        for target in TARGETS:
            db.session.add(ForecastMonitoring(
                company_id=run.company_id,
                forecast_run_id=run.id,
                target=target,
                forecast_month=point["month"],
                horizon_step=step,
                predicted_value=Decimal(str(point[f"projected_{target}"])),
                scale_value=scale.quantize(Decimal("0.01")),
                status="pending",
                model_version=run.model_version,
            ))
            count += 1
    db.session.flush()
    return count


def refresh_company(company_id: int, today: date | None = None) -> int:
    """Resolve pending rows whose month is closed and covered by the ERP history."""
    today = today or datetime.now(timezone.utc).date()
    current_month = _month_label(today)
    pending = (
        db.session.query(ForecastMonitoring)
        .filter(ForecastMonitoring.company_id == company_id, ForecastMonitoring.status == "pending")
        .all()
    )
    if not pending:
        return 0
    history = monthly_history(company_id)
    actual = {
        target: dict(zip(history["months"], history[target])) for target in TARGETS
    }
    resolved = 0
    for row in pending:
        if row.forecast_month >= current_month:
            continue  # the month is not closed yet
        value = actual[row.target].get(row.forecast_month)
        if value is None:
            continue  # the real value has not arrived yet: stays pending
        actual_value = Decimal(str(value)).quantize(Decimal("0.01"))
        error = abs(Decimal(str(row.predicted_value)) - actual_value)
        normalized = (error / Decimal(str(row.scale_value)) * Decimal("100")).quantize(Decimal("0.0001"))
        row.actual_value = actual_value
        row.absolute_error = error.quantize(Decimal("0.01"))
        row.normalized_error_pct = normalized
        row.status, _ = level_for_error(row.target, normalized)
        row.resolved_at = datetime.now(timezone.utc)
        resolved += 1
    db.session.flush()
    return resolved


def _latest_rows_per_month(company_id: int, target: str) -> list[ForecastMonitoring]:
    """For each forecast month, the row of the most recent run that forecast it."""
    rows = (
        db.session.query(ForecastMonitoring)
        .filter(ForecastMonitoring.company_id == company_id, ForecastMonitoring.target == target)
        .order_by(ForecastMonitoring.forecast_month.asc(), ForecastMonitoring.forecast_run_id.desc())
        .all()
    )
    chosen: dict[str, ForecastMonitoring] = {}
    for row in rows:
        chosen.setdefault(row.forecast_month, row)
    return [chosen[month] for month in sorted(chosen)]


def company_status(company_id: int) -> dict:
    targets = {}
    for target in TARGETS:
        rows = _latest_rows_per_month(company_id, target)
        resolved = [row for row in rows if row.status != "pending"]
        window = resolved[-ROLLING_MONTHS:]
        if window:
            rolling = (
                sum((Decimal(str(row.normalized_error_pct)) for row in window), Decimal("0")) / len(window)
            ).quantize(Decimal("0.0001"))
            status, ratio = level_for_error(target, rolling)
        else:
            rolling, status, ratio = None, "pending", None
        targets[target] = {
            "status": status,
            "rolling_normalized_error_pct": float(rolling) if rolling is not None else None,
            "ratio_to_reference": float(ratio) if ratio is not None else None,
            "reference_normalized_error_pct": float(REFERENCE_NORMALIZED_ERROR_PCT[target]),
            "months_used": [row.forecast_month for row in window],
            "pending_months": [row.forecast_month for row in rows if row.status == "pending"],
        }
    overall = max((item["status"] for item in targets.values()), key=lambda s: STATUS_ORDER[s])
    latest_run = (
        db.session.query(ForecastRun)
        .filter(ForecastRun.company_id == company_id, ForecastRun.method != "manual")
        .order_by(ForecastRun.created_at.desc(), ForecastRun.id.desc())
        .first()
    )
    return {
        "status": overall,
        "targets": targets,
        "model_version": latest_run.model_version if latest_run else None,
        "last_forecast_at": latest_run.created_at.isoformat() if latest_run else None,
        "inputs_changed_since_training": bool((latest_run.assumptions or {}).get("inputs_changed_since_training"))
        if latest_run else False,
        "reference": REFERENCE_SOURCE,
        "thresholds": {
            "normal": f"0 <= ratio <= {WATCH_FROM}",
            "watch": f"{WATCH_FROM} < ratio <= {DEGRADED_FROM}",
            "degraded": f"{DEGRADED_FROM} < ratio",
            "rolling_months": ROLLING_MONTHS,
        },
    }


def monitoring_rows(company_id: int, limit: int = 60) -> list[dict]:
    rows = (
        db.session.query(ForecastMonitoring)
        .filter(ForecastMonitoring.company_id == company_id)
        .order_by(ForecastMonitoring.forecast_month.desc(), ForecastMonitoring.forecast_run_id.desc(),
                  ForecastMonitoring.target.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "forecast_run_id": row.forecast_run_id,
            "target": row.target,
            "forecast_month": row.forecast_month,
            "horizon_step": row.horizon_step,
            "predicted_value": f"{Decimal(str(row.predicted_value)):.2f}",
            "actual_value": f"{Decimal(str(row.actual_value)):.2f}" if row.actual_value is not None else None,
            "absolute_error": f"{Decimal(str(row.absolute_error)):.2f}" if row.absolute_error is not None else None,
            "normalized_error_pct": float(row.normalized_error_pct) if row.normalized_error_pct is not None else None,
            "status": row.status,
            "model_version": row.model_version,
        }
        for row in rows
    ]


# ---------- Operational monitoring ----------

def record_service_event(company_id: int | None, outcome: str, latency_ms: int, model_version: str | None) -> None:
    db.session.add(ForecastServiceEvent(
        company_id=company_id, outcome=outcome[:40], latency_ms=max(int(latency_ms), 0),
        model_version=model_version,
    ))
    db.session.flush()


def _percentile(values: list[int], q: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q / 100 * (len(ordered) - 1))))
    return ordered[index]


def operations_summary(company_id: int) -> dict:
    events = (
        db.session.query(ForecastServiceEvent)
        .filter(ForecastServiceEvent.company_id == company_id)
        .order_by(ForecastServiceEvent.created_at.desc())
        .limit(500)
        .all()
    )
    counts: dict[str, int] = {}
    for event in events:
        counts[event.outcome] = counts.get(event.outcome, 0) + 1
    latencies = [event.latency_ms for event in events]
    return {
        "requests": len(events),
        "outcomes": counts,
        "latency_ms": {"p50": _percentile(latencies, 50), "p95": _percentile(latencies, 95)},
        "last_model_version": next((e.model_version for e in events if e.model_version), None),
        "last_request_at": events[0].created_at.isoformat() if events else None,
    }
