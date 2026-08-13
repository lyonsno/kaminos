#!/usr/bin/env python3
"""Collect exact terminal receipts for both second-cycle reconstructions."""

import json
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


def main() -> int:
    campaign = validate_campaign(ROOT)
    submissions = json.loads((ROOT / "submissions.json").read_text())
    source = Path(submissions["source"])
    if digest(source) != submissions["sourceSha256"]:
        raise RuntimeError("submitted cycle-2 source drifted")
    rows = {}
    pending = {}
    for route in campaign["routes"]:
        route_id = route["id"]
        submission = submissions["routes"][route_id]
        try:
            rows[route_id] = admit_reconstruction(
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
            "source": str(source.resolve()),
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
