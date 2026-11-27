"""From engine facts to the user contract (``app.schemas.facts.Fact``).

The contract's validators are the last gate: VERIFIED and NOT_COVERED need both keys
(code + a judge of a different family), a value with a basis, and evidence on the page.
This module only fills them in from what the engine proved; it never relaxes them.

* a fact that is presentable (key 1 + key 2 + no open conditions) becomes one VERIFIED
  fact per reading (a "$500 individual / $1,000 family" cell is two facts), or
  NOT_COVERED when the printed value says so;
* anything else becomes COULDN'T CONFIRM with the page the user should check - never
  "not mentioned", and never a value the checks did not confirm.

Evidence offsets index the engine's page text: the page's text-layer words in reading
order (top to bottom, then left to right) joined by single spaces (``page_text``).
"""

import hashlib
from datetime import UTC, datetime

from app.reconcile.layout import PageLayout, Word
from app.recovery.clauses import ClauseFact
from app.recovery.restrictions import VerifiedFact
from app.recovery.semantic import CHECKER, CHECKER_VERSION, Interpretation, JudgeVerdict
from app.schemas.document import BBox, ParserInfo, TextSpan
from app.schemas.facts import (
    CheckResult,
    Evidence,
    Fact,
    FactState,
    FactValue,
    Provenance,
    Qualifiers,
    Semantics,
    ValueKind,
)

STRUCTURAL = "reconcile.verify.R6"


def _order(layout: PageLayout) -> list[Word]:
    rows: list[list[Word]] = []
    for w in sorted(layout.words, key=lambda w: (w.box.top, w.box.x0)):
        if rows and abs(rows[-1][0].box.top - w.box.top) <= 2.5:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [w for r in rows for w in sorted(r, key=lambda w: w.box.x0)]


def page_text(layout: PageLayout) -> str:
    return " ".join(w.text for w in _order(layout))


def span_of(layout: PageLayout, box: tuple[float, float, float, float]) -> TextSpan | None:
    """The span of ``page_text`` covering the words inside ``box``."""
    x0, top, x1, bottom = box
    start = end = None
    pos = 0
    for w in _order(layout):
        cy = (w.box.top + w.box.bottom) / 2
        inside = x0 - 1 <= w.box.cx <= x1 + 1 and top - 1 <= cy <= bottom + 1
        if inside:
            start = pos if start is None else start
            end = pos + len(w.text)
        pos += len(w.text) + 1
    if start is None or end is None or end <= start:
        return None
    return TextSpan(page=layout.number, start=start, end=end)


def _value(r: Interpretation) -> FactValue:
    kind = ValueKind.COVERED if r.kind is ValueKind.COVERED else r.kind
    return FactValue(
        kind=kind,
        number=r.number,
        currency=r.currency,
        text=r.printed if r.number is None else None,
        basis=r.basis,
        year_kind=r.year_kind,
    )


def _ident(*parts: object) -> str:
    return "f-" + hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:24]


def to_contract(
    fact: VerifiedFact | ClauseFact,
    readings: list[Interpretation],
    verdict: JudgeVerdict | None,
    *,
    layouts: dict[int, PageLayout],
    document_sha256: str,
    plan_id: str,
    parser: ParserInfo,
) -> list[Fact]:
    if isinstance(fact, VerifiedFact):
        f = fact.fact
        # the printed row label; a row without one is named by its printed group or column
        label = " ".join((*f.group_labels, f.label)).strip() or f.header
        page, box = f.page, f.value_box
    else:
        page, label, box = fact.page, fact.evidence.anchor, fact.evidence.text_boxes[0]
    layout = layouts[page]
    span = span_of(layout, box)
    now = datetime.now(UTC)
    structural = CheckResult(passed=True, checker=STRUCTURAL, checker_version="1")
    judge = (
        CheckResult(
            passed=verdict.confirmed,
            checker=verdict.model,
            checker_version="judge-1",
            model_family=verdict.family,
            reasons=list(verdict.reasons),
        )
        if verdict is not None
        else None
    )
    provenance = Provenance(
        parser=parser,
        structural_check=CheckResult(
            passed=True,
            checker=f"{STRUCTURAL}+{CHECKER}",
            checker_version=CHECKER_VERSION,
        )
        if readings
        else structural,
        judge_check=judge,
        created_at=now,
    )
    if not fact.presentable_as_verified or span is None or not readings:
        return [
            Fact(
                id=_ident(document_sha256, page, label, "couldnt"),
                plan_id=plan_id,
                benefit_label=label,
                state=FactState.COULDNT_CONFIRM,
                provenance=provenance,
                check_page=page,
            )
        ]
    evidence = Evidence(
        document_sha256=document_sha256,
        page=page,
        value_span=span,
        bbox=BBox(x0=box[0], y0=box[1], x1=box[2], y1=box[3]),
    )
    out = []
    for r in readings:
        negated_cover = r.kind is ValueKind.COVERED and r.negated
        out.append(
            Fact(
                id=_ident(document_sha256, page, label, r.printed, r.person_level),
                plan_id=plan_id,
                benefit_label=label,
                state=FactState.NOT_COVERED if negated_cover else FactState.VERIFIED,
                value=None if negated_cover else _value(r),
                qualifiers=Qualifiers(network_tier=r.network_tier, person_level=r.person_level),
                semantics=Semantics(negated=r.negated, conditions=list(r.conditions)),
                evidence=[evidence],
                provenance=provenance,
            )
        )
    return out


__all__ = ["page_text", "span_of", "to_contract"]
