import re

from flask import Blueprint, g, jsonify
from sqlalchemy.exc import IntegrityError

from ...common.http import authorized_company, error, get_json, record_audit
from ...extensions import db
from ...models import Company, CompanyMembership, User

companies_bp = Blueprint("companies", __name__, url_prefix="/api/v1/companies")


@companies_bp.get("")
def list_companies():
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Session required", 401)

    memberships = (
        db.session.query(CompanyMembership)
        .filter_by(user_id=user.id, is_active=True)
        .join(CompanyMembership.company)
        .order_by(CompanyMembership.company_id)
        .all()
    )
    return jsonify(
        {
            "items": [
                {
                    "id": m.company.id,
                    "name": m.company.name,
                    "nit": m.company.nit,
                    "sector": m.company.sector,
                    "size": m.company.size,
                    "role": m.role,
                }
                for m in memberships
            ]
        }
    )


@companies_bp.get("/<int:company_id>")
def company_detail(company_id: int):
    company = authorized_company(company_id)
    record_audit(company.id, "company.view", f"company:{company.id}")
    return jsonify(
        {
            "id": company.id,
            "name": company.name,
            "nit": company.nit,
            "sector": company.sector,
            "size": company.size,
            "role": g.membership.role,
        }
    )


SECTORS = ("Retail", "Services", "Manufacturing", "Construction", "Agriculture", "Mining", "Technology", "Other")
SIZES = ("Micro", "Small", "Medium", "Large")
ROLES = ("admin", "contador", "auxiliar")
NIT_RE = re.compile(r"^[0-9][0-9.\-]{4,19}$")


def _company_dict(company: Company, role: str) -> dict:
    return {
        "id": company.id,
        "name": company.name,
        "nit": company.nit,
        "sector": company.sector,
        "size": company.size,
        "role": role,
    }


def create_company_for(user: User, data: dict):
    """Create a company with ``user`` as its administrator.

    Returns the company, or an error response tuple when the data is invalid.
    """
    name = str(data.get("name", "")).strip()
    nit = str(data.get("nit", "")).strip()
    sector = str(data.get("sector", "Other")).strip() or "Other"
    size = str(data.get("size", "Small")).strip() or "Small"
    if len(name) < 2 or len(name) > 200:
        return error("invalid_payload", "The company name must have between 2 and 200 characters", 422, {"name": "invalid"})
    if not NIT_RE.match(nit):
        return error("invalid_payload", "Enter a valid NIT (digits, dots and a dash)", 422, {"nit": "invalid"})
    if sector not in SECTORS:
        return error("invalid_payload", "Invalid sector", 422, {"sector": "invalid"})
    if size not in SIZES:
        return error("invalid_payload", "Invalid company size", 422, {"size": "invalid"})
    if db.session.query(Company).filter_by(nit=nit).first() is not None:
        return error("nit_taken", "A company with that NIT is already registered", 409, {"nit": "taken"})

    company = Company(name=name, nit=nit, sector=sector, size=size)
    db.session.add(company)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return error("nit_taken", "A company with that NIT is already registered", 409, {"nit": "taken"})
    db.session.add(CompanyMembership(user_id=user.id, company_id=company.id, role="admin"))
    db.session.flush()
    record_audit(company.id, "company.create", f"company:{company.id}", {"name": name})
    return company


@companies_bp.patch("/<int:company_id>")
def update_company(company_id: int):
    company = authorized_company(company_id, min_role="admin")
    data = get_json()
    changed = {}
    if "name" in data:
        name = str(data["name"] or "").strip()
        if len(name) < 2 or len(name) > 200:
            return error(
                "invalid_payload", "The company name must have between 2 and 200 characters", 422, {"name": "invalid"}
            )
        company.name = changed["name"] = name
    if "nit" in data:
        nit = str(data["nit"] or "").strip()
        if not NIT_RE.match(nit):
            return error("invalid_payload", "Enter a valid NIT (digits, dots and a dash)", 422, {"nit": "invalid"})
        taken = db.session.query(Company.id).filter(Company.nit == nit, Company.id != company_id).first()
        if taken is not None:
            return error("nit_taken", "A company with that NIT is already registered", 409, {"nit": "taken"})
        company.nit = changed["nit"] = nit
    if "sector" in data:
        if data["sector"] not in SECTORS:
            return error("invalid_payload", "Invalid sector", 422, {"sector": "invalid"})
        company.sector = changed["sector"] = data["sector"]
    if "size" in data:
        if data["size"] not in SIZES:
            return error("invalid_payload", "Invalid company size", 422, {"size": "invalid"})
        company.size = changed["size"] = data["size"]
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return error("nit_taken", "A company with that NIT is already registered", 409, {"nit": "taken"})
    record_audit(company_id, "company.update", f"company:{company_id}", changed)
    return jsonify(_company_dict(company, g.membership.role))


@companies_bp.post("")
def create_company():
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Session required", 401)
    result = create_company_for(user, get_json())
    if isinstance(result, tuple):
        return result
    return jsonify(_company_dict(result, "admin")), 201


def _member_dict(m: CompanyMembership) -> dict:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "email": m.user.email,
        "full_name": m.user.full_name,
        "role": m.role,
        "is_active": m.is_active,
    }


@companies_bp.get("/<int:company_id>/members")
def list_members(company_id: int):
    authorized_company(company_id, min_role="admin")
    rows = (
        db.session.query(CompanyMembership)
        .filter_by(company_id=company_id)
        .join(CompanyMembership.user)
        .order_by(CompanyMembership.id)
        .all()
    )
    return jsonify({"items": [_member_dict(m) for m in rows]})


@companies_bp.post("/<int:company_id>/members")
def add_member(company_id: int):
    """Give a registered user access to the company. The person must sign up first."""
    authorized_company(company_id, min_role="admin")
    data = get_json()
    email = str(data.get("email", "")).strip().lower()
    role = str(data.get("role", "auxiliar"))
    if role not in ROLES:
        return error("invalid_payload", "Invalid role", 422)
    user = db.session.query(User).filter_by(email=email).first() if email else None
    if user is None or not user.is_active:
        return error(
            "user_not_found",
            "No account uses that email. Ask the person to create an account first.",
            404,
        )
    existing = db.session.query(CompanyMembership).filter_by(company_id=company_id, user_id=user.id).first()
    if existing is not None:
        if existing.is_active:
            return error("already_member", "That user already belongs to the company", 409)
        existing.is_active = True
        existing.role = role
        row = existing
    else:
        row = CompanyMembership(company_id=company_id, user_id=user.id, role=role)
        db.session.add(row)
    db.session.flush()
    record_audit(company_id, "member.add", f"user:{user.id}", {"role": role})
    return jsonify(_member_dict(row)), 201


def _active_admins(company_id: int) -> int:
    return (
        db.session.query(CompanyMembership)
        .filter_by(company_id=company_id, role="admin", is_active=True)
        .count()
    )


@companies_bp.patch("/<int:company_id>/members/<int:member_id>")
def update_member(company_id: int, member_id: int):
    authorized_company(company_id, min_role="admin")
    row = db.session.get(CompanyMembership, member_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Member not found", 404)
    data = get_json()
    role = data.get("role")
    active = data.get("is_active")
    if role is not None and role not in ROLES:
        return error("invalid_payload", "Invalid role", 422)
    losing_admin = row.role == "admin" and row.is_active and ((role is not None and role != "admin") or active is False)
    if losing_admin and _active_admins(company_id) <= 1:
        return error("last_admin", "The company needs at least one active administrator", 409)
    if role is not None:
        row.role = role
    if isinstance(active, bool):
        row.is_active = active
    db.session.flush()
    record_audit(company_id, "member.update", f"user:{row.user_id}", {"role": row.role, "is_active": row.is_active})
    return jsonify(_member_dict(row))
