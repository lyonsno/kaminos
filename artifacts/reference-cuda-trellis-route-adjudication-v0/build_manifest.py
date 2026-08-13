#!/usr/bin/env python3
"""Hash the committed reference-CUDA evidence surface."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXCLUDED_PARTS = {"__pycache__", "downloads"}
EXCLUDED_NAMES = {"artifact-manifest.json"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    files = []
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if not path.is_file() or path.name in EXCLUDED_NAMES:
            continue
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        files.append({
            "path": relative.as_posix(),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        })
    payload = {
        "schema": "kaminos.reference_cuda_trellis_artifact_manifest.v1",
        "files": files,
    }
    (ROOT / "artifact-manifest.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n"
    )


if __name__ == "__main__":
    main()
