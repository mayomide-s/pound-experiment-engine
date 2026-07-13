from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.payments import AdminExperimentAnalyticsResponse
from app.services.access_service import require_app_access
from app.services.payment_service import (
    PublicExperimentCampaignNotFoundError,
    StripeUnavailableError,
    get_private_experiment_analytics,
)


router = APIRouter(prefix="/admin", tags=["admin-experiment"], dependencies=[Depends(require_app_access)])


@router.get("/experiment-analytics", response_model=AdminExperimentAnalyticsResponse)
def get_admin_experiment_analytics(db: Session = Depends(get_db)):
    try:
        return get_private_experiment_analytics(db)
    except StripeUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except PublicExperimentCampaignNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
