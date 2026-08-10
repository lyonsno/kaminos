#!/usr/bin/env python3
"""Submit the frozen FLUX basin matrix to GPU Greenroom idempotently."""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SUBMISSIONS = ROOT / "flux-submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    campaign = json.loads(CAMPAIGN.read_text())
    submissions = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {"cells": {}}
    source = ROOT / campaign["source"]["plate"]

    for cell in campaign["cells"]:
        if cell["id"] in submissions["cells"]:
            print(f"preserved {cell['id']} -> {submissions['cells'][cell['id']]['jobId']}")
            continue

        output_dir = ROOT / "flux" / cell["id"]
        output_dir.mkdir(parents=True, exist_ok=True)
        prompt_file = ROOT / cell["promptFile"]
        command = [
            str(GREENROOM),
            "submit",
            cell["jobType"],
            str(source),
            str(output_dir),
            "-p",
            f"prompt_file={prompt_file}",
            f"seed={cell['seed']}",
            f"model={cell['model']}",
            f"quantize={cell['quantize']}",
            f"width={cell['width']}",
            f"height={cell['height']}",
            f"steps={cell['steps']}",
            f"guidance={cell['guidance']}",
            f"mlx_cache_limit_gb={cell['mlxCacheLimitGb']}",
        ]
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id for {cell['id']}: {completed.stdout}")
        submissions["cells"][cell["id"]] = {
            "jobId": match.group(1),
            "outputDir": str(output_dir.relative_to(ROOT)),
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, submissions)
        print(f"submitted {cell['id']} -> {match.group(1)}")


if __name__ == "__main__":
    main()
