#!/usr/bin/env python3
"""Build and validate the cycle-1/cycle-2 Trellis registration witness."""

import json
import subprocess
from pathlib import Path

from cycle2_contract import digest, validate_campaign, validate_registration_result


ROOT = Path(__file__).resolve().parent
BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")


def main() -> int:
    campaign = validate_campaign(ROOT)
    ledger = json.loads((ROOT / "reconstruction-ledger.json").read_text())
    moving = Path(ledger["routes"]["trellis"]["output"])
    moving_sha = ledger["routes"]["trellis"]["outputSha256"]
    if digest(moving) != moving_sha:
        raise RuntimeError("cycle-2 Trellis GLB drifted before registration")
    fixed = (ROOT / campaign["referenceCast"]["path"]).resolve()
    fixed_sha = campaign["referenceCast"]["sha256"]
    output = ROOT / "registration-result.json"
    blend = ROOT / "registration" / "cycle-1-cycle-2-registration.blend"
    command = [
        str(BLENDER),
        "--background",
        "--python",
        str(ROOT / "build_cycle2_registration.py"),
        "--",
        "--fixed-glb",
        str(fixed),
        "--fixed-sha256",
        fixed_sha,
        "--moving-glb",
        str(moving),
        "--moving-sha256",
        moving_sha,
        "--artifact-root",
        str(ROOT),
        "--output",
        str(output),
        "--blend-output",
        str(blend),
    ]
    subprocess.run(command, check=True)
    result = json.loads(output.read_text())
    validate_registration_result(result, ROOT)
    print("validated cycle-1/cycle-2 global-similarity registration")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
