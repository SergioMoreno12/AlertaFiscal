from flask import Blueprint, g, jsonify

from ...common.http import authorized_company, error, record_audit
from ...extensions import db
from ...models import CompanyMembership

companies_bp = Blueprint("companies", __name__, url_prefix="/api/v1/companies")


@companies_bp.get("")
def list_companies():
    user = getattr(g, "current_user", None)
    if user is None:
        return error("unauthorized", "Sesión requerida", 401)

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
