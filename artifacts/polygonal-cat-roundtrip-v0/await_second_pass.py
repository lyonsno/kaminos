#!/usr/bin/env python3
"""Wait for the exact FLUX cell, admit it, and build the visual evidence sheet."""

import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FAILURE = ROOT / "second-pass-failure.json"


def run(script: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT)


def main() -> int:
    while True:
        collected = run("collect_second_pass.py")
        if collected.returncode == 0:
            break
        if collected.returncode != 2:
            FAILURE.write_text(json.dumps({
                "schema": "kaminos.polygonal-cat-roundtrip.second-pass-failure.v0",
                "phase": "result-admission",
                "lastTrustworthyEvidence": "second-pass-submission.json",
            }, indent=2) + "\n")
            return collected.returncode
        time.sleep(15)
    built = run("build_second_pass_sheet.py")
    if built.returncode:
        FAILURE.write_text(json.dumps({
            "schema": "kaminos.polygonal-cat-roundtrip.second-pass-failure.v0",
            "phase": "sheet-build",
            "lastTrustworthyEvidence": "second-pass-result.json",
        }, indent=2) + "\n")
        return built.returncode
    FAILURE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
