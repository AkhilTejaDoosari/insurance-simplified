"""Key 2 (semantic confirmation): code reading + judge; the judge alone never confirms."""

from decimal import Decimal
from typing import Any

import pytest

from app.providers.base import ModelReply, Usage
from app.recovery.budget import RunLimits
from app.recovery.pipeline import Engines, RecoveryPipeline
from app.recovery.semantic import FIELDS, confirmed, interpret, parse_judge
from app.schemas.facts import Basis, NetworkTier, PersonLevel, ValueKind
from tests.test_reconcile import _doc, _pdf
from tests.test_recovery import NET, OPEN, FakeReader, _auth

# --------------------------------------------------------------- code reading


def test_amount_basis_and_tier_come_from_printed_words() -> None:
    c = interpret("$45 copay/visit", label="Specialist visit", header=NET)
    (r,) = c.interpretations
    assert c.passed
    assert (r.kind, r.number, r.basis, r.basis_source) == (
        ValueKind.AMOUNT,
        Decimal(45),
        Basis.PER_VISIT,
        "value",
    )
    assert r.network_tier is NetworkTier.IN_NETWORK


def test_out_of_network_header() -> None:
    (r,) = interpret("50% coinsurance", header="Out-of-Network Provider").interpretations
    assert r.network_tier is NetworkTier.OUT_OF_NETWORK and r.basis is Basis.PER_INCIDENT


def test_a_limitation_never_gives_a_copay_its_basis() -> None:
    (r,) = interpret("$45 copay", governing=["Limited to 20 visits per year."]).interpretations
    assert r.basis is Basis.PER_INCIDENT and r.basis_source == "term:copay"


def test_annual_limits_take_their_basis_from_the_printed_label() -> None:
    c = interpret("$500 individual $1,000 family", label="What is the overall deductible?")
    assert c.passed
    assert [(r.number, r.person_level, r.basis) for r in c.interpretations] == [
        (Decimal(500), PersonLevel.INDIVIDUAL, Basis.PER_YEAR),
        (Decimal(1000), PersonLevel.FAMILY, Basis.PER_YEAR),
    ]


def test_compound_cell_is_read_per_printed_qualifier() -> None:
    c = interpret("$10 copayment/office visit; $15 copayment/hospital outpatient setting")
    assert c.passed
    assert [(r.number, r.conditions[-1]) for r in c.interpretations] == [
        (Decimal(10), "copayment/office visit"),
        (Decimal(15), "copayment/hospital outpatient setting"),
    ]


def test_amounts_nobody_can_tell_apart_are_not_read() -> None:
    c = interpret("$20 $40 copay")
    assert not c.passed and "several_amounts_unassigned" in c.problems


def test_unknown_basis_is_never_verified() -> None:
    c = interpret("$1,500", label="Something", header="Plan A")
    assert not c.passed and c.problems == ["basis_unclear"]


def test_negation_and_conditions() -> None:
    (r,) = interpret("Not covered").interpretations
    assert r.kind is ValueKind.COVERED and r.negated
    (r,) = interpret("$50 copay/visit deductible does not apply").interpretations
    assert "deductible does not apply" in r.conditions


def test_prose_answer_is_text() -> None:
    c = interpret("No. You can see the specialist you choose.", prose=True)
    (r,) = c.interpretations
    assert c.passed and r.kind is ValueKind.TEXT and r.negated


# ----------------------------------------------------------------- judge parsing


def _verdict(i: int, ok: bool = True, complete: bool = True) -> dict[str, Any]:
    return {
        "id": i,
        "fields": {f: "confirm" if ok else "reject" for f in FIELDS},
        "meaning_complete": complete,
        "issues": [],
    }


def test_judge_output_is_parsed_strictly() -> None:
    good = parse_judge({"verdicts": [_verdict(0), _verdict(1, ok=False)]}, 2, "fam", "m")
    assert [v.confirmed for v in good] == [True, False]
    assert parse_judge({"verdicts": [_verdict(0)]}, 2, "f", "m")[1].reasons == (
        "judge_output_off_schema",
    )  # a missing id is a rejection
    dup = parse_judge({"verdicts": [_verdict(0), _verdict(0)]}, 1, "f", "m")
    assert not dup[0].confirmed  # two verdicts for one fact: neither counts
    extra = parse_judge({"verdicts": [{**_verdict(0), "value": "$50"}]}, 1, "f", "m")
    assert not extra[0].confirmed  # the judge cannot add a value
    incomplete = parse_judge({"verdicts": [_verdict(0, complete=False)]}, 1, "f", "m")
    assert incomplete[0].reasons == ("judge_meaning_incomplete",)


def test_the_judge_alone_never_confirms() -> None:
    (yes,) = parse_judge({"verdicts": [_verdict(0)]}, 1, "anthropic-claude", "m")
    failed_code = interpret("$1,500", label="x", header="y")
    assert confirmed(failed_code, yes, set()) == (False, ("basis_unclear",))
    passed_code = interpret("$45 copay/visit", header=NET)
    assert confirmed(passed_code, None, set()) == (False, ("judge_not_run",))
    assert confirmed(passed_code, yes, {"text:nemotron"})[0]  # other family
    assert confirmed(passed_code, yes, {"visual:claude"}) == (
        False,
        ("judge_same_family_as_proposer",),
    )


# ---------------------------------------------------------------------- pipeline


class FakeJudge:
    model = "fake-claude"

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.requests: list[str] = []

    def complete_json(self, system: str, user: str, *_: Any) -> ModelReply:
        import json  # noqa: PLC0415

        self.requests.append(user)
        n = len(json.loads(user)["facts"])
        data = {"verdicts": [_verdict(i, ok=self.ok) for i in range(n)]}
        return ModelReply("anthropic", self.model, data, Usage(100, 50), 0.01)


@pytest.fixture(autouse=True)
def _prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for provider in ("NVIDIA", "ANTHROPIC"):
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_IN", "0")
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_OUT", "0")


def _run(judge: FakeJudge | None, limits: RunLimits | None = None) -> Any:
    pdf = _pdf()
    reader = FakeReader(_doc("opendataloader", [("Specialist visit", NET, "$45 copay/visit")]))
    return RecoveryPipeline(Engines(reader, judge=judge), limits=limits, policy=OPEN).run(
        pdf, _auth(pdf)
    )


def test_confirmed_fact_becomes_presentable_only_with_both_keys() -> None:
    judge = FakeJudge()
    result = _run(judge)
    fact = next(f for f in result.facts if f.fact.label == "Specialist visit")
    assert fact.semantic_confirmed and fact.semantic_reasons == []
    assert fact.presentable_as_verified == (not fact.open_conditions)
    sent = judge.requests[0]
    assert "$45 copay/visit" in sent and "%PDF" not in sent  # printed text only


def test_judge_rejection_leaves_the_fact_unconfirmed() -> None:
    fact = next(f for f in _run(FakeJudge(ok=False)).facts if f.fact.label == "Specialist visit")
    assert not fact.semantic_confirmed and "judge_rejected:value" in fact.semantic_reasons


def test_no_judge_means_no_confirmation() -> None:
    fact = next(f for f in _run(None).facts if f.fact.label == "Specialist visit")
    assert not fact.semantic_confirmed and fact.semantic_reasons == ["judge_not_run"]


def test_judge_calls_are_limited_and_reserved(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENGINE_PRICE_ANTHROPIC_OUT", "100")  # 4k tokens -> $0.40 > $0.05
    judge = FakeJudge()
    result = _run(judge)
    assert judge.requests == []
    assert "document_cost_cap_reservation" in [e.detail for e in result.ledger.entries]
    judge2 = FakeJudge()
    _run(judge2, RunLimits(max_judge_calls=0))
    assert judge2.requests == []
