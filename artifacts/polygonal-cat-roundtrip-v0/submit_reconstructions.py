#!/usr/bin/env python3
"""Submit exact-source SF3D and Trellis reconstructions idempotently."""

import json
import re
import subprocess
from pathlib import Path

from roundtrip_contract import digest


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SUBMISSIONS = ROOT / "submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    campaign = json.loads(CAMPAIGN.read_text())
    source = (ROOT / campaign["source"]["path"]).resolve()
    if digest(source) != campaign["source"]["sha256"]:
        raise RuntimeError("polygonal-cat source drifted")
    state = json.loads(SUBMISSIONS.read_text()) if SUBMISSIONS.exists() else {
        "schema": "kaminos.polygonal-cat-roundtrip.submissions.v0",
        "source": str(source),
        "sourceSha256": digest(source),
        "routes": {},
    }
    for route in campaign["routes"]:
        route_id = route["id"]
        if route_id in state["routes"]:
            print(f"preserved {route_id} -> {state['routes'][route_id]['jobId']}")
            continue
        output_dir = (ROOT / "reconstructions" / route_id).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        if (output_dir / "output.glb").exists():
            raise RuntimeError(
                f"unregistered output would confound a new submission: {output_dir}"
            )
        command = [
            str(GREENROOM), "submit", route["jobType"], str(source), str(output_dir)
        ]
        params = route.get("params") or {}
        if params:
            command.append("-p")
            command.extend(f"{key}={value}" for key, value in params.items())
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id: {completed.stdout}")
        state["routes"][route_id] = {
            "jobId": match.group(1),
            "jobType": route["jobType"],
            "outputDir": str(output_dir),
            "requestedParams": params,
            "requestedCommand": command,
        }
        write_json(SUBMISSIONS, state)
        print(f"submitted {route_id} -> {match.group(1)}")


if __name__ == "__main__":
    main()
