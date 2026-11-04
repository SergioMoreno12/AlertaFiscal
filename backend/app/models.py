"""AlertaFiscal data models (MVP).

Conventions:
- Money amounts: Numeric(18, 2) -> Decimal.
- Audit timestamps with time zone.
- Every business entity has company_id and is filtered by company.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


# ─────────────────────────── Identidad ───────────────────────────


class User(TimestampMixin, db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    memberships = relationship("CompanyMembership", back_populates="user", cascade="all, delete-orphan")


class Company(TimestampMixin, db.Model):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    nit: Mapped[str] = mapped_column(String(40), nullable=False)
    sector: Mapped[str] = mapped_column(String(80), nullable=False, default="Otro")
    size: Mapped[str] = mapped_column(String(40), nullable=False, default="Small")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (UniqueConstraint("nit", name="uq_companies_nit"),)


class CompanyMembership(TimestampMixin, db.Model):
    __tablename__ = "company_memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="auxiliar")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user = relationship("User", back_populates="memberships")
    company = relationship("Company")

    __table_args__ = (
        UniqueConstraint("user_id", "company_id", name="uq_membership_user_company"),
        CheckConstraint("role in ('admin','contador','auxiliar')", name="ck_membership_role"),
        Index("ix_membership_company", "company_id", "is_active"),
    )


class Session(TimestampMixin, db.Model):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user = relationship("User")


# ─────────────────────────── Terceros ───────────────────────────


class Counterparty(TimestampMixin, db.Model):
    __tablename__ = "counterparties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    nit: Mapped[str | None] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="client")

    __table_args__ = (
        CheckConstraint("kind in ('client','supplier')", name="ck_counterparty_kind"),
        Index("ix_counterparty_company", "company_id", "kind"),
    )


# ─────────────────────────── Ingresos ───────────────────────────


class IncomeDocument(TimestampMixin, db.Model):
    __tablename__ = "income_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    counterparty_id: Mapped[int | None] = mapped_column(ForeignKey("counterparties.id", ondelete="SET NULL"))
    doc_number: Mapped[str] = mapped_column(String(60), nullable=False)
    issue_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    subtotal: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        UniqueConstraint("company_id", "doc_number", name="uq_income_company_doc"),
        CheckConstraint("status in ('pending','collected','void')", name="ck_income_status"),
        CheckConstraint("total >= 0", name="ck_income_total_positive"),
        Index("ix_income_company_date", "company_id", "issue_date"),
        Index("ix_income_company_status", "company_id", "status"),
    )


class IncomeReceipt(TimestampMixin, db.Model):
    __tablename__ = "income_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    income_id: Mapped[int] = mapped_column(ForeignKey("income_documents.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    received_on: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    method: Mapped[str] = mapped_column(String(40), nullable=False, default="transferencia")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_receipt_amount_positive"),
        Index("ix_receipt_company_income", "company_id", "income_id"),
    )


# ─────────────────────────── Gastos ───────────────────────────


class ExpenseDocument(TimestampMixin, db.Model):
    __tablename__ = "expense_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    counterparty_id: Mapped[int | None] = mapped_column(ForeignKey("counterparties.id", ondelete="SET NULL"))
    doc_number: Mapped[str] = mapped_column(String(60), nullable=False)
    issue_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="Otros")
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    subtotal: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        UniqueConstraint("company_id", "doc_number", name="uq_expense_company_doc"),
        CheckConstraint("status in ('pending','paid','void')", name="ck_expense_status"),
        CheckConstraint("total >= 0", name="ck_expense_total_positive"),
        Index("ix_expense_company_date", "company_id", "issue_date"),
        Index("ix_expense_company_status", "company_id", "status"),
    )


class ExpensePayment(TimestampMixin, db.Model):
    __tablename__ = "expense_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expense_documents.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    paid_on: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    method: Mapped[str] = mapped_column(String(40), nullable=False, default="transferencia")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payment_amount_positive"),
        Index("ix_payment_company_expense", "company_id", "expense_id"),
    )


# ─────────────────────────── Obligaciones ───────────────────────────


class TaxObligation(TimestampMixin, db.Model):
    __tablename__ = "tax_obligations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    period: Mapped[str] = mapped_column(String(40), nullable=False)
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    estimated_amount: Mapped[float | None] = mapped_column(Numeric(18, 2))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        CheckConstraint("status in ('pending','filed','paid','void')", name="ck_obligation_status"),
        Index("ix_obligation_company_due", "company_id", "due_date"),
    )


# ─────────────────────────── Parameters and plans ───────────────────────────


class FiscalParameter(TimestampMixin, db.Model):
    __tablename__ = "fiscal_parameters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="percent")
    source: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("company_id", "key", name="uq_parameter_company_key"),
        Index("ix_parameter_company", "company_id"),
    )


class FiscalPlan(TimestampMixin, db.Model):
    __tablename__ = "fiscal_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    period: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    versions = relationship(
        "FiscalPlanVersion", back_populates="plan", cascade="all, delete-orphan", order_by="FiscalPlanVersion.version"
    )

    __table_args__ = (
        CheckConstraint("status in ('draft','reviewed','archived')", name="ck_plan_status"),
        Index("ix_plan_company", "company_id", "status"),
    )


class FiscalPlanVersion(TimestampMixin, db.Model):
    __tablename__ = "fiscal_plan_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("fiscal_plans.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    assumptions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    projected_income: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    projected_expenses: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    estimated_reserve: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    plan = relationship("FiscalPlan", back_populates="versions")

    __table_args__ = (
        UniqueConstraint("plan_id", "version", name="uq_plan_version"),
        CheckConstraint("status in ('draft','reviewed','archived')", name="ck_plan_version_status"),
        Index("ix_plan_version_company", "company_id"),
    )


class ReserveEntry(TimestampMixin, db.Model):
    __tablename__ = "reserve_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    plan_version_id: Mapped[int | None] = mapped_column(ForeignKey("fiscal_plan_versions.id", ondelete="SET NULL"))
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    reserved_on: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_reserve_amount_positive"),
        Index("ix_reserve_company_date", "company_id", "reserved_on"),
    )


class ForecastRun(TimestampMixin, db.Model):
    __tablename__ = "forecast_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    method: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    horizon_months: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    cutoff_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assumptions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    projected_income: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    projected_expenses: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    model_version: Mapped[str | None] = mapped_column(String(40))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint(
            "method in ('manual','seasonal_naive','linear','random_forest','mlp')",
            name="ck_forecast_method",
        ),
        Index("ix_forecast_company_date", "company_id", "cutoff_date"),
    )


# ─────────────────────────── Alertas ───────────────────────────


class Alert(TimestampMixin, db.Model):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="media")
    origin: Mapped[str] = mapped_column(String(20), nullable=False, default="erp")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    comments = relationship("AlertComment", back_populates="alert", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("priority in ('alta','media','baja')", name="ck_alert_priority"),
        CheckConstraint("origin in ('erp','plan','proyeccion','configuracion')", name="ck_alert_origin"),
        CheckConstraint("status in ('pending','in_review','reviewed')", name="ck_alert_status"),
        Index("ix_alert_company_status", "company_id", "status"),
    )


class AlertComment(TimestampMixin, db.Model):
    __tablename__ = "alert_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text, nullable=False)

    alert = relationship("Alert", back_populates="comments")

    __table_args__ = (Index("ix_comment_company_alert", "company_id", "alert_id"),)


# ─────────────────────────── Audit ───────────────────────────


class AuditEvent(db.Model):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    resource: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("ix_audit_company_date", "company_id", "created_at"),)


# ─────────────────────────── Contexto externo ───────────────────────────
#
# External sources are aggregated context, not ERP data. They are never joined
# to companies by NIT and never feed the forecast or the alerts.


class ExternalSource(TimestampMixin, db.Model):
    __tablename__ = "external_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    publisher: Mapped[str] = mapped_column(String(200), nullable=False)
    dataset_id: Mapped[str | None] = mapped_column(String(80))
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    metadata_url: Mapped[str | None] = mapped_column(String(500))
    attribution: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    attribution_url: Mapped[str | None] = mapped_column(String(500))
    license_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    license_id: Mapped[str | None] = mapped_column(String(80))
    license_url: Mapped[str | None] = mapped_column(String(500))
    license_status: Mapped[str] = mapped_column(String(20), nullable=False, default="uncertain")
    license_evidence_path: Mapped[str | None] = mapped_column(String(300))
    cadence: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    versions = relationship(
        "ExternalDatasetVersion",
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="ExternalDatasetVersion.acquired_at",
    )

    __table_args__ = (
        CheckConstraint(
            "license_status in ('verified','uncertain','restricted')",
            name="ck_external_source_license_status",
        ),
        Index("ix_external_source_active", "is_active"),
    )


class ExternalDatasetVersion(TimestampMixin, db.Model):
    """Acquisition version of a logical source.

    A source can have several downloads. The identity is the content hash
    (``identity_sha256``), not the date label: a new download with the same
    version name but a different hash is kept.
    """

    __tablename__ = "external_dataset_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("external_sources.id", ondelete="CASCADE"), nullable=False
    )
    version_label: Mapped[str] = mapped_column(String(40), nullable=False)
    identity_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cutoff_date: Mapped[datetime | None] = mapped_column(Date)
    period_start: Mapped[datetime | None] = mapped_column(Date)
    period_end: Mapped[datetime | None] = mapped_column(Date)
    is_partial: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_preliminary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="succeeded")
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_name: Mapped[str | None] = mapped_column(String(255))
    manifest_path: Mapped[str] = mapped_column(String(400), nullable=False)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    source = relationship("ExternalSource", back_populates="versions")

    __table_args__ = (
        UniqueConstraint("source_id", "identity_sha256", name="uq_external_version_identity"),
        CheckConstraint(
            "status in ('succeeded','failed','blocked')", name="ck_external_version_status"
        ),
        Index("ix_external_version_source_label", "source_id", "version_label"),
        Index(
            "uq_external_version_current",
            "source_id",
            unique=True,
            postgresql_where=text("is_current"),
            sqlite_where=text("is_current"),
        ),
    )


class TaxCollection(TimestampMixin, db.Model):
    """DIAN aggregated collection, in COP, by period and series."""

    __tablename__ = "tax_collections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("external_dataset_versions.id", ondelete="CASCADE"), nullable=False
    )
    row_key: Mapped[str] = mapped_column(String(64), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    frequency: Mapped[str] = mapped_column(String(20), nullable=False)
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_month: Mapped[int | None] = mapped_column(Integer)
    department_name: Mapped[str | None] = mapped_column(String(160))
    series_code: Mapped[str] = mapped_column(String(80), nullable=False)
    series_label: Mapped[str] = mapped_column(String(200), nullable=False)
    value_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False)
    is_preliminary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("version_id", "row_key", name="uq_tax_collection_row"),
        CheckConstraint("scope in ('national','department')", name="ck_tax_collection_scope"),
        CheckConstraint("frequency in ('annual','monthly')", name="ck_tax_collection_frequency"),
        Index("ix_tax_collection_period", "version_id", "period_year", "period_month"),
    )


class SectorBenchmark(TimestampMixin, db.Model):
    """Supersociedades aggregate by year, metric and macro-sector."""

    __tablename__ = "sector_benchmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("external_dataset_versions.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    metric: Mapped[str] = mapped_column(String(60), nullable=False)
    metric_label: Mapped[str] = mapped_column(String(120), nullable=False)
    sector: Mapped[str] = mapped_column(String(80), nullable=False, default="ALL")
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    mean_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    median_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    p25_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    p75_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    min_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    max_cop: Mapped[float] = mapped_column(Numeric(24, 2), nullable=False, default=0)
    zero_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    negative_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint(
            "version_id", "year", "metric", "sector", name="uq_sector_benchmark_row"
        ),
        Index("ix_sector_benchmark_year", "version_id", "year", "metric"),
    )
