"""Content-addressed cache for engine and model outputs.

Key = document SHA-256 + stage + engine name + engine/model version + prompt version +
the exact page set (+ anything else the caller passes). A new parser release, model id or
prompt version therefore never reuses an old answer. Values are JSON. The directory is
configured (ENGINE_CACHE_DIR); with none configured nothing is cached. Cached entries
hold derived document data, so the directory must stay inside the same privacy boundary
as the documents themselves (never in git, never in a shared location).
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Any


class Cache:
    def __init__(self, root: Path | None) -> None:
        self.root = root

    @classmethod
    def from_env(cls) -> "Cache":
        root = os.environ.get("ENGINE_CACHE_DIR")
        return cls(Path(root) if root else None)

    @staticmethod
    def key(document_sha256: str, stage: str, engine: str, version: str, **parts: Any) -> str:
        material = json.dumps(
            {"doc": document_sha256, "stage": stage, "engine": engine, "version": version, **parts},
            sort_keys=True,
            default=list,
        )
        return hashlib.sha256(material.encode()).hexdigest()

    def _path(self, key: str) -> Path | None:
        return self.root / key[:2] / f"{key}.json" if self.root else None

    def get(self, key: str) -> Any | None:
        path = self._path(key)
        if path is None or not path.is_file():
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None  # a damaged entry is a miss, never an error

    def put(self, key: str, value: Any) -> None:
        path = self._path(key)
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value))
        tmp.replace(path)  # atomic: readers never see half an entry
