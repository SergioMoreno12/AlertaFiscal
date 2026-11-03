from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from ...common.http import (
    authorized_company,
    error,
    get_json,
    iso,
    money,
    parse_date,
    parse_money,
    record_audit,
)
from ...extensions import db
from ...models import (
    ExpenseDocument,
    FiscalParameter,
    FiscalPlan,
    FiscalPlanVersion,
    ForecastRun,
    IncomeDocument,
    ReserveEntry,
)
from .forecasting import ForecastUnavailable, forecast_run_dict, run_model_forecast

planning_bp = Blueprint("planning", __name__, url_prefix="/api/v1/companies/<int:company_id>")


def _plan_dict(plan: FiscalPlan, version: FiscalPlanVersion | None = None) -> dict:
    data = {
        "id": plan.id,
        "name": plan.name,
        "period": plan.period,
        "status": plan.status,
        "current_version": plan.current_version,
        "created_at": iso(plan.created_at),
    }
    if version is not None:
        data["version"] = {
            "id": version.id,
            "version": version.version,
            "status": version.status,
            "assumptions": version.assumptions or {},
            "projected_income": money(version.projected_income),
            "projected_expenses": money(version.projected_expenses),
            "estimated_reserve": money(version.estimated_reserve),
            "notes": version.notes,
            "created_at": iso(version.created_at),
        }
    return data


# ─────────────────── Parámetros fiscales ───────────────────


@planning_bp.get("/fiscal-parameters")
def list_parameters(company_id: int):
    authorized_company(company_id)
    rows = (
        db.session.query(FiscalParameter)
        .filter_by(company_id=company_id)
        .order_by(FiscalParameter.label.asc())
        .all()
    )
    return jsonify(
        {
            "items": [
                {
                    "id": p.id,
                    "key": p.key,
                    "label": p.label,
                    "value": f"{Decimal(str(p.value)):.4f}",
                    "unit": p.unit,
                    "source": p.source,
                    "reviewed": p.reviewed,
                    "valid_from": iso(p.valid_from),
                    "valid_to": iso(p.valid_to),
                }
                for p in rows
            ]
        }
    )


@planning_bp.post("/fiscal-parameters")
def upsert_parameter(company_id: int):
    authorized_company(company_id, min_role="contador")
    data = get_json()
    key = str(data.get("key", "")).strip()
    label = str(data.get("label", "")).strip()
    if not key or not label:
        return error("invalid_payload", "key y label son obligatorios", 422)
    try:
        value = Decimal(str(data.get("value", "0"))).quantize(Decimal("0.0001"))
    except Exception:
        return error("invalid_payload", "value inválido", 422)
    unit = str(data.get("unit", "percent"))
    if unit not in ("percent", "cop", "months", "count"):
        return error("invalid_payload", "unit inválido", 422)

    row = db.session.query(FiscalParameter).filter_by(company_id=company_id, key=key).first()
    if row is None:
        row = FiscalParameter(company_id=company_id, key=key, label=label, value=value, unit=unit)
        db.session.add(row)
    else:
        row.label = label
        row.value = value
        row.unit = unit
        row.reviewed = False

    row.source = str(data.get("source", ""))[:255]
    row.reviewed = bool(data.get("reviewed", False))
    row.valid_from = parse_date(str(data.get("valid_from", ""))) if data.get("valid_from") else row.valid_from
    row.valid_to = parse_date(str(data.get("valid_to", ""))) if data.get("valid_to") else row.valid_to
    db.session.flush()
    record_audit(company_id, "parameter.upsert", f"parameter:{row.id}", {"key": key})
    return jsonify({"id": row.id, "key": row.key, "label": row.label, "value": f"{value:.4f}"}), 201


# ─────────────────── Planes y versiones ───────────────────


@planning_bp.get("/plans")
def list_plans(company_id: int):
    authorized_company(company_id)
    rows = (
        db.session.query(FiscalPlan)
        .filter_by(company_id=company_id)
        .order_by(FiscalPlan.created_at.desc())
        .all()
    )
    return jsonify({"items": [_plan_dict(p) for p in rows]})


@planning_bp.post("/plans")
def create_plan(company_id: int):
    authorized_company(company_id, min_role="contador")
    data = get_json()
    name = str(data.get("name", "")).strip() or "Plan fiscal"
    period = str(data.get("period", "")).strip() or datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        projected_income = parse_money(data.get("projected_income"), "projected_income")
        projected_expenses = parse_money(data.get("projected_expenses"), "projected_expenses")
        estimated_reserve = (
            parse_money(data.get("estimated_reserve"), "estimated_reserve")
            if data.get("estimated_reserve") not in (None, "")
            else Decimal("0")
        )
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)
    if estimated_reserve < 0:
        return error("invalid_payload", "estimated_reserve no puede ser negativo", 422)

    plan = FiscalPlan(
        company_id=company_id,
        name=name[:160],
        period=period[:40],
        status="draft",
        current_version=1,
        created_by=g.current_user.id,
    )
    db.session.add(plan)
    db.session.flush()

    version = FiscalPlanVersion(
        plan_id=plan.id,
        company_id=company_id,
        version=1,
        status="draft",
        assumptions=data.get("assumptions") if isinstance(data.get("assumptions"), dict) else {},
        projected_income=projected_income,
        projected_expenses=projected_expenses,
        estimated_reserve=estimated_reserve,
        notes=str(data.get("notes", ""))[:2000],
        created_by=g.current_user.id,
    )
    db.session.add(version)
    db.session.flush()
    record_audit(company_id, "plan.create", f"plan:{plan.id}", {"version": 1})
    return jsonify(_plan_dict(plan, version)), 201


@planning_bp.get("/plans/<int:plan_id>")
def plan_detail(company_id: int, plan_id: int):
    authorized_company(company_id)
    plan = db.session.get(FiscalPlan, plan_id)
    if plan is None or plan.company_id != company_id:
        return error("not_found", "Plan no encontrado", 404)
    versions = (
        db.session.query(FiscalPlanVersion)
        .filter_by(plan_id=plan.id)
        .order_by(FiscalPlanVersion.version.desc())
        .all()
    )
    data = _plan_dict(plan)
    data["versions"] = [
        {
            "id": v.id,
            "version": v.version,
            "status": v.status,
            "assumptions": v.assumptions or {},
            "projected_income": money(v.projected_income),
            "projected_expenses": money(v.projected_expenses),
            "estimated_reserve": money(v.estimated_reserve),
            "notes": v.notes,
            "created_at": iso(v.created_at),
        }
        for v in versions
    ]
    return jsonify(data)


@planning_bp.post("/plans/<int:plan_id>/versions")
def create_version(company_id: int, plan_id: int):
    authorized_company(company_id, min_role="contador")
    plan = db.session.get(FiscalPlan, plan_id)
    if plan is None or plan.company_id != company_id:
        return error("not_found", "Plan no encontrado", 404)

    data = get_json()
    try:
        projected_income = parse_money(data.get("projected_income"), "projected_income")
        projected_expenses = parse_money(data.get("projected_expenses"), "projected_expenses")
        estimated_reserve = (
            parse_money(data.get("estimated_reserve"), "estimated_reserve")
            if data.get("estimated_reserve") not in (None, "")
            else Decimal("0")
        )
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)
    if estimated_reserve < 0:
        return error("invalid_payload", "estimated_reserve no puede ser negativo", 422)

    latest = (
        db.session.query(func.max(FiscalPlanVersion.version)).filter_by(plan_id=plan.id).scalar() or 0
    )
    version = FiscalPlanVersion(
        plan_id=plan.id,
        company_id=company_id,
        version=latest + 1,
        status="draft",
        assumptions=data.get("assumptions") if isinstance(data.get("assumptions"), dict) else {},
        projected_income=projected_income,
        projected_expenses=projected_expenses,
        estimated_reserve=estimated_reserve,
        notes=str(data.get("notes", ""))[:2000],
        created_by=g.current_user.id,
    )
    db.session.add(version)
    plan.current_version = version.version
    plan.status = "draft"
    db.session.flush()
    record_audit(company_id, "plan.version_create", f"plan:{plan.id}", {"version": version.version})
    return jsonify(_plan_dict(plan, version)), 201


@planning_bp.post("/plans/<int:plan_id>/versions/<int:version_id>/review")
def review_version(company_id: int, plan_id: int, version_id: int):
    """Marca una versión como revisada. Una vez revisada es inmutable."""
    authorized_company(company_id, min_role="contador")
    plan = db.session.get(FiscalPlan, plan_id)
    version = db.session.get(FiscalPlanVersion, version_id)
    if plan is None or version is None or plan.company_id != company_id or version.plan_id != plan.id:
        return error("not_found", "Versión no encontrada", 404)
    if version.status == "reviewed":
        return error("invalid_state", "La versión ya está revisada", 409)

    version.status = "reviewed"
    plan.status = "reviewed"
    record_audit(company_id, "plan.review", f"plan:{plan.id}", {"version": version.version})
    return jsonify(_plan_dict(plan, version))


# ─────────────────── Reservas ───────────────────


@planning_bp.get("/reserve-entries")
def list_reserves(company_id: int):
    authorized_company(company_id)
    rows = (
        db.session.query(ReserveEntry)
        .filter_by(company_id=company_id)
        .order_by(ReserveEntry.reserved_on.desc())
        .all()
    )
    return jsonify(
        {
            "items": [
                {
                    "id": r.id,
                    "amount": money(r.amount),
                    "reserved_on": iso(r.reserved_on),
                    "note": r.note,
                    "plan_version_id": r.plan_version_id,
                }
                for r in rows
            ],
            "total": money(sum((r.amount for r in rows), Decimal("0"))),
        }
    )


@planning_bp.post("/reserve-entries")
def create_reserve(company_id: int):
    authorized_company(company_id, min_role="contador")
    data = get_json()
    try:
        amount = parse_money(data.get("amount"), "amount")
        if amount <= 0:
            raise ValueError("amount debe ser mayor que cero")
        reserved_on = parse_date(str(data.get("reserved_on", ""))) or datetime.now(timezone.utc)
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)

    version_id = data.get("plan_version_id")
    if version_id not in (None, ""):
        version = db.session.get(FiscalPlanVersion, int(version_id))
        if version is None or version.company_id != company_id:
            return error("invalid_payload", "plan_version_id no pertenece a la empresa", 422)
        version_id = version.id
    else:
        version_id = None

    row = ReserveEntry(
        company_id=company_id,
        plan_version_id=version_id,
        amount=amount,
        reserved_on=reserved_on,
        note=str(data.get("note", ""))[:255],
        created_by=g.current_user.id,
    )
    db.session.add(row)
    db.session.flush()
    record_audit(company_id, "reserve.create", f"reserve:{row.id}", {"amount": money(amount)})
    return jsonify({"id": row.id, "amount": money(row.amount), "reserved_on": iso(row.reserved_on)}), 201


# ─────────────────── Proyecciones ───────────────────


@planning_bp.get("/forecasts")
def list_forecasts(company_id: int):
    authorized_company(company_id)
    rows = (
        db.session.query(ForecastRun)
        .filter_by(company_id=company_id)
        .order_by(ForecastRun.created_at.desc())
        .limit(20)
        .all()
    )
    # Mismo contrato que la creación: el detalle vive en ``assumptions`` y la
    # UI lo necesita al recargar la última corrida. ``forecast_run_dict`` usa
    # ``.get`` con valores por defecto, así que soporta corridas manuales y
    # antiguas sin metadatos ML.
    return jsonify({"items": [forecast_run_dict(f) for f in rows]})


@planning_bp.post("/forecasts/model")
def create_model_forecast(company_id: int):
    """Ejecuta el modelo entrenado offline sobre el historial actual.

    No entrena ni simula: lee el artefacto JSON de la empresa, valida las
    entradas y persiste la corrida con su versión y supuestos. Si falta el
    modelo o el historial, responde con un error explícito y deja disponible
    la planificación manual.
    """
    authorized_company(company_id, min_role="contador")
    data = get_json()
    try:
        horizon = int(data.get("horizon_months", 3) or 3)
    except (TypeError, ValueError):
        return error("invalid_payload", "horizon_months debe ser un entero", 422)
    horizon = max(1, min(horizon, 12))

    try:
        result = run_model_forecast(company_id, horizon)
    except ForecastUnavailable as exc:
        return (
            jsonify(
                {
                    "available": False,
                    "code": exc.code,
                    "reason": exc.message,
                    "manual_available": True,
                    "details": exc.details,
                }
            ),
            200,
        )
    return jsonify(result), 201


@planning_bp.post("/forecasts")
def create_forecast(company_id: int):
    """Proyección manual basada en el promedio de los últimos meses.

    No es un modelo de ML: es el modo de planificación manual que debe
    funcionar aunque no exista un artefacto entrenado.
    """
    authorized_company(company_id, min_role="contador")
    data = get_json()
    horizon = int(data.get("horizon_months", 3) or 3)
    horizon = max(1, min(horizon, 12))
    lookback = int(data.get("lookback_months", 6) or 6)
    lookback = max(1, min(lookback, 24))

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=31 * lookback)

    income_months = (
        db.session.query(func.count(func.distinct(func.strftime("%Y-%m", IncomeDocument.issue_date))))
        if db.engine.url.get_backend_name() == "sqlite"
        else db.session.query(func.count(func.distinct(func.to_char(IncomeDocument.issue_date, "YYYY-MM"))))
    )
    months_with_income = income_months.filter(
        IncomeDocument.company_id == company_id, IncomeDocument.issue_date >= start
    ).scalar() or 0

    if months_with_income < 3:
        return (
            jsonify(
                {
                    "available": False,
                    "reason": "Historial insuficiente (se requieren al menos 3 meses con registros).",
                    "months_with_history": months_with_income,
                }
            ),
            200,
        )

    avg_income = (
        db.session.query(func.coalesce(func.sum(IncomeDocument.total), 0)).filter(
            IncomeDocument.company_id == company_id,
            IncomeDocument.issue_date >= start,
            IncomeDocument.status != "void",
        ).scalar()
        or 0
    ) / months_with_income
    avg_expense = (
        db.session.query(func.coalesce(func.sum(ExpenseDocument.total), 0)).filter(
            ExpenseDocument.company_id == company_id,
            ExpenseDocument.issue_date >= start,
            ExpenseDocument.status != "void",
        ).scalar()
        or 0
    ) / months_with_income

    growth = Decimal(str(data.get("income_growth_percent", "0"))) / Decimal("100")
    expense_growth = Decimal(str(data.get("expense_growth_percent", "0"))) / Decimal("100")

    projected_income = Decimal(str(avg_income)) * horizon * (Decimal("1") + growth)
    projected_expenses = Decimal(str(avg_expense)) * horizon * (Decimal("1") + expense_growth)

    run = ForecastRun(
        company_id=company_id,
        method="manual",
        horizon_months=horizon,
        cutoff_date=now,
        assumptions={
            "lookback_months": lookback,
            "income_growth_percent": str(data.get("income_growth_percent", "0")),
            "expense_growth_percent": str(data.get("expense_growth_percent", "0")),
        },
        projected_income=projected_income.quantize(Decimal("0.01")),
        projected_expenses=projected_expenses.quantize(Decimal("0.01")),
        model_version=None,
        created_by=g.current_user.id,
    )
    db.session.add(run)
    db.session.flush()
    record_audit(company_id, "forecast.create", f"forecast:{run.id}", {"horizon": horizon})
    return (
        jsonify(
            {
                "available": True,
                "id": run.id,
                "method": run.method,
                "horizon_months": horizon,
                "estimated": True,
                "disclaimer": "Estimación orientativa de planificación. No es una liquidación oficial.",
                "projected_income": money(run.projected_income),
                "projected_expenses": money(run.projected_expenses),
                "projected_result": money(run.projected_income - run.projected_expenses),
                "months_with_history": months_with_income,
            }
        ),
        201,
    )
