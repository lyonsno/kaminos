#!/usr/bin/env python3
"""Submit the frozen 33-cell Flux campaign through GPU Greenroom."""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SUBMISSIONS = ROOT / "submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    campaign = json.loads(CAMPAIGN.read_text())
    route = campaign["fluxRoute"]
    submissions = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {
        "schema": "kaminos.cat-carrier-cross-basin-authority.submissions.v0",
        "campaign": "campaign.json",
        "cells": {},
    }

    for cell in campaign["cells"]:
        if cell["id"] in submissions["cells"]:
            print(f"preserved {cell['id']} -> {submissions['cells'][cell['id']]['jobId']}")
            continue
        source = (ROOT / campaign["sources"][cell["sourceId"]]["plate"]).resolve()
        prompt_file = (ROOT / cell["promptFile"]).resolve()
        output_dir = (ROOT / cell["outputDir"]).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(GREENROOM),
            "submit",
            route["jobType"],
            str(source),
            str(output_dir),
            "--cwd",
            str(ROOT.parents[1]),
            "-p",
            f"prompt_file={prompt_file}",
            f"seed={cell['seed']}",
            f"model={route['model']}",
            f"quantize={route['quantize']}",
            f"width={route['width']}",
            f"height={route['height']}",
            f"steps={route['steps']}",
            f"guidance={route['guidance']}",
            f"mlx_cache_limit_gb={route['mlxCacheLimitGb']}",
        ]
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id for {cell['id']}: {completed.stdout}")
        submissions["cells"][cell["id"]] = {
            "jobId": match.group(1),
            "source": str(source),
            "promptFile": str(prompt_file),
            "outputDir": str(output_dir),
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, submissions)
        print(f"submitted {cell['id']} -> {match.group(1)}")


if __name__ == "__main__":
    main()
