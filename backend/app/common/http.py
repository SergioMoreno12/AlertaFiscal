"""Shared HTTP helpers: per-company authorization, pagination and audit."""
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
    """Amounts travel as decimal strings so no precision is lost."""
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
    """Calendar dates (issue, due, cutoff) without time or time zone.

    Serialized as UTC midnight, a client in Colombia (UTC-5) would show
    them one day earlier. The day is the data, not an instant.
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


# Numeric(18, 2) holds up to 16 integer digits; anything larger would fail in the database.
MAX_AMOUNT = Decimal("9999999999999999.99")


def parse_money(raw, field: str):
    if raw is None or raw == "":
        return Decimal("0")
    if isinstance(raw, bool):
        raise ValueError(f"{field} must be a valid number")
    try:
        value = Decimal(str(raw).strip()).quantize(Decimal("0.01"))
    except Exception:
        raise ValueError(f"{field} must be a valid number")
    if not value.is_finite():
        raise ValueError(f"{field} must be a valid number")
    if value < 0:
        raise ValueError(f"{field} cannot be negative")
    if value > MAX_AMOUNT:
        raise ValueError(f"{field} is too large")
    return value


def parse_percent(raw, field: str, minimum: Decimal = Decimal("-100"), maximum: Decimal = Decimal("1000")) -> Decimal:
    """A percentage such as a growth assumption. Empty means zero."""
    if raw is None or raw == "":
        return Decimal("0")
    if isinstance(raw, bool):
        raise ValueError(f"{field} must be a valid number")
    try:
        value = Decimal(str(raw).strip())
    except Exception:
        raise ValueError(f"{field} must be a valid number")
    if not value.is_finite() or value < minimum or value > maximum:
        raise ValueError(f"{field} must be between {minimum} and {maximum}")
    return value


def parse_int(raw, field: str, default: int, minimum: int, maximum: int) -> int:
    """An integer argument clamped to [minimum, maximum]. Empty means the default."""
    if raw is None or raw == "":
        return default
    if isinstance(raw, bool):
        raise ValueError(f"{field} must be an integer")
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be an integer")
    return max(minimum, min(value, maximum))


def authorized_company(company_id: int, min_role: str | None = None) -> Company:
    """Check authentication, active membership and role. Deny by default."""
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
    page = parse_int(request.args.get("page"), "page", 1, 1, 100000)
    size = parse_int(
        request.args.get("page_size"),
        "page_size",
        current_app.config["DEFAULT_PAGE_SIZE"],
        1,
        current_app.config["MAX_PAGE_SIZE"],
    )
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


def audit_dict(event: AuditEvent, actor_names: dict[int, str] | None = None) -> dict:
    return {
        "id": event.id,
        "action": event.action,
        "resource": event.resource,
        "detail": event.detail or {},
        "actor_id": event.actor_id,
        "actor_name": (actor_names or {}).get(event.actor_id) if event.actor_id is not None else None,
        "request_id": event.request_id,
        "created_at": iso(event.created_at),
    }
