#!/usr/bin/env python3
"""Launch final static-groom generation for the visually selected carrier."""

from pathlib import Path
import subprocess
import sys
import uuid


ROOT = Path(__file__).resolve().parent
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
sys.path.insert(0, str(ROOT))

from carrier_shell_recovery import prepare_run, validate_run_outputs  # noqa: E402


def main():
    run_id = uuid.uuid4().hex
    prepare_run(
        ROOT,
        run_id=run_id,
        result_name="final-result.json",
        failure_name="finalize-failure.json",
        request_name="finalize-run-request.json",
    )
    command = [
        str(BLENDER),
        "--background",
        "--factory-startup",
        "--python",
        str(ROOT / "run_finalize_groom_blender.py"),
        "--",
        "--output-root",
        str(ROOT),
        "--run-id",
        run_id,
    ]
    completed = subprocess.run(command, cwd=ROOT.parents[1], check=False)
    validate_run_outputs(
        ROOT,
        process_returncode=completed.returncode,
        result_name="final-result.json",
        failure_name="finalize-failure.json",
        request_name="finalize-run-request.json",
    )


if __name__ == "__main__":
    main()
