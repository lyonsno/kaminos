#!/usr/bin/env python3
"""Admit terminal SF3D results and bind their matched Trellis controls."""

import json
from pathlib import Path

from comparison_contract import admit_sf3d_result, digest, validate_campaign


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def main() -> int:
    campaign = validate_campaign(ROOT, REPO)
    submissions = json.loads((ROOT / "submissions.json").read_text())
    rows = {}
    pending = {}
    for cell in campaign["cells"]:
        cell_id = cell["id"]
        source = (REPO / cell["source"]["path"]).resolve()
        submission = submissions["cells"][cell_id]
        try:
            sf3d = admit_sf3d_result(
                queue_root=QUEUE,
                job_id=submission["jobId"],
                expected_input=source,
                output_dir=Path(submission["outputDir"]),
            )
        except RuntimeError as error:
            if "not terminal" in str(error):
                pending[cell_id] = str(error)
                continue
            write_json(ROOT / "comparison-failure.json", {
                "schema": "kaminos.representative-sf3d-comparison.failure.v0",
                "phase": "terminal-admission",
                "cell": cell_id,
                "error": str(error),
                "lastTrustworthyEvidence": "submissions.json",
            })
            raise
        trellis_output = (REPO / cell["trellis"]["path"]).resolve()
        rows[cell_id] = {
            "class": cell["class"],
            "question": cell["question"],
            "source": {
                "path": str(source),
                "sha256": digest(source),
            },
            "routes": {
                "sf3d": sf3d,
                "trellis": {
                    "jobType": "trellis2mlx_fast",
                    "output": str(trellis_output),
                    "outputSha256": digest(trellis_output),
                    "outputBytes": trellis_output.stat().st_size,
                    "ledger": str((REPO / cell["trellis"]["ledger"]).resolve()),
                    "ledgerCell": cell["trellis"]["cell"],
                },
            },
        }
    if pending:
        write_json(ROOT / "collection-state.json", {
            "schema": "kaminos.representative-sf3d-comparison.collection-state.v0",
            "state": "pending",
            "pending": pending,
        })
        return 2
    write_json(ROOT / "comparison-ledger.json", {
        "schema": "kaminos.representative-sf3d-comparison.ledger.v0",
        "question": campaign["question"],
        "claimCeiling": campaign["claimCeiling"],
        "cells": rows,
    })
    write_json(ROOT / "collection-state.json", {
        "schema": "kaminos.representative-sf3d-comparison.collection-state.v0",
        "state": "completed",
        "cells": sorted(rows),
    })
    (ROOT / "comparison-failure.json").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
