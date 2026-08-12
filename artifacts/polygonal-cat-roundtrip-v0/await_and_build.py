#!/usr/bin/env python3
"""Await both routes, render complete orbits, and build the review sheet."""

import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FAILURE = ROOT / "completion-failure.json"


def run(script: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT)


def main() -> int:
    while True:
        collected = run("collect_reconstructions.py")
        if collected.returncode == 0:
            break
        if collected.returncode != 2:
            FAILURE.write_text(json.dumps({
                "schema": "kaminos.polygonal-cat-roundtrip.completion-failure.v0",
                "phase": "terminal-collection",
                "lastTrustworthyEvidence": "collection-state.json",
            }, indent=2) + "\n")
            return collected.returncode
        time.sleep(15)
    for phase, script in (("orbit-render", "render_orbits.py"), ("sheet-build", "build_sheet.py")):
        completed = run(script)
        if completed.returncode:
            FAILURE.write_text(json.dumps({
                "schema": "kaminos.polygonal-cat-roundtrip.completion-failure.v0",
                "phase": phase,
                "lastTrustworthyEvidence": "reconstruction-ledger.json",
            }, indent=2) + "\n")
            return completed.returncode
    FAILURE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
