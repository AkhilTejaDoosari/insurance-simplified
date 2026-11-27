"""Reconcile several readers' tables into facts the PDF itself supports.

Isolated: no route or job calls this yet (V2 research, docs/v2/parser-evaluation.md).
Every candidate is kept with its verdict, so disagreements, rejections and unresolved
claims stay visible instead of being silently dropped.
"""

import itertools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from app.reconcile.layout import PageLayout, norm, read_layouts
from app.reconcile.verify import (
    Candidate,
    Status,
    Verdict,
    candidates_from,
    column_header,
    verify,
)
from app.schemas.document import Document

CellKey = tuple[int, tuple[int, int]]


@dataclass
class Fact:
    """One verified cell: its value as printed, where it is, and who proposed it."""

    page: int
    label: str
    group_labels: tuple[str, ...]
    header: str
    header_page: int
    value: str  # cell text as printed (ruled cells) or the grounded candidate text
    value_box: tuple[float, float, float, float]
    bounded: bool
    proposed_by: set[str] = field(default_factory=set)
    candidate_values: set[str] = field(default_factory=set)


@dataclass
class Reconciled:
    facts: list[Fact]
    verdicts: list[Verdict]
    conflicts: list[tuple[Fact, Fact]]

    def count(self, status: Status) -> int:
        return sum(v.status is status for v in self.verdicts)


def _cells(verdicts: list[Verdict]) -> dict[CellKey, list[Verdict]]:
    """One logical cell = the printed words it occupies (page + first word position)."""
    cells: dict[CellKey, list[Verdict]] = {}
    for v in verdicts:
        if v.status is not Status.VERIFIED or not (v.value and v.label and v.header):
            continue
        vb = v.value.box
        key = (v.candidate.page, (round(vb.x0), round(vb.top)))
        cells.setdefault(key, []).append(v)
    return cells


def _fact(group: list[Verdict], text: str) -> Fact | None:
    v = next(g for g in group if norm(g.candidate.value) == text)
    if v.value is None or v.header is None:
        return None
    box = v.value.box
    return Fact(
        page=v.candidate.page,
        label=v.candidate.label,
        group_labels=v.candidate.group_labels,
        header=column_header(v.header),
        header_page=v.header_page or v.candidate.page,
        value=v.candidate.value,
        value_box=(box.x0, box.top, box.x1, box.bottom),
        bounded=v.value.bounded,
        proposed_by={g.candidate.reader for g in group if norm(g.candidate.value) == text},
        candidate_values={g.candidate.value for g in group},
    )


def _facts(verdicts: list[Verdict]) -> tuple[list[Fact], list[tuple[Fact, Fact]]]:
    """A cell's value is a candidate's own text, grounded word for word. Different
    grounded texts for one cell, or for one printed label and header, are conflicts:
    all are kept, none is presented as verified."""
    facts: list[Fact] = []
    conflicts: list[tuple[Fact, Fact]] = []
    for group in _cells(verdicts).values():
        columns = {norm(column_header(v.header)) for v in group if v.header}
        rows = {(v.label.box.x0, v.label.box.top) for v in group if v.label}
        if len(columns) > 1 or len(rows) > 1:  # readers tie the same cell to different places
            made = [f for v in group if (f := _fact([v], norm(v.candidate.value)))]
            conflicts.extend(itertools.pairwise(made))
            continue
        made = [f for t in {norm(v.candidate.value) for v in group} if (f := _fact(group, t))]
        if len(made) == 1:
            facts.extend(made)
        else:
            conflicts.extend(itertools.pairwise(made))
    seen: dict[tuple[int, str, str, str], Fact] = {}
    for fact in facts:
        k = (fact.page, norm(" ".join(fact.group_labels)), norm(fact.label), norm(fact.header))
        other = seen.setdefault(k, fact)
        if other is not fact and norm(other.value) != norm(fact.value):
            conflicts.append((other, fact))
    conflicted = {id(f) for pair in conflicts for f in pair}
    return [f for f in facts if id(f) not in conflicted], conflicts


def reconcile(
    pdf: bytes,
    documents: Mapping[str, Document],
    *,
    candidates: Sequence[Candidate] = (),
    layouts: Sequence[PageLayout] | None = None,
) -> Reconciled:
    """Verify every reader's table cells, plus any extra ``candidates`` (for example
    proposals from a language model), against the PDF's own text layer and rules.

    Where a candidate came from never changes how it is checked: a model proposal is
    verified by exactly the same rules as a parser cell. ``layouts`` lets a caller that
    reconciles the same PDF several times read its geometry once."""
    by_page: dict[int, PageLayout] = {
        p.number: p for p in (layouts if layouts is not None else read_layouts(pdf))
    }
    verdicts: list[Verdict] = []
    pending: list[Candidate] = list(candidates)
    for reader, doc in documents.items():
        for page in doc.pages:
            if page.number in by_page and page.tables:
                pending.extend(candidates_from(reader, page.tables))
    for cand in pending:
        layout = by_page.get(cand.page)
        if layout is None:
            verdicts.append(Verdict(cand, Status.REJECTED, ("page_not_in_document",)))
            continue
        verdicts.append(
            verify(cand, layout, by_page.get(cand.page - 1), by_page.get(cand.page + 1))
        )
    facts, conflicts = _facts(verdicts)
    return Reconciled(facts=facts, verdicts=verdicts, conflicts=conflicts)


__all__ = ["Candidate", "Fact", "Reconciled", "Status", "Verdict", "reconcile"]
