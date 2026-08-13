#!/usr/bin/env python3
"""Collect exact terminal receipts for both second-cycle reconstructions."""

import json
import os
import tempfile
from pathlib import Path

from cycle2_contract import admit_reconstruction, digest, validate_campaign


ROOT = Path(__file__).resolve().parent
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")


def atomic_json(path: Path, payload: dict) -> None:
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def portable(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT)).as_posix()


def main() -> int:
    campaign = validate_campaign(ROOT)
    submissions = json.loads((ROOT / "submissions.json").read_text())
    source = (ROOT / submissions["source"]).resolve()
    if digest(source) != submissions["sourceSha256"]:
        raise RuntimeError("submitted cycle-2 source drifted")
    rows = {}
    pending = {}
    for route in campaign["routes"]:
        route_id = route["id"]
        submission = submissions["routes"][route_id]
        try:
            row = admit_reconstruction(
                queue_root=QUEUE,
                job_id=submission["jobId"],
                expected_job_type=route["jobType"],
                expected_input=source,
                output_dir=(ROOT / submission["outputDir"]).resolve(),
            )
            row["input"] = portable(Path(row["input"]))
            row["output"] = portable(Path(row["output"]))
            rows[route_id] = row
        except RuntimeError as error:
            if "not terminal" in str(error):
                pending[route_id] = str(error)
                continue
            atomic_json(
                ROOT / "cycle-2-failure.json",
                {
                    "schema": "kaminos.polygonal-cat-roundtrip.cycle-2.failure.v0",
                    "phase": "terminal-admission",
                    "route": route_id,
                    "error": str(error),
                    "lastTrustworthyEvidence": "submissions.json",
                },
            )
            raise
    if pending:
        atomic_json(
            ROOT / "collection-state.json",
            {
                "schema": "kaminos.polygonal-cat-roundtrip.cycle-2.collection-state.v0",
                "state": "pending",
                "pending": pending,
            },
        )
        return 2
    atomic_json(
        ROOT / "reconstruction-ledger.json",
        {
            "schema": "kaminos.polygonal-cat-roundtrip.cycle-2.reconstruction-ledger.v0",
            "source": portable(source),
            "sourceSha256": digest(source),
            "routes": rows,
        },
    )
    atomic_json(
        ROOT / "collection-state.json",
        {
            "schema": "kaminos.polygonal-cat-roundtrip.cycle-2.collection-state.v0",
            "state": "completed",
            "routes": sorted(rows),
        },
    )
    (ROOT / "cycle-2-failure.json").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
