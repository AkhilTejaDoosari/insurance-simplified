"""Category dictionary, US market pack (WP7; docs/v2/categories.md, docs/v2/scope.md).

The dictionary only matches wording and orders rows. It never expects content: a document
is never measured against it, and a category no document states is simply absent.

Mapping a printed label to a category is a claim, so it is verified (categories.md §2):

* **synonym** (code): the label, in comparison form, IS one of the category's synonyms,
  or a synonym followed only by qualifiers from a closed list (basis, network tier,
  "illness or injury", a parenthesis). A label that qualifies for two categories is
  ambiguous and maps to none.
* **judge**: a model proposes a category and an independent judge of a different model
  family confirms it at >= ``MAPPING_CUTOFF``. Owner decision 2026-11-27: no such judge is
  approved yet (Claude is the only approved model), so this path is closed - see
  ``app.categories.mapping``.
* anything else stays a **plan-specific row** in the document's own words, tier 3
  ("unrecognized benefits default to good to know", scope.md).

Keys, names, tiers and general explanations of the first 15 categories are the approved
demo's (docs/v2/demo/data.py CAT); the rest follow categories.md §4.
"""

import re
from dataclasses import dataclass

DICTIONARY_VERSION = "us-1"
MAPPING_CUTOFF = 0.9  # categories.md §2, owner-set start value


@dataclass(frozen=True)
class Category:
    key: str
    name: str
    tier: int  # 1 must know, 2 important, 3 good to know
    order: int  # display order inside the tier
    explain: str  # one-line general explanation ("general info")
    synonyms: tuple[str, ...]


def _c(key: str, name: str, tier: int, order: int, explain: str, *synonyms: str) -> Category:
    return Category(key, name, tier, order, explain, (name, *synonyms))


CATEGORIES: tuple[Category, ...] = (
    _c(
        "ded",
        "Deductible",
        1,
        1,
        "The amount you pay yourself before the plan starts paying its share.",
        "deductible",
        "annual deductible",
        "policy deductible",
        "deductible per policy year",
        "overall deductible",
        "plan deductible",
        "medical deductible",
        "deductible per period of coverage",
        "deductible amount",
        "calendar year deductible",
    ),
    _c(
        "oop",
        "Most you pay in a year",
        1,
        2,
        (
            'The "out-of-pocket maximum". Once you have paid this much in a year, '
            "the plan pays 100% of covered care."
        ),
        "out-of-pocket maximum",
        "out of pocket maximum",
        "out-of-pocket limit",
        "out of pocket limit",
        "maximum out-of-pocket",
        "maximum out of pocket",
        "annual out-of-pocket maximum",
        "out-of-pocket max",
        "oop maximum",
        "oop max",
        "stop loss",
    ),
    _c(
        "er",
        "ER visit",
        1,
        3,
        "Emergency room care.",
        "emergency room",
        "emergency room care",
        "emergency room visit",
        "emergency room services",
        "er visit",
        "emergency room illness",
        "emergency room injury",
        "hospital emergency room",
        "emergency room treatment",
        "emergency room facility",
    ),
    _c(
        "coins",
        "Coinsurance",
        1,
        4,
        (
            "After the deductible, you and the plan split each bill by percentage. "
            '"You pay 20%" means on a $1,000 bill you pay $200.'
        ),
        "coinsurance",
        "co-insurance",
        "coinsurance percentage",
        "plan coinsurance",
    ),
    _c(
        "hosp",
        "Hospital stay",
        1,
        5,
        "Care while you are admitted to a hospital, including room and board.",
        "hospital stay",
        "inpatient hospital",
        "inpatient hospital services",
        "hospital room and board",
        "room and board",
        "hospital confinement",
        "inpatient hospitalization",
        "hospitalization",
        "inpatient care",
        "hospital inpatient",
        "hospital expenses",
        "inpatient hospital expenses",
        "hospital room board",
    ),
    _c(
        "pre",
        "Condition you had before",
        1,
        6,
        'A "pre-existing condition" is a health problem you had before the plan started.',
        "pre-existing conditions",
        "pre-existing condition",
        "preexisting conditions",
        "pre-existing condition exclusion",
        "pre-existing condition limitation",
        "pre-existing conditions exclusion",
        "acute onset of pre-existing conditions",
    ),
    _c(
        "max",
        "Overall plan maximum",
        1,
        7,
        "The most the plan will pay in total, for the period shown.",
        "overall maximum",
        "policy maximum",
        "maximum benefit",
        "maximum limit",
        "overall maximum limit",
        "lifetime maximum",
        "annual maximum",
        "policy limit",
        "plan maximum",
        "maximum benefit limit",
        "overall policy maximum",
        "sum insured",
        "maximum per period of coverage",
        "medical maximum",
        "overall lifetime maximum",
        "aggregate maximum",
    ),
    _c(
        "doc",
        "Doctor visit",
        2,
        1,
        (
            "A regular visit to a primary care doctor. "
            'A "copay" is a fixed amount you pay at each visit.'
        ),
        "doctor visit",
        "doctor visits",
        "physician office visit",
        "physician visit",
        "physician visits",
        "office visit",
        "office visits",
        "primary care visit",
        "office visit pcp",
        "primary care physician",
        "physician office visits",
        "doctor office visit",
    ),
    _c(
        "spec",
        "Specialist visit",
        2,
        2,
        "A visit to a doctor who focuses on one area of medicine.",
        "specialist visit",
        "specialist visits",
        "specialist",
        "specialist office visit",
    ),
    _c(
        "urgent",
        "Urgent care",
        2,
        3,
        "Care for problems that need quick attention but are not emergencies.",
        "urgent care",
        "urgent care center",
        "urgent care facility",
        "urgent care visit",
    ),
    _c(
        "rx",
        "Generic prescriptions",
        2,
        4,
        "Lower-cost versions of brand-name medicines.",
        "prescription drugs",
        "prescription drug",
        "prescriptions",
        "generic drugs",
        "generic drug",
        "rx tier 1",
        "tier 1 drugs",
        "outpatient prescription drugs",
        "prescription drug benefit",
        "prescription medicines",
        "pharmacy",
        "generic prescription drugs",
    ),
    _c(
        "mh",
        "Mental health",
        2,
        5,
        "Therapy or counseling visits.",
        "mental health",
        "outpatient mental health",
        "mental health care",
        "behavioral health",
        "mental and nervous disorders",
        "mental health services",
        "behavioral health office",
        "mental illness",
    ),
    _c(
        "mat",
        "Maternity",
        2,
        6,
        "Care during pregnancy and childbirth.",
        "maternity",
        "maternity care",
        "pregnancy",
        "maternity benefits",
        "childbirth",
    ),
    _c(
        "evac",
        "Medical evacuation",
        2,
        7,
        "Transport to a hospital that can treat you when local care isn't enough.",
        "medical evacuation",
        "emergency medical evacuation",
        "emergency evacuation",
        "evacuation",
    ),
    _c(
        "repat",
        "Repatriation",
        2,
        8,
        "Transport back to your home country after a serious illness.",
        "repatriation",
        "repatriation of remains",
        "return of remains",
        "return of mortal remains",
        "medical repatriation",
        "return home",
    ),
    _c(
        "dent",
        "Dental",
        3,
        1,
        "Care for teeth.",
        "dental",
        "emergency dental",
        "dental accidental injury",
        "dental care",
        "dental treatment",
        "accidental dental",
        "dental emergency",
    ),
    _c(
        "vision",
        "Vision",
        3,
        2,
        "Eye exams and glasses or contact lenses.",
        "vision",
        "vision care",
        "eye exam",
        "routine eye exam",
    ),
    _c(
        "chiro",
        "Chiropractic",
        3,
        3,
        "Treatment of joints and spine by a chiropractor.",
        "chiropractic",
        "chiropractic care",
        "chiropractic services",
        "chiropractor",
    ),
    _c(
        "pt",
        "Physical therapy",
        3,
        4,
        "Exercises and treatment to help you recover movement.",
        "physical therapy",
        "physiotherapy",
        "rehabilitation therapy",
        "outpatient physical therapy",
    ),
    _c(
        "bedside",
        "Bedside visit",
        3,
        5,
        "Travel costs for a family member to come to you if you're in hospital.",
        "bedside visit",
        "emergency reunion",
        "family reunion",
    ),
    _c(
        "sports",
        "Sports injury rider",
        3,
        6,
        "Extra cover for injuries from school sports.",
        "sports injury rider",
        "intercollegiate sports rider",
        "intercollegiate sports",
        "sports rider",
    ),
)

BY_KEY = {c.key: c for c in CATEGORIES}

# Qualifiers that may follow a synonym without changing what the row is about.
_QUALIFIER = re.compile(
    r"^(?:\s*(?:"
    r"\([^)]*\)"  # any parenthesis: "(PPO)", "(in-network)"
    r"|per (?:policy|calendar|plan|benefit) (?:year|period)|per year|per period of coverage"
    r"|per (?:injury|sickness|illness|incident|accident|condition|trip|visit|day|admission)"
    r"|per (?:injury or sickness|illness or injury|sickness or injury)"
    r"|(?:for )?(?:each|any one) (?:injury|sickness|illness|accident|condition)"
    r"|illness or injury|injury or sickness|sickness or injury|illness|injury|sickness|accident"
    r"|in-network|out-of-network|in network|out of network|ppo|non-ppo|preferred provider"
    r"|individual|family|per person|per insured person|per member"
    r"|benefit|benefits|expenses|services|coverage|limit|amount|charges"
    r")\s*[,;]?)*\s*$",
    re.I,
)


def comparison_form(text: str) -> str:
    """Lower case, dashes and slashes as spaces, other punctuation dropped (parentheses
    kept so qualifiers can be recognised), single spaces."""
    t = text.lower().replace("\u2019", "'")
    t = re.sub("[\u2013\u2014/]", " - ", t)
    t = re.sub(r"[^a-z0-9()%$' -]", " ", t)
    t = re.sub(r"\s+-\s+", " - ", t)
    return re.sub(r"\s+", " ", t).strip(" -:")


def _synonym_forms(c: Category) -> list[str]:
    return sorted({comparison_form(s) for s in c.synonyms}, key=len, reverse=True)


_FORMS = {c.key: _synonym_forms(c) for c in CATEGORIES}


def _qualifies(label: str, synonym: str) -> bool:
    if label == synonym:
        return True
    if not label.startswith(synonym + " ") and not label.startswith(synonym + "("):
        return False
    rest = label[len(synonym) :].strip().lstrip("-:").strip()
    return bool(_QUALIFIER.match(rest))


@dataclass(frozen=True)
class SynonymMatch:
    key: str
    synonym: str  # in comparison form


def match_synonym(label: str) -> SynonymMatch | None:
    """The one category whose synonym the label is (optionally with qualifiers), or None
    when no category or more than one category qualifies."""
    form = comparison_form(label)
    if not form:
        return None
    hits: dict[str, str] = {}
    for key, forms in _FORMS.items():
        for s in forms:
            if _qualifies(form, s):
                hits[key] = s
                break
    if len(hits) != 1:
        return None
    ((key, synonym),) = hits.items()
    return SynonymMatch(key, synonym)


__all__ = [
    "BY_KEY",
    "CATEGORIES",
    "DICTIONARY_VERSION",
    "MAPPING_CUTOFF",
    "Category",
    "SynonymMatch",
    "comparison_form",
    "match_synonym",
]
