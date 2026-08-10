#!/usr/bin/env python3
"""Submit every visually promoted FLUX cell to TRELLIS idempotently."""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
FLUX_LEDGER = ROOT / "flux-ledger.json"
ADMISSION = ROOT / "visual-admission.json"
SUBMISSIONS = ROOT / "trellis-submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def trellis_params(policy: dict, seed: int) -> list[str]:
    return [
        f"seed={seed}",
        f"steps={policy['steps']}",
        f"target_faces={policy['targetFaces']}",
        f"texture_size={policy['textureSize']}",
    ]


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    campaign = json.loads(CAMPAIGN.read_text())
    flux = json.loads(FLUX_LEDGER.read_text())
    admission = json.loads(ADMISSION.read_text())
    submissions = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {"cells": {}}

    for cell in campaign["cells"]:
        cell_id = cell["id"]
        disposition = admission["cells"][cell_id]
        if not disposition["promotedToTrellis"]:
            continue
        if cell_id in submissions["cells"]:
            print(f"preserved {cell_id} -> {submissions['cells'][cell_id]['jobId']}")
            continue

        input_path = ROOT / flux["cells"][cell_id]["output"]
        output_dir = ROOT / "trellis" / cell_id
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(GREENROOM),
            "submit",
            campaign["trellisPolicy"]["jobType"],
            str(input_path),
            str(output_dir),
        ]
        for parameter in trellis_params(campaign["trellisPolicy"], cell["seed"]):
            command.extend(["-p", parameter])
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id for {cell_id}: {completed.stdout}")
        submissions["cells"][cell_id] = {
            "jobId": match.group(1),
            "input": str(input_path.relative_to(ROOT)),
            "outputDir": str(output_dir.relative_to(ROOT)),
            "trellisRole": disposition["trellisRole"],
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, submissions)
        print(f"submitted {cell_id} -> {match.group(1)}")


if __name__ == "__main__":
    main()
