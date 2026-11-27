"""Governing context beyond the fact's own row and page (P1-01).

A fact's printed row is not always where its conditions live: a value says "see the
Durable Medical Equipment section", a footnote is defined pages later, an exclusion list
at the end of the document names the service. This module retrieves that context from
the same document and attaches it only through a printed, checkable relation.

Retrieval mirrors the web app's RAG (``web/app/lib/rag``): page-preserving text units
with their nearest section heading, a lexical BM25 leg, and Reciprocal Rank Fusion with
the same fixed ``k = 60`` (``fusion.ts``). The second leg here is structural (same
section, then page distance) instead of embeddings: a single document needs no vector
store and no new provider. Ranking only *finds* candidates; it is never evidence.

What it does to a verified fact (table or clause):

* **cross-reference, in this document** ("See … section", "the chart on page N"): the
  target heading or page is located by printed text; the section's first block is
  attached as governing context and the open condition is replaced by
  ``cross_reference_located`` (the judge still reads the attached text). A target that
  cannot be located stays ``cross_reference_unresolved``.
* **cross-reference to outside material** (a URL, a phone number, "your plan
  document"): ``external_reference`` - it cannot be resolved here and stays open.
* **possible exclusion**: an item of the document's exclusion list shares a distinctive
  printed word with the fact's row label -> recorded as a retrieval candidate and shown
  to the semantic judge, which can only veto. Not an open condition and never attached
  as a restriction: sharing a word is not proof (measured: it over-flags).
* **definitions**: a printed "Term: …" / "Term means …" line in a definitions section
  for a term used in the fact is attached as supporting context (not a condition).
"""

import math
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.reconcile.layout import PageLayout, Word, norm

RRF_K = 60  # web/app/lib/rag/fusion.ts
_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "the a an of and or for to in on at by with your you this that is are be your plan "
    "care services service provider providers network covered coverage cost costs pay "
    "visit visits other per may not no yes".split()
)
_EXTERNAL = re.compile(
    r"www\.|https?:|[\w.-]+\.(?:com|gov|org|net)\b|plan document|policy (?:document|"
    r"certificate)|certificate of coverage|summary plan description|evidence of coverage|"
    r"benefit booklet|\bcall\s+(?:us\s+)?(?:at\s+)?(?:1[-\s.])?\(?\d{3}",
    re.I,
)
_SECTION_REF = re.compile(r"\bsee\s+(?:the\s+)?([A-Z][\w &/-]{2,60}?)\s+section\b", re.I)
_PAGE_REF = re.compile(r"\bpage\s+(\d{1,3})\b", re.I)
_EXCLUSION_HEADING = re.compile(r"exclu|not cover|does not cover|doesn.t cover", re.I)
_DEFINITION_HEADING = re.compile(r"definition|glossary|terms you should know", re.I)


@dataclass(frozen=True)
class Unit:
    """A printed block: lines that belong together, with its page and section."""

    page: int
    text: str
    box: tuple[float, float, float, float]
    section: str  # nearest preceding heading ("" when none)
    is_heading: bool


@dataclass
class Governing:
    context: list[tuple[int, str]] = field(default_factory=list)  # (page, printed text)
    definitions: list[tuple[int, str]] = field(default_factory=list)
    exclusions: list[tuple[int, str]] = field(default_factory=list)  # possible, not proven
    conditions_add: list[str] = field(default_factory=list)
    conditions_remove: list[str] = field(default_factory=list)


def _rows(layout: PageLayout) -> list[list[Word]]:
    """Line segments: words on one line, split where a wide gap separates columns."""
    lines: list[list[Word]] = []
    for w in sorted(layout.words, key=lambda w: (w.box.top, w.box.x0)):
        if lines and abs(lines[-1][0].box.top - w.box.top) <= 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    out: list[list[Word]] = []
    for line in lines:
        line.sort(key=lambda w: w.box.x0)
        height = max(line[0].box.bottom - line[0].box.top, 6.0)
        seg = [line[0]]
        for w in line[1:]:
            if w.box.x0 - seg[-1].box.x1 > 2.5 * height:
                out.append(seg)
                seg = []
            seg.append(w)
        out.append(seg)
    return out


def _heading_like(text: str) -> bool:
    words = text.split()
    if re.match(r"\W*see\b", text, re.I):  # a reference line is never a heading
        return False
    if not 1 <= len(words) <= 9 or text.rstrip().endswith((".", ",", ";")):
        return False
    letters = [c for c in text if c.isalpha()]
    caps = sum(c.isupper() for c in letters) / max(1, len(letters))
    titled = sum(w[:1].isupper() for w in words if w[:1].isalpha()) / max(1, len(words))
    return caps > 0.6 or titled > 0.7 or text.rstrip().endswith(":")


def _unit(page: int, block: list[list[Word]], section: str) -> Unit:
    words = [w for r in block for w in r]
    text = " ".join(w.text for w in words)
    box = (
        min(w.box.x0 for w in words),
        min(w.box.top for w in words),
        max(w.box.x1 for w in words),
        max(w.box.bottom for w in words),
    )
    heading = len(block) == 1 and _heading_like(text)
    return Unit(page, text, box, text if heading else section, heading)  # section: caller


def _blocks(layout: PageLayout) -> list[list[list[Word]]]:
    """Segments joined into blocks per column: a segment continues the open block whose
    last segment sits directly above it with the same left edge."""
    blocks: list[list[list[Word]]] = []
    for seg in sorted(_rows(layout), key=lambda r: (r[0].box.top, r[0].box.x0)):
        height = max(seg[0].box.bottom - seg[0].box.top, 6.0)
        for block in reversed(blocks):
            prev = block[-1]
            gap = seg[0].box.top - prev[0].box.bottom
            if -1 <= gap <= 0.9 * height and abs(seg[0].box.x0 - block[0][0].box.x0) <= 20:
                block.append(seg)
                break
        else:
            blocks.append([seg])
    return sorted(blocks, key=lambda b: (b[0][0].box.top, b[0][0].box.x0))


def _section_for(box: tuple[float, float, float, float], heads: list[Unit], carried: str) -> str:
    """Nearest heading above the block in its own column on this page, else the section
    carried over from earlier pages (two columns must not share a heading)."""
    above = [h for h in heads if h.box[3] <= box[1] + 1 and h.box[0] < box[2] and box[0] < h.box[2]]
    return max(above, key=lambda h: h.box[3]).text if above else carried


def units(layouts: Sequence[PageLayout]) -> list[Unit]:
    """Blocks of lines per column; a heading-like one-line block (or a heading set tight
    above prose) names the section of the blocks below it in its column."""
    out: list[Unit] = []
    carried = ""
    for layout in layouts:
        heads: list[Unit] = []
        for block in _blocks(layout):
            first = " ".join(w.text for w in block[0])
            second = " ".join(w.text for w in block[1]) if len(block) > 1 else ""
            prose = len(second.split()) >= 5 or second.rstrip().endswith(".")
            parts = [block]
            if second and prose and _heading_like(first) and not _heading_like(second):
                parts = [block[:1], block[1:]]  # a heading set tight above prose
            for part in parts:
                unit = _unit(layout.number, part, "")
                if unit.is_heading:
                    heads.append(unit)
                    out.append(unit)
                    continue
                out.append(
                    Unit(
                        unit.page,
                        unit.text,
                        unit.box,
                        _section_for(unit.box, heads, carried),
                        False,
                    )
                )
        if heads:
            carried = max(heads, key=lambda h: h.box[3]).text
    return out


# ------------------------------------------------------------------ retrieval


def _terms(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 2]


def bm25(query: str, docs: Sequence[Unit], k1: float = 1.2, b: float = 0.75) -> list[int]:
    """Indices of ``docs`` by BM25 score (the lexical leg), best first, score > 0 only."""
    toks = [_terms(d.text) for d in docs]
    avg = sum(map(len, toks)) / max(1, len(toks))
    df: Counter[str] = Counter(t for ts in toks for t in set(ts))
    n = len(docs)
    q = set(_terms(query))
    scores = []
    for i, ts in enumerate(toks):
        tf = Counter(ts)
        s = 0.0
        for t in q & tf.keys():
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(ts) / max(avg, 1)))
        if s > 0:
            scores.append((s, i))
    return [i for _s, i in sorted(scores, reverse=True)]


def rrf(*legs: Sequence[int]) -> list[int]:
    """Reciprocal Rank Fusion, k = 60 fixed (web/app/lib/rag/fusion.ts)."""
    score: dict[int, float] = {}
    for leg in legs:
        for rank, i in enumerate(leg):
            score[i] = score.get(i, 0.0) + 1.0 / (RRF_K + rank + 1)
    return sorted(score, key=lambda i: -score[i])


def retrieve(
    query: str, all_units: Sequence[Unit], page: int, section: str, k: int = 3
) -> list[Unit]:
    """Candidates only (never evidence): lexical leg fused with a structural leg."""
    lexical = bm25(query, all_units)
    structural = sorted(
        lexical, key=lambda i: (all_units[i].section != section, abs(all_units[i].page - page))
    )
    return [all_units[i] for i in rrf(lexical, structural)[:k]]


# -------------------------------------------------------------- attachments


def _section_body(all_units: Sequence[Unit], heading: Unit) -> Unit | None:
    i = all_units.index(heading)
    for u in all_units[i + 1 :]:
        if u.is_heading:
            return None
        return u
    return None


def _distinctive(label: str) -> set[str]:
    return {t for t in _terms(label) if len(t) >= 5}


def _cross_references(g: Governing, joined: str, all_units: Sequence[Unit], n_pages: int) -> None:
    located = False
    for ref in _SECTION_REF.finditer(joined):
        name = norm(ref.group(1))
        heads = [u for u in all_units if u.is_heading and name and name in norm(u.text)]
        if len(heads) == 1:  # one printed heading by that name; several -> ambiguous
            body = _section_body(all_units, heads[0])
            g.context.append((heads[0].page, heads[0].text))
            if body is not None:
                g.context.append((body.page, body.text))
            located = True
    if any(1 <= int(p.group(1)) <= n_pages for p in _PAGE_REF.finditer(joined)):
        located = True  # the referenced page is part of this document
    if _EXTERNAL.search(joined):
        g.conditions_add.append("external_reference")  # outside material: stays open
        g.conditions_remove.append("cross_reference_unresolved")
    elif located:
        g.conditions_add.append("cross_reference_located")
        g.conditions_remove.append("cross_reference_unresolved")


def exclusion_items(all_units: Sequence[Unit], layouts: Sequence[PageLayout]) -> list[Unit]:
    """Short list items under an exclusion heading. On a ruled page the item must sit in
    the heading's box (no ruling line between them); elsewhere, in its section."""
    by_page = {lay.number: lay for lay in layouts}
    heads = [u for u in all_units if u.is_heading and _EXCLUSION_HEADING.search(u.text)]
    items: list[Unit] = []
    for u in all_units:
        layout = by_page.get(u.page)
        if layout is None or u.is_heading or len(u.text.split()) > 15:
            continue
        for h in heads:
            if layout.ruled and h.page == u.page and u.box[1] > h.box[1]:
                cx = (u.box[0] + u.box[2]) / 2
                if not layout.h_rule_between(cx, h.box[3], u.box[1]):
                    items.append(u)
                    break
            elif not layout.ruled and u.section == h.text:
                items.append(u)
                break
    return items


def _exclusions(g: Governing, label: str, items: Sequence[Unit]) -> None:
    words = _distinctive(label)
    if not words:
        return
    for u in items:
        if words & set(_terms(u.text)):
            g.exclusions.append((u.page, u.text))
    # Not an open condition: on the validation SBCs a shared word over-flagged unrelated
    # rows and missed lists whose heading wraps. The items go to the semantic judge as
    # possibly relevant text, where they can only veto (meaning incomplete), never confirm.


def _definitions(g: Governing, used: set[str], all_units: Sequence[Unit]) -> None:
    for u in all_units:
        if u.is_heading or not _DEFINITION_HEADING.search(u.section):
            continue
        term = re.match(r"\s*[\"“]?([A-Z][\w\s-]{1,40}?)[\"”]?\s*(?::|\bmeans\b)", u.text)
        if term and set(_terms(term.group(1))) and set(_terms(term.group(1))) <= used:
            g.definitions.append((u.page, u.text))


def resolve(
    *,
    texts: Sequence[str],
    label: str,
    all_units: Sequence[Unit],
    n_pages: int,
    exclusions: Sequence[Unit] = (),
) -> Governing:
    """Governing context for one fact. ``texts``: its printed value and attached text;
    ``exclusions``: the document's exclusion list items (``exclusion_items``)."""
    g = Governing()
    _cross_references(g, " ".join(texts), all_units, n_pages)
    _exclusions(g, label, exclusions)
    _definitions(g, set(_terms(" ".join((label, *texts)))), all_units)
    return g


__all__ = [
    "Governing",
    "Unit",
    "bm25",
    "exclusion_items",
    "resolve",
    "retrieve",
    "rrf",
    "units",
]
