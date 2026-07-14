"""add checkout referral codes

Revision ID: 0023_checkout_referrals
Revises: 0022_checkout_sessions
Create Date: 2026-07-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0023_checkout_referrals"
down_revision = "0022_checkout_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "checkout_session_records",
        sa.Column("referring_referral_code", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "checkout_session_records",
        sa.Column("referral_code", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_checkout_session_records_referring_referral_code",
        "checkout_session_records",
        ["referring_referral_code"],
        unique=False,
    )
    op.create_index(
        "ix_checkout_session_records_referral_code",
        "checkout_session_records",
        ["referral_code"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_checkout_session_records_referral_code", table_name="checkout_session_records")
    op.drop_index("ix_checkout_session_records_referring_referral_code", table_name="checkout_session_records")
    op.drop_column("checkout_session_records", "referral_code")
    op.drop_column("checkout_session_records", "referring_referral_code")
