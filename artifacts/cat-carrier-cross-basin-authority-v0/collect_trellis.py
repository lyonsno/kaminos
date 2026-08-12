#!/usr/bin/env python3
"""Collect and authenticate the basin-distinct Trellis reconstructions."""

import hashlib
import json
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "trellis-selection.json"
SUBMISSIONS = ROOT / "trellis-submissions.json"
LEDGER = ROOT / "trellis-result-ledger.json"
STATE_REPORT = ROOT / "trellis-collection-state.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")
TERMINAL = {"done", "failed", "cancelled"}


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_output(path: Path, started_at: float | None = None) -> list[str]:
    if not path.is_file():
        return [f"primary output is missing: {path}"]
    errors = []
    if path.stat().st_size <= 4096:
        errors.append(f"primary output is suspiciously small: {path.stat().st_size} bytes")
    if started_at is not None and path.stat().st_mtime + 1 < started_at:
        errors.append(f"primary output predates the authenticated job start: {path.stat().st_mtime} < {started_at}")
    return errors


def effective_route_errors(route: str, expected: dict) -> list[str]:
    try:
        argv = shlex.split(route)
    except ValueError as error:
        return [f"effective route is not valid shell argv: {error}"]

    if sum(Path(token).name == "generate.py" for token in argv) != 1:
        return ["effective route does not name generate.py exactly once"]

    required = {
        "--image": str(expected["input"]),
        "--output": str(expected["output"]),
        "--seed": str(expected["seed"]),
        "--steps": str(expected["steps"]),
        "--target-faces": str(expected["targetFaces"]),
        "--texture-size": str(expected["textureSize"]),
    }
    errors = []
    for option, value in required.items():
        positions = [index for index, token in enumerate(argv) if token == option]
        if len(positions) != 1:
            errors.append(f"effective route must contain {option} exactly once")
            continue
        index = positions[0]
        actual = argv[index + 1] if index + 1 < len(argv) else None
        if actual != value:
            errors.append(f"effective route has {option} {actual!r}, expected {value!r}")
    return errors


def validate_status(status: dict, expected: dict) -> list[str]:
    errors = []
    if status.get("status") != "done":
        errors.append(f"status is {status.get('status')}, expected done")
    if status.get("exit_code") != 0:
        errors.append(f"exit code is {status.get('exit_code')}, expected 0")
    if status.get("job_type") != expected["jobType"]:
        errors.append(f"job type is {status.get('job_type')}, expected {expected['jobType']}")
    if status.get("input_path") != expected["input"]:
        errors.append(f"effective input is {status.get('input_path')}, expected {expected['input']}")
    if effective_route_errors(status.get("effective_route") or "", expected):
        errors.append("effective route does not bind the expected executable, input, output, and every reconstruction setting")
    return errors


def greenroom_status(job_id: str) -> dict:
    completed = subprocess.run(
        [str(GREENROOM), "status", job_id],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def canonical_job_dir(job_id: str) -> Path:
    for bucket in ("done", "failed", "cancelled", "running", "pending"):
        candidate = QUEUE / bucket / job_id
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"canonical Greenroom job directory missing for {job_id}")


def main() -> int:
    selection = json.loads(SELECTION.read_text())
    submissions = json.loads(SUBMISSIONS.read_text())
    candidates = {candidate["cellId"]: candidate for candidate in selection["candidates"]}
    if set(submissions.get("cells", {})) != set(candidates):
        raise RuntimeError("Trellis submissions do not exactly cover the frozen candidate selection")

    statuses = {
        cell_id: greenroom_status(entry["jobId"])
        for cell_id, entry in submissions["cells"].items()
    }
    incomplete = {
        cell_id: status.get("status")
        for cell_id, status in statuses.items()
        if status.get("status") not in TERMINAL
    }
    if incomplete:
        LEDGER.unlink(missing_ok=True)
        write_json(STATE_REPORT, {
            "schema": "kaminos.cat-carrier-cross-basin-authority.trellis-collection-state.v0",
            "phase": "awaiting-terminal-greenroom-jobs",
            "lastTrustworthyEvidence": statuses,
            "incomplete": incomplete,
        })
        print(json.dumps({"terminal": len(statuses) - len(incomplete), "total": len(statuses), "incomplete": incomplete}, indent=2))
        return 2

    route = selection["route"]
    failures = {}
    ledger = {
        "schema": "kaminos.cat-carrier-cross-basin-authority.trellis-results.v0",
        "selection": "trellis-selection.json",
        "selectionSha256": sha256(SELECTION),
        "submissions": "trellis-submissions.json",
        "submissionsSha256": sha256(SUBMISSIONS),
        "collectedAt": time.time(),
        "cells": {},
    }
    for cell_id, submission in submissions["cells"].items():
        status = statuses[cell_id]
        input_path = (ROOT / submission["input"]).resolve()
        output = (ROOT / submission["outputDir"] / "output.glb").resolve()
        expected = {
            "jobType": route["jobType"],
            "input": str(input_path),
            "output": str(output),
            "seed": route["seed"],
            "steps": route["steps"],
            "targetFaces": route["targetFaces"],
            "textureSize": route["textureSize"],
        }
        errors = validate_status(status, expected)
        errors.extend(validate_output(output, status.get("started_at")))
        if not input_path.is_file():
            errors.append(f"source image is missing: {input_path}")
        else:
            if sha256(input_path) != submission["inputSha256"]:
                errors.append("source image content does not match the launch-time hash")
            if status.get("started_at") is not None and input_path.stat().st_mtime > status["started_at"] + 1:
                errors.append("source image was modified after the authenticated job start")
        evidence_dir = ROOT / "receipts-trellis" / cell_id
        try:
            canonical = canonical_job_dir(submission["jobId"])
            evidence_dir.mkdir(parents=True, exist_ok=True)
            for name in ("request.json", "status.json", "receipt.json", "stdout.log", "stderr.log"):
                source = canonical / name
                if not source.is_file():
                    errors.append(f"canonical evidence is missing: {source}")
                    continue
                shutil.copy2(source, evidence_dir / name)
        except FileNotFoundError as error:
            errors.append(str(error))
        if errors:
            failures[cell_id] = {"jobId": submission["jobId"], "errors": errors, "status": status}
            continue
        ledger["cells"][cell_id] = {
            "jobId": submission["jobId"],
            "role": candidates[cell_id]["role"],
            "input": submission["input"],
            "inputSha256": submission["inputSha256"],
            "output": output.relative_to(ROOT).as_posix(),
            "outputSha256": sha256(output),
            "outputBytes": output.stat().st_size,
            "effectiveRoute": status["effective_route"],
            "effectiveParams": status.get("params") or {},
            "receipt": (evidence_dir / "receipt.json").relative_to(ROOT).as_posix(),
        }
    if failures:
        LEDGER.unlink(missing_ok=True)
        write_json(STATE_REPORT, {
            "schema": "kaminos.cat-carrier-cross-basin-authority.trellis-collection-state.v0",
            "phase": "terminal-evidence-validation",
            "lastTrustworthyEvidence": statuses,
            "failures": failures,
        })
        print(f"terminal Trellis evidence failed for {len(failures)} cell(s); wrote {STATE_REPORT}", file=sys.stderr)
        return 1
    write_json(LEDGER, ledger)
    STATE_REPORT.unlink(missing_ok=True)
    print(json.dumps({"status": "collected", "cells": len(ledger["cells"]), "ledger": str(LEDGER)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
