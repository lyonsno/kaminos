#!/usr/bin/env python3
"""Collect authenticated terminal evidence for the prompt-lighting Trellis cells."""

import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path

from trellis_contract import primary_output_errors, route_errors


ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "trellis-selection.json"
SUBMISSIONS = ROOT / "trellis-submissions.json"
LEDGER = ROOT / "trellis-result-ledger.json"
STATE = ROOT / "trellis-collection-state.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")
TERMINAL = {"done", "failed", "cancelled"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def status(job_id: str) -> dict:
    completed = subprocess.run(
        [str(GREENROOM), "status", job_id], check=True, capture_output=True, text=True
    )
    return json.loads(completed.stdout)


def job_dir(job_id: str) -> Path:
    for bucket in ("done", "failed", "cancelled", "running", "pending"):
        candidate = QUEUE / bucket / job_id
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(job_id)


def main() -> int:
    selection = json.loads(SELECTION.read_text())
    submissions = json.loads(SUBMISSIONS.read_text())
    candidates = {row["cellId"]: row for row in selection["candidates"]}
    if set(submissions["cells"]) != set(candidates):
        raise RuntimeError("submissions do not exactly cover the frozen selection")
    statuses = {
        cell_id: status(row["jobId"])
        for cell_id, row in submissions["cells"].items()
    }
    incomplete = {
        cell_id: row.get("status") for cell_id, row in statuses.items()
        if row.get("status") not in TERMINAL
    }
    if incomplete:
        LEDGER.unlink(missing_ok=True)
        write_json(STATE, {"phase": "awaiting-terminal-greenroom-jobs", "incomplete": incomplete})
        print(json.dumps({"terminal": len(statuses) - len(incomplete), "total": len(statuses), "incomplete": incomplete}, indent=2))
        return 2
    route = selection["route"]
    ledger = {
        "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.trellis-results.v0",
        "selection": "trellis-selection.json",
        "selectionSha256": digest(SELECTION),
        "submissions": "trellis-submissions.json",
        "submissionsSha256": digest(SUBMISSIONS),
        "collectedAt": time.time(),
        "cells": {},
    }
    failures = {}
    for cell_id, submission in submissions["cells"].items():
        row = statuses[cell_id]
        input_path = (ROOT / submission["input"]).resolve()
        output = (ROOT / submission["outputDir"] / "output.glb").resolve()
        expected = {
            "input": str(input_path), "output": str(output), "seed": route["seed"],
            "steps": route["steps"], "targetFaces": route["targetFaces"],
            "textureSize": route["textureSize"],
        }
        errors = []
        if row.get("status") != "done" or row.get("exit_code") != 0:
            errors.append(f"terminal status is {row.get('status')} with exit {row.get('exit_code')}")
        errors.extend(route_errors(row.get("effective_route") or "", expected))
        errors.extend(primary_output_errors(output))
        if digest(input_path) != submission["inputSha256"]:
            errors.append("selected input drifted after submission")
        evidence = ROOT / "receipts-trellis" / cell_id
        canonical = job_dir(submission["jobId"])
        evidence.mkdir(parents=True, exist_ok=True)
        for name in ("request.json", "status.json", "receipt.json", "stdout.log", "stderr.log"):
            source = canonical / name
            if not source.is_file():
                errors.append(f"canonical evidence is missing: {name}")
            else:
                shutil.copy2(source, evidence / name)
        if errors:
            failures[cell_id] = {"jobId": submission["jobId"], "errors": errors}
            continue
        ledger["cells"][cell_id] = {
            "jobId": submission["jobId"],
            "role": candidates[cell_id]["role"],
            "input": submission["input"],
            "inputSha256": submission["inputSha256"],
            "output": output.relative_to(ROOT).as_posix(),
            "outputSha256": digest(output),
            "outputBytes": output.stat().st_size,
            "effectiveRoute": row["effective_route"],
            "effectiveParams": row.get("params") or {},
            "receipt": (evidence / "receipt.json").relative_to(ROOT).as_posix(),
        }
    if failures:
        LEDGER.unlink(missing_ok=True)
        write_json(STATE, {"phase": "terminal-evidence-validation", "failures": failures})
        print(json.dumps(failures, indent=2))
        return 1
    write_json(LEDGER, ledger)
    STATE.unlink(missing_ok=True)
    print(json.dumps({"status": "collected", "cells": len(ledger["cells"]), "ledger": str(LEDGER)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
