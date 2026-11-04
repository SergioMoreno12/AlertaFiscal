"""Deterministic alert rules, evaluated on demand.

Origins:
- A) ERP / rules: recorded documents, obligations, plan and reserves.
- B) ML forecast: runs of the model trained offline.

The rules do not predict penalties or promise savings. Each alert explains what
happened, its origin, the figures, what to check and on which screen. The
evaluation runs only on an explicit user action (POST), never from a GET of the
dashboard.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import current_app, g
from sqlalchemy import func

from ...common.http import record_audit
from ...extensions import db
from ...models import (
    Alert,
    ExpenseDocument,
    FiscalPlan,
    FiscalPlanVersion,
    ForecastRun,
    ReserveEntry,
    TaxObligation,
)
from ..planning.forecasting import monthly_history

PRIORITY_ORDER = {"alta": 0, "media": 1, "baja": 2}  # stored codes (high, medium, low); the UI translates them
ORIGIN_LABEL = {
    "erp": "A) ERP / rules",
    "plan": "A) ERP / rules (plan)",
    "configuracion": "A) ERP / rules (configuration)",
    "proyeccion": "B) ML forecast",
}


def _amount(value) -> str:
    return f"${Decimal(str(value or 0)):,.2f}"


def _latest_plan(company_id: int) -> tuple[FiscalPlan | None, FiscalPlanVersion | None]:
    plan = (
        db.session.query(FiscalPlan)
        .filter(FiscalPlan.company_id == company_id, FiscalPlan.status != "archived")
        .order_by(FiscalPlan.updated_at.desc(), FiscalPlan.id.desc())
        .first()
    )
    if plan is None:
        return None, None
    version = (
        db.session.query(FiscalPlanVersion)
        .filter(FiscalPlanVersion.plan_id == plan.id)
        .order_by(FiscalPlanVersion.version.desc())
        .first()
    )
    return plan, version


def _latest_model_run(company_id: int) -> ForecastRun | None:
    return (
        db.session.query(ForecastRun)
        .filter(
            ForecastRun.company_id == company_id,
            ForecastRun.method != "manual",
            ForecastRun.model_version.isnot(None),
        )
        .order_by(ForecastRun.created_at.desc(), ForecastRun.id.desc())
        .first()
    )


def _upsert(
    company_id: int,
    title: str,
    origin: str,
    priority: str,
    description: str,
    due_date: datetime | None = None,
) -> tuple[str, Alert]:
    existing = (
        db.session.query(Alert)
        .filter(
            Alert.company_id == company_id,
            Alert.title == title,
            Alert.origin == origin,
            Alert.status != "reviewed",
        )
        .order_by(Alert.created_at.desc())
        .first()
    )
    if existing is not None:
        existing.description = description[:2000]
        existing.priority = priority
        existing.due_date = due_date
        return "updated", existing

    row = Alert(
        company_id=company_id,
        title=title[:200],
        description=description[:2000],
        priority=priority,
        origin=origin,
        status="pending",
        due_date=due_date,
        created_by=getattr(getattr(g, "current_user", None), "id", None),
    )
    db.session.add(row)
    db.session.flush()
    return "created", row


def _rule_reserve(company_id: int) -> list[tuple[str, Alert]]:
    plan, version = _latest_plan(company_id)
    if plan is None or version is None:
        return []

    target = Decimal(str(version.estimated_reserve or 0))
    reserved = Decimal(
        str(
            db.session.query(func.coalesce(func.sum(ReserveEntry.amount), 0))
            .filter(ReserveEntry.company_id == company_id)
            .scalar()
            or 0
        )
    )
    if target <= 0:
        description = (
            "What happened: the current plan has no reserve target.\n"
            "Origin: A) ERP / rules (plan and recorded reserves).\n"
            f"Figures: reserve target {_amount(0)}; recorded reserve {_amount(reserved)}.\n"
            "What to check: set the target in the plan and confirm whether the current reserve is enough.\n"
            f"Screen: Tax planning → Reserve plan (period {plan.period})."
        )
        return [
            _upsert(
                company_id,
                "Reserve target not set",
                "plan",
                "media",
                description,
            )
        ]

    if reserved >= target:
        return []

    pending = target - reserved
    coverage = (reserved / target * Decimal("100")) if target else Decimal("0")
    priority = "alta" if coverage < 50 else "media"
    description = (
        "What happened: the recorded reserve does not cover the target of the current plan.\n"
        "Origin: A) ERP / rules (plan target and recorded reserves).\n"
        f"Figures: target {_amount(target)}; recorded reserve {_amount(reserved)}; "
        f"missing {_amount(pending)}; coverage {coverage:.1f}%.\n"
        "What to check: confirm the target and record the missing reserve if it applies. "
        "The target is a planning decision, not an assessed tax.\n"
        f"Screen: Tax planning → Reserve plan (period {plan.period})."
    )
    return [
        _upsert(
            company_id,
            "Reserve below the plan target",
            "plan",
            priority,
            description,
        )
    ]


def _rule_obligations(company_id: int) -> list[tuple[str, Alert]]:
    today = datetime.now(timezone.utc).date()
    horizon_days = int(current_app.config["OBLIGATION_DUE_SOON_DAYS"])
    limit = today + timedelta(days=horizon_days)
    rows = (
        db.session.query(TaxObligation)
        .filter(
            TaxObligation.company_id == company_id,
            TaxObligation.status.in_(("pending", "filed")),
            TaxObligation.due_date.isnot(None),
        )
        .order_by(TaxObligation.due_date.asc())
        .all()
    )

    results: list[tuple[str, Alert]] = []
    for obligation in rows:
        due = obligation.due_date.date()
        if due > limit:
            continue
        overdue = due < today
        days = (due - today).days
        if overdue:
            title = f"Overdue obligation: {obligation.name} · {due.isoformat()}"
            priority = "alta"
            situation = f"the obligation was due {abs(days)} day(s) ago."
        else:
            title = f"Upcoming obligation: {obligation.name} · {due.isoformat()}"
            priority = "alta" if days <= 3 else "media"
            situation = f"the obligation is due in {days} day(s)."

        amount = (
            _amount(obligation.estimated_amount)
            if obligation.estimated_amount is not None
            else "no amount set (zero not confirmed)"
        )
        description = (
            f"What happened: {situation}\n"
            "Origin: A) ERP / rules (obligations recorded manually).\n"
            f"Figures: period {obligation.period or 'not set'}; due date {due.isoformat()}; "
            f"estimated amount {amount}.\n"
            "What to check: confirm the date, the amount and the filing status with the accountant. "
            "This alert does not compute penalties or interest.\n"
            "Screen: Obligations."
        )
        results.append(
            _upsert(
                company_id,
                title,
                "erp",
                priority,
                description,
                due_date=obligation.due_date,
            )
        )
    return results


def _rule_expenses(company_id: int) -> list[tuple[str, Alert]]:
    count, total = (
        db.session.query(func.count(ExpenseDocument.id), func.coalesce(func.sum(ExpenseDocument.total), 0))
        .filter(
            ExpenseDocument.company_id == company_id,
            ExpenseDocument.status != "void",
            ExpenseDocument.reviewed.is_(False),
        )
        .one()
    )
    if not count:
        return []

    description = (
        "What happened: some recorded expenses have not been reviewed yet.\n"
        "Origin: A) ERP / rules (expense documents).\n"
        f"Figures: {int(count)} document(s); total {_amount(total)}.\n"
        "What to check: confirm the category, support and amount of each expense before using it for planning. "
        "Reviewing an expense does not change the reserve or the plan by itself.\n"
        "Screen: Expenses."
    )
    return [
        _upsert(
            company_id,
            "Expenses pending review",
            "erp",
            "media",
            description,
        )
    ]


def _rule_stale_forecast(company_id: int) -> list[tuple[str, Alert]]:
    run = _latest_model_run(company_id)
    if run is None:
        return []

    assumptions = run.assumptions or {}
    trained_signature = assumptions.get("history_signature")
    current = monthly_history(company_id)
    if not current["months"] or not trained_signature:
        return []
    if trained_signature == current["signature"]:
        return []

    description = (
        "What happened: the ERP income or expenses changed after the last model forecast.\n"
        "Origin: B) ML forecast (signature of the input history).\n"
        f"Figures: history used by the run up to {assumptions.get('history_period', {}).get('to', 'no date')}; "
        f"current history up to {current['months'][-1]}; model version {run.model_version or 'no version'}.\n"
        "What to check: run a new forecast so it uses the current inputs. "
        "The previous run stays in the history.\n"
        "Screen: Forecasts."
    )
    return [
        _upsert(
            company_id,
            "Forecast out of date because the inputs changed",
            "proyeccion",
            "media",
            description,
        )
    ]


def _rule_forecast_vs_plan(company_id: int) -> list[tuple[str, Alert]]:
    run = _latest_model_run(company_id)
    plan, version = _latest_plan(company_id)
    if run is None or plan is None or version is None:
        return []

    monthly = (run.assumptions or {}).get("monthly") or []
    point = next((item for item in monthly if item.get("month") == plan.period), None)
    if point is None:
        # Without a comparable period, no comparison is made up.
        return []

    threshold = Decimal(str(current_app.config["FORECAST_PLAN_DIFF_PCT"]))
    concepts = []
    relevant = False
    max_pct = Decimal("0")

    for key, label, plan_value in (
        ("projected_income", "income", Decimal(str(version.projected_income or 0))),
        ("projected_expenses", "expenses", Decimal(str(version.projected_expenses or 0))),
    ):
        forecast_value = Decimal(str(point.get(key) or 0))
        if plan_value == 0 and forecast_value == 0:
            concepts.append(f"{label}: plan at zero and forecast at zero (no difference).")
            continue
        if plan_value == 0:
            relevant = True
            concepts.append(
                f"{label}: plan explicitly at zero; forecast {_amount(forecast_value)}. "
                "The percentage difference is not computed over zero."
            )
            continue
        difference = abs(forecast_value - plan_value)
        pct = difference / plan_value * Decimal("100")
        max_pct = max(max_pct, pct)
        if pct >= threshold:
            relevant = True
        concepts.append(
            f"{label}: plan {_amount(plan_value)}; forecast {_amount(forecast_value)}; "
            f"difference {_amount(difference)} ({pct:.1f}%)."
        )

    if not relevant:
        return []

    priority = "alta" if max_pct >= threshold * 2 else "media"
    description = (
        f"What happened: the model forecast differs from the plan for the same period ({plan.period}).\n"
        "Origin: B) ML forecast compared with A) ERP / plan.\n"
        f"Figures: configured threshold {threshold:.0f}%. " + " ".join(concepts) + "\n"
        "What to check: decide whether the plan should be updated or the forecast inputs need a review. "
        "Income minus expenses is not a tax or a mandatory reserve.\n"
        "Screen: Forecasts and Tax planning."
    )
    return [
        _upsert(
            company_id,
            f"Difference between forecast and plan for {plan.period}",
            "proyeccion",
            priority,
            description,
        )
    ]


# Rule A1 of docs/03_alert_rules.md (Phase 1): projected loss month.
LOSS_MONTH_TITLE = "Projected loss months in the latest forecast"


def _rule_loss_month(company_id: int) -> list[tuple[str, Alert]]:
    """A1: for any forecast month m, projected expenses > projected income.

    It reads the stored monthly values of the latest model run, so it uses exactly what the
    user saw. Every month that fires is listed in calendar order. The rule does not say the
    company is at risk: it points at months worth reviewing.
    """
    run = _latest_model_run(company_id)
    if run is None:
        return []
    monthly = (run.assumptions or {}).get("monthly") or []
    lines = []
    for point in monthly:
        income = max(Decimal(str(point.get("projected_income") or 0)), Decimal("0"))
        expenses = max(Decimal(str(point.get("projected_expenses") or 0)), Decimal("0"))
        if expenses > income:
            lines.append(
                f"Month {point.get('month')}: projected expenses exceed projected income by "
                f"{_amount(expenses - income)}. Review the cash reserved for taxes."
            )
    if not lines:
        return []
    description = (
        f"What happened: the latest model forecast shows {len(lines)} month(s) with a projected loss.\n"
        "Origin: B) ML forecast (rule A1 of the plan alert rules).\n"
        "Figures: " + " ".join(lines) + "\n"
        f"Model version {run.model_version or 'no version'}; the typical model error is about 10-12 % of a "
        "month's income, so a small projected gap may not be a real loss.\n"
        "What to check: confirm the expected expenses and income for those months and the tax reserve. "
        "This alert is a planning notice, not a prediction of penalties.\n"
        "Screen: Forecasts."
    )
    return [_upsert(company_id, LOSS_MONTH_TITLE, "proyeccion", "media", description)]


def evaluate_alerts(company_id: int) -> dict:
    """Run the rules and deduplicate by title + origin + open status."""
    outcomes: list[tuple[str, Alert]] = []
    outcomes.extend(_rule_reserve(company_id))
    outcomes.extend(_rule_obligations(company_id))
    outcomes.extend(_rule_expenses(company_id))
    outcomes.extend(_rule_stale_forecast(company_id))
    outcomes.extend(_rule_forecast_vs_plan(company_id))
    outcomes.extend(_rule_loss_month(company_id))
    db.session.flush()
    record_audit(
        company_id,
        "alert.evaluate",
        "alerts",
        {
            "created": sum(1 for action, _ in outcomes if action == "created"),
            "updated": sum(1 for action, _ in outcomes if action == "updated"),
        },
    )
    return {
        "created": sum(1 for action, _ in outcomes if action == "created"),
        "updated": sum(1 for action, _ in outcomes if action == "updated"),
        "items": [
            {
                "id": row.id,
                "title": row.title,
                "origin": row.origin,
                "priority": row.priority,
                "status": row.status,
                "action": alert_action(row),
            }
            for _, row in outcomes
        ],
    }


def alert_action(row: Alert) -> dict:
    """Suggested direct action for an alert, derived from its origin and title. Screen ids are codes."""
    title = (row.title or "").lower()
    if "obligation" in title:
        return {"label": "View obligation", "screen": "obligaciones"}
    if "expense" in title:
        return {"label": "Review expense", "screen": "gastos"}
    if row.origin == "proyeccion" or "forecast" in title:
        return {"label": "Review forecast", "screen": "proyecciones"}
    if row.origin in ("plan", "configuracion") or "plan" in title:
        return {"label": "Open plan", "screen": "planificacion"}
    return {"label": "View alert", "screen": "alertas"}
