#!/usr/bin/env python3
"""Collect exact terminal receipts and reject partial reconstruction evidence."""

import json
import sys
from pathlib import Path

from roundtrip_contract import admit_terminal_result, digest


ROOT = Path(__file__).resolve().parent
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def main() -> int:
    campaign = json.loads((ROOT / "campaign.json").read_text())
    submissions = json.loads((ROOT / "submissions.json").read_text())
    source = Path(submissions["source"])
    if digest(source) != submissions["sourceSha256"]:
        raise RuntimeError("submitted source drifted")
    rows = {}
    pending = {}
    for route in campaign["routes"]:
        route_id = route["id"]
        submission = submissions["routes"][route_id]
        try:
            rows[route_id] = admit_terminal_result(
                queue_root=QUEUE,
                job_id=submission["jobId"],
                expected_job_type=route["jobType"],
                expected_input=source,
                output_dir=Path(submission["outputDir"]),
            )
        except RuntimeError as error:
            if "not terminal" in str(error):
                pending[route_id] = str(error)
                continue
            write_json(ROOT / "reconstruction-failure.json", {
                "schema": "kaminos.polygonal-cat-roundtrip.failure.v0",
                "phase": "terminal-admission",
                "route": route_id,
                "error": str(error),
                "lastTrustworthyEvidence": "submissions.json",
            })
            raise
    if pending:
        write_json(ROOT / "collection-state.json", {
            "schema": "kaminos.polygonal-cat-roundtrip.collection-state.v0",
            "state": "pending",
            "pending": pending,
        })
        return 2
    write_json(ROOT / "reconstruction-ledger.json", {
        "schema": "kaminos.polygonal-cat-roundtrip.reconstruction-ledger.v0",
        "source": str(source),
        "sourceSha256": digest(source),
        "routes": rows,
    })
    write_json(ROOT / "collection-state.json", {
        "schema": "kaminos.polygonal-cat-roundtrip.collection-state.v0",
        "state": "completed",
        "routes": sorted(rows),
    })
    (ROOT / "reconstruction-failure.json").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
