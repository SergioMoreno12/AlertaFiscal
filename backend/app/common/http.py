"""Utilidades HTTP compartidas: autorización por empresa, paginación y auditoría."""
from datetime import datetime, timezone
from decimal import Decimal

from flask import current_app, g, jsonify, request

from ..extensions import db
from ..models import AuditEvent, Company, CompanyMembership, utcnow
from ..security import membership_for

ROLE_RANK = {"auxiliar": 1, "contador": 2, "admin": 3}


def error(code: str, message: str, status: int = 400, details=None):
    body = {"error": {"code": code, "message": message, "request_id": getattr(g, "request_id", None)}}
    if details:
        body["error"]["details"] = details
    return jsonify(body), status


def get_json() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def money(value) -> str:
    """Los importes viajan como cadenas decimales para no perder precisión."""
    if value is None:
        return "0.00"
    return f"{Decimal(str(value)):.2f}"


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def date_iso(value: datetime | None) -> str | None:
    """Fechas de calendario (emisión, vencimiento, corte) sin hora ni zona.

    Si se serializaran como medianoche UTC, un cliente en Colombia (UTC-5)
    las mostraría un día antes. El día es el dato, no un instante.
    """
    if value is None:
        return None
    return value.date().isoformat()


def parse_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw[:19], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_money(raw, field: str):
    if raw is None or raw == "":
        return Decimal("0")
    try:
        value = Decimal(str(raw)).quantize(Decimal("0.01"))
    except Exception:
        raise ValueError(f"{field} debe ser un número válido")
    if value < 0:
        raise ValueError(f"{field} no puede ser negativo")
    return value


def authorized_company(company_id: int, min_role: str | None = None) -> Company:
    """Verifica autenticación, membresía activa y rol. Denegación por defecto."""
    company = db.session.get(Company, company_id)
    if company is None or not company.is_active:
        raise PermissionError("not_found")
    membership = membership_for(company_id)
    if membership is None:
        raise PermissionError("forbidden")
    if min_role and ROLE_RANK.get(membership.role, 0) < ROLE_RANK[min_role]:
        raise PermissionError("forbidden")
    g.membership = membership
    return company


def pagination():
    page = max(int(request.args.get("page", 1) or 1), 1)
    size = int(request.args.get("page_size", current_app.config["DEFAULT_PAGE_SIZE"]) or 20)
    size = max(1, min(size, current_app.config["MAX_PAGE_SIZE"]))
    return page, size


def paginated(items, total: int, page: int, size: int):
    return jsonify(
        {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": size,
                "total": total,
                "pages": max((total + size - 1) // size, 1),
            },
        }
    )


def record_audit(company_id: int | None, action: str, resource: str = "", detail: dict | None = None):
    user = getattr(g, "current_user", None)
    db.session.add(
        AuditEvent(
            company_id=company_id,
            actor_id=getattr(user, "id", None),
            action=action,
            resource=resource[:80],
            detail=detail or {},
            request_id=getattr(g, "request_id", None),
            created_at=utcnow(),
        )
    )


def audit_dict(event: AuditEvent) -> dict:
    return {
        "id": event.id,
        "action": event.action,
        "resource": event.resource,
        "detail": event.detail or {},
        "actor_id": event.actor_id,
        "request_id": event.request_id,
        "created_at": iso(event.created_at),
    }
