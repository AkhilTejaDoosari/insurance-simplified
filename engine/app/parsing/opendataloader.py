"""OpenDataLoader PDF (Apache-2.0, Java): the primary table reader, and Docling through it.

OpenDataLoader already routes pages to Docling: its "hybrid" mode sends pages to a
Docling backend (``opendataloader-pdf-hybrid``: Docling with TableFormer in accurate
mode and OCR) and returns the result in OpenDataLoader's own JSON. The engine reuses
that integration instead of driving Docling itself: the native pass reads every page,
and a recovery pass asks OpenDataLoader for *only the pages the verifier could not
settle*, with ``hybrid_mode="full"`` so each of those pages goes to Docling. Both
passes come back in one JSON shape and go through one converter and the same grid rules
as every other reader.

Each call starts a JVM, so it runs in the parser sandbox (time and memory limits) like
any other reader. Output goes to a scratch directory that is removed after the call.
"""

import json
import tempfile
from collections.abc import Iterable, Iterator
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from app.parsing.base import sha256
from app.parsing.grid import TableAssembler
from app.schemas.common import Market
from app.schemas.document import Document, Page, ParserInfo, Table

Cell = str | None


def odl_version() -> str:
    try:
        return version("opendataloader-pdf")
    except PackageNotFoundError:  # pragma: no cover - only without the package
        return "missing"


def _texts(node: Any) -> Iterator[str]:
    if isinstance(node, dict):
        if isinstance(node.get("content"), str):
            yield node["content"]
        for key in ("kids", "rows", "cells", "list items"):
            yield from _texts(node.get(key) or [])
    elif isinstance(node, list):
        for item in node:
            yield from _texts(item)


def _odl_tables(node: Any) -> Iterator[dict[str, Any]]:
    if isinstance(node, dict):
        if node.get("type") == "table":
            yield node
            return
        yield from _odl_tables(node.get("kids") or [])
    elif isinstance(node, list):
        for item in node:
            yield from _odl_tables(item)


def odl_grid(table: dict[str, Any]) -> list[list[Cell]]:
    rows, cols = table["number of rows"], table["number of columns"]
    grid: list[list[Cell]] = [[""] * cols for _ in range(rows)]
    for row in table["rows"]:
        for cell in row["cells"]:
            r, c = cell["row number"] - 1, cell["column number"] - 1
            grid[r][c] = " ".join(_texts(cell.get("kids") or []))
            for dr in range(cell.get("row span", 1)):
                for dc in range(cell.get("column span", 1)):
                    if (dr or dc) and r + dr < rows and c + dc < cols:
                        grid[r + dr][c + dc] = None
    return grid


def document_from_odl(
    doc: dict[str, Any], sha: str, *, reader: str = "opendataloader", reader_version: str = "json"
) -> Document:
    """OpenDataLoader JSON -> document model. Page text stays empty: citations come only
    from the PDF's own text layer (``app.reconcile.layout``), never from a reader."""
    tables: dict[int, list[Table]] = {}
    assembler = TableAssembler()
    found = sorted(_odl_tables(doc.get("kids") or []), key=lambda t: int(t["page number"]))
    for i, table in enumerate(found):
        page = int(table["page number"])
        built = assembler.add(odl_grid(table), page, f"p{page}t{i}", "")
        if built:
            tables.setdefault(page, []).append(built)
    n = int(doc["number of pages"])
    pages = [
        Page(number=p, width=612, height=792, readable=True, text="", tables=tables.get(p, []))
        for p in range(1, n + 1)
    ]
    return Document(
        sha256=sha,
        market=Market.US,
        currency="USD",
        language="en",
        parser=ParserInfo(name=reader, version=reader_version),
        pages=pages,
    )


def page_ranges(pages: Iterable[int]) -> str:
    """[1, 2, 3, 7] -> "1-3,7" (OpenDataLoader's --pages syntax)."""
    out: list[str] = []
    run: list[int] = []
    for p in sorted(set(pages)):
        if run and p == run[-1] + 1:
            run.append(p)
            continue
        if run:
            out.append(f"{run[0]}-{run[-1]}" if len(run) > 1 else str(run[0]))
        run = [p]
    if run:
        out.append(f"{run[0]}-{run[-1]}" if len(run) > 1 else str(run[0]))
    return ",".join(out)


def run_opendataloader(
    pdf: bytes,
    *,
    pages: Iterable[int] | None = None,
    hybrid_url: str | None = None,
    hybrid_timeout_ms: int = 0,
) -> dict[str, Any]:
    """Run the OpenDataLoader CLI on one PDF and return its JSON.

    With ``hybrid_url`` every requested page goes to the Docling backend at that URL
    (``hybrid_mode="full"``; triage is ours, made from verification gaps). Java fallback
    is off on purpose: a Docling failure must surface as a failure, not as a silent
    second native read."""
    import opendataloader_pdf  # noqa: PLC0415 - optional, heavy (JVM launcher)

    kwargs: dict[str, Any] = {"format": "json", "quiet": True, "image_output": "off"}
    if pages is not None:
        kwargs["pages"] = page_ranges(pages)
    if hybrid_url:
        kwargs.update(
            hybrid="docling-fast",
            hybrid_mode="full",
            hybrid_url=hybrid_url,
            hybrid_fallback=False,
        )
        if hybrid_timeout_ms:
            kwargs["hybrid_timeout"] = str(hybrid_timeout_ms)
    with tempfile.TemporaryDirectory(prefix="odl-") as scratch:
        src = Path(scratch) / "in.pdf"
        src.write_bytes(pdf)
        out = Path(scratch) / "out"
        opendataloader_pdf.convert(input_path=str(src), output_dir=str(out), **kwargs)
        produced = list(out.glob("*.json"))
        if len(produced) != 1:
            raise RuntimeError(f"opendataloader produced {len(produced)} JSON files")
        data: dict[str, Any] = json.loads(produced[0].read_text())
        return data


class OpenDataLoaderReader:
    """Native (Java) pass over every page. Used through ``parse_isolated``."""

    info = ParserInfo(name="opendataloader", version=odl_version())

    def read(self, pdf: bytes) -> Document:
        data = run_opendataloader(pdf)
        return document_from_odl(data, sha256(pdf), reader_version=self.info.version)
