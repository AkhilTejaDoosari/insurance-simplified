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
