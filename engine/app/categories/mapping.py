"""Printed label -> category: synonym first; else a model proposal confirmed by a judge of
another model family at >= MAPPING_CUTOFF; else a plan-specific row (categories.md §2).

Owner decision 2026-11-27: no judge of a family other than Claude is approved, so the
proposal path is built and tested but closed - ``map_labels`` makes no model call unless
both a proposer and a judge of a DIFFERENT family are passed in, and nothing in the engine
passes them yet. A proposal alone never maps a label.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.categories.dictionary import BY_KEY, MAPPING_CUTOFF, match_synonym


class Method(StrEnum):
    SYNONYM = "synonym"
    JUDGE = "judge"
    PLAN_SPECIFIC = "plan_specific"  # kept in the document's own words


@dataclass(frozen=True)
class Mapping:
    key: str | None
    method: Method
    detail: str = ""  # the synonym matched, or the judge's model


class CategoryProposer(Protocol):
    family: str

    def propose(self, labels: list[str]) -> dict[str, str]:
        """label -> proposed category key (labels it cannot place are left out)."""
        ...


class CategoryJudge(Protocol):
    family: str
    model: str

    def confidence(self, label: str, key: str) -> float:
        """0..1: how sure the judge is that ``label`` means category ``key``."""
        ...


def map_labels(
    labels: Iterable[str],
    proposer: CategoryProposer | None = None,
    judge: CategoryJudge | None = None,
) -> dict[str, Mapping]:
    out: dict[str, Mapping] = {}
    rest: list[str] = []
    for label in dict.fromkeys(labels):
        hit = match_synonym(label)
        if hit is not None:
            out[label] = Mapping(hit.key, Method.SYNONYM, hit.synonym)
        else:
            rest.append(label)
    independent = proposer is not None and judge is not None and judge.family != proposer.family
    proposed = proposer.propose(rest) if independent and rest and proposer is not None else {}
    for label in rest:
        key = proposed.get(label)
        if key in BY_KEY and judge is not None and judge.confidence(label, key) >= MAPPING_CUTOFF:
            out[label] = Mapping(key, Method.JUDGE, judge.model)
        else:
            out[label] = Mapping(None, Method.PLAN_SPECIFIC)
    return out


__all__ = ["CategoryJudge", "CategoryProposer", "Mapping", "Method", "map_labels"]
