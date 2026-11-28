"""POST /v1/extract: read one plan PDF and return its facts (WP5, synchronous first step).

Local readers only (OpenDataLoader + pdfplumber, both in the parser sandbox), every fact
through the verifier, no cloud model call and nothing stored: the PDF lives only for the
request. Facts that pass every check are VERIFIED; anything else is COULDNT_CONFIRM with
its page and, when the words were found, the printed text and its place on the page.
Lines nobody could settle come back as open items ("check page N").
"""

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from app.core.auth import require_service_token
from app.parsing.base import sha256
from app.reconcile.layout import PageLayout, read_layouts
from app.recovery.clauses import ClauseFact
from app.recovery.coverage import ItemState
from app.recovery.engines import OpenDataLoaderPrimary, PdfplumberTables
from app.recovery.pipeline import Engines, RecoveryPipeline
from app.recovery.present import box_text, column_of, to_contract
from app.recovery.restrictions import VerifiedFact
from app.schemas.document import ParserInfo
from app.schemas.extraction import Extraction, OpenItem, Printed
from app.schemas.facts import Fact

MAX_PDF_BYTES = 25 * 1024 * 1024
_PLAN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
OPEN_STATES = (
    ItemState.NOT_EXTRACTED,
    ItemState.UNRESOLVED,
    ItemState.CONFLICTING,
    ItemState.REJECTED,
)

router = APIRouter()


def extract_pdf(pdf: bytes, plan_id: str) -> Extraction:
    """The whole read, synchronous (called off the event loop)."""
    primary = OpenDataLoaderPrimary()
    pipeline = RecoveryPipeline(Engines(primary, pdfplumber=PdfplumberTables()))
    result = pipeline.run(pdf)  # no authorization: the cloud policy refuses every model
    sha = sha256(pdf)
    layouts = {lay.number: lay for lay in read_layouts(pdf)}
    parser = ParserInfo(name=primary.name, version=primary.version)
    items: list[VerifiedFact | ClauseFact] = [
        *(f for f in result.facts if not f.is_governing_text),
        *result.clauses,
    ]
    facts: list[Fact] = []
    printed: dict[str, Printed] = {}
    for f in items:
        for c in to_contract(
            f,
            f.readings,
            f.judge,
            layouts=layouts,
            document_sha256=sha,
            plan_id=plan_id,
            parser=parser,
        ):
            facts.append(c)
            if c.evidence and (text := _printed(f, layouts)):
                printed[c.id] = Printed(text=text, column_header=column_of(f))
    open_items = [
        OpenItem(page=i.page, state=str(i.state), line=i.line)
        for i in (result.coverage.items if result.coverage else [])
        if i.state in OPEN_STATES
    ]
    calls = sum(
        e.stage in ("text", "visual", "judge") and e.status in ("ok", "failed", "invalid_output")
        for e in result.ledger.entries
    )
    return Extraction(
        document_sha256=sha,
        pages=max(1, len(layouts)),
        parser=parser,
        facts=facts,
        open_items=open_items,
        printed=printed,
        model_calls=calls,
    )


def _printed(item: VerifiedFact | ClauseFact, layouts: dict[int, PageLayout]) -> str:
    """The fact's own printed words: the whole clause as verified, or the words
    inside the value's cell (never a neighbouring column's words)."""
    if isinstance(item, ClauseFact):
        return item.evidence.text
    return box_text(layouts[item.fact.page], item.fact.value_box)


@router.post(
    "/v1/extract",
    response_model=Extraction,
    tags=["extraction"],
    dependencies=[Depends(require_service_token)],
)
async def extract(
    request: Request,
    plan_id: Annotated[str, Query(description="The caller's plan id for these facts.")],
) -> Extraction:
    if not _PLAN_ID.match(plan_id):
        raise HTTPException(422, detail={"code": "BAD_PLAN_ID"})
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/pdf":
        raise HTTPException(415, detail={"code": "PDF_REQUIRED"})
    pdf = await request.body()
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, detail={"code": "PDF_TOO_LARGE"})
    if not pdf.startswith(b"%PDF-"):
        raise HTTPException(415, detail={"code": "PDF_REQUIRED"})
    try:
        return await run_in_threadpool(extract_pdf, pdf, plan_id)
    except HTTPException:
        raise
    except Exception as exc:  # a document the readers cannot open; never echo its content
        raise HTTPException(422, detail={"code": "UNREADABLE_PDF"}) from exc
