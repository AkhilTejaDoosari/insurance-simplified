"""Attribute every answer key the reconciler missed to the rule that blocked it.

Diagnostic only: it reuses the frozen scorer's matching (``score_keys.judge``) and never
changes what counts as correct, so the scorer's hash for the held-out run is untouched.
Prints aggregate counts only; per-key rows (labels, no values) go to a private TSV.

Classes, first matching rule wins:

* ``no_reader_bound`` - no reader produced a correct candidate: a reading gap, not a
  verifier gap; only a better reader or a model proposer can recover it;
* ``verified_not_fact`` - a correct candidate passed verification but the cell was
  dropped at fact level (readers disagree on its row/column, or two grounded values);
* otherwise the most frequent verifier reason among the key's correct candidates, e.g.
  ``header_is_part_of_a_longer_cell`` (rule R6), ``cell_continues_on_next_page`` (R4),
  ``candidate_is_not_the_whole_cell`` (R1), ``label_not_printed_on_page``.

Usage (private side):
    uv run python -m evaluation.attribute_misses --keys K.tsv --pdfs DIR --readers DIR \\
        [--out misses.tsv]
"""

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from app.reconcile.engine import Reconciled, reconcile
from app.reconcile.verify import Status
from app.schemas.document import Document
from evaluation.score_keys import READERS, Key, judge, load_keys

Seen = tuple[str, str, tuple[str, ...]]  # reader, verdict status, reasons


@dataclass
class Attribution:
    hit: set[Key] = field(default_factory=set)
    seen: dict[Key, list[Seen]] = field(default_factory=dict)
    raw_bound: dict[Key, set[str]] = field(default_factory=dict)

    def add(self, keys: list[Key], result: Reconciled) -> None:
        by_page: dict[int, list[Key]] = defaultdict(list)
        for k in keys:
            by_page[k.page].append(k)
        for fact in result.facts:
            verdict, key = judge(
                by_page[fact.page], fact.label, fact.group_labels, (fact.header,), fact.value
            )
            if verdict == "correct" and key is not None:
                self.hit.add(key)
        for v in result.verdicts:
            c = v.candidate
            verdict, key = judge(by_page[c.page], c.label, c.group_labels, c.header_path, c.value)
            if verdict == "correct" and key is not None:
                self.seen.setdefault(key, []).append((c.reader, v.status.value, v.reasons))
                self.raw_bound.setdefault(key, set()).add(c.reader)

    def miss_class(self, key: Key) -> str:
        found = self.seen.get(key, [])
        if not found:
            return "no_reader_bound"
        if any(status == Status.VERIFIED.value for _, status, _ in found):
            return "verified_not_fact"
        reasons = Counter(r for _, _, rs in found for r in dict.fromkeys(rs))
        return reasons.most_common(1)[0][0] if reasons else "unknown"

    def report(self, keys: list[Key]) -> dict[str, object]:
        missed = [k for k in keys if k not in self.hit]
        by_class = Counter(self.miss_class(k) for k in missed)
        by_reader_count = Counter(len(self.raw_bound.get(k, ())) for k in missed)
        return {
            "keys": len(keys),
            "reconciled_correct": len(self.hit),
            "missed": len(missed),
            "missed_by_class": dict(by_class.most_common()),
            "missed_by_number_of_readers_that_bound_it": {
                str(n): c for n, c in sorted(by_reader_count.items())
            },
        }


def attribute(keys: list[Key], pdf: bytes, documents: Mapping[str, Document]) -> Attribution:
    att = Attribution()
    att.add(keys, reconcile(pdf, documents))
    return att


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", type=Path, required=True)
    ap.add_argument("--pdfs", type=Path, required=True)
    ap.add_argument("--readers", type=Path, required=True, help="dir with <reader>/<sha>.json")
    ap.add_argument("--out", type=Path, help="private per-key miss classes (TSV)")
    args = ap.parse_args(argv)
    keys = load_keys(args.keys)
    by_doc: dict[str, list[Key]] = defaultdict(list)
    for k in keys:
        by_doc[k.doc].append(k)
    att = Attribution()
    for doc, doc_keys in sorted(by_doc.items()):
        pdf = next(args.pdfs.glob(f"{doc}*.pdf"))
        docs = {
            r: Document.model_validate_json((args.readers / r / f"{pdf.stem}.json").read_text())
            for r in READERS
            if (args.readers / r / f"{pdf.stem}.json").exists()
        }
        att.add(doc_keys, reconcile(pdf.read_bytes(), docs))
    print(json.dumps(att.report(keys), indent=1))
    if args.out:
        with args.out.open("w", newline="") as f:
            w = csv.writer(f, delimiter="\t")
            w.writerow(["doc", "page", "row_label", "column", "readers_bound", "miss_class"])
            for k in keys:
                if k in att.hit:
                    continue
                bound = ",".join(sorted(att.raw_bound.get(k, ())))
                w.writerow([k.doc, k.page, k.row_label, k.column, bound, att.miss_class(k)])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))


__all__ = ["Attribution", "attribute"]
