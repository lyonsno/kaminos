"""Verify that every calibration cell ran the same route except image + prompt.

Reads Greenroom receipts only; runs no GPU workload. The matched-comparison
claim is only as good as this check: if any cell's effective route differs in
seed, model, quantization, steps, guidance, or resolution, the cell is not a
member of the comparison class and must not be published as one.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RECEIPTS = Path("/Users/noahlyons/.local/state/gpu-greenroom/done")
RUNNER_SUFFIX = "mflux-generate-" + "flux2-edit"

CELLS = {
    "b51c76f356d8": ("original", "clean-envelope.png"),
    "f10ee00d0c32": ("original", "mush-envelope.png"),
    "330e13ea196a": ("original", "blank-plate.png"),
    "348f925affb5": ("neutralized", "clean-envelope.png"),
    "a65236878e74": ("neutralized", "mush-envelope.png"),
    "c00f72346b82": ("neutralized", "blank-plate.png"),
}

FROZEN = {
    "seed": "--seed 80301",
    "model": "flux2-klein-9b",
    "quantize": "--quantize 4",
    "steps": "--steps 8",
    "guidance": "--guidance 1.0",
    "height": "--height 512",
    "width": "--width 512",
}


def main() -> int:
    clean = True
    for job_id, (prompt, image) in CELLS.items():
        receipt = json.loads((RECEIPTS / job_id / "receipt.json").read_text())
        route = receipt["effective_route"]
        problems = [name for name, token in FROZEN.items() if token not in route]
        if f"exterior-{prompt}.txt" not in route:
            problems.append("prompt-file")
        if image not in route:
            problems.append("input-image")
        if RUNNER_SUFFIX not in route:
            problems.append("runner")
        if receipt.get("exit_code") != 0:
            problems.append("exit-code")
        arm = image.split("-")[0]
        status = "OK" if not problems else "MISMATCH: " + ",".join(problems)
        print(f"{prompt:12s} {arm:6s} {job_id} {status}")
        if problems:
            clean = False
    print()
    print("ALL CELLS ROUTE-IDENTICAL EXCEPT IMAGE+PROMPT:", clean)
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
