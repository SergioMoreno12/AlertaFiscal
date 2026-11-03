"""Datos de demostración. Nunca se ejecuta automáticamente en producción."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from .extensions import db
from .models import (
    Alert,
    AlertComment,
    Company,
    CompanyMembership,
    Counterparty,
    ExpenseDocument,
    FiscalParameter,
    FiscalPlan,
    FiscalPlanVersion,
    IncomeDocument,
    ReserveEntry,
    TaxObligation,
    User,
)
from .security import hash_password

DEMO_EMAIL = "maria.gomez@contaduria.co"
DEMO_PASSWORD = "demo2026"


def _month_start(offset: int) -> datetime:
    now = datetime.now(timezone.utc)
    year, month = now.year, now.month - offset
    while month <= 0:
        month += 12
        year -= 1
    return datetime(year, month, 1, tzinfo=timezone.utc)


def seed_demo() -> str:
    if db.session.query(User).filter_by(email=DEMO_EMAIL).first() is not None:
        return "Seed omitido: los datos de demostración ya existen."

    user = User(
        email=DEMO_EMAIL,
        full_name="María Gómez",
        password_hash=hash_password(DEMO_PASSWORD),
    )
    db.session.add(user)
    db.session.flush()

    companies = [
        Company(name="Comercializadora Andina S.A.S.", nit="900.456.123-1", sector="Comercio", size="Pequeña"),
        Company(name="Servicios Bogotá Ltda.", nit="830.912.045-2", sector="Servicios", size="Pequeña"),
    ]
    db.session.add_all(companies)
    db.session.flush()

    db.session.add_all(
        [
            CompanyMembership(user_id=user.id, company_id=companies[0].id, role="admin"),
            CompanyMembership(user_id=user.id, company_id=companies[1].id, role="contador"),
        ]
    )

    andina = companies[0]
    clients = [
        Counterparty(company_id=andina.id, name="Ferretería Central", nit="800.111.222-1", kind="client"),
        Counterparty(company_id=andina.id, name="Distribuidora Norte", nit="800.333.444-2", kind="client"),
        Counterparty(company_id=andina.id, name="Importadora Andina", nit="800.555.666-3", kind="supplier"),
        Counterparty(company_id=andina.id, name="Servicios Logísticos S.A.", nit="800.777.888-4", kind="supplier"),
    ]
    db.session.add_all(clients)
    db.session.flush()
    client_ids = [clients[0].id, clients[1].id]
    supplier_ids = [clients[2].id, clients[3].id]

    base_income = [42_000_000, 51_000_000, 48_500_000, 62_300_000, 57_800_000, 35_000_000]
    base_expense = [28_000_000, 34_000_000, 32_000_000, 41_000_000, 38_500_000, 23_000_000]

    # 18 meses de historia sintética con tendencia y estacionalidad, para que
    # el módulo de ML tenga suficientes observaciones al entrenar.
    months = 18
    for idx in range(months):
        month = _month_start(months - 1 - idx)
        trend = Decimal(idx) * Decimal("1350000")
        season = Decimal((idx % 4) * 2200000 + (9_000_000 if idx % 12 in (11, 0) else 0))
        income_total = Decimal(base_income[idx % 6]) + trend + season
        expense_total = Decimal(base_expense[idx % 6]) + Decimal(idx) * Decimal("950000")
        income_total = income_total.quantize(Decimal("0.01"))
        expense_total = expense_total.quantize(Decimal("0.01"))

        subtotal = (income_total / Decimal("1.19")).quantize(Decimal("0.01"))
        db.session.add(
            IncomeDocument(
                company_id=andina.id,
                counterparty_id=client_ids[idx % 2],
                doc_number=f"FE-{month:%Y%m}-{idx + 1:03d}",
                issue_date=month + timedelta(days=5),
                description="Venta de mercancía",
                subtotal=subtotal,
                tax_amount=(income_total - subtotal),
                total=income_total,
                status="collected" if idx < months - 2 else "pending",
                created_by=user.id,
            )
        )

        exp_subtotal = (expense_total / Decimal("1.19")).quantize(Decimal("0.01"))
        db.session.add(
            ExpenseDocument(
                company_id=andina.id,
                counterparty_id=supplier_ids[idx % 2],
                doc_number=f"FC-{month:%Y%m}-{idx + 1:03d}",
                issue_date=month + timedelta(days=7),
                category="Mercancía" if idx % 2 == 0 else "Logística",
                description="Compra operativa",
                subtotal=exp_subtotal,
                tax_amount=(expense_total - exp_subtotal),
                total=expense_total,
                status="paid" if idx < months - 3 else "pending",
                reviewed=idx < months - 2,
                created_by=user.id,
            )
        )

    now = datetime.now(timezone.utc)
    db.session.add_all(
        [
            TaxObligation(
                company_id=andina.id,
                name="IVA bimestral",
                period="Sep-Oct 2026",
                due_date=now + timedelta(days=8),
                estimated_amount=Decimal("2550000.00"),
                status="pending",
                notes="Fecha registrada manualmente por el contador.",
            ),
            TaxObligation(
                company_id=andina.id,
                name="Retención en la fuente",
                period="Oct 2026",
                due_date=now + timedelta(days=23),
                estimated_amount=None,
                status="pending",
                notes="Pendiente de configuración.",
            ),
        ]
    )

    plan = FiscalPlan(
        company_id=andina.id,
        name="Plan de reserva Oct 2026",
        period="2026-10",
        status="reviewed",
        current_version=1,
        created_by=user.id,
    )
    db.session.add(plan)
    db.session.flush()
    version = FiscalPlanVersion(
        plan_id=plan.id,
        company_id=andina.id,
        version=1,
        status="reviewed",
        assumptions={
            "income_growth_percent": "5",
            "expense_growth_percent": "3",
            "source": "Planificación manual",
        },
        projected_income=Decimal("55000000.00"),
        projected_expenses=Decimal("37000000.00"),
        estimated_reserve=Decimal("4500000.00"),
        notes="Reserva objetivo definida manualmente. No es una liquidación oficial.",
        created_by=user.id,
    )
    db.session.add(version)
    db.session.flush()
    db.session.add(
        ReserveEntry(
            company_id=andina.id,
            plan_version_id=version.id,
            amount=Decimal("3000000.00"),
            reserved_on=now - timedelta(days=3),
            note="Reserva informada por la empresa",
            created_by=user.id,
        )
    )

    db.session.add(
        FiscalParameter(
            company_id=andina.id,
            key="iva_rate",
            label="Tarifa IVA general",
            value=Decimal("19.0000"),
            unit="percent",
            source="Parámetro de ejemplo pendiente de validación normativa",
            reviewed=False,
        )
    )

    alert = Alert(
        company_id=andina.id,
        title="Faltan $1.500.000 para cubrir la meta de reserva",
        description="La reserva registrada no cubre la meta definida en el plan vigente.",
        priority="alta",
        origin="plan",
        status="pending",
        created_by=user.id,
    )
    db.session.add(alert)
    db.session.flush()
    db.session.add(
        AlertComment(
            company_id=andina.id,
            alert_id=alert.id,
            user_id=user.id,
            body="Revisar disponibilidad antes del cierre del período.",
        )
    )

    db.session.commit()
    return (
        "Seed demo listo. Usuario: "
        f"{DEMO_EMAIL} / {DEMO_PASSWORD} (solo demostración). "
        "Empresas: 2. Registros: 18 meses de ingresos y gastos."
    )
