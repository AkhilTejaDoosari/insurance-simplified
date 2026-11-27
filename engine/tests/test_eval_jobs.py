"""--jobs: documents run concurrently, results come back in document order."""

import argparse
import threading
import time
from pathlib import Path
from typing import Any

from evaluation.recovery_eval import _run_docs


class SlowPipeline:
    """Finishes documents in reverse order; records how many ran at once."""

    def __init__(self, order: list[str]) -> None:
        self.order = order
        self.active = 0
        self.peak = 0
        self.lock = threading.Lock()

    def run(self, pdf: bytes, auth: Any, *, progress: Any = None) -> Any:
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        name = pdf.decode()
        time.sleep(0.05 * (len(self.order) - self.order.index(name)))
        if progress is not None:
            progress("text nvidia p1: ok 0s")
        with self.lock:
            self.active -= 1
        return type("R", (), {"facts": [name]})()


def test_jobs_run_concurrently_and_keep_document_order(tmp_path: Path) -> None:
    docs = ["a-plan", "b-plan", "c-plan", "d-plan"]
    for d in docs:
        (tmp_path / f"{d}.pdf").write_bytes(d.encode())
    lines: list[str] = []
    pipe = SlowPipeline(docs)
    args = argparse.Namespace(pdfs=tmp_path, granted_by=None, jobs=4)
    results = _run_docs(pipe, docs, args, lines.append)  # type: ignore[arg-type]
    assert list(results) == docs
    assert [list(r.facts) for r in results.values()] == [[d] for d in docs]  # type: ignore[comparison-overlap]
    assert pipe.peak > 1
    assert all(line.split()[0] in docs for line in lines)  # every call line names its document


def test_one_job_is_sequential(tmp_path: Path) -> None:
    docs = ["a-plan", "b-plan"]
    for d in docs:
        (tmp_path / f"{d}.pdf").write_bytes(d.encode())
    pipe = SlowPipeline(docs)
    args = argparse.Namespace(pdfs=tmp_path, granted_by=None, jobs=1)
    assert list(_run_docs(pipe, docs, args, None)) == docs  # type: ignore[arg-type]
    assert pipe.peak == 1


def _ns(**kw: Any) -> argparse.Namespace:
    base = {
        "visual": False,
        "judge": "none",
        "alt_judge": "none",
        "token_ledger": None,
        "token_cap": None,
    }
    return argparse.Namespace(**{**base, **kw})


def test_claude_stages_need_the_token_allowance(tmp_path: Path) -> None:
    import pytest  # noqa: PLC0415

    from evaluation.recovery_eval import _parser, _token_ledger  # noqa: PLC0415

    ap = _parser()
    ledger = tmp_path / "tokens.jsonl"
    assert _token_ledger(ap, _ns(token_ledger=ledger)) is None  # Nemotron only: not metered
    for claude in ({"visual": True}, {"judge": "anthropic"}, {"alt_judge": "anthropic"}):
        with pytest.raises(SystemExit):
            _token_ledger(ap, _ns(token_ledger=ledger, **claude))
    with pytest.raises(SystemExit):
        _token_ledger(ap, _ns(token_cap=1000))  # a cap needs its ledger
    got = _token_ledger(ap, _ns(token_ledger=ledger, token_cap=1000, visual=True))
    assert got is not None and got.cap_usd == 1000
