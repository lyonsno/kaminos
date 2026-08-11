"""Pure contract helpers for malformed-coat carrier recovery."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np


def verify_source(path: Path, expected_sha256: str) -> str:
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    observed = hashlib.sha256(path.read_bytes()).hexdigest()
    if observed != expected_sha256:
        raise ValueError(
            f"source hash mismatch for {path}: expected {expected_sha256}, observed {observed}"
        )
    return observed


def load_admitted_selection(repo: Path, campaign: dict) -> np.ndarray:
    record = campaign["admittedSelection"]
    if record["metric"] != "relative_area" or record["operator"] != ">":
        raise ValueError("unsupported admitted selection contract")
    arrays_path = Path(repo) / record["arraysPath"]
    verify_source(arrays_path, record["arraysSha256"])
    metric_key = record["metric"]
    selected_key = f"{metric_key}_selected"
    with np.load(arrays_path) as arrays:
        if metric_key not in arrays or selected_key not in arrays:
            raise ValueError("admitted arrays omit metric or persisted selection")
        metric = np.asarray(arrays[metric_key], dtype=np.float64)
        persisted = np.asarray(arrays[selected_key], dtype=np.float64)
    if metric.ndim != 1 or persisted.shape != metric.shape:
        raise ValueError("admitted metric and selection cardinalities differ")
    replayed = metric > float(record["threshold"])
    if not np.array_equal(replayed, persisted.astype(bool)):
        raise ValueError("persisted selection does not match admitted threshold replay")
    return replayed


def evaluate_candidate(
    *,
    name: str,
    face_counts,
    source_bounds,
    candidate_bounds,
    silhouette_ious,
    volume: float,
    constraints: dict,
) -> dict:
    face_counts = np.asarray(face_counts, dtype=np.int64)
    source_bounds = np.asarray(source_bounds, dtype=np.float64)
    candidate_bounds = np.asarray(candidate_bounds, dtype=np.float64)
    ious = {key: float(value) for key, value in silhouette_ious.items()}
    if face_counts.ndim != 1 or not len(face_counts) or np.any(face_counts <= 0):
        raise ValueError("candidate component face counts must be positive")
    if source_bounds.shape != (3,) or candidate_bounds.shape != (3,):
        raise ValueError("source and candidate bounds must each contain three extents")
    if np.any(source_bounds <= 0) or np.any(candidate_bounds <= 0):
        raise ValueError("source and candidate bounds must be positive")
    if not ious or any(not 0.0 <= value <= 1.0 for value in ious.values()):
        raise ValueError("candidate silhouette IoUs must lie in [0, 1]")

    component_fraction = float(face_counts.max() / face_counts.sum())
    bound_ratios = candidate_bounds / source_bounds
    min_iou = min(ious.values())
    rejection_reasons = []
    if component_fraction < constraints["minimumLargestComponentFaceFraction"]:
        rejection_reasons.append("fragmented")
    if min_iou < constraints["minimumProjectedSilhouetteRetention"]:
        rejection_reasons.append("silhouette-loss")
    if float(bound_ratios.min()) < constraints["minimumBoundsRetention"]:
        rejection_reasons.append("bounds-shrink")
    if float(bound_ratios.max()) > constraints["maximumBoundsExpansion"]:
        rejection_reasons.append("bounds-expansion")
    if not np.isfinite(volume) or volume <= 0.0:
        rejection_reasons.append("nonpositive-volume")

    return {
        "name": name,
        "admissible": not rejection_reasons,
        "rejectionReasons": rejection_reasons,
        "componentCount": int(len(face_counts)),
        "largestComponentFaceFraction": component_fraction,
        "silhouetteIouByView": ious,
        "minimumSilhouetteIou": float(min_iou),
        "meanSilhouetteIou": float(np.mean(list(ious.values()))),
        "boundsRetentionByAxis": bound_ratios.tolist(),
        "meanBoundsRetention": float(np.mean(np.minimum(bound_ratios, 1.0))),
        "volume": float(volume),
    }


def choose_candidate(candidates) -> dict:
    admitted = [candidate for candidate in candidates if candidate.get("admissible")]
    if not admitted:
        raise ValueError("no carrier candidate satisfies the preregistered constraints")
    return max(
        admitted,
        key=lambda candidate: (
            float(candidate["meanSilhouetteIou"]),
            float(candidate["meanBoundsRetention"]),
        ),
    )


def resolve_visual_selection(candidates, selection: dict) -> dict:
    if selection.get("selectionAuthority") != "agent-visual-inspection":
        raise ValueError("carrier selection authority must be agent-visual-inspection")
    by_name = {candidate["name"]: candidate for candidate in candidates}
    chosen_name = selection.get("chosenCandidate")
    if chosen_name not in by_name:
        raise ValueError(f"visual selection names unknown candidate: {chosen_name}")
    chosen = by_name[chosen_name]
    if not chosen.get("admissible"):
        raise ValueError(f"visually selected candidate is not admissible: {chosen_name}")
    return chosen


def write_failure_report(
    path: Path,
    *,
    phase: str,
    error: str,
    last_trustworthy_evidence: dict,
) -> None:
    payload = {
        "schema": "kaminos.mlx-malformed-coat-carrier-recovery-failure.v0",
        "phase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": last_trustworthy_evidence,
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def prepare_run(
    output_root: Path,
    *,
    run_id: str,
    result_name: str = "result.json",
    failure_name: str = "failure.json",
    request_name: str = "run-request.json",
) -> None:
    if not run_id:
        raise ValueError("run identity must be non-empty")
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / result_name).unlink(missing_ok=True)
    (output_root / failure_name).unlink(missing_ok=True)
    request = {
        "schema": "kaminos.mlx-malformed-coat-carrier-recovery-run-request.v0",
        "runId": run_id,
        "resultName": result_name,
        "failureName": failure_name,
    }
    (output_root / request_name).write_text(json.dumps(request, indent=2) + "\n")


def validate_run_outputs(
    output_root: Path,
    *,
    process_returncode: int,
    result_name: str = "result.json",
    failure_name: str = "failure.json",
    request_name: str = "run-request.json",
) -> dict:
    output_root = Path(output_root)
    failure_path = output_root / failure_name
    result_path = output_root / result_name
    request_path = output_root / request_name
    if not request_path.is_file():
        raise RuntimeError(f"{request_name} is missing; current run identity is unknown")
    request = json.loads(request_path.read_text())
    requested_run_id = request.get("runId")
    if not requested_run_id:
        raise RuntimeError(f"{request_name} omits a non-empty runId")
    if failure_path.is_file():
        failure = json.loads(failure_path.read_text())
        raise RuntimeError(
            "Blender wrote a durable failure report at phase "
            f"{failure.get('phase', 'unknown')}: {failure.get('error', 'unknown error')}"
        )
    if process_returncode != 0:
        raise RuntimeError(f"Blender exited with status {process_returncode}")
    if not result_path.is_file():
        raise RuntimeError(f"{result_name} is missing after nominal Blender success")
    result = json.loads(result_path.read_text())
    if result.get("runId") != requested_run_id:
        raise RuntimeError(
            f"{result_name} does not match current run {requested_run_id}: "
            f"observed {result.get('runId')!r}"
        )
    return result
