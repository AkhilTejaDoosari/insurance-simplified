"""What a model sees: independent page text, cross-page context, original pages.

Page text comes from the PDF's own text layer (the same words the verifier checks
against), laid out by position so table columns stay visually apart, with drawn
vertical rules marked as ``|``. A model therefore reads the source, not a parser's
possibly wrong table reconstruction. Parser tables are added only as labelled hints.
"""

import io
from collections.abc import Iterable, Mapping, Sequence

from app.reconcile.layout import PageLayout
from app.schemas.document import Document

CHARS_PER_LINE = 180


def layout_text(layout: PageLayout, max_chars: int) -> str:
    """The page's words placed on a character grid by their x position; ``|`` where a
    vertical ruling line crosses the line. Truncated (marked) at ``max_chars``."""
    scale = CHARS_PER_LINE / max(layout.width, 1.0)
    lines: list[list[tuple[float, float, float, str]]] = []
    for w in sorted(layout.words, key=lambda w: (w.box.top, w.box.x0)):
        if lines and abs(lines[-1][0][0] - w.box.top) <= 2.5:
            lines[-1].append((w.box.top, w.box.x0, w.box.bottom, w.text))
        else:
            lines.append([(w.box.top, w.box.x0, w.box.bottom, w.text)])
    out: list[str] = []
    for line in lines:
        top, bottom = min(t for t, *_ in line), max(b for *_, b, _ in line)
        row = [" "] * (CHARS_PER_LINE + 40)
        for r in layout.v_rules:
            if r.a <= top + 1 and r.b >= bottom - 1:
                col = int(r.at * scale)
                if 0 <= col < len(row):
                    row[col] = "|"
        cursor = 0
        for _, x0, _, text in sorted(line, key=lambda t: t[1]):
            col = max(int(x0 * scale), cursor)
            if col + len(text) > len(row):
                row.extend([" "] * (col + len(text) - len(row) + 1))
            row[col : col + len(text)] = list(text)
            cursor = col + len(text) + 1
        out.append("".join(row).rstrip())
    text = "\n".join(out)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n[... page text truncated ...]"
    return text


def with_context(
    targets: Iterable[int], n_pages: int, previous: bool, following: set[int]
) -> list[int]:
    """Target pages plus the page before each (a continued table takes its header from
    there) and the page after where a cell continues onto it."""
    pages: set[int] = set()
    for p in targets:
        pages.add(p)
        if previous and p > 1:
            pages.add(p - 1)
        if p in following and p < n_pages:
            pages.add(p + 1)
    return sorted(pages)


def tables_hint(documents: Mapping[str, Document], page: int, max_chars: int) -> str:
    """Parser tables on a page as plain rows, labelled as unverified hints."""
    parts: list[str] = []
    for reader, doc in documents.items():
        if page > len(doc.pages):
            continue
        for table in doc.pages[page - 1].tables:
            heads = {c.id: " / ".join(h for h in c.header_path if h) for c in table.columns}
            rows = {r.id: r for r in table.rows}
            lines = [f"[{reader} table {table.id}, unverified]"]
            for cell in table.cells:
                row = rows[cell.row_id]
                label = " > ".join([*row.group_labels, row.label])
                lines.append(f"- row: {label} | column: {heads[cell.column_id]} | {cell.text}")
            parts.append("\n".join(lines))
    text = "\n".join(parts)
    return text[:max_chars] + ("\n[... truncated ...]" if len(text) > max_chars else "")


def page_subset_pdf(pdf: bytes, pages: Sequence[int]) -> bytes:
    """A new PDF holding only ``pages`` (1-based, in order). Built from scratch with
    pdfium: the source's document metadata (title, author, XMP) is not carried over."""
    import pypdfium2 as pdfium  # noqa: PLC0415 - pdfplumber's own renderer

    src = pdfium.PdfDocument(pdf)
    dst = pdfium.PdfDocument.new()
    try:
        dst.import_pages(src, [p - 1 for p in pages])
        buf = io.BytesIO()
        dst.save(buf)
        return buf.getvalue()
    finally:
        dst.close()
        src.close()
