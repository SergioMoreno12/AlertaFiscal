"""Reglas deterministas de alertas y evaluación bajo demanda.

Orígenes:
- A) ERP / reglas: documentos, obligaciones, plan y reservas registradas.
- B) Proyección ML: corridas del modelo entrenado offline.

Las reglas no predicen sanciones ni prometen ahorros. Cada alerta explica qué
ocurrió, su origen, las cifras, qué revisar y en qué pantalla hacerlo. La
evaluación se ejecuta solo con una acción explícita del usuario (POST), nunca
desde un GET del dashboard.
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

PRIORITY_ORDER = {"alta": 0, "media": 1, "baja": 2}
ORIGIN_LABEL = {
    "erp": "A) ERP / reglas",
    "plan": "A) ERP / reglas (plan)",
    "configuracion": "A) ERP / reglas (configuración)",
    "proyeccion": "B) Proyección ML",
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
            "Qué ocurrió: el plan vigente no tiene una meta de reserva definida.\n"
            "Origen: A) ERP / reglas (plan y reservas registradas).\n"
            f"Cifras: meta de reserva {_amount(0)}; reserva registrada {_amount(reserved)}.\n"
            "Qué revisar: define la meta en el plan y confirma si la reserva actual es suficiente.\n"
            f"Pantalla: Planificación fiscal → Plan de reserva (período {plan.period})."
        )
        return [
            _upsert(
                company_id,
                "Meta de reserva pendiente de definir",
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
        "Qué ocurrió: la reserva registrada no cubre la meta del plan vigente.\n"
        "Origen: A) ERP / reglas (meta del plan y reservas registradas).\n"
        f"Cifras: meta {_amount(target)}; reserva registrada {_amount(reserved)}; "
        f"diferencia pendiente {_amount(pending)}; cobertura {coverage:.1f}%.\n"
        "Qué revisar: confirma la meta y registra la reserva faltante si corresponde. "
        "La meta es una decisión de planificación, no un impuesto liquidado.\n"
        f"Pantalla: Planificación fiscal → Plan de reserva (período {plan.period})."
    )
    return [
        _upsert(
            company_id,
            "Reserva por debajo de la meta del plan",
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
            title = f"Obligación vencida: {obligation.name} · {due.isoformat()}"
            priority = "alta"
            situation = f"la obligación venció hace {abs(days)} día(s)."
        else:
            title = f"Obligación próxima: {obligation.name} · {due.isoformat()}"
            priority = "alta" if days <= 3 else "media"
            situation = f"la obligación vence en {days} día(s)."

        amount = (
            _amount(obligation.estimated_amount)
            if obligation.estimated_amount is not None
            else "sin valor definido (cero no confirmado)"
        )
        description = (
            f"Qué ocurrió: {situation}\n"
            "Origen: A) ERP / reglas (obligaciones registradas manualmente).\n"
            f"Cifras: período {obligation.period or 'sin definir'}; vencimiento {due.isoformat()}; "
            f"valor estimado {amount}.\n"
            "Qué revisar: confirma la fecha, el valor y el estado de presentación con el contador. "
            "Esta alerta no calcula sanciones ni intereses.\n"
            "Pantalla: Obligaciones."
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
        "Qué ocurrió: hay gastos registrados que aún no han sido revisados.\n"
        "Origen: A) ERP / reglas (documentos de gasto).\n"
        f"Cifras: {int(count)} documento(s); total {_amount(total)}.\n"
        "Qué revisar: confirma categoría, soporte y valor de cada gasto antes de usarlo en la planificación. "
        "Revisar un gasto no cambia por sí solo la reserva ni el plan.\n"
        "Pantalla: Gastos."
    )
    return [
        _upsert(
            company_id,
            "Gastos pendientes de revisión",
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
        "Qué ocurrió: los ingresos o gastos del ERP cambiaron después de la última proyección del modelo.\n"
        "Origen: B) Proyección ML (firma del historial de entradas).\n"
        f"Cifras: historial usado por la corrida hasta {assumptions.get('history_period', {}).get('to', 'sin fecha')}; "
        f"historial actual hasta {current['months'][-1]}; versión del modelo {run.model_version or 'sin versión'}.\n"
        "Qué revisar: genera una nueva proyección para que el pronóstico use las entradas actuales. "
        "La corrida anterior se conserva en el historial.\n"
        "Pantalla: Proyecciones."
    )
    return [
        _upsert(
            company_id,
            "Proyección desactualizada por cambios en las entradas",
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
        # Sin período comparable no se inventa una comparación.
        return []

    threshold = Decimal(str(current_app.config["FORECAST_PLAN_DIFF_PCT"]))
    concepts = []
    relevant = False
    max_pct = Decimal("0")

    for key, label, plan_value in (
        ("projected_income", "ingresos", Decimal(str(version.projected_income or 0))),
        ("projected_expenses", "gastos", Decimal(str(version.projected_expenses or 0))),
    ):
        forecast_value = Decimal(str(point.get(key) or 0))
        if plan_value == 0 and forecast_value == 0:
            concepts.append(f"{label}: plan en cero y proyección en cero (sin diferencia).")
            continue
        if plan_value == 0:
            relevant = True
            concepts.append(
                f"{label}: plan en cero explícito; proyección {_amount(forecast_value)}. "
                "La diferencia porcentual no se calcula sobre cero."
            )
            continue
        difference = abs(forecast_value - plan_value)
        pct = difference / plan_value * Decimal("100")
        max_pct = max(max_pct, pct)
        if pct >= threshold:
            relevant = True
        concepts.append(
            f"{label}: plan {_amount(plan_value)}; proyección {_amount(forecast_value)}; "
            f"diferencia {_amount(difference)} ({pct:.1f}%)."
        )

    if not relevant:
        return []

    priority = "alta" if max_pct >= threshold * 2 else "media"
    description = (
        f"Qué ocurrió: la proyección del modelo difiere del plan para el mismo período ({plan.period}).\n"
        "Origen: B) Proyección ML comparada con A) ERP / plan.\n"
        f"Cifras: umbral configurado {threshold:.0f}%. " + " ".join(concepts) + "\n"
        "Qué revisar: decide si el plan debe actualizarse o si la proyección requiere revisar sus entradas. "
        "Ingresos menos gastos no es un impuesto ni una reserva obligatoria.\n"
        "Pantalla: Proyecciones y Planificación fiscal."
    )
    return [
        _upsert(
            company_id,
            f"Diferencia entre proyección y plan para {plan.period}",
            "proyeccion",
            priority,
            description,
        )
    ]


def evaluate_alerts(company_id: int) -> dict:
    """Ejecuta las reglas y deduplica por título + origen + estado abierto."""
    outcomes: list[tuple[str, Alert]] = []
    outcomes.extend(_rule_reserve(company_id))
    outcomes.extend(_rule_obligations(company_id))
    outcomes.extend(_rule_expenses(company_id))
    outcomes.extend(_rule_stale_forecast(company_id))
    outcomes.extend(_rule_forecast_vs_plan(company_id))
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
    """Acción directa sugerida para una alerta, derivada de su origen/título."""
    title = (row.title or "").lower()
    if "obligación" in title or "obligacion" in title:
        return {"label": "Ver obligación", "screen": "obligaciones"}
    if "gasto" in title:
        return {"label": "Revisar gasto", "screen": "gastos"}
    if row.origin == "proyeccion" or "proyección" in title or "proyeccion" in title:
        return {"label": "Revisar proyección", "screen": "proyecciones"}
    if row.origin in ("plan", "configuracion") or "plan" in title:
        return {"label": "Abrir plan", "screen": "planificacion"}
    return {"label": "Ver alerta", "screen": "alertas"}
