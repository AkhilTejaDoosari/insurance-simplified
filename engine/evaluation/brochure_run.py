"""Claude text recovery on the public validation brochures (student + travel), through
the real ``/v1/extract`` code path (``extract_pdf``).

    uv run python -m evaluation.brochure_run CORPUS_DIR OUT_DIR [--only N] [--jobs 4] [--gpt]
                                             [--review FILE]

Needs the Claude configuration from ``evaluation.eval_env`` in the environment. Only the
pinned public validation documents of type student/travel are read (corpus-v2 manifest);
blind batches are never touched. The policy enables Anthropic only - plus OpenAI with
``--gpt`` (GPT judges the lines Claude proposed: key 2, D-034). Each document is capped at
$1 by the engine itself; Claude tokens count against ENGINE_CLAUDE_TOKEN_CAP when set.
``--review FILE`` writes every VERIFIED fact (label, quote, value, plain line) for a human
check: derived document data - keep it outside git.

Writes aggregates only (counts, categories, cost, tokens) to OUT_DIR/brochures.json and
prints a table: never document text. Model replies are cached in OUT_DIR/model-cache
(derived document data: keep OUT_DIR out of git), so a rerun pays only for what changed.

Checks, per returned quote (``printed``): its words are printed on its evidence page -
the quote's comparison form occurs in the page's reading-order text, or equals the words
inside its evidence box. Any quote that fails is counted as ``quote_not_on_page``.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from app.api.extract import claude_text_model, claude_token_ledger, extract_pdf, gpt_judge_model
from app.parsing.base import sha256
from app.reconcile.layout import norm, read_layouts
from app.recovery.budget import Ledger, SpendLedger
from app.recovery.cache import Cache
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from app.recovery.present import box_text, page_text
from evaluation.corpus import PUBLIC_MANIFEST

CATEGORIES: list[tuple[str, re.Pattern[str]]] = [
    ("out_of_pocket", re.compile(r"out[- ]?of[- ]?pocket|\boop\b", re.I)),
    ("deductible", re.compile(r"deductible|excess", re.I)),
    ("maximum_limit", re.compile(r"maximum|\bmax\b|limit|sum insured", re.I)),
    ("coinsurance", re.compile(r"co-?insurance|co-?pay(ment)? percentage", re.I)),
    (
        "emergency_room",
        re.compile(r"emergency room|\ber\b|emergency (?:medical|treatment|care|services)", re.I),
    ),
    ("hospital", re.compile(r"hospital|inpatient|room and board", re.I)),
    ("prescription", re.compile(r"prescription|\brx\b|drug|pharmac", re.I)),
    ("pre_existing", re.compile(r"pre-?\s?existing", re.I)),
]


def category(label: str) -> str | None:
    """First matching category of a printed label (out-of-pocket before maximum)."""
    return next((name for name, pattern in CATEGORIES if pattern.search(label)), None)


def run_one(  # noqa: PLR0917
    pdf: bytes,
    granted_by: str,
    policy: CloudPolicy,
    cache: Cache,
    gpt: bool = False,
    tokens: SpendLedger | None = None,
    review: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    sha = sha256(pdf)
    providers = frozenset({"anthropic", "openai"} if gpt else {"anthropic"})
    auth = CloudAuthorization(sha, DocumentClass.PUBLIC_CORPUS, providers, granted_by)
    ledgers: list[Ledger] = []
    x = extract_pdf(
        pdf,
        "eval",
        auth,
        text_model=claude_text_model(),
        gpt_model=gpt_judge_model() if gpt else None,
        policy=policy,
        cache=cache,
        tokens=tokens,
        on_ledger=ledgers.append,
    )
    layouts = {lay.number: lay for lay in read_layouts(pdf)}
    texts = {n: norm(page_text(lay)) for n, lay in layouts.items()}
    facts = {f.id: f for f in x.facts}
    cats: Counter[str] = Counter()
    verified_cats: Counter[str] = Counter()
    off_page = 0
    for fid, printed in x.printed.items():
        f = facts[fid]
        ev = f.evidence[0]
        in_text = norm(printed.text) in texts[ev.page]
        box = (ev.bbox.x0, ev.bbox.y0, ev.bbox.x1, ev.bbox.y1) if ev.bbox else None
        in_box = box is not None and norm(box_text(layouts[ev.page], box)) == norm(printed.text)
        if not (in_text or in_box):
            off_page += 1
        if (c := category(f.benefit_label)) is not None:
            cats[c] += 1
            if f.state == "verified":
                verified_cats[c] += 1
        if f.state == "verified" and review is not None:
            review.append(
                {
                    "sha": sha[:12],
                    "page": ev.page,
                    "label": f.benefit_label,
                    "category": f.category_key,
                    "quote": printed.text,
                    "value": f.value.model_dump(mode="json") if f.value else None,
                    "plain": x.plain.get(fid, ""),
                    "judge": f.provenance.judge_check.model_family
                    if f.provenance.judge_check
                    else None,
                }
            )
    printed_in_doc = {
        name
        for name, pattern in CATEGORIES
        if any(pattern.search(page_text(lay)) for lay in layouts.values())
    }
    ledger = ledgers[0]
    model = [e for e in ledger.entries if e.stage in ("text", "visual", "judge", "plain")]
    statuses = Counter(f"{e.status}:{e.detail}" if e.detail else e.status for e in model)
    return {
        "sha": sha[:12],
        "pages": x.pages,
        "facts": len(x.facts),
        "quotes": len(x.printed),
        "states": dict(Counter(str(f.state) for f in x.facts)),
        "open_items": len(x.open_items),
        "quote_not_on_page": off_page,
        "categories_returned": dict(cats),
        "categories_verified": dict(verified_cats),
        "plain_lines": len(x.plain),
        "usage": [u.model_dump(mode="json") for u in x.model_usage],
        "categories_printed": sorted(printed_in_doc),
        "model_calls": x.model_calls,
        "cost_usd": x.model_cost_usd,
        "tokens_in": sum(e.input_tokens for e in model),
        "tokens_out": sum(e.output_tokens for e in model),
        "call_status": dict(statuses),
        "pages_sent": sorted({p for e in model if e.status != "skipped" for p in e.pages}),
    }


def main(argv: list[str]) -> int:  # noqa: PLR0915 - a linear measurement script
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--only", type=int, default=0, help="first N documents (pilot)")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--gpt", action="store_true", help="GPT judges Claude's lines (key 2)")
    ap.add_argument("--review", type=Path, help="write verified facts here (outside git)")
    args = ap.parse_args(argv)
    tokens, refusal = claude_token_ledger()
    if refusal:
        print(f"Claude token allowance: {refusal}")
        return 2
    granted_by = os.environ.get("ENGINE_EVAL_GRANTED_BY", "")
    if not os.environ.get("ENGINE_ANTHROPIC_API_KEY") or not granted_by:
        print("missing Claude configuration: run evaluation.eval_env first")
        return 2
    manifest = json.loads(PUBLIC_MANIFEST.read_text())
    docs = sorted(
        (
            d
            for d in manifest["documents"]
            if d["split"] == "validation" and d["type"] in ("student", "travel")
        ),
        key=lambda d: (d["type"], d["sha256"]),
    )
    pdfs: list[tuple[dict[str, Any], bytes]] = []
    for d in docs:
        path = args.corpus / f"{d['sha256']}.pdf"
        pdf = path.read_bytes()
        if sha256(pdf) != d["sha256"]:
            print(f"hash mismatch {d['sha256'][:12]}: stopping")
            return 2
        pdfs.append((d, pdf))
    if args.only:
        pdfs = sorted(pdfs, key=lambda t: len(t[1]))[: args.only]
    retention = frozenset(
        p.strip()
        for p in os.environ.get("ENGINE_CLOUD_RETENTION_REVIEWED", "").split(",")
        if p.strip()
    )
    if "kodekey" not in retention and "kodekloud" in os.environ.get(
        "ENGINE_ANTHROPIC_BASE_URL", ""
    ):
        print("Claude goes through KodeKey but the retention record does not name kodekey")
        return 2
    if args.gpt and "openai" not in retention:
        print("--gpt: the retention record (ENGINE_CLOUD_RETENTION_REVIEWED) must name openai")
        return 2
    enabled = frozenset({"anthropic", "openai"} if args.gpt else {"anthropic"})
    policy = CloudPolicy(enabled_providers=enabled, retention_reviewed=retention)
    review: list[dict[str, Any]] = []
    args.out.mkdir(parents=True, exist_ok=True)
    cache = Cache(args.out / "model-cache")

    def one(item: tuple[dict[str, Any], bytes]) -> dict[str, Any]:
        d, pdf = item
        r = run_one(pdf, granted_by, policy, cache, args.gpt, tokens, review)
        r["type"] = d["type"]
        print(
            f"{d['type']:7} {r['sha']} p={r['pages']:3} quotes={r['quotes']:3} "
            f"off_page={r['quote_not_on_page']} verified={r['states'].get('verified', 0):2} "
            f"plain={r['plain_lines']:2} calls={r['model_calls']:2} "
            f"${r['cost_usd']} {r['call_status']}",
            flush=True,
        )
        return r

    with ThreadPoolExecutor(max(1, args.jobs)) as pool:
        results = list(pool.map(one, pdfs))

    total = {
        "documents": len(results),
        "documents_with_quotes": sum(r["quotes"] > 0 for r in results),
        "quotes": sum(r["quotes"] for r in results),
        "quote_not_on_page": sum(r["quote_not_on_page"] for r in results),
        "verified_states": sum(r["states"].get("verified", 0) for r in results),
        "open_items": sum(r["open_items"] for r in results),
        "cost_usd": round(sum(r["cost_usd"] or 0.0 for r in results), 4),
        "max_cost_usd": max((r["cost_usd"] or 0.0 for r in results), default=0.0),
        "unknown_cost_documents": sum(r["cost_usd"] is None for r in results),
        "model_calls": sum(r["model_calls"] for r in results),
        "tokens_in": sum(r["tokens_in"] for r in results),
        "tokens_out": sum(r["tokens_out"] for r in results),
        "plain_lines": sum(r["plain_lines"] for r in results),
        "claude_tokens_committed": None if tokens is None else tokens.committed_usd(),
    }
    by_provider: dict[str, dict[str, float]] = {}
    for r in results:
        for u in r["usage"]:
            b = by_provider.setdefault(u["provider"], {"calls": 0, "in": 0, "out": 0, "usd": 0.0})
            b["calls"] += u["calls"]
            b["in"] += u["input_tokens"]
            b["out"] += u["output_tokens"]
            b["usd"] = round(b["usd"] + (u["cost_usd"] or 0.0), 4)
    total["by_provider"] = by_provider
    if args.review:
        args.review.write_text(json.dumps(review, indent=1, ensure_ascii=False))
    per_cat = {
        name: {
            "printed_in_docs": sum(name in r["categories_printed"] for r in results),
            "returned_in_docs": sum(name in r["categories_returned"] for r in results),
            "verified_in_docs": sum(name in r["categories_verified"] for r in results),
        }
        for name, _ in CATEGORIES
    }
    (args.out / "brochures.json").write_text(
        json.dumps({"total": total, "categories": per_cat, "documents": results}, indent=1)
    )
    print(json.dumps({"total": total, "categories": per_cat}, indent=1))
    return 1 if total["quote_not_on_page"] else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
