"""Score readers and the reconciler against frozen answer keys (protocol v1).

The keys and the reader output are private (REAL_PDFS_DIR side); this module prints
aggregate numbers only, never document text.

Key file: TSV with columns doc, page, row_label, column, value, restrictions, note
(one row per printed cell; see docs/v2/parser-evaluation.md "Protocol v1").

Matching (frozen):
* label: the printed row label equals the candidate's own label, or one is a prefix of
  the other covering >= 60% of it (so "Facility fee" never matches "Facility fee (e.g.,
  hospital room)"), or it equals the candidate's group label; a key with a group must
  also find it among the candidate's group labels;
* column: some header element of the candidate starts with the printed column name
  (or the reverse, >= 8 characters), so "Network Provider" never matches
  "Out-of-Network Provider";
* value: equal after ``norm`` (letters, digits, $ and %).

Outcomes per verified fact (or raw candidate): CORRECT; WRONG_VALUE (label and column
match a key, value matches none); WRONG_COLUMN (label and value match a key, column
does not); otherwise UNKEYED (outside the key scope, e.g. limitation columns).
"""

import argparse
import csv
import json
import sys
import time
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from app.reconcile.engine import reconcile
from app.reconcile.layout import norm
from app.reconcile.verify import Candidate, Status, candidates_from
from app.schemas.document import Document

READERS = ("pdfplumber", "opendataloader", "docling")


@dataclass(frozen=True)
class Key:
    doc: str
    page: int
    row_label: str
    column: str
    value: str
    restrictions: str
    group: str = ""


def load_keys(path: Path) -> list[Key]:
    with path.open(newline="") as f:
        return [
            Key(
                r["doc"],
                int(r["page"]),
                r["row_label"],
                r["column"],
                r["value"],
                r.get("restrictions", "") or "",
                r.get("group", "") or "",
            )
            for r in csv.DictReader(f, delimiter="\t")
        ]


def label_matches(key: str, label: str, groups: Iterable[str]) -> bool:
    k, c = norm(key), norm(label)
    short, long_ = sorted((k, c), key=len)
    prefix = len(short) >= 6 and len(short) >= 0.6 * len(long_) and long_.startswith(short)
    if k and c and (k == c or prefix):
        return True
    return any(norm(g) == k for g in groups if g)


def column_matches(key: str, header: Iterable[str]) -> bool:
    k = norm(key)
    for element in header:
        e = norm(element)
        if e and (e.startswith(k) or (len(e) >= 8 and k.startswith(e))):
            return True
    return False


def judge(
    keys: list[Key], label: str, groups: tuple[str, ...], header: tuple[str, ...], value: str
) -> tuple[str, Key | None]:
    """('correct', key) | ('wrong_value', key) | ('wrong_column', key) | ('unkeyed', None)."""
    rows = [
        k
        for k in keys
        if label_matches(k.row_label, label, groups)
        and (not k.group or any(norm(g).startswith(norm(k.group)[:20]) for g in groups))
    ]
    in_col = [k for k in rows if column_matches(k.column, header)]
    for k in in_col:
        if norm(k.value) == norm(value):
            return "correct", k
    if in_col:
        return "wrong_value", in_col[0]
    for k in rows:
        if norm(k.value) == norm(value):
            return "wrong_column", k
    return "unkeyed", None


@dataclass
class Tally:
    raw: dict[str, Counter[str]]
    covered_by: dict[Key, set[str]]
    rec: Counter[str]
    rec_hit: set[Key]
    errors: list[tuple[str, Key | None, str]]
    seconds: float = 0.0


def _score_document(tally: Tally, pdf: Path, readers: Path, doc_keys: list[Key]) -> None:
    sha = pdf.stem
    docs = {
        r: Document.model_validate_json((readers / r / f"{sha}.json").read_text()) for r in READERS
    }
    for r, d in docs.items():
        for page in d.pages:
            for cand in candidates_from(r, page.tables):
                pk = [k for k in doc_keys if k.page == cand.page]
                verdict, key = judge(
                    pk, cand.label, cand.group_labels, cand.header_path, cand.value
                )
                tally.raw[r][verdict] += 1
                if verdict == "correct" and key is not None:
                    tally.covered_by.setdefault(key, set()).add(r)
    t = time.perf_counter()
    result = reconcile(pdf.read_bytes(), docs)
    tally.seconds += time.perf_counter() - t
    tally.rec["candidates"] += len(result.verdicts)
    for s in Status:
        tally.rec[f"candidates_{s.value}"] += result.count(s)
    tally.rec["conflicts"] += len(result.conflicts)
    for fact in result.facts:
        pk = [k for k in doc_keys if k.page == fact.page]
        verdict, key = judge(pk, fact.label, fact.group_labels, (fact.header,), fact.value)
        tally.rec[verdict] += 1
        if verdict == "correct" and key is not None:
            tally.rec_hit.add(key)
        elif verdict in ("wrong_value", "wrong_column"):
            tally.errors.append((verdict, key, fact.value))


def _report(tally: Tally, keys: list[Key], documents: int) -> dict[str, object]:
    rec = tally.rec
    correct = rec["correct"]
    false_verified = rec["wrong_value"] + rec["wrong_column"]
    return {
        "keys": len(keys),
        "documents": documents,
        "raw_reader": {
            r: {
                "correct_keys": len({k for k, rs in tally.covered_by.items() if r in rs}),
                "wrong_value": c["wrong_value"],
                "wrong_column": c["wrong_column"],
            }
            for r, c in tally.raw.items()
        },
        "potential_coverage_union": len(tally.covered_by),
        "reconciled": {
            "correct_keys": len(tally.rec_hit),
            "false_verified": false_verified,
            "false_verified_wrong_value": rec["wrong_value"],
            "false_verified_wrong_column": rec["wrong_column"],
            "verified_unkeyed": rec["unkeyed"],
            "verified_precision": round(correct / (correct + false_verified), 4)
            if correct + false_verified
            else None,
            "critical_recall": round(len(tally.rec_hit) / len(keys), 4),
            "conflicts": rec["conflicts"],
            "candidates": rec["candidates"],
            "candidates_verified": rec["candidates_verified"],
            "candidates_rejected": rec["candidates_rejected"],
            "candidates_unresolved": rec["candidates_unresolved"],
            "keys_with_restrictions": sum(bool(k.restrictions.strip()) for k in keys),
            "restrictions_attached": 0,
            "seconds": round(tally.seconds, 1),
            "model_cost_usd": 0.0,
        },
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", type=Path, required=True)
    ap.add_argument("--pdfs", type=Path, required=True)
    ap.add_argument("--readers", type=Path, required=True, help="dir with <reader>/<sha>.json")
    ap.add_argument("--out", type=Path, help="private per-key results (TSV)")
    args = ap.parse_args(argv)
    keys = load_keys(args.keys)
    by_doc: dict[str, list[Key]] = defaultdict(list)
    for k in keys:
        by_doc[k.doc].append(k)
    tally = Tally({r: Counter() for r in READERS}, {}, Counter(), set(), [])
    for doc, doc_keys in sorted(by_doc.items()):
        _score_document(tally, next(args.pdfs.glob(f"{doc}*.pdf")), args.readers, doc_keys)
    print(json.dumps(_report(tally, keys, len(by_doc)), indent=1))
    if args.out:
        with args.out.open("w", newline="") as f:
            w = csv.writer(f, delimiter="\t")
            w.writerow(
                ["doc", "page", "row_label", "column", "readers_correct", "reconciled_correct"]
            )
            for k in keys:
                readers = ",".join(sorted(tally.covered_by.get(k, ())))
                w.writerow([k.doc, k.page, k.row_label, k.column, readers, k in tally.rec_hit])
            for verdict, key, value in tally.errors:
                where = [key.doc, key.page, key.row_label] if key else ["", "", ""]
                w.writerow(["ERROR", verdict, *where, value])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))


__all__ = ["Candidate", "Key", "column_matches", "judge", "label_matches", "load_keys"]
