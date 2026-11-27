"""Progressive recovery for one PDF: each stage runs only where gaps remain.

The original PDF is the source of truth throughout: its geometry is read once
(``read_layouts``) and every candidate from every stage is checked against it by
``app.reconcile``. A stage that fails, times out, is refused by the privacy policy or
returns off-schema output adds nothing and is recorded in the ledger; the run carries
on with what is already verified (fail-closed).
"""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from app.parsing.base import sha256
from app.providers.http import ProviderError
from app.reconcile.engine import Fact, Reconciled, reconcile
from app.reconcile.layout import PageLayout, norm, read_layouts
from app.reconcile.verify import Candidate, Status
from app.recovery import proposals
from app.recovery.budget import (
    BudgetExceededError,
    Ledger,
    LedgerEntry,
    RunLimits,
    SpendLedger,
    estimate_text_tokens,
    estimate_visual_tokens,
    price_from_env,
    retry_charge_usd,
    token_cost,
    worst_case_usd,
)
from app.recovery.cache import Cache
from app.recovery.context import layout_text, page_subset_pdf, tables_hint, with_context
from app.recovery.coverage import CoverageReport, ItemState, coverage
from app.recovery.engines import DocumentReader, PageReader, TextModel, VisualModel
from app.recovery.gaps import GapKind, PageGaps, find_gaps
from app.recovery.policy import CloudAuthorization, CloudPolicy
from app.recovery.restrictions import VerifiedFact, link
from app.schemas.document import Document

ROUTABLE = {GapKind.UNSETTLED_ROW, GapKind.CONFLICT, GapKind.TABLE_NOT_FOUND}


@dataclass
class Engines:
    primary: DocumentReader
    docling: PageReader | None = None
    pdfplumber: PageReader | None = None
    text_model: TextModel | None = None
    visual_model: VisualModel | None = None


@dataclass(frozen=True)
class Unresolved:
    page: int
    label: str  # "" for page-level states
    state: str  # an ItemState: not_extracted | rejected | conflicting | unresolved
    reasons: tuple[str, ...]


@dataclass
class RecoveryResult:
    document_sha256: str
    facts: list[VerifiedFact]
    conflicts: list[tuple[Fact, Fact]]
    unresolved: list[Unresolved]
    ledger: Ledger
    verified_by_stage: dict[str, int] = field(default_factory=dict)
    reconciled: Reconciled | None = None
    coverage: CoverageReport | None = None  # P0-02: parser-independent completeness


class RecoveryPipeline:
    def __init__(
        self,
        engines: Engines,
        *,
        limits: RunLimits | None = None,
        cache: Cache | None = None,
        policy: CloudPolicy | None = None,
        spend: SpendLedger | None = None,
    ) -> None:
        self.engines = engines
        self.spend = spend  # cumulative evaluation budget (P0-05); None in production
        self.limits = limits or RunLimits()
        self.cache = cache or Cache(None)
        self.policy = policy or CloudPolicy()

    # ---------------------------------------------------------------- readers

    def _read_all(self, pdf: bytes, sha: str, ledger: Ledger) -> Document | None:
        reader = self.engines.primary
        key = Cache.key(sha, "primary", reader.name, reader.version)
        if (hit := self.cache.get(key)) is not None:
            ledger.add(LedgerEntry("primary", reader.name, reader.version, (), 0.0, "cached"))
            return Document.model_validate(hit)
        t = ledger.elapsed()
        try:
            doc = reader.read(pdf)
        except Exception as exc:
            ledger.add(
                LedgerEntry(
                    "primary",
                    reader.name,
                    reader.version,
                    (),
                    ledger.elapsed() - t,
                    "failed",
                    type(exc).__name__,
                )
            )
            return None
        self.cache.put(key, doc.model_dump(mode="json"))
        ledger.add(
            LedgerEntry("primary", reader.name, reader.version, (), ledger.elapsed() - t, "ok")
        )
        return doc

    def _read_pages(
        self,
        stage: str,
        reader: PageReader,
        pdf: bytes,
        *,
        sha: str,
        pages: list[int],
        ledger: Ledger,
    ) -> Document | None:
        key = Cache.key(sha, stage, reader.name, reader.version, pages=pages)
        if (hit := self.cache.get(key)) is not None:
            ledger.add(LedgerEntry(stage, reader.name, reader.version, tuple(pages), 0.0, "cached"))
            return Document.model_validate(hit)
        t = ledger.elapsed()
        try:
            doc = reader.read_pages(pdf, sha, pages)
        except Exception as exc:
            ledger.add(
                LedgerEntry(
                    stage,
                    reader.name,
                    reader.version,
                    tuple(pages),
                    ledger.elapsed() - t,
                    "failed",
                    type(exc).__name__,
                )
            )
            return None
        self.cache.put(key, doc.model_dump(mode="json"))
        ledger.add(
            LedgerEntry(
                stage, reader.name, reader.version, tuple(pages), ledger.elapsed() - t, "ok"
            )
        )
        return doc

    # ---------------------------------------------------------------- models

    def _allowed(
        self, provider: str, stage: str, sha: str, auth: CloudAuthorization | None, ledger: Ledger
    ) -> bool:
        refusal = self.policy.refusal(provider, sha, auth)
        capped = self.limits.max_cost_usd is not None or self.spend is not None
        price = price_from_env(provider)
        if refusal is None and capped and price is None:
            refusal = "price_not_configured_under_cost_cap"
        if (
            refusal is None
            and not capped
            and (price is None or price.input_per_mtok + price.output_per_mtok > 0)
        ):
            # P0-05: never an uncapped call that may cost money. Only a provider with a
            # configured price of zero (a free development tier) may run without a cap.
            refusal = "uncapped_paid_call_refused"
        if refusal:
            ledger.add(LedgerEntry(stage, provider, "-", (), 0.0, "refused", refusal))
        return refusal is None

    def _model_call(
        self,
        stage: str,
        provider: str,
        model: str,
        *,
        sha: str,
        targets: list[int],
        request_digest: str,
        call: Any,
        ledger: Ledger,
        disclosed: int,
        estimate_in: int,
        max_out: int,
        max_attempts: int,
    ) -> list[Candidate]:
        key = Cache.key(
            sha,
            stage,
            provider,
            model,
            prompt=proposals.PROMPT_VERSION,
            pages=targets,
            request=request_digest,
        )
        source = f"{stage}:{model}"
        if (hit := self.cache.get(key)) is not None:
            ledger.add(LedgerEntry(stage, provider, model, tuple(targets), 0.0, "cached"))
            parsed = proposals.parse(hit)
            return proposals.to_candidates(source, parsed, set(targets)) if parsed else []
        price = price_from_env(provider)
        worst = worst_case_usd(price, estimate_in, max_out) if price is not None else None
        reserved = None if worst is None else worst * max(1, max_attempts)
        refusal, rid = self._reserve(reserved, ledger, f"{sha[:12]}:{stage}:{targets}")
        if refusal:
            ledger.add(LedgerEntry(stage, provider, model, tuple(targets), 0.0, "skipped", refusal))
            return []
        t = ledger.elapsed()
        try:
            reply = call()
        except Exception as exc:
            charged: float | None
            if worst is None:
                charged = None
            elif isinstance(exc, ProviderError):
                charged = (token_cost(price, exc.input_tokens, exc.output_tokens) or 0.0) + (
                    retry_charge_usd(exc.failed_attempts, worst)
                )
            else:  # unknown failure: assume the worst case was billed
                charged = worst
            if rid is not None and self.spend is not None and charged is not None:
                self.spend.settle(rid, charged)
            ledger.add(
                LedgerEntry(
                    stage,
                    provider,
                    model,
                    tuple(targets),
                    ledger.elapsed() - t,
                    "failed",
                    getattr(exc, "reason", type(exc).__name__),
                    getattr(exc, "input_tokens", 0),
                    getattr(exc, "output_tokens", 0),
                    charged,
                    bytes_disclosed=disclosed,
                )
            )
            return []
        cost = token_cost(price, reply.usage.input_tokens, reply.usage.output_tokens)
        if cost is not None and worst is not None:
            cost += retry_charge_usd(reply.failed_attempts, worst)
        if rid is not None and self.spend is not None and cost is not None:
            self.spend.settle(rid, cost)
        parsed = proposals.parse(reply.data)
        ledger.add(
            LedgerEntry(
                stage,
                provider,
                reply.model,
                tuple(targets),
                reply.seconds,
                "ok" if parsed else "invalid_output",
                "" if parsed else "schema_mismatch",
                reply.usage.input_tokens,
                reply.usage.output_tokens,
                cost,
                disclosed,
            )
        )
        if parsed is None:
            return []  # off-schema output is rejected whole, never repaired
        self.cache.put(key, parsed.model_dump(mode="json"))
        return proposals.to_candidates(source, parsed, set(targets))

    def _reserve(self, usd: float | None, ledger: Ledger, label: str) -> tuple[str, str | None]:
        """P0-05: admit a call only if its worst case fits the document cap and the
        cumulative evaluation budget. Returns (refusal reason or "", reservation id)."""
        if usd is None:  # no price and no cap: _allowed already decided this is free
            return "", None
        cap = self.limits.max_cost_usd
        if cap is not None and (ledger.cost_usd() or 0.0) + usd > cap:
            return "document_cost_cap_reservation", None
        if self.spend is None:
            return "", None
        try:
            return "", self.spend.reserve(usd, label)
        except BudgetExceededError:
            return "evaluation_budget_reservation", None

    def _text_stage(
        self,
        sha: str,
        layouts: list[PageLayout],
        docs: dict[str, Document],
        *,
        gaps: dict[int, PageGaps],
        targets: list[int],
        ledger: Ledger,
    ) -> list[Candidate]:
        model = self.engines.text_model
        assert model is not None  # noqa: S101 - checked by caller
        by_page = {lay.number: lay for lay in layouts}
        following = {p for p, g in gaps.items() if GapKind.CONTINUES_ON_NEXT_PAGE in g.kinds}
        out: list[Candidate] = []
        size = self.limits.max_text_pages_per_call
        for i in range(0, len(targets), size):
            if ledger.calls("text") >= self.limits.max_text_calls or self._exhausted(ledger):
                ledger.add(
                    LedgerEntry(
                        "text", "nvidia", model.model, tuple(targets[i:]), 0.0, "skipped", "limit"
                    )
                )
                break
            batch = targets[i : i + size]
            pages = with_context(batch, len(layouts), True, following)
            texts = {p: layout_text(by_page[p], self.limits.max_page_chars) for p in pages}
            hints = {p: tables_hint(docs, p, self.limits.max_page_chars) for p in batch}
            focus = {p: gaps[p].rows for p in batch if p in gaps}
            request = proposals.text_request(batch, texts, hints, focus)
            digest = hashlib.sha256(request.encode()).hexdigest()

            def call(request: str = request) -> Any:
                return model.complete_json(
                    proposals.TEXT_SYSTEM,
                    request,
                    "table_cells",
                    proposals.SCHEMA,
                    self.limits.text_max_tokens,
                )

            out += self._model_call(
                "text",
                "nvidia",
                model.model,
                sha=sha,
                targets=batch,
                request_digest=digest,
                call=call,
                ledger=ledger,
                disclosed=len(request.encode()),
                estimate_in=estimate_text_tokens(
                    proposals.TEXT_SYSTEM, request, json.dumps(proposals.SCHEMA)
                ),
                max_out=self.limits.text_max_tokens,
                max_attempts=_attempts(model),
            )
        return out

    def _visual_stage(
        self,
        pdf: bytes,
        sha: str,
        n_pages: int,
        *,
        gaps: dict[int, PageGaps],
        targets: list[int],
        ledger: Ledger,
    ) -> list[Candidate]:
        model = self.engines.visual_model
        assert model is not None  # noqa: S101
        following = {p for p, g in gaps.items() if GapKind.CONTINUES_ON_NEXT_PAGE in g.kinds}
        out: list[Candidate] = []
        size = self.limits.max_visual_pages_per_call
        for i in range(0, len(targets), size):
            if ledger.calls("visual") >= self.limits.max_visual_calls or self._exhausted(ledger):
                ledger.add(
                    LedgerEntry(
                        "visual",
                        "anthropic",
                        model.model,
                        tuple(targets[i:]),
                        0.0,
                        "skipped",
                        "limit",
                    )
                )
                break
            batch = targets[i : i + size]
            page_map = with_context(batch, n_pages, True, following)
            subset = page_subset_pdf(pdf, page_map)
            focus = {p: gaps[p].rows for p in batch if p in gaps}
            instruction = proposals.visual_request(page_map, batch, focus)
            digest = hashlib.sha256(subset + instruction.encode()).hexdigest()

            def call(subset: bytes = subset, instruction: str = instruction) -> Any:
                return model.read_pdf_pages(
                    subset,
                    proposals.VISUAL_SYSTEM,
                    instruction,
                    proposals.SCHEMA,
                    self.limits.visual_max_tokens,
                )

            out += self._model_call(
                "visual",
                "anthropic",
                model.model,
                sha=sha,
                targets=batch,
                request_digest=digest,
                call=call,
                ledger=ledger,
                disclosed=len(subset),
                estimate_in=estimate_visual_tokens(
                    len(page_map),
                    proposals.VISUAL_SYSTEM,
                    instruction,
                    json.dumps(proposals.SCHEMA),
                ),
                max_out=self.limits.visual_max_tokens,
                max_attempts=_attempts(model),
            )
        return out

    def _exhausted(self, ledger: Ledger) -> bool:
        if self.limits.max_cost_usd is not None:
            spent = ledger.cost_usd()
            if spent is None or spent >= self.limits.max_cost_usd:
                return True
        return ledger.elapsed() >= self.limits.max_seconds

    # ---------------------------------------------------------------- run

    def run(self, pdf: bytes, authorization: CloudAuthorization | None = None) -> RecoveryResult:
        sha = sha256(pdf)
        ledger = Ledger()
        layouts = read_layouts(pdf)
        docs: dict[str, Document] = {}
        extra: list[Candidate] = []
        verified_by_stage: dict[str, int] = {}

        def settle(stage: str) -> tuple[Reconciled, dict[int, PageGaps]]:
            rec = reconcile(pdf, docs, candidates=extra, layouts=layouts)
            verified_by_stage[stage] = len(rec.facts)
            return rec, find_gaps(rec, layouts, docs)

        primary = self._read_all(pdf, sha, ledger)
        if primary is not None:
            docs[self.engines.primary.name] = primary
        rec, gaps = settle("primary")

        def routable(limit: int | None = None) -> list[int]:
            pages = [p for p, g in gaps.items() if g.verifiable and g.kinds & ROUTABLE]
            return pages[:limit] if limit is not None else pages

        for stage, reader in (
            ("docling", self.engines.docling),
            ("pdfplumber", self.engines.pdfplumber),
        ):
            pages = routable(self.limits.max_docling_pages)
            if reader is None or not pages:
                continue
            if self._exhausted(ledger):
                ledger.add(
                    LedgerEntry(
                        stage,
                        reader.name,
                        reader.version,
                        tuple(pages),
                        0.0,
                        "skipped",
                        "time_budget",
                    )
                )
                continue
            doc = self._read_pages(stage, reader, pdf, sha=sha, pages=pages, ledger=ledger)
            if doc is not None:
                docs[reader.name] = doc
                rec, gaps = settle(stage)

        if self.engines.text_model and (pages := routable()):
            if self._allowed("nvidia", "text", sha, authorization, ledger):
                extra += self._text_stage(
                    sha, layouts, docs, gaps=gaps, targets=pages, ledger=ledger
                )
                rec, gaps = settle("text")

        if self.engines.visual_model and (pages := routable()):
            if self._allowed("anthropic", "visual", sha, authorization, ledger):
                extra += self._visual_stage(
                    pdf, sha, len(layouts), gaps=gaps, targets=pages, ledger=ledger
                )
                rec, gaps = settle("visual")

        return RecoveryResult(
            document_sha256=sha,
            facts=link(rec.facts, layouts, rec.verdicts),
            conflicts=rec.conflicts,
            unresolved=_unresolved(rec, gaps),
            coverage=coverage(layouts, rec.facts, rec.verdicts, rec.conflicts),
            ledger=ledger,
            verified_by_stage=verified_by_stage,
            reconciled=rec,
        )


def _unresolved(rec: Reconciled, gaps: dict[int, PageGaps]) -> list[Unresolved]:
    """Rows and pages left open, in the P0-02 states: a row nobody proposed a value for
    is ``not_extracted``; one whose proposals the verifier refused is ``rejected`` (with
    the rules); a scanned page is ``unresolved``; a ruled page without any table found
    is ``not_extracted``."""
    reasons: dict[tuple[int, str], set[str]] = {}
    for v in rec.verdicts:
        if v.status is not Status.VERIFIED:
            reasons.setdefault((v.candidate.page, norm(v.candidate.label)), set()).update(v.reasons)
    out: list[Unresolved] = []
    for page, g in gaps.items():
        if GapKind.NO_TEXT_LAYER in g.kinds:
            out.append(Unresolved(page, "", ItemState.UNRESOLVED, ("no_text_layer",)))
        if GapKind.TABLE_NOT_FOUND in g.kinds:
            out.append(Unresolved(page, "", ItemState.NOT_EXTRACTED, ("table_not_found",)))
        for label in dict.fromkeys(g.rows):
            why = tuple(sorted(reasons.get((page, norm(label)), set())))
            state = ItemState.REJECTED if why else ItemState.NOT_EXTRACTED
            out.append(Unresolved(page, label, state, why or ("not_proposed",)))
    for a, b in rec.conflicts:
        out.append(Unresolved(a.page, a.label, ItemState.CONFLICTING, (a.value, b.value)))
    return out


def _attempts(model: Any) -> int:
    """How many billable attempts one call may make (provider retry budget)."""
    config = getattr(model, "config", None)
    return int(getattr(config, "max_attempts", 1) or 1)
