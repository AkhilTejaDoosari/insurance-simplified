"""Engine adapters. Each is small, typed by a Protocol, and replaceable on its own.

Readers return the document model; model proposers return Candidates for the verifier.
None of them decides what is verified.
"""

from collections.abc import Iterable
from typing import Any, Protocol

from app.parsing.opendataloader import document_from_odl, odl_version, run_opendataloader
from app.parsing.sandbox import ParseResult, parse_isolated
from app.providers.base import ModelReply
from app.schemas.document import Document


class DocumentReader(Protocol):
    name: str
    version: str

    def read(self, pdf: bytes) -> Document: ...


class PageReader(Protocol):
    """Reads only the given pages (other pages come back without tables)."""

    name: str
    version: str

    def read_pages(self, pdf: bytes, sha: str, pages: list[int]) -> Document: ...


class TextModel(Protocol):
    @property
    def model(self) -> str: ...

    def complete_json(
        self, system: str, user: str, schema_name: str, schema: dict[str, Any], max_tokens: int
    ) -> ModelReply: ...


class VisualModel(Protocol):
    @property
    def model(self) -> str: ...

    def read_pdf_pages(
        self, pdf: bytes, system: str, instruction: str, schema: dict[str, Any], max_tokens: int
    ) -> ModelReply: ...


class ReaderFailedError(RuntimeError):
    pass


def _unwrap(result: ParseResult, name: str) -> Document:
    if result.document is None:
        raise ReaderFailedError(f"{name}: {result.failure} {result.detail}".strip())
    return result.document


def restrict(doc: Document, pages: Iterable[int]) -> Document:
    """The same document with tables kept only on ``pages``."""
    keep = set(pages)
    return doc.model_copy(
        update={
            "pages": [
                p if p.number in keep else p.model_copy(update={"tables": []}) for p in doc.pages
            ]
        }
    )


class OpenDataLoaderPrimary:
    """Stage 1: OpenDataLoader's native Java pass, every page, in the parser sandbox."""

    name = "opendataloader"

    def __init__(self) -> None:
        self.version = odl_version()

    def read(self, pdf: bytes) -> Document:
        return _unwrap(parse_isolated(pdf, "opendataloader"), self.name)


class DoclingViaOpenDataLoader:
    """Stage 2: Docling on chosen pages through OpenDataLoader's own hybrid integration.

    ``hybrid_url`` is a running ``opendataloader-pdf-hybrid`` backend bound to
    127.0.0.1 (start it with ``opendataloader_pdf.hybrid_launcher.HybridServer``, never
    the CLI default of 0.0.0.0: the backend has no authentication). OpenDataLoader's
    own triage is bypassed (``hybrid_mode="full"``) because the pages are chosen by our
    verification gaps; Java fallback is off so a Docling failure is reported as one."""

    name = "docling"

    def __init__(self, hybrid_url: str, docling_version: str = "hybrid") -> None:
        self.hybrid_url = hybrid_url
        self.version = f"odl-{odl_version()}+{docling_version}"

    def read_pages(self, pdf: bytes, sha: str, pages: list[int]) -> Document:
        data = run_opendataloader(pdf, pages=pages, hybrid_url=self.hybrid_url)
        doc = document_from_odl(data, sha, reader=self.name, reader_version=self.version)
        return restrict(doc, pages)


class PdfplumberTables:
    """Stage 3: pdfplumber's own table finder on chosen pages (sandboxed)."""

    name = "pdfplumber"

    def __init__(self) -> None:
        from importlib.metadata import version  # noqa: PLC0415

        self.version = version("pdfplumber")

    def read_pages(self, pdf: bytes, sha: str, pages: list[int]) -> Document:
        return restrict(_unwrap(parse_isolated(pdf, "pdfplumber"), self.name), pages)
