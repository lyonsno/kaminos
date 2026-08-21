#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path


JOB_ID_RE = re.compile(r"^Submitted job ([0-9a-f]+)$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=Path(__file__).with_name("matrix-plan.json"))
    parser.add_argument("--greenroom-repo", type=Path, default=Path("/Users/noahlyons/dev/gpu-greenroom"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    plan_path = args.plan.resolve()
    root = plan_path.parent
    plan = json.loads(plan_path.read_text())
    source = (root / plan["source"]["path"]).resolve()
    if sha256(source) != plan["source"]["sha256"]:
        raise SystemExit(f"source digest mismatch: {source}")

    route = plan["requested_route"]
    cells = []
    for wave in plan["waves"]:
        for seed in wave["seeds"]:
            for prompt in plan["prompts"]:
                prompt_path = (root / prompt["file"]).resolve()
                if not prompt_path.is_file():
                    raise SystemExit(f"missing prompt: {prompt_path}")
                cells.append({
                    "cell_id": f"{wave['id']}/seed-{seed}/{prompt['id']}",
                    "wave": wave["id"],
                    "seed": seed,
                    "prompt_id": prompt["id"],
                    "prompt_path": str(prompt_path),
                    "prompt_sha256": sha256(prompt_path),
                    "output_dir": str((root / wave["id"] / f"seed-{seed}" / prompt["id"]).resolve()),
                })

    receipt_path = root / "start-receipt.json"
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
    else:
        receipt = {
            "schema": "kaminos.handy_candyman.flux_reconstruction_basin_start.v1",
            "plan": str(plan_path),
            "source": str(source),
            "source_sha256": plan["source"]["sha256"],
            "requested_route": route,
            "completion_delivery": plan["completion_delivery"],
            "expected_cell_count": len(cells),
            "submitted_at": time.time(),
            "cells": [],
        }

    existing = {cell["cell_id"] for cell in receipt["cells"]}
    missing = [cell for cell in cells if cell["cell_id"] not in existing]
    print(f"validated {len(cells)} cells; {len(existing)} recorded; {len(missing)} missing")
    if args.dry_run:
        return 0

    for cell in missing:
        output_dir = Path(cell["output_dir"])
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            "uv", "run", "--project", str(args.greenroom_repo), "gpu-greenroom", "submit",
            route["job_type"], str(source), str(output_dir), "-p",
            f"prompt_file={cell['prompt_path']}",
            f"model={route['model']}",
            f"quantize={route['quantize']}",
            f"height={route['height']}",
            f"width={route['width']}",
            f"steps={route['steps']}",
            f"guidance={route['guidance']}",
            f"seed={cell['seed']}",
            f"mlx_cache_limit_gb={route['mlx_cache_limit_gb']}",
        ]
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        match = JOB_ID_RE.match(completed.stdout.strip())
        if not match:
            raise SystemExit(f"unrecognized Greenroom response: {completed.stdout!r}")
        receipt["cells"].append({**cell, "job_id": match.group(1), "submitted_at": time.time()})
        atomic_write(receipt_path, receipt)
        print(f"{cell['cell_id']}: {match.group(1)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
