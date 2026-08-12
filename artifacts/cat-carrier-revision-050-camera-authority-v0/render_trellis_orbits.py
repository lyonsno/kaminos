#!/usr/bin/env python3
"""Render the six authenticated revision-050 Trellis casts through one orbit."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
LEDGER = ROOT / "trellis-result-ledger.json"
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
RENDERER = REPO / "artifacts/triradial-skeleton-proposal-fan-v0/trellis/render-glb-orbit.py"
FAILURE = ROOT / "trellis-orbit-state.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def orbit_is_current(manifest_path: Path, glb: Path) -> bool:
    if not manifest_path.is_file() or not glb.is_file():
        return False
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    outputs = manifest.get("outputs") or []
    return (
        manifest.get("status") == "completed"
        and manifest.get("glb", {}).get("sha256") == digest(glb)
        and len(outputs) == 6
        and all(
            Path(row.get("path", "")).is_file()
            and row.get("sha256") == digest(Path(row["path"]))
            for row in outputs
        )
    )


def main() -> int:
    ledger = json.loads(LEDGER.read_text())
    failures = {}
    rendered = 0
    preserved = 0
    for cell_id, record in ledger["cells"].items():
        glb = (ROOT / record["output"]).resolve()
        if not glb.is_file() or digest(glb) != record["outputSha256"]:
            failures[cell_id] = {"phase": "source-admission", "error": "GLB missing or stale"}
            continue
        manifest = glb.parent / "orbit-manifest.json"
        if orbit_is_current(manifest, glb):
            preserved += 1
            continue
        command = [
            str(BLENDER), "--background", "--python", str(RENDERER), "--",
            "--glb", str(glb), "--expected-sha256", record["outputSha256"],
            "--out-dir", str(glb.parent / "orbit"), "--manifest", str(manifest),
            "--failure", str(glb.parent / "orbit-failure.json"),
            "--azimuths", "0,60,120,180,240,300", "--elevation", "12",
        ]
        completed = subprocess.run(command, text=True, capture_output=True)
        if completed.returncode != 0 or not orbit_is_current(manifest, glb):
            failures[cell_id] = {
                "phase": "orbit-render", "returnCode": completed.returncode,
                "stdout": completed.stdout, "stderr": completed.stderr,
            }
            continue
        rendered += 1
        print(f"rendered {cell_id}")
    summary = {
        "schema": "kaminos.cat-carrier-revision-050.trellis-orbit-state.v0",
        "phase": "completed" if not failures else "orbit-render",
        "renderedNow": rendered, "preservedCurrent": preserved,
        "total": len(ledger["cells"]), "failures": failures,
    }
    if failures:
        write_json(FAILURE, summary)
        print(json.dumps(summary, indent=2), file=sys.stderr)
        return 1
    FAILURE.unlink(missing_ok=True)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
