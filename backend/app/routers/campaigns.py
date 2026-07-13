from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.campaigns import (
    CampaignCreate,
    CampaignListResponse,
    CampaignResponse,
    CampaignUpdate,
    CreativeVariantCreate,
    CreativeVariantResponse,
)
from app.services.access_service import require_app_access
from app.services.campaign_service import (
    CampaignConflictError,
    CampaignNotFoundError,
    create_campaign,
    create_creative_variant,
    get_campaign,
    list_campaigns,
    list_variants_for_campaign,
    update_campaign,
)

router = APIRouter(prefix="/campaigns", tags=["campaigns"], dependencies=[Depends(require_app_access)])


@router.post("", response_model=CampaignResponse)
def create_campaign_endpoint(payload: CampaignCreate, db: Session = Depends(get_db)):
    try:
        return create_campaign(db, payload)
    except CampaignConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("", response_model=CampaignListResponse)
def list_campaigns_endpoint(db: Session = Depends(get_db)):
    return CampaignListResponse(items=list_campaigns(db))


@router.get("/{campaign_id}", response_model=CampaignResponse)
def get_campaign_endpoint(campaign_id: str, db: Session = Depends(get_db)):
    try:
        return get_campaign(db, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{campaign_id}", response_model=CampaignResponse)
def update_campaign_endpoint(campaign_id: str, payload: CampaignUpdate, db: Session = Depends(get_db)):
    try:
        return update_campaign(db, campaign_id, payload)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CampaignConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{campaign_id}/variants", response_model=CreativeVariantResponse)
def create_campaign_variant_endpoint(campaign_id: str, payload: CreativeVariantCreate, db: Session = Depends(get_db)):
    try:
        return create_creative_variant(db, campaign_id, payload)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CampaignConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{campaign_id}/variants", response_model=list[CreativeVariantResponse])
def list_campaign_variants_endpoint(campaign_id: str, db: Session = Depends(get_db)):
    try:
        return list_variants_for_campaign(db, campaign_id)
    except CampaignNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
