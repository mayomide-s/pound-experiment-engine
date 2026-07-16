from __future__ import annotations

import logging
import re
import secrets
from collections.abc import Sequence
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlencode
from typing import Any

import stripe
from sqlalchemy import case, desc, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import Campaign, CheckoutSessionRecord, CheckoutSessionRecordStatus
from app.schemas.payments import (
    AdminExperimentAnalyticsResponse,
    AdminExperimentRecentPaymentResponse,
    AdminExperimentReferralAnalyticsResponse,
    AdminExperimentSourceAnalyticsResponse,
    PublicCheckoutStatusResponse,
    PublicExperimentStatsResponse,
)


logger = logging.getLogger(__name__)
EXPERIMENT_TYPE = "one-pound-experiment"
DEFAULT_SOURCE_CODE = "direct"
SOURCE_CODE_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}$")
REFERRAL_CODE_PATTERN = re.compile(r"^r_[a-z0-9_-]{1,30}$")
REFERRAL_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
REFERRAL_CODE_TOKEN_LENGTH = 8


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


def normalize_source_code(source_code: str | None) -> str:
    if source_code is None:
        return DEFAULT_SOURCE_CODE
    normalized = str(source_code).strip().lower()
    if not normalized or not SOURCE_CODE_PATTERN.fullmatch(normalized):
        return DEFAULT_SOURCE_CODE
    return normalized


def normalize_referral_code(referral_code: str | None) -> str | None:
    if referral_code is None:
        return None
    normalized = str(referral_code).strip().lower()
    if not normalized or not REFERRAL_CODE_PATTERN.fullmatch(normalized):
        return None
    return normalized


def generate_referral_code() -> str:
    token = "".join(secrets.choice(REFERRAL_CODE_ALPHABET) for _ in range(REFERRAL_CODE_TOKEN_LENGTH))
    return f"r_{token}"


def build_public_checkout_urls(
    settings: Settings | None = None,
    *,
    source_code: str | None = None,
    referral_code: str | None = None,
) -> tuple[str, str]:
    active_settings = ensure_stripe_enabled(settings)
    base_url = active_settings.normalized_public_site_base_url()
    normalized_source_code = normalize_source_code(source_code)
    normalized_referral_code = normalize_referral_code(referral_code)
    query_items: list[tuple[str, str]] = []
    if normalized_source_code != DEFAULT_SOURCE_CODE:
        query_items.append(("source", normalized_source_code))
    if normalized_referral_code:
        query_items.append(("ref", normalized_referral_code))
    extra_query = f"&{urlencode(query_items)}" if query_items else ""
    cancel_query = urlencode([("checkout", "cancelled"), *query_items])
    return (
        f"{base_url}/experiment/thank-you?session_id={{CHECKOUT_SESSION_ID}}{extra_query}",
        f"{base_url}/experiment?{cancel_query}",
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


def create_public_checkout_session(
    db: Session,
    *,
    source_code: str | None = None,
    referral_code: str | None = None,
) -> tuple[CheckoutSessionRecord, dict[str, str]]:
    settings = ensure_stripe_enabled()
    campaign = resolve_public_experiment_campaign(db, settings)
    if campaign.target_amount_minor <= 0:
        raise StripeUnavailableError("The public experiment amount is not configured correctly.")

    normalized_source_code = normalize_source_code(source_code)
    normalized_referral_code = normalize_referral_code(referral_code)
    success_url, cancel_url = build_public_checkout_urls(
        settings,
        source_code=normalized_source_code,
        referral_code=normalized_referral_code,
    )
    metadata = {
        "campaign_id": campaign.id,
        "campaign_slug": campaign.slug,
        "experiment_type": EXPERIMENT_TYPE,
        "source_code": normalized_source_code,
    }
    if normalized_referral_code:
        metadata["referring_referral_code"] = normalized_referral_code
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
            metadata=metadata,
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
        source_code=normalized_source_code,
        referring_referral_code=normalized_referral_code,
        metadata_json={
            "campaign_slug": campaign.slug,
            "experiment_type": EXPERIMENT_TYPE,
            "source_code": normalized_source_code,
            "referring_referral_code": normalized_referral_code,
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
    if isinstance(metadata, dict):
        return metadata
    to_dict_recursive = getattr(metadata, "to_dict_recursive", None)
    if callable(to_dict_recursive):
        converted = to_dict_recursive()
        if isinstance(converted, dict):
            return converted
    to_dict = getattr(metadata, "to_dict", None)
    if callable(to_dict):
        converted = to_dict()
        if isinstance(converted, dict):
            return converted
    return {}


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
    shareable_referral_code = (
        record.referral_code
        if record.status == CheckoutSessionRecordStatus.COMPLETED and record.payment_status == "paid"
        else None
    )
    return PublicCheckoutStatusResponse(
        status=record.status.value if hasattr(record.status, "value") else str(record.status),
        payment_status=record.payment_status,
        amount_total_minor=record.amount_total_minor,
        currency=record.currency,
        campaign_name=campaign_name,
        completed_at=record.completed_at,
        referral_code=shareable_referral_code,
    )


def _successful_completed_filters(campaign_id: str) -> list[Any]:
    return [
        CheckoutSessionRecord.campaign_id == campaign_id,
        CheckoutSessionRecord.status == CheckoutSessionRecordStatus.COMPLETED,
        CheckoutSessionRecord.payment_status == "paid",
    ]


def get_public_experiment_stats(db: Session, settings: Settings | None = None) -> PublicExperimentStatsResponse:
    campaign = resolve_public_experiment_campaign(db, settings)
    participant_count, amount_collected_minor, updated_at = (
        db.query(
            func.count(CheckoutSessionRecord.id),
            func.coalesce(func.sum(CheckoutSessionRecord.amount_total_minor), 0),
            func.max(CheckoutSessionRecord.updated_at),
        )
        .filter(*_successful_completed_filters(campaign.id))
        .one()
    )
    return PublicExperimentStatsResponse(
        campaign_slug=campaign.slug,
        participant_count=int(participant_count or 0),
        amount_collected_minor=int(amount_collected_minor or 0),
        currency=campaign.currency.upper(),
        updated_at=updated_at or campaign.updated_at or campaign.created_at or now_utc(),
    )


def _top_source_rows(db: Session, campaign_id: str) -> Sequence[Any]:
    source_code = func.coalesce(CheckoutSessionRecord.source_code, DEFAULT_SOURCE_CODE)
    successful_case = case(
        (
            (CheckoutSessionRecord.status == CheckoutSessionRecordStatus.COMPLETED)
            & (CheckoutSessionRecord.payment_status == "paid"),
            1,
        ),
        else_=0,
    )
    amount_case = case(
        (
            (CheckoutSessionRecord.status == CheckoutSessionRecordStatus.COMPLETED)
            & (CheckoutSessionRecord.payment_status == "paid"),
            CheckoutSessionRecord.amount_total_minor,
        ),
        else_=0,
    )
    return (
        db.query(
            source_code.label("source_code"),
            func.count(CheckoutSessionRecord.id).label("checkout_sessions_started"),
            func.sum(successful_case).label("completed_payments"),
            func.coalesce(func.sum(amount_case), 0).label("amount_collected_minor"),
        )
        .filter(CheckoutSessionRecord.campaign_id == campaign_id)
        .group_by(source_code)
        .all()
    )


def _top_referrer_rows(db: Session, campaign_id: str) -> Sequence[Any]:
    successful_case = case(
        (
            (CheckoutSessionRecord.status == CheckoutSessionRecordStatus.COMPLETED)
            & (CheckoutSessionRecord.payment_status == "paid"),
            1,
        ),
        else_=0,
    )
    amount_case = case(
        (
            (CheckoutSessionRecord.status == CheckoutSessionRecordStatus.COMPLETED)
            & (CheckoutSessionRecord.payment_status == "paid"),
            CheckoutSessionRecord.amount_total_minor,
        ),
        else_=0,
    )
    return (
        db.query(
            CheckoutSessionRecord.referring_referral_code.label("referral_code"),
            func.count(CheckoutSessionRecord.id).label("checkout_sessions_started"),
            func.sum(successful_case).label("completed_payments"),
            func.coalesce(func.sum(amount_case), 0).label("amount_collected_minor"),
        )
        .filter(
            CheckoutSessionRecord.campaign_id == campaign_id,
            CheckoutSessionRecord.referring_referral_code.isnot(None),
        )
        .group_by(CheckoutSessionRecord.referring_referral_code)
        .all()
    )


def _merged_referral_totals(rows: Sequence[Any]) -> dict[str, dict[str, int]]:
    merged_totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "checkout_sessions_started": 0,
            "completed_payments": 0,
            "amount_collected_minor": 0,
        }
    )
    for row in rows:
        normalized_referral_code = normalize_referral_code(row.referral_code)
        if normalized_referral_code is None:
            continue
        bucket = merged_totals[normalized_referral_code]
        bucket["checkout_sessions_started"] += int(row.checkout_sessions_started or 0)
        bucket["completed_payments"] += int(row.completed_payments or 0)
        bucket["amount_collected_minor"] += int(row.amount_collected_minor or 0)
    return merged_totals


def get_private_experiment_analytics(db: Session, settings: Settings | None = None) -> AdminExperimentAnalyticsResponse:
    campaign = resolve_public_experiment_campaign(db, settings)
    checkout_sessions_started = int(
        db.query(func.count(CheckoutSessionRecord.id))
        .filter(CheckoutSessionRecord.campaign_id == campaign.id)
        .scalar()
        or 0
    )
    completed_payments, amount_collected_minor = (
        db.query(
            func.count(CheckoutSessionRecord.id),
            func.coalesce(func.sum(CheckoutSessionRecord.amount_total_minor), 0),
        )
        .filter(*_successful_completed_filters(campaign.id))
        .one()
    )
    start_of_day = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    payments_today = int(
        db.query(func.count(CheckoutSessionRecord.id))
        .filter(
            *_successful_completed_filters(campaign.id),
            CheckoutSessionRecord.completed_at >= start_of_day,
        )
        .scalar()
        or 0
    )
    merged_referral_totals = _merged_referral_totals(_top_referrer_rows(db, campaign.id))
    referred_checkout_sessions = sum(
        totals["checkout_sessions_started"] for totals in merged_referral_totals.values()
    )
    referred_completed_payments = sum(
        totals["completed_payments"] for totals in merged_referral_totals.values()
    )
    merged_source_totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "checkout_sessions_started": 0,
            "completed_payments": 0,
            "amount_collected_minor": 0,
        }
    )
    for row in _top_source_rows(db, campaign.id):
        normalized_source = normalize_source_code(row.source_code)
        bucket = merged_source_totals[normalized_source]
        bucket["checkout_sessions_started"] += int(row.checkout_sessions_started or 0)
        bucket["completed_payments"] += int(row.completed_payments or 0)
        bucket["amount_collected_minor"] += int(row.amount_collected_minor or 0)
    ordered_sources = [
        AdminExperimentSourceAnalyticsResponse(
            source_code=source_code,
            checkout_sessions_started=totals["checkout_sessions_started"],
            completed_payments=totals["completed_payments"],
            amount_collected_minor=totals["amount_collected_minor"],
        )
        for source_code, totals in sorted(
            merged_source_totals.items(),
            key=lambda item: (
                -item[1]["completed_payments"],
                -item[1]["checkout_sessions_started"],
                item[0],
            ),
        )
    ]
    top_sources = ordered_sources[:10]
    top_referrers = [
        AdminExperimentReferralAnalyticsResponse(
            referral_code=referral_code,
            checkout_sessions_started=totals["checkout_sessions_started"],
            completed_payments=totals["completed_payments"],
            amount_collected_minor=totals["amount_collected_minor"],
        )
        for referral_code, totals in sorted(
            merged_referral_totals.items(),
            key=lambda item: (
                -item[1]["completed_payments"],
                -item[1]["checkout_sessions_started"],
                item[0],
            ),
        )[:10]
    ]
    recent_payments = [
        AdminExperimentRecentPaymentResponse(
            completed_at=record.completed_at or now_utc(),
            amount_minor=record.amount_total_minor,
            currency=record.currency,
            source_code=normalize_source_code(record.source_code),
        )
        for record in (
            db.query(CheckoutSessionRecord)
            .filter(*_successful_completed_filters(campaign.id))
            .order_by(CheckoutSessionRecord.completed_at.desc(), CheckoutSessionRecord.updated_at.desc())
            .limit(20)
            .all()
        )
    ]
    started_count = int(checkout_sessions_started or 0)
    completed_count = int(completed_payments or 0)
    return AdminExperimentAnalyticsResponse(
        campaign_slug=campaign.slug,
        checkout_sessions_started=started_count,
        completed_payments=completed_count,
        payments_today=payments_today,
        amount_collected_minor=int(amount_collected_minor or 0),
        currency=campaign.currency.upper(),
        conversion_rate=(completed_count / started_count) if started_count else 0,
        referred_checkout_sessions=referred_checkout_sessions,
        referred_completed_payments=referred_completed_payments,
        referral_conversion_rate=(
            referred_completed_payments / referred_checkout_sessions
            if referred_checkout_sessions
            else 0
        ),
        top_sources=top_sources,
        source_performance=ordered_sources,
        top_referrers=top_referrers,
        recent_payments=recent_payments,
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
    expected_campaign_id = str(campaign.id or "")
    expected_campaign_slug = str(campaign.slug or "")
    if session_amount_total != campaign.target_amount_minor:
        raise CheckoutSessionVerificationError("Stripe Checkout Session amount mismatch.")
    if session_currency != campaign.currency.upper():
        raise CheckoutSessionVerificationError("Stripe Checkout Session currency mismatch.")
    if session_campaign_id != expected_campaign_id or session_campaign_slug != expected_campaign_slug:
        raise CheckoutSessionVerificationError("Stripe Checkout Session campaign metadata mismatch.")
    if session_experiment_type != EXPERIMENT_TYPE:
        raise CheckoutSessionVerificationError("Stripe Checkout Session experiment metadata mismatch.")


def _assign_referral_code_candidate(db: Session, record: CheckoutSessionRecord) -> None:
    if record.referral_code:
        return
    for _ in range(10):
        candidate = generate_referral_code()
        existing = (
            db.query(CheckoutSessionRecord.id)
            .filter(CheckoutSessionRecord.referral_code == candidate)
            .first()
        )
        if existing is None:
            record.referral_code = candidate
            return
    raise CheckoutSessionVerificationError("Unable to allocate a unique referral code.")


def _needs_referral_code_backfill(record: CheckoutSessionRecord) -> bool:
    return (
        record.status == CheckoutSessionRecordStatus.COMPLETED
        and record.payment_status == "paid"
        and not record.referral_code
    )


def _apply_completed_session_state(db: Session, record: CheckoutSessionRecord, event_id: str, session_obj: Any) -> None:
    metadata = _get_metadata(session_obj)
    metadata_referring_code = normalize_referral_code(str(metadata.get("referring_referral_code") or "") or None)
    record.status = CheckoutSessionRecordStatus.COMPLETED
    record.payment_status = str(_get_object_value(session_obj, "payment_status", "") or "") or None
    record.stripe_payment_intent_id = str(_get_object_value(session_obj, "payment_intent", "") or "") or None
    record.stripe_customer_id = str(_get_object_value(session_obj, "customer", "") or "") or None
    customer_details = _get_object_value(session_obj, "customer_details", {}) or {}
    record.customer_email = str(_get_object_value(customer_details, "email", "") or "") or None
    record.stripe_event_id = event_id
    record.completed_at = record.completed_at or now_utc()
    record.currency = str(_get_object_value(session_obj, "currency", record.currency) or record.currency).upper()
    record.amount_total_minor = int(_get_object_value(session_obj, "amount_total", record.amount_total_minor) or record.amount_total_minor)
    record.source_code = normalize_source_code(str(metadata.get("source_code") or record.source_code or DEFAULT_SOURCE_CODE))
    record.referring_referral_code = metadata_referring_code or record.referring_referral_code
    _assign_referral_code_candidate(db, record)
    record.metadata_json = {
        **(record.metadata_json or {}),
        "campaign_slug": record.campaign.slug if record.campaign else None,
        "experiment_type": EXPERIMENT_TYPE,
        "source_code": record.source_code,
        "referring_referral_code": record.referring_referral_code,
        "referral_code": record.referral_code,
    }


def _is_referral_code_collision(exc: IntegrityError) -> bool:
    return "referral_code" in str(exc).lower()


def process_checkout_session_completed(db: Session, event: Any) -> SafeWebhookProcessingResult:
    session_obj = _get_object_value(_get_object_value(event, "data", {}), "object", {})
    session_id = str(_get_object_value(session_obj, "id", "") or "")
    event_id = str(_get_object_value(event, "id", "") or "")
    if not session_id:
        raise CheckoutSessionVerificationError("Stripe webhook event is missing a checkout session id.")

    record = get_checkout_session_record(db, session_id)
    if record.stripe_event_id == event_id and not _needs_referral_code_backfill(record):
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")
    if record.status == CheckoutSessionRecordStatus.COMPLETED and not _needs_referral_code_backfill(record):
        return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")

    _ensure_checkout_session_matches_campaign(record, record.campaign, session_obj)
    for _ in range(10):
        _apply_completed_session_state(db, record, event_id, session_obj)
        try:
            db.commit()
            break
        except IntegrityError as exc:
            db.rollback()
            if _is_referral_code_collision(exc):
                record = get_checkout_session_record(db, session_id)
                if (
                    (record.stripe_event_id == event_id or record.status == CheckoutSessionRecordStatus.COMPLETED)
                    and not _needs_referral_code_backfill(record)
                ):
                    return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")
                record.referral_code = None
                continue
            logger.info("Stripe webhook already persisted for event %s type %s", event_id, _get_object_value(event, "type"))
            return SafeWebhookProcessingResult(accepted=True, already_processed=True, status="completed")
    else:
        raise CheckoutSessionVerificationError("Unable to persist a unique referral code for this checkout.")
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
