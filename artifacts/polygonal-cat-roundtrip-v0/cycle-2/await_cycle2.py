#!/usr/bin/env python3
"""Await exact reconstructions and complete every visual evidence phase."""

import json
import subprocess
import sys
import time
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FAILURE = ROOT / "cycle-2-failure.json"


def run(script: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT)


def write_failure(phase: str, evidence: str, returncode: int | None = None) -> None:
    FAILURE.write_text(
        json.dumps(
            {
                "schema": "kaminos.polygonal-cat-roundtrip.cycle-2.failure.v0",
                "phase": phase,
                "returnCode": returncode,
                "traceback": traceback.format_exc() if sys.exc_info()[0] else None,
                "lastTrustworthyEvidence": evidence,
            },
            indent=2,
        )
        + "\n"
    )


def main() -> int:
    try:
        while True:
            collected = run("collect_cycle2.py")
            if collected.returncode == 0:
                break
            if collected.returncode != 2:
                write_failure("terminal-admission", "submissions.json", collected.returncode)
                return collected.returncode
            time.sleep(15)
        phases = (
            ("orbit-render", "render_cycle2_orbits.py", "reconstruction-ledger.json"),
            ("global-registration", "run_cycle2_registration.py", "reconstruction-ledger.json"),
            ("sheet-build", "build_cycle2_sheet.py", "registration-result.json"),
        )
        for phase, script, evidence in phases:
            completed = run(script)
            if completed.returncode:
                write_failure(phase, evidence, completed.returncode)
                return completed.returncode
        FAILURE.unlink(missing_ok=True)
        return 0
    except Exception:
        write_failure("completion-supervisor", "collection-state.json")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
