#!/usr/bin/env python3
"""Submit the frozen Trellis-to-FLUX matched cell exactly once."""

import json
import re
import subprocess
import tempfile
from pathlib import Path

from roundtrip_contract import validate_second_pass


ROOT = Path(__file__).resolve().parent
SUBMISSION = ROOT / "second-pass-submission.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def main() -> int:
    validated = validate_second_pass(ROOT)
    cell = validated["cell"]
    if SUBMISSION.is_file():
        existing = json.loads(SUBMISSION.read_text())
        if existing.get("cellId") != cell["id"]:
            raise RuntimeError("existing submission belongs to another cell")
        print(json.dumps(existing, indent=2))
        return 0

    source = (ROOT / cell["input"]).resolve()
    prompt = (ROOT / cell["promptFile"]).resolve()
    output_dir = (ROOT / cell["outputDir"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    command = [
        str(GREENROOM),
        "submit",
        cell["jobType"],
        str(source),
        str(output_dir),
        "-p",
        f"prompt_file={prompt}",
        f"seed={cell['seed']}",
        f"model={cell['model']}",
        f"quantize={cell['quantize']}",
        f"width={cell['width']}",
        f"height={cell['height']}",
        f"steps={cell['steps']}",
        f"guidance={cell['guidance']}",
        f"mlx_cache_limit_gb={cell['mlxCacheLimitGb']}",
    ]
    submitted = subprocess.run(command, check=True, text=True, capture_output=True)
    match = re.search(r"Submitted job ([0-9a-f]{12})", submitted.stdout)
    if not match:
        raise RuntimeError(f"Greenroom did not return a job id: {submitted.stdout!r}")
    record = {
        "schema": "kaminos.polygonal-cat-roundtrip.second-pass-submission.v0",
        "cellId": cell["id"],
        "jobId": match.group(1),
        "jobType": cell["jobType"],
        "input": str(source),
        "promptFile": str(prompt),
        "seed": cell["seed"],
        "outputDir": str(output_dir),
        "queueRoot": "/Users/noahlyons/.local/state/gpu-greenroom",
    }
    atomic_json(SUBMISSION, record)
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
