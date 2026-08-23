#!/usr/bin/env python3
"""Submit and await the exact TRELLIS maquette seed assay through GPU Greenroom."""

from __future__ import annotations

import hashlib
import json
import re
import shlex
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PLAN_PATH = ROOT / "assay-plan.json"
START_RECEIPT = ROOT / "start-receipt.json"
TERMINAL_RECEIPT = ROOT / "terminal-receipt.json"
FAILURE = ROOT / "failure.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE_ROOT = Path("/Users/noahlyons/.local/state/gpu-greenroom")
JOB_STATES = ("pending", "running", "done", "failed", "cancelled")
TERMINAL_STATES = {"done", "failed", "cancelled"}
JOB_ID_RE = re.compile(r"Submitted job\s+(\S+)")


class AssayError(RuntimeError):
    def __init__(self, phase: str, detail: str):
        super().__init__(detail)
        self.phase = phase


def atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def job_path(job_id: str) -> tuple[str, Path] | None:
    for state in JOB_STATES:
        candidate = QUEUE_ROOT / state / job_id
        if candidate.is_dir():
            return state, candidate
    return None


def jobs_by_output() -> dict[str, list[tuple[str, Path, dict]]]:
    found: dict[str, list[tuple[str, Path, dict]]] = {}
    for state in JOB_STATES:
        state_dir = QUEUE_ROOT / state
        if not state_dir.is_dir():
            continue
        for request_path in state_dir.glob("*/request.json"):
            try:
                request = load_json(request_path)
            except (OSError, json.JSONDecodeError):
                continue
            output_dir = request.get("output_dir")
            if output_dir:
                found.setdefault(str(Path(output_dir).resolve()), []).append(
                    (state, request_path.parent, request)
                )
    return found


def expected_params(plan: dict, seed: int) -> dict[str, str]:
    route = plan["requested_route"]
    return {
        "seed": str(seed),
        "resolution": str(route["resolution"]),
        "steps": str(route["steps"]),
        "target_faces": str(route["target_faces"]),
        "texture_size": str(route["texture_size"]),
    }


def validate_request(request: dict, source: Path, output_dir: Path, params: dict[str, str], plan: dict) -> None:
    expected = {
        "job_type": plan["requested_route"]["job_type"],
        "input_path": str(source),
        "output_dir": str(output_dir),
        "params": params,
    }
    observed = {key: request.get(key) for key in expected}
    if observed != expected:
        raise AssayError(
            "existing-binding-mismatch",
            f"Existing Greenroom binding does not match requested cell: expected={expected!r} observed={observed!r}",
        )


def build_cells(plan: dict) -> list[dict]:
    cells: list[dict] = []
    for source_record in plan["sources"]:
        source = Path(source_record["path"])
        if not source.is_file():
            raise AssayError("source-validation", f"Missing source: {source}")
        observed_hash = sha256(source)
        if observed_hash != source_record["sha256"]:
            raise AssayError(
                "source-validation",
                f"Source hash drift for {source}: expected {source_record['sha256']} observed {observed_hash}",
            )
        for seed in source_record["reconstruction_seeds"]:
            output_dir = ROOT / source_record["source_id"] / f"trellis-{seed}"
            cells.append(
                {
                    "cell_id": f"{source_record['source_id']}-trellis-{seed}",
                    "source_id": source_record["source_id"],
                    "source_path": str(source),
                    "source_sha256": observed_hash,
                    "seed": seed,
                    "output_dir": str(output_dir),
                    "params": expected_params(plan, seed),
                }
            )
    return cells


def submit_missing(plan: dict, cells: list[dict]) -> dict:
    if START_RECEIPT.exists():
        receipt = load_json(START_RECEIPT)
        if receipt.get("assay_id") != plan["assay_id"]:
            raise AssayError("start-receipt-validation", "Existing start receipt belongs to another assay")
    else:
        receipt = {
            "assay_id": plan["assay_id"],
            "requested_route": plan["requested_route"],
            "claim_ceiling": plan["claim_ceiling"],
            "started_at": time.time(),
            "cells": [],
        }

    bound_by_cell = {cell["cell_id"]: cell for cell in receipt.get("cells", [])}
    queued = jobs_by_output()
    for cell in cells:
        source = Path(cell["source_path"])
        output_dir = Path(cell["output_dir"])
        binding = bound_by_cell.get(cell["cell_id"])
        if binding:
            located = job_path(binding["job_id"])
            if not located:
                raise AssayError("bound-job-missing", f"Bound job disappeared: {binding['job_id']}")
            request = load_json(located[1] / "request.json")
            validate_request(request, source, output_dir, cell["params"], plan)
            continue

        matches = queued.get(str(output_dir.resolve()), [])
        if len(matches) > 1:
            raise AssayError(
                "existing-binding-ambiguous",
                f"Multiple Greenroom jobs target the same exact output directory: {output_dir}",
            )
        if matches:
            state, job_dir, request = matches[0]
            validate_request(request, source, output_dir, cell["params"], plan)
            binding = {
                **cell,
                "job_id": request["job_id"],
                "submitted_at": request.get("submitted_at"),
                "recovered_from_greenroom_state": True,
                "state_at_binding": state,
            }
        else:
            output_dir.mkdir(parents=True, exist_ok=True)
            command = [
                str(GREENROOM),
                "submit",
                plan["requested_route"]["job_type"],
                str(source),
                str(output_dir),
                "-p",
                *[f"{key}={value}" for key, value in cell["params"].items()],
            ]
            completed = subprocess.run(command, capture_output=True, text=True)
            if completed.returncode != 0:
                raise AssayError(
                    "greenroom-submit",
                    f"Submit failed for {cell['cell_id']}: stdout={completed.stdout!r} stderr={completed.stderr!r}",
                )
            match = JOB_ID_RE.search(completed.stdout)
            if not match:
                raise AssayError(
                    "greenroom-submit-response",
                    f"Could not parse job id for {cell['cell_id']}: {completed.stdout!r}",
                )
            binding = {
                **cell,
                "job_id": match.group(1),
                "submitted_at": time.time(),
                "submit_stdout": completed.stdout.strip(),
                "submit_stderr": completed.stderr.strip(),
                "recovered_from_greenroom_state": False,
            }
        receipt["cells"].append(binding)
        bound_by_cell[cell["cell_id"]] = binding
        atomic_write(START_RECEIPT, receipt)
        print(f"bound {cell['cell_id']} -> {binding['job_id']}", flush=True)

    receipt["all_cells_bound_at"] = time.time()
    atomic_write(START_RECEIPT, receipt)
    return receipt


def wait_for_terminal(start_receipt: dict) -> dict[str, tuple[str, Path]]:
    while True:
        located: dict[str, tuple[str, Path]] = {}
        states: dict[str, str] = {}
        for cell in start_receipt["cells"]:
            current = job_path(cell["job_id"])
            if not current:
                raise AssayError("bound-job-missing", f"Bound job disappeared: {cell['job_id']}")
            located[cell["cell_id"]] = current
            states[cell["cell_id"]] = current[0]
        if all(state in TERMINAL_STATES for state in states.values()):
            return located
        time.sleep(10)


def validate_effective_route(cell: dict, receipt: dict, plan: dict) -> list[str]:
    effective = receipt.get("effective_route")
    if not effective:
        raise AssayError("effective-route-validation", f"Missing effective route for {cell['cell_id']}")
    tokens = shlex.split(effective)
    required_pairs = {
        "--image": cell["source_path"],
        "--output": str(Path(cell["output_dir"]) / "output.glb"),
        "--seed": str(cell["seed"]),
        "--resolution": str(plan["requested_route"]["resolution"]),
        "--steps": str(plan["requested_route"]["steps"]),
        "--target-faces": str(plan["requested_route"]["target_faces"]),
        "--texture-size": str(plan["requested_route"]["texture_size"]),
    }
    for option, value in required_pairs.items():
        try:
            index = tokens.index(option)
        except ValueError as error:
            raise AssayError("effective-route-validation", f"{cell['cell_id']} omitted {option}: {effective}") from error
        if index + 1 >= len(tokens) or tokens[index + 1] != value:
            raise AssayError(
                "effective-route-validation",
                f"{cell['cell_id']} effective {option} mismatch: expected {value!r} route={effective!r}",
            )
    for flag in ("--no-cascade", "--simplify-first", "--save-checkpoints"):
        if flag not in tokens:
            raise AssayError("effective-route-validation", f"{cell['cell_id']} omitted {flag}: {effective}")
    return tokens


def collect_terminal(plan: dict, start_receipt: dict, located: dict[str, tuple[str, Path]]) -> dict:
    terminal_cells: list[dict] = []
    failed: list[str] = []
    for cell in start_receipt["cells"]:
        state, job_dir = located[cell["cell_id"]]
        receipt_path = job_dir / "receipt.json"
        status_path = job_dir / "status.json"
        if not receipt_path.is_file() or not status_path.is_file():
            raise AssayError(
                "greenroom-terminal-evidence",
                f"Terminal job lacks receipt or status: {cell['job_id']} state={state}",
            )
        receipt = load_json(receipt_path)
        status = load_json(status_path)
        if state != "done" or receipt.get("exit_code") != 0 or receipt.get("failure_phase") is not None:
            failed.append(cell["cell_id"])
        if state == "done":
            validate_effective_route(cell, receipt, plan)
        output_dir = Path(cell["output_dir"])
        evidence_dir = output_dir / "greenroom-receipt"
        evidence_dir.mkdir(parents=True, exist_ok=True)
        for name in ("request.json", "status.json", "receipt.json", "stdout.log", "stderr.log"):
            source_file = job_dir / name
            if source_file.is_file():
                shutil.copy2(source_file, evidence_dir / name)
        glb = output_dir / "output.glb"
        if state == "done" and (not glb.is_file() or glb.stat().st_size == 0):
            raise AssayError("primary-output-validation", f"Done job has missing or blank GLB: {glb}")
        terminal_cells.append(
            {
                "cell_id": cell["cell_id"],
                "source_id": cell["source_id"],
                "source_path": cell["source_path"],
                "source_sha256": cell["source_sha256"],
                "seed": cell["seed"],
                "job_id": cell["job_id"],
                "terminal_state": state,
                "requested_route": plan["requested_route"],
                "effective_route": receipt.get("effective_route"),
                "effective_backend": "trellis2mlx native MLX" if "trellis2mlx" in (receipt.get("effective_route") or "") else None,
                "submitted_at": receipt.get("submitted_at", status.get("submitted_at")),
                "started_at": receipt.get("started_at"),
                "finished_at": receipt.get("finished_at"),
                "queue_seconds": (
                    receipt.get("started_at") - status.get("submitted_at")
                    if receipt.get("started_at") is not None and status.get("submitted_at") is not None
                    else None
                ),
                "run_seconds": (
                    receipt.get("finished_at") - receipt.get("started_at")
                    if receipt.get("finished_at") is not None and receipt.get("started_at") is not None
                    else None
                ),
                "exit_code": receipt.get("exit_code"),
                "failure_phase": receipt.get("failure_phase"),
                "warnings": receipt.get("warnings", []),
                "output_glb": str(glb),
                "output_glb_bytes": glb.stat().st_size if glb.is_file() else None,
                "output_glb_sha256": sha256(glb) if glb.is_file() else None,
                "greenroom_receipt_dir": str(evidence_dir),
            }
        )
    if failed:
        raise AssayError("greenroom-terminal-failure", f"Terminal cells did not succeed: {failed}")
    return {
        "assay_id": plan["assay_id"],
        "status": "done",
        "requested_route": plan["requested_route"],
        "claim_ceiling": plan["claim_ceiling"],
        "started_at": start_receipt["started_at"],
        "finished_at": time.time(),
        "cell_count": len(terminal_cells),
        "cells": terminal_cells,
        "next_evidence": "Direct operator-facing front, profile, and unseen-side orbit inspection of each GLB before promotion.",
    }


def write_failure(error: BaseException) -> None:
    phase = error.phase if isinstance(error, AssayError) else "runner-exception"
    payload = {
        "assay_id": "trellis-maquette-seed-assay-2026-08-22",
        "status": "failed",
        "failure_phase": phase,
        "error_type": type(error).__name__,
        "error_message": str(error),
        "failed_at": time.time(),
        "start_receipt": str(START_RECEIPT) if START_RECEIPT.exists() else None,
        "last_trustworthy_evidence": "Bound Greenroom job identities in start-receipt.json" if START_RECEIPT.exists() else "Source and plan validation only",
        "traceback": traceback.format_exc(),
    }
    atomic_write(FAILURE, payload)


def main() -> int:
    if TERMINAL_RECEIPT.exists():
        terminal = load_json(TERMINAL_RECEIPT)
        if terminal.get("status") != "done":
            raise AssayError("terminal-receipt-validation", "Existing terminal receipt is not successful")
        print(json.dumps(terminal, indent=2))
        return 0
    plan = load_json(PLAN_PATH)
    cells = build_cells(plan)
    expected_count = sum(len(source["reconstruction_seeds"]) for source in plan["sources"])
    if len(cells) != expected_count:
        raise AssayError("plan-validation", f"Expanded {len(cells)} cells but plan declares {expected_count}")
    start_receipt = submit_missing(plan, cells)
    if len(start_receipt["cells"]) != expected_count:
        raise AssayError("binding-validation", "Not every planned cell has an exact Greenroom binding")
    located = wait_for_terminal(start_receipt)
    terminal = collect_terminal(plan, start_receipt, located)
    atomic_write(TERMINAL_RECEIPT, terminal)
    if FAILURE.exists():
        FAILURE.unlink()
    print(json.dumps(terminal, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BaseException as error:
        if isinstance(error, KeyboardInterrupt):
            raise
        write_failure(error)
        raise
