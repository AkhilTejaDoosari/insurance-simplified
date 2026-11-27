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
from collections import Counter, defaultdict
from pathlib import Path

from app.parsing.base import sha256
from app.providers.anthropic import AnthropicClient, AnthropicConfig
from app.providers.nvidia import NvidiaClient, NvidiaConfig
from app.recovery.budget import RunLimits
from app.recovery.cache import Cache
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
from app.schemas.document import Document
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
    for doc, doc_keys in by_doc.items():
        res = next(r for sha, r in results.items() if sha.startswith(doc))
        for vf in res.facts:
            f = vf.fact
            pk = [k for k in doc_keys if k.page == f.page]
            verdict, key = judge(pk, f.label, f.group_labels, (f.header,), f.value)
            outcome[verdict] += 1
            if verdict == "correct" and key is not None and key not in hit:
                hit.add(key)
                has = key.restrictions.strip() != ""
                keyed_with_restriction += has
                if vf.restrictions or vf.footnotes:
                    if has and _restriction_attached(key, [*vf.restrictions, *vf.footnotes]):
                        restricted_ok += 1
                    else:
                        restricted_wrong += 1
                for source in f.proposed_by:
                    by_source[source.split(":")[0]] += 1
    false_verified = outcome["wrong_value"] + outcome["wrong_column"]
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
        "keys_with_restrictions": sum(bool(k.restrictions.strip()) for k in keys),
        "correct_keys_with_restriction": keyed_with_restriction,
        "restrictions_attached_correct_keys": restricted_ok,
        "restrictions_attached_not_matching_key": restricted_wrong,
        "correct_keys_by_proposer": dict(by_source),
        "unresolved_items": sum(len(r.unresolved) for r in results.values()),
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
    ap.add_argument("--granted-by", default=os.environ.get("ENGINE_EVAL_GRANTED_BY", ""))
    ap.add_argument(
        "--max-cost-usd",
        default="0.05",
        help="per-document model cost cap (D-036 gate: 0.05); 'none' to measure uncapped",
    )
    ap.add_argument("--out", type=Path)
    return ap


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
    pipeline = RecoveryPipeline(
        engines, limits=RunLimits(), cache=Cache.from_env(), policy=CloudPolicy.from_env()
    )

    keys = load_keys(args.keys)
    docs = sorted({k.doc for k in keys})
    results: dict[str, RecoveryResult] = {}
    for doc in docs:
        pdf = next(args.pdfs.glob(f"{doc}*.pdf"))
        auth = None
        if args.granted_by:  # validation corpus: published plan documents only
            auth = CloudAuthorization(
                pdf.stem,
                DocumentClass.PUBLIC_CORPUS,
                frozenset({"nvidia", "anthropic"}),
                args.granted_by,
            )
        results[pdf.stem] = pipeline.run(pdf.read_bytes(), auth)
        print(f"  {doc}: {len(results[pdf.stem].facts)} verified", file=sys.stderr)
    report = score(results, keys)
    report["stages"] = sorted(
        stages | ({"text"} if args.text else set()) | ({"visual"} if args.visual else set())
    )
    print(json.dumps(report, indent=1))
    if args.out:
        args.out.write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
