"""Build the replay cache ``<out>/<reader>/<sha>.json`` from existing artifacts.

Docling: converted from the Docling JSON the private corpus already published (no Docling
run). OpenDataLoader and pdfplumber: run here on the PDFs (fast, deterministic). The
output is derived document data: keep it outside git, like the PDFs.

    uv run python -m evaluation.build_reader_cache --keys K.tsv --pdfs DIR \\
        --docling-json DIR --out DIR
"""

import argparse
import json
import sys
from pathlib import Path

from app.parsing.base import sha256
from app.parsing.opendataloader import document_from_odl, odl_version, run_opendataloader
from app.parsing.pdfplumber_reader import PdfplumberReader
from evaluation.import_external import from_docling
from evaluation.score_keys import load_keys


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", type=Path, required=True, help="only the keyed documents")
    ap.add_argument("--pdfs", type=Path, required=True)
    ap.add_argument("--docling-json", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    for reader in ("docling", "opendataloader", "pdfplumber"):
        (args.out / reader).mkdir(parents=True, exist_ok=True)
    done = 0
    for doc in sorted({k.doc for k in load_keys(args.keys)}):
        path = next(args.pdfs.glob(f"{doc}*.pdf"))
        pdf = path.read_bytes()
        sha = sha256(pdf)
        if sha != path.stem:
            raise SystemExit(f"{path.name}: content hash does not match its name")
        raw = json.loads((args.docling_json / f"{sha}.json").read_text())
        out = {
            "docling": from_docling(raw, sha),
            "opendataloader": document_from_odl(
                run_opendataloader(pdf), sha, reader_version=odl_version()
            ),
            "pdfplumber": PdfplumberReader().read(pdf),
        }
        for reader, document in out.items():
            (args.out / reader / f"{sha}.json").write_text(document.model_dump_json())
        done += 1
    print(f"cached readers for {done} documents in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
