"""Visual evidence on pages without a text layer (P0-03).

A scanned page has no text layer, so the verifier has nothing printed to check a value
against. A visual model (Claude) may still read the page image and propose cells; those
proposals become **review-required items**, never verified facts:

* they carry visual provenance - the page, the model and prompt version, and the SHA-256
  of the exact page bytes the model was shown - so a reviewer can open the same image;
* their state is ``review_required`` with the reasons (``no_text_layer``,
  ``model_proposal_only``); two models agreeing, or one model being confident, does not
  change that (agreement is not evidence);
* on the user contract they are "couldn't confirm" with the page to check
  (``check_page``), and the page stays ``unresolved`` in the coverage report.

They become verifiable only when an independent source of printed text exists for the
page (e.g. an OCR text layer accepted under its own rules) - not part of this module.
"""

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from app.reconcile.verify import Candidate
from app.schemas.facts import FactState


class ReviewState(StrEnum):
    REVIEW_REQUIRED = "review_required"


@dataclass(frozen=True)
class VisualProvenance:
    page: int
    model: str
    prompt_version: str
    image_sha256: str  # the page-subset PDF the model was shown
    context_pages: tuple[int, ...]


@dataclass(frozen=True)
class ReviewItem:
    page: int
    group_labels: tuple[str, ...]
    label: str
    header: tuple[str, ...]
    value: str
    provenance: VisualProvenance
    state: ReviewState = ReviewState.REVIEW_REQUIRED
    reasons: tuple[str, ...] = ("no_text_layer", "model_proposal_only")

    @property
    def contract_state(self) -> FactState:
        return FactState.COULDNT_CONFIRM  # with check_page = page

    @property
    def presentable_as_verified(self) -> bool:
        return False


def review_items(
    candidates: list[Candidate],
    *,
    model: str,
    prompt_version: str,
    shown: dict[int, tuple[bytes, tuple[int, ...]]],
) -> list[ReviewItem]:
    """``shown``: target page -> (page-subset PDF bytes, pages in it)."""
    out: list[ReviewItem] = []
    seen: set[tuple[int, str, tuple[str, ...], str]] = set()
    for c in candidates:
        if c.page not in shown:
            continue  # a proposal for a page the model was not asked about
        key = (c.page, c.label, c.header_path, c.value)
        if key in seen:
            continue
        seen.add(key)
        subset, pages = shown[c.page]
        out.append(
            ReviewItem(
                c.page,
                c.group_labels,
                c.label,
                c.header_path,
                c.value,
                VisualProvenance(
                    c.page, model, prompt_version, hashlib.sha256(subset).hexdigest(), pages
                ),
            )
        )
    return out


__all__ = ["ReviewItem", "ReviewState", "VisualProvenance", "review_items"]
