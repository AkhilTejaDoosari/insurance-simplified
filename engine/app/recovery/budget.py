"""Execution limits and the cost ledger for one document's recovery run."""

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
