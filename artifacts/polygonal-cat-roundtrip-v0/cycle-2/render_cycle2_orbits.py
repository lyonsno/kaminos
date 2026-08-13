#!/usr/bin/env python3
"""Render both admitted second-cycle casts through one matched orbit."""

import json
import subprocess
from pathlib import Path

from cycle2_contract import digest


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
RENDERER = REPO / "artifacts/triradial-skeleton-proposal-fan-v0/trellis/render-glb-orbit.py"


def main() -> int:
    ledger = json.loads((ROOT / "reconstruction-ledger.json").read_text())
    for route_id, row in ledger["routes"].items():
        glb = Path(row["output"])
        if digest(glb) != row["outputSha256"]:
            raise RuntimeError(f"admitted GLB drifted before orbit render: {route_id}")
        route_root = ROOT / "reconstructions" / route_id
        orbit = route_root / "orbit"
        manifest = route_root / "orbit-manifest.json"
        command = [
            str(BLENDER),
            "--background",
            "--python",
            str(RENDERER),
            "--",
            "--glb",
            str(glb),
            "--expected-sha256",
            row["outputSha256"],
            "--out-dir",
            str(orbit),
            "--manifest",
            str(manifest),
            "--failure",
            str(route_root / "orbit-failure.json"),
            "--azimuths",
            "0,60,120,180,240,300",
            "--elevation",
            "12",
        ]
        subprocess.run(command, check=True)
        rendered = json.loads(manifest.read_text())
        if rendered.get("status") != "completed" or len(rendered.get("outputs", [])) != 6:
            raise RuntimeError(f"incomplete orbit: {route_id}")
        print(f"rendered {route_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
