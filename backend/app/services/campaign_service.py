from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Campaign, CreativeVariant, PipelineRun
from app.schemas.campaigns import CampaignCreate, CampaignUpdate, CreativeVariantCreate


class CampaignNotFoundError(ValueError):
    """Raised when a campaign does not exist."""


class CampaignConflictError(RuntimeError):
    """Raised when a campaign or creative variant hits a uniqueness conflict."""


@dataclass(slots=True)
class CampaignGenerationContext:
    campaign_id: str
    campaign_name: str
    campaign_slug: str
    core_question: str
    campaign_description: str | None
    landing_page_url: str | None
    currency: str
    target_amount_minor: int
    target_reach: int
    content_rules: dict[str, Any]
    target_platforms: list[str]
    creative_variant_id: str
    tracking_code: str
    hook_type: str
    visual_type: str
    tone: str
    call_to_action: str
    video_length_seconds: int | None
    voiceover_enabled: bool
    text_density: str | None
    experiment_config: dict[str, Any]


def _commit_or_rollback(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def _raise_for_integrity_error(exc: IntegrityError) -> None:
    message = str(exc.orig).lower() if exc.orig is not None else str(exc).lower()
    if "campaigns.slug" in message or "uq_campaigns_slug" in message:
        raise CampaignConflictError("Campaign slug already exists") from exc
    if "creative_variants.tracking_code" in message or "uq_creative_variants_tracking_code" in message:
        raise CampaignConflictError("Creative variant tracking code already exists") from exc
    if "pipeline_runs.creative_variant_id" in message or "uq_pipeline_runs_creative_variant_id" in message:
        raise CampaignConflictError("Creative variant is already attached to a pipeline run") from exc
    raise


def create_campaign(db: Session, payload: CampaignCreate) -> Campaign:
    campaign = Campaign(**payload.model_dump())
    db.add(campaign)
    try:
        _commit_or_rollback(db)
    except IntegrityError as exc:
        _raise_for_integrity_error(exc)
    db.refresh(campaign)
    return campaign


def list_campaigns(db: Session) -> list[Campaign]:
    return db.query(Campaign).order_by(Campaign.created_at.desc()).all()


def get_campaign(db: Session, campaign_id: str) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise CampaignNotFoundError("Campaign not found")
    return campaign


def update_campaign(db: Session, campaign_id: str, payload: CampaignUpdate) -> Campaign:
    campaign = get_campaign(db, campaign_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(campaign, key, value)
    try:
        _commit_or_rollback(db)
    except IntegrityError as exc:
        _raise_for_integrity_error(exc)
    db.refresh(campaign)
    return campaign


def create_creative_variant(db: Session, campaign_id: str, payload: CreativeVariantCreate) -> CreativeVariant:
    get_campaign(db, campaign_id)
    variant = CreativeVariant(campaign_id=campaign_id, **payload.model_dump())
    db.add(variant)
    try:
        _commit_or_rollback(db)
    except IntegrityError as exc:
        _raise_for_integrity_error(exc)
    db.refresh(variant)
    return variant


def list_variants_for_campaign(db: Session, campaign_id: str) -> list[CreativeVariant]:
    get_campaign(db, campaign_id)
    return (
        db.query(CreativeVariant)
        .filter(CreativeVariant.campaign_id == campaign_id)
        .order_by(CreativeVariant.created_at.desc())
        .all()
    )


def get_campaign_generation_context(db: Session, run: PipelineRun) -> CampaignGenerationContext | None:
    if not run.campaign_id and not run.creative_variant_id:
        return None
    if not run.campaign_id or not run.creative_variant_id:
        raise CampaignConflictError("Campaign-linked run is missing campaign or creative variant linkage")

    campaign = db.get(Campaign, run.campaign_id)
    if campaign is None:
        raise CampaignNotFoundError("Campaign not found for pipeline run")

    creative_variant = db.get(CreativeVariant, run.creative_variant_id)
    if creative_variant is None:
        raise CampaignNotFoundError("Creative variant not found for pipeline run")
    if creative_variant.campaign_id != campaign.id:
        raise CampaignConflictError("Creative variant does not belong to the pipeline run campaign")

    return CampaignGenerationContext(
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        campaign_slug=campaign.slug,
        core_question=campaign.core_question,
        campaign_description=campaign.description,
        landing_page_url=campaign.landing_page_url,
        currency=campaign.currency,
        target_amount_minor=campaign.target_amount_minor,
        target_reach=campaign.target_reach,
        content_rules=dict(campaign.content_rules_json or {}),
        target_platforms=list(campaign.target_platforms_json or []),
        creative_variant_id=creative_variant.id,
        tracking_code=creative_variant.tracking_code,
        hook_type=creative_variant.hook_type,
        visual_type=creative_variant.visual_type,
        tone=creative_variant.tone,
        call_to_action=creative_variant.call_to_action,
        video_length_seconds=creative_variant.video_length_seconds,
        voiceover_enabled=creative_variant.voiceover_enabled,
        text_density=creative_variant.text_density,
        experiment_config=dict(creative_variant.experiment_config_json or {}),
    )
