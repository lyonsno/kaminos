#!/usr/bin/env python3
"""Submit the basin-distinct Trellis selection idempotently."""

import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SELECTION = ROOT / "trellis-selection.json"
SUBMISSIONS = ROOT / "trellis-submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    campaign = json.loads(CAMPAIGN.read_text())
    cells = {cell["id"]: cell for cell in campaign["cells"]}
    selection = json.loads(SELECTION.read_text())
    route = selection["route"]
    submissions = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {
        "schema": "kaminos.cat-carrier-cross-basin-authority.trellis-submissions.v0",
        "selection": "trellis-selection.json",
        "cells": {},
    }

    for candidate in selection["candidates"]:
        cell_id = candidate["cellId"]
        if cell_id in submissions["cells"]:
            print(f"preserved {cell_id} -> {submissions['cells'][cell_id]['jobId']}")
            continue
        cell = cells[cell_id]
        input_path = (ROOT / cell["outputDir"] / "output.png").resolve()
        if not input_path.is_file() or input_path.stat().st_size <= 1024:
            raise RuntimeError(f"selected Flux output is missing or blank: {input_path}")
        output_dir = (ROOT / "trellis" / cell_id).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(GREENROOM),
            "submit",
            route["jobType"],
            str(input_path),
            str(output_dir),
            "-p",
            f"seed={route['seed']}",
            f"steps={route['steps']}",
            f"target_faces={route['targetFaces']}",
            f"texture_size={route['textureSize']}",
        ]
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id for {cell_id}: {completed.stdout}")
        submissions["cells"][cell_id] = {
            "jobId": match.group(1),
            "role": candidate["role"],
            "input": input_path.relative_to(ROOT).as_posix(),
            "inputSha256": sha256(input_path),
            "outputDir": output_dir.relative_to(ROOT).as_posix(),
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, submissions)
        print(f"submitted {cell_id} -> {match.group(1)}")


if __name__ == "__main__":
    main()
