"""Insurer contacts are facts too: verified, with a purpose and a source page."""

from enum import StrEnum

from pydantic import Field

from app.schemas.common import ContractModel, Identifier
from app.schemas.facts import Evidence


class ContactKind(StrEnum):
    PHONE = "phone"
    EMAIL = "email"
    WEBSITE = "website"
    MAILING_ADDRESS = "mailing_address"


class ContactPurpose(StrEnum):
    CUSTOMER_SERVICE = "customer_service"
    CLAIMS = "claims"
    PRE_APPROVAL = "pre_approval"
    EMERGENCY_ASSISTANCE = "emergency_assistance"
    OTHER = "other"


class Contact(ContractModel):
    plan_family_id: Identifier
    kind: ContactKind
    value: str = Field(min_length=1)
    purpose: ContactPurpose
    purpose_label: str | None = Field(default=None, description="The document's own wording.")
    evidence: list[Evidence] = Field(min_length=1)
