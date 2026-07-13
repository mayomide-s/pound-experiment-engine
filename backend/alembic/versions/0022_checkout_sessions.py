"""add checkout session records

Revision ID: 0022_checkout_sessions
Revises: 0021_campaign_foundation
Create Date: 2026-07-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0022_checkout_sessions"
down_revision = "0021_campaign_foundation"
branch_labels = None
depends_on = None


checkout_session_status_enum = sa.Enum(
    "created",
    "open",
    "completed",
    "expired",
    "failed",
    name="checkoutsessionrecordstatus",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "checkout_session_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("campaign_id", sa.String(length=36), nullable=True),
        sa.Column("stripe_checkout_session_id", sa.String(length=255), nullable=False),
        sa.Column("stripe_payment_intent_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        sa.Column("status", checkout_session_status_enum, nullable=False, server_default="created"),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("amount_total_minor", sa.Integer(), nullable=False),
        sa.Column("payment_status", sa.String(length=64), nullable=True),
        sa.Column("customer_email", sa.String(length=255), nullable=True),
        sa.Column("source_code", sa.String(length=120), nullable=True),
        sa.Column("stripe_event_id", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], name="fk_checkout_session_records_campaign_id_campaigns"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stripe_checkout_session_id", name="uq_checkout_session_records_session_id"),
        sa.UniqueConstraint("stripe_payment_intent_id", name="uq_checkout_session_records_payment_intent_id"),
        sa.UniqueConstraint("stripe_event_id", name="uq_checkout_session_records_event_id"),
    )
    op.create_index("ix_checkout_session_records_campaign_id", "checkout_session_records", ["campaign_id"], unique=False)
    op.create_index("ix_checkout_session_records_status", "checkout_session_records", ["status"], unique=False)
    op.create_index("ix_checkout_session_records_created_at", "checkout_session_records", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_checkout_session_records_created_at", table_name="checkout_session_records")
    op.drop_index("ix_checkout_session_records_status", table_name="checkout_session_records")
    op.drop_index("ix_checkout_session_records_campaign_id", table_name="checkout_session_records")
    op.drop_table("checkout_session_records")
