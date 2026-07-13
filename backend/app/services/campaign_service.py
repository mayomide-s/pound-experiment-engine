from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Campaign, CreativeVariant
from app.schemas.campaigns import CampaignCreate, CampaignUpdate, CreativeVariantCreate


class CampaignNotFoundError(ValueError):
    """Raised when a campaign does not exist."""


class CampaignConflictError(RuntimeError):
    """Raised when a campaign or creative variant hits a uniqueness conflict."""


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
