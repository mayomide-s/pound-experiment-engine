from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer


def _serialize_utc_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


class PublicCheckoutSessionCreateRequest(BaseModel):
    source_code: str | None = Field(default=None)
    referral_code: str | None = Field(default=None)


class PublicCheckoutSessionResponse(BaseModel):
    checkout_session_id: str
    checkout_url: str


class PublicCheckoutStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: str
    payment_status: str | None = None
    amount_total_minor: int
    currency: str
    campaign_name: str
    completed_at: datetime | None = None
    referral_code: str | None = None

    @field_serializer("completed_at")
    def serialize_completed_at(self, value: datetime | None) -> str | None:
        return _serialize_utc_datetime(value)


class PublicExperimentStatsResponse(BaseModel):
    campaign_slug: str
    participant_count: int
    amount_collected_minor: int
    currency: str
    updated_at: datetime

    @field_serializer("updated_at")
    def serialize_updated_at(self, value: datetime) -> str:
        return _serialize_utc_datetime(value) or ""


class AdminExperimentSourceAnalyticsResponse(BaseModel):
    source_code: str
    checkout_sessions_started: int
    completed_payments: int
    amount_collected_minor: int


class AdminExperimentRecentPaymentResponse(BaseModel):
    completed_at: datetime
    amount_minor: int
    currency: str
    source_code: str

    @field_serializer("completed_at")
    def serialize_completed_at(self, value: datetime) -> str:
        return _serialize_utc_datetime(value) or ""


class AdminExperimentReferralAnalyticsResponse(BaseModel):
    referral_code: str
    checkout_sessions_started: int
    completed_payments: int
    amount_collected_minor: int


class AdminExperimentAnalyticsResponse(BaseModel):
    campaign_slug: str
    checkout_sessions_started: int
    completed_payments: int
    payments_today: int
    amount_collected_minor: int
    currency: str
    conversion_rate: float
    referred_checkout_sessions: int
    referred_completed_payments: int
    referral_conversion_rate: float
    top_sources: list[AdminExperimentSourceAnalyticsResponse]
    top_referrers: list[AdminExperimentReferralAnalyticsResponse]
    recent_payments: list[AdminExperimentRecentPaymentResponse]
