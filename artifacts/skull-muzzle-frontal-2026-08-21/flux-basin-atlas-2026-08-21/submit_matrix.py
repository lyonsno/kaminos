#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path


JOB_ID_RE = re.compile(r"^Submitted job ([0-9a-f]+)$", re.MULTILINE)


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


def jobs_by_output(state_root: Path) -> dict[str, dict]:
    jobs = {}
    for state in ("pending", "running", "done", "failed", "cancelled"):
        state_dir = state_root / state
        if not state_dir.is_dir():
            continue
        for request_path in state_dir.glob("*/request.json"):
            request = json.loads(request_path.read_text())
            output_dir = request.get("output_dir")
            if output_dir:
                jobs[str(Path(output_dir).resolve())] = {
                    "job_id": request.get("job_id", request_path.parent.name),
                    "greenroom_state": state,
                    "submitted_at": request.get("submitted_at"),
                }
    return jobs


def write_failure(root: Path, phase: str, cell: dict, command: list[str], stdout: str, stderr: str) -> None:
    atomic_write(root / "submission-failure.json", {
        "schema": "kaminos.handy_candyman.flux_reconstruction_basin_submission_failure.v1",
        "failure_phase": phase,
        "cell": cell,
        "command": command,
        "stdout": stdout,
        "stderr": stderr,
        "recorded_at": time.time(),
    })


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, default=Path(__file__).with_name("matrix-plan.json"))
    parser.add_argument("--greenroom-repo", type=Path, default=Path("/Users/noahlyons/dev/gpu-greenroom"))
    parser.add_argument("--greenroom-state", type=Path, default=Path(os.environ.get("GPU_GREENROOM_DIR", "/Users/noahlyons/.local/state/gpu-greenroom")))
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
    queued_by_output = jobs_by_output(args.greenroom_state.expanduser().resolve())
    recovered = []
    for cell in cells:
        if cell["cell_id"] in existing:
            continue
        queued = queued_by_output.get(cell["output_dir"])
        if queued:
            recovered_cell = {**cell, **queued, "recovered_from_greenroom_state": True}
            recovered.append(recovered_cell)
            existing.add(cell["cell_id"])
    if recovered and not args.dry_run:
        receipt["cells"].extend(recovered)
        receipt.setdefault("recovery_events", []).append({
            "recovered_at": time.time(),
            "cell_count": len(recovered),
            "job_ids": [cell["job_id"] for cell in recovered],
            "reason": "Exact output directories existed in Greenroom state without local receipt rows.",
        })
        atomic_write(receipt_path, receipt)
    missing = [cell for cell in cells if cell["cell_id"] not in existing]
    print(f"validated {len(cells)} cells; {len(existing)} recorded or recovered; {len(missing)} missing")
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
        try:
            completed = subprocess.run(command, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            write_failure(root, "submit-command", cell, command, error.stdout or "", error.stderr or "")
            raise
        match = JOB_ID_RE.search(completed.stdout)
        if not match:
            write_failure(root, "submit-response-parse", cell, command, completed.stdout, completed.stderr)
            raise SystemExit(f"unrecognized Greenroom response: {completed.stdout!r}")
        receipt["cells"].append({**cell, "job_id": match.group(1), "submitted_at": time.time()})
        atomic_write(receipt_path, receipt)
        print(f"{cell['cell_id']}: {match.group(1)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
