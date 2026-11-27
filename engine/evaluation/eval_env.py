"""Find the evaluation's provider configuration in the existing env files - safely.

    uv run python -m evaluation.eval_env --repo .. --emit OUT_DIR/eval.env

Reads only whitelisted variable names from the process environment and from the repo's
env files (``.env``, ``.env.local``, ``engine/.env*``, ``web/.env*``); never executes them.
Prints names, where each came from and URL hosts - never a value. Writes a mode-600 file
of ``export NAME=...`` lines for the run script to source, then exits 1 if anything the
run needs is missing (listed by name).

Rules (agreed models and privacy boundaries only):
* Nemotron is the NVIDIA endpoint (integrate.api.nvidia.com) with the agreed model. If
  LLM_BASE_URL points elsewhere (e.g. the web app's KodeKey gateway), it is not used for
  Nemotron; an NVIDIA key under NVIDIA_API_KEY / NGC_API_KEY / NVIDIA_NIM_API_KEY is used
  with the NVIDIA endpoint instead. Another LLM_MODEL is replaced by the agreed model.
* Claude takes ENGINE_ANTHROPIC_API_KEY, else ANTHROPIC_API_KEY. The engine's own
  ENGINE_ANTHROPIC_BASE_URL only - a shell's ANTHROPIC_BASE_URL (e.g. a proxy) is ignored.
* Prices: NVIDIA free trial 0; Claude Opus 5.5 list price $4 / $20 per million tokens
  (other Claude models need ENGINE_PRICE_ANTHROPIC_IN/_OUT set by the owner).
* The privacy declarations are never inferred: ENGINE_CLOUD_RETENTION_REVIEWED must name
  both providers and ENGINE_EVAL_GRANTED_BY must name the person authorizing the run.
"""

import argparse
import os
import shlex
import sys
from pathlib import Path
from urllib.parse import urlparse

from app.providers.anthropic import DEFAULT_MODEL as CLAUDE_MODEL
from app.providers.nvidia import DEFAULT_MODEL as NEMOTRON_MODEL

NVIDIA_URL = "https://integrate.api.nvidia.com/v1"
NVIDIA_HOST = "integrate.api.nvidia.com"
CLAUDE_PRICES = {"claude-opus-5-5": ("4", "20")}  # USD per million tokens, list price
NAMES = (
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "NEMOTRON_STRUCTURED",
    "NVIDIA_API_KEY",
    "NGC_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "ENGINE_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "ENGINE_ANTHROPIC_MODEL",
    "ENGINE_ANTHROPIC_BASE_URL",
    "ENGINE_PRICE_NVIDIA_IN",
    "ENGINE_PRICE_NVIDIA_OUT",
    "ENGINE_PRICE_ANTHROPIC_IN",
    "ENGINE_PRICE_ANTHROPIC_OUT",
    "ENGINE_CLOUD_RETENTION_REVIEWED",
    "ENGINE_EVAL_GRANTED_BY",
)
FILES = (".env", ".env.local", "engine/.env", "engine/.env.local", "web/.env", "web/.env.local")


def _parse(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        name, value = name.strip(), value.strip()
        if name in NAMES and value:
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            else:
                value = value.split(" #", 1)[0].strip()
            out.setdefault(name, value)
    return out


def collect(repo: Path) -> tuple[dict[str, str], dict[str, str]]:
    """(values, source per name); the process environment wins over files."""
    values: dict[str, str] = {}
    source: dict[str, str] = {}
    for name in NAMES:
        if os.environ.get(name):
            values[name], source[name] = os.environ[name], "environment"
    for rel in FILES:
        path = repo / rel
        if path.is_file():
            for name, value in _parse(path).items():
                if name not in values:
                    values[name], source[name] = value, rel
    return values, source


def _host(url: str) -> str:
    return urlparse(url).hostname or "?"


Found = tuple[dict[str, str], dict[str, str], list[str], list[str]]  # env, origin, notes, missing


def _nemotron(values: dict[str, str], source: dict[str, str], out: Found) -> None:
    env, origin, notes, missing = out
    base, key = values.get("LLM_BASE_URL", ""), values.get("LLM_API_KEY", "")
    origin_key = source.get("LLM_API_KEY", "")
    if base and _host(base) != NVIDIA_HOST:
        notes.append(
            f"LLM_BASE_URL ({source['LLM_BASE_URL']}) points to {_host(base)}, "
            "not NVIDIA: not used for Nemotron"
        )
        base, key = "", ""
    if not key:
        alt = next(
            (a for a in ("NVIDIA_API_KEY", "NGC_API_KEY", "NVIDIA_NIM_API_KEY") if values.get(a)),
            "",
        )
        if alt:
            base, key, origin_key = NVIDIA_URL, values[alt], f"{alt} ({source[alt]})"
            notes.append(f"Nemotron key from {alt}, endpoint {NVIDIA_HOST}")
    if not key:
        missing.append("NVIDIA_API_KEY (build.nvidia.com key for Nemotron)")
        return
    env["LLM_BASE_URL"], env["LLM_API_KEY"], env["LLM_MODEL"] = (
        base or NVIDIA_URL,
        key,
        NEMOTRON_MODEL,
    )
    origin.update(LLM_BASE_URL="NVIDIA endpoint", LLM_API_KEY=origin_key, LLM_MODEL="agreed model")
    model = values.get("LLM_MODEL", "")
    if model and model != NEMOTRON_MODEL:
        notes.append(
            f"LLM_MODEL ({source['LLM_MODEL']}) is not the agreed model: using {NEMOTRON_MODEL}"
        )
    if values.get("NEMOTRON_STRUCTURED"):
        env["NEMOTRON_STRUCTURED"] = values["NEMOTRON_STRUCTURED"]


def _claude(values: dict[str, str], source: dict[str, str], out: Found) -> None:
    env, origin, notes, missing = out
    which = next(
        (n for n in ("ENGINE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY") if values.get(n)), ""
    )
    if which:
        env["ENGINE_ANTHROPIC_API_KEY"] = values[which]
        origin["ENGINE_ANTHROPIC_API_KEY"] = f"{which} ({source[which]})"
    else:
        missing.append("ENGINE_ANTHROPIC_API_KEY (Anthropic API key)")
    model = values.get("ENGINE_ANTHROPIC_MODEL") or CLAUDE_MODEL
    env["ENGINE_ANTHROPIC_MODEL"] = model
    if values.get("ENGINE_ANTHROPIC_BASE_URL"):
        env["ENGINE_ANTHROPIC_BASE_URL"] = values["ENGINE_ANTHROPIC_BASE_URL"]
    env["ENGINE_PRICE_NVIDIA_IN"] = values.get("ENGINE_PRICE_NVIDIA_IN", "0")
    env["ENGINE_PRICE_NVIDIA_OUT"] = values.get("ENGINE_PRICE_NVIDIA_OUT", "0")
    a_in, a_out = values.get("ENGINE_PRICE_ANTHROPIC_IN"), values.get("ENGINE_PRICE_ANTHROPIC_OUT")
    if not (a_in and a_out) and model in CLAUDE_PRICES:
        a_in, a_out = CLAUDE_PRICES[model]
        notes.append(f"Claude price: {model} list price ${a_in} / ${a_out} per million tokens")
    if a_in and a_out:
        env["ENGINE_PRICE_ANTHROPIC_IN"], env["ENGINE_PRICE_ANTHROPIC_OUT"] = a_in, a_out
    else:
        missing.append(f"ENGINE_PRICE_ANTHROPIC_IN / _OUT (USD per million tokens for {model})")


def _declarations(values: dict[str, str], out: Found) -> None:
    env, _origin, _notes, missing = out
    raw = values.get("ENGINE_CLOUD_RETENTION_REVIEWED", "")
    reviewed = {p.strip() for p in raw.split(",") if p.strip()}
    if {"nvidia", "anthropic"} <= reviewed:
        env["ENGINE_CLOUD_RETENTION_REVIEWED"] = ",".join(sorted(reviewed))
    else:
        missing.append(
            "ENGINE_CLOUD_RETENTION_REVIEWED=nvidia,anthropic (your record that both "
            "providers' retention/training terms were reviewed)"
        )
    if values.get("ENGINE_EVAL_GRANTED_BY"):
        env["ENGINE_EVAL_GRANTED_BY"] = values["ENGINE_EVAL_GRANTED_BY"]
    else:
        missing.append(
            "ENGINE_EVAL_GRANTED_BY=<your name> (authorizes sending the public validation SBCs)"
        )
    env["ENGINE_CLOUD_PROVIDERS"] = "nvidia,anthropic"


def resolve(
    values: dict[str, str], source: dict[str, str]
) -> tuple[dict[str, str], list[str], list[str], dict[str, str]]:
    """(exports, notes, missing, origin of each export)."""
    out: Found = ({}, {}, [], [])
    _nemotron(values, source, out)
    _claude(values, source, out)
    _declarations(values, out)
    env, origin, notes, missing = out
    for name in env:
        origin.setdefault(name, source.get(name, "default"))
    return env, notes, missing, origin


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, required=True)
    ap.add_argument("--emit", type=Path, required=True)
    args = ap.parse_args(argv)
    values, source = collect(args.repo)
    env, notes, missing, origin = resolve(values, source)
    print("configuration found (names and sources only):")
    for name in sorted(env):
        shown = (
            _host(env[name])
            if name.endswith("BASE_URL")
            else ("set" if "KEY" in name else env[name])
        )
        print(f"  {name:34} {shown:34} <- {origin[name]}")
    for n in notes:
        print(f"  note: {n}")
    args.emit.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.emit, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        for name, value in sorted(env.items()):
            f.write(f"export {name}={shlex.quote(value)}\n")
    if missing:
        print("MISSING - set these (environment or engine/.env.local), then rerun:")
        for m in missing:
            print(f"  - {m}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
