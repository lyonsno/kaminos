#!/usr/bin/env python3
"""Submit visually admitted FLUX outputs to the proven Trellis route."""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ADMISSION = json.loads((ROOT / "visual-admission.json").read_text())
FLUX = json.loads((ROOT / "flux-results.json").read_text())
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
LEDGER = ROOT / "trellis-submission-ledger.json"


def main() -> None:
    outputs = {
        (cell["promptId"], cell["seed"]): cell["outputPath"]
        for cell in FLUX["cells"]
    }
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else {
        "campaign": ADMISSION["campaign"],
        "jobs": [],
    }
    submitted = {(job["promptId"], job["seed"]) for job in ledger["jobs"]}
    for cell in ADMISSION["cells"]:
        if not cell["promotedToTrellis"]:
            continue
        identity = (cell["promptId"], cell["seed"])
        if identity in submitted:
            continue
        input_path = ROOT / outputs[identity]
        output_dir = ROOT / "trellis" / f"{cell['promptId']}-seed{cell['seed']}"
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(GREENROOM), "submit", "trellis2mlx_fast",
            str(input_path), str(output_dir), "-p", f"seed={cell['seed']}",
        ]
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        match = re.search(r"^Submitted job ([0-9a-f]+)$", result.stdout, re.MULTILINE)
        if not match:
            raise RuntimeError(f"Greenroom returned no job identity:\n{result.stdout}")
        ledger["jobs"].append(
            {
                "promptId": cell["promptId"],
                "seed": cell["seed"],
                "jobId": match.group(1),
                "inputPath": outputs[identity],
                "outputDir": str(output_dir.relative_to(ROOT)),
            }
        )
        LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")
        print(f"{cell['promptId']} seed {cell['seed']}: {match.group(1)}")


if __name__ == "__main__":
    main()
