"""Corpus sealing rules (WP2). Synthetic bytes only; no network."""

import hashlib
import json
from pathlib import Path

import pytest

from evaluation.corpus import (
    Candidate,
    assign_splits,
    describe,
    existing_assignments,
    fetch_all,
    http_get,
    load_candidates,
    overlapping_groups,
    public_manifest,
    resolve_overlaps,
    shortfalls,
    write_outputs,
)


def cand(t: str, fam: str, i: int, dev: bool = False, ml: bool = False) -> Candidate:
    return Candidate(t, fam, ml, dev, f"https://example.test/{t}/{fam}/{i}.pdf")


def fake_get(url: str) -> bytes:
    return b"%PDF-1.7\n" + url.encode()


def corpus() -> list[Candidate]:
    out = []
    for t in ("sbc", "student", "travel"):
        for f in range(8):  # 8 families x 2 docs
            for i in range(2):
                out.append(cand(t, f"{t}-fam{f}", i, ml=(f == 0 and i == 0)))
        out += [cand(t, f"{t}-dev", i, dev=True, ml=True) for i in range(3)]
    return out


def test_families_move_whole_and_dev_families_never_go_blind() -> None:
    docs, failures = fetch_all(corpus(), fake_get)
    assert not failures
    split_of = assign_splits(docs)
    by_family: dict[str, set[str]] = {}
    for d in docs:
        by_family.setdefault(d.candidate.family, set()).add(split_of[d.sha256])
        if d.candidate.dev_family:
            assert split_of[d.sha256] == "validation"
    assert all(len(splits) == 1 for splits in by_family.values())
    assert shortfalls(docs, split_of) == []


def test_split_assignment_is_reproducible_and_seed_dependent() -> None:
    docs, _ = fetch_all(corpus(), fake_get)
    assert assign_splits(docs, 1) == assign_splits(docs, 1)
    assert assign_splits(docs, 1) != assign_splits(docs, 2)


def test_shortfalls_are_reported() -> None:
    docs, _ = fetch_all([cand("sbc", "a", 0), cand("travel", "t", 0)], fake_get)
    problems = shortfalls(docs, assign_splits(docs))
    assert any("sbc/blind-b" in p for p in problems)
    assert "travel/validation: no multi-level document" in problems
    assert "sbc/validation: no multi-level document" not in problems


def test_non_pdf_and_failures_are_reported_not_fatal() -> None:
    def get(url: str) -> bytes:
        if "boom" in url:
            raise OSError("down")
        return b"<html>" if "html" in url else fake_get(url)

    docs, failures = fetch_all(
        [cand("sbc", "boom", 0), cand("sbc", "html", 0), cand("sbc", "ok", 0)], get
    )
    assert len(docs) == 1
    assert failures == ["sbc/boom: OSError", "sbc/html: not a PDF"]


def test_errors_are_described_without_the_url() -> None:
    import urllib.error  # noqa: PLC0415

    err = urllib.error.HTTPError("https://secret.test/x.pdf", 403, "Forbidden", None, None)  # type: ignore[arg-type]
    assert describe(err) == "HTTP 403"
    assert "secret" not in describe(urllib.error.URLError("timed out"))


def test_duplicates_collapse_by_hash() -> None:
    same = [cand("sbc", "a", 0), Candidate("sbc", "a", False, False, cand("sbc", "a", 0).url)]
    docs, _ = fetch_all(same, fake_get)
    assert len(docs) == 1


def test_public_manifest_has_no_urls_or_insurer_names(tmp_path: Path) -> None:
    docs, _ = fetch_all(corpus(), fake_get)
    split_of = assign_splits(docs)
    text = json.dumps(public_manifest(docs, split_of, 7))
    assert "example.test" not in text and "fam" not in text
    write_outputs(docs, split_of, tmp_path / "pdfs", tmp_path / "private")
    sealed = tmp_path / "pdfs" / "corpus-v2" / "blind-a" / "SEALED.txt"
    assert sealed.exists()
    stored = next((tmp_path / "pdfs" / "corpus-v2" / "validation").glob("*.pdf"))
    assert hashlib.sha256(stored.read_bytes()).hexdigest() == stored.stem
    mapping = json.loads((tmp_path / "private" / "corpus-v2" / "private-mapping.json").read_text())
    assert mapping[0]["url"].startswith("https://")


def test_only_https_is_fetched() -> None:
    with pytest.raises(ValueError, match="https"):
        http_get("http://example.test/x.pdf")


def test_candidate_csv_round_trip(tmp_path: Path) -> None:
    csv_file = tmp_path / "c.csv"
    csv_file.write_text("type,family,multi_level,dev_family,url\nsbc,a,1,0,https://x.test/a.pdf\n")
    assert load_candidates(csv_file) == [Candidate("sbc", "a", True, False, "https://x.test/a.pdf")]
    csv_file.write_text("type,family,multi_level,dev_family,url\nauto,a,0,0,https://x.test/a.pdf\n")
    with pytest.raises(ValueError):
        load_candidates(csv_file)


def test_existing_assignments_are_permanent() -> None:
    docs, _ = fetch_all(corpus(), fake_get)
    first = assign_splits(docs, 1)
    validation_doc = next(sha for sha, split in first.items() if split == "validation")
    blind_doc = next(sha for sha, split in first.items() if split == "blind-a")
    # Rerun with a different seed and extra candidates: earlier assignments never move.
    more, _ = fetch_all([*corpus(), cand("sbc", "new-fam", 0)], fake_get)
    second = assign_splits(more, 99, existing=first)
    assert {sha: second[sha] for sha in first} == first
    assert second[validation_doc] == "validation" and second[blind_doc] == "blind-a"


def test_overlapping_layout_groups_are_reported_and_resolved_toward_validation(
    tmp_path: Path,
) -> None:
    docs, _ = fetch_all([cand("sbc", "a", i) for i in range(3)], fake_get)
    shas = [d.sha256 for d in docs]
    existing = {shas[0]: "validation", shas[1]: "blind-a"}
    split_of = assign_splits(docs, existing=existing)
    assert split_of[shas[0]] == "validation" and split_of[shas[1]] == "blind-a"
    assert split_of[shas[2]] == "validation"  # new member of a mixed group: safe side
    assert overlapping_groups(docs, split_of) == ["a"]
    write_outputs(docs, split_of, tmp_path, tmp_path / "private")
    fixed = resolve_overlaps(docs, split_of, tmp_path)
    assert set(fixed.values()) == {"validation"}
    assert overlapping_groups(docs, fixed) == []
    assert existing_assignments(tmp_path) == dict.fromkeys(shas, "validation")


def test_template_column_groups_across_family_names(tmp_path: Path) -> None:
    csv_file = tmp_path / "c.csv"
    csv_file.write_text(
        "type,family,multi_level,dev_family,url,template\n"
        "student,x-one,0,0,https://x.test/1.pdf,shared\n"
        "student,x-two,0,0,https://x.test/2.pdf,shared\n"
        "student,y,0,0,https://x.test/3.pdf,\n"
    )
    assert [c.family for c in load_candidates(csv_file)] == ["shared", "shared", "y"]


def test_rerun_reuses_files_on_disk_and_keeps_their_splits(tmp_path: Path) -> None:
    docs, _ = fetch_all(corpus(), fake_get)
    first = assign_splits(docs, 1)
    write_outputs(docs, first, tmp_path / "pdfs", tmp_path / "private")
    on_disk = existing_assignments(tmp_path / "pdfs")
    assert on_disk == first
    # A second run (different seed, files already read-only) neither fails nor moves anything.
    second = assign_splits(docs, 2, existing=on_disk)
    write_outputs(docs, second, tmp_path / "pdfs", tmp_path / "private")
    assert second == first
