"""WP5 background jobs: the engine worker loop.

    uv run python -m app.jobs.worker            # ENGINE_WEB_URL, ENGINE_SERVICE_TOKEN

The web app owns the jobs table and the PDFs (owner decision 2026-11-28); this worker
holds no database or storage credential. It asks the web app's internal job API for work
with the shared service token:

1. claim the next job (a time-limited lease; another worker never gets the same job);
2. fetch that job's PDF (only the lease holder may);
3. read it with ``extract_pdf`` - the same read as ``POST /v1/extract`` - reporting each
   stage (parsing -> extracting -> verifying) as a heartbeat that extends the lease and
   answers whether the user cancelled;
4. finish it: completed with the extraction, failed with a short code, or cancelled.

A worker killed mid-job stops renewing its lease; once it expires the job is claimed
again (attempt + 1, up to the job's max attempts). A worker that loses its lease stops
and its late reports are refused. Model use follows the job's consent and the
deployment's cloud policy exactly as in the synchronous endpoint.
"""

import json
import logging
import os
import signal
import socket
import threading
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

from app.api.extract import CONSENT_PROVIDERS, extract_pdf, model_access
from app.parsing.base import sha256
from app.schemas.extraction import Extraction

log = logging.getLogger("engine.jobs")

RUNNING = ("parsing", "extracting", "verifying")


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    session_id: str
    document_id: str
    cloud_consent: bool
    attempt: int


class LeaseLostError(Exception):
    """This worker no longer holds the job (it expired and another worker took it, or
    the job already ended). Stop without reporting."""


class JobCancelledError(BaseException):
    """The user cancelled. A BaseException so no ``except Exception`` in the read
    swallows it on its way out."""


class JobSource(Protocol):
    def claim(self, worker: str) -> ClaimedJob | None: ...
    def document(self, job: ClaimedJob, worker: str) -> bytes: ...
    def progress(self, job: ClaimedJob, worker: str, status: str) -> bool: ...
    def finish(
        self,
        job: ClaimedJob,
        worker: str,
        status: str,
        result: dict[str, Any] | None,
        error: str | None,
    ) -> None: ...


Reader = Callable[[bytes, ClaimedJob, Callable[[str], None]], Extraction]


def read_document(pdf: bytes, job: ClaimedJob, progress: Callable[[str], None]) -> Extraction:
    """The synchronous endpoint's read, with the job's consent ("anthropic, openai")."""
    access = model_access(sha256(pdf), CONSENT_PROVIDERS if job.cloud_consent else None)
    return extract_pdf(
        pdf,
        job.document_id,
        access.authorization,
        text_model=access.text_model,
        gpt_model=access.gpt_model,
        tokens=access.tokens,
        spend=access.spend,
        progress=progress,
    )


def stage_of(message: str) -> str | None:
    """Pipeline progress line -> job stage (model reading, then checking)."""
    first = message.split(" ", 1)[0]
    if first in ("text", "visual"):
        return "extracting"
    if first in ("judge", "plain"):
        return "verifying"
    return None


def run_job(source: JobSource, worker: str, job: ClaimedJob, read: Reader = read_document) -> str:
    """Process one claimed job to its end. Returns the final status ("lease_lost" when
    another worker took it over: nothing is reported then)."""
    current = ["parsing"]

    def report(status: str) -> None:
        if source.progress(job, worker, status):
            raise JobCancelledError
        current[0] = status

    def on_progress(message: str) -> None:
        stage = stage_of(message)
        if stage and RUNNING.index(stage) > RUNNING.index(current[0]):
            report(stage)

    try:
        report("parsing")
        pdf = source.document(job, worker)
        extraction = read(pdf, job, on_progress)
        report("verifying")
        source.finish(job, worker, "completed", extraction.model_dump(mode="json"), None)
        return "completed"
    except JobCancelledError:
        source.finish(job, worker, "cancelled", None, None)
        return "cancelled"
    except LeaseLostError:
        log.info("job lease lost", extra={"job": job.id})
        return "lease_lost"
    except Exception as exc:  # the read failed: record a short code, never document text
        code = getattr(exc, "code", None) or type(exc).__name__
        try:
            source.finish(job, worker, "failed", None, str(code)[:64])
        except LeaseLostError:
            return "lease_lost"
        return "failed"


def run_once(source: JobSource, worker: str, read: Reader = read_document) -> str | None:
    """Claim and process one job. None when there was nothing to do."""
    job = source.claim(worker)
    if job is None:
        return None
    return run_job(source, worker, job, read)


# ------------------------------------------------------------------ the web app's API


class WebJobSource:
    """The web app's internal job API (``/api/internal/jobs/...``), service token."""

    def __init__(self, base_url: str, token: str, timeout_s: float = 60.0) -> None:
        if not base_url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
            raise ValueError("ENGINE_WEB_URL must be https (or a local address)")
        self.base = base_url.rstrip("/")
        self.token = token
        self.timeout_s = timeout_s

    def _call(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> tuple[int, bytes]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(  # noqa: S310 - scheme checked in __init__
            f"{self.base}{path}",
            data=data,
            method=method,
            headers={
                "authorization": f"Bearer {self.token}",
                **({"content-type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as res:  # noqa: S310
                return res.status, res.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                raise LeaseLostError from None
            raise RuntimeError(
                f"job api {method} {path.split('?', maxsplit=1)[0]}: {exc.code}"
            ) from None

    def claim(self, worker: str) -> ClaimedJob | None:
        status, raw = self._call("POST", "/api/internal/jobs/claim", {"worker": worker})
        if status == 204 or not raw:
            return None
        j = json.loads(raw)["job"]
        return ClaimedJob(
            j["id"], j["sessionId"], j["documentId"], bool(j["cloudConsent"]), int(j["attempt"])
        )

    def document(self, job: ClaimedJob, worker: str) -> bytes:
        _, raw = self._call(
            "GET",
            f"/api/internal/jobs/{quote(job.id)}/document?worker={quote(worker)}",
        )
        return raw

    def progress(self, job: ClaimedJob, worker: str, status: str) -> bool:
        _, raw = self._call(
            "POST",
            f"/api/internal/jobs/{quote(job.id)}/progress",
            {"worker": worker, "status": status},
        )
        return bool(json.loads(raw).get("cancel"))

    def finish(
        self,
        job: ClaimedJob,
        worker: str,
        status: str,
        result: dict[str, Any] | None,
        error: str | None,
    ) -> None:
        self._call(
            "POST",
            f"/api/internal/jobs/{quote(job.id)}/finish",
            {"worker": worker, "status": status, "result": result, "errorCode": error},
        )


def main() -> int:
    logging.basicConfig(level=os.environ.get("ENGINE_LOG_LEVEL", "INFO"))
    base = os.environ.get("ENGINE_WEB_URL", "")
    token = os.environ.get("ENGINE_SERVICE_TOKEN", "")
    if not base or not token:
        log.error("ENGINE_WEB_URL and ENGINE_SERVICE_TOKEN are required")
        return 2
    source = WebJobSource(base, token)
    worker = f"{socket.gethostname()[:40]}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    idle_s = float(os.environ.get("ENGINE_JOB_POLL_SECONDS", "3"))
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    log.info("job worker started")
    while not stop.is_set():
        try:
            outcome = run_once(source, worker)
        except Exception as exc:  # the web app is unreachable: wait and try again
            log.warning("job api unavailable: %s", type(exc).__name__)
            outcome = None
        if outcome is None:
            stop.wait(idle_s)
        else:
            log.info("job ended: %s", outcome)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "ClaimedJob",
    "JobCancelledError",
    "JobSource",
    "LeaseLostError",
    "WebJobSource",
    "read_document",
    "run_job",
    "run_once",
    "stage_of",
]
