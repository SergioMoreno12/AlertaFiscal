"""Semi-synthetic demo companies loaded from the Phase 2 dataset (Phase 5, Step 12).

``flask demo-load`` turns a few **holdout** companies of ``ml/data/processed/monthly_series.csv``
into ERP companies with one income document and one expense document per month, plus one
company with only 4 months to show manual mode. Holdout companies were never used to train or
choose the model, and the Phase 4 evaluation is already closed, so loading them changes nothing
in the model.

- Amounts: the dataset is in millions of COP; the ERP stores pesos (x 1,000,000).
- Dates: the dataset covers 2023-01 to 2025-12 (month index 1-36). Dates move forward by whole
  years (``year_shift``, default 1) so month-of-year seasonality is kept and the history reaches
  recent months. By default months 1-34 are loaded (2024-01 to 2026-10); months 35-36 can be
  loaded later (``--through 36``) to show actual values arriving after a forecast (Phase 6).
- Idempotent: every document has a fixed number (``DEMO-I-<company>-<YYYY-MM>``); existing
  documents are skipped, so the command can be run again to add months.
- Every company is labeled "(semi-synthetic demo)" in its name. No real company is represented.
"""
from __future__ import annotations

import csv
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from .extensions import db
from .models import Company, CompanyMembership, ExpenseDocument, IncomeDocument, User
from .security import hash_password

# One small holdout company per sector, plus a short-history company for manual mode.
DEMO_COMPANIES = (
    {"source_id": "C0141", "sector": "Construction", "months": None},
    {"source_id": "C0017", "sector": "Retail", "months": None},
    {"source_id": "C0078", "sector": "Services", "months": None},
    {"source_id": "C0233", "sector": "Agriculture", "months": None},
    {"source_id": "C0170", "sector": "Manufacturing", "months": None},
    {"source_id": "C0252", "sector": "Mining", "months": 4},
)
MILLION = Decimal("1000000")


def _read_series(series_path: Path, manifest_path: Path) -> dict[str, dict[int, dict]]:
    wanted = {item["source_id"] for item in DEMO_COMPANIES}
    with open(manifest_path, newline="", encoding="utf-8") as handle:
        index = {}
        for row in csv.DictReader(handle):
            if row["company_id"] in wanted:
                if row["split"] != "holdout":
                    raise ValueError(f"{row['company_id']} is not a holdout company; refusing to load it.")
                index[(row["company_id"], row["month"])] = int(row["month_index"])
    series: dict[str, dict[int, dict]] = {}
    with open(series_path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            key = (row["company_id"], row["month"])
            if key in index:
                series.setdefault(row["company_id"], {})[index[key]] = {
                    "month": row["month"],
                    "income": Decimal(row["income"]),
                    "expenses": Decimal(row["expenses"]),
                }
    missing = wanted - set(series)
    if missing:
        raise ValueError(f"Companies missing from the dataset: {sorted(missing)}")
    return series


def _shifted(month: str, years: int) -> datetime:
    year, number = (int(part) for part in month.split("-"))
    return datetime(year + years, number, 15, tzinfo=timezone.utc)


def load_demo(
    series_path: Path,
    manifest_path: Path,
    email: str,
    password: str | None,
    through: int = 34,
    year_shift: int = 1,
) -> dict:
    if not 1 <= through <= 36:
        raise ValueError("through must be a month index between 1 and 36")
    series = _read_series(series_path, manifest_path)

    user = db.session.query(User).filter_by(email=email).first()
    if user is None:
        if not password or len(password) < 10:
            raise ValueError("A new demo user needs a password of at least 10 characters.")
        user = User(email=email, full_name="Demo accountant", password_hash=hash_password(password))
        db.session.add(user)
        db.session.flush()

    summary = {"user": email, "companies": []}
    for spec in DEMO_COMPANIES:
        source_id = spec["source_id"]
        nit = f"DEMO-{source_id}"
        company = db.session.query(Company).filter_by(nit=nit).first()
        if company is None:
            company = Company(
                name=f"{spec['sector']} company {source_id} (semi-synthetic demo)",
                nit=nit,
                sector=spec["sector"],
                size="Small",
            )
            db.session.add(company)
            db.session.flush()
        if not db.session.query(CompanyMembership).filter_by(user_id=user.id, company_id=company.id).first():
            db.session.add(CompanyMembership(user_id=user.id, company_id=company.id, role="admin"))

        # The short-history company keeps only its last ``months`` months up to ``through``.
        first = 1 if spec["months"] is None else max(1, through - spec["months"] + 1)
        added = 0
        for month_index in range(first, through + 1):
            point = series[source_id][month_index]
            issue_date = _shifted(point["month"], year_shift)
            label = f"{issue_date:%Y-%m}"
            income = (point["income"] * MILLION).quantize(Decimal("0.01"))
            expenses = (point["expenses"] * MILLION).quantize(Decimal("0.01"))
            income_number = f"DEMO-I-{source_id}-{label}"
            if not db.session.query(IncomeDocument.id).filter_by(company_id=company.id, doc_number=income_number).first():
                db.session.add(IncomeDocument(
                    company_id=company.id, doc_number=income_number, issue_date=issue_date,
                    description=f"Monthly sales {label} (semi-synthetic)", subtotal=income,
                    tax_amount=Decimal("0.00"), total=income, status="collected", created_by=user.id))
                added += 1
            expense_number = f"DEMO-E-{source_id}-{label}"
            if not db.session.query(ExpenseDocument.id).filter_by(company_id=company.id, doc_number=expense_number).first():
                db.session.add(ExpenseDocument(
                    company_id=company.id, doc_number=expense_number, issue_date=issue_date,
                    category="Operations", description=f"Monthly expenses {label} (semi-synthetic)",
                    subtotal=expenses, tax_amount=Decimal("0.00"), total=expenses, status="paid",
                    reviewed=True, created_by=user.id))
                added += 1
        summary["companies"].append({
            "company_id": company.id,
            "name": company.name,
            "source_id": source_id,
            "months_loaded": through - first + 1,
            "documents_added": added,
        })
    db.session.commit()
    return summary
