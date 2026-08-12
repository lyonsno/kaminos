#!/usr/bin/env python3
"""Await terminal FLUX evidence, then build and validate the visual sheet."""

import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RETRY_SECONDS = 15
FAILURE = ROOT / "completion-failure.json"


def write_failure(phase: str, result: subprocess.CompletedProcess) -> None:
    FAILURE.write_text(
        json.dumps(
            {
                "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.completion-failure.v0",
                "phase": phase,
                "exitCode": result.returncode,
                "lastTrustworthyEvidence": {
                    "campaign": "campaign.json",
                    "submissions": "submissions.json",
                    "collectionState": "collection-state.json" if (ROOT / "collection-state.json").is_file() else None,
                    "resultLedger": "result-ledger.json" if (ROOT / "result-ledger.json").is_file() else None,
                },
            },
            indent=2,
        )
        + "\n"
    )


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=ROOT)


def main() -> int:
    while True:
        collected = run(str(ROOT / "collect_flux.py"))
        if collected.returncode == 0:
            break
        if collected.returncode != 2:
            write_failure("terminal-evidence-collection", collected)
            return collected.returncode
        time.sleep(RETRY_SECONDS)

    built = run(str(ROOT / "build_sheet.py"))
    if built.returncode != 0:
        write_failure("sheet-build", built)
        return built.returncode

    validated = run(
        "-m",
        "unittest",
        "discover",
        "-s",
        str(ROOT),
        "-p",
        "test_result_bundle.py",
        "-v",
    )
    if validated.returncode != 0:
        write_failure("completed-bundle-validation", validated)
        return validated.returncode

    FAILURE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
