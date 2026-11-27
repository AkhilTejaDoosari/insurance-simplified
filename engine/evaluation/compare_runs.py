"""Before/after table for a sequence of recovery_eval reports (aggregates only).

    uv run python -m evaluation.compare_runs OUT_DIR local text text_visual judged

Each stage name is a report ``OUT_DIR/<name>.json``; an optional ``<name>.wall`` holds the
stage's wall-clock seconds. Exit 1 when any stage shows a false verified fact - keyed
facts or facts a user would be shown as verified - so a script can stop there.
"""

import json
import sys
from pathlib import Path
from typing import Any


def _row(name: str, d: dict[str, Any], wall: str) -> list[str]:
    contract = d.get("contract_facts_by_state", {})
    return [
        name,
        f"{d['correct_keys_with_clauses']}/{d['keys']}",
        str(d["false_verified_with_clauses"]),
        str(d.get("facts_presentable_as_fully_verified", 0)),
        f"{d.get('presentable_correct', 0)}/{d.get('presentable_false_verified', 0)}"
        f"/{d.get('presentable_unkeyed', 0)}",
        str(contract.get("verified", 0) + contract.get("not_covered", 0)),
        str(contract.get("couldnt_confirm", 0)),
        f"{d.get('model_cost_usd') or 0:.4f}",
        wall,
        ", ".join(f"{k} {v}s" for k, v in d.get("stage_seconds", {}).items() if v) or "-",
    ]


HEADER = [
    "stage",
    "correct keys",
    "false verified",
    "presentable",
    "presentable ok/false/unkeyed",
    "contract verified",
    "couldn't confirm",
    "new spend $",
    "wall s",
    "model seconds",
]


def main(argv: list[str]) -> int:
    out, names = Path(argv[0]), argv[1:]
    rows = []
    bad = False
    for name in names:
        path = out / f"{name}.json"
        if not path.exists():
            continue
        d = json.loads(path.read_text())
        wall_file = out / f"{name}.wall"
        wall = wall_file.read_text().strip() if wall_file.exists() else "-"
        rows.append(_row(name, d, wall))
        bad |= bool(d["false_verified_with_clauses"]) or bool(d.get("presentable_false_verified"))
    print("| " + " | ".join(HEADER) + " |")
    print("|" + "---|" * len(HEADER))
    for r in rows:
        print("| " + " | ".join(r) + " |")
    if bad:
        print("\nFALSE VERIFIED FACTS FOUND - stop and review before any further run.")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
