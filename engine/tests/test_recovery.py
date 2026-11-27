"""Progressive recovery: routing, privacy gate, model proposals under verification.

Synthetic PDFs and fake engines only: no real documents, no network, no paid calls.
"""

import io
import urllib.error
from typing import Any

import pypdfium2 as pdfium
import pytest

from app.parsing.base import sha256
from app.parsing.opendataloader import page_ranges
from app.providers import anthropic, http, nvidia
from app.providers.base import ModelReply, Usage, json_text
from app.providers.http import ProviderError, require_secure
from app.reconcile.engine import Fact, reconcile
from app.reconcile.layout import read_layouts
from app.recovery import proposals
from app.recovery.budget import BudgetExceededError, RunLimits, SpendLedger
from app.recovery.cache import Cache
from app.recovery.context import layout_text, page_subset_pdf
from app.recovery.coverage import TO_CONTRACT, CoverageReport, ItemState, not_stated
from app.recovery.gaps import GapKind, find_gaps
from app.recovery.pipeline import Engines, RecoveryPipeline
from app.recovery.policy import CloudAuthorization, CloudPolicy, DocumentClass
from app.recovery.restrictions import link
from app.schemas.document import Document
from app.schemas.facts import FactState
from tests.test_reconcile import NETWORK, _doc, _pdf

NET = NETWORK[1]
OUT = "Out-of-Network Provider"
GOOD_SPECIALIST = ("Specialist visit", NET, "$45 copay/visit")


class FakeReader:
    name, version = "opendataloader", "fake-1"

    def __init__(self, doc: Document) -> None:
        self.doc, self.calls = doc, 0

    def read(self, pdf: bytes) -> Document:
        self.calls += 1
        return self.doc.model_copy(update={"sha256": sha256(pdf)})


class FakePageReader:
    name, version = "docling", "fake-1"

    def __init__(self, doc: Document) -> None:
        self.doc = doc
        self.pages_seen: list[list[int]] = []

    def read_pages(self, pdf: bytes, sha: str, pages: list[int]) -> Document:
        self.pages_seen.append(pages)
        return self.doc.model_copy(update={"sha256": sha})


class FakeText:
    model = "fake-nemotron"

    def __init__(self, data: Any = None, error: Exception | None = None) -> None:
        self.data, self.error = data, error
        self.requests: list[str] = []

    def complete_json(self, system: str, user: str, *_: Any) -> ModelReply:
        self.requests.append(user)
        if self.error:
            raise self.error
        return ModelReply("nvidia", self.model, self.data, Usage(100, 20), 0.01)


class FakeVisual:
    model = "fake-claude"

    def __init__(self, data: Any) -> None:
        self.data = data
        self.pdfs: list[bytes] = []

    def read_pdf_pages(self, pdf: bytes, *_: Any) -> ModelReply:
        self.pdfs.append(pdf)
        return ModelReply("anthropic", self.model, self.data, Usage(1000, 50), 0.01)


def _proposal(label: str, header: str, value: str, page: int = 1) -> dict[str, Any]:
    return {
        "facts": [
            {
                "page": page,
                "group_label": "",
                "row_label": label,
                "column_header": header,
                "value": value,
            }
        ]
    }


@pytest.fixture(autouse=True)
def _free_prices(monkeypatch: pytest.MonkeyPatch) -> None:
    for provider in ("NVIDIA", "ANTHROPIC"):
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_IN", "0")
        monkeypatch.setenv(f"ENGINE_PRICE_{provider}_OUT", "0")


OPEN = CloudPolicy(frozenset({"nvidia", "anthropic"}), frozenset({"nvidia", "anthropic"}))


def _auth(pdf: bytes, cls: DocumentClass = DocumentClass.PUBLIC_CORPUS) -> CloudAuthorization:
    return CloudAuthorization(sha256(pdf), cls, frozenset({"nvidia", "anthropic"}), "test")


def _gappy_primary() -> FakeReader:
    """The reader ties both specialist values to a header that is a value (a data row
    taken for a header): nothing on that row can be verified."""
    return FakeReader(
        _doc(
            "opendataloader",
            [
                ("Specialist visit", "$90 copay/visit", "$45 copay/visit"),
                ("Urgent care", NET, "$90 copay/visit"),
            ],
        )
    )


# ---------------------------------------------------------------- routing


def test_complete_primary_routes_nothing_further() -> None:
    pdf = _pdf()
    docling = FakePageReader(_doc("docling", [GOOD_SPECIALIST]))
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    primary = FakeReader(
        _doc("opendataloader", [GOOD_SPECIALIST, ("Urgent care", NET, "$90 copay/visit")])
    )
    result = RecoveryPipeline(Engines(primary, docling=docling, text_model=text), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    assert {(f.fact.label, f.fact.value) for f in result.facts} >= {
        ("Specialist visit", "$45 copay/visit"),
        ("Urgent care", "$90 copay/visit"),
    }
    assert docling.pages_seen == [] and text.requests == []


def test_docling_runs_only_on_gap_pages_and_its_cells_are_verified() -> None:
    pdf = _pdf()
    docling = FakePageReader(_doc("docling", [GOOD_SPECIALIST]))
    result = RecoveryPipeline(Engines(_gappy_primary(), docling=docling)).run(pdf)
    assert docling.pages_seen == [[1]]
    assert ("Specialist visit", "$45 copay/visit") in {
        (f.fact.label, f.fact.value) for f in result.facts
    }
    assert result.verified_by_stage["docling"] > result.verified_by_stage["primary"]


def test_gaps_name_the_unsettled_row() -> None:
    pdf = _pdf()
    docs = {"opendataloader": _gappy_primary().doc}
    layouts = read_layouts(pdf)
    gaps = find_gaps(reconcile(pdf, docs, layouts=layouts), layouts, docs)
    assert GapKind.UNSETTLED_ROW in gaps[1].kinds
    assert "Specialist visit" in gaps[1].rows


# ---------------------------------------------------------------- models propose, code decides


def test_correct_model_proposal_is_verified_by_the_same_rules() -> None:
    pdf = _pdf()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=text), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    fact = next(f.fact for f in result.facts if f.fact.label == "Specialist visit")
    assert fact.value == "$45 copay/visit"
    assert fact.proposed_by == {"text:fake-nemotron"}
    assert '<page number="1" role="TARGET">' in text.requests[0]


@pytest.mark.parametrize(
    "wrong",
    [
        ("Specialist visit", NET, "$46 copay/visit"),  # value not printed
        ("Specialist visit", OUT, "$45 copay/visit"),  # wrong column
        ("Urgent care", NET, "$45 copay/visit"),  # wrong row
        ("Specialist visit", "What You Will Pay", "$45 copay/visit"),  # spanning header
        ("Specialist visit", NET, "$45"),  # part of a cell
    ],
)
def test_wrong_model_proposal_is_never_verified(wrong: tuple[str, str, str]) -> None:
    pdf = _pdf()
    result = RecoveryPipeline(
        Engines(_gappy_primary(), text_model=FakeText(_proposal(*wrong))), policy=OPEN
    ).run(pdf, _auth(pdf))
    assert not any(f.fact.proposed_by == {"text:fake-nemotron"} for f in result.facts)
    assert any(u.label == "Specialist visit" for u in result.unresolved)


def test_two_models_agreeing_on_a_wrong_value_is_not_evidence() -> None:
    pdf = _pdf()
    wrong = _proposal("Specialist visit", OUT, "$45 copay/visit")
    engines = Engines(_gappy_primary(), text_model=FakeText(wrong), visual_model=FakeVisual(wrong))
    result = RecoveryPipeline(engines, policy=OPEN).run(pdf, _auth(pdf))
    assert not any(f.fact.label == "Specialist visit" for f in result.facts)


def test_proposals_for_pages_not_requested_are_dropped() -> None:
    assert (
        proposals.to_candidates(
            "t", proposals.ProposalSet.model_validate(_proposal(*GOOD_SPECIALIST, page=2)), {1}
        )
        == []
    )


def test_off_schema_output_is_rejected_whole() -> None:
    pdf = _pdf()
    bad = {"facts": [{**_proposal(*GOOD_SPECIALIST)["facts"][0], "confidence": 0.99}]}
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=FakeText(bad)), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    assert [e.status for e in result.ledger.entries if e.stage == "text"] == ["invalid_output"]
    assert not any(f.fact.label == "Specialist visit" for f in result.facts)


def test_provider_failure_is_recorded_and_the_run_continues() -> None:
    pdf = _pdf()
    text = FakeText(error=ProviderError("nvidia", 503, "http_error"))
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=text), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    entry = next(e for e in result.ledger.entries if e.stage == "text")
    assert (entry.status, entry.detail) == ("failed", "http_error")
    assert any(f.fact.label == "Urgent care" for f in result.facts)


def test_visual_model_gets_the_original_page_not_parser_output() -> None:
    pdf = _pdf()
    visual = FakeVisual(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(Engines(_gappy_primary(), visual_model=visual), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    sent = pdfium.PdfDocument(visual.pdfs[0])
    assert len(sent) == 1
    assert "Specialist visit" in sent[0].get_textpage().get_text_range()
    assert any(f.fact.proposed_by == {"visual:fake-claude"} for f in result.facts)


# ---------------------------------------------------------------- privacy boundary


@pytest.mark.parametrize(
    ("policy", "auth_class", "reason"),
    [
        (CloudPolicy(), DocumentClass.PUBLIC_CORPUS, "provider_not_enabled"),
        (CloudPolicy(frozenset({"nvidia"})), DocumentClass.PUBLIC_CORPUS, "retention_not_reviewed"),
        (
            CloudPolicy(frozenset({"nvidia"}), frozenset({"nvidia"}), development_only=frozenset()),
            DocumentClass.CUSTOMER,
            "customer_documents_not_approved",
        ),
        (
            CloudPolicy(frozenset({"nvidia"}), frozenset({"nvidia"}), True),
            DocumentClass.CUSTOMER,
            "development_endpoint_for_customer_document",
        ),
    ],
)
def test_cloud_calls_need_every_approval(
    policy: CloudPolicy, auth_class: DocumentClass, reason: str
) -> None:
    pdf = _pdf()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=text), policy=policy).run(
        pdf, _auth(pdf, auth_class)
    )
    assert text.requests == []
    assert [(e.status, e.detail) for e in result.ledger.entries if e.stage == "text"] == [
        ("refused", reason)
    ]


def test_authorization_is_per_document() -> None:
    pdf = _pdf()
    other = CloudAuthorization("f" * 64, DocumentClass.PUBLIC_CORPUS, frozenset({"nvidia"}), "t")
    assert OPEN.refusal("nvidia", sha256(pdf), other) == "document_not_authorized"
    assert OPEN.refusal("nvidia", sha256(pdf), None) == "document_not_authorized"
    customer = CloudPolicy(OPEN.enabled_providers, OPEN.retention_reviewed, True)
    assert customer.refusal("anthropic", sha256(pdf), _auth(pdf, DocumentClass.CUSTOMER)) is None
    assert customer.refusal("nvidia", sha256(pdf), _auth(pdf, DocumentClass.CUSTOMER)) == (
        "development_endpoint_for_customer_document"
    )


def test_only_tls_or_local_transport() -> None:
    require_secure("https://integrate.api.nvidia.com/v1", "nvidia")
    require_secure("http://127.0.0.1:8000/v1", "nvidia")
    with pytest.raises(ProviderError):
        require_secure("http://example.com/v1", "nvidia")


def test_page_subset_carries_only_the_pages_and_no_metadata() -> None:
    src = pdfium.PdfDocument.new()
    for _ in range(3):
        src.new_page(612, 792)
    buf = io.BytesIO()
    src.save(buf)
    out = page_subset_pdf(buf.getvalue(), [2, 3])
    assert len(pdfium.PdfDocument(out)) == 2
    assert b"/Title" not in out and b"/Author" not in out


# ---------------------------------------------------------------- limits, cache, cost


def test_call_limit_is_enforced() -> None:
    pdf = _pdf()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(
        Engines(_gappy_primary(), text_model=text), limits=RunLimits(max_text_calls=0), policy=OPEN
    ).run(pdf, _auth(pdf))
    assert text.requests == []
    assert [e.status for e in result.ledger.entries if e.stage == "text"] == ["skipped"]


def test_cache_reuses_reader_and_model_output(tmp_path: Any) -> None:
    pdf = _pdf()
    primary = _gappy_primary()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    pipe = RecoveryPipeline(Engines(primary, text_model=text), cache=Cache(tmp_path), policy=OPEN)
    first = pipe.run(pdf, _auth(pdf))
    second = pipe.run(pdf, _auth(pdf))
    assert primary.calls == 1 and len(text.requests) == 1
    assert {e.status for e in second.ledger.entries} == {"cached"}
    assert len(first.facts) == len(second.facts)


def test_cache_key_changes_with_model_and_prompt_version() -> None:
    a = Cache.key("0" * 64, "text", "nvidia", "m1", prompt="v1", pages=[1])
    assert a != Cache.key("0" * 64, "text", "nvidia", "m2", prompt="v1", pages=[1])
    assert a != Cache.key("0" * 64, "text", "nvidia", "m1", prompt="v2", pages=[1])
    assert a != Cache.key("0" * 64, "text", "nvidia", "m1", prompt="v1", pages=[2])


def test_cost_is_tracked_from_configured_prices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_IN", "1.0")
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_OUT", "2.0")
    pdf = _pdf()
    result = RecoveryPipeline(
        Engines(_gappy_primary(), text_model=FakeText(_proposal(*GOOD_SPECIALIST))), policy=OPEN
    ).run(pdf, _auth(pdf))
    entry = next(e for e in result.ledger.entries if e.stage == "text")
    assert entry.cost_usd == pytest.approx((100 * 1.0 + 20 * 2.0) / 1e6)
    assert entry.bytes_disclosed > 0


# ---------------------------------------------------------------- small pieces


def test_layout_text_keeps_columns_apart_and_marks_rules() -> None:
    text = layout_text(read_layouts(_pdf())[0], 10_000)
    line = next(ln for ln in text.splitlines() if "Specialist" in ln)
    assert "|" in line and "$45" in line and "50%" in line


def test_page_ranges() -> None:
    assert page_ranges([7, 1, 2, 3, 5]) == "1-3,5,7"


def test_json_text_strips_reasoning_and_fence_only() -> None:
    assert json_text('<think>x</think>\n```json\n{"a": 1}\n```') == '{"a": 1}'


def test_nvidia_client_sends_text_only(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, Any] = {}

    def fake_post(
        provider: str, url: str, headers: dict[str, str], body: dict[str, Any], **_: Any
    ) -> dict[str, Any]:
        sent.update(body=body, url=url)
        return {
            "choices": [{"finish_reason": "stop", "message": {"content": '{"facts": []}'}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3},
        }

    monkeypatch.setattr(nvidia, "post_json", fake_post)
    client = nvidia.NvidiaClient(nvidia.NvidiaConfig("https://h/v1", "k", "m"))
    reply = client.complete_json("s", "u", "n", proposals.SCHEMA, 10)
    assert all(isinstance(m["content"], str) for m in sent["body"]["messages"])
    assert sent["body"]["response_format"]["type"] == "json_schema"
    assert reply.data == {"facts": []} and reply.usage.output_tokens == 3


def test_anthropic_client_sends_the_pdf_as_a_document(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, Any] = {}

    def fake_post(
        provider: str, url: str, headers: dict[str, str], body: dict[str, Any], **_: Any
    ) -> dict[str, Any]:
        sent.update(body=body, url=url)
        return {
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": '{"facts": []}'}],
            "usage": {"input_tokens": 9, "output_tokens": 2},
        }

    monkeypatch.setattr(anthropic, "post_json", fake_post)
    client = anthropic.AnthropicClient(anthropic.AnthropicConfig("k"))
    client.read_pdf_pages(b"%PDF-1.7", "s", "i", proposals.SCHEMA, 10)
    block = sent["body"]["messages"][0]["content"][0]
    assert block["type"] == "document" and block["source"]["media_type"] == "application/pdf"
    assert sent["body"]["output_config"]["format"]["type"] == "json_schema"
    assert sent["url"].endswith("/v1/messages")


def _fact(label: str, header: str, value: str) -> Fact:
    return Fact(1, label, (), header, 1, value, (0.0, 0.0, 1.0, 1.0), True)


def test_limitation_of_the_same_verified_row_is_attached() -> None:
    lim = "Limitations, Exceptions, & Other Important Information"
    out = link(
        [
            _fact("Specialist visit", NET, "$45 copay/visit"),
            _fact("Specialist visit", lim, "Prior authorization required."),
            _fact("Urgent care", NET, "$90 copay/visit"),
            _fact("Urgent care", lim, "--------none--------"),
        ]
    )
    by = {(v.fact.label, v.fact.header): v.restrictions for v in out}
    assert by[("Specialist visit", NET)] == ["Prior authorization required."]
    assert by[("Urgent care", NET)] == []  # "none" is not a restriction


def test_cost_cap_needs_a_known_price(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENGINE_PRICE_NVIDIA_IN")
    pdf = _pdf()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=text), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    assert text.requests == []
    assert [e.detail for e in result.ledger.entries if e.stage == "text"] == [
        "price_not_configured_under_cost_cap"
    ]


class OverusingText(FakeText):
    """Reports far more input tokens (2M) than the pre-call estimate."""

    def complete_json(self, system: str, user: str, *a: Any) -> ModelReply:
        r = super().complete_json(system, user, *a)
        return ModelReply(r.provider, r.model, r.data, Usage(2_000_000, 20), r.seconds)


def test_cost_cap_stops_further_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    # P0-05: the reservation admits the first call (its estimate is tiny at this price);
    # the provider then reports 2M input tokens ($0.10), so the cap stops every later call.
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_IN", "0.05")
    pdf = _pdf()
    text = OverusingText(_proposal("Nothing", NET, "$0"))  # leaves the gap open
    visual = FakeVisual(_proposal("Nothing", NET, "$0"))
    RecoveryPipeline(
        Engines(_gappy_primary(), text_model=text, visual_model=visual), policy=OPEN
    ).run(pdf, _auth(pdf))
    assert len(text.requests) == 1 and visual.pdfs == []


# ------------------------------------------------------------- P0-05 budget controls


def test_reservation_refuses_a_call_whose_worst_case_exceeds_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_OUT", "10")  # 16k output tokens -> $0.16 > $0.05
    pdf = _pdf()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=text), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    assert text.requests == []
    assert "document_cost_cap_reservation" in [e.detail for e in result.ledger.entries]


def test_uncapped_paid_calls_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_IN", "1")
    pdf = _pdf()
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    result = RecoveryPipeline(
        Engines(_gappy_primary(), text_model=text),
        limits=RunLimits(max_cost_usd=None),
        policy=OPEN,
    ).run(pdf, _auth(pdf))
    assert text.requests == []
    assert "uncapped_paid_call_refused" in [e.detail for e in result.ledger.entries]


def test_free_tier_may_run_without_a_cap() -> None:
    pdf = _pdf()  # fixture prices are 0
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    RecoveryPipeline(
        Engines(_gappy_primary(), text_model=text),
        limits=RunLimits(max_cost_usd=None),
        policy=OPEN,
    ).run(pdf, _auth(pdf))
    assert len(text.requests) == 1


def test_cumulative_budget_is_shared_across_runs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_IN", "0.005")
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_OUT", "1")  # worst case ~ $0.016 per call
    spend = SpendLedger(tmp_path / "spend.jsonl", cap_usd=0.02)
    pdf = _pdf()
    first = OverusingText(_proposal(*GOOD_SPECIALIST))  # actually costs ~$0.01
    second = FakeText(_proposal(*GOOD_SPECIALIST))
    for model in (first, second):
        RecoveryPipeline(
            Engines(_gappy_primary(), text_model=model),
            limits=RunLimits(max_cost_usd=1.0),
            policy=OPEN,
            spend=spend,
        ).run(pdf, _auth(pdf))
    assert len(first.requests) == 1
    assert second.requests == []  # $0.01 committed + $0.016 worst case > $0.02
    assert spend.committed_usd() == pytest.approx(0.01 + 20 / 1e6)


def test_an_unsettled_reservation_stays_spent(tmp_path: Any) -> None:
    spend = SpendLedger(tmp_path / "spend.jsonl", cap_usd=1.0)
    spend.reserve(0.7, "crashed run")  # never settled
    assert spend.committed_usd() == pytest.approx(0.7)
    with pytest.raises(BudgetExceededError):
        spend.reserve(0.4, "next")


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        # three timeouts: each may have been billed -> 3 x worst case
        (ProviderError("nvidia", 0, "TimeoutError", failed_attempts=(0, 0, 0)), 3 * 0.016),
        # rate limited three times: never processed -> nothing
        (ProviderError("nvidia", 429, "http_error", failed_attempts=(429, 429, 429)), 0.0),
        # a billed response rejected here (cut off): its reported tokens are charged
        (ProviderError("nvidia", 200, "incomplete_generation", output_tokens=16_000), 0.016),
    ],
)
def test_failed_calls_and_retries_are_charged(
    monkeypatch: pytest.MonkeyPatch, error: Exception, expected: float
) -> None:
    monkeypatch.setenv("ENGINE_PRICE_NVIDIA_OUT", "1")
    pdf = _pdf()
    result = RecoveryPipeline(
        Engines(_gappy_primary(), text_model=FakeText(error=error)),
        limits=RunLimits(max_cost_usd=1.0),
        policy=OPEN,
    ).run(pdf, _auth(pdf))
    cost = result.ledger.cost_usd()
    assert cost is not None
    assert cost == pytest.approx(expected, rel=0.01, abs=1e-4)


def test_http_layer_reports_every_failed_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    class _Res(io.BytesIO):
        status = 200

        def __enter__(self) -> "_Res":
            return self

        def __exit__(self, *_: object) -> None:
            return None

    def fake_urlopen(req: Any, timeout: float) -> _Res:
        calls["n"] += 1
        if calls["n"] < 3:
            raise urllib.error.HTTPError("https://x", 503, "busy", {}, None)  # type: ignore[arg-type]
        return _Res(b'{"ok": true}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("time.sleep", lambda _s: None)
    failed: list[int] = []
    out = http.post_json("p", "https://x", {}, {}, timeout_s=1, failed_attempts=failed)
    assert out == {"ok": True} and failed == [503, 503]


# ------------------------------------------------- P0-04 open conditions (completeness)

LIM = "Limitations, Exceptions, & Other Important Information"


def test_structural_verification_alone_is_never_fully_verified() -> None:
    (vf,) = link([_fact("Specialist visit", NET, "$45 copay/visit")])
    assert vf.open_conditions == []
    assert not vf.presentable_as_verified  # key 2 (semantic) has not confirmed it
    vf.semantic_confirmed = True
    assert vf.presentable_as_verified


def test_unverified_governing_cell_keeps_the_fact_open() -> None:
    out = link(
        [
            _fact("Specialist visit", NET, "$45 copay/visit"),
            _fact("Urgent care", NET, "$90 copay/visit"),
            _fact("Urgent care", LIM, "None"),  # this page has a governing column
        ]
    )
    vf = next(v for v in out if v.fact.label == "Specialist visit")
    assert vf.open_conditions == ["governing_text_unverified"]
    vf.semantic_confirmed = True
    assert not vf.presentable_as_verified
    urgent = next(v for v in out if v.fact.label == "Urgent care" and v.fact.header == NET)
    assert urgent.open_conditions == []  # a verified "None" is resolved


def test_two_governing_cells_in_one_row_are_ambiguous() -> None:
    out = link(
        [
            _fact("Specialist visit", NET, "$45 copay/visit"),
            _fact("Specialist visit", LIM, "Prior authorization required."),
            _fact("Specialist visit", "Why This Matters", "Referral needed."),
        ]
    )
    vf = next(v for v in out if v.fact.header == NET)
    assert vf.open_conditions == ["governing_text_ambiguous"] and vf.restrictions == []


def test_marker_without_a_linked_footnote_is_open() -> None:
    (vf,) = link([_fact("Imaging†", NET, "$100 copay")], read_layouts(_pdf()))
    assert "footnote_unresolved" in vf.open_conditions


def test_cross_reference_is_open() -> None:
    (vf,) = link([_fact("Out-of-pocket limit", NET, "$5,000. See your plan document.")])
    assert vf.open_conditions == ["cross_reference_unresolved"]


# ------------------------------------------- P0-02 parser-independent completeness


def test_amounts_no_reader_proposed_are_not_extracted() -> None:
    pdf = _pdf()
    only_specialist = FakeReader(_doc("opendataloader", [GOOD_SPECIALIST]))
    result = RecoveryPipeline(Engines(only_specialist)).run(pdf)
    lines = {(i.line, str(i.state)) for i in result.coverage.items}  # type: ignore[union-attr]
    assert ("Specialist visit $45 copay/visit 50% coinsurance", "verified") in lines
    assert ("Specialist visit $45 copay/visit 50% coinsurance", "not_extracted") in lines
    assert ("Urgent care $90 copay/visit Not covered", "not_extracted") in lines
    assert not result.coverage.complete  # type: ignore[union-attr]


def test_refused_proposals_are_rejected_with_the_rule() -> None:
    result = RecoveryPipeline(Engines(_gappy_primary())).run(_pdf())
    rejected = [i for i in result.coverage.items if i.state == "rejected"]  # type: ignore[union-attr]
    assert rejected and all(i.reasons for i in rejected)
    rows = {(u.label, str(u.state)) for u in result.unresolved}
    assert ("Specialist visit", "rejected") in rows


def test_not_stated_needs_proven_absence() -> None:
    pdf = _pdf()
    layouts = read_layouts(pdf)
    full = RecoveryPipeline(Engines(_gappy_primary())).run(pdf).coverage
    assert full is not None
    # printed somewhere -> never "not stated"
    assert not_stated(["Urgent care"], layouts, full) == ItemState.UNRESOLVED
    # absent, but amounts were missed or refused on the page -> could be hiding it
    assert not_stated(["Acupuncture"], layouts, full) == ItemState.UNRESOLVED
    # absent and every printed amount accounted for -> proven not stated
    assert not_stated(["Acupuncture"], layouts, CoverageReport([])) == ItemState.NOT_STATED


def test_coverage_states_map_onto_the_user_contract() -> None:
    assert TO_CONTRACT[ItemState.NOT_EXTRACTED] is FactState.COULDNT_CONFIRM
    assert TO_CONTRACT[ItemState.REJECTED] is FactState.COULDNT_CONFIRM
    assert TO_CONTRACT[ItemState.NOT_STATED] is FactState.NOT_MENTIONED
    assert set(TO_CONTRACT) == set(ItemState)


def test_missed_amounts_are_routed_only_when_asked() -> None:
    pdf = _pdf()
    text = FakeText(
        {
            "facts": [],
            "clauses": [{"page": 1, "anchor": "Urgent care", "text": "Not covered"}],
        }
    )
    primary = FakeReader(
        _doc("opendataloader", [GOOD_SPECIALIST, ("Urgent care", NET, "$90 copay/visit")])
    )
    RecoveryPipeline(
        Engines(primary, text_model=text),
        limits=RunLimits(route_missed_amounts=True),
        policy=OPEN,
    ).run(pdf, _auth(pdf))
    assert len(text.requests) == 1  # "50% coinsurance" and "Not covered" nobody proposed


def test_model_clause_proposals_go_through_the_prose_verifier() -> None:
    pdf = _pdf()
    # a benefit-table row with two value cells: never a clause, whoever proposes it
    text = FakeText(
        {
            "facts": [],
            "clauses": [{"page": 1, "anchor": "Urgent care", "text": "$90 copay/visit"}],
        }
    )
    result = RecoveryPipeline(Engines(_gappy_primary(), text_model=text), policy=OPEN).run(
        pdf, _auth(pdf)
    )
    assert text.requests  # the gap page went to the model
    assert result.clauses == []
    refused = [v for v in result.clause_verdicts if v.candidate.source.startswith("text:")]
    assert refused and all("row_has_several_value_cells" in v.reasons for v in refused)


def test_progress_names_each_model_call_without_document_text() -> None:
    pdf = _pdf()
    lines: list[str] = []
    text = FakeText(_proposal(*GOOD_SPECIALIST))
    RecoveryPipeline(
        Engines(_gappy_primary(), text_model=text), policy=OPEN, progress=lines.append
    ).run(pdf, _auth(pdf))
    assert any(line.startswith("text nvidia p") and line.endswith(": calling") for line in lines)
    assert any(line.startswith("text nvidia p") and ": ok " in line for line in lines)
    assert not any(line.startswith(("primary", "docling", "pdfplumber")) for line in lines)
    joined = "\n".join(lines)
    assert "$45" not in joined and "Specialist" not in joined  # page numbers, never content
