#!/usr/bin/env python3
"""Render every available TRELLIS GLB through the proven six-view orbit."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from evidence_contract import write_failure_report


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SUBMISSIONS = ROOT / "trellis-submissions.json"
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
RENDERER = REPO / "artifacts/triradial-skeleton-proposal-fan-v0/trellis/render-glb-orbit.py"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    submissions = json.loads(SUBMISSIONS.read_text())
    rendered = 0
    unavailable = 0
    failures = {}
    for cell_id, submission in submissions["cells"].items():
        cell_dir = ROOT / submission["outputDir"]
        glb = cell_dir / "output.glb"
        if not glb.is_file() or glb.stat().st_size <= 4096:
            unavailable += 1
            failures[cell_id] = {"reason": "missing-or-blank-glb", "path": str(glb)}
            continue
        actual_sha = sha256(glb)
        manifest = cell_dir / "orbit-manifest.json"
        if manifest.is_file():
            prior = json.loads(manifest.read_text())
            if prior.get("status") == "completed" and prior.get("glb", {}).get("sha256") == actual_sha:
                print(f"preserved {cell_id}")
                continue
        command = [
            str(BLENDER),
            "--background",
            "--python",
            str(RENDERER),
            "--",
            "--glb",
            str(glb),
            "--expected-sha256",
            actual_sha,
            "--out-dir",
            str(cell_dir / "orbit"),
            "--manifest",
            str(manifest),
            "--failure",
            str(cell_dir / "orbit-failure.json"),
            "--azimuths",
            "0,60,120,180,240,300",
            "--elevation",
            "12",
        ]
        try:
            subprocess.run(command, check=True)
        except subprocess.CalledProcessError as error:
            failures[cell_id] = {"reason": "orbit-render-failed", "returnCode": error.returncode, "command": command}
            continue
        rendered += 1
        print(f"rendered {cell_id}")
    summary = {"renderedNow": rendered, "unavailable": unavailable, "total": len(submissions["cells"])}
    print(json.dumps(summary, indent=2))
    failure_report = ROOT / "orbit-failure-report.json"
    if failures:
        write_failure_report(
            failure_report,
            schema="kaminos.latest-envelope-basin-reconstruction.orbit-failure.v0",
            phase="orbit-input-and-render-validation",
            statuses=summary,
            failures=failures,
        )
        print(f"orbit rendering incomplete; wrote {failure_report}", file=sys.stderr)
        return 1
    failure_report.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
