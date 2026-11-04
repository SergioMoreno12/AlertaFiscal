"""Read-only monitoring endpoint (Phase 6, Step 10)."""
from __future__ import annotations

from flask import Blueprint, jsonify

from ...common.http import authorized_company
from .service import company_status, monitoring_rows, operations_summary, refresh_company

monitoring_bp = Blueprint("monitoring", __name__, url_prefix="/api/v1/companies/<int:company_id>/monitoring")


@monitoring_bp.get("")
def get_monitoring(company_id: int):
    """Status per target, rolling error vs the Phase 4 reference, rows and operations.

    Reading the endpoint first resolves the months whose actual values have arrived, so a
    value registered late is picked up here as well.
    """
    authorized_company(company_id)
    refresh_company(company_id)
    return jsonify({
        **company_status(company_id),
        "rows": monitoring_rows(company_id),
        "operations": operations_summary(company_id),
    })
