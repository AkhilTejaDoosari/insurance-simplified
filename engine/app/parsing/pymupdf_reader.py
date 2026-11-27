"""PyMuPDF reader — AGPL-3.0, EVALUATION ONLY.

Installed only with `uv sync --group parser-eval`. It must not be imported by
runtime code or shipped until the owner approves the AGPL license
(docs/v2/parser-evaluation.md, decision rule 1).
"""

from typing import Any

from app.parsing.base import line_blocks, printed_label, sha256
from app.parsing.grid import table_from_grid
from app.schemas.common import Market
from app.schemas.document import Document, Page, ParserInfo, Table


class PymupdfReader:
    def __init__(self) -> None:
        import pymupdf  # noqa: PLC0415 - optional, evaluation-only dependency

        self._pymupdf: Any = pymupdf  # typed loosely: absent in the default environment
        self.info = ParserInfo(name="pymupdf", version=pymupdf.VersionBind)

    def read(self, pdf: bytes) -> Document:
        pages = []
        with self._pymupdf.open(stream=pdf, filetype="pdf") as doc:
            for number, page in enumerate(doc, start=1):
                text = page.get_text("text", sort=True)
                pages.append(
                    Page(
                        number=number,
                        printed_label=printed_label(text),
                        width=float(page.rect.width),
                        height=float(page.rect.height),
                        readable=bool(text.strip()),
                        text=text,
                        blocks=line_blocks(text, number),
                        tables=_tables(page, number, text),
                    )
                )
        return Document(
            sha256=sha256(pdf),
            market=Market.US,
            currency="USD",
            language="en",
            parser=self.info,
            pages=pages,
        )


def _tables(page: Any, number: int, text: str) -> list[Table]:
    found = page.find_tables().tables or page.find_tables(strategy="text").tables
    out = []
    for i, t in enumerate(found):
        table = table_from_grid(t.extract(), number, f"p{number}t{i}", text)
        if table:
            out.append(table)
    return out
