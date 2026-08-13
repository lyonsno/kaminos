"""Evidence contracts for the second polygonal-cat reconstruction cycle."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _resolve(root: Path, value: str) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def validate_campaign(root: Path) -> dict:
    campaign = json.loads((root / "campaign.json").read_text())
    source = _resolve(root, campaign["source"]["path"])
    reference = _resolve(root, campaign["referenceCast"]["path"])
    if not source.is_file() or digest(source) != campaign["source"]["sha256"]:
        raise RuntimeError("cycle-2 source is missing or drifted")
    if not reference.is_file() or digest(reference) != campaign["referenceCast"]["sha256"]:
        raise RuntimeError("cycle-1 reference cast is missing or drifted")
    routes = campaign.get("routes") or []
    route_ids = [route.get("id") for route in routes]
    if sorted(route_ids) != ["sf3d", "trellis"] or len(set(route_ids)) != len(route_ids):
        raise RuntimeError("cycle-2 routes must be exactly sf3d and trellis")
    registration = campaign.get("registration") or {}
    if registration.get("transformClass") != "global_similarity":
        raise RuntimeError("registration must use one global similarity transform")
    if not registration.get("uniformScaleOnly"):
        raise RuntimeError("registration must permit only uniform scale")
    if registration.get("allowsLocalDeformation") or registration.get("allowsAnisotropicScale"):
        raise RuntimeError("registration policy could erase morphological drift")
    required = set(registration.get("requiredWitnesses") or [])
    if required != {"raw-side-by-side", "registered-overlay"}:
        raise RuntimeError("registration must preserve raw and registered witnesses")
    return campaign


def admit_reconstruction(
    *,
    queue_root: Path,
    job_id: str,
    expected_job_type: str,
    expected_input: Path,
    output_dir: Path,
) -> dict:
    terminal_dir = next(
        (
            queue_root / state / job_id
            for state in ("done", "failed", "cancelled")
            if (queue_root / state / job_id).is_dir()
        ),
        None,
    )
    if terminal_dir is None:
        raise RuntimeError(f"job is not terminal: {job_id}")
    receipt_path = terminal_dir / "receipt.json"
    if not receipt_path.is_file():
        raise RuntimeError(f"terminal job has no receipt: {job_id}")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("job_id") != job_id:
        raise RuntimeError(f"receipt job identity mismatch: {job_id}")
    if receipt.get("job_type") != expected_job_type:
        raise RuntimeError(
            f"effective job type mismatch: expected {expected_job_type}, "
            f"got {receipt.get('job_type')}"
        )
    if Path(receipt.get("input_path", "")).resolve() != expected_input.resolve():
        raise RuntimeError(f"effective input mismatch: {job_id}")
    if Path(receipt.get("output_dir", "")).resolve() != output_dir.resolve():
        raise RuntimeError(f"effective output directory mismatch: {job_id}")
    if receipt.get("status") != "done" or receipt.get("exit_code") != 0:
        raise RuntimeError(
            f"reconstruction failed at {receipt.get('failure_phase')}: "
            f"{receipt.get('error_message')}"
        )
    if not receipt.get("effective_route"):
        raise RuntimeError(f"receipt has no effective route: {job_id}")
    output = output_dir / "output.glb"
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"completed job has no output GLB: {job_id}")
    return {
        "jobId": job_id,
        "jobType": expected_job_type,
        "input": str(expected_input.resolve()),
        "inputSha256": digest(expected_input),
        "output": str(output.resolve()),
        "outputSha256": digest(output),
        "outputBytes": output.stat().st_size,
        "receipt": str(receipt_path.resolve()),
        "effectiveRoute": receipt["effective_route"],
        "effectiveArgv": receipt.get("effective_argv"),
        "effectiveOutputDir": receipt["output_dir"],
        "effectiveCwd": receipt.get("effective_cwd"),
        "effectiveEnv": receipt.get("effective_env"),
        "effectiveDefaults": receipt.get("effective_defaults"),
    }


def validate_registration_result(result: dict, root: Path | None = None) -> None:
    root = root or Path.cwd()
    if result.get("schema") != "kaminos.polygonal-cat-cycle2.registration.v0":
        raise RuntimeError("unexpected registration schema")
    for role in ("fixed", "moving"):
        record = result.get(role) or {}
        locator = record.get("path", "")
        if Path(locator).is_absolute():
            raise RuntimeError(f"{role} cast locator is not portable")
        path = _resolve(root, locator)
        if not path.is_file() or digest(path) != record.get("sha256"):
            raise RuntimeError(f"{role} cast is missing or drifted")
    method = result.get("method") or {}
    if method.get("transformClass") != "global_similarity":
        raise RuntimeError("registration result is not global similarity")
    if not method.get("uniformScaleOnly"):
        raise RuntimeError("registration result does not bind uniform scale")
    if method.get("allowsLocalDeformation") or method.get("allowsAnisotropicScale"):
        raise RuntimeError("registration result admits shape-changing fit")
    if method.get("residualMetric") != "bidirectional_nearest_vertex_distance":
        raise RuntimeError("registration result does not bind the nearest-vertex residual")
    fit = result.get("fit") or {}
    if fit.get("uniformScale", 0) <= 0:
        raise RuntimeError("registration result has invalid uniform scale")
    matrix = fit.get("matrix") or []
    if len(matrix) != 4 or any(len(row) != 4 for row in matrix):
        raise RuntimeError("registration result has invalid matrix")
    witnesses = result.get("witnesses") or {}
    for witness_class in ("raw-side-by-side", "registered-overlay"):
        paths = witnesses.get(witness_class)
        if not paths:
            raise RuntimeError(f"registration result lacks {witness_class}")
        for value in paths:
            path = _resolve(root, value)
            if not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError(f"registration witness is missing: {path}")
