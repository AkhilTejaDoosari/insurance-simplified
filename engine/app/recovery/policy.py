"""The privacy boundary for cloud model calls. Default: nothing leaves the engine.

A document's content goes to a cloud provider only when ALL of these hold:

1. the provider is enabled for this deployment (ENGINE_CLOUD_PROVIDERS);
2. its data-retention terms were reviewed and recorded (ENGINE_CLOUD_RETENTION_REVIEWED);
3. this exact document (by SHA-256) carries an authorization naming that provider;
4. customer documents additionally need the owner's deployment-wide approval
   (ENGINE_CLOUD_CUSTOMER_DOCUMENTS=approved). Until that approval exists, only the
   public validation corpus may be sent;
5. customer documents never go to a development-only endpoint (D-036), whatever is
   approved: NVIDIA's free build.nvidia.com trial is one by default
   (ENGINE_CLOUD_DEVELOPMENT_ONLY overrides the list once a production account exists).

Minimum necessary disclosure is enforced by the callers: only gap pages plus one
neighbouring page of context, page text capped per page, page-subset PDFs without the
source file's metadata, and HTTPS only (``app.providers.http.require_secure``). Every
disclosure is recorded in the run's ledger (provider, pages, bytes) - never the content.
"""

import os
from dataclasses import dataclass, field
from enum import StrEnum


class DocumentClass(StrEnum):
    PUBLIC_CORPUS = "public_corpus"  # published plan documents in the validation corpus
    CUSTOMER = "customer"  # anything a user uploaded


@dataclass(frozen=True)
class CloudAuthorization:
    document_sha256: str
    document_class: DocumentClass
    providers: frozenset[str]
    granted_by: str
    purpose: str = "extraction_recovery"


def _names(var: str) -> frozenset[str]:
    return frozenset(p.strip() for p in os.environ.get(var, "").split(",") if p.strip())


@dataclass(frozen=True)
class CloudPolicy:
    enabled_providers: frozenset[str] = field(default_factory=frozenset)
    retention_reviewed: frozenset[str] = field(default_factory=frozenset)
    customer_documents_approved: bool = False
    development_only: frozenset[str] = frozenset({"nvidia"})

    @classmethod
    def from_env(cls) -> "CloudPolicy":
        return cls(
            enabled_providers=_names("ENGINE_CLOUD_PROVIDERS"),
            retention_reviewed=_names("ENGINE_CLOUD_RETENTION_REVIEWED"),
            customer_documents_approved=os.environ.get("ENGINE_CLOUD_CUSTOMER_DOCUMENTS")
            == "approved",
            development_only=_names("ENGINE_CLOUD_DEVELOPMENT_ONLY")
            if "ENGINE_CLOUD_DEVELOPMENT_ONLY" in os.environ
            else frozenset({"nvidia"}),
        )

    def refusal(
        self, provider: str, document_sha256: str, auth: CloudAuthorization | None
    ) -> str | None:
        """None when the call may go ahead; otherwise the first rule it breaks."""
        customer = auth is not None and auth.document_class is DocumentClass.CUSTOMER
        rules = (
            (provider not in self.enabled_providers, "provider_not_enabled"),
            (provider not in self.retention_reviewed, "retention_not_reviewed"),
            (auth is None or auth.document_sha256 != document_sha256, "document_not_authorized"),
            (
                auth is not None and provider not in auth.providers,
                "provider_not_authorized_for_document",
            ),
            (
                customer and provider in self.development_only,
                "development_endpoint_for_customer_document",
            ),
            (customer and not self.customer_documents_approved, "customer_documents_not_approved"),
        )
        return next((reason for broken, reason in rules if broken), None)
