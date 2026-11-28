"""WP5 worker loop: lifecycle, cancel, retry, and recovery after a worker dies mid-job.

The job source here is in memory with the same rules as db/migrations/0008 (lease,
attempts, only the lease holder reports, idempotent cancel/retry) on a fake clock; the
SQL functions themselves are tested against Postgres in web/tests/integration. No model
is called: reads have no consent, or are fakes."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.api.extract import extract_pdf
from app.jobs.worker import (
    ClaimedJob,
    LeaseLostError,
    WebJobSource,
    read_document,
    run_job,
    run_once,
    stage_of,
)
from app.schemas.extraction import Extraction
from tests.test_reconcile import _pdf

PDF = _pdf()
LEASE = 1200.0


@dataclass
class Row:
    id: str
    session_id: str
    document_id: str
    status: str = "uploaded"
    consent: bool = False
    attempts: int = 0
    max_attempts: int = 3
    lease_owner: str | None = None
    lease_expires: float = 0.0
    cancel_requested: bool = False
    result: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class MemorySource:
    """extraction_jobs + its functions, in memory, on a fake clock."""

    now: float = 0.0
    rows: list[Row] = field(default_factory=list)
    stages: list[tuple[str, str]] = field(default_factory=list)
    pdf: bytes = PDF
    on_progress: Callable[["MemorySource", Row, str], None] | None = None

    def enqueue(self, *docs: str, consent: bool = False) -> None:
        for d in docs:
            if not any(r.document_id == d for r in self.rows):
                self.rows.append(Row(f"job-{d}", "s1", d, consent=consent))

    def row(self, doc: str) -> Row:
        return next(r for r in self.rows if r.document_id == doc)

    def _running(self, r: Row) -> bool:
        return r.status in ("parsing", "extracting", "verifying")

    def claim(self, worker: str) -> ClaimedJob | None:
        for r in self.rows:
            if self._running(r) and r.lease_expires < self.now and r.attempts >= r.max_attempts:
                r.status, r.error, r.lease_owner = "failed", "too_many_attempts", None
            if self._running(r) and r.lease_expires < self.now and r.cancel_requested:
                r.status, r.lease_owner = "cancelled", None
        for r in self.rows:
            claimable = r.status == "uploaded" or (self._running(r) and r.lease_expires < self.now)
            if claimable and not r.cancel_requested and r.attempts < r.max_attempts:
                r.status, r.attempts, r.lease_owner = "parsing", r.attempts + 1, worker
                r.lease_expires, r.error = self.now + LEASE, None
                return ClaimedJob(r.id, r.session_id, r.document_id, r.consent, r.attempts)
        return None

    def _held(self, job: ClaimedJob, worker: str) -> Row:
        r = next(r for r in self.rows if r.id == job.id)
        if r.lease_owner != worker or not self._running(r):
            raise LeaseLostError
        return r

    def document(self, job: ClaimedJob, worker: str) -> bytes:
        self._held(job, worker)
        return self.pdf

    def progress(self, job: ClaimedJob, worker: str, status: str) -> bool:
        r = self._held(job, worker)
        r.status, r.lease_expires = status, self.now + LEASE
        self.stages.append((job.document_id, status))
        if self.on_progress:
            self.on_progress(self, r, status)
        return r.cancel_requested

    def finish(
        self, job: ClaimedJob, worker: str, status: str, result: Any, error: str | None
    ) -> None:
        r = self._held(job, worker)
        r.status, r.lease_owner = status, None
        r.result = result if status == "completed" else None
        r.error = error if status == "failed" else None

    def cancel(self) -> None:
        for r in self.rows:
            if r.status == "uploaded":
                r.status, r.cancel_requested = "cancelled", True
            elif self._running(r):
                r.cancel_requested = True

    def retry(self) -> None:
        for r in self.rows:
            if r.status in ("failed", "cancelled"):
                r.status, r.attempts, r.cancel_requested = "uploaded", 0, False
                r.result = r.error = r.lease_owner = None


def staged_read(pdf: bytes, job: ClaimedJob, progress: Callable[[str], None]) -> Extraction:
    """The real read (no consent: no model), with the progress lines a model read emits."""
    progress("text anthropic p1: calling")
    progress("judge anthropic: calling")
    return extract_pdf(pdf, job.document_id)


def test_a_job_runs_through_every_stage_to_completed() -> None:
    src = MemorySource()
    src.enqueue("d1")
    assert run_once(src, "w1", staged_read) == "completed"
    r = src.row("d1")
    assert r.status == "completed" and r.attempts == 1 and r.lease_owner is None
    assert [s for _, s in src.stages] == ["parsing", "extracting", "verifying", "verifying"]
    x = Extraction.model_validate(r.result)
    assert x.facts and x.document_sha256  # the engine's own result, stored as is
    assert run_once(src, "w1", staged_read) is None  # nothing left to do


def test_the_real_read_without_consent_calls_no_model() -> None:
    src = MemorySource()
    src.enqueue("d1", consent=False)
    assert run_once(src, "w1", read_document) == "completed"
    x = Extraction.model_validate(src.row("d1").result)
    assert x.model_calls == 0 and not x.checks_incomplete


def test_cancel_mid_job_ends_it_cancelled_and_cancel_is_idempotent() -> None:
    def cancel_when_extracting(s: MemorySource, r: Row, status: str) -> None:
        if status == "extracting":
            s.cancel()

    src = MemorySource(on_progress=cancel_when_extracting)
    src.enqueue("d1", "d2")
    assert run_once(src, "w1", staged_read) == "cancelled"
    assert src.row("d1").status == "cancelled" and src.row("d1").result is None
    assert src.row("d2").status == "cancelled"  # waiting jobs end at once
    src.cancel()  # again: nothing changes
    assert {r.status for r in src.rows} == {"cancelled"}
    assert run_once(src, "w1", staged_read) is None


def test_a_worker_killed_mid_job_is_recovered_by_another() -> None:
    src = MemorySource()
    src.enqueue("d1")
    first = src.claim("w-dead")  # claims, reports, then the process dies
    assert first is not None
    src.progress(first, "w-dead", "extracting")
    src.now += LEASE / 2
    assert run_once(src, "w2", staged_read) is None  # lease still valid: nobody takes it
    src.now += LEASE  # the dead worker never renewed it
    assert run_once(src, "w2", staged_read) == "completed"
    r = src.row("d1")
    assert r.status == "completed" and r.attempts == 2
    with pytest.raises(LeaseLostError):  # the dead worker's late report is refused
        src.finish(first, "w-dead", "failed", None, "late")
    assert src.row("d1").status == "completed"


def test_a_job_that_keeps_dying_fails_after_its_attempts() -> None:
    src = MemorySource()
    src.enqueue("d1")
    for _ in range(3):
        assert src.claim("w-dies") is not None
        src.now += LEASE + 1
    assert src.claim("w2") is None
    assert src.row("d1").status == "failed" and src.row("d1").error == "too_many_attempts"


def test_a_failed_read_is_recorded_and_retry_runs_it_again() -> None:
    def broken(pdf: bytes, job: ClaimedJob, progress: Callable[[str], None]) -> Extraction:
        raise ValueError("unreadable")

    src = MemorySource()
    src.enqueue("d1")
    assert run_once(src, "w1", broken) == "failed"
    assert src.row("d1").error == "ValueError"  # a short code, never document text
    src.retry()
    src.retry()  # idempotent
    assert src.row("d1").status == "uploaded" and src.row("d1").attempts == 0
    assert run_once(src, "w1", staged_read) == "completed"
    src.retry()  # a completed job is untouched
    assert src.row("d1").status == "completed"


def test_a_worker_that_lost_its_lease_stops_without_reporting() -> None:
    src = MemorySource()
    src.enqueue("d1")
    job = src.claim("w1")
    assert job is not None
    src.now += LEASE + 1
    taken = src.claim("w2")  # w1 was too slow: w2 took the job over
    assert taken is not None
    assert run_job(src, "w1", job, staged_read) == "lease_lost"
    assert src.row("d1").lease_owner == "w2" and src.row("d1").status == "parsing"


def test_stage_mapping_and_web_source_rules() -> None:
    assert stage_of("text anthropic p1,2: calling") == "extracting"
    assert stage_of("judge openai: ok 3s") == "verifying"
    assert stage_of("primary opendataloader: ok") is None
    with pytest.raises(ValueError, match="https"):
        WebJobSource("http://example.com", "t")
    WebJobSource("http://127.0.0.1:3000", "t")  # local development only
