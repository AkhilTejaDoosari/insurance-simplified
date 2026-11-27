"""Evaluation configuration discovery: agreed endpoints only, no secret in the output."""

from pathlib import Path

import pytest

from app.providers.nvidia import DEFAULT_MODEL as NEMOTRON_MODEL
from evaluation.eval_env import collect, main, resolve


def _repo(tmp_path: Path, web: str, engine: str) -> Path:
    (tmp_path / "web").mkdir()
    (tmp_path / "engine").mkdir()
    (tmp_path / "web" / ".env.local").write_text(web)
    (tmp_path / "engine" / ".env.local").write_text(engine)
    return tmp_path


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "LLM_BASE_URL", "LLM_API_KEY"):
        monkeypatch.delenv(name, raising=False)


def test_another_gateway_is_never_used_as_nemotron(tmp_path: Path) -> None:
    repo = _repo(tmp_path, "LLM_BASE_URL=https://kodekey.example/v1\nLLM_API_KEY=kk\n", "")
    env, notes, missing, _ = resolve(*collect(repo))
    assert "LLM_API_KEY" not in env
    assert any("not used for Nemotron" in n for n in notes)
    assert any(m.startswith("NVIDIA_API_KEY") for m in missing)


def test_nvidia_key_and_agreed_models(tmp_path: Path) -> None:
    repo = _repo(
        tmp_path,
        "LLM_MODEL=some-other-model\n",
        'NVIDIA_API_KEY="nv-1" \nANTHROPIC_API_KEY=sk-2 # comment\n'
        "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic\nENGINE_EVAL_GRANTED_BY=Owner\n",
    )
    env, _notes, missing, _ = resolve(*collect(repo))
    assert missing == []
    assert env["LLM_BASE_URL"] == "https://integrate.api.nvidia.com/v1"
    assert env["LLM_MODEL"] == NEMOTRON_MODEL and env["LLM_API_KEY"] == "nv-1"
    assert env["ENGINE_ANTHROPIC_API_KEY"] == "sk-2"
    assert (env["ENGINE_PRICE_ANTHROPIC_IN"], env["ENGINE_PRICE_ANTHROPIC_OUT"]) == ("4", "20")


def test_privacy_declarations_are_never_inferred(tmp_path: Path) -> None:
    repo = _repo(tmp_path, "", "NVIDIA_API_KEY=nv\nANTHROPIC_API_KEY=sk\n")
    _env, _notes, missing, _ = resolve(*collect(repo))
    assert any(m.startswith("ENGINE_CLOUD_RETENTION_REVIEWED") for m in missing)
    assert any(m.startswith("ENGINE_EVAL_GRANTED_BY") for m in missing)


def test_output_names_sources_but_never_values(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    repo = _repo(
        tmp_path,
        "",
        "NVIDIA_API_KEY=nvapi-SECRET\nANTHROPIC_API_KEY=sk-SECRET\n"
        "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic\nENGINE_EVAL_GRANTED_BY=Owner\n",
    )
    emit = tmp_path / "out" / "eval.env"
    assert main(["--repo", str(repo), "--emit", str(emit)]) == 0
    assert "SECRET" not in capsys.readouterr().out
    assert oct(emit.stat().st_mode & 0o777) == "0o600"


def test_kodekey_from_the_web_app_settings_is_used_for_claude(tmp_path: Path) -> None:
    repo = _repo(
        tmp_path,
        "LLM_BASE_URL=https://api.kodekey.example/v1\nLLM_API_KEY=kk-1\nLLM_MODEL=x\n",
        "NVIDIA_API_KEY=nv\nENGINE_EVAL_GRANTED_BY=Owner\n"
        "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic\n",
    )
    env, notes, missing, origin = resolve(*collect(repo))
    assert env["ENGINE_ANTHROPIC_API_KEY"] == "kk-1"
    assert env["ENGINE_ANTHROPIC_BASE_URL"] == "https://api.kodekey.example/v1"
    assert "web/.env.local" in origin["ENGINE_ANTHROPIC_API_KEY"]
    assert env["LLM_API_KEY"] == "nv"  # Nemotron still goes to NVIDIA
    # the gateway must be on the retention record
    assert any("kodekey" in m for m in missing)
    assert any("through KodeKey" in n for n in notes)


def test_kodekey_with_its_record_and_model(tmp_path: Path) -> None:
    repo = _repo(
        tmp_path,
        "",
        "NVIDIA_API_KEY=nv\nKODEKEY_API_KEY=kk\nKODEKEY_BASE_URL=https://kodekey.example\n"
        "KODEKEY_CLAUDE_MODEL=anthropic/claude-opus-5.5\nENGINE_EVAL_GRANTED_BY=Owner\n"
        "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic,kodekey\n",
    )
    env, _notes, missing, _ = resolve(*collect(repo))
    assert missing == []
    assert env["ENGINE_ANTHROPIC_MODEL"] == "anthropic/claude-opus-5.5"
    assert (env["ENGINE_PRICE_ANTHROPIC_IN"], env["ENGINE_PRICE_ANTHROPIC_OUT"]) == ("4", "20")


def test_gateway_probe_checks_both_request_shapes(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.providers import anthropic  # noqa: PLC0415

    sent: list[dict[str, object]] = []

    def fake_post(provider: str, url: str, headers: dict[str, str], body: dict, **_: object):  # type: ignore[no-untyped-def,type-arg]
        sent.append({"url": url, "auth": headers.get("authorization", "")[:6], "body": body})
        return {
            "model": "claude-opus-5-5",
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": '{"ok": true}'}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }

    monkeypatch.setattr(anthropic, "post_json", fake_post)
    monkeypatch.setattr(
        anthropic, "get_json", lambda *a, **k: {"data": [{"id": "claude-opus-5-5"}]}
    )
    client = anthropic.AnthropicClient(
        anthropic.AnthropicConfig(
            api_key="kk-SECRET", base_url=anthropic._base("https://kk.example/v1")
        )
    )
    out = client.probe()
    assert out["gateway"] is True and out["model_available"] is True and out["pdf_input"] is True
    assert [s["url"] for s in sent] == ["https://kk.example/v1/messages"] * 2
    assert sent[0]["auth"] == "Bearer"
    assert "SECRET" not in repr(out)


def test_a_key_without_its_endpoint_is_never_assumed_to_be_nvidia(tmp_path: Path) -> None:
    repo = _repo(tmp_path, "", "LLM_API_KEY=some-gateway-key\n")
    env, notes, missing, _ = resolve(*collect(repo))
    assert "LLM_API_KEY" not in env
    assert any("no LLM_BASE_URL" in n for n in notes)
    assert any(m.startswith("NVIDIA_API_KEY") for m in missing)


OWNER_LAYOUT = """# Existing application LLM
LLM_BASE_URL=https://api.ai.kodekloud.example/v1
LLM_API_KEY=kk-SECRET
LLM_MODEL=claude-sonnet-5-5

# LLM: NVIDIA Nemotron
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=
LLM_MODEL=nvidia/nemotron-3-ultra-550b-a55b
"""


def test_a_file_that_sets_the_endpoint_twice_is_never_paired(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / ".env.local").write_text(
        OWNER_LAYOUT
        + "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic,kodekey\nENGINE_EVAL_GRANTED_BY=O\n"
    )
    env, _notes, missing, _ = resolve(*collect(tmp_path))
    assert "LLM_API_KEY" not in env and "ENGINE_ANTHROPIC_API_KEY" not in env
    assert any(m.startswith("NVIDIA_API_KEY") for m in missing)
    assert any("KODEKEY_API_KEY" in m for m in missing)
    assert main(["--repo", str(tmp_path), "--emit", str(tmp_path / "e.env")]) == 1
    out = capsys.readouterr().out
    assert "LLM_BASE_URL is set 2 times in .env.local" in out
    assert "NVIDIA_API_KEY is empty in .env.local" in out
    assert "SECRET" not in out


def test_explicit_names_resolve_the_owner_layout(tmp_path: Path) -> None:
    (tmp_path / ".env.local").write_text(
        OWNER_LAYOUT.replace("NVIDIA_API_KEY=", "NVIDIA_API_KEY=nvapi-1")
        + "KODEKEY_BASE_URL=https://api.ai.kodekloud.example/v1\nKODEKEY_API_KEY=kk-2\n"
        "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic,kodekey\nENGINE_EVAL_GRANTED_BY=O\n"
    )
    env, _notes, missing, _ = resolve(*collect(tmp_path))
    assert missing == []
    assert (env["LLM_API_KEY"], env["LLM_BASE_URL"]) == (
        "nvapi-1",
        "https://integrate.api.nvidia.com/v1",
    )
    assert (env["ENGINE_ANTHROPIC_API_KEY"], env["ENGINE_ANTHROPIC_BASE_URL"]) == (
        "kk-2",
        "https://api.ai.kodekloud.example/v1",
    )


@pytest.mark.parametrize(
    ("written", "exported"), [("2,000,000", "2000000"), ("0", None), ("lots", None)]
)
def test_claude_token_cap_is_optional_and_numeric(
    tmp_path: Path, written: str, exported: str | None
) -> None:
    repo = _repo(tmp_path, "", f"ENGINE_EVAL_CLAUDE_TOKEN_CAP={written}\n")
    env, _notes, _missing, _ = resolve(*collect(repo))
    assert env.get("ENGINE_EVAL_CLAUDE_TOKEN_CAP") == exported
