"""Score the progressive recovery pipeline on the validation answer keys (WP4).

Same keys, same frozen matching (``evaluation.score_keys.judge``), same verifier as the
R6 baseline; only the routing and the extra proposers change. Prints aggregate numbers
only, never document text.

Readers can be live (``--live``: OpenDataLoader runs here, Docling through a running
hybrid backend given by ``--hybrid-url``) or replayed from converted reader output in
``--readers <dir>/<reader>/<sha>.json`` (how the workspace runs Docling, whose models it
cannot download). Model stages run only with ``--text`` / ``--visual``, their provider
variables set, and the cloud policy allowing them (see ``app/recovery/policy.py``).

    uv run python -m evaluation.recovery_eval --keys K --pdfs P --readers R \\
        --stages primary,docling [--text] [--visual] [--out results.json]
"""

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from app.parsing.base import sha256
from app.providers.anthropic import AnthropicClient, AnthropicConfig
from app.providers.nvidia import NvidiaClient, NvidiaConfig
from app.reconcile.layout import read_layouts
from app.recovery.budget import RunLimits, SpendLedger
from app.recovery.cache import Cache
from app.recovery.clauses import ClauseFact
from app.recovery.engines import (
    DoclingViaOpenDataLoader,
    DocumentReader,
    OpenDataLoaderPrimary,
    PageReader,
    PdfplumberTables,
    restrict,
)
from app.recovery.pipeline import Engines, RecoveryPipeline, RecoveryResult
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from app.recovery.present import to_contract
from app.recovery.restrictions import VerifiedFact
from app.schemas.document import Document, ParserInfo
from evaluation.score_keys import Key, judge, load_keys


class ReplayReader:
    """A reader whose output was produced earlier (same converter, same grid rules)."""

    def __init__(self, root: Path, name: str) -> None:
        self.root, self.name, self.version = root, name, f"replay:{root.name}"

    def _load(self, sha: str) -> Document:
        return Document.model_validate_json((self.root / self.name / f"{sha}.json").read_text())

    def read(self, pdf: bytes) -> Document:
        return self._load(sha256(pdf))

    def read_pages(self, pdf: bytes, sha: str, pages: list[int]) -> Document:
        return restrict(self._load(sha), pages)


def _restriction_attached(key: Key, restrictions: list[str]) -> bool:
    """Strict: one text contains the other's first 40 comparison characters, and both
    have at least 20 (so "None" never matches "non-network"). Keys written as
    paraphrases of the printed text do not match; they are reported, not counted."""
    from app.reconcile.layout import norm  # noqa: PLC0415

    want = norm(key.restrictions)
    if len(want) < 20:
        return False
    for r in restrictions:
        got = norm(r)
        if len(got) >= 20 and (want[:40] in got or got[:40] in want):
            return True
    return False


def _says_none(text: str) -> bool:
    """A key whose restriction is the printed word "None" records a resolved state."""
    from app.reconcile.layout import norm  # noqa: PLC0415

    return norm(text.split("(", maxsplit=1)[0]) in {"none", "na", "notapplicable", "nolimitations"}


def _completeness(key: Key, vf: VerifiedFact) -> str:
    attached = [*vf.restrictions, *vf.footnotes]
    if attached and _restriction_attached(key, attached):
        return "attached_matching"
    if vf.open_conditions:
        return "flagged_open"
    return "attached_unmatched_text" if attached else "silent"


def _presentable_keys(results: dict[str, RecoveryResult], by_doc: dict[str, list[Key]]) -> set[Key]:
    keys: set[Key] = set()
    for doc, doc_keys in by_doc.items():
        res = next(r for sha, r in results.items() if sha.startswith(doc))
        for vf in res.facts:
            if vf.presentable_as_verified:
                f = vf.fact
                pk = [k for k in doc_keys if k.page == f.page]
                v, k = judge(pk, f.label, f.group_labels, (f.header,), f.value)
                if v == "correct" and k is not None:
                    keys.add(k)
        for c in res.clauses:
            if c.presentable_as_verified:
                e = c.evidence
                pk = [k for k in doc_keys if k.page == e.pages[0]]
                v, k = judge(pk, e.anchor, (), (e.column,), e.text)
                if v == "correct" and k is not None:
                    keys.add(k)
    return keys


def _score_clauses(
    results: dict[str, RecoveryResult], by_doc: dict[str, list[Key]]
) -> tuple[Counter[str], set[Key]]:
    outcome: Counter[str] = Counter()
    hit: set[Key] = set()
    for doc, doc_keys in by_doc.items():
        res = next(r for sha, r in results.items() if sha.startswith(doc))
        for c in res.clauses:
            e = c.evidence
            pk = [k for k in doc_keys if k.page == e.pages[0]]
            verdict, key = judge(pk, e.anchor, (), (e.column,), e.text)
            if verdict == "wrong_column" and not e.column:
                verdict = "column_unproven"  # claims no column: not a wrong claim
            outcome[verdict] += 1
            if c.presentable_as_verified:
                outcome[f"presentable:{verdict}"] += 1
            if verdict == "correct" and key is not None:
                hit.add(key)
    return outcome, hit


def score(results: dict[str, RecoveryResult], keys: list[Key]) -> dict[str, object]:
    by_doc: dict[str, list[Key]] = defaultdict(list)
    for k in keys:
        by_doc[k.doc].append(k)
    hit: set[Key] = set()
    outcome: Counter[str] = Counter()
    restricted_ok = 0
    restricted_wrong = 0  # attached text that is not the key's restriction
    keyed_with_restriction = 0
    by_source: Counter[str] = Counter()
    # P0-04 restriction completeness, over correct keys whose key records a restriction:
    # the governing text is attached and matches, or the fact says it is open; "silent"
    # is a restricted fact that would look complete - the failure this metric guards.
    completeness: Counter[str] = Counter()
    open_conditions: Counter[str] = Counter()
    presentable = 0
    # what a user would see as verified (key 1 + key 2 + nothing open), judged by the
    # frozen matcher: the false-verified count that matters for the product
    shown: Counter[str] = Counter()
    for doc, doc_keys in by_doc.items():
        res = next(r for sha, r in results.items() if sha.startswith(doc))
        for vf in res.facts:
            open_conditions.update(vf.open_conditions)
            presentable += vf.presentable_as_verified
            f = vf.fact
            pk = [k for k in doc_keys if k.page == f.page]
            verdict, key = judge(pk, f.label, f.group_labels, (f.header,), f.value)
            outcome[verdict] += 1
            if vf.presentable_as_verified and not vf.is_governing_text:
                shown[verdict] += 1
            if verdict == "correct" and key is not None and key not in hit:
                hit.add(key)
                has = key.restrictions.strip() != ""
                keyed_with_restriction += has
                if has and not _says_none(key.restrictions):
                    completeness[_completeness(key, vf)] += 1
                if vf.restrictions or vf.footnotes:
                    if has and _restriction_attached(key, [*vf.restrictions, *vf.footnotes]):
                        restricted_ok += 1
                    else:
                        restricted_wrong += 1
                for source in f.proposed_by:
                    by_source[source.split(":")[0]] += 1
    clause_outcome, clause_hit = _score_clauses(results, by_doc)
    false_verified = outcome["wrong_value"] + outcome["wrong_column"]
    clause_false = clause_outcome["wrong_value"] + clause_outcome["wrong_column"]
    pages: Counter[str] = Counter()
    seconds: dict[str, float] = defaultdict(float)
    statuses: Counter[str] = Counter()
    cost: float | None = 0.0
    for r in results.values():
        for e in r.ledger.entries:
            pages[e.stage] += len(e.pages)
            seconds[e.stage] += e.seconds
            statuses[f"{e.stage}:{e.status}"] += 1
        c = r.ledger.cost_usd()
        cost = None if cost is None or c is None else cost + c
    return {
        "keys": len(keys),
        "documents": len(by_doc),
        "correct_keys": len(hit),
        "critical_recall": round(len(hit) / len(keys), 4),
        "false_verified": false_verified,
        "false_verified_wrong_value": outcome["wrong_value"],
        "false_verified_wrong_column": outcome["wrong_column"],
        "verified_precision": round(outcome["correct"] / (outcome["correct"] + false_verified), 4)
        if outcome["correct"] + false_verified
        else None,
        "verified_unkeyed": outcome["unkeyed"],
        # P0-01 prose clauses, judged by the same frozen matcher (header = proven column)
        "clause_facts": sum(len(r.clauses) for r in results.values()),
        "clause_correct": clause_outcome["correct"],
        "clause_false_verified": clause_false,
        "clause_unkeyed": clause_outcome["unkeyed"],
        "clause_column_unproven": sum(
            not c.evidence.column for r in results.values() for c in r.clauses
        ),
        "correct_keys_with_clauses": len(hit | clause_hit),
        "false_verified_with_clauses": false_verified + clause_false,
        "keys_with_restrictions": sum(bool(k.restrictions.strip()) for k in keys),
        "correct_keys_with_restriction": keyed_with_restriction,
        "restrictions_attached_correct_keys": restricted_ok,
        "restrictions_attached_not_matching_key": restricted_wrong,
        "correct_keys_by_proposer": dict(by_source),
        "restriction_completeness": dict(completeness),
        "facts_with_open_conditions": dict(open_conditions),
        "presentable_correct": shown["correct"] + clause_outcome["presentable:correct"],
        "presentable_false_verified": shown["wrong_value"]
        + shown["wrong_column"]
        + clause_outcome["presentable:wrong_value"]
        + clause_outcome["presentable:wrong_column"],
        "presentable_unkeyed": shown["unkeyed"] + clause_outcome["presentable:unkeyed"],
        "presentable_correct_keys": len(
            {k for k in hit | clause_hit if k in _presentable_keys(results, by_doc)}
        ),
        "facts_presentable_as_fully_verified": presentable
        + sum(c.presentable_as_verified for r in results.values() for c in r.clauses),
        "semantic_reasons": dict(
            Counter(
                reason
                for r in results.values()
                for reasons in [
                    *(f.semantic_reasons for f in r.facts),
                    *(c.semantic_reasons for c in r.clauses),
                ]
                for reason in reasons
            ).most_common(12)
        ),
        "unresolved_items": sum(len(r.unresolved) for r in results.values()),
        "review_required_items": sum(len(r.review) for r in results.values()),
        "unresolved_by_state": dict(
            Counter(str(u.state) for r in results.values() for u in r.unresolved)
        ),
        "printed_amount_lines_by_state": dict(
            Counter(str(i.state) for r in results.values() if r.coverage for i in r.coverage.items)
        ),
        "conflicts": sum(len(r.conflicts) for r in results.values()),
        "pages_routed": dict(pages),
        "stage_seconds": {k: round(v, 1) for k, v in seconds.items()},
        "stage_status": dict(statuses),
        "model_cost_usd": None if cost is None else round(cost, 4),
    }


def main(argv: list[str]) -> int:
    if "--start-hybrid" in argv:
        from opendataloader_pdf.hybrid_launcher import HybridServer  # noqa: PLC0415

        # Same Docling settings as the measured run: TableFormer accurate, no OCR
        # (the validation PDFs have text layers; OCR text could not be verified anyway).
        with HybridServer(["--no-ocr"]) as server:
            rest = [a for a in argv if a != "--start-hybrid"]
            return _main([*rest, "--live", "--hybrid-url", server.url])
    return _main(argv)


def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", type=Path, required=True)
    ap.add_argument("--pdfs", type=Path, required=True)
    ap.add_argument("--readers", type=Path, help="replayed reader output <dir>/<reader>/")
    ap.add_argument("--live", action="store_true", help="run OpenDataLoader (and Docling) here")
    ap.add_argument("--hybrid-url", help="Docling backend (opendataloader-pdf-hybrid) URL")
    ap.add_argument(
        "--start-hybrid",
        action="store_true",
        help="start a local Docling backend on 127.0.0.1 for this run (needs the hybrid group)",
    )
    ap.add_argument("--stages", default="primary,docling")
    ap.add_argument("--text", action="store_true", help="Nemotron stage")
    ap.add_argument("--visual", action="store_true", help="Claude stage")
    ap.add_argument(
        "--alt-judge",
        choices=("none", "anthropic", "nvidia"),
        default="none",
        help="judge for facts the main judge's own family proposed (other family required)",
    )
    ap.add_argument(
        "--route-missed",
        action="store_true",
        help="also send pages with printed amounts no reader proposed to the text model",
    )
    ap.add_argument(
        "--judge",
        choices=("none", "anthropic", "nvidia"),
        default="none",
        help="semantic judge for key 2 (must differ from the proposing model families)",
    )
    ap.add_argument("--granted-by", default=os.environ.get("ENGINE_EVAL_GRANTED_BY", ""))
    ap.add_argument(
        "--max-cost-usd",
        default="0.05",
        help="per-document model cost cap (D-036 gate: 0.05); 'none' only without model stages",
    )
    ap.add_argument(
        "--eval-budget-usd",
        type=float,
        default=float(os.environ.get("ENGINE_EVAL_BUDGET_USD", "25")),
        help="cumulative evaluation spending cap across runs (approved: $25)",
    )
    ap.add_argument(
        "--spend-ledger",
        type=Path,
        default=os.environ.get("ENGINE_EVAL_SPEND_LEDGER") or None,
        help="append-only spending ledger shared by every evaluation run (required for models)",
    )
    ap.add_argument("--out", type=Path)
    return ap


def _contract_states(results: dict[str, RecoveryResult], pdfs: Path) -> dict[str, int]:
    """What the web app would receive: the user contract's states (present.py)."""
    states: Counter[str] = Counter()
    for sha, r in results.items():
        layouts = {lay.number: lay for lay in read_layouts((pdfs / f"{sha}.pdf").read_bytes())}
        parser = ParserInfo(name="opendataloader", version="eval")
        items: list[VerifiedFact | ClauseFact] = [
            *(f for f in r.facts if not f.is_governing_text),
            *r.clauses,
        ]
        for f in items:
            for c in to_contract(
                f,
                f.readings,
                f.judge,
                layouts=layouts,
                document_sha256=sha,
                plan_id="eval",
                parser=parser,
            ):
                states[str(c.state)] += 1
        states["couldnt_confirm(review_required)"] += len(r.review)
    return dict(states)


def _cost_cap(value: str) -> float | None:
    if value.strip().lower() == "none":
        return None
    cap = float(value)
    if cap <= 0:
        raise SystemExit("--max-cost-usd must be positive")
    return cap


def _set_judge(
    ap: argparse.ArgumentParser, which: str, engines: Engines, *, alt: bool = False
) -> None:
    model: AnthropicClient | NvidiaClient
    if which == "none":
        return
    if which == "anthropic":
        an = AnthropicConfig.from_env()
        if an is None:
            ap.error("a Claude judge needs ENGINE_ANTHROPIC_API_KEY")
        model, provider, family = AnthropicClient(an), "anthropic", "anthropic-claude"
    else:
        nv = NvidiaConfig.from_env()
        if nv is None:
            ap.error("a Nemotron judge needs LLM_BASE_URL and LLM_API_KEY")
        model, provider, family = NvidiaClient(nv), "nvidia", "nvidia-nemotron"
    if alt:
        if family == engines.judge_family and engines.judge is not None:
            ap.error("--alt-judge must be another model family than --judge")
        engines.alt_judge, engines.alt_judge_provider, engines.alt_judge_family = (
            model,
            provider,
            family,
        )
    else:
        engines.judge, engines.judge_provider, engines.judge_family = model, provider, family


def _spend_ledger(
    ap: argparse.ArgumentParser, args: argparse.Namespace, max_cost: float | None
) -> SpendLedger | None:
    """P0-05: model stages run only under both a per-document cap and the cumulative
    evaluation budget. No uncapped paid experiments."""
    if not (args.text or args.visual or args.judge != "none" or args.alt_judge != "none"):
        return None
    if max_cost is None:
        ap.error("--max-cost-usd none is refused when a model stage is on")
    if args.spend_ledger is None:
        ap.error("model stages need --spend-ledger (or ENGINE_EVAL_SPEND_LEDGER)")
    return SpendLedger(args.spend_ledger, args.eval_budget_usd)


def _run_docs(
    pipeline: RecoveryPipeline, docs: list[str], args: argparse.Namespace
) -> dict[str, RecoveryResult]:
    results: dict[str, RecoveryResult] = {}
    for i, doc in enumerate(docs, 1):
        pdf = next(args.pdfs.glob(f"{doc}*.pdf"))
        t_doc = time.monotonic()
        print(f"  [{i}/{len(docs)}] {doc}", file=sys.stderr, flush=True)
        auth = None
        if args.granted_by:  # validation corpus: published plan documents only
            auth = CloudAuthorization(
                pdf.stem,
                DocumentClass.PUBLIC_CORPUS,
                frozenset({"nvidia", "anthropic"}),
                args.granted_by,
            )
        results[pdf.stem] = pipeline.run(pdf.read_bytes(), auth)
        print(
            f"  [{i}/{len(docs)}] {doc}: {len(results[pdf.stem].facts)} verified"
            f" in {time.monotonic() - t_doc:.0f}s",
            file=sys.stderr,
            flush=True,
        )
    return results


def _main(argv: list[str]) -> int:
    ap = _parser()
    args = ap.parse_args(argv)
    stages = set(args.stages.split(","))

    primary: DocumentReader
    docling: PageReader | None
    if args.live:
        primary = OpenDataLoaderPrimary()
        docling = DoclingViaOpenDataLoader(args.hybrid_url) if args.hybrid_url else None
    else:
        if args.readers is None:
            ap.error("--readers is required without --live")
        primary = ReplayReader(args.readers, "opendataloader")
        docling = ReplayReader(args.readers, "docling")
    engines = Engines(
        primary=primary,
        docling=docling if "docling" in stages else None,
        pdfplumber=(
            (PdfplumberTables() if args.live else ReplayReader(args.readers, "pdfplumber"))
            if "pdfplumber" in stages
            else None
        ),
    )
    if args.text:
        nv = NvidiaConfig.from_env()
        if nv is None:
            ap.error("--text needs LLM_BASE_URL and LLM_API_KEY")
        engines.text_model = NvidiaClient(nv)
    if args.visual:
        an = AnthropicConfig.from_env()
        if an is None:
            ap.error("--visual needs ENGINE_ANTHROPIC_API_KEY")
        engines.visual_model = AnthropicClient(an)
    _set_judge(ap, args.judge, engines)
    _set_judge(ap, args.alt_judge, engines, alt=True)
    max_cost = _cost_cap(args.max_cost_usd)
    spend = _spend_ledger(ap, args, max_cost)
    t_run = time.monotonic()

    def progress(message: str) -> None:  # stage, provider, page numbers, status - no text
        print(f"    {time.monotonic() - t_run:6.0f}s  {message}", file=sys.stderr, flush=True)

    pipeline = RecoveryPipeline(
        engines,
        limits=RunLimits(max_cost_usd=max_cost, route_missed_amounts=args.route_missed),
        cache=Cache.from_env(),
        policy=CloudPolicy.from_env(),
        spend=spend,
        progress=progress if (args.text or args.visual or args.judge != "none") else None,
    )

    keys = load_keys(args.keys)
    docs = sorted({k.doc for k in keys})
    results = _run_docs(pipeline, docs, args)
    report = score(results, keys)
    report["contract_facts_by_state"] = _contract_states(results, args.pdfs)
    report["stages"] = sorted(
        stages
        | ({"text"} if args.text else set())
        | ({"visual"} if args.visual else set())
        | ({f"judge:{args.judge}"} if args.judge != "none" else set())
        | ({f"alt_judge:{args.alt_judge}"} if args.alt_judge != "none" else set())
    )
    report["max_cost_usd_per_document"] = max_cost
    if spend is not None:
        report["evaluation_budget_usd"] = spend.cap_usd
        report["evaluation_committed_usd"] = spend.committed_usd()
    print(json.dumps(report, indent=1))
    if args.out:
        args.out.write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
