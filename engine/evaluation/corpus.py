"""V2 evaluation corpus: fetch public PDFs, assign splits, seal the blind batches (WP2).

Run on the owner's machine (documents never enter git):

    REAL_PDFS_DIR=~/insurance-corpus REAL_FIXTURES_DIR=~/insurance-fixtures \\
      uv run python -m evaluation.corpus fetch --candidates ~/corpus-v2-candidates.csv

Rules (docs/v2/scope.md, Evaluation):
- Splits are assigned by insurer family, never by document, so a blind batch
  never shares a template with what the engine is tuned on.
- Families already used to tune the pre-V2 app ("dev families") go to
  validation only, never to a blind batch.
- The seed is fixed in this file before any document is fetched.
- Only hashes, types and splits are committed (evaluation/manifests/). URLs,
  insurer names and the PDFs stay outside git.
"""

import argparse
import csv
import hashlib
import json
import os
import random
import stat
import sys
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

SEED = 20261126  # pre-registered 2026-11-26, before any fetch
BLIND_MIN_PER_TYPE = 5
VALIDATION_MIN_PER_TYPE = 5
TYPES = ("sbc", "student", "travel")
# SBCs describe one plan each (federal format); levels are tested on the other two types.
MULTI_LEVEL_TYPES = ("student", "travel")
SPLITS = ("validation", "blind-a", "blind-b")
MAX_BYTES = 40 * 1024 * 1024
REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_MANIFEST = REPO_ROOT / "evaluation" / "manifests" / "corpus-v2.json"


@dataclass(frozen=True)
class Candidate:
    type: str
    family: str
    multi_level: bool
    dev_family: bool
    url: str


@dataclass(frozen=True)
class Fetched:
    candidate: Candidate
    sha256: str
    data: bytes


def load_candidates(path: Path) -> list[Candidate]:
    with path.open(newline="") as fh:
        rows = list(csv.DictReader(fh))
    out = []
    for row in rows:
        if row["type"] not in TYPES:
            raise ValueError(f"unknown type {row['type']!r}")
        out.append(
            Candidate(
                type=row["type"],
                family=row["family"].strip(),
                multi_level=row["multi_level"] == "1",
                dev_family=row["dev_family"] == "1",
                url=row["url"].strip(),
            )
        )
    return out


def assign_splits(
    docs: list[Fetched], seed: int = SEED, existing: dict[str, str] | None = None
) -> dict[str, str]:
    """Return sha256 -> split. Whole families move together; dev families stay in validation.

    ``existing`` (from the committed manifest) is permanent: a document or family that
    already has a split keeps it, so a rerun can never move a read document into a blind batch.
    """
    rng = random.Random(seed)  # noqa: S311 - reproducible split, not security
    split_of: dict[str, str] = {}
    for doc_type in TYPES:
        families: dict[str, list[Fetched]] = {}
        for d in docs:
            if d.candidate.type == doc_type:
                families.setdefault(d.candidate.family, []).append(d)
        split_of.update(_assign_type(families, rng, existing or {}))
    return split_of


def _assign_type(
    families: dict[str, list[Fetched]], rng: random.Random, existing: dict[str, str]
) -> dict[str, str]:
    split_of: dict[str, str] = {}
    counts = {"blind-a": 0, "blind-b": 0}
    fresh = []
    for family, ds in sorted(families.items()):
        known = {existing[d.sha256] for d in ds if d.sha256 in existing}
        if len(known) > 1:
            raise ValueError(f"family {family!r} is split across {sorted(known)}")
        if known:
            split = known.pop()
            split_of.update((d.sha256, split) for d in ds)
            counts[split] = counts.get(split, 0) + len(ds)
        elif not ds[0].candidate.dev_family:
            fresh.append(family)
    rng.shuffle(fresh)
    for family in fresh:
        target = next((s for s in ("blind-a", "blind-b") if counts[s] < BLIND_MIN_PER_TYPE), None)
        split_of.update((d.sha256, target or "validation") for d in families[family])
        if target:
            counts[target] += len(families[family])
    for ds in families.values():
        for d in ds:
            split_of.setdefault(d.sha256, "validation")
    return split_of


def shortfalls(docs: list[Fetched], split_of: dict[str, str]) -> list[str]:
    problems = []
    for doc_type in TYPES:
        for split in SPLITS:
            members = [
                d for d in docs if d.candidate.type == doc_type and split_of[d.sha256] == split
            ]
            need = VALIDATION_MIN_PER_TYPE if split == "validation" else BLIND_MIN_PER_TYPE
            if len(members) < need:
                problems.append(f"{doc_type}/{split}: {len(members)} of {need}")
            if (
                split == "validation"
                and doc_type in MULTI_LEVEL_TYPES
                and not any(d.candidate.multi_level for d in members)
            ):
                problems.append(f"{doc_type}/validation: no multi-level document")
    return problems


def public_manifest(docs: list[Fetched], split_of: dict[str, str], seed: int) -> dict[str, object]:
    entries = sorted(
        (
            {
                "sha256": d.sha256,
                "type": d.candidate.type,
                "split": split_of[d.sha256],
                "multi_level": d.candidate.multi_level,
            }
            for d in docs
        ),
        key=lambda e: (str(e["type"]), str(e["split"]), str(e["sha256"])),
    )
    return {"name": "corpus-v2", "seed": seed, "documents": entries}


def http_get(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("only https URLs are fetched")
    headers = {"User-Agent": "insurance-simplified-corpus/2"}
    request = urllib.request.Request(url, headers=headers)  # noqa: S310 - https checked above
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - https only
        data: bytes = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("larger than 40 MB")
    return data


def fetch_all(
    candidates: Iterable[Candidate], get: Callable[[str], bytes] = http_get
) -> tuple[list[Fetched], list[str]]:
    fetched: dict[str, Fetched] = {}
    failures = []
    for c in candidates:
        try:
            data = get(c.url)
        except Exception as exc:
            failures.append(f"{c.type}/{c.family}: {type(exc).__name__}")
            continue
        if not data.startswith(b"%PDF-"):
            failures.append(f"{c.type}/{c.family}: not a PDF")
            continue
        sha = hashlib.sha256(data).hexdigest()
        fetched.setdefault(sha, Fetched(c, sha, data))
    return list(fetched.values()), failures


def write_outputs(
    docs: list[Fetched], split_of: dict[str, str], pdf_root: Path, private_root: Path
) -> None:
    for d in docs:
        folder = pdf_root / "corpus-v2" / split_of[d.sha256]
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{d.sha256}.pdf"
        target.write_bytes(d.data)
        target.chmod(stat.S_IRUSR | stat.S_IRGRP)
    for split in ("blind-a", "blind-b"):
        note = pdf_root / "corpus-v2" / split / "SEALED.txt"
        if note.parent.exists():
            note.write_text(
                "Sealed blind batch. Do not open, read or label these files until the\n"
                "V2.0 release-candidate run (docs/v2/scope.md).\n"
                "Opening one moves it to validation.\n"
            )
    private = private_root / "corpus-v2"
    private.mkdir(parents=True, exist_ok=True)
    mapping = [
        {
            "sha256": d.sha256,
            "split": split_of[d.sha256],
            "type": d.candidate.type,
            "family": d.candidate.family,
            "url": d.candidate.url,
        }
        for d in docs
    ]
    (private / "private-mapping.json").write_text(json.dumps(mapping, indent=2) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evaluation.corpus")
    sub = parser.add_subparsers(dest="cmd", required=True)
    fetch = sub.add_parser("fetch", help="download candidates, assign splits, seal blind batches")
    fetch.add_argument("--candidates", type=Path, required=True)
    args = parser.parse_args(argv)

    pdf_root = os.environ.get("REAL_PDFS_DIR")
    private_root = os.environ.get("REAL_FIXTURES_DIR")
    if not pdf_root or not private_root:
        print("set REAL_PDFS_DIR and REAL_FIXTURES_DIR (folders outside git)", file=sys.stderr)
        return 2
    candidates = load_candidates(args.candidates)
    docs, failures = fetch_all(candidates)
    existing: dict[str, str] = {}
    if PUBLIC_MANIFEST.exists():
        previous = json.loads(PUBLIC_MANIFEST.read_text())
        existing = {e["sha256"]: e["split"] for e in previous["documents"]}
    split_of = assign_splits(docs, existing=existing)
    write_outputs(docs, split_of, Path(pdf_root).expanduser(), Path(private_root).expanduser())
    manifest = public_manifest(docs, split_of, SEED)
    manifest["created"] = datetime.now(UTC).date().isoformat()
    PUBLIC_MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"fetched {len(docs)} of {len(candidates)}; manifest: {PUBLIC_MANIFEST}")
    for line in failures:
        print(f"  not fetched: {line}")
    for line in shortfalls(docs, split_of):
        print(f"  SHORTFALL: {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
