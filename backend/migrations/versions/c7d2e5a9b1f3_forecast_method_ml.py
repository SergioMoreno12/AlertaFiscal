"""Amplía el método de proyección para incluir el modelo estacional.

Revision ID: c7d2e5a9b1f3
Revises: f3b8c2d1a7e4
Create Date: 2026-10-30
"""

from alembic import op

revision = "c7d2e5a9b1f3"
down_revision = "f3b8c2d1a7e4"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_forecast_method", "forecast_runs", type_="check")
    op.create_check_constraint(
        "ck_forecast_method",
        "forecast_runs",
        "method in ('manual','seasonal_naive','linear','random_forest','mlp')",
    )


def downgrade():
    op.drop_constraint("ck_forecast_method", "forecast_runs", type_="check")
    op.create_check_constraint(
        "ck_forecast_method",
        "forecast_runs",
        "method in ('manual','linear','random_forest','mlp')",
    )
