"""Detect FLUX route drift by replaying one frozen historical cell.

The exposure this guards: the campaign's accumulated authority map is valid for
one route identity. A quantization change, step-count change, or upstream model
update could silently invalidate it, and the record shows no check that would
catch that.

**Compare PIXELS, not file bytes.** The route runs with `--metadata`, which
embeds XMP/EXIF including generation timestamps, so two byte-identical
generations produce different file hashes. Measured on the 2026-08-07 replay of
job `4ce88d05f1f4`: output hash differed from the 2026-08-04 original while all
262,144 pixels were identical and max channel delta was 0. A byte-hash canary
would therefore fire on every single run — a 100% false-positive rate, which is
worse than no canary because it trains the operator to ignore it.

Exit codes: 0 pixel-identical, 1 drift detected, 2 harness failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPORT_SCHEMA = "kaminos.route-drift-canary.v0"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def compare(reference: Path, replay: Path) -> dict[str, Any]:
    from PIL import Image  # imported here so a missing dep is a harness failure
    import numpy as np

    a = np.asarray(Image.open(reference).convert("RGB")).astype(int)
    b = np.asarray(Image.open(replay).convert("RGB")).astype(int)
    if a.shape != b.shape:
        return {
            "drift": True,
            "reason": "dimension-mismatch",
            "referenceShape": list(a.shape),
            "replayShape": list(b.shape),
        }
    delta = abs(a - b)
    differing = int((delta.sum(axis=2) > 0).sum())
    return {
        "drift": differing > 0,
        "reason": "pixel-delta" if differing else None,
        "shape": list(a.shape),
        "identicalPixelFraction": float((delta.sum(axis=2) == 0).mean()),
        "differingPixelCount": differing,
        "maxChannelDelta": int(delta.max()),
        "meanAbsDelta": float(delta.mean()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--replay", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--reference-job", default=None)
    parser.add_argument("--replay-job", default=None)
    args = parser.parse_args()
    try:
        for p in (args.reference, args.replay):
            if not p.is_file():
                raise ValueError(f"missing image: {p}")
        result = compare(args.reference, args.replay)
        report = {
            "schema": REPORT_SCHEMA,
            "status": "drift" if result["drift"] else "stable",
            "comparison": "pixel",
            "note": (
                "File hashes differ on every run because the route embeds XMP/EXIF "
                "generation timestamps via --metadata. Byte comparison is not a valid "
                "drift signal for this route."
            ),
            "reference": {
                "path": str(args.reference),
                "sha256": _sha256(args.reference),
                "jobId": args.reference_job,
            },
            "replay": {
                "path": str(args.replay),
                "sha256": _sha256(args.replay),
                "jobId": args.replay_job,
            },
            "result": result,
        }
        _write(args.report, report)
        print(json.dumps({"status": report["status"], **result}, indent=2))
        return 1 if result["drift"] else 0
    except Exception as exc:  # noqa: BLE001 - harness must report its own failure
        _write(
            args.report,
            {
                "schema": REPORT_SCHEMA,
                "status": "failed",
                "failurePhase": "compare",
                "message": str(exc),
                "lastTrustworthyEvidence": {
                    "reference": str(args.reference),
                    "replay": str(args.replay),
                },
            },
        )
        print(json.dumps({"status": "failed", "message": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
