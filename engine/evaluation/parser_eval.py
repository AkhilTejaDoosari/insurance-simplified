"""Score readers against truth (WP4 metrics, docs/v2/parser-evaluation.md).

uv run --group parser-eval python -m evaluation.parser_eval
"""

import re
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.parsing.base import PdfReader
from app.schemas.document import Document
from evaluation.synthetic import CellTruth, Fixture, all_fixtures


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def cell_bound(doc: Document, truth: CellTruth) -> bool:
    """A cell with the truth value whose row label and column header path match."""
    page = doc.pages[truth.page - 1]
    want_header = [norm(h) for h in truth.header]
    for table in page.tables:
        columns = {c.id: [norm(h) for h in c.header_path] for c in table.columns}
        rows = {r.id: norm(r.label) for r in table.rows}
        for cell in table.cells:
            path = columns[cell.column_id]
            if (
                norm(cell.text) == norm(truth.value)
                and rows[cell.row_id] == norm(truth.row_label)
                and all(h in path for h in want_header)
            ):
                return True
    return False


def text_found(doc: Document, page: int, passage: str) -> bool:
    return norm(passage) in norm(doc.pages[page - 1].text)


@dataclass
class Score:
    reader: str
    bound: int = 0
    keyed: int = 0
    texts_found: int = 0
    texts: int = 0
    labels_right: int = 0
    labels: int = 0
    seconds_per_page: float = 0.0


def score(name: str, read: Callable[[bytes], Document], fixtures: list[Fixture]) -> Score:
    s = Score(reader=name)
    pages = 0
    started = time.perf_counter()
    for fx in fixtures:
        doc = read(fx.pdf)
        pages += len(doc.pages)
        s.keyed += len(fx.cells)
        s.bound += sum(cell_bound(doc, c) for c in fx.cells)
        s.texts += len(fx.texts)
        s.texts_found += sum(text_found(doc, p, t) for p, t in fx.texts)
        s.labels += len(fx.printed)
        s.labels_right += sum(doc.pages[p - 1].printed_label == v for p, v in fx.printed.items())
    s.seconds_per_page = (time.perf_counter() - started) / max(pages, 1)
    return s


def available_readers() -> list[PdfReader]:
    from app.parsing.pdfplumber_reader import PdfplumberReader  # noqa: PLC0415

    readers: list[PdfReader] = [PdfplumberReader()]
    try:
        from app.parsing.pymupdf_reader import PymupdfReader  # noqa: PLC0415

        readers.append(PymupdfReader())
    except ImportError:
        pass
    return readers


def main() -> int:
    fixtures = all_fixtures()
    print("reader       table binding   text recall   page labels   s/page")
    for reader in available_readers():
        s = score(reader.info.name, reader.read, fixtures)
        print(
            f"{s.reader:<12} {s.bound:>3}/{s.keyed:<11} {s.texts_found:>3}/{s.texts:<9} "
            f"{s.labels_right:>3}/{s.labels:<9} {s.seconds_per_page:.3f}"
        )
    print("Synthetic dev fixtures only: for building readers, not for the decision.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
