"""forecast monitoring: predictions vs actual values, and forecast service events (Phase 6)

Revision ID: d4e8a1b2c3f5
Revises: c7d2e5a9b1f3
Create Date: 2026-11-04

It only adds two tables. It does not change existing tables or data.
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e8a1b2c3f5"
down_revision = "c7d2e5a9b1f3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "forecast_monitoring",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("forecast_run_id", sa.Integer(), nullable=False),
        sa.Column("target", sa.String(length=10), nullable=False),
        sa.Column("forecast_month", sa.String(length=7), nullable=False),
        sa.Column("horizon_step", sa.Integer(), nullable=False),
        sa.Column("predicted_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("scale_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("actual_value", sa.Numeric(18, 2), nullable=True),
        sa.Column("absolute_error", sa.Numeric(18, 2), nullable=True),
        sa.Column("normalized_error_pct", sa.Numeric(9, 4), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("model_version", sa.String(length=40), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("target in ('income','expenses')", name="ck_monitoring_target"),
        sa.CheckConstraint("status in ('pending','normal','watch','degraded')", name="ck_monitoring_status"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["forecast_run_id"], ["forecast_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("forecast_run_id", "target", "forecast_month", name="uq_monitoring_run_target_month"),
    )
    op.create_index(
        "ix_monitoring_company_target_month", "forecast_monitoring", ["company_id", "target", "forecast_month"]
    )
    op.create_table(
        "forecast_service_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(length=40), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_service_events_company_date", "forecast_service_events", ["company_id", "created_at"])


def downgrade():
    op.drop_index("ix_service_events_company_date", table_name="forecast_service_events")
    op.drop_table("forecast_service_events")
    op.drop_index("ix_monitoring_company_target_month", table_name="forecast_monitoring")
    op.drop_table("forecast_monitoring")
