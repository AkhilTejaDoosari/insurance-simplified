"""pdfplumber reader (MIT). Ruled tables first; whitespace-aligned tables as a fallback."""

import io
from importlib.metadata import version
from typing import Any

import pdfplumber

from app.parsing.base import line_blocks, printed_label, sha256
from app.parsing.grid import TableAssembler
from app.schemas.common import Market
from app.schemas.document import Document, Page, ParserInfo, Table

_TEXT_SETTINGS: dict[str, Any] = {"vertical_strategy": "text", "horizontal_strategy": "text"}


class PdfplumberReader:
    info = ParserInfo(name="pdfplumber", version=version("pdfplumber"))

    def read(self, pdf: bytes) -> Document:
        pages = []
        tables = TableAssembler()
        with pdfplumber.open(io.BytesIO(pdf)) as doc:
            for number, page in enumerate(doc.pages, start=1):
                text = page.extract_text() or ""
                pages.append(
                    Page(
                        number=number,
                        printed_label=printed_label(text),
                        width=float(page.width),
                        height=float(page.height),
                        readable=bool(text.strip()),
                        text=text,
                        blocks=line_blocks(text, number),
                        tables=_tables(page, number, text, tables),
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


def _tables(page: Any, number: int, text: str, assembler: TableAssembler) -> list[Table]:
    grids = [t.extract() for t in page.find_tables()]
    if not grids:
        grids = [t.extract() for t in page.find_tables(_TEXT_SETTINGS)]
    out = []
    for i, grid in enumerate(grids):
        table = assembler.add(grid, number, f"p{number}t{i}", text)
        if table:
            out.append(table)
    return out
