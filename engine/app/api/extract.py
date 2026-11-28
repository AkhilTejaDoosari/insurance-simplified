"""POST /v1/extract: read one plan PDF and return its facts (WP5, synchronous first step).

Local readers (OpenDataLoader + pdfplumber, both in the parser sandbox) first, every fact
through the verifier, nothing stored: the PDF lives only for the request. Facts that pass
every check are VERIFIED; anything else is COULDNT_CONFIRM with its page and, when the
words were found, the printed text and its place on the page. Lines nobody could settle
come back as open items ("check page N").

Claude text recovery (owner decision 2026-11-27): on pages the local readers leave
unsettled, Claude proposes table cells, clauses and brochure lines (label, value, page,
quote); the same verifiers decide (app.recovery.labelled for brochure lines). It runs only
when the deployment's cloud policy allows Anthropic (ENGINE_CLOUD_PROVIDERS,
ENGINE_CLOUD_RETENTION_REVIEWED, ENGINE_CLOUD_CUSTOMER_DOCUMENTS=approved), the engine's
own Claude configuration and price are set (ENGINE_ANTHROPIC_*, ENGINE_PRICE_ANTHROPIC_*),
and the caller sends ``X-Engine-Cloud-Consent: anthropic`` for this document. A
caller-supplied header is the user's recorded consent relayed by the web service (which
authenticates with the service token); it is never an authorization on its own - the
policy above must also allow it. Per-document cost is capped (ENGINE_DOCUMENT_COST_CAP_USD,
at most $1.00) and reported.

Key 2 (owner decision 2026-11-28): the semantic judge runs here. Claude judges the facts
the local readers proposed; GPT (ENGINE_OPENAI_*, through KodeKey) judges the facts
Claude proposed - never a judge of the proposer's own family (D-034). GPT is used only
when the consent header also names ``openai`` and the cloud policy allows it. A fact
becomes VERIFIED only with key 1, the code reading and that judge's confirmation.
VERIFIED facts get one plain-words line written by Claude from their printed label and
quote only (app.recovery.plain), checked by code. Claude tokens count against a
cumulative allowance (ENGINE_CLAUDE_TOKEN_CAP, file-locked ledger at
ENGINE_CLAUDE_TOKEN_LEDGER; a cap without a ledger runs no Claude call). Tokens and cost
are reported per provider and stage.
"""

import os
import re
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from app.categories.dictionary import CATEGORIES, DICTIONARY_VERSION, comparison_form
from app.categories.mapping import Method, map_labels
from app.core.auth import require_service_token
from app.parsing.base import sha256
from app.providers.anthropic import AnthropicClient, AnthropicConfig
from app.providers.openai import FAMILY as GPT_FAMILY
from app.providers.openai import PROVIDER as GPT_PROVIDER
from app.providers.openai import OpenAIClient, OpenAIConfig
from app.reconcile.layout import PageLayout, read_layouts
from app.recovery.budget import Ledger, RunLimits, SpendLedger
from app.recovery.cache import Cache
from app.recovery.clauses import ClauseFact
from app.recovery.coverage import ItemState
from app.recovery.engines import OpenDataLoaderPrimary, PdfplumberTables, TextModel
from app.recovery.pipeline import Engines, RecoveryPipeline
from app.recovery.plain import PlainItem
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from app.recovery.present import box_text, column_of, page_text, to_contract
from app.recovery.restrictions import VerifiedFact
from app.schemas.document import ParserInfo
from app.schemas.extraction import (
    CategoryInfo,
    Extraction,
    ModelUsage,
    OpenItem,
    Printed,
    TokenAllowance,
)
from app.schemas.facts import Fact, FactState

MAX_PDF_BYTES = 25 * 1024 * 1024
_PLAN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
OPEN_STATES = (
    ItemState.NOT_EXTRACTED,
    ItemState.UNRESOLVED,
    ItemState.CONFLICTING,
    ItemState.REJECTED,
)

MAX_DOCUMENT_COST_USD = 1.00  # owner decision 2026-11-27: never more per document
MODEL_STAGES = ("text", "visual", "judge", "plain")
CONSENT_PROVIDERS = frozenset({"anthropic", GPT_PROVIDER})
CLAUDE_TEXT_LIMITS = RunLimits(
    max_cost_usd=MAX_DOCUMENT_COST_USD,
    # Worst case per call (input estimate + max output, per attempt) is reserved against
    # the cap before sending; these keep one call's reservation near $0.45 at Opus 5.5
    # list prices so a document gets several calls under $1.
    text_max_tokens=8_000,
    max_text_calls=24,
    max_text_pages_per_call=2,
    route_missed_amounts=True,  # pages with printed amounts nobody verified
)

router = APIRouter()


def document_cost_cap() -> float:
    try:
        cap = float(os.environ.get("ENGINE_DOCUMENT_COST_CAP_USD", MAX_DOCUMENT_COST_USD))
    except ValueError:
        cap = MAX_DOCUMENT_COST_USD
    return max(0.0, min(cap, MAX_DOCUMENT_COST_USD))


def claude_text_model() -> AnthropicClient | None:
    config = AnthropicConfig.from_env()
    if config is None:
        return None
    return AnthropicClient(AnthropicConfig(**{**config.__dict__, "max_attempts": 2}))


def gpt_judge_model() -> OpenAIClient | None:
    config = OpenAIConfig.from_env()
    return None if config is None else OpenAIClient(config)


def claude_token_ledger() -> tuple[SpendLedger | None, str]:
    """(the cumulative Claude token allowance or None, why Claude may not run or "").
    No cap set: no allowance. A cap that is invalid or has no ledger file: no Claude."""
    raw = os.environ.get("ENGINE_CLAUDE_TOKEN_CAP", "").strip()
    if not raw:
        return None, ""
    try:
        cap = int(raw)
    except ValueError:
        return None, "token_cap_invalid"
    if cap <= 0:
        return None, "token_cap_invalid"
    path = os.environ.get("ENGINE_CLAUDE_TOKEN_LEDGER", "").strip()
    if not path:
        return None, "token_ledger_not_configured"
    return SpendLedger(path, float(cap)), ""


def spend_ledger() -> tuple[SpendLedger | None, str]:
    """(the cumulative model spend allowance across documents or None, why models may not
    run or ""). ENGINE_SPEND_CAP_USD with a ledger file at ENGINE_SPEND_LEDGER: every call
    reserves its worst case against it first (testing; a hard stop across runs). A cap that
    is invalid or has no ledger: no model call at all."""
    raw = os.environ.get("ENGINE_SPEND_CAP_USD", "").strip()
    if not raw:
        return None, ""
    try:
        cap = float(raw)
    except ValueError:
        return None, "spend_cap_invalid"
    if cap <= 0:
        return None, "spend_cap_invalid"
    path = os.environ.get("ENGINE_SPEND_LEDGER", "").strip()
    if not path:
        return None, "spend_ledger_not_configured"
    return SpendLedger(path, cap), ""


def model_usage(ledger: Ledger) -> list[ModelUsage]:
    rows: dict[tuple[str, str, str], ModelUsage] = {}
    for e in ledger.entries:
        if e.stage not in MODEL_STAGES or e.status not in ("ok", "failed", "invalid_output"):
            continue
        k = (e.engine, e.version, e.stage)
        r = rows.get(k) or ModelUsage(
            provider=e.engine,
            model=e.version,
            stage=e.stage,
            calls=0,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
        )
        cost = None if r.cost_usd is None or e.cost_usd is None else r.cost_usd + e.cost_usd
        rows[k] = r.model_copy(
            update={
                "calls": r.calls + 1,
                "input_tokens": r.input_tokens + e.input_tokens,
                "output_tokens": r.output_tokens + e.output_tokens,
                "cost_usd": None if cost is None else round(cost, 6),
            }
        )
    return list(rows.values())


def incomplete_checks(
    ledger: Ledger, consented: bool, models_configured: bool
) -> tuple[bool, list[str]]:
    """Whether checks the user consented to could not all run, and why (short codes)."""
    if not consented:
        return False, []
    reasons = {
        e.detail or e.status
        for e in ledger.entries
        if e.stage in MODEL_STAGES
        and e.status in ("failed", "invalid_output", "skipped", "refused")
    }
    if not models_configured:
        reasons.add("models_not_configured")
    return bool(reasons), sorted(reasons)


def model_cost(ledger: Ledger) -> float | None:
    costs = [e.cost_usd for e in ledger.entries if e.stage in MODEL_STAGES]
    return None if any(c is None for c in costs) else round(sum(c or 0.0 for c in costs), 6)


def extract_pdf(
    pdf: bytes,
    plan_id: str,
    authorization: CloudAuthorization | None = None,
    *,
    text_model: TextModel | None = None,
    gpt_model: TextModel | None = None,
    policy: CloudPolicy | None = None,
    cache: Cache | None = None,
    tokens: SpendLedger | None = None,
    spend: SpendLedger | None = None,
    on_ledger: Callable[[Ledger], None] | None = None,
) -> Extraction:
    """The whole read, synchronous (called off the event loop). Without an authorization
    (or without a Claude configuration) no model is called."""
    primary = OpenDataLoaderPrimary()
    engines = Engines(primary, pdfplumber=PdfplumberTables())
    limits = None
    if authorization is not None and text_model is not None:
        engines.text_model, engines.text_provider = text_model, "anthropic"
        # key 2: Claude judges the readers' facts, GPT judges Claude's (never its own)
        engines.judge, engines.judge_provider = text_model, "anthropic"
        engines.judge_family = "anthropic-claude"
        if gpt_model is not None:
            engines.alt_judge, engines.alt_judge_provider = gpt_model, GPT_PROVIDER
            engines.alt_judge_family = GPT_FAMILY
        limits = RunLimits(**{**CLAUDE_TEXT_LIMITS.__dict__, "max_cost_usd": document_cost_cap()})
    pipeline = RecoveryPipeline(
        engines,
        limits=limits,
        policy=policy or CloudPolicy.from_env(),
        cache=cache,
        tokens=tokens,
        spend=spend,
    )
    result = pipeline.run(pdf, authorization)
    if on_ledger is not None:  # evaluation: per-call stages, tokens and cost
        on_ledger(result.ledger)
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
    facts, search = categorise(facts, layouts)
    plain: dict[str, str] = {}
    verified = [c for c in facts if c.state is FactState.VERIFIED and c.id in printed]
    if verified and text_model is not None and authorization is not None:
        lines = pipeline.plain_words(
            sha,
            text_model,
            "anthropic",
            [PlainItem(c.benefit_label, printed[c.id].text) for c in verified],
            authorization,
            result.ledger,
        )
        plain = {c.id: line for c, line in zip(verified, lines, strict=True) if line}
    open_items = [
        OpenItem(page=i.page, state=str(i.state), line=i.line)
        for i in (result.coverage.items if result.coverage else [])
        if i.state in OPEN_STATES
    ]
    incomplete = incomplete_checks(result.ledger, authorization is not None, text_model is not None)
    calls = sum(
        e.stage in MODEL_STAGES and e.status in ("ok", "failed", "invalid_output")
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
        model_cost_usd=model_cost(result.ledger),
        plain=plain,
        model_usage=model_usage(result.ledger),
        checks_incomplete=incomplete[0],
        checks_incomplete_reasons=incomplete[1],
        claude_tokens=None
        if tokens is None
        else TokenAllowance(
            cap=int(tokens.cap_usd),
            committed=round(used := tokens.committed_usd()),
            remaining=max(0, int(tokens.cap_usd - used)),
        ),
        dictionary_version=DICTIONARY_VERSION,
        categories=[
            CategoryInfo(key=c.key, name=c.name, tier=c.tier, order=c.order, explain=c.explain)
            for c in CATEGORIES
        ],
        category_search=search,
    )


def categorise(
    facts: list[Fact], layouts: dict[int, PageLayout]
) -> tuple[list[Fact], dict[str, int | None]]:
    """Each fact's printed label mapped to a dictionary category (synonym only - see
    app.categories.mapping), and for every category no fact maps to, the first page where
    one of its wordings is printed (or None)."""
    mapping = map_labels(f.benefit_label for f in facts)
    out = [
        f.model_copy(update={"category_key": m.key})
        if (m := mapping[f.benefit_label]).method is Method.SYNONYM
        else f
        for f in facts
    ]
    found = {f.category_key for f in out if f.category_key}
    pages = {n: f" {comparison_form(page_text(lay))} " for n, lay in sorted(layouts.items())}
    search: dict[str, int | None] = {}
    for c in CATEGORIES:
        if c.key in found:
            continue
        forms = [f" {comparison_form(w)} " for w in c.synonyms]
        search[c.key] = next((n for n, t in pages.items() if any(f in t for f in forms)), None)
    return out, search


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
    cloud_consent: Annotated[
        str | None,
        Header(
            alias="X-Engine-Cloud-Consent",
            description="Comma-separated providers the user consented to for this document: "
            "'anthropic' (Claude reads unsettled pages, judges reader facts, writes plain "
            "words) and optionally 'openai' (GPT judges Claude's facts). Used only when the "
            "deployment's cloud policy also allows it.",
        ),
    ] = None,
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
    auth = None
    model = gpt = tokens = spend = None
    if cloud_consent is not None:
        names = frozenset(p.strip().lower() for p in cloud_consent.split(","))
        if not names or not names <= CONSENT_PROVIDERS or "anthropic" not in names:
            raise HTTPException(422, detail={"code": "BAD_CLOUD_CONSENT"})
        auth = CloudAuthorization(sha256(pdf), DocumentClass.CUSTOMER, names, "caller_consent")
        tokens, refusal = claude_token_ledger()
        spend, spend_refusal = spend_ledger()
        refusal = refusal or spend_refusal
        if not refusal:  # a misconfigured allowance means no model call at all
            model = claude_text_model()
            gpt = gpt_judge_model() if GPT_PROVIDER in names else None
    try:
        return await run_in_threadpool(
            extract_pdf,
            pdf,
            plan_id,
            auth,
            text_model=model,
            gpt_model=gpt,
            tokens=tokens,
            spend=spend,
        )
    except HTTPException:
        raise
    except Exception as exc:  # a document the readers cannot open; never echo its content
        raise HTTPException(422, detail={"code": "UNREADABLE_PDF"}) from exc
