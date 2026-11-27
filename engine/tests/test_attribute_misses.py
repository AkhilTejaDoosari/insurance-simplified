"""Missed-key attribution on a synthetic ruled table (no real documents)."""

from evaluation.attribute_misses import attribute
from evaluation.score_keys import Key
from tests.test_reconcile import _doc, _pdf


def _key(label: str, column: str, value: str) -> Key:
    return Key("doc", 1, label, column, value, "")


def test_each_missed_key_gets_one_class() -> None:
    hit = _key("Specialist visit", "Network Provider", "$45 copay/visit")
    unread = _key("Urgent care", "Out-of-Network Provider", "Not covered")
    spanning = _key("Urgent care", "What You Will Pay", "$90 copay/visit")
    keys = [hit, unread, spanning]
    docs = {
        "a": _doc(
            "a",
            [
                (
                    "Specialist visit",
                    "Network Provider (You will pay the least)",
                    "$45 copay/visit",
                ),
            ],
        ),
    }
    att = attribute(keys, _pdf(), docs)
    assert att.hit == {hit}
    assert att.miss_class(unread) == "no_reader_bound"
    report = att.report(keys)
    assert report["missed"] == 2
    assert report["missed_by_class"] == {"no_reader_bound": 2}
