#!/usr/bin/env python3
"""Submit the frozen prompt-lighting Trellis selection idempotently."""

import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "trellis-selection.json"
RESULTS = ROOT / "result-ledger.json"
SUBMISSIONS = ROOT / "trellis-submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    selection = json.loads(SELECTION.read_text())
    result_rows = json.loads(RESULTS.read_text())["cells"]
    results = {row["id"]: row for row in result_rows}
    submissions = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {
        "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.trellis-submissions.v0",
        "selection": "trellis-selection.json",
        "cells": {},
    }
    route = selection["route"]
    for candidate in selection["candidates"]:
        cell_id = candidate["cellId"]
        if cell_id in submissions["cells"]:
            print(f"preserved {cell_id} -> {submissions['cells'][cell_id]['jobId']}")
            continue
        source_record = results[cell_id]
        input_path = (ROOT / source_record["output"]).resolve()
        if digest(input_path) != source_record["outputSha256"]:
            raise RuntimeError(f"selected FLUX output drifted: {cell_id}")
        output_dir = (ROOT / "trellis" / cell_id).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(GREENROOM), "submit", route["jobType"], str(input_path), str(output_dir),
            "-p", f"seed={route['seed']}", f"steps={route['steps']}",
            f"target_faces={route['targetFaces']}", f"texture_size={route['textureSize']}",
        ]
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id for {cell_id}: {completed.stdout}")
        submissions["cells"][cell_id] = {
            "jobId": match.group(1),
            "role": candidate["role"],
            "input": input_path.relative_to(ROOT).as_posix(),
            "inputSha256": digest(input_path),
            "outputDir": output_dir.relative_to(ROOT).as_posix(),
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, submissions)
        print(f"submitted {cell_id} -> {match.group(1)}")


if __name__ == "__main__":
    main()
