from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from ...common.http import authorized_company, date_iso, error, iso, money, parse_date, record_audit
from ...extensions import db
from ...models import (
    Alert,
    ExpenseDocument,
    FiscalPlan,
    FiscalPlanVersion,
    ForecastRun,
    IncomeDocument,
    ReserveEntry,
    TaxObligation,
)
from ..alerts.rules import ORIGIN_LABEL, PRIORITY_ORDER, alert_action
from ..planning.forecasting import forecast_run_dict, latest_forecast

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/v1/companies/<int:company_id>/dashboard")


@dashboard_bp.get("")
def summary(company_id: int):
    authorized_company(company_id)
    period_start = parse_date(request.args.get("from")) or datetime(
        datetime.now(timezone.utc).year, 1, 1, tzinfo=timezone.utc
    )
    period_end = parse_date(request.args.get("to")) or datetime.now(timezone.utc)

    def total(model, status_filter=None):
        q = db.session.query(func.coalesce(func.sum(model.total), 0)).filter(
            model.company_id == company_id,
            model.issue_date >= period_start,
            model.issue_date <= period_end,
        )
        if status_filter:
            q = q.filter(model.status.in_(status_filter))
        return q.scalar() or 0

    income_total = total(IncomeDocument, ("pending", "collected"))
    expense_total = total(ExpenseDocument, ("pending", "paid"))
    pending_income = total(IncomeDocument, ("pending",))
    pending_expense = total(ExpenseDocument, ("pending",))

    # Monthly series of the last 6 months (aggregated in SQL).
    six_months_ago = (datetime.now(timezone.utc).replace(day=1) - timedelta(days=155)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    month_expr_income = func.strftime("%Y-%m", IncomeDocument.issue_date) if _is_sqlite() else func.to_char(
        IncomeDocument.issue_date, "YYYY-MM"
    )
    month_expr_expense = func.strftime("%Y-%m", ExpenseDocument.issue_date) if _is_sqlite() else func.to_char(
        ExpenseDocument.issue_date, "YYYY-MM"
    )

    income_rows = (
        db.session.query(month_expr_income.label("month"), func.sum(IncomeDocument.total))
        .filter(
            IncomeDocument.company_id == company_id,
            IncomeDocument.issue_date >= six_months_ago,
            IncomeDocument.status != "void",
        )
        .group_by(month_expr_income)
        .all()
    )
    expense_rows = (
        db.session.query(month_expr_expense.label("month"), func.sum(ExpenseDocument.total))
        .filter(
            ExpenseDocument.company_id == company_id,
            ExpenseDocument.issue_date >= six_months_ago,
            ExpenseDocument.status != "void",
        )
        .group_by(month_expr_expense)
        .all()
    )
    series_map: dict[str, dict] = {}
    for month, amount in income_rows:
        series_map.setdefault(month, {"month": month, "income": "0.00", "expenses": "0.00"})["income"] = money(amount)
    for month, amount in expense_rows:
        series_map.setdefault(month, {"month": month, "income": "0.00", "expenses": "0.00"})["expenses"] = money(amount)
    monthly = [series_map[k] for k in sorted(series_map)]

    upcoming = (
        db.session.query(TaxObligation)
        .filter(TaxObligation.company_id == company_id, TaxObligation.status.in_(("pending", "filed")))
        .order_by(TaxObligation.due_date.asc())
        .limit(5)
        .all()
    )
    open_alerts = (
        db.session.query(func.count(Alert.id))
        .filter(Alert.company_id == company_id, Alert.status != "reviewed")
        .scalar()
        or 0
    )

    plan = (
        db.session.query(FiscalPlan)
        .filter(FiscalPlan.company_id == company_id, FiscalPlan.status != "archived")
        .order_by(FiscalPlan.updated_at.desc())
        .first()
    )
    plan_version = None
    if plan is not None:
        plan_version = (
            db.session.query(FiscalPlanVersion)
            .filter(FiscalPlanVersion.plan_id == plan.id)
            .order_by(FiscalPlanVersion.version.desc())
            .first()
        )
    reserved = (
        db.session.query(func.coalesce(func.sum(ReserveEntry.amount), 0))
        .filter(ReserveEntry.company_id == company_id)
        .scalar()
        or 0
    )

    meta = Decimal(str(plan_version.estimated_reserve)) if plan_version is not None else Decimal("0")
    reserved_amount = Decimal(str(reserved))
    pending_reserve = max(meta - reserved_amount, Decimal("0"))
    coverage = (reserved_amount / meta * Decimal("100")) if meta > 0 else Decimal("0")

    run = latest_forecast(company_id)
    latest = forecast_run_dict(run) if run is not None else None
    if latest is not None:
        latest = {
            "id": latest["id"],
            "method": latest["method"],
            "method_label": latest["method_label"],
            "horizon_months": latest["horizon_months"],
            "cutoff_date": latest["cutoff_date"],
            "projected_income": latest["projected_income"],
            "projected_expenses": latest["projected_expenses"],
            "projected_result": latest["projected_result"],
            "model_version": latest["model_version"],
            "created_at": latest["created_at"],
            "trained_at": latest["trained_at"],
            "stale_inputs": latest["stale_inputs"],
            "is_demo": latest["is_demo"],
            "monthly": latest["monthly"],
            "models": latest["models"],
        }

    # "What to check now" is built only from alerts already stored by
    # POST /alerts/evaluate. This GET never writes or recomputes alerts.
    open_rows = (
        db.session.query(Alert)
        .filter(Alert.company_id == company_id, Alert.status != "reviewed")
        .order_by(Alert.created_at.desc())
        .limit(20)
        .all()
    )
    # sorted() is stable: within the same priority it keeps the descending
    # date order returned by the query.
    open_rows = sorted(open_rows, key=lambda row: PRIORITY_ORDER.get(row.priority, 9))
    review_now = [
        {
            "id": row.id,
            "title": row.title,
            "priority": row.priority,
            "origin": row.origin,
            "origin_label": ORIGIN_LABEL.get(row.origin, row.origin),
            "status": row.status,
            "action": alert_action(row),
        }
        for row in open_rows[:5]
    ]

    return jsonify(
        {
            "period": {"from": iso(period_start), "to": iso(period_end)},
            "totals": {
                "income": money(income_total),
                "expenses": money(expense_total),
                "result": money(income_total - expense_total),
                "pending_income": money(pending_income),
                "pending_expenses": money(pending_expense),
            },
            "monthly": monthly,
            "alerts": {"open": open_alerts},
            "obligations": [
                {
                    "id": o.id,
                    "name": o.name,
                    "period": o.period,
                    "due_date": date_iso(o.due_date),
                    "status": o.status,
                    "estimated_amount": money(o.estimated_amount) if o.estimated_amount is not None else None,
                }
                for o in upcoming
            ],
            "latest_forecast": latest,
            "reserve": {
                "target": money(meta),
                "reserved": money(reserved_amount),
                "pending": money(pending_reserve),
                "coverage_percent": f"{coverage:.1f}",
                "has_target": meta > 0,
                "plan_period": plan.period if plan is not None else None,
            },
            "review_now": review_now,
            "plan": None
            if plan is None or plan_version is None
            else {
                "id": plan.id,
                "name": plan.name,
                "period": plan.period,
                "version": plan_version.version,
                "status": plan_version.status,
                "projected_income": money(plan_version.projected_income),
                "projected_expenses": money(plan_version.projected_expenses),
                "estimated_reserve": money(plan_version.estimated_reserve),
                "reserved": money(reserved_amount),
                "coverage_percent": f"{coverage:.1f}",
            },
        }
    )


def _is_sqlite() -> bool:
    return db.engine.url.get_backend_name() == "sqlite"
