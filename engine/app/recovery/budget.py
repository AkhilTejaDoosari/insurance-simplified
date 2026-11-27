"""Execution limits and the cost ledger for one document's recovery run."""

import io
import os
import time
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RunLimits:
    max_seconds: float = 900.0  # whole run; stages that would start later are skipped
    max_docling_pages: int = 40
    max_text_calls: int = 12  # Nemotron
    max_text_pages_per_call: int = 2
    max_visual_calls: int = 6  # Claude
    max_visual_pages_per_call: int = 2  # target page(s); one context page may be added
    max_page_chars: int = 12_000  # independent page text sent per page
    text_max_tokens: int = 16_000
    visual_max_tokens: int = 16_000
    # P0-02 coverage as a routing signal: also send pages where printed amounts were
    # proposed by nobody to the text model. Opt-in: it is a cost decision.
    route_missed_amounts: bool = False
    max_judge_calls: int = 12  # semantic judge (key 2), facts batched per call
    judge_facts_per_call: int = 10
    judge_max_tokens: int = 4_000
    # D-036 per-document cost gate. Model calls stop once the document's recorded cost
    # reaches it; with a cap set, a provider without a configured price is not called
    # (an unknown cost cannot be held to a cap). None = no cap (evaluation runs only).
    max_cost_usd: float | None = 0.05


@dataclass(frozen=True)
class Price:
    """USD per million tokens. Unknown prices stay unknown (cost reported as None)."""

    input_per_mtok: float
    output_per_mtok: float


def price_from_env(provider: str) -> Price | None:
    p = provider.upper()
    i, o = os.environ.get(f"ENGINE_PRICE_{p}_IN"), os.environ.get(f"ENGINE_PRICE_{p}_OUT")
    if i is None or o is None:
        return None
    return Price(float(i), float(o))


@dataclass(frozen=True)
class LedgerEntry:
    stage: str
    engine: str
    version: str
    pages: tuple[int, ...]
    seconds: float
    status: str  # ok | cached | failed | refused | skipped | invalid_output
    detail: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = 0.0
    bytes_disclosed: int = 0  # bytes of document content sent off the engine


@dataclass
class Ledger:
    started: float = field(default_factory=time.monotonic)
    entries: list[LedgerEntry] = field(default_factory=list)

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    def add(self, entry: LedgerEntry) -> None:
        self.entries.append(entry)

    def calls(self, stage: str) -> int:
        return sum(
            e.stage == stage and e.status in ("ok", "invalid_output", "failed")
            for e in self.entries
        )

    def cost_usd(self) -> float | None:
        costs = [e.cost_usd for e in self.entries]
        return None if any(c is None for c in costs) else round(sum(c or 0.0 for c in costs), 6)

    def summary(self) -> dict[str, object]:
        by: dict[str, dict[str, float]] = {}
        for e in self.entries:
            s = by.setdefault(e.stage, {"calls": 0, "seconds": 0.0, "pages": 0, "in": 0, "out": 0})
            s["calls"] += 1
            s["seconds"] = round(s["seconds"] + e.seconds, 2)
            s["pages"] += len(e.pages)
            s["in"] += e.input_tokens
            s["out"] += e.output_tokens
        return {"stages": by, "cost_usd": self.cost_usd(), "seconds": round(self.elapsed(), 2)}


def token_cost(price: Price | None, input_tokens: int, output_tokens: int) -> float | None:
    if price is None:
        return None
    return (input_tokens * price.input_per_mtok + output_tokens * price.output_per_mtok) / 1e6


# ------------------------------------------------------------------ P0-05 budget control
#
# A model call is admitted only after its worst-case cost is reserved, against the
# document's cap (RunLimits.max_cost_usd) and, in evaluation runs, against a cumulative
# spending ledger shared by every run (SpendLedger). Estimates are deliberately high:
# input at 2.5 characters per token (English text is ~4), 8,000 tokens for every PDF page
# sent to a visual model (page image plus its text layer), and the full max_tokens of
# output. A call whose price is unknown cannot be reserved and is not made.

CHARS_PER_TOKEN = 2.5
VISUAL_TOKENS_PER_PAGE = 8_000
NOT_BILLED = frozenset({429})  # rate limited: rejected before any work was done


def estimate_text_tokens(*parts: str) -> int:
    return int(sum(len(p) for p in parts) / CHARS_PER_TOKEN) + 1


def estimate_visual_tokens(pages: int, *parts: str) -> int:
    return pages * VISUAL_TOKENS_PER_PAGE + estimate_text_tokens(*parts)


def worst_case_usd(price: Price, input_tokens: int, max_output_tokens: int) -> float:
    cost = token_cost(price, input_tokens, max_output_tokens)
    assert cost is not None  # noqa: S101 - price is known here
    return cost


def retry_charge_usd(failed_attempts: tuple[int, ...], worst_case: float) -> float:
    """Each failed attempt that may have been processed is charged at the worst case: a
    timeout (0) or a 5xx can be billed even though nothing usable came back."""
    return sum(worst_case for status in failed_attempts if status not in NOT_BILLED)


class BudgetExceededError(RuntimeError):
    pass


class SpendLedger:
    """Cumulative evaluation spending, shared by every run that names the same file.

    Append-only JSON lines under an exclusive file lock. A reservation counts as spent
    until it is settled, so a run that crashes mid-call leaves its worst case on the
    books (conservative). ``cap_usd`` is the approved evaluation budget."""

    def __init__(self, path: "os.PathLike[str] | str", cap_usd: float) -> None:
        from pathlib import Path  # noqa: PLC0415

        if cap_usd <= 0:
            raise ValueError("cap_usd must be positive")
        self.path = Path(path)
        self.cap_usd = cap_usd
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)

    def _locked(self) -> "_Lock":
        return _Lock(self.path)

    @staticmethod
    def _committed(lines: list[str]) -> float:
        import json  # noqa: PLC0415

        reserved: dict[str, float] = {}
        settled: dict[str, float] = {}
        for line in lines:
            if not line.strip():
                continue
            row = json.loads(line)
            (reserved if row["kind"] == "reserve" else settled)[row["id"]] = float(row["usd"])
        return sum(settled.get(k, v) for k, v in reserved.items()) + sum(
            v for k, v in settled.items() if k not in reserved
        )

    def committed_usd(self) -> float:
        with self._locked() as f:
            return round(self._committed(f.read().splitlines()), 6)

    def reserve(self, usd: float, label: str) -> str:
        """Reserve ``usd`` or raise BudgetExceededError; returns the reservation id."""
        import json  # noqa: PLC0415
        import uuid  # noqa: PLC0415

        with self._locked() as f:
            committed = self._committed(f.read().splitlines())
            if committed + usd > self.cap_usd:
                raise BudgetExceededError(
                    f"evaluation budget: {committed:.4f} committed + {usd:.4f} > {self.cap_usd}"
                )
            rid = uuid.uuid4().hex
            f.write(json.dumps({"kind": "reserve", "id": rid, "usd": usd, "label": label}) + "\n")
            return rid

    def settle(self, rid: str, usd: float) -> None:
        """Replace a reservation by what the call actually cost (may exceed it)."""
        import json  # noqa: PLC0415

        with self._locked() as f:
            f.read()
            f.write(json.dumps({"kind": "settle", "id": rid, "usd": usd}) + "\n")


class _Lock:
    def __init__(self, path: "os.PathLike[str]") -> None:
        self.path = path

    def __enter__(self) -> "io.TextIOWrapper":
        import fcntl  # noqa: PLC0415

        self.f = open(self.path, "a+", encoding="utf-8")
        fcntl.flock(self.f, fcntl.LOCK_EX)
        self.f.seek(0)
        return self.f

    def __exit__(self, *_: object) -> None:
        import fcntl  # noqa: PLC0415

        self.f.flush()
        os.fsync(self.f.fileno())
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()
