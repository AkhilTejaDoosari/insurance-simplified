"""Reader adapters: every PDF reader emits the same document model (one-way door #2).

A reader is a two-way door: swapping it is configuration + re-run. Shared
helpers here turn a reader's raw table grid into the model's rows, columns and
header paths, and find printed page labels, so the readers are compared on
what they actually read rather than on post-processing differences.
"""

import hashlib
import re
from collections.abc import Sequence
from typing import Protocol

from app.schemas.document import (
    Block,
    BlockKind,
    Document,
    ParserInfo,
    TextSpan,
)

Grid = Sequence[Sequence[str | None]]


class PdfReader(Protocol):
    info: ParserInfo

    def read(self, pdf: bytes) -> Document: ...


def sha256(pdf: bytes) -> str:
    return hashlib.sha256(pdf).hexdigest()


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


from app.parsing.grid import find_span, table_from_grid  # noqa: E402, F401 - re-exported

_PRINTED = (
    re.compile(r"^\s*page\s+(\d+|[ivxlc]+)(?:\s+of\s+\d+)?\s*$", re.I),
    re.compile(r"^\s*(\d{1,3})\s*$"),
    re.compile(r"^.*\|\s*page\s+(\d+)\s*$", re.I),
)


def printed_label(page_text: str) -> str | None:
    """Printed page number from the first or last lines of the page, if any."""
    lines = [ln for ln in page_text.splitlines() if ln.strip()]
    for line in lines[-3:][::-1] + lines[:2]:
        for pattern in _PRINTED:
            m = pattern.match(line)
            if m:
                return m.group(1)
    return None


def line_blocks(text: str, number: int) -> list[Block]:
    """One block per non-empty line, in the reader's order (layout blocks come later)."""
    blocks, offset = [], 0
    for i, line in enumerate(text.split("\n")):
        if line.strip():
            span = TextSpan(page=number, start=offset, end=offset + len(line))
            blocks.append(
                Block(id=f"p{number}b{i}", kind=BlockKind.PARAGRAPH, span=span, reading_order=i)
            )
        offset += len(line) + 1
    return blocks
