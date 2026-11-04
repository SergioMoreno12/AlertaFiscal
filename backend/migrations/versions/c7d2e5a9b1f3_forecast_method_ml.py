"""Extend the forecast method to include the seasonal model.

Revision ID: c7d2e5a9b1f3
Revises: f3b8c2d1a7e4
Create Date: 2026-10-30
"""

from alembic import op

revision = "c7d2e5a9b1f3"
down_revision = "f3b8c2d1a7e4"
branch_labels = None
depends_on = None


def _replace_check(condition: str) -> None:
    # Batch mode: a plain ALTER on PostgreSQL, a table copy on SQLite (which cannot
    # alter constraints in place). The explicit SQLite demo mode needs it to migrate.
    with op.batch_alter_table("forecast_runs", schema=None) as batch_op:
        batch_op.drop_constraint("ck_forecast_method", type_="check")
        batch_op.create_check_constraint("ck_forecast_method", condition)


def upgrade():
    _replace_check("method in ('manual','seasonal_naive','linear','random_forest','mlp')")


def downgrade():
    _replace_check("method in ('manual','linear','random_forest','mlp')")
