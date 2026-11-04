"""external context: sources, versions and aggregates

Revision ID: f3b8c2d1a7e4
Revises: b936452f07f9
Create Date: 2026-10-30 00:00:00.000000

It only adds external context tables. It does not change companies, documents,
plans, reserves, obligations or alerts.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f3b8c2d1a7e4"
down_revision = "b936452f07f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=60), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("publisher", sa.String(length=200), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=True),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("metadata_url", sa.String(length=500), nullable=True),
        sa.Column("attribution", sa.String(length=300), nullable=False),
        sa.Column("attribution_url", sa.String(length=500), nullable=True),
        sa.Column("license_name", sa.String(length=200), nullable=False),
        sa.Column("license_id", sa.String(length=80), nullable=True),
        sa.Column("license_url", sa.String(length=500), nullable=True),
        sa.Column("license_status", sa.String(length=20), nullable=False),
        sa.Column("license_evidence_path", sa.String(length=300), nullable=True),
        sa.Column("cadence", sa.String(length=300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
        sa.CheckConstraint(
            "license_status in ('verified','uncertain','restricted')",
            name="ck_external_source_license_status",
        ),
    )
    op.create_index("ix_external_source_active", "external_sources", ["is_active"], unique=False)

    op.create_table(
        "external_dataset_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("version_label", sa.String(length=40), nullable=False),
        sa.Column("identity_sha256", sa.String(length=64), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cutoff_date", sa.Date(), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("is_partial", sa.Boolean(), nullable=False),
        sa.Column("is_preliminary", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("manifest_path", sa.String(length=400), nullable=False),
        sa.Column("manifest_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["external_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "identity_sha256", name="uq_external_version_identity"),
        sa.CheckConstraint(
            "status in ('succeeded','failed','blocked')", name="ck_external_version_status"
        ),
    )
    op.create_index(
        "ix_external_version_source_label",
        "external_dataset_versions",
        ["source_id", "version_label"],
        unique=False,
    )
    op.create_index(
        "uq_external_version_current",
        "external_dataset_versions",
        ["source_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
        sqlite_where=sa.text("is_current"),
    )

    op.create_table(
        "tax_collections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("row_key", sa.String(length=64), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("frequency", sa.String(length=20), nullable=False),
        sa.Column("period_year", sa.Integer(), nullable=False),
        sa.Column("period_month", sa.Integer(), nullable=True),
        sa.Column("department_name", sa.String(length=160), nullable=True),
        sa.Column("series_code", sa.String(length=80), nullable=False),
        sa.Column("series_label", sa.String(length=200), nullable=False),
        sa.Column("value_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("is_preliminary", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["external_dataset_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version_id", "row_key", name="uq_tax_collection_row"),
        sa.CheckConstraint("scope in ('national','department')", name="ck_tax_collection_scope"),
        sa.CheckConstraint(
            "frequency in ('annual','monthly')", name="ck_tax_collection_frequency"
        ),
    )
    op.create_index(
        "ix_tax_collection_period",
        "tax_collections",
        ["version_id", "period_year", "period_month"],
        unique=False,
    )

    op.create_table(
        "sector_benchmarks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("metric", sa.String(length=60), nullable=False),
        sa.Column("metric_label", sa.String(length=120), nullable=False),
        sa.Column("sector", sa.String(length=80), nullable=False),
        sa.Column("sample_size", sa.Integer(), nullable=False),
        sa.Column("total_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("mean_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("median_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("p25_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("p75_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("min_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("max_cop", sa.Numeric(precision=24, scale=2), nullable=False),
        sa.Column("zero_count", sa.Integer(), nullable=False),
        sa.Column("negative_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["version_id"], ["external_dataset_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "version_id", "year", "metric", "sector", name="uq_sector_benchmark_row"
        ),
    )
    op.create_index(
        "ix_sector_benchmark_year",
        "sector_benchmarks",
        ["version_id", "year", "metric"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_sector_benchmark_year", table_name="sector_benchmarks")
    op.drop_table("sector_benchmarks")
    op.drop_index("ix_tax_collection_period", table_name="tax_collections")
    op.drop_table("tax_collections")
    op.drop_index("uq_external_version_current", table_name="external_dataset_versions")
    op.drop_index("ix_external_version_source_label", table_name="external_dataset_versions")
    op.drop_table("external_dataset_versions")
    op.drop_index("ix_external_source_active", table_name="external_sources")
    op.drop_table("external_sources")
