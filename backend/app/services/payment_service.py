from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import stripe
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import Campaign, CheckoutSessionRecord, CheckoutSessionRecordStatus
from app.schemas.payments import PublicCheckoutStatusResponse


logger = logging.getLogger(__name__)
EXPERIMENT_TYPE = "one-pound-experiment"


class StripeUnavailableError(RuntimeError):
    """Raised when Stripe is disabled or unavailable."""


class PublicExperimentCampaignNotFoundError(ValueError):
    """Raised when the configured public experiment campaign is missing."""


class CheckoutSessionRecordNotFoundError(ValueError):
    """Raised when a checkout session record is missing."""


class CheckoutSessionVerificationError(RuntimeError):
    """Raised when a Stripe session does not match expected server-side values."""


@dataclass(slots=True)
class SafeWebhookProcessingResult:
    accepted: bool
    already_processed: bool = False
    status: str | None = None


def now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def get_stripe_client():
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    return stripe


def ensure_stripe_enabled(settings: Settings | None = None) -> Settings:
    active_settings = settings or get_settings()
    if not active_settings.stripe_enabled:
        raise StripeUnavailableError("Stripe Checkout is currently unavailable.")
    return active_settings


def resolve_public_experiment_campaign(db: Session, settings: Settings | None = None) -> Campaign:
    active_settings = ensure_stripe_enabled(settings)
    campaign = (
        db.query(Campaign)
        .filter(Campaign.slug == active_settings.public_experiment_campaign_slug)
        .first()
    )
    if campaign is None:
        raise PublicExperimentCampaignNotFoundError("Public experiment campaign is not configured.")
    return campaign


def build_public_checkout_urls(settings: Settings | None = None) -> tuple[str, str]:
    active_settings = ensure_stripe_enabled(settings)
    base_url = active_settings.normalized_public_site_base_url()
    return (
        f"{base_url}/experiment/thank-you?session_id={{CHECKOUT_SESSION_ID}}",
        f"{base_url}/experiment?checkout=cancelled",
    )


def _build_checkout_product(campaign: Campaign) -> dict[str, Any]:
    return {
        "name": f"Voluntary participation in {campaign.name}",
        "description": "No product or charitable donation. Voluntary participation in a transparent internet social experiment.",
    }


def _safe_session_payload(session_obj: Any) -> tuple[str, str]:
    checkout_session_id = str(getattr(session_obj, "id", "") or session_obj["id"])
    checkout_url = str(getattr(session_obj, "url", "") or session_obj["url"])
    if not checkout_session_id or not checkout_url:
        raise StripeUnavailableError("Stripe did not return a usable Checkout Session.")
    return checkout_session_id, checkout_url


def create_public_checkout_session(db: Session, *, source_code: str | None = None) -> tuple[CheckoutSessionRecord, dict[str, str]]:
    settings = ensure_stripe_enabled()
    campaign = resolve_public_experiment_campaign(db, settings)
    if campaign.target_amount_minor <= 0:
        raise StripeUnavailableError("The public experiment amount is not configured correctly.")

    success_url, cancel_url = build_public_checkout_urls(settings)
    client = get_stripe_client()
    try:
        session_obj = client.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": campaign.currency.lower(),
                        "product_data": _build_checkout_product(campaign),
                        "unit_amount": campaign.target_amount_minor,
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "campaign_id": campaign.id,
                "campaign_slug": campaign.slug,
                "experiment_type": EXPERIMENT_TYPE,
                **({"source_code": source_code} if source_code else {}),
            },
        )
    except Exception as exc:
        raise StripeUnavailableError("Stripe Checkout is currently unavailable.") from exc
    checkout_session_id, checkout_url = _safe_session_payload(session_obj)
    record = CheckoutSessionRecord(
        campaign_id=campaign.id,
        stripe_checkout_session_id=checkout_session_id,
        status=CheckoutSessionRecordStatus.OPEN,
        currency=campaign.currency.upper(),
        amount_total_minor=campaign.target_amount_minor,
        payment_status=getattr(session_obj, "payment_status", None) or _get_object_value(session_obj, "payment_status"),
        source_code=source_code,
        metadata_json={
            "campaign_slug": campaign.slug,
            "experiment_type": EXPERIMENT_TYPE,
        },
    )
    db.add(record)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Stripe checkout session persistence failed for session %s", checkout_session_id)
        raise StripeUnavailableError("Checkout session could not be stored safely.")
    db.refresh(record)
    return record, {"checkout_session_id": checkout_session_id, "checkout_url": checkout_url}


def retrieve_checkout_session(checkout_session_id: str):
    ensure_stripe_enabled()
    client = get_stripe_client()
    return client.checkout.Session.retrieve(checkout_session_id)


def _get_object_value(source: Any, key: str, default: Any = None) -> Any:
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def _get_metadata(source: Any) -> dict[str, Any]:
    metadata = _get_object_value(source, "metadata", {}) or {}
    return dict(metadata)


def get_checkout_session_record(db: Session, checkout_session_id: str) -> CheckoutSessionRecord:
    record = (
        db.query(CheckoutSessionRecord)
        .filter(CheckoutSessionRecord.stripe_checkout_session_id == checkout_session_id)
        .first()
    )
    if record is None:
        raise CheckoutSessionRecordNotFoundError("Checkout session not found.")
    return record


def refresh_checkout_status_from_stripe(db: Session, record: CheckoutSessionRecord) -> CheckoutSessionRecord:
    if not get_settings().stripe_enabled or record.status == CheckoutSessionRecordStatus.COMPLETED:
        return record
    try:
        session_obj = retrieve_checkout_session(record.stripe_checkout_session_id)
    except Exception:
        return record

    record.payment_status = _get_object_value(session_obj, "payment_status")
    stripe_status = str(_get_object_value(session_obj, "status", "") or "")
    if stripe_status == "expired":
        record.status = CheckoutSessionRecordStatus.EXPIRED
    elif stripe_status in {"open", "complete"} and record.status == CheckoutSessionRecordStatus.CREATED:
        record.status = CheckoutSessionRecordStatus.OPEN
    db.commit()
    db.refresh(record)
    return record


def serialize_public_checkout_status(db: Session, checkout_session_id: str) -> PublicCheckoutStatusResponse:
    record = refresh_checkout_status_from_stripe(db, get_checkout_session_record(db, checkout_session_id))
    campaign = record.campaign
    campaign_name = campaign.name if campaign else "Experiment"
    return PublicCheckoutStatusResponse(
        status=record.status.value if hasattr(record.status, "value") else str(record.status),
        payment_status=record.payment_status,
        amount_total_minor=record.amount_total_minor,
        currency=record.currency,
        campaign_name=campaign_name,
        completed_at=record.completed_at,
    )


def validate_and_construct_webhook_event(payload: bytes, signature: str | None):
    settings = ensure_stripe_enabled()
    client = get_stripe_client()
    if not signature:
        raise CheckoutSessionVerificationError("Stripe signature header missing.")
    try:
        return client.Webhook.construct_event(payload=payload, sig_header=signature, secret=settings.stripe_webhook_secret)
    except Exception as exc:
        raise CheckoutSessionVerificationError("Stripe webhook signature verification failed.") from exc


def _ensure_checkout_session_matches_campaign(record: CheckoutSessionRecord, campaign: Campaign | None, session_obj: Any) -> None:
    metadata = _get_metadata(session_obj)
    session_campaign_id = str(metadata.get("campaign_id") or "")
    session_campaign_slug = str(metadata.get("campaign_slug") or "")
    session_experiment_type = str(metadata.get("experiment_type") or "")
    session_currency = str(_get_object_value(session_obj, "currency", "") or "").upper()
    session_amount_total = int(_get_object_value(session_obj, "amount_total", 0) or 0)
    session_mode = str(_get_object_value(session_obj, "mode", "") or "")

    if session_mode != "payment":
        raise CheckoutSessionVerificationError("Stripe Checkout Session mode mismatch.")
    if campaign is None:
        raise CheckoutSessionVerificationError("Checkout session campaign record is missing.")
    if session_amount_total != campaign.target_amount_minor:
        raise CheckoutSessionVerificationError("Stripe Checkout Session amount mismatch.")
    if session_currency != campaign.currency.upper():
        raise CheckoutSessionVerificationError("Stripe Checkout Session currency mismatch.")
    if session_campaign_id != campaign.id or session_campaign_slug != campaign.slug:
        raise CheckoutSessionVerificationError("Stripe Checkout Session campaign metadata mismatch.")
    if session_experiment_type != EXPERIMENT_TYPE:
        raise CheckoutSessionVerificationError("Stripe Checkout Session experiment metadata mismatch.")


def process_checkout_session_completed(db: Session, event: Any) -> SafeWebhookProcessingResult:
    session_obj = _get_object_value(_get_object_value(event, "data", {}), "object", {})
    session_id = str(_get_object_value(session_obj, "id", "") or "")
    event_id = str(_get_object_value(event, "id", "") or "")
    if not session_id:
        raise CheckoutSessionVerificationError("Stripe webhook event is missing a checkout session id.")

    record = get_checkout_session_record(db, session_id)
    if record.stripe_event_id == event_id:
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")
    if record.status == CheckoutSessionRecordStatus.COMPLETED:
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")

    _ensure_checkout_session_matches_campaign(record, record.campaign, session_obj)
    record.status = CheckoutSessionRecordStatus.COMPLETED
    record.payment_status = str(_get_object_value(session_obj, "payment_status", "") or "") or None
    record.stripe_payment_intent_id = str(_get_object_value(session_obj, "payment_intent", "") or "") or None
    record.stripe_customer_id = str(_get_object_value(session_obj, "customer", "") or "") or None
    customer_details = _get_object_value(session_obj, "customer_details", {}) or {}
    record.customer_email = str(_get_object_value(customer_details, "email", "") or "") or None
    record.stripe_event_id = event_id
    record.completed_at = now_utc()
    record.currency = str(_get_object_value(session_obj, "currency", record.currency) or record.currency).upper()
    record.amount_total_minor = int(_get_object_value(session_obj, "amount_total", record.amount_total_minor) or record.amount_total_minor)
    record.metadata_json = {
        **(record.metadata_json or {}),
        "campaign_slug": record.campaign.slug if record.campaign else None,
        "experiment_type": EXPERIMENT_TYPE,
    }
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.info("Stripe webhook already persisted for event %s type %s", event_id, _get_object_value(event, "type"))
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")
    db.refresh(record)
    logger.info("Processed Stripe webhook event %s type %s", event_id, _get_object_value(event, "type"))
    return SafeWebhookProcessingResult(accepted=True, status="completed")


def process_checkout_session_expired(db: Session, event: Any) -> SafeWebhookProcessingResult:
    session_obj = _get_object_value(_get_object_value(event, "data", {}), "object", {})
    session_id = str(_get_object_value(session_obj, "id", "") or "")
    event_id = str(_get_object_value(event, "id", "") or "")
    if not session_id:
        raise CheckoutSessionVerificationError("Stripe webhook event is missing a checkout session id.")

    record = get_checkout_session_record(db, session_id)
    if record.stripe_event_id == event_id and record.status == CheckoutSessionRecordStatus.EXPIRED:
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="expired")
    if record.status == CheckoutSessionRecordStatus.COMPLETED:
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")

    record.status = CheckoutSessionRecordStatus.EXPIRED
    record.payment_status = str(_get_object_value(session_obj, "payment_status", "") or "") or record.payment_status
    record.stripe_event_id = record.stripe_event_id or event_id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.info("Stripe webhook already persisted for event %s type %s", event_id, _get_object_value(event, "type"))
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="expired")
    db.refresh(record)
    logger.info("Processed Stripe webhook event %s type %s", event_id, _get_object_value(event, "type"))
    return SafeWebhookProcessingResult(accepted=True, status="expired")


def process_stripe_webhook_event(db: Session, event: Any) -> SafeWebhookProcessingResult:
    event_type = str(_get_object_value(event, "type", "") or "")
    if event_type == "checkout.session.completed":
        return process_checkout_session_completed(db, event)
    if event_type == "checkout.session.expired":
        return process_checkout_session_expired(db, event)
    logger.info("Ignored Stripe webhook event %s type %s", _get_object_value(event, "id"), event_type)
    return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="ignored")
