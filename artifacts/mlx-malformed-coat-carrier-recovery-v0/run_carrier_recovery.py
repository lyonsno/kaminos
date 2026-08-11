#!/usr/bin/env python3
"""Launch the malformed-coat carrier recovery assay through Blender."""

from pathlib import Path
import subprocess
import sys
import uuid


ROOT = Path(__file__).resolve().parent
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
sys.path.insert(0, str(ROOT))

from carrier_shell_recovery import prepare_run, validate_run_outputs  # noqa: E402


def main():
    if not BLENDER.is_file():
        raise SystemExit(f"Blender executable is missing: {BLENDER}")
    run_id = uuid.uuid4().hex
    prepare_run(ROOT, run_id=run_id)
    command = [
        str(BLENDER),
        "--background",
        "--factory-startup",
        "--python",
        str(ROOT / "run_carrier_recovery_blender.py"),
        "--",
        "--campaign",
        str(ROOT / "campaign.json"),
        "--output-root",
        str(ROOT),
        "--run-id",
        run_id,
    ]
    completed = subprocess.run(command, cwd=ROOT.parents[1], check=False)
    validate_run_outputs(ROOT, process_returncode=completed.returncode)


if __name__ == "__main__":
    main()
