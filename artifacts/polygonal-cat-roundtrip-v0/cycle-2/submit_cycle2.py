#!/usr/bin/env python3
"""Submit matched second-cycle SF3D and Trellis reconstructions idempotently."""

import json
import re
import subprocess
import tempfile
from pathlib import Path

from cycle2_contract import digest, validate_campaign


ROOT = Path(__file__).resolve().parent
SUBMISSIONS = ROOT / "submissions.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def main() -> int:
    campaign = validate_campaign(ROOT)
    source = (ROOT / campaign["source"]["path"]).resolve()
    state = (
        json.loads(SUBMISSIONS.read_text())
        if SUBMISSIONS.is_file()
        else {
            "schema": "kaminos.polygonal-cat-roundtrip.cycle-2.submissions.v0",
            "source": str(source),
            "sourceSha256": digest(source),
            "routes": {},
        }
    )
    if Path(state["source"]).resolve() != source or state["sourceSha256"] != digest(source):
        raise RuntimeError("existing cycle-2 submissions bind another source")
    for route in campaign["routes"]:
        route_id = route["id"]
        if route_id in state["routes"]:
            print(f"preserved {route_id} -> {state['routes'][route_id]['jobId']}")
            continue
        output_dir = (ROOT / "reconstructions" / route_id).resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        if (output_dir / "output.glb").exists():
            raise RuntimeError(f"unregistered output would confound submission: {output_dir}")
        command = [str(GREENROOM), "submit", route["jobType"], str(source), str(output_dir)]
        params = route.get("params") or {}
        if params:
            command.append("-p")
            command.extend(f"{key}={value}" for key, value in params.items())
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = re.search(r"Submitted job ([0-9a-f]{12})", completed.stdout)
        if not match:
            raise RuntimeError(f"Greenroom returned no job id: {completed.stdout!r}")
        state["routes"][route_id] = {
            "jobId": match.group(1),
            "jobType": route["jobType"],
            "outputDir": str(output_dir),
            "requestedParams": params,
            "requestedCommand": command,
        }
        atomic_json(SUBMISSIONS, state)
        print(f"submitted {route_id} -> {match.group(1)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
