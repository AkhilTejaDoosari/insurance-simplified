"""Convert other readers' output into the engine's document model for scoring (WP4).

Readers that need model downloads or a JVM run outside the engine (Docling in the
private corpus repo's CI, OpenDataLoader as a Java CLI). Their tables are turned
into the same grid the engine's own structure rules read, so every reader is
compared on what it found, not on post-processing differences.

    uv run python -m evaluation.import_external docling   <docling-json-dir> <out-dir>
    uv run python -m evaluation.import_external opendataloader <odl-json-dir> <out-dir>
"""

import json
import sys
from pathlib import Path
from typing import Any

from app.parsing.grid import TableAssembler
from app.parsing.opendataloader import document_from_odl, odl_grid
from app.schemas.common import Market
from app.schemas.document import Document, Page, ParserInfo, Table

Cell = str | None


def _document(
    sha: str, reader: str, version: str, tables: dict[int, list[Table]], n: int
) -> Document:
    pages = [
        Page(number=p, width=612, height=792, readable=True, text="", tables=tables.get(p, []))
        for p in range(1, n + 1)
    ]
    return Document(
        sha256=sha,
        market=Market.US,
        currency="USD",
        language="en",
        parser=ParserInfo(name=reader, version=version),
        pages=pages,
    )


# --- Docling (export_to_dict) ---------------------------------------------------------


def docling_grid(table: dict[str, Any]) -> list[list[Cell]]:
    grid = table["data"]["grid"]
    out: list[list[Cell]] = []
    for r, row in enumerate(grid):
        line: list[Cell] = []
        for c, cell in enumerate(row):
            starts_here = (
                cell.get("start_row_offset_idx", r) == r
                and cell.get("start_col_offset_idx", c) == c
            )
            line.append(cell.get("text", "") if starts_here else None)
        out.append(line)
    return out


def from_docling(doc: dict[str, Any], sha: str) -> Document:
    n = max((int(k) for k in doc.get("pages", {})), default=1)
    tables: dict[int, list[Table]] = {}
    assembler = TableAssembler()
    found = [(t["prov"][0]["page_no"] if t.get("prov") else 1, t) for t in doc.get("tables", [])]
    for i, (page, table) in enumerate(sorted(found, key=lambda pt: pt[0])):
        built = assembler.add(docling_grid(table), page, f"p{page}t{i}", "")
        if built:
            tables.setdefault(page, []).append(built)
    version = str(doc.get("version", "?"))
    return _document(sha, "docling", version, tables, n)


# --- OpenDataLoader (JSON output) -----------------------------------------------------
# The converter lives in the engine (app/parsing/opendataloader.py): the engine runs
# OpenDataLoader itself now; this importer keeps reading JSON produced elsewhere.


def from_opendataloader(doc: dict[str, Any], sha: str) -> Document:
    return document_from_odl(doc, sha)


def main(argv: list[str]) -> int:
    reader, source, target = argv[0], Path(argv[1]), Path(argv[2])
    convert = {"docling": from_docling, "opendataloader": from_opendataloader}[reader]
    target.mkdir(parents=True, exist_ok=True)
    done = 0
    for f in sorted(source.glob("*.json")):
        if f.name.startswith("_"):
            continue
        doc = convert(json.loads(f.read_text()), f.stem)
        (target / f"{f.stem}.json").write_text(doc.model_dump_json())
        done += 1
    print(f"converted {done} {reader} documents into {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))


__all__ = ["docling_grid", "from_docling", "from_opendataloader", "odl_grid"]
