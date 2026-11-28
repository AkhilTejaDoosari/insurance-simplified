"""Run a PDF reader in a separate process with time, memory and page limits.

Native PDF libraries can crash the whole process on a malformed file (the
corpus run on 2026-11-26 saw PyMuPDF segfault on 7 of 37 real documents). The
engine therefore never parses in its own process: a crash, a hang or a memory
blow-up becomes a typed failure for that one document.
"""

import importlib
import json
import multiprocessing as mp
import resource
import sys
from dataclasses import dataclass
from enum import StrEnum
from multiprocessing.connection import Connection, wait
from typing import Any

from app.schemas.document import Document


class ParseFailure(StrEnum):
    CRASHED = "crashed"
    TIMED_OUT = "timed_out"
    TOO_MANY_PAGES = "too_many_pages"
    READER_ERROR = "reader_error"


@dataclass(frozen=True)
class Limits:
    seconds: float = 120.0
    memory_bytes: int = 2 * 1024**3
    max_pages: int = 200


@dataclass(frozen=True)
class ParseResult:
    document: Document | None
    failure: ParseFailure | None = None
    detail: str = ""


def _limit_memory(memory_bytes: int, platform: str = sys.platform) -> None:
    """Cap the child's address space. Linux (the engine image) enforces it; macOS's
    kernel rejects RLIMIT_AS ("current limit exceeds maximum limit"), so on a developer
    Mac the reader would never run - there the time and page limits still apply."""
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    except (ValueError, OSError):
        if platform != "darwin":
            raise


def _child(reader_name: str, pdf: bytes, limits: Limits, conn: Connection) -> None:
    _limit_memory(limits.memory_bytes)
    try:
        reader = _reader(reader_name)
        doc = reader.read(pdf)
        if len(doc.pages) > limits.max_pages:
            conn.send(("too_many_pages", str(len(doc.pages))))
        else:
            conn.send(("ok", doc.model_dump_json()))
    except Exception as exc:
        conn.send(("error", type(exc).__name__))
    finally:
        conn.close()


def _reader(name: str) -> Any:
    if name == "pdfplumber":
        from app.parsing.pdfplumber_reader import PdfplumberReader  # noqa: PLC0415

        return PdfplumberReader()
    if name == "opendataloader":
        from app.parsing.opendataloader import OpenDataLoaderReader  # noqa: PLC0415

        return OpenDataLoaderReader()
    if name == "pymupdf":  # evaluation only
        from app.parsing.pymupdf_reader import PymupdfReader  # noqa: PLC0415

        return PymupdfReader()
    if ":" in name:  # "package.module:Class" (tests and new readers under evaluation)
        module, attr = name.split(":", 1)
        return getattr(importlib.import_module(module), attr)()
    raise ValueError(f"unknown reader {name!r}")


# The JVM reserves far more address space than it uses (measured peak RSS 555 MB on the
# largest validation PDF), so a 2 GiB address-space cap stops it from starting.
READER_LIMITS: dict[str, Limits] = {
    "opendataloader": Limits(seconds=180.0, memory_bytes=4 * 1024**3),
}


def parse_isolated(
    pdf: bytes, reader_name: str = "pdfplumber", limits: Limits | None = None
) -> ParseResult:
    limits = limits or READER_LIMITS.get(reader_name, Limits())
    ctx = mp.get_context("spawn")  # fresh interpreter: no shared state with the engine
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(reader_name, pdf, limits, child), daemon=True)
    proc.start()
    child.close()
    # Wait on the pipe AND the process: a child that dies early (native crash at start-up)
    # may never close the pipe from the parent's point of view.
    ready = wait([parent, proc.sentinel], timeout=limits.seconds)
    if not ready:
        proc.kill()
        proc.join()
        return ParseResult(None, ParseFailure.TIMED_OUT, f"after {limits.seconds:.0f}s")
    if not parent.poll(0):
        proc.join()
        return ParseResult(None, ParseFailure.CRASHED, f"exit {proc.exitcode}")
    try:
        status, payload = parent.recv()
    except EOFError:  # died while sending
        proc.join()
        return ParseResult(None, ParseFailure.CRASHED, f"exit {proc.exitcode}")
    proc.join()
    if status == "ok":
        return ParseResult(Document.model_validate(json.loads(payload)))
    if status == "too_many_pages":
        return ParseResult(None, ParseFailure.TOO_MANY_PAGES, payload)
    return ParseResult(None, ParseFailure.READER_ERROR, payload)
