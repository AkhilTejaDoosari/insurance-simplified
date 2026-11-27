"""Run readers on the real validation PDFs and score SBC structure (WP4, real data).

    CORPUS_DIR=~/insurance-corpus/corpus-v2/validation \\
      uv run --group parser-eval python -m evaluation.real_run

Every reader runs in the sandbox (one process per document). The SBC check is a
structural proxy, not the answer-key score: on each federal Summary of Benefits
and Coverage it asks whether the reader put the deductible and out-of-pocket
answers in the "Answers" column of their question rows, and the in-network cost
of four everyday services in the in-network column of their rows. It does not
check that the value is right; the answer keys do that.
"""

import json
import os
import re
import time
from pathlib import Path

from app.parsing.sandbox import Limits, parse_isolated
from app.schemas.document import Document

MANIFEST = Path(__file__).resolve().parents[2] / "evaluation" / "manifests" / "corpus-v2.json"
QUESTIONS = {
    "deductible": r"overall\s+deductible",
    "out-of-pocket": r"out[-\s]*of[-\s]*pocket\s+limit",
}
SERVICES = {
    "primary care": r"primary care visit",
    "specialist": r"specialist visit",
    "emergency room": r"emergency room",
    "generic drugs": r"generic drugs",
}
_OUT_OF_NETWORK = re.compile(
    r"out[-\s]+of[-\s]+network|non[-\s]+network|non[-\s]*participating", re.IGNORECASE
)
_IN_NETWORK_TERMS = re.compile(r"network|participating|preferred|provider|tier\s*1", re.IGNORECASE)
_ANSWER = re.compile(r"\$|\bno\b|\bnone\b|\bnot applicable\b", re.IGNORECASE)


def _in_network(header: str) -> bool:
    """The lowest-cost network column, however the plan names it ("Network Provider",
    "Participating Provider", "Tier 1 Preferred", "Non-IHCP In-Network Provider")."""
    if "limitation" in header or not _IN_NETWORK_TERMS.search(header):
        return False
    return not _OUT_OF_NETWORK.search(header) or bool(re.search(r"\bin[-\s]+network", header))


def sbc_bound(doc: Document) -> set[str]:
    got: set[str] = set()
    for page in doc.pages:
        for table in page.tables:
            headers = {c.id: " ".join(c.header_path).lower() for c in table.columns}
            labels = {r.id: r.label for r in table.rows}
            for cell in table.cells:
                header, label = headers[cell.column_id], labels[cell.row_id]
                for key, rx in QUESTIONS.items():
                    if (
                        "answer" in header
                        and re.search(rx, label, re.I)
                        and _ANSWER.search(cell.text)
                    ):
                        got.add(key)
                in_network = _in_network(header)
                for key, rx in SERVICES.items():
                    if in_network and re.search(rx, label, re.I) and cell.text.strip():
                        got.add(key)
    return got


def main() -> int:
    corpus = Path(os.environ.get("CORPUS_DIR", "")).expanduser()
    if not corpus.is_dir():
        print("set CORPUS_DIR to the folder holding the validation PDFs")
        return 2
    manifest = {e["sha256"]: e for e in json.loads(MANIFEST.read_text())["documents"]}
    pdfs = sorted(corpus.glob("*.pdf"))
    for reader in ("pdfplumber", "pymupdf"):
        failed, seconds = 0, 0.0
        tally = dict.fromkeys([*QUESTIONS, *SERVICES], 0)
        sbcs = 0
        for pdf in pdfs:
            started = time.perf_counter()
            result = parse_isolated(pdf.read_bytes(), reader, Limits(seconds=120))
            seconds += time.perf_counter() - started
            is_sbc = manifest.get(pdf.stem, {}).get("type") == "sbc"
            sbcs += is_sbc  # a document the reader can't parse still counts against it
            if result.document is None:
                failed += 1
                continue
            if is_sbc:
                for key in sbc_bound(result.document):
                    tally[key] += 1
        print(f"{reader}: {len(pdfs) - failed}/{len(pdfs)} parsed, {seconds:.0f}s total")
        print("  SBC bound: " + "  ".join(f"{k} {v}/{sbcs}" for k, v in tally.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
