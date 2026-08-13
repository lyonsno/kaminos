#!/usr/bin/env python3
"""Render every SF3D and Trellis cast through one matched orbit."""

import json
import subprocess
from pathlib import Path

from comparison_contract import digest, validate_complete_orbits


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
RENDERER = REPO / "artifacts/triradial-skeleton-proposal-fan-v0/trellis/render-glb-orbit.py"


def main() -> int:
    ledger = json.loads((ROOT / "comparison-ledger.json").read_text())
    for cell_id, cell in ledger["cells"].items():
        for route_id, route in cell["routes"].items():
            glb = Path(route["output"])
            if digest(glb) != route["outputSha256"]:
                raise RuntimeError(f"admitted GLB drifted: {cell_id}/{route_id}")
            orbit_root = ROOT / "renders" / cell_id / route_id
            orbit = orbit_root / "orbit"
            manifest = orbit_root / "orbit-manifest.json"
            command = [
                str(BLENDER), "--background", "--python", str(RENDERER), "--",
                "--glb", str(glb), "--expected-sha256", route["outputSha256"],
                "--out-dir", str(orbit), "--manifest", str(manifest),
                "--failure", str(orbit_root / "orbit-failure.json"),
                "--azimuths", "0,60,120,180,240,300", "--elevation", "12",
            ]
            subprocess.run(command, check=True)
            print(f"rendered {cell_id}/{route_id}")
    validate_complete_orbits(ROOT, ledger)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
