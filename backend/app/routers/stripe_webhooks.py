from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.payment_service import (
    CheckoutSessionRecordNotFoundError,
    CheckoutSessionVerificationError,
    StripeUnavailableError,
    process_stripe_webhook_event,
    validate_and_construct_webhook_event,
)


router = APIRouter(prefix="/webhooks/stripe", tags=["stripe-webhooks"])


@router.post("")
async def stripe_webhook_endpoint(
    request: Request,
    db: Session = Depends(get_db),
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
):
    try:
        payload = await request.body()
        event = validate_and_construct_webhook_event(payload, stripe_signature)
        result = process_stripe_webhook_event(db, event)
        return {
            "received": True,
            "already_processed": result.already_processed,
            "status": result.status,
        }
    except StripeUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except CheckoutSessionVerificationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except CheckoutSessionRecordNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
