from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


SOURCE_CODE_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


class PublicCheckoutSessionCreateRequest(BaseModel):
    source_code: str | None = Field(default=None, max_length=80)

    @field_validator("source_code")
    @classmethod
    def validate_source_code(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not SOURCE_CODE_PATTERN.fullmatch(value):
            raise ValueError("Source code may contain only letters, numbers, hyphen, underscore, and period.")
        return value


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
