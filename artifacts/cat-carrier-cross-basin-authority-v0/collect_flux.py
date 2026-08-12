#!/usr/bin/env python3
"""Collect terminal outputs and authenticate the effective Flux route."""

import hashlib
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SUBMISSIONS = ROOT / "submissions.json"
LEDGER = ROOT / "result-ledger.json"
STATE_REPORT = ROOT / "collection-state.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as stream:
            header = stream.read(24)
        if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
            return None
        return struct.unpack(">II", header[16:24])
    except OSError:
        return None


def validate_output(path: Path, expected_size: tuple[int, int]) -> list[str]:
    errors = []
    if not path.is_file():
        return [f"primary output is missing: {path}"]
    if path.stat().st_size <= 1024:
        errors.append(f"primary output is suspiciously small: {path.stat().st_size} bytes")
    dimensions = png_dimensions(path)
    if dimensions != expected_size:
        errors.append(f"primary output dimensions are {dimensions}, expected {expected_size}")
    return errors


def validate_status(status: dict, expected: dict) -> list[str]:
    errors = []
    if status.get("status") != "done":
        errors.append(f"status is {status.get('status')}, expected done")
    if status.get("exit_code") != 0:
        errors.append(f"exit code is {status.get('exit_code')}, expected 0")
    if status.get("job_type") != expected["jobType"]:
        errors.append(f"job type is {status.get('job_type')}, expected {expected['jobType']}")
    params = status.get("params") or {}
    expected_params = {
        "prompt_file": expected["promptFile"],
        "seed": str(expected["seed"]),
        "model": str(expected["model"]),
        "quantize": str(expected["quantize"]),
        "width": str(expected["width"]),
        "height": str(expected["height"]),
        "steps": str(expected["steps"]),
        "guidance": str(expected["guidance"]),
        "mlx_cache_limit_gb": str(expected["mlxCacheLimitGb"]),
    }
    for key, value in expected_params.items():
        if params.get(key) != value:
            errors.append(f"parameter {key} is {params.get(key)!r}, expected {value!r}")
    route = status.get("effective_route") or ""
    route_tokens = [
        "mflux-generate-flux2-edit",
        expected["source"],
        expected["promptFile"],
        expected["output"],
        f"--seed {expected['seed']}",
        f"--model {expected['model']}",
        f"--steps {expected['steps']}",
        f"--guidance {expected['guidance']}",
    ]
    if any(token not in route for token in route_tokens):
        errors.append("effective route does not bind the expected executable, source, prompt, output, seed, model, steps, and guidance")
    return errors


def greenroom_status(job_id: str) -> dict:
    completed = subprocess.run([str(GREENROOM), "status", job_id], check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


def canonical_job_dir(job_id: str) -> Path:
    for bucket in ("done", "failed", "cancelled", "running", "pending"):
        candidate = QUEUE / bucket / job_id
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"canonical Greenroom job directory missing for {job_id}")


def main() -> int:
    campaign = json.loads(CAMPAIGN.read_text())
    submissions = json.loads(SUBMISSIONS.read_text())
    expected_ids = {cell["id"] for cell in campaign["cells"]}
    if set(submissions.get("cells", {})) != expected_ids:
        raise RuntimeError(f"submission ledger does not cover the frozen {len(expected_ids)}-cell campaign")

    statuses = {cell_id: greenroom_status(entry["jobId"]) for cell_id, entry in submissions["cells"].items()}
    incomplete = {cell_id: status.get("status") for cell_id, status in statuses.items() if status.get("status") not in {"done", "failed", "cancelled"}}
    if incomplete:
        write_json(STATE_REPORT, {
            "schema": "kaminos.cat-carrier-cross-basin-authority.collection-state.v0",
            "phase": "awaiting-terminal-greenroom-jobs",
            "lastTrustworthyEvidence": statuses,
            "incomplete": incomplete,
        })
        print(json.dumps({"terminal": len(statuses) - len(incomplete), "total": len(statuses), "incomplete": incomplete}, indent=2))
        return 2

    route = campaign["fluxRoute"]
    failures = {}
    ledger = {
        "schema": "kaminos.cat-carrier-cross-basin-authority.results.v0",
        "campaign": "campaign.json",
        "cells": {},
    }
    for cell in campaign["cells"]:
        cell_id = cell["id"]
        submission = submissions["cells"][cell_id]
        status = statuses[cell_id]
        source = str((ROOT / campaign["sources"][cell["sourceId"]]["plate"]).resolve())
        prompt_file = str((ROOT / cell["promptFile"]).resolve())
        output = (ROOT / cell["outputDir"] / "output.png").resolve()
        expected = {
            "jobType": route["jobType"],
            "source": source,
            "promptFile": prompt_file,
            "output": str(output),
            "seed": cell["seed"],
            "model": route["model"],
            "quantize": route["quantize"],
            "width": route["width"],
            "height": route["height"],
            "steps": route["steps"],
            "guidance": route["guidance"],
            "mlxCacheLimitGb": route["mlxCacheLimitGb"],
        }
        errors = validate_status(status, expected)
        errors.extend(validate_output(output, (route["width"], route["height"])))
        if status.get("input_path") != source:
            errors.append(f"effective input is {status.get('input_path')}, expected {source}")
        evidence_dir = ROOT / "receipts" / cell_id
        try:
            canonical = canonical_job_dir(submission["jobId"])
            evidence_dir.mkdir(parents=True, exist_ok=True)
            for name in ("request.json", "status.json", "receipt.json", "stdout.log", "stderr.log"):
                evidence = canonical / name
                if not evidence.is_file():
                    errors.append(f"canonical evidence is missing: {evidence}")
                    continue
                shutil.copy2(evidence, evidence_dir / name)
        except FileNotFoundError as error:
            errors.append(str(error))
        if errors:
            failures[cell_id] = {"jobId": submission["jobId"], "errors": errors, "status": status}
            continue
        ledger["cells"][cell_id] = {
            "jobId": submission["jobId"],
            "sourceId": cell["sourceId"],
            "family": cell["family"],
            "seed": cell["seed"],
            "output": output.relative_to(ROOT).as_posix(),
            "outputSha256": sha256(output),
            "effectiveRoute": status["effective_route"],
            "effectiveParams": status["params"],
            "receipt": (evidence_dir / "receipt.json").relative_to(ROOT).as_posix(),
        }
    if failures:
        write_json(STATE_REPORT, {
            "schema": "kaminos.cat-carrier-cross-basin-authority.collection-state.v0",
            "phase": "terminal-evidence-validation",
            "lastTrustworthyEvidence": statuses,
            "failures": failures,
        })
        print(f"terminal evidence failed for {len(failures)} cell(s); wrote {STATE_REPORT}", file=sys.stderr)
        return 1
    write_json(LEDGER, ledger)
    STATE_REPORT.unlink(missing_ok=True)
    print(json.dumps({"status": "collected", "cells": len(ledger["cells"]), "ledger": str(LEDGER)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
