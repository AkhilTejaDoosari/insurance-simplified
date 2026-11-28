"""Category dictionary and label mapping (WP7): synonym first; a model proposal maps only
with a judge of another family at >= 0.9; anything else stays plan-specific."""

import pytest

from app.categories.dictionary import BY_KEY, CATEGORIES, match_synonym
from app.categories.mapping import Method, map_labels


@pytest.mark.parametrize(
    ("label", "key"),
    [
        ("Deductible", "ded"),
        ("Deductible per Policy Year", "ded"),
        ("Deductible per Injury or Sickness", "ded"),
        ("Out-of-Pocket Maximum (PPO)", "oop"),
        ("Out of Pocket Maximum", "oop"),
        ("Coinsurance", "coins"),
        ("Emergency Room - Illness or Injury", "er"),
        ("Emergency Room – Illness or Injury", "er"),  # noqa: RUF001 - printed en dash
        ("Hospital Room and Board", "hosp"),
        ("Inpatient Hospital Expenses", "hosp"),
        ("Prescription Drugs", "rx"),
        ("Generic Drugs", "rx"),
        ("Pre-existing Conditions", "pre"),
        ("Pre-Existing Condition Limitation", "pre"),
        ("Overall Maximum Limit", "max"),
        ("Maximum Limit", "max"),
        ("Emergency Medical Evacuation", "evac"),
        ("Return of Remains", "repat"),
        ("Physician Office Visit", "doc"),
    ],
)
def test_printed_wording_maps_by_synonym(label: str, key: str) -> None:
    hit = match_synonym(label)
    assert hit is not None and hit.key == key


@pytest.mark.parametrize(
    "label",
    [
        "Emergency Room Deductible",  # a deductible OF the ER: neither row as such
        "Deductible waived for Emergency Room",
        "What is the overall deductible?",
        "Annual Maximum means the maximum payable limit per Policy Year.",
        "Surgeon's benefit",
        "",
    ],
)
def test_other_wording_is_not_forced_into_a_category(label: str) -> None:
    assert match_synonym(label) is None


def test_dictionary_keeps_the_demo_keys_and_tiers() -> None:
    for key, tier in {"ded": 1, "oop": 1, "er": 1, "coins": 1, "pre": 1, "max": 1, "rx": 2}.items():
        assert BY_KEY[key].tier == tier
    assert len({c.key for c in CATEGORIES}) == len(CATEGORIES)


class Proposer:
    family = "anthropic-claude"

    def propose(self, labels: list[str]) -> dict[str, str]:
        return {label: "hosp" for label in labels}


class Judge:
    def __init__(self, family: str, conf: float) -> None:
        self.family, self.conf, self.model, self.asked = family, conf, "judge-x", 0

    def confidence(self, label: str, key: str) -> float:
        self.asked += 1
        return self.conf


def test_synonym_first_and_plan_specific_without_a_judge() -> None:
    m = map_labels(["Deductible", "Hospital Indemnity"])
    assert m["Deductible"].method is Method.SYNONYM and m["Deductible"].key == "ded"
    assert m["Hospital Indemnity"] == m["Hospital Indemnity"].__class__(None, Method.PLAN_SPECIFIC)


def test_a_judge_of_the_same_family_never_confirms() -> None:
    judge = Judge("anthropic-claude", 0.99)
    m = map_labels(["Hospital Indemnity"], Proposer(), judge)
    assert m["Hospital Indemnity"].method is Method.PLAN_SPECIFIC and judge.asked == 0


def test_judge_confirmation_needs_the_cutoff() -> None:
    assert (
        map_labels(["Hospital Indemnity"], Proposer(), Judge("other", 0.89))[
            "Hospital Indemnity"
        ].method
        is Method.PLAN_SPECIFIC
    )
    m = map_labels(["Hospital Indemnity"], Proposer(), Judge("other", 0.9))["Hospital Indemnity"]
    assert (m.key, m.method) == ("hosp", Method.JUDGE)
