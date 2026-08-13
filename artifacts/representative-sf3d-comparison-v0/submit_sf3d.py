#!/usr/bin/env python3
"""Submit the three SF3D comparison cells idempotently."""

import json
import re
import subprocess
from pathlib import Path

from comparison_contract import digest, validate_campaign


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
SUBMISSIONS = ROOT / "submissions.json"


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    campaign = validate_campaign(ROOT, REPO)
    state = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {
        "schema": "kaminos.representative-sf3d-comparison.submissions.v0",
        "cells": {},
    }
    for cell in campaign["cells"]:
        cell_id = cell["id"]
        source = (REPO / cell["source"]["path"]).resolve()
        if digest(source) != cell["source"]["sha256"]:
            raise RuntimeError(f"source drifted before submission: {cell_id}")
        if cell_id in state["cells"]:
            print(f"preserved {cell_id} -> {state['cells'][cell_id]['jobId']}")
            continue
        output_dir = (ROOT / "reconstructions" / cell_id / "sf3d").resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        if (output_dir / "output.glb").exists():
            raise RuntimeError(f"unregistered SF3D output would confound {cell_id}")
        command = [
            str(GREENROOM),
            "submit",
            campaign["sf3d"]["jobType"],
            str(source),
            str(output_dir),
            "-p",
        ]
        command.extend(
            f"{key}={value}" for key, value in campaign["sf3d"]["params"].items()
        )
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id: {completed.stdout}")
        state["cells"][cell_id] = {
            "jobId": match.group(1),
            "jobType": campaign["sf3d"]["jobType"],
            "source": str(source),
            "sourceSha256": digest(source),
            "outputDir": str(output_dir),
            "requestedParams": campaign["sf3d"]["params"],
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, state)
        print(f"submitted {cell_id} -> {match.group(1)}")


if __name__ == "__main__":
    main()
