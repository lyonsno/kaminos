#!/usr/bin/env python3
"""Submit missing FLUX cells and preserve their Greenroom identities."""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = json.loads((ROOT / "campaign.json").read_text())
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
LEDGER = ROOT / "submission-ledger.json"


def load_ledger() -> dict:
    if LEDGER.exists():
        return json.loads(LEDGER.read_text())
    return {"campaign": CAMPAIGN["campaign"], "jobs": []}


def main() -> None:
    source = (ROOT / CAMPAIGN["source"]["path"]).resolve()
    prompts = {prompt["id"]: prompt for prompt in CAMPAIGN["prompts"]}
    route = CAMPAIGN["fluxRoute"]
    ledger = load_ledger()
    submitted = {(job["promptId"], job["seed"]) for job in ledger["jobs"]}

    for cell in CAMPAIGN["fluxCells"]:
        identity = (cell["promptId"], cell["seed"])
        output_dir = (ROOT / cell["outputDir"]).resolve()
        if identity in submitted or (output_dir / "output.png").exists():
            continue
        output_dir.mkdir(parents=True, exist_ok=True)
        prompt_path = (ROOT / prompts[cell["promptId"]]["path"]).resolve()
        command = [
            str(GREENROOM),
            "submit",
            route["jobType"],
            str(source),
            str(output_dir),
            "-p",
            f"prompt_file={prompt_path}",
            f"seed={cell['seed']}",
            f"width={route['dimensions'][0]}",
            f"height={route['dimensions'][1]}",
            f"steps={route['steps']}",
            f"guidance={route['guidance']}",
            f"model={route['model']}",
            f"quantize={route['quantize']}",
            f"mlx_cache_limit_gb={route['mlxCacheLimitGb']}",
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
                "outputDir": cell["outputDir"],
            }
        )
        LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")
        print(f"{cell['promptId']} seed {cell['seed']}: {match.group(1)}")


if __name__ == "__main__":
    main()
