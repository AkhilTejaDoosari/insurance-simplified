#!/usr/bin/env python3
"""Tidy a .env.local without ever printing a value.

    python3 scripts/tidy_env_local.py [--file .env.local] [--web-llm nvidia|kodekey] [--dry-run]

1. Backs the file up (``<file>.bak-<time>``, mode 600) before changing anything.
2. Splits the duplicated LLM blocks into named groups, so no name is set twice:
     KODEKEY_BASE_URL / KODEKEY_API_KEY / KODEKEY_MODEL    (the KodeKey gateway)
     NVIDIA_BASE_URL  / NVIDIA_API_KEY  / NVIDIA_MODEL     (Nemotron on build.nvidia.com)
     LLM_BASE_URL / LLM_API_KEY / LLM_MODEL                (what the web app uses: one choice)
   Each LLM_API_KEY / LLM_MODEL belongs to the LLM_BASE_URL above it (the file's blocks).
   It refuses to guess: a key before any endpoint, an unknown endpoint, or an NVIDIA key
   ("nvapi-") under a non-NVIDIA endpoint stops it with the file unchanged.
   Any other name set twice keeps its last value (what dotenv loaders use) and is reported.
3. Writes ``.env.example`` next to it: the same names and comments, no values.
4. Writes or updates ``engine/.env.local`` (mode 600) with what the engine evaluation
   needs: NVIDIA_API_KEY, KODEKEY_BASE_URL, KODEKEY_API_KEY, KODEKEY_CLAUDE_MODEL - keeping
   everything already there (e.g. ENGINE_CLOUD_RETENTION_REVIEWED, ENGINE_EVAL_GRANTED_BY).

Prints names, hosts and what it did - never a value. Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

LLM = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")
NVIDIA_URL = "https://integrate.api.nvidia.com/v1"
NEMOTRON = "nvidia/nemotron-3-ultra-550b-a55b"
ASSIGN = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v.split(" #", 1)[0].strip()


def _group(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    if host == "integrate.api.nvidia.com":
        return "nvidia"
    if "kodekey" in host or "kodekloud" in host:
        return "kodekey"
    return None


def _host(url: str) -> str:
    return urlparse(url).hostname or "?"


class RefusedError(Exception):
    pass


def split_llm(lines: list[str]) -> tuple[dict[str, dict[str, str]], set[int]]:  # noqa: PLR0912
    """{group: {base, key, model}}, and the line numbers that held LLM_* / NVIDIA_API_KEY."""
    groups: dict[str, dict[str, str]] = {"kodekey": {}, "nvidia": {}}
    used: set[int] = set()
    current: str | None = None
    for i, line in enumerate(lines):
        m = ASSIGN.match(line)
        if not m or line.lstrip().startswith("#"):
            continue
        name, value = m.group(1), _unquote(m.group(2))
        if name == "LLM_BASE_URL":
            used.add(i)
            if not value:
                current = None
                continue
            current = _group(value)
            if current is None:
                raise RefusedError(
                    f"LLM_BASE_URL on line {i + 1} points to {_host(value)}: unknown, not changing anything"
                )
            groups[current]["base"] = value
        elif name in ("LLM_API_KEY", "LLM_MODEL"):
            used.add(i)
            if not value:
                continue
            if current is None:
                raise RefusedError(
                    f"{name} on line {i + 1} has no LLM_BASE_URL above it: not guessing whose it is"
                )
            field = "key" if name == "LLM_API_KEY" else "model"
            if field == "key" and value.startswith("nvapi-") and current != "nvidia":
                raise RefusedError(
                    f"line {i + 1}: an NVIDIA key sits under the {current} endpoint - fix by hand"
                )
            groups[current][field] = value
        elif name in ("NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL"):
            used.add(i)
            field = {"NVIDIA_API_KEY": "key", "NVIDIA_BASE_URL": "base", "NVIDIA_MODEL": "model"}[name]
            if value:
                groups["nvidia"][field] = value
        elif name in ("KODEKEY_API_KEY", "KODEKEY_BASE_URL", "KODEKEY_MODEL"):
            used.add(i)
            field = {"KODEKEY_API_KEY": "key", "KODEKEY_BASE_URL": "base", "KODEKEY_MODEL": "model"}[name]
            if value:
                groups["kodekey"][field] = value
    if groups["nvidia"].get("key"):
        groups["nvidia"].setdefault("base", NVIDIA_URL)
        groups["nvidia"].setdefault("model", NEMOTRON)
    return groups, used


def _drop_header_comments(lines: list[str], used: set[int]) -> set[int]:
    """Comment lines sitting directly above removed LLM lines go with them."""
    drop = set(used)
    for i in sorted(used):
        j = i - 1
        while j >= 0 and (lines[j].lstrip().startswith("#") or j in drop) and lines[j].strip():
            drop.add(j)
            j -= 1
    return drop


def dedupe(lines: list[str]) -> tuple[list[str], list[str]]:
    """Keep the last assignment of any name set twice; report names only."""
    last: dict[str, int] = {}
    for i, line in enumerate(lines):
        m = ASSIGN.match(line)
        if m and not line.lstrip().startswith("#"):
            last[m.group(1)] = i
    out, twice = [], []
    for i, line in enumerate(lines):
        m = ASSIGN.match(line)
        if m and not line.lstrip().startswith("#") and last[m.group(1)] != i:
            twice.append(m.group(1))
            continue
        out.append(line)
    return out, sorted(set(twice))


def _block(title: str, rows: list[tuple[str, str]]) -> list[str]:
    return [title, *(f"{k}={v}" for k, v in rows), ""]


def tidy(text: str, web_llm: str) -> tuple[str, list[str]]:
    lines = text.splitlines()
    groups, used = split_llm(lines)
    report = []
    chosen = groups[web_llm]
    if not chosen.get("key"):
        raise RefusedError(f"--web-llm {web_llm}: that endpoint has no key in this file")
    head: list[str] = []
    head += _block(
        f"# LLM used by the web app: {web_llm} (other choice: --web-llm "
        f"{'kodekey' if web_llm == 'nvidia' else 'nvidia'})",
        [
            ("LLM_BASE_URL", chosen.get("base", "")),
            ("LLM_API_KEY", chosen["key"]),
            ("LLM_MODEL", chosen.get("model", "")),
        ],
    )
    if groups["kodekey"]:
        k = groups["kodekey"]
        head += _block(
            "# KodeKey gateway (Claude). Documents sent here pass through KodeKloud.",
            [
                ("KODEKEY_BASE_URL", k.get("base", "")),
                ("KODEKEY_API_KEY", k.get("key", "")),
                ("KODEKEY_MODEL", k.get("model", "")),
            ],
        )
    if groups["nvidia"]:
        n = groups["nvidia"]
        head += _block(
            "# NVIDIA Nemotron 3 Ultra (build.nvidia.com free tier, 40 req/min).\n"
            "# Development only: public test documents, no personal data.",
            [
                ("NVIDIA_BASE_URL", n.get("base", "")),
                ("NVIDIA_API_KEY", n.get("key", "")),
                ("NVIDIA_MODEL", n.get("model", "")),
            ],
        )
    drop = _drop_header_comments(lines, used)
    rest = [line for i, line in enumerate(lines) if i not in drop]
    rest, twice = dedupe(rest)
    if twice:
        report.append("set twice, kept the last value: " + ", ".join(twice))
    body = re.sub(r"\n{3,}", "\n\n", "\n".join(head + rest).strip() + "\n")
    report.append(f"web app LLM_* -> {web_llm} ({_host(chosen.get('base', ''))})")
    for g, v in groups.items():
        if v:
            state = "set" if v.get("key") else "MISSING"
            report.append(f"{g}: endpoint {_host(v.get('base', ''))}, key {state}")
    return body, report


def example(text: str) -> str:
    out = []
    for line in text.splitlines():
        m = ASSIGN.match(line)
        out.append(f"{m.group(1)}=" if m and not line.lstrip().startswith("#") else line)
    return "# Names only - copy to .env.local and fill in. Never commit values.\n" + "\n".join(out) + "\n"


def engine_env(path: Path, text: str) -> list[str]:
    values = {}
    for line in text.splitlines():
        m = ASSIGN.match(line)
        if m and not line.lstrip().startswith("#"):
            values[m.group(1)] = _unquote(m.group(2))
    wanted = {
        "NVIDIA_API_KEY": values.get("NVIDIA_API_KEY", ""),
        "KODEKEY_BASE_URL": values.get("KODEKEY_BASE_URL", ""),
        "KODEKEY_API_KEY": values.get("KODEKEY_API_KEY", ""),
    }
    existing = path.read_text().splitlines() if path.exists() else []
    keep = [
        line
        for line in existing
        if not ((m := ASSIGN.match(line)) and m.group(1) in {*wanted, "KODEKEY_CLAUDE_MODEL"})
    ]
    new = [f"{k}={v}" for k, v in wanted.items() if v]
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join([*keep, *new]).strip() + "\n")
    os.chmod(path, 0o600)
    return [k for k, v in wanted.items() if v]


def _write_private(path: Path, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.chmod(path, 0o600)


def main(argv: list[str]) -> int:
    repo = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path, default=repo / ".env.local")
    ap.add_argument("--web-llm", choices=("nvidia", "kodekey"), default="nvidia")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args(argv)
    src = args.file
    if not src.is_file():
        print(f"no such file: {src}")
        return 2
    original = src.read_text()
    try:
        cleaned, report = tidy(original, args.web_llm)
    except RefusedError as exc:
        print(f"stopped, nothing changed: {exc}")
        return 1
    for line in report:
        print("  " + line)
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    backup = src.with_name(f"{src.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(src, backup)
    os.chmod(backup, 0o600)
    _write_private(src, cleaned)
    example_path = src.with_name(".env.example")
    example_path.write_text(example(cleaned))
    added = engine_env(repo / "engine" / ".env.local", cleaned)
    print(f"  backup: {backup.name} (mode 600)")
    print(f"  cleaned: {src.name}; names only: {example_path.name}")
    print(f"  engine/.env.local now has: {', '.join(added) or 'nothing new'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
