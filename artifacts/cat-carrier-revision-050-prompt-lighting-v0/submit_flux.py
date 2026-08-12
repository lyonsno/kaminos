#!/usr/bin/env python3
"""Submit each frozen cell once through the durable GPU Greenroom worker."""

import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SUBMISSIONS = ROOT / "submissions.json"
FAILURE = ROOT / "submission-failure-report.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def digest(payload: object) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def request_for(campaign: dict, cell: dict, prompts: dict) -> dict:
    route = campaign["fluxRoute"]
    source = (ROOT / campaign["source"]["path"]).resolve()
    prompt = prompts[cell["promptId"]]
    prompt_file = (ROOT / prompt["file"]).resolve()
    output_dir = (ROOT / cell["outputDir"]).resolve()
    return {
        "cellId": cell["id"],
        "source": str(source),
        "sourceSha256": campaign["source"]["sha256"],
        "promptFile": str(prompt_file),
        "promptBytesSha256": prompt["bytesSha256"],
        "outputDir": str(output_dir),
        "params": {
            "prompt_file": str(prompt_file), "seed": str(cell["seed"]), "model": route["model"],
            "quantize": str(route["quantize"]), "width": str(route["width"]), "height": str(route["height"]),
            "steps": str(route["steps"]), "guidance": str(route["guidance"]),
            "mlx_cache_limit_gb": str(route["mlxCacheLimitGb"]),
        },
    }


def main() -> int:
    campaign = json.loads(CAMPAIGN.read_text())
    prompts = {prompt["id"]: prompt for prompt in campaign["promptRecords"]}
    submissions = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {
        "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.submissions.v0",
        "campaign": "campaign.json",
        "campaignSha256": hashlib.sha256(CAMPAIGN.read_bytes()).hexdigest(),
        "cells": {},
    }
    failures = {}
    for cell in campaign["cells"]:
        requested = request_for(campaign, cell, prompts)
        request_sha256 = digest(requested)
        existing = submissions["cells"].get(cell["id"])
        if existing:
            if existing.get("requestSha256") != request_sha256:
                raise RuntimeError(f"idempotent submission mismatch for {cell['id']}")
            print(f"preserved {cell['id']} -> {existing['jobId']}")
            continue
        Path(requested["outputDir"]).mkdir(parents=True, exist_ok=True)
        command = [str(GREENROOM), "submit", campaign["fluxRoute"]["jobType"], requested["source"], requested["outputDir"], "--cwd", str(ROOT.parents[1])]
        command.extend(f"{key}={value}" for key, value in requested["params"].items())
        command.insert(7, "-p")
        try:
            completed = subprocess.run(command, check=True, capture_output=True, text=True)
            match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
            if not match:
                raise RuntimeError(f"Greenroom returned no job id: {completed.stdout}")
        except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
            failures[cell["id"]] = {"request": requested, "error": str(error)}
            write_json(FAILURE, {
                "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.submission-failure.v0",
                "phase": "greenroom-submission",
                "lastTrustworthyEvidence": submissions,
                "failures": failures,
                "recordedAt": time.time(),
            })
            print(f"submission failed for {cell['id']}; wrote {FAILURE}", file=sys.stderr)
            return 1
        submissions["cells"][cell["id"]] = {
            "jobId": match.group(1), "request": requested, "requestSha256": request_sha256,
        }
        write_json(SUBMISSIONS, submissions)
        print(f"submitted {cell['id']} -> {match.group(1)}")
    FAILURE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
