"""Durable job lifecycle (stored in Postgres; no queue product)."""

from enum import StrEnum

from pydantic import Field

from app.schemas.common import ContractModel, Identifier


class JobState(StrEnum):
    UPLOADED = "uploaded"
    PARSING = "parsing"
    EXTRACTING = "extracting"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL = frozenset({JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED})
_FORWARD = {
    JobState.UPLOADED: JobState.PARSING,
    JobState.PARSING: JobState.EXTRACTING,
    JobState.EXTRACTING: JobState.VERIFYING,
    JobState.VERIFYING: JobState.COMPLETED,
}


def can_transition(current: JobState, new: JobState) -> bool:
    """Forward one step, or fail / cancel from any non-terminal state. A retry stays put."""
    if current in TERMINAL:
        return False
    if new in {JobState.FAILED, JobState.CANCELLED}:
        return True
    return new is current or _FORWARD.get(current) is new


class Job(ContractModel):
    id: Identifier
    session_id: Identifier
    state: JobState
    progress: int = Field(ge=0, le=100)
    attempt: int = Field(ge=1)
    checkpoint: str | None = None
    error_code: str | None = Field(default=None, description="Code only; never document text.")
