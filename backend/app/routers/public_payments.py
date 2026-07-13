from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.payments import (
    PublicCheckoutSessionCreateRequest,
    PublicCheckoutSessionResponse,
    PublicCheckoutStatusResponse,
)
from app.services.payment_service import (
    CheckoutSessionRecordNotFoundError,
    PublicExperimentCampaignNotFoundError,
    StripeUnavailableError,
    create_public_checkout_session,
    serialize_public_checkout_status,
)


router = APIRouter(prefix="/public/checkout-sessions", tags=["public-payments"])


@router.post("", response_model=PublicCheckoutSessionResponse)
def create_public_checkout_session_endpoint(
    payload: PublicCheckoutSessionCreateRequest,
    db: Session = Depends(get_db),
):
    try:
        _record, response = create_public_checkout_session(db, source_code=payload.source_code)
        return PublicCheckoutSessionResponse(**response)
    except StripeUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except PublicExperimentCampaignNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/{checkout_session_id}", response_model=PublicCheckoutStatusResponse)
def get_public_checkout_session_status_endpoint(
    checkout_session_id: str,
    db: Session = Depends(get_db),
):
    try:
        return serialize_public_checkout_status(db, checkout_session_id)
    except CheckoutSessionRecordNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
