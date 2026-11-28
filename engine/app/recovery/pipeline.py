"""Progressive recovery for one PDF: each stage runs only where gaps remain.

The original PDF is the source of truth throughout: its geometry is read once
(``read_layouts``) and every candidate from every stage is checked against it by
``app.reconcile``. A stage that fails, times out, is refused by the privacy policy or
returns off-schema output adds nothing and is recorded in the ledger; the run carries
on with what is already verified (fail-closed).
"""

import hashlib
import json
from collections.abc import Callable
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
from app.recovery.clauses import (
    ClauseCandidate,
    ClauseFact,
    ClauseVerdict,
    candidates_from_layout,
    candidates_from_tables,
    clause_facts,
)
from app.recovery.context import layout_text, page_subset_pdf, tables_hint, with_context
from app.recovery.coverage import CoverageReport, ItemState, coverage
from app.recovery.engines import DocumentReader, PageReader, TextModel, VisualModel
from app.recovery.gaps import GapKind, PageGaps, find_gaps
from app.recovery.governing import exclusion_items, resolve, units
from app.recovery.plain import (
    PLAIN_PROMPT_VERSION,
    PLAIN_SCHEMA,
    PLAIN_SYSTEM,
    PlainItem,
    parse_plain,
    plain_request,
)
from app.recovery.policy import CloudAuthorization, CloudPolicy
from app.recovery.restrictions import VerifiedFact, link
from app.recovery.semantic import (
    JUDGE_PROMPT_VERSION,
    JUDGE_SCHEMA,
    JUDGE_SYSTEM,
    UNKNOWN_FAMILY,
    CodeCheck,
    JudgeItem,
    JudgeVerdict,
    confirmed,
    interpret,
    is_column_header,
    judge_request,
    parse_judge,
    proposer_families,
)
from app.recovery.visual import ReviewItem, review_items
from app.schemas.document import Document

ROUTABLE = {GapKind.UNSETTLED_ROW, GapKind.CONFLICT, GapKind.TABLE_NOT_FOUND}


@dataclass
class Engines:
    primary: DocumentReader
    docling: PageReader | None = None
    pdfplumber: PageReader | None = None
    text_model: TextModel | None = None
    text_provider: str = "nvidia"  # cloud-policy and price name of text_model
    visual_model: VisualModel | None = None
    # semantic judge (key 2): a text model of a family other than any proposer's
    judge: TextModel | None = None
    judge_provider: str = "anthropic"  # cloud-policy and price name
    judge_family: str = "anthropic-claude"
    # judges the facts the main judge's own family proposed (e.g. Nemotron for facts
    # Claude read on a page); never used for any other fact
    alt_judge: TextModel | None = None
    alt_judge_provider: str = "nvidia"
    alt_judge_family: str = "nvidia-nemotron"


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
    clauses: list[ClauseFact] = field(default_factory=list)  # P0-01: verified prose
    clause_verdicts: list[ClauseVerdict] = field(default_factory=list)
    review: list[ReviewItem] = field(default_factory=list)  # P0-03: scanned pages


class RecoveryPipeline:
    def __init__(
        self,
        engines: Engines,
        *,
        limits: RunLimits | None = None,
        cache: Cache | None = None,
        policy: CloudPolicy | None = None,
        spend: SpendLedger | None = None,
        progress: Callable[[str], None] | None = None,
        tokens: SpendLedger | None = None,
        token_providers: frozenset[str] = frozenset({"anthropic"}),
    ) -> None:
        self.engines = engines
        # Cumulative token allowance (evaluation only), counted in tokens, for providers
        # whose gateway meters tokens (KodeKey); same reserve-then-settle rule as spend.
        self.tokens = tokens
        self.token_providers = token_providers
        self.progress = progress  # optional per-call progress lines (evaluation only)
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

    @staticmethod
    def _text_targets(routable: list[int], rec: Reconciled, layouts: list[PageLayout]) -> list[int]:
        """Gap pages, plus pages where printed amounts were proposed by nobody (P0-02
        coverage: information every reader missed). Scanned pages are not text targets."""
        missed = coverage(layouts, rec.facts, rec.verdicts, rec.conflicts)
        extra = {i.page for i in missed.items if i.state is ItemState.NOT_EXTRACTED}
        return sorted(set(routable) | extra)

    # ---------------------------------------------------------------- prose

    @staticmethod
    def _clauses(
        docs: dict[str, Document],
        layouts: list[PageLayout],
        rec: Reconciled,
        extra: list[ClauseCandidate],
    ) -> tuple[list[ClauseFact], list[ClauseVerdict]]:
        """P0-01: reader cells and text-layer Q&A cells proposed as clauses, verified by
        the prose rules. A clause that repeats a verified table fact is not added twice."""
        cands: list[ClauseCandidate] = []
        for name, doc in docs.items():
            cands += candidates_from_tables(name, [t for p in doc.pages for t in p.tables])
        for layout in layouts:
            cands += candidates_from_layout(layout)
        facts, verdicts = clause_facts([*cands, *extra], layouts)
        table = {(f.page, norm(f.label), norm(f.value)) for f in rec.facts}
        facts = [
            c
            for c in facts
            if (c.page, norm(c.evidence.anchor), norm(c.evidence.text)) not in table
        ]
        return facts, verdicts

    # ---------------------------------------------------------------- key 2

    def _semantic(
        self,
        sha: str,
        facts: list[VerifiedFact],
        clauses: list[ClauseFact],
        authorization: CloudAuthorization | None,
        ledger: Ledger,
    ) -> None:
        """Code reading for every verified fact; the judge only for those that pass it.
        semantic_confirmed needs both (semantic.confirmed); the judge alone never does."""
        pending: list[tuple[VerifiedFact | ClauseFact, CodeCheck, JudgeItem]] = []
        for vf in facts:
            if vf.is_governing_text:
                continue
            f = vf.fact
            label = " ".join((*f.group_labels, f.label))
            governing = [*vf.restrictions, *vf.footnotes, *vf.context]
            code = (
                CodeCheck([], ["value_is_column_header"])
                if is_column_header(f.value, f.header)
                else interpret(f.value, label=label, header=f.header, governing=governing)
            )
            item = JudgeItem(
                label,
                f.header,
                f.value,
                tuple(governing),
                tuple(code.interpretations),
                tuple(vf.possible_exclusions),
            )
            pending.append((vf, code, item))
        for cf in clauses:
            e = cf.evidence
            governing = [*cf.restrictions, *cf.footnotes, *cf.context]
            code = interpret(
                e.text, label=e.anchor, header=e.column, governing=governing, prose=True
            )
            if is_column_header(e.text, e.column):
                code = CodeCheck([], ["value_is_column_header"])
            elif e.labelled:
                # a brochure line is read like a table value when its printed words settle
                # the number and basis (printed words only); otherwise as printed text
                numeric = interpret(
                    e.text,
                    label=e.anchor,
                    header=e.column,
                    governing=governing,
                    term_rules=False,
                )
                if numeric.passed:
                    code = numeric
            item = JudgeItem(
                e.anchor,
                e.column,
                e.text,
                tuple(governing),
                tuple(code.interpretations),
                tuple(cf.possible_exclusions),
            )
            pending.append((cf, code, item))
        verdicts: dict[int, JudgeVerdict] = {}
        # a proposer whose family is unknown can never be judged "different" (fail-closed)
        judgeable = [
            i
            for i, (f, code, _it) in enumerate(pending)
            if code.passed and UNKNOWN_FAMILY not in proposer_families(f.proposed_by_all)
        ]
        eng = self.engines
        main = [
            i
            for i in judgeable
            if eng.judge_family not in proposer_families(pending[i][0].proposed_by_all)
        ]
        alt = [i for i in judgeable if i not in set(main)]
        main.sort(key=lambda i: (_model_only(pending[i][0].proposed_by_all), i))
        alt.sort(key=lambda i: (_model_only(pending[i][0].proposed_by_all), i))
        for idx, model, provider, family in (
            (main, eng.judge, eng.judge_provider, eng.judge_family),
            (alt, eng.alt_judge, eng.alt_judge_provider, eng.alt_judge_family),
        ):
            if model is None or not idx:
                continue
            if not self._allowed(provider, "judge", sha, authorization, ledger):
                continue
            got = self._judge(
                sha, model, [pending[i][2] for i in idx], ledger, provider=provider, family=family
            )
            verdicts.update({idx[k]: v for k, v in got.items()})
        for i, (fact, code, _item) in enumerate(pending):
            ok, why = confirmed(code, verdicts.get(i), fact.proposed_by_all)
            fact.semantic_confirmed = ok
            fact.semantic_reasons = list(why)
            fact.readings = list(code.interpretations)
            fact.judge = verdicts.get(i)

    def _judge(
        self,
        sha: str,
        judge: TextModel,
        items: list[JudgeItem],
        ledger: Ledger,
        *,
        provider: str,
        family: str,
    ) -> dict[int, JudgeVerdict]:
        out: dict[int, JudgeVerdict] = {}
        size = max(1, self.limits.judge_facts_per_call)
        for start in range(0, len(items), size):
            batch = items[start : start + size]
            if ledger.calls("judge") >= self.limits.max_judge_calls or self._exhausted(ledger):
                ledger.add(LedgerEntry("judge", provider, judge.model, (), 0.0, "skipped", "limit"))
                break
            request = judge_request(batch)
            key = Cache.key(
                sha,
                "judge",
                provider,
                judge.model,
                prompt=JUDGE_PROMPT_VERSION,
                pages=[],
                request=hashlib.sha256(request.encode()).hexdigest(),
            )
            data = self.cache.get(key)
            if data is not None:
                ledger.add(LedgerEntry("judge", provider, judge.model, (), 0.0, "cached"))
            else:
                data = self._judge_call(judge, provider, request, ledger, sha)
                if data is not None:
                    self.cache.put(key, data)
            for k, v in enumerate(parse_judge(data, len(batch), family, judge.model)):
                out[start + k] = v
        return out

    def _judge_call(
        self, judge: TextModel, provider: str, request: str, ledger: Ledger, sha: str
    ) -> Any:
        return self.json_call(
            "judge",
            judge,
            provider,
            JUDGE_SYSTEM,
            request,
            "judge",
            JUDGE_SCHEMA,
            self.limits.judge_max_tokens,
            ledger,
            sha,
        )

    def json_call(  # noqa: PLR0917 - one call's whole description, all required
        self,
        stage: str,
        judge: TextModel,
        provider: str,
        system: str,
        request: str,
        schema_name: str,
        schema: dict[str, Any],
        max_tokens: int,
        ledger: Ledger,
        sha: str,
    ) -> Any:
        """One capped, reserved, ledgered JSON call (the caller checked the cloud policy).
        Returns the parsed reply, or None on refusal or failure (fail-closed)."""
        price = price_from_env(provider)
        est = estimate_text_tokens(system, request, json.dumps(schema))
        worst = worst_case_usd(price, est, max_tokens) if price else None
        reserved = None if worst is None else worst * _attempts(judge)
        one_tokens = est + max_tokens
        refusal, rid, tid = self._admit(
            provider, reserved, one_tokens * _attempts(judge), ledger, f"{sha[:12]}:{stage}"
        )
        if refusal:
            ledger.add(LedgerEntry(stage, provider, judge.model, (), 0.0, "skipped", refusal))
            return None
        t = ledger.elapsed()
        ledger.note(f"{stage} {provider}: calling")
        try:
            reply = judge.complete_json(system, request, schema_name, schema, max_tokens)
        except Exception as exc:
            self._settle_tokens(tid, exc, one_tokens)
            charged = None
            if worst is not None and isinstance(exc, ProviderError):
                charged = (token_cost(price, exc.input_tokens, exc.output_tokens) or 0.0) + (
                    retry_charge_usd(exc.failed_attempts, worst)
                )
            elif worst is not None:
                charged = worst
            if rid is not None and self.spend is not None and charged is not None:
                self.spend.settle(rid, charged)
            ledger.add(
                LedgerEntry(
                    stage,
                    provider,
                    judge.model,
                    (),
                    ledger.elapsed() - t,
                    "failed",
                    getattr(exc, "reason", type(exc).__name__),
                    cost_usd=charged,
                    bytes_disclosed=len(request.encode()),
                )
            )
            return None
        self._settle_tokens(tid, reply, one_tokens)
        cost = token_cost(price, reply.usage.input_tokens, reply.usage.output_tokens)
        if cost is not None and worst is not None:
            cost += retry_charge_usd(reply.failed_attempts, worst)
        if rid is not None and self.spend is not None and cost is not None:
            self.spend.settle(rid, cost)
        ledger.add(
            LedgerEntry(
                stage,
                provider,
                reply.model,
                (),
                reply.seconds,
                "ok",
                "",
                reply.usage.input_tokens,
                reply.usage.output_tokens,
                cost,
                len(request.encode()),
            )
        )
        return reply.data

    # ---------------------------------------------------------------- plain words

    def plain_words(  # noqa: PLR0917
        self,
        sha: str,
        model: TextModel,
        provider: str,
        items: list[PlainItem],
        authorization: CloudAuthorization | None,
        ledger: Ledger,
    ) -> list[str]:
        """One checked plain-words line per item ("" when refused, failed or dropped).
        Same policy, cap, reservation and cache rules as every other model call."""
        out = [""] * len(items)
        if not items or not self._allowed(provider, "plain", sha, authorization, ledger):
            return out
        size = max(1, self.limits.plain_items_per_call)
        for start in range(0, len(items), size):
            batch = items[start : start + size]
            if ledger.calls("plain") >= self.limits.max_plain_calls or self._exhausted(ledger):
                ledger.add(LedgerEntry("plain", provider, model.model, (), 0.0, "skipped", "limit"))
                break
            request = plain_request(batch)
            key = Cache.key(
                sha,
                "plain",
                provider,
                model.model,
                prompt=PLAIN_PROMPT_VERSION,
                pages=[],
                request=hashlib.sha256(request.encode()).hexdigest(),
            )
            data = self.cache.get(key)
            if data is not None:
                ledger.add(LedgerEntry("plain", provider, model.model, (), 0.0, "cached"))
            else:
                data = self.json_call(
                    "plain",
                    model,
                    provider,
                    PLAIN_SYSTEM,
                    request,
                    "plain_words",
                    PLAIN_SCHEMA,
                    self.limits.plain_max_tokens,
                    ledger,
                    sha,
                )
                if data is not None:
                    self.cache.put(key, data)
            out[start : start + len(batch)] = parse_plain(data, batch)
        return out

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
        clauses_out: list[ClauseCandidate] | None = None,
        prompt_version: str = proposals.PROMPT_VERSION,
    ) -> list[Candidate]:
        key = Cache.key(
            sha,
            stage,
            provider,
            model,
            prompt=prompt_version,
            pages=targets,
            request=request_digest,
        )
        source = f"{stage}:{model}"
        if (hit := self.cache.get(key)) is not None:
            ledger.add(LedgerEntry(stage, provider, model, tuple(targets), 0.0, "cached"))
            parsed = proposals.parse(hit)
            if parsed and clauses_out is not None:
                clauses_out += proposals.to_clauses(source, parsed, set(targets))
            return proposals.to_candidates(source, parsed, set(targets)) if parsed else []
        price = price_from_env(provider)
        worst = worst_case_usd(price, estimate_in, max_out) if price is not None else None
        reserved = None if worst is None else worst * max(1, max_attempts)
        one_tokens = estimate_in + max_out
        refusal, rid, tid = self._admit(
            provider,
            reserved,
            one_tokens * max(1, max_attempts),
            ledger,
            f"{sha[:12]}:{stage}:{targets}",
        )
        if refusal:
            ledger.add(LedgerEntry(stage, provider, model, tuple(targets), 0.0, "skipped", refusal))
            return []
        t = ledger.elapsed()
        ledger.note(f"{stage} {provider} p{','.join(map(str, targets))}: calling")
        try:
            reply = call()
        except Exception as exc:
            self._settle_tokens(tid, exc, one_tokens)
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
        self._settle_tokens(tid, reply, one_tokens)
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
        if clauses_out is not None:
            clauses_out += proposals.to_clauses(source, parsed, set(targets))
        return proposals.to_candidates(source, parsed, set(targets))

    def _admit(
        self, provider: str, usd: float | None, tokens: int, ledger: Ledger, label: str
    ) -> tuple[str, str | None, str | None]:
        """Both reservations or neither: (refusal reason or "", spend id, token id)."""
        refusal, rid = self._reserve(usd, ledger, label)
        if refusal:
            return refusal, None, None
        refusal, tid = self._reserve_tokens(provider, tokens, label)
        if refusal and rid is not None and self.spend is not None:
            self.spend.settle(rid, 0.0)  # nothing was sent
        return refusal, rid, tid

    def _reserve_tokens(self, provider: str, tokens: int, label: str) -> tuple[str, str | None]:
        """Reserve a call's worst-case tokens (input estimate + max output, per attempt)
        against the token allowance; providers it does not meter pass untouched."""
        if self.tokens is None or provider not in self.token_providers:
            return "", None
        try:
            return "", self.tokens.reserve(float(tokens), label)
        except BudgetExceededError:
            return "evaluation_token_reservation", None

    def _settle_tokens(self, tid: str | None, outcome: Any, one_call: int) -> None:
        """Replace the reservation with the tokens used: reported usage plus the worst case
        for each failed attempt that may have been processed; unknown failures keep the
        worst case of one call."""
        if tid is None or self.tokens is None:
            return
        if isinstance(outcome, ProviderError):
            used = float(outcome.input_tokens + outcome.output_tokens)
            used += retry_charge_usd(outcome.failed_attempts, float(one_call))
        elif isinstance(outcome, Exception):
            used = float(one_call)
        else:
            used = float(outcome.usage.input_tokens + outcome.usage.output_tokens)
            used += retry_charge_usd(outcome.failed_attempts, float(one_call))
        self.tokens.settle(tid, used)

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
        clauses_out: list[ClauseCandidate] | None = None,
    ) -> list[Candidate]:
        model = self.engines.text_model
        assert model is not None  # noqa: S101 - checked by caller
        provider = self.engines.text_provider
        by_page = {lay.number: lay for lay in layouts}
        following = {p for p, g in gaps.items() if GapKind.CONTINUES_ON_NEXT_PAGE in g.kinds}
        out: list[Candidate] = []
        size = self.limits.max_text_pages_per_call
        for i in range(0, len(targets), size):
            if ledger.calls("text") >= self.limits.max_text_calls or self._exhausted(ledger):
                ledger.add(
                    LedgerEntry(
                        "text", provider, model.model, tuple(targets[i:]), 0.0, "skipped", "limit"
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
                    proposals.TEXT_SCHEMA,
                    self.limits.text_max_tokens,
                )

            out += self._model_call(
                "text",
                provider,
                model.model,
                sha=sha,
                targets=batch,
                request_digest=digest,
                call=call,
                ledger=ledger,
                disclosed=len(request.encode()),
                estimate_in=estimate_text_tokens(
                    proposals.TEXT_SYSTEM, request, json.dumps(proposals.TEXT_SCHEMA)
                ),
                max_out=self.limits.text_max_tokens,
                max_attempts=_attempts(model),
                clauses_out=clauses_out,
                prompt_version=proposals.TEXT_PROMPT_VERSION,
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
        shown: dict[int, tuple[bytes, tuple[int, ...]]] | None = None,
    ) -> list[Candidate]:
        """``shown`` (out): target page -> (page-subset bytes, its pages), for provenance."""
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
            if shown is not None:
                shown.update({p: (subset, tuple(page_map)) for p in batch})
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

    def run(
        self,
        pdf: bytes,
        authorization: CloudAuthorization | None = None,
        *,
        progress: Callable[[str], None] | None = None,
    ) -> RecoveryResult:
        """``progress`` overrides the pipeline-wide sink for this document (per-document
        labels when documents run concurrently). The pipeline holds no per-run state."""
        sha = sha256(pdf)
        ledger = Ledger(notify=progress or self.progress)
        layouts = read_layouts(pdf)
        docs: dict[str, Document] = {}
        extra: list[Candidate] = []
        extra_clauses: list[ClauseCandidate] = []  # model clause proposals
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

        targets = (
            self._text_targets(routable(), rec, layouts)
            if self.limits.route_missed_amounts
            else routable()
        )
        if self.engines.text_model and (pages := targets):
            if self._allowed(self.engines.text_provider, "text", sha, authorization, ledger):
                extra += self._text_stage(
                    sha,
                    layouts,
                    docs,
                    gaps=gaps,
                    targets=pages,
                    ledger=ledger,
                    clauses_out=extra_clauses,
                )
                rec, gaps = settle("text")

        if self.engines.visual_model and (pages := routable()):
            if self._allowed("anthropic", "visual", sha, authorization, ledger):
                extra += self._visual_stage(
                    pdf, sha, len(layouts), gaps=gaps, targets=pages, ledger=ledger
                )
                rec, gaps = settle("visual")

        review: list[ReviewItem] = []
        scanned = [p for p, g in gaps.items() if GapKind.NO_TEXT_LAYER in g.kinds]
        if self.engines.visual_model and scanned:
            # P0-03: image-only pages are read by the visual model, but nothing on them
            # can be checked against printed text - review-required, never verified.
            if self._allowed("anthropic", "visual", sha, authorization, ledger):
                shown: dict[int, tuple[bytes, tuple[int, ...]]] = {}
                proposed = self._visual_stage(
                    pdf, sha, len(layouts), gaps=gaps, targets=scanned, ledger=ledger, shown=shown
                )
                review = review_items(
                    proposed,
                    model=self.engines.visual_model.model,
                    prompt_version=proposals.PROMPT_VERSION,
                    shown=shown,
                )

        extra_clauses += _unruled_lines(extra, layouts, rec)
        clauses, clause_verdicts = self._clauses(docs, layouts, rec, extra_clauses)
        facts = link(rec.facts, layouts, rec.verdicts)
        _governing(facts, clauses, layouts)
        self._semantic(sha, facts, clauses, authorization, ledger)
        return RecoveryResult(
            document_sha256=sha,
            facts=facts,
            conflicts=rec.conflicts,
            unresolved=_unresolved(rec, gaps),
            coverage=coverage(
                layouts,
                rec.facts,
                rec.verdicts,
                rec.conflicts,
                extra_verified=[(c.page, b) for c in clauses for b in c.evidence.text_boxes],
            ),
            clauses=clauses,
            clause_verdicts=clause_verdicts,
            review=review,
            ledger=ledger,
            verified_by_stage=verified_by_stage,
            reconciled=rec,
        )


def _unruled_lines(
    model_cells: list[Candidate], layouts: list[PageLayout], rec: Reconciled
) -> list[ClauseCandidate]:
    """A model's table-cell proposal on a page WITHOUT drawn table rules, that the table
    verifier did not verify, is re-checked as a brochure line (app.recovery.labelled):
    the same claim - this label reads this value - under rules that need no ruling lines.
    The claimed column header is not trusted and not carried (it stays unproven). Ruled
    pages never take this path: their cells answer to the table rules alone."""
    by_page = {lay.number: lay for lay in layouts}
    settled = {(f.page, norm(f.label), norm(f.value)) for f in rec.facts}
    out: list[ClauseCandidate] = []
    for c in model_cells:
        lay = by_page.get(c.page)
        if lay is None or lay.ruled or (c.page, norm(c.label), norm(c.value)) in settled:
            continue
        out.append(ClauseCandidate(c.reader, c.page, c.label, c.value, "labelled", c.value))
    return out


def _governing(
    facts: list[VerifiedFact], clauses: list[ClauseFact], layouts: list[PageLayout]
) -> None:
    """P1-01: context printed elsewhere in the document (see governing.py)."""
    all_units = units(layouts)
    excluded = exclusion_items(all_units, layouts)
    items: list[tuple[VerifiedFact | ClauseFact, str, list[str]]] = [
        (
            vf,
            " ".join((*vf.fact.group_labels, vf.fact.label)),
            [vf.fact.value, *vf.restrictions, *vf.footnotes],
        )
        for vf in facts
        if not vf.is_governing_text
    ]
    items += [
        (c, c.evidence.anchor, [c.evidence.text, *c.restrictions, *c.footnotes]) for c in clauses
    ]
    for fact, label, texts in items:
        g = resolve(
            texts=texts,
            label=label,
            all_units=all_units,
            n_pages=len(layouts),
            exclusions=excluded,
        )
        fact.context += [t for _p, t in g.context]
        fact.definitions += [t for _p, t in g.definitions]
        fact.possible_exclusions += [t for _p, t in g.exclusions]
        fact.open_conditions[:] = [c for c in fact.open_conditions if c not in g.conditions_remove]
        for c in g.conditions_add:
            if c not in fact.open_conditions and c != "cross_reference_located":
                fact.open_conditions.append(c)


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


def _model_only(proposed_by: set[str]) -> bool:
    """Proposed by a model and by no reader (sorts after reader-found facts)."""
    return bool(proposed_by) and all(p.startswith(("text:", "visual:")) for p in proposed_by)


def _attempts(model: Any) -> int:
    """How many billable attempts one call may make (provider retry budget)."""
    config = getattr(model, "config", None)
    return int(getattr(config, "max_attempts", 1) or 1)
