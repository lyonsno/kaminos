#!/usr/bin/env python3
"""Await Greenroom terminality, render all casts, and build the comparison."""

import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FAILURE = ROOT / "completion-failure.json"


def run(script: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT)


def fail(phase: str, last_evidence: str, returncode: int) -> int:
    FAILURE.write_text(json.dumps({
        "schema": "kaminos.representative-sf3d-comparison.completion-failure.v0",
        "phase": phase,
        "lastTrustworthyEvidence": last_evidence,
        "returncode": returncode,
    }, indent=2) + "\n")
    return returncode


def main() -> int:
    while True:
        collected = run("collect_results.py")
        if collected.returncode == 0:
            break
        if collected.returncode != 2:
            return fail("terminal-collection", "collection-state.json", collected.returncode)
        time.sleep(10)
    for phase, script, evidence in (
        ("orbit-render", "render_orbits.py", "comparison-ledger.json"),
        ("sheet-build", "build_sheet.py", "comparison-ledger.json"),
    ):
        completed = run(script)
        if completed.returncode:
            return fail(phase, evidence, completed.returncode)
    FAILURE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
