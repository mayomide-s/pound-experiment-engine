"""add campaign foundation

Revision ID: 0021_campaign_foundation
Revises: 0020_youtube_publication_execution
Create Date: 2026-07-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0021_campaign_foundation"
down_revision = "0020_youtube_publication_execution"
branch_labels = None
depends_on = None


campaign_status_enum = sa.Enum(
    "draft",
    "active",
    "paused",
    "completed",
    name="campaignstatus",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("core_question", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("landing_page_url", sa.String(length=2048), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="GBP"),
        sa.Column("target_amount_minor", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("target_reach", sa.BigInteger(), nullable=False, server_default="10000000"),
        sa.Column("status", campaign_status_enum, nullable=False, server_default="draft"),
        sa.Column("content_rules_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("target_platforms_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("start_date", sa.DateTime(), nullable=True),
        sa.Column("end_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_campaigns_slug"),
    )
    op.create_index("ix_campaigns_slug", "campaigns", ["slug"], unique=False)
    op.create_index("ix_campaigns_status", "campaigns", ["status"], unique=False)

    op.create_table(
        "creative_variants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("campaign_id", sa.String(length=36), nullable=False),
        sa.Column("hook_type", sa.String(length=100), nullable=False),
        sa.Column("visual_type", sa.String(length=100), nullable=False),
        sa.Column("tone", sa.String(length=100), nullable=False),
        sa.Column("call_to_action", sa.Text(), nullable=False),
        sa.Column("video_length_seconds", sa.Integer(), nullable=True),
        sa.Column("voiceover_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("text_density", sa.String(length=50), nullable=True),
        sa.Column("tracking_code", sa.String(length=255), nullable=False),
        sa.Column("experiment_config_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], name="fk_creative_variants_campaign_id_campaigns"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tracking_code", name="uq_creative_variants_tracking_code"),
    )
    op.create_index("ix_creative_variants_campaign_id", "creative_variants", ["campaign_id"], unique=False)
    op.create_index("ix_creative_variants_tracking_code", "creative_variants", ["tracking_code"], unique=False)

    with op.batch_alter_table("pipeline_runs") as batch_op:
        batch_op.add_column(sa.Column("campaign_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("creative_variant_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_pipeline_runs_campaign_id_campaigns",
            "campaigns",
            ["campaign_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_pipeline_runs_creative_variant_id_creative_variants",
            "creative_variants",
            ["creative_variant_id"],
            ["id"],
        )
        batch_op.create_unique_constraint("uq_pipeline_runs_creative_variant_id", ["creative_variant_id"])
        batch_op.create_index("ix_pipeline_runs_campaign_id", ["campaign_id"], unique=False)
        batch_op.create_index("ix_pipeline_runs_creative_variant_id", ["creative_variant_id"], unique=False)


def downgrade() -> None:
    dialect_name = op.get_bind().dialect.name
    with op.batch_alter_table("pipeline_runs") as batch_op:
        batch_op.drop_index("ix_pipeline_runs_creative_variant_id")
        batch_op.drop_index("ix_pipeline_runs_campaign_id")
        batch_op.drop_constraint("uq_pipeline_runs_creative_variant_id", type_="unique")
        if dialect_name != "sqlite":
            batch_op.drop_constraint("fk_pipeline_runs_creative_variant_id_creative_variants", type_="foreignkey")
            batch_op.drop_constraint("fk_pipeline_runs_campaign_id_campaigns", type_="foreignkey")
        batch_op.drop_column("creative_variant_id")
        batch_op.drop_column("campaign_id")

    op.drop_index("ix_creative_variants_tracking_code", table_name="creative_variants")
    op.drop_index("ix_creative_variants_campaign_id", table_name="creative_variants")
    op.drop_table("creative_variants")

    op.drop_index("ix_campaigns_status", table_name="campaigns")
    op.drop_index("ix_campaigns_slug", table_name="campaigns")
    op.drop_table("campaigns")
