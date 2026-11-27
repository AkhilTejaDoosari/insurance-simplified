"""Liveness, readiness and version metadata."""

from typing import Literal

from fastapi import APIRouter, Depends

from app import __version__
from app.core.auth import require_service_token
from app.schemas import CONTRACT_VERSION
from app.schemas.common import ContractModel
from app.schemas.document import DOCUMENT_MODEL_VERSION

router = APIRouter()


class Health(ContractModel):
    ok: Literal[True] = True


class Meta(ContractModel):
    engine_version: str
    contract_version: str
    document_model_version: str


@router.get("/health", response_model=Health, tags=["health"])
def health() -> Health:
    return Health()


@router.get("/ready", response_model=Health, tags=["health"])
def ready() -> Health:
    # Grows with real dependencies (database, storage) in later work packages.
    return Health()


@router.get(
    "/v1/meta",
    response_model=Meta,
    tags=["meta"],
    dependencies=[Depends(require_service_token)],
)
def meta() -> Meta:
    return Meta(
        engine_version=__version__,
        contract_version=CONTRACT_VERSION,
        document_model_version=DOCUMENT_MODEL_VERSION,
    )
