from flask import Blueprint, g, jsonify, request

from ...common.http import (
    audit_dict,
    authorized_company,
    date_iso,
    error,
    get_json,
    iso,
    money,
    paginated,
    pagination,
    parse_date,
    parse_money,
    record_audit,
)
from ...extensions import db
from ...models import AuditEvent, TaxObligation, User

tracking_bp = Blueprint("tracking", __name__, url_prefix="/api/v1/companies/<int:company_id>")


def _obligation_dict(row: TaxObligation) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "period": row.period,
        "due_date": date_iso(row.due_date),
        "estimated_amount": money(row.estimated_amount) if row.estimated_amount is not None else None,
        "status": row.status,
        "notes": row.notes,
    }


@tracking_bp.get("/obligations")
def list_obligations(company_id: int):
    authorized_company(company_id)
    q = db.session.query(TaxObligation).filter(TaxObligation.company_id == company_id)
    status = request.args.get("status")
    if status:
        q = q.filter(TaxObligation.status == status)
    rows = q.order_by(TaxObligation.due_date.asc()).all()
    return jsonify({"items": [_obligation_dict(r) for r in rows]})


@tracking_bp.post("/obligations")
def create_obligation(company_id: int):
    authorized_company(company_id, min_role="contador")
    data = get_json()
    name = str(data.get("name", "")).strip()
    if not name:
        return error("invalid_payload", "name is required", 422)
    due_date = parse_date(str(data.get("due_date", "")))
    if due_date is None:
        return error("invalid_payload", "Invalid due_date (YYYY-MM-DD)", 422)
    try:
        estimated = (
            parse_money(data.get("estimated_amount"), "estimated_amount")
            if data.get("estimated_amount") not in (None, "")
            else None
        )
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)

    row = TaxObligation(
        company_id=company_id,
        name=name[:160],
        period=str(data.get("period", ""))[:40],
        due_date=due_date,
        estimated_amount=estimated,
        status="pending",
        notes=str(data.get("notes", ""))[:2000],
    )
    db.session.add(row)
    db.session.flush()
    record_audit(company_id, "obligation.create", f"obligation:{row.id}")
    return jsonify(_obligation_dict(row)), 201


@tracking_bp.patch("/obligations/<int:obligation_id>")
def update_obligation(company_id: int, obligation_id: int):
    authorized_company(company_id, min_role="contador")
    row = db.session.get(TaxObligation, obligation_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Obligation not found", 404)
    data = get_json()
    if "status" in data:
        if data["status"] not in ("pending", "filed", "paid", "void"):
            return error("invalid_payload", "Invalid status", 422)
        row.status = data["status"]
    if "notes" in data:
        row.notes = str(data["notes"])[:2000]
    if "estimated_amount" in data:
        try:
            row.estimated_amount = (
                parse_money(data["estimated_amount"], "estimated_amount")
                if data["estimated_amount"] not in (None, "")
                else None
            )
        except ValueError as exc:
            return error("invalid_payload", str(exc), 422)
    record_audit(company_id, "obligation.update", f"obligation:{row.id}", {"status": row.status})
    return jsonify(_obligation_dict(row))


@tracking_bp.get("/audit")
def list_audit(company_id: int):
    authorized_company(company_id, min_role="contador")
    page, size = pagination()
    q = db.session.query(AuditEvent).filter(AuditEvent.company_id == company_id)
    total = q.count()
    rows = (
        q.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(size)
        .offset((page - 1) * size)
        .all()
    )
    actor_ids = {r.actor_id for r in rows if r.actor_id is not None}
    names = (
        {u.id: u.full_name for u in db.session.query(User).filter(User.id.in_(actor_ids)).all()}
        if actor_ids
        else {}
    )
    return paginated([audit_dict(r, names) for r in rows], total, page, size)
