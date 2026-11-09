from decimal import Decimal

from flask import current_app, Blueprint, g, jsonify, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ...common.http import (
    authorized_company,
    date_iso,
    error,
    get_json,
    money,
    paginated,
    pagination,
    parse_date,
    parse_money,
    record_audit,
)
from ...extensions import db
from ...models import Counterparty, ExpenseDocument, ExpensePayment, IncomeDocument, IncomeReceipt

movements_bp = Blueprint("movements", __name__, url_prefix="/api/v1/companies/<int:company_id>")


def _refresh_monitoring(company_id: int) -> None:
    """Resolve forecast months whose actual value just arrived (Phase 6). Never breaks the ERP."""
    from ..monitoring.service import refresh_company

    try:
        with db.session.begin_nested():
            refresh_company(company_id)
    except Exception:  # monitoring is best effort; the document is already saved
        current_app.logger.exception("forecast monitoring refresh failed")


def _income_dict(row: IncomeDocument) -> dict:
    return {
        "id": row.id,
        "doc_number": row.doc_number,
        "issue_date": date_iso(row.issue_date),
        "description": row.description,
        "counterparty_id": row.counterparty_id,
        "subtotal": money(row.subtotal),
        "tax_amount": money(row.tax_amount),
        "total": money(row.total),
        "status": row.status,
    }


def _expense_dict(row: ExpenseDocument) -> dict:
    return {
        "id": row.id,
        "doc_number": row.doc_number,
        "issue_date": date_iso(row.issue_date),
        "category": row.category,
        "description": row.description,
        "counterparty_id": row.counterparty_id,
        "subtotal": money(row.subtotal),
        "tax_amount": money(row.tax_amount),
        "total": money(row.total),
        "status": row.status,
        "reviewed": row.reviewed,
    }


def _validate_counterparty(company_id: int, raw) -> int | None:
    if raw in (None, ""):
        return None
    try:
        cid = int(raw)
    except (TypeError, ValueError):
        raise ValueError("Invalid counterparty_id")
    exists = db.session.query(Counterparty.id).filter_by(id=cid, company_id=company_id).first()
    if exists is None:
        raise ValueError("The counterparty does not belong to the company")
    return cid


# ───────────────────────── Income ─────────────────────────


@movements_bp.get("/income")
def list_income(company_id: int):
    authorized_company(company_id)
    page, size = pagination()
    q = db.session.query(IncomeDocument).filter(IncomeDocument.company_id == company_id)
    status = request.args.get("status")
    if status:
        q = q.filter(IncomeDocument.status == status)
    date_from, date_to = parse_date(request.args.get("from")), parse_date(request.args.get("to"))
    if date_from:
        q = q.filter(IncomeDocument.issue_date >= date_from)
    if date_to:
        q = q.filter(IncomeDocument.issue_date <= date_to)
    total = q.count()
    rows = q.order_by(IncomeDocument.issue_date.desc(), IncomeDocument.id.desc()).limit(size).offset((page - 1) * size)
    return paginated([_income_dict(r) for r in rows], total, page, size)


@movements_bp.post("/income")
def create_income(company_id: int):
    authorized_company(company_id, min_role="auxiliar")
    data = get_json()
    try:
        doc_number = str(data.get("doc_number", "")).strip()
        if not doc_number:
            raise ValueError("doc_number is required")
        issue_date = parse_date(str(data.get("issue_date", "")))
        if issue_date is None:
            raise ValueError("Invalid issue_date (YYYY-MM-DD)")
        subtotal = parse_money(data.get("subtotal"), "subtotal")
        tax_amount = parse_money(data.get("tax_amount"), "tax_amount")
        total = parse_money(data.get("total"), "total") if data.get("total") not in (None, "") else subtotal + tax_amount
        counterparty_id = _validate_counterparty(company_id, data.get("counterparty_id"))
        status = str(data.get("status", "pending"))
        if status not in ("pending", "collected"):
            raise ValueError("Invalid status")
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)

    row = IncomeDocument(
        company_id=company_id,
        counterparty_id=counterparty_id,
        doc_number=doc_number,
        issue_date=issue_date,
        description=str(data.get("description", ""))[:255],
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=total,
        status=status,
        created_by=g.current_user.id,
    )
    db.session.add(row)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return error("duplicate_document", "An income document with that number already exists", 409)

    record_audit(company_id, "income.create", f"income:{row.id}", {"total": money(total)})
    _refresh_monitoring(company_id)
    return jsonify(_income_dict(row)), 201


@movements_bp.get("/income/<int:income_id>")
def income_detail(company_id: int, income_id: int):
    authorized_company(company_id)
    row = db.session.get(IncomeDocument, income_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Income document not found", 404)
    receipts = db.session.query(IncomeReceipt).filter_by(company_id=company_id, income_id=income_id).all()
    payload = _income_dict(row)
    payload["receipts"] = [
        {"id": r.id, "amount": money(r.amount), "received_on": date_iso(r.received_on), "method": r.method}
        for r in receipts
    ]
    return jsonify(payload)


# ───────────────────────── Expenses ─────────────────────────


@movements_bp.get("/expenses")
def list_expenses(company_id: int):
    authorized_company(company_id)
    page, size = pagination()
    q = db.session.query(ExpenseDocument).filter(ExpenseDocument.company_id == company_id)
    status = request.args.get("status")
    if status:
        q = q.filter(ExpenseDocument.status == status)
    reviewed = request.args.get("reviewed")
    if reviewed in ("true", "false"):
        q = q.filter(ExpenseDocument.reviewed.is_(reviewed == "true"))
    date_from, date_to = parse_date(request.args.get("from")), parse_date(request.args.get("to"))
    if date_from:
        q = q.filter(ExpenseDocument.issue_date >= date_from)
    if date_to:
        q = q.filter(ExpenseDocument.issue_date <= date_to)
    total = q.count()
    rows = q.order_by(ExpenseDocument.issue_date.desc(), ExpenseDocument.id.desc()).limit(size).offset((page - 1) * size)
    return paginated([_expense_dict(r) for r in rows], total, page, size)


@movements_bp.post("/expenses")
def create_expense(company_id: int):
    authorized_company(company_id, min_role="auxiliar")
    data = get_json()
    try:
        doc_number = str(data.get("doc_number", "")).strip()
        if not doc_number:
            raise ValueError("doc_number is required")
        issue_date = parse_date(str(data.get("issue_date", "")))
        if issue_date is None:
            raise ValueError("Invalid issue_date (YYYY-MM-DD)")
        subtotal = parse_money(data.get("subtotal"), "subtotal")
        tax_amount = parse_money(data.get("tax_amount"), "tax_amount")
        total = parse_money(data.get("total"), "total") if data.get("total") not in (None, "") else subtotal + tax_amount
        counterparty_id = _validate_counterparty(company_id, data.get("counterparty_id"))
        status = str(data.get("status", "pending"))
        if status not in ("pending", "paid"):
            raise ValueError("Invalid status")
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)

    row = ExpenseDocument(
        company_id=company_id,
        counterparty_id=counterparty_id,
        doc_number=doc_number,
        issue_date=issue_date,
        category=str(data.get("category", "Other"))[:80],
        description=str(data.get("description", ""))[:255],
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=total,
        status=status,
        reviewed=bool(data.get("reviewed", False)),
        created_by=g.current_user.id,
    )
    db.session.add(row)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return error("duplicate_document", "An expense document with that number already exists", 409)

    record_audit(company_id, "expense.create", f"expense:{row.id}", {"total": money(total)})
    _refresh_monitoring(company_id)
    return jsonify(_expense_dict(row)), 201


@movements_bp.patch("/expenses/<int:expense_id>")
def update_expense(company_id: int, expense_id: int):
    authorized_company(company_id, min_role="contador")
    row = db.session.get(ExpenseDocument, expense_id)
    if row is None or row.company_id != company_id:
        return error("not_found", "Expense document not found", 404)
    if row.status == "void":
        return error("invalid_state", "A void expense cannot be edited", 409)
    data = get_json()
    if "reviewed" in data:
        row.reviewed = bool(data["reviewed"])
    if "category" in data:
        row.category = str(data["category"])[:80]
    if "description" in data:
        row.description = str(data["description"])[:255]
    record_audit(company_id, "expense.update", f"expense:{row.id}")
    return jsonify(_expense_dict(row))


# ───────────────────────── Receipts and payments ─────────────────────────


@movements_bp.post("/receipts")
def create_receipt(company_id: int):
    authorized_company(company_id, min_role="auxiliar")
    data = get_json()
    try:
        income_id = int(data.get("income_id", 0))
        amount = parse_money(data.get("amount"), "amount")
        if amount <= 0:
            raise ValueError("amount must be greater than zero")
        received_on = parse_date(str(data.get("received_on", "")))
        if received_on is None:
            raise ValueError("Invalid received_on (YYYY-MM-DD)")
    except (TypeError, ValueError) as exc:
        return error("invalid_payload", str(exc), 422)

    income = db.session.get(IncomeDocument, income_id)
    if income is None or income.company_id != company_id:
        return error("not_found", "Income document not found", 404)
    if income.status == "void":
        return error("invalid_state", "The income document is void", 409)
    already = Decimal(
        str(
            db.session.query(func.coalesce(func.sum(IncomeReceipt.amount), 0)).filter_by(income_id=income_id).scalar()
            or 0
        )
    )
    outstanding = Decimal(str(income.total)) - already
    if outstanding <= 0:
        return error("invalid_state", "The income document is already fully collected", 409)
    if amount > outstanding:
        return error("invalid_payload", f"amount exceeds the outstanding balance ({money(outstanding)})", 422)

    receipt = IncomeReceipt(
        company_id=company_id,
        income_id=income_id,
        amount=amount,
        received_on=received_on,
        method=str(data.get("method", "transferencia"))[:40],
        created_by=g.current_user.id,
    )
    db.session.add(receipt)
    db.session.flush()

    collected = (
        db.session.query(func.coalesce(func.sum(IncomeReceipt.amount), 0)).filter_by(income_id=income_id).scalar()
        or Decimal("0")
    )
    if Decimal(str(collected)) >= Decimal(str(income.total)):
        income.status = "collected"

    record_audit(company_id, "receipt.create", f"income:{income_id}", {"amount": money(amount)})
    return jsonify({"id": receipt.id, "amount": money(receipt.amount), "income_status": income.status}), 201


@movements_bp.post("/payments")
def create_payment(company_id: int):
    authorized_company(company_id, min_role="auxiliar")
    data = get_json()
    try:
        expense_id = int(data.get("expense_id", 0))
        amount = parse_money(data.get("amount"), "amount")
        if amount <= 0:
            raise ValueError("amount must be greater than zero")
        paid_on = parse_date(str(data.get("paid_on", "")))
        if paid_on is None:
            raise ValueError("Invalid paid_on (YYYY-MM-DD)")
    except (TypeError, ValueError) as exc:
        return error("invalid_payload", str(exc), 422)

    expense = db.session.get(ExpenseDocument, expense_id)
    if expense is None or expense.company_id != company_id:
        return error("not_found", "Expense document not found", 404)
    if expense.status == "void":
        return error("invalid_state", "The expense document is void", 409)
    already = Decimal(
        str(
            db.session.query(func.coalesce(func.sum(ExpensePayment.amount), 0)).filter_by(expense_id=expense_id).scalar()
            or 0
        )
    )
    outstanding = Decimal(str(expense.total)) - already
    if outstanding <= 0:
        return error("invalid_state", "The expense document is already fully paid", 409)
    if amount > outstanding:
        return error("invalid_payload", f"amount exceeds the outstanding balance ({money(outstanding)})", 422)

    payment = ExpensePayment(
        company_id=company_id,
        expense_id=expense_id,
        amount=amount,
        paid_on=paid_on,
        method=str(data.get("method", "transferencia"))[:40],
        created_by=g.current_user.id,
    )
    db.session.add(payment)
    db.session.flush()

    paid_total = (
        db.session.query(func.coalesce(func.sum(ExpensePayment.amount), 0)).filter_by(expense_id=expense_id).scalar()
        or Decimal("0")
    )
    if Decimal(str(paid_total)) >= Decimal(str(expense.total)):
        expense.status = "paid"

    record_audit(company_id, "payment.create", f"expense:{expense_id}", {"amount": money(amount)})
    return jsonify({"id": payment.id, "amount": money(payment.amount), "expense_status": expense.status}), 201


# ───────────────────────── Counterparties ─────────────────────────


@movements_bp.get("/counterparties")
def list_counterparties(company_id: int):
    authorized_company(company_id)
    rows = (
        db.session.query(Counterparty).filter_by(company_id=company_id).order_by(Counterparty.name.asc()).all()
    )
    return jsonify(
        {"items": [{"id": c.id, "name": c.name, "nit": c.nit, "kind": c.kind} for c in rows]}
    )


@movements_bp.post("/counterparties")
def create_counterparty(company_id: int):
    authorized_company(company_id, min_role="auxiliar")
    data = get_json()
    name = str(data.get("name", "")).strip()
    if not name:
        return error("invalid_payload", "name is required", 422)
    kind = str(data.get("kind", "client"))
    if kind not in ("client", "supplier"):
        return error("invalid_payload", "Invalid kind", 422)
    row = Counterparty(company_id=company_id, name=name[:200], nit=str(data.get("nit", ""))[:40], kind=kind)
    db.session.add(row)
    db.session.flush()
    record_audit(company_id, "counterparty.create", f"counterparty:{row.id}")
    return jsonify({"id": row.id, "name": row.name, "nit": row.nit, "kind": row.kind}), 201


# ─────────────────────────── Monthly totals ───────────────────────────
# A quick way to load a company's history: one income and one expense summary document per
# month. They are ordinary ERP documents (the forecast reads them like any other), with a
# fixed number per month so saving the same month again replaces its amounts.

MONTHLY_INCOME_PREFIX = "MONTH-I-"
MONTHLY_EXPENSE_PREFIX = "MONTH-E-"
MAX_MONTHS_PER_REQUEST = 120


def _parse_month(raw) -> str:
    text = str(raw or "").strip()
    if len(text) != 7 or text[4] != "-":
        raise ValueError(f"Invalid month '{text}' (YYYY-MM)")
    year, month = int(text[:4]), int(text[5:])
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise ValueError(f"Invalid month '{text}' (YYYY-MM)")
    return f"{year:04d}-{month:02d}"


@movements_bp.get("/monthly-totals")
def list_monthly_totals(company_id: int):
    authorized_company(company_id)
    from ..planning.forecasting import monthly_history

    history = monthly_history(company_id)
    entered = {
        row.doc_number[len(MONTHLY_INCOME_PREFIX):]
        for row in db.session.query(IncomeDocument.doc_number).filter(
            IncomeDocument.company_id == company_id,
            IncomeDocument.doc_number.like(f"{MONTHLY_INCOME_PREFIX}%"),
            IncomeDocument.status != "void",
        )
    }
    closed = monthly_history(company_id, closed_only=True)
    return jsonify(
        {
            "items": [
                {
                    "month": month,
                    "income": money(Decimal(str(income))),
                    "expenses": money(Decimal(str(expenses))),
                    "from_monthly_form": month in entered,
                }
                for month, income, expenses in zip(history["months"], history["income"], history["expenses"])
            ],
            "closed_months": len(closed["months"]),
        }
    )


@movements_bp.post("/monthly-totals")
def save_monthly_totals(company_id: int):
    authorized_company(company_id, min_role="auxiliar")
    from datetime import datetime, timezone

    data = get_json()
    rows = data.get("months")
    if not isinstance(rows, list) or not rows:
        return error("invalid_payload", "Send at least one month", 422)
    if len(rows) > MAX_MONTHS_PER_REQUEST:
        return error("invalid_payload", f"Send at most {MAX_MONTHS_PER_REQUEST} months at a time", 422)

    now = datetime.now(timezone.utc)
    current = f"{now.year:04d}-{now.month:02d}"
    parsed: dict[str, tuple[Decimal, Decimal]] = {}
    try:
        for item in rows:
            if not isinstance(item, dict):
                raise ValueError("Each month must be an object")
            month = _parse_month(item.get("month"))
            if month > current:
                raise ValueError(f"{month} is in the future")
            parsed[month] = (parse_money(item.get("income"), "income"), parse_money(item.get("expenses"), "expenses"))
    except ValueError as exc:
        return error("invalid_payload", str(exc), 422)

    saved = 0
    for month, (income_total, expense_total) in sorted(parsed.items()):
        year, mon = int(month[:4]), int(month[5:])
        issue_date = datetime(year, mon, 15, tzinfo=timezone.utc)
        for model, prefix, total in (
            (IncomeDocument, MONTHLY_INCOME_PREFIX, income_total),
            (ExpenseDocument, MONTHLY_EXPENSE_PREFIX, expense_total),
        ):
            doc_number = f"{prefix}{month}"
            row = db.session.query(model).filter_by(company_id=company_id, doc_number=doc_number).first()
            if row is None:
                fields = dict(
                    company_id=company_id,
                    doc_number=doc_number,
                    issue_date=issue_date,
                    description="Monthly total entered by the user",
                    created_by=g.current_user.id,
                )
                if model is IncomeDocument:
                    row = IncomeDocument(status="collected", **fields)
                else:
                    row = ExpenseDocument(status="paid", category="Monthly total", reviewed=True, **fields)
                db.session.add(row)
            elif row.status == "void":
                row.status = "collected" if model is IncomeDocument else "paid"
            row.subtotal = total
            row.tax_amount = Decimal("0")
            row.total = total
        saved += 1

    db.session.flush()
    record_audit(company_id, "monthly_totals.save", f"company:{company_id}", {"months": sorted(parsed)})
    _refresh_monitoring(company_id)
    return list_monthly_totals(company_id)
