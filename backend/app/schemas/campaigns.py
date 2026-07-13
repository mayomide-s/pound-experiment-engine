from __future__ import annotations

from datetime import datetime
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import CampaignStatus


SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CampaignBase(BaseModel):
    name: str | None = None
    slug: str | None = None
    core_question: str | None = None
    description: str | None = None
    landing_page_url: str | None = None
    currency: str | None = None
    target_amount_minor: int | None = None
    target_reach: int | None = None
    status: CampaignStatus | None = None
    content_rules_json: dict[str, Any] | None = None
    target_platforms_json: list[str] | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not SLUG_PATTERN.fullmatch(value):
            raise ValueError("slug must contain only lowercase letters, numbers, and hyphens")
        return value

    @field_validator("target_reach")
    @classmethod
    def validate_target_reach(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("target_reach must be greater than zero")
        return value

    @field_validator("target_amount_minor")
    @classmethod
    def validate_target_amount_minor(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("target_amount_minor must be greater than zero")
        return value

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("currency must be a 3-letter code")
        return normalized


class CampaignCreate(CampaignBase):
    name: str
    slug: str
    core_question: str
    currency: str = "GBP"
    target_amount_minor: int = 100
    target_reach: int = 10000000
    status: CampaignStatus = CampaignStatus.DRAFT
    content_rules_json: dict[str, Any] = Field(default_factory=dict)
    target_platforms_json: list[str] = Field(default_factory=list)


class CampaignUpdate(CampaignBase):
    pass


class CampaignResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    core_question: str
    description: str | None = None
    landing_page_url: str | None = None
    currency: str
    target_amount_minor: int
    target_reach: int
    status: CampaignStatus
    content_rules_json: dict[str, Any] = Field(default_factory=dict)
    target_platforms_json: list[str] = Field(default_factory=list)
    start_date: datetime | None = None
    end_date: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CampaignListResponse(BaseModel):
    items: list[CampaignResponse] = Field(default_factory=list)


class CreativeVariantCreate(BaseModel):
    hook_type: str
    visual_type: str
    tone: str
    call_to_action: str
    video_length_seconds: int | None = None
    voiceover_enabled: bool = False
    text_density: str | None = None
    tracking_code: str
    experiment_config_json: dict[str, Any] = Field(default_factory=dict)

    @field_validator("video_length_seconds")
    @classmethod
    def validate_video_length_seconds(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("video_length_seconds must be greater than zero")
        return value


class CreativeVariantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    campaign_id: str
    hook_type: str
    visual_type: str
    tone: str
    call_to_action: str
    video_length_seconds: int | None = None
    voiceover_enabled: bool
    text_density: str | None = None
    tracking_code: str
    experiment_config_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
