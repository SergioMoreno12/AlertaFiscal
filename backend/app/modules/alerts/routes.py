from flask import Blueprint, g, jsonify

from ...common.http import audit_dict, authorized_company, date_iso, error, get_json, iso, record_audit
from ...extensions import db
from ...models import Alert, AlertComment
from .rules import ORIGIN_LABEL, alert_action, evaluate_alerts

alerts_bp = Blueprint("alerts", __name__, url_prefix="/api/v1/companies/<int:company_id>/alerts")


def _alert_dict(row: Alert, comments=None) -> dict:
    data = {
        "id": row.id,
        "title": row.title,
        "description": row.description,
        "priority": row.priority,
        "origin": row.origin,
        "origin_label": ORIGIN_LABEL.get(row.origin, row.origin),
        "status": row.status,
        "due_date": date_iso(row.due_date),
        "created_at": iso(row.created_at),
        "action": alert_action(row),
    }
    if comments is not None:
        data["comments"] = [
            {"id": c.id, "body": c.body, "user_id": c.user_id, "created_at": iso(c.created_at)} for c in comments
        ]
    return data


@alerts_bp.get("")
def list_alerts(company_id: int):
    authorized_company(company_id)
    rows = (
        db.session.query(Alert)
        .filter_by(company_id=company_id)
        .order_by(Alert.created_at.desc())
        .all()
    )
    return jsonify({"items": [_alert_dict(r) for r in rows]})


@alerts_bp.post("/evaluate")
def evaluate(company_id: int):
    """Ejecuta las reglas y persiste/actualiza las alertas abiertas.

    Es una acción explícita: el dashboard en GET nunca escribe alertas.
    """
    authorized_company(company_id, min_role="contador")
    result = evaluate_alerts(company_id)
    db.session.commit()
    return jsonify(result)


@alerts_bp.post("")
def create_alert(company_id: int):
    authorized_company(company_id, min_role="contador")
    data = get_json()
    title = str(data.get("title", "")).strip()
    if not title:
        return error("invalid_payload", "title es obligatorio", 422)
    priority = str(data.get("priority", "media"))
    if priority not in ("alta", "media", "baja"):
        return error("invalid_payload", "priority inválida", 422)
    origin = str(data.get("origin", "erp"))
    if origin not in ("erp", "plan", "proyeccion", "configuracion"):
        return error("invalid_payload", "origin inválido", 422)

    row = Alert(
        company_id=company_id,
        title=title[:200],
        description=str(data.get("description", ""))[:2000],
        priority=priority,
        origin=origin,
        status="pending",
        created_by=g.current_user.id,
    )
    db.session.add(row)
    db.session.flush()
    record_audit(company_id, "alert.create", f"alert:{row.id}")
    return jsonify(_alert_dict(row)), 201


@alerts_bp.get("/<int:alert_id>")
def alert_detail(company_id: int, alert_id: int):
    authorized_company(company_id)
    row = db.session.get(Alert, alert_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Alerta no encontrada", 404)
    comments = (
        db.session.query(AlertComment)
        .filter_by(alert_id=alert_id)
        .order_by(AlertComment.created_at.asc())
        .all()
    )
    return jsonify(_alert_dict(row, comments))


@alerts_bp.patch("/<int:alert_id>")
def update_alert(company_id: int, alert_id: int):
    authorized_company(company_id, min_role="contador")
    row = db.session.get(Alert, alert_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Alerta no encontrada", 404)
    data = get_json()
    if "status" in data:
        if data["status"] not in ("pending", "in_review", "reviewed"):
            return error("invalid_payload", "status inválido", 422)
        row.status = data["status"]
    if "priority" in data:
        if data["priority"] not in ("alta", "media", "baja"):
            return error("invalid_payload", "priority inválida", 422)
        row.priority = data["priority"]
    record_audit(company_id, "alert.update", f"alert:{row.id}", {"status": row.status})
    return jsonify(_alert_dict(row))


@alerts_bp.post("/<int:alert_id>/comments")
def add_comment(company_id: int, alert_id: int):
    authorized_company(company_id)
    row = db.session.get(Alert, alert_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Alerta no encontrada", 404)
    data = get_json()
    body = str(data.get("body", "")).strip()
    if not body:
        return error("invalid_payload", "body es obligatorio", 422)
    comment = AlertComment(company_id=company_id, alert_id=alert_id, user_id=g.current_user.id, body=body[:2000])
    db.session.add(comment)
    db.session.flush()
    record_audit(company_id, "alert.comment", f"alert:{alert_id}")
    return jsonify({"id": comment.id, "body": comment.body, "created_at": iso(comment.created_at)}), 201
