#!/usr/bin/env python3
"""Await Trellis jobs, render casts, build the sheet, and validate the bundle."""

import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RETRY_SECONDS = 15
FAILURE = ROOT / "trellis-completion-failure.json"


def write_failure(phase: str, result: subprocess.CompletedProcess) -> None:
    FAILURE.write_text(json.dumps({
        "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.trellis-completion-failure.v0",
        "phase": phase,
        "exitCode": result.returncode,
        "lastTrustworthyEvidence": {
            "selection": "trellis-selection.json",
            "submissions": "trellis-submissions.json",
            "collectionState": "trellis-collection-state.json" if (ROOT / "trellis-collection-state.json").is_file() else None,
            "resultLedger": "trellis-result-ledger.json" if (ROOT / "trellis-result-ledger.json").is_file() else None,
            "orbitState": "trellis-orbit-state.json" if (ROOT / "trellis-orbit-state.json").is_file() else None,
        },
    }, indent=2) + "\n")


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=ROOT)


def main() -> int:
    while True:
        collected = run(str(ROOT / "collect_trellis.py"))
        if collected.returncode == 0:
            break
        if collected.returncode != 2:
            write_failure("terminal-evidence-collection", collected)
            return collected.returncode
        time.sleep(RETRY_SECONDS)
    for phase, script in (
        ("orbit-render", "render_trellis_orbits.py"),
        ("sheet-build", "build_trellis_sheet.py"),
    ):
        result = run(str(ROOT / script))
        if result.returncode != 0:
            write_failure(phase, result)
            return result.returncode
    validated = run(
        "-m", "unittest", "discover", "-s", str(ROOT),
        "-p", "test_trellis_result_bundle.py", "-v",
    )
    if validated.returncode != 0:
        write_failure("completed-bundle-validation", validated)
        return validated.returncode
    FAILURE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
