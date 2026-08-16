#!/usr/bin/env python3
"""Run the truth-withheld procedural groom inventory through mlx-vlm.

This runner is intentionally an evidence harness rather than an admission gate.
It validates and binds the observation bytes before model load, preserves all
stdout/stderr, and writes a terminal report even when generation or JSON parsing
fails.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any


OBSERVATION_SCHEMA = "kaminos.procedural-groom-observation.v0"
REPORT_SCHEMA = "kaminos.procedural-groom-vlm-inventory-report.v0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def sanitize_runtime_paths(value: str, repo_root: Path) -> str:
    normalized = value.replace(str(repo_root.resolve()), "<worktree>")
    return re.sub(r"[ \t]+(?=\n|$)", "", normalized)


def public_path(path: Path, repo_root: Path) -> str:
    resolved = path.resolve()
    try:
        return f"<worktree>/{resolved.relative_to(repo_root.resolve()).as_posix()}"
    except ValueError:
        return str(resolved)


def resolve_bound_file(root: Path, record: dict[str, Any], label: str) -> Path:
    path = (root / record["path"]).resolve()
    if not path.is_file():
        raise ValueError(f"{label}: bound file is missing: {path}")
    size = path.stat().st_size
    if size <= 0 or size != record.get("byteLength", size):
        raise ValueError(f"{label}: byte length mismatch")
    actual_digest = sha256(path)
    if actual_digest != record.get("sha256"):
        raise ValueError(f"{label}: sha256 mismatch")
    return path


def extract_json(raw: str) -> Any:
    candidate = raw.strip()
    fenced = re.findall(r"```(?:json)?\s*(.*?)\s*```", candidate, flags=re.IGNORECASE | re.DOTALL)
    for block in fenced:
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        for match in re.finditer(r"[\[{]", candidate):
            try:
                value, _ = decoder.raw_decode(candidate[match.start():])
                return value
            except json.JSONDecodeError:
                continue
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observation", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--reparse-raw", help="Recover JSON from an already captured raw stdout file without rerunning inference")
    args = parser.parse_args()

    observation_path = Path(args.observation).resolve()
    prompt_path = Path(args.prompt).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    repo_root = observation_path.parents[2]
    report_path = output_dir / "report.json"
    phase = "input-validation"
    last_trustworthy = None
    base_report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "requestedRoute": f"mlx-vlm:{args.model}",
        "effectiveRunner": sys.executable,
        "effectiveModule": "mlx_vlm generate",
        "requestedModel": args.model,
        "effectiveModel": args.model,
        "requestedBackend": "mlx-metal",
        "effectiveBackend": None,
        "observationPath": public_path(observation_path, repo_root),
        "promptPath": public_path(prompt_path, repo_root),
        "publicEvidencePathNormalization": "repo-root-replaced-with-<worktree>",
        "visualAdmission": False,
        "scientificAdmission": False,
    }

    try:
        observation = json.loads(observation_path.read_text())
        if observation.get("schema") != OBSERVATION_SCHEMA:
            raise ValueError(f"expected observation schema {OBSERVATION_SCHEMA}")
        if observation.get("truthExposure") != "withheld":
            raise ValueError("truthExposure must remain withheld")
        if observation.get("requestedRoute") != observation.get("effectiveRoute"):
            raise ValueError("observation requested/effective route mismatch")
        witness = observation.get("sourceWitness") or {}
        witness_path = resolve_bound_file(observation_path.parent, witness, "source witness")
        if sha256(witness_path) != observation.get("digest"):
            raise ValueError("observation digest is not the bound source witness digest")
        image_paths = []
        for view in observation.get("views") or []:
            if any(view.get(field) is not False for field in (
                "membershipColorsVisible", "labelsVisible", "gizmoVisible"
            )):
                raise ValueError(f"{view.get('id', 'view')}: observation contamination")
            image_paths.append(resolve_bound_file(observation_path.parent, view, view.get("id", "view")))
        if len(image_paths) < 2:
            raise ValueError("inventory requires at least two bound views")
        if not prompt_path.is_file() or prompt_path.stat().st_size <= 0:
            raise ValueError("prompt is missing or blank")
        prompt = prompt_path.read_text()
        prompt_digest = sha256(prompt_path)
        last_trustworthy = "digest-bound-truth-withheld-observation"

        if args.reparse_raw:
            phase = "raw-output-recovery"
            raw_path = Path(args.reparse_raw).resolve()
            if raw_path.parent != output_dir or raw_path.name != "raw-stdout.txt":
                raise ValueError("reparse raw output must be this output directory's raw-stdout.txt")
            source_report_path = output_dir / "report.json"
            if not raw_path.is_file() or raw_path.stat().st_size <= 0:
                raise ValueError("reparse raw output is missing or blank")
            if not source_report_path.is_file():
                raise ValueError("reparse requires the original terminal report")
            source_report = json.loads(source_report_path.read_text())
            if source_report.get("state") != "failed" or source_report.get("phase") != "json-parse":
                raise ValueError("reparse is only valid for a terminal json-parse failure")
            if source_report.get("lastTrustworthyEvidence") != "terminal-raw-vlm-output":
                raise ValueError("original report does not admit terminal raw VLM output")
            inventory = extract_json(raw_path.read_text())
            inventory_path = output_dir / "inventory.json"
            write_json(inventory_path, inventory)
            write_json(output_dir / "parse-report.json", {
                **base_report,
                "state": "raw_inventory_recovered",
                "phase": "complete",
                "observationDigest": observation["digest"],
                "promptSha256": prompt_digest,
                "rawStdoutSha256": sha256(raw_path),
                "sourceReportSha256": sha256(source_report_path),
                "inventorySha256": sha256(inventory_path),
                "lastTrustworthyEvidence": "parsed-frozen-raw-inventory",
            })
            return 0

        phase = "backend-probe"
        import mlx.core as mx

        effective_device = str(mx.default_device())
        if "gpu" not in effective_device.lower():
            raise RuntimeError(f"mlx default device is not GPU: {effective_device}")
        base_report["effectiveBackend"] = "mlx-metal"
        base_report["effectiveDevice"] = effective_device

        command = [
            sys.executable,
            "-m",
            "mlx_vlm",
            "generate",
            "--model",
            args.model,
            "--image",
            *[str(path) for path in image_paths],
            "--prompt",
            prompt,
            "--max-tokens",
            "8192",
            "--temperature",
            "0",
        ]
        start_receipt = {
            **base_report,
            "state": "started",
            "phase": "model-generation",
            "observationDigest": observation["digest"],
            "promptSha256": prompt_digest,
            "imageSha256": [sha256(path) for path in image_paths],
            "commandShape": [
                sys.executable, "-m", "mlx_vlm", "generate", "--model", args.model,
                "--image", *[public_path(path, repo_root) for path in image_paths], "--prompt", f"sha256:{prompt_digest}",
                "--max-tokens", "8192", "--temperature", "0",
            ],
            "lastTrustworthyEvidence": last_trustworthy,
        }
        write_json(output_dir / "start.json", start_receipt)

        phase = "model-generation"
        environment = dict(os.environ)
        environment["PYTHONUNBUFFERED"] = "1"
        result = subprocess.run(command, cwd=str(observation_path.parents[2]), env=environment, capture_output=True, text=True)
        normalized_stdout = sanitize_runtime_paths(result.stdout, repo_root)
        normalized_stderr = sanitize_runtime_paths(result.stderr, repo_root)
        (output_dir / "raw-stdout.txt").write_text(normalized_stdout)
        (output_dir / "raw-stderr.txt").write_text(normalized_stderr)
        if result.returncode != 0:
            raise RuntimeError(f"mlx-vlm exited {result.returncode}")
        last_trustworthy = "terminal-raw-vlm-output"

        phase = "json-parse"
        inventory = extract_json(normalized_stdout)
        write_json(output_dir / "inventory.json", inventory)
        write_json(report_path, {
            **base_report,
            "state": "raw_inventory_captured",
            "phase": "complete",
            "exitCode": result.returncode,
            "observationDigest": observation["digest"],
            "promptSha256": prompt_digest,
            "rawStdoutSha256": sha256(output_dir / "raw-stdout.txt"),
            "rawStderrSha256": sha256(output_dir / "raw-stderr.txt"),
            "inventorySha256": sha256(output_dir / "inventory.json"),
            "lastTrustworthyEvidence": "parsed-raw-inventory",
        })
        return 0
    except Exception as error:
        write_json(report_path, {
            **base_report,
            "state": "failed",
            "phase": phase,
            "error": str(error),
            "traceback": sanitize_runtime_paths(traceback.format_exc(), repo_root),
            "lastTrustworthyEvidence": last_trustworthy,
        })
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
