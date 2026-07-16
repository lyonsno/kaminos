#!/usr/bin/env python3
"""Validate and index randomized Non-Ridge source-basis captures."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import struct
import sys
from pathlib import Path
from typing import Any


CAPTURE_SCHEMA = "kaminos.volume.nonridge-source-setting-captures.v0"
CORPUS_SCHEMA = "kaminos.volume.nonridge-source-basis-corpus.v0"
FAILURE_SCHEMA = "kaminos.volume.nonridge-source-basis-corpus-failure.v0"
CAPTURE_AUTHORITY = "integration-positive-nonridge-randomized-source-captures-v0"
CURRENT16 = [
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
]
REQUIRED_CAUSAL_CONTROLS = [
    "support.thermal", "support.reaction", "support.front", "support.interface",
    "boundary.gradientGain", "boundary.cut", "boundary.softness", "boundary.coreRejection",
    "topology.gain", "curl.gain", "divergence.gain",
    "ridge.gain", "ridge.cut", "tip.breakup", "topology.erosion",
]
SOURCE_COMPLETE_ADDITIONS = [
    "front.topology",
    "velocity.x",
    "velocity.y",
    "velocity.z",
    "support.reaction",
    "support.interface",
    "flow.curlMagnitude",
    "flow.divergence",
]
REQUIRED_TARGETS = [
    "candidate.nonRidgeMembership",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
]
EXACT_ONE_NEGATIVE_POLICY = "exactly-one-measured-all-target-zero-control-v0"
EXPECTED_DESIGN_CORRECTION = {
    "identity": "single-axis-setting-transposition-v0",
    "control": "boundary.gradientGain",
    "settingAIndex": 2,
    "settingBIndex": 12,
    "settingA": "setting-c",
    "settingB": "setting-m",
    "reason": "replace-redundant-all-target-zero-setting-m-while-preserving-latin-levels-v0",
}
FROZEN_SOURCE_KEYS = [
    "presetId", "stateIdentity", "stateHash", "generation", "generationHash", "simStepCount",
    "simStepHash", "gridShape", "gridHash", "gridOrigin", "gridSpacing", "gridAxisOrder",
    "cameraIdentity", "viewportIdentity", "smokeState", "requestedRaySteps",
    "effectiveRaySteps", "adaptiveIdentity", "temporalIdentity", "requestedRoute",
    "effectiveRoute", "backend", "rendererIdentity", "splatRadius", "splatSharpness",
    "covarianceIdentity", "depthPolicy", "fallbackReason",
]
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
FORBIDDEN_LIMIT_KEYS = {
    "limit", "maxrows", "maxsettings", "samplecap", "samplelimit", "topk",
}
ALLOWED_FEATURE_PROVENANCE = {
    "candidate-source-current16",
    "candidate-source-independent",
}


class CorpusError(RuntimeError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def float32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def clear_status_artifacts(out_dir: Path) -> None:
    for name in ("corpus-manifest.json", "failure-report.json"):
        try:
            (out_dir / name).unlink()
        except FileNotFoundError:
            pass


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CorpusError(f"{label} must be an object")
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CorpusError(f"{label} must be a nonblank string")
    return value


def require_sha256(value: Any, label: str) -> str:
    value = require_string(value, label)
    if not SHA256_RE.fullmatch(value):
        raise CorpusError(f"{label} must be a lowercase SHA-256 digest")
    return value


def require_int(value: Any, label: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise CorpusError(f"{label} must be an integer >= {minimum}")
    return value


def require_finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise CorpusError(f"{label} must be a finite number")
    return float(value)


def require_order(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise CorpusError(f"{label} must be a nonempty array")
    order = [require_string(channel, f"{label}[{index}]") for index, channel in enumerate(value)]
    if len(order) != len(set(order)):
        raise CorpusError(f"{label} contains duplicate channels")
    return order


def validate_controls(value: Any, label: str, sampled_controls: list[str]) -> dict[str, Any]:
    controls = require_object(value, label)
    if set(controls) != set(sampled_controls):
        raise CorpusError(f"{label} must contain exactly the sampled causal controls")
    for name in sampled_controls:
        require_finite_number(controls[name], f"{label}.{name}")
    for name, control_value in controls.items():
        require_string(name, f"{label} key")
        if isinstance(control_value, float) and not math.isfinite(control_value):
            raise CorpusError(f"{label}.{name} must be finite")
        if not isinstance(control_value, (str, int, float, bool)) and control_value is not None:
            raise CorpusError(f"{label}.{name} must be scalar or null")
    return controls


def reject_hidden_limits(value: Any, path: str = "design") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if normalized in FORBIDDEN_LIMIT_KEYS:
                raise CorpusError(f"{path}.{key} is an unauthorized sample limit")
            reject_hidden_limits(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_hidden_limits(child, f"{path}[{index}]")


def artifact_path(manifest_dir: Path, artifact: dict[str, Any], label: str) -> Path:
    raw_path = require_string(artifact.get("path"), f"{label}.path")
    path = Path(raw_path)
    return path.resolve() if path.is_absolute() else (manifest_dir / path).resolve()


def validate_f32_artifact(
    manifest_dir: Path,
    artifact_value: Any,
    expected_shape: list[int],
    expected_semantic_role: str,
    label: str,
) -> dict[str, Any]:
    artifact = require_object(artifact_value, label)
    if artifact.get("dtype") != "float32-le":
        raise CorpusError(f"{label}.dtype must be float32-le")
    if artifact.get("semanticRole") != expected_semantic_role:
        raise CorpusError(f"{label}.semanticRole must be {expected_semantic_role}")
    shape = artifact.get("shape")
    if shape != expected_shape:
        raise CorpusError(f"{label}.shape must equal {expected_shape}, got {shape}")
    declared_bytes = require_int(artifact.get("bytes"), f"{label}.bytes", 1)
    expected_bytes = math.prod(expected_shape) * 4
    if declared_bytes != expected_bytes:
        raise CorpusError(f"{label}.bytes must equal shape byte size {expected_bytes}")
    declared_sha = require_sha256(artifact.get("sha256"), f"{label}.sha256")
    path = artifact_path(manifest_dir, artifact, label)
    if not path.is_file():
        raise CorpusError(f"{label} artifact does not exist: {path}")
    if path.stat().st_size != declared_bytes:
        raise CorpusError(f"{label} file bytes mismatch: declared {declared_bytes}, actual {path.stat().st_size}")

    digest = hashlib.sha256()
    observed_bytes = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(4 * 262144)
            if not chunk:
                break
            if len(chunk) % 4:
                raise CorpusError(f"{label} contains a partial float")
            digest.update(chunk)
            observed_bytes += len(chunk)
            for (number,) in struct.iter_unpack("<f", chunk):
                if not math.isfinite(number):
                    raise CorpusError(f"{label} contains non-finite float data")
    observed_sha = digest.hexdigest()
    if observed_bytes != declared_bytes:
        raise CorpusError(f"{label} streamed byte count mismatch")
    if observed_sha != declared_sha:
        raise CorpusError(f"{label} SHA-256 mismatch: declared {declared_sha}, actual {observed_sha}")
    return {
        "path": str(path),
        "bytes": declared_bytes,
        "sha256": declared_sha,
        "dtype": "float32-le",
        "shape": expected_shape,
        "semanticRole": expected_semantic_role,
    }


def validate_binary_artifact(
    manifest_dir: Path,
    artifact_value: Any,
    expected_semantic_role: str,
    label: str,
) -> dict[str, Any]:
    artifact = require_object(artifact_value, label)
    if artifact.get("semanticRole") != expected_semantic_role:
        raise CorpusError(f"{label}.semanticRole must be {expected_semantic_role}")
    declared_bytes = require_int(artifact.get("bytes"), f"{label}.bytes", 1)
    declared_sha = require_sha256(artifact.get("sha256"), f"{label}.sha256")
    path = artifact_path(manifest_dir, artifact, label)
    if not path.is_file() or path.stat().st_size != declared_bytes:
        raise CorpusError(f"{label} bytes do not match the captured artifact")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    observed_sha = digest.hexdigest()
    if observed_sha != declared_sha:
        raise CorpusError(f"{label} SHA-256 mismatch: declared {declared_sha}, actual {observed_sha}")
    return {
        "path": str(path),
        "bytes": declared_bytes,
        "sha256": declared_sha,
        "semanticRole": expected_semantic_role,
    }


def validate_feature_parity(current: dict[str, Any], augmented: dict[str, Any], row_count: int) -> None:
    current_row_bytes = len(CURRENT16) * 4
    augmented_row_bytes = augmented["shape"][1] * 4
    with Path(current["path"]).open("rb") as current_file, Path(augmented["path"]).open("rb") as augmented_file:
        for row_index in range(row_count):
            current_row = current_file.read(current_row_bytes)
            augmented_row = augmented_file.read(augmented_row_bytes)
            if len(current_row) != current_row_bytes or len(augmented_row) != augmented_row_bytes:
                raise CorpusError(f"feature row {row_index} ended before its declared shape")
            if augmented_row[:current_row_bytes] != current_row:
                raise CorpusError(f"source-complete Current-16 prefix differs at row {row_index}")


def validate_source_basis_parity(
    augmented: dict[str, Any],
    source_basis: dict[str, dict[str, Any]],
    row_count: int,
) -> None:
    augmented_row_bytes = augmented["shape"][1] * 4
    prefix_bytes = len(CURRENT16) * 4
    basis_files = [Path(source_basis[channel]["path"]).open("rb") for channel in SOURCE_COMPLETE_ADDITIONS]
    try:
        with Path(augmented["path"]).open("rb") as augmented_file:
            for row_index in range(row_count):
                augmented_row = augmented_file.read(augmented_row_bytes)
                if len(augmented_row) != augmented_row_bytes:
                    raise CorpusError(f"source-complete row {row_index} ended before its declared shape")
                for channel_index, (channel, basis_file) in enumerate(zip(SOURCE_COMPLETE_ADDITIONS, basis_files)):
                    basis_value = basis_file.read(4)
                    start = prefix_bytes + channel_index * 4
                    if len(basis_value) != 4 or augmented_row[start:start + 4] != basis_value:
                        raise CorpusError(f"source-complete column {channel} differs from its source artifact at row {row_index}")
    finally:
        for basis_file in basis_files:
            basis_file.close()


def validate_target_semantics(targets: dict[str, Any], row_count: int, negative_control: bool) -> dict[str, Any]:
    positive_membership = 0
    negative_membership = 0
    positive_optical = 0
    all_zero = True
    with Path(targets["path"]).open("rb") as handle:
        for row_index in range(row_count):
            raw = handle.read(len(REQUIRED_TARGETS) * 4)
            values = struct.unpack("<" + "f" * len(REQUIRED_TARGETS), raw)
            membership, *optical = values
            if not 0.0 <= membership <= 1.0:
                raise CorpusError(f"membership target at row {row_index} must be within [0, 1]")
            if any(value < 0.0 for value in optical):
                raise CorpusError(f"emission/extinction targets at row {row_index} must be nonnegative")
            positive_membership += int(membership > 0.0)
            negative_membership += int(membership == 0.0)
            positive_optical += int(any(value > 0.0 for value in optical))
            all_zero = all_zero and all(value == 0.0 for value in values)
    if negative_control and not all_zero:
        raise CorpusError("all-targets-zero-v0 negative control contains positive target evidence")
    if not negative_control and (positive_membership == 0 or positive_optical == 0):
        raise CorpusError("non-negative setting lacks positive membership or optical target evidence")
    return {
        "positiveMembershipRows": positive_membership,
        "negativeMembershipRows": negative_membership,
        "positiveOpticalRows": positive_optical,
        "allTargetsZero": all_zero,
    }


def validate_frozen_authority(value: Any, label: str) -> dict[str, Any]:
    source = require_object(value, label)
    for key in (
        "presetId", "stateIdentity", "cameraIdentity", "viewportIdentity", "smokeState",
        "adaptiveIdentity", "temporalIdentity", "requestedRoute", "effectiveRoute", "backend",
        "rendererIdentity", "covarianceIdentity", "depthPolicy",
    ):
        require_string(source.get(key), f"{label}.{key}")
    require_int(source.get("generation"), f"{label}.generation")
    require_int(source.get("simStepCount"), f"{label}.simStepCount")
    state_hash = require_sha256(source.get("stateHash"), f"{label}.stateHash")
    generation_hash = require_sha256(source.get("generationHash"), f"{label}.generationHash")
    sim_step_hash = require_sha256(source.get("simStepHash"), f"{label}.simStepHash")
    expected_generation_hash = sha256_bytes(canonical_json({
        "stateHash": state_hash,
        "generation": source["generation"],
    }).encode("utf-8"))
    if generation_hash != expected_generation_hash:
        raise CorpusError(f"{label}.generationHash does not bind stateHash and generation")
    expected_step_hash = sha256_bytes(canonical_json({
        "generationHash": generation_hash,
        "simStepCount": source["simStepCount"],
    }).encode("utf-8"))
    if sim_step_hash != expected_step_hash:
        raise CorpusError(f"{label}.simStepHash does not bind generationHash and simStepCount")
    grid_shape = source.get("gridShape")
    if (
        not isinstance(grid_shape, list)
        or len(grid_shape) != 3
        or any(isinstance(size, bool) or not isinstance(size, int) or size <= 0 for size in grid_shape)
    ):
        raise CorpusError(f"{label}.gridShape must contain three positive integers")
    for key in ("gridOrigin", "gridSpacing"):
        vector = source.get(key)
        if not isinstance(vector, list) or len(vector) != 3:
            raise CorpusError(f"{label}.{key} must contain three finite numbers")
        for index, component in enumerate(vector):
            require_finite_number(component, f"{label}.{key}[{index}]")
    if any(float(component) <= 0.0 for component in source["gridSpacing"]):
        raise CorpusError(f"{label}.gridSpacing components must be positive")
    if source.get("gridAxisOrder") != "x-fastest-y-then-z-v0":
        raise CorpusError(f"{label}.gridAxisOrder must be x-fastest-y-then-z-v0")
    require_sha256(source.get("gridHash"), f"{label}.gridHash")
    requested_steps = require_int(source.get("requestedRaySteps"), f"{label}.requestedRaySteps", 1)
    effective_steps = require_int(source.get("effectiveRaySteps"), f"{label}.effectiveRaySteps", 1)
    if requested_steps != effective_steps:
        raise CorpusError(f"{label} requested/effective ray steps disagree")
    require_finite_number(source.get("splatRadius"), f"{label}.splatRadius")
    require_finite_number(source.get("splatSharpness"), f"{label}.splatSharpness")
    if source.get("fallbackReason") is not None:
        raise CorpusError(f"{label} contains fallback evidence: {source.get('fallbackReason')}")
    return {key: source.get(key) for key in FROZEN_SOURCE_KEYS}


def validate_world_positions(
    artifact: dict[str, Any],
    grid_shape: list[int],
    grid_origin: list[float],
    grid_spacing: list[float],
) -> None:
    nx, ny, nz = grid_shape
    expected_rows = nx * ny * nz
    with Path(artifact["path"]).open("rb") as handle:
        for row_index in range(expected_rows):
            raw = handle.read(12)
            if len(raw) != 12:
                raise CorpusError(f"world-position evidence ended at row {row_index}")
            observed = struct.unpack("<fff", raw)
            x_index = row_index % nx
            y_index = (row_index // nx) % ny
            z_index = row_index // (nx * ny)
            expected = (
                float(grid_origin[0]) + (x_index + 0.5) * float(grid_spacing[0]),
                float(grid_origin[1]) + (y_index + 0.5) * float(grid_spacing[1]),
                float(grid_origin[2]) + (z_index + 0.5) * float(grid_spacing[2]),
            )
            if any(not math.isclose(value, target, rel_tol=0.0, abs_tol=1e-6) for value, target in zip(observed, expected)):
                raise CorpusError(
                    f"world-position row {row_index} is not its declared unique grid-cell center: "
                    f"observed {observed}, expected {expected}"
                )


def matrix_rank(rows: list[list[float]], tolerance: float = 1e-10) -> int:
    matrix = [row[:] for row in rows]
    if not matrix:
        return 0
    row_count = len(matrix)
    column_count = len(matrix[0])
    rank = 0
    for column in range(column_count):
        pivot = max(range(rank, row_count), key=lambda row: abs(matrix[row][column]), default=rank)
        if abs(matrix[pivot][column]) <= tolerance:
            continue
        matrix[rank], matrix[pivot] = matrix[pivot], matrix[rank]
        pivot_value = matrix[rank][column]
        matrix[rank] = [value / pivot_value for value in matrix[rank]]
        for row in range(row_count):
            if row == rank:
                continue
            factor = matrix[row][column]
            if abs(factor) <= tolerance:
                continue
            matrix[row] = [value - factor * pivot_value for value, pivot_value in zip(matrix[row], matrix[rank])]
        rank += 1
        if rank == row_count:
            break
    return rank


def xorshift32(value: int) -> int:
    value &= 0xFFFFFFFF
    value ^= (value << 13) & 0xFFFFFFFF
    value ^= value >> 17
    value ^= (value << 5) & 0xFFFFFFFF
    return value & 0xFFFFFFFF


def deterministic_control_design(
    seed: int,
    setting_count: int,
    sampled_controls: list[str],
    ranges: dict[str, tuple[float, float]],
    correction: dict[str, Any] | None = None,
) -> list[dict[str, float]]:
    columns: list[list[float]] = []
    for control_index, name in enumerate(sampled_controls):
        permutation = list(range(setting_count))
        state = (seed ^ (((control_index + 1) * 0x9E3779B9) & 0xFFFFFFFF)) & 0xFFFFFFFF
        if state == 0:
            state = 0x6D2B79F5
        for index in range(setting_count - 1, 0, -1):
            state = xorshift32(state)
            swap_index = state % (index + 1)
            permutation[index], permutation[swap_index] = permutation[swap_index], permutation[index]
        minimum, maximum = ranges[name]
        columns.append([
            minimum + (maximum - minimum) * level / (setting_count - 1)
            for level in permutation
        ])
    design = [
        {name: columns[control_index][setting_index] for control_index, name in enumerate(sampled_controls)}
        for setting_index in range(setting_count)
    ]
    if correction is not None:
        control = correction["control"]
        setting_a = correction["settingAIndex"]
        setting_b = correction["settingBIndex"]
        design[setting_a][control], design[setting_b][control] = (
            design[setting_b][control], design[setting_a][control]
        )
    return design


def validate_design_evidence(
    design: dict[str, Any],
    settings: list[dict[str, Any]],
    sampled_controls: list[str],
) -> dict[str, Any]:
    ranges_value = require_object(design.get("controlRanges"), "design.controlRanges")
    if set(ranges_value) != set(sampled_controls):
        raise CorpusError("design.controlRanges must exactly cover sampledControls")
    ranges: dict[str, tuple[float, float]] = {}
    for name in sampled_controls:
        bounds = ranges_value[name]
        if not isinstance(bounds, list) or len(bounds) != 2:
            raise CorpusError(f"design.controlRanges.{name} must be [minimum, maximum]")
        minimum = require_finite_number(bounds[0], f"design.controlRanges.{name}[0]")
        maximum = require_finite_number(bounds[1], f"design.controlRanges.{name}[1]")
        if minimum >= maximum:
            raise CorpusError(f"design.controlRanges.{name} minimum must be below maximum")
        ranges[name] = (minimum, maximum)

    matrix = []
    coverage: dict[str, dict[str, Any]] = {}
    for setting in settings:
        matrix.append([1.0, *[float(setting["effectiveControls"][name]) for name in sampled_controls]])
    for name in sampled_controls:
        minimum, maximum = ranges[name]
        epsilon = max(1e-9, (maximum - minimum) * 1e-7)
        values = [float(setting["effectiveControls"][name]) for setting in settings]
        if any(value < minimum - epsilon or value > maximum + epsilon for value in values):
            raise CorpusError(f"effective control {name} falls outside its declared legal range")
        boundary = any(abs(value - minimum) <= epsilon or abs(value - maximum) <= epsilon for value in values)
        interior = any(minimum + epsilon < value < maximum - epsilon for value in values)
        coverage[name] = {
            "minimum": minimum,
            "maximum": maximum,
            "boundary": boundary,
            "interior": interior,
        }
        if not boundary or not interior:
            raise CorpusError(f"sampled control {name} lacks computed boundary or interior coverage")
    rank = matrix_rank(matrix)
    required_rank = len(sampled_controls) + 1
    if rank != required_rank:
        raise CorpusError(f"computed control design rank {rank} does not meet required rank {required_rank}")
    return {"rank": rank, "requiredRank": required_rank, "coverage": coverage}


def identity_projection(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: identity_projection(child)
            for key, child in value.items()
            if key not in {
                "path",
                "capturesManifest",
                "capturesManifestBytes",
                "capturesManifestSha256",
            }
        }
    if isinstance(value, list):
        return [identity_projection(child) for child in value]
    return value


def build_corpus(
    captures_path: Path,
    held_out_ids: list[str],
    out_dir: Path,
    phase_state: dict[str, str],
) -> dict[str, Any]:
    phase_state["phase"] = "captures-manifest-read"
    capture_bytes = captures_path.read_bytes()
    captures_sha = sha256_bytes(capture_bytes)
    captures = json.loads(capture_bytes.decode("utf-8"))
    if captures.get("schema") != CAPTURE_SCHEMA:
        raise CorpusError(f"captures schema must be {CAPTURE_SCHEMA}")
    if captures.get("authority") != CAPTURE_AUTHORITY:
        raise CorpusError(f"captures authority must be {CAPTURE_AUTHORITY}")
    for key in ("positivePartitionIdentity", "completeFlameIdentity", "nonRidgeTargetIdentity"):
        require_string(captures.get(key), key)
    if captures.get("cohort") != "full-grid":
        raise CorpusError("this first assay requires an uncapped full-grid cohort")
    if captures.get("worldPositionIdentity") != "grid-cell-center-world-position-v0":
        raise CorpusError("worldPositionIdentity must be grid-cell-center-world-position-v0")

    manifest_dir = captures_path.parent
    phase_state["phase"] = "source-authority-validation"
    frozen_authority = validate_frozen_authority(captures.get("frozenAuthority"), "frozenAuthority")
    frozen_state_artifact = validate_binary_artifact(
        manifest_dir,
        captures.get("frozenStateArtifact"),
        "frozen-simulator-state",
        "frozenStateArtifact",
    )
    if frozen_authority["stateHash"] != frozen_state_artifact["sha256"]:
        raise CorpusError("frozenAuthority.stateHash does not bind frozenStateArtifact")

    phase_state["phase"] = "design-validation"
    design = require_object(captures.get("design"), "design")
    reject_hidden_limits(design)
    if design.get("identity") != "deterministic-space-filling-randomized-controls-v0":
        raise CorpusError("design identity must name deterministic space-filling randomized controls")
    if design.get("generatorIdentity") != "deterministic-latin-hypercube-boundary-v0":
        raise CorpusError("design.generatorIdentity must be deterministic-latin-hypercube-boundary-v0")
    design_seed = require_int(design.get("seed"), "design.seed")
    sampled_controls = require_order(design.get("sampledControls"), "design.sampledControls")
    if sampled_controls != REQUIRED_CAUSAL_CONTROLS:
        raise CorpusError("design.sampledControls must preserve the complete operator-authorized causal control order")
    if design.get("retentionPolicy") != "retain-all-admitted-settings-and-rows-uncapped-v0":
        raise CorpusError("design retentionPolicy must preserve every admitted setting and row without a cap")
    if design.get("negativeControlPolicy") != EXACT_ONE_NEGATIVE_POLICY:
        raise CorpusError(f"design.negativeControlPolicy must be {EXACT_ONE_NEGATIVE_POLICY}")
    design_correction = require_object(design.get("designCorrection"), "design.designCorrection")
    if design_correction != EXPECTED_DESIGN_CORRECTION:
        raise CorpusError("design.designCorrection must match the measured one-black single-axis transposition")
    if design.get("campaignStatus") != "capture-tranche-complete-awaiting-verdict-v0":
        raise CorpusError("first corpus must remain capture-tranche-complete-awaiting-verdict-v0")

    phase_state["phase"] = "feature-leakage-validation"
    feature_views = require_object(captures.get("featureViews"), "featureViews")
    current_view = require_object(feature_views.get("current16"), "featureViews.current16")
    augmented_view = require_object(feature_views.get("sourceComplete"), "featureViews.sourceComplete")
    current_order = require_order(current_view.get("order"), "featureViews.current16.order")
    augmented_order = require_order(augmented_view.get("order"), "featureViews.sourceComplete.order")
    target_order = require_order(require_object(captures.get("targets"), "targets").get("order"), "targets.order")
    if current_order != CURRENT16:
        raise CorpusError("Current-16 order does not match the live candidate ABI")
    if target_order != REQUIRED_TARGETS:
        raise CorpusError("target order must preserve membership, RGB emission, and extinction separately")
    if augmented_order != [*CURRENT16, *SOURCE_COMPLETE_ADDITIONS]:
        raise CorpusError("source-complete view must use the selected minimal independent source basis")
    if augmented_view.get("sourceBasisIdentity") != "nonridge-minimal-independent-source-basis-v0":
        raise CorpusError("sourceComplete.sourceBasisIdentity does not match the selected source basis")
    current_provenance = require_object(current_view.get("provenance"), "featureViews.current16.provenance")
    augmented_provenance = require_object(augmented_view.get("provenance"), "featureViews.sourceComplete.provenance")
    if set(current_provenance) != set(current_order) or set(augmented_provenance) != set(augmented_order):
        raise CorpusError("feature provenance must exactly cover each feature view")
    for channel in current_order:
        if current_provenance[channel] != "candidate-source-current16":
            raise CorpusError(f"Current-16 feature {channel} lacks candidate-source-current16 provenance")
    for index, channel in enumerate(augmented_order):
        expected = "candidate-source-current16" if index < len(CURRENT16) else "candidate-source-independent"
        if augmented_provenance[channel] != expected or augmented_provenance[channel] not in ALLOWED_FEATURE_PROVENANCE:
            raise CorpusError(f"feature {channel} has renderer-target or untrusted provenance {augmented_provenance[channel]}")
    forbidden_features = [
        channel for channel in [*current_order, *augmented_order]
        if channel.startswith("control.") or channel.startswith("target.") or channel in target_order
    ]
    if forbidden_features:
        raise CorpusError(f"feature views contain control or target leakage: {forbidden_features}")

    phase_state["phase"] = "split-validation"
    settings_value = captures.get("settings")
    if not isinstance(settings_value, list) or len(settings_value) < 2:
        raise CorpusError("captures must contain at least two complete control settings")
    settings = [require_object(value, f"settings[{index}]") for index, value in enumerate(settings_value)]
    setting_ids = [require_string(setting.get("id"), f"settings[{index}].id") for index, setting in enumerate(settings)]
    if len(setting_ids) != len(set(setting_ids)):
        raise CorpusError("control setting ids must be unique")
    expected_ids = design.get("expectedSettingIds")
    admitted_ids = design.get("admittedSettingIds")
    rejected_settings = design.get("rejectedSettings")
    if not isinstance(expected_ids, list) or not isinstance(admitted_ids, list) or not isinstance(rejected_settings, list):
        raise CorpusError("design must preserve expected, admitted, and rejected setting ledgers")
    expected_ids = [require_string(value, f"design.expectedSettingIds[{index}]") for index, value in enumerate(expected_ids)]
    admitted_ids = [require_string(value, f"design.admittedSettingIds[{index}]") for index, value in enumerate(admitted_ids)]
    rejected_ids = [
        require_string(require_object(value, f"design.rejectedSettings[{index}]").get("id"), f"design.rejectedSettings[{index}].id")
        for index, value in enumerate(rejected_settings)
    ]
    if len(expected_ids) != len(set(expected_ids)) or len(admitted_ids) != len(set(admitted_ids)) or len(rejected_ids) != len(set(rejected_ids)):
        raise CorpusError("design setting ledgers must not contain duplicate ids")
    if set(expected_ids) != set(admitted_ids) | set(rejected_ids) or set(admitted_ids) & set(rejected_ids):
        raise CorpusError("expected settings must equal the disjoint admitted and rejected ledgers")
    if admitted_ids != setting_ids:
        raise CorpusError("settings must exactly preserve design.admittedSettingIds order")
    if rejected_ids or expected_ids != admitted_ids:
        phase_state["phase"] = "design-validation"
        raise CorpusError("legal deterministic design points must all be admitted without beauty filtering")
    held_out_set = set(held_out_ids)
    if not held_out_set:
        raise CorpusError("at least one --held-out-setting is required")
    unknown_holdouts = sorted(held_out_set - set(setting_ids))
    if unknown_holdouts:
        raise CorpusError(f"held-out setting ids are missing from captures: {unknown_holdouts}")
    if held_out_set == set(setting_ids):
        raise CorpusError("whole-setting holdout cannot consume every setting")

    phase_state["phase"] = "artifact-validation"
    output_settings = []
    total_rows = 0
    negative_settings = 0
    train_ids = []
    held_ids = []
    controls_hashes: dict[str, str] = {}
    for setting_index, setting in enumerate(settings):
        setting_id = setting_ids[setting_index]
        phase_state["phase"] = "split-validation"
        requested_controls = validate_controls(setting.get("requestedControls"), f"{setting_id}.requestedControls", sampled_controls)
        effective_controls = validate_controls(setting.get("effectiveControls"), f"{setting_id}.effectiveControls", sampled_controls)
        gpu_effective_controls = validate_controls(
            setting.get("gpuEffectiveControls"),
            f"{setting_id}.gpuEffectiveControls",
            sampled_controls,
        )
        negative_control = setting.get("negativeControl")
        if not isinstance(negative_control, bool):
            raise CorpusError(f"{setting_id}.negativeControl must be boolean")
        expected_negative_predicate = "all-targets-zero-v0" if negative_control else None
        if setting.get("negativeControlPredicate") != expected_negative_predicate:
            raise CorpusError(f"{setting_id}.negativeControlPredicate must be {expected_negative_predicate!r}")
        negative_settings += int(negative_control)
        rows = require_object(setting.get("rows"), f"{setting_id}.rows")
        row_count = require_int(rows.get("count"), f"{setting_id}.rows.count", 1)

        phase_state["phase"] = "source-authority-validation"
        source = require_object(setting.get("source"), f"{setting_id}.source")
        normalized_source = validate_frozen_authority(source, f"{setting_id}.source")
        if normalized_source != frozen_authority:
            differing = [key for key in FROZEN_SOURCE_KEYS if normalized_source.get(key) != frozen_authority.get(key)]
            raise CorpusError(f"{setting_id} differs from frozen source authority: {differing}")
        if math.prod(normalized_source["gridShape"]) != row_count:
            raise CorpusError(f"{setting_id}.source.gridShape does not match rows.count")
        controls_hash = require_sha256(source.get("controlsHash"), f"{setting_id}.source.controlsHash")
        computed_controls_hash = sha256_bytes(canonical_json(effective_controls).encode("utf-8"))
        if controls_hash != computed_controls_hash:
            raise CorpusError(f"{setting_id}.source.controlsHash does not bind effectiveControls")
        if controls_hash in controls_hashes:
            phase_state["phase"] = "split-validation"
            raise CorpusError(f"effective control setting duplicates {controls_hashes[controls_hash]} as {setting_id}")
        controls_hashes[controls_hash] = setting_id

        phase_state["phase"] = "artifact-validation"
        normalized_rows = {
            "count": row_count,
            "worldPosition": validate_f32_artifact(
                manifest_dir, rows.get("worldPosition"), [row_count, 3],
                "grid-cell-center-world-position", f"{setting_id}.rows.worldPosition",
            ),
            "current16": validate_f32_artifact(
                manifest_dir, rows.get("current16"), [row_count, len(current_order)],
                "candidate-features-current16", f"{setting_id}.rows.current16",
            ),
            "sourceComplete": validate_f32_artifact(
                manifest_dir, rows.get("sourceComplete"), [row_count, len(augmented_order)],
                "candidate-features-source-complete", f"{setting_id}.rows.sourceComplete",
            ),
            "targets": validate_f32_artifact(
                manifest_dir, rows.get("targets"), [row_count, len(target_order)],
                "supervision-targets-positive-nonridge", f"{setting_id}.rows.targets",
            ),
        }
        source_basis_value = require_object(rows.get("sourceBasis"), f"{setting_id}.rows.sourceBasis")
        if set(source_basis_value) != set(SOURCE_COMPLETE_ADDITIONS):
            raise CorpusError(f"{setting_id}.rows.sourceBasis must exactly cover the selected source basis")
        normalized_rows["sourceBasis"] = {
            channel: validate_f32_artifact(
                manifest_dir,
                source_basis_value[channel],
                [row_count, 1],
                f"candidate-source-field:{channel}",
                f"{setting_id}.rows.sourceBasis.{channel}",
            )
            for channel in SOURCE_COMPLETE_ADDITIONS
        }
        phase_state["phase"] = "source-authority-validation"
        if normalized_rows["worldPosition"]["sha256"] != normalized_source["gridHash"]:
            raise CorpusError(f"{setting_id}.source.gridHash does not bind worldPosition evidence")
        phase_state["phase"] = "spatial-cohort-validation"
        validate_world_positions(
            normalized_rows["worldPosition"],
            normalized_source["gridShape"],
            normalized_source["gridOrigin"],
            normalized_source["gridSpacing"],
        )
        phase_state["phase"] = "feature-parity-validation"
        validate_feature_parity(normalized_rows["current16"], normalized_rows["sourceComplete"], row_count)
        validate_source_basis_parity(normalized_rows["sourceComplete"], normalized_rows["sourceBasis"], row_count)
        phase_state["phase"] = "target-semantics-validation"
        target_summary = validate_target_semantics(normalized_rows["targets"], row_count, negative_control)

        split_role = "heldOut" if setting_id in held_out_set else "train"
        (held_ids if split_role == "heldOut" else train_ids).append(setting_id)
        total_rows += row_count
        output_settings.append({
            "id": setting_id,
            "effectiveControlIdentity": "sha256:" + controls_hash,
            "splitRole": split_role,
            "negativeControl": negative_control,
            "negativeControlPredicate": expected_negative_predicate,
            "requestedControls": requested_controls,
            "effectiveControls": effective_controls,
            "gpuEffectiveControls": gpu_effective_controls,
            "source": {**normalized_source, "controlsHash": controls_hash},
            "rows": normalized_rows,
            "targetSummary": target_summary,
        })

    phase_state["phase"] = "negative-control-policy"
    if negative_settings != 1:
        raise CorpusError(
            "first learner slate must contain exactly one measured all-target-zero control; "
            f"observed {negative_settings}"
        )

    phase_state["phase"] = "split-validation"
    split_target_coverage: dict[str, dict[str, int]] = {}
    for split_role in ("train", "heldOut"):
        split_settings = [setting for setting in output_settings if setting["splitRole"] == split_role]
        summary = {
            key: sum(setting["targetSummary"][key] for setting in split_settings)
            for key in ("positiveMembershipRows", "negativeMembershipRows", "positiveOpticalRows")
        }
        if any(summary[key] == 0 for key in summary):
            raise CorpusError(
                f"{split_role} split lacks positive/negative membership or positive optical evidence: {summary}"
            )
        split_target_coverage[split_role] = summary

    phase_state["phase"] = "design-validation"
    computed_design = validate_design_evidence(design, output_settings, sampled_controls)
    ranges = {
        name: tuple(float(value) for value in design["controlRanges"][name])
        for name in sampled_controls
    }
    generated_controls = deterministic_control_design(
        design_seed,
        len(output_settings),
        sampled_controls,
        ranges,
        design_correction,
    )
    for setting, generated in zip(output_settings, generated_controls):
        for name in sampled_controls:
            expected = generated[name]
            for receipt in ("requestedControls", "effectiveControls"):
                if not math.isclose(float(setting[receipt][name]), expected, rel_tol=0.0, abs_tol=1e-12):
                    raise CorpusError(f"{setting['id']}.{receipt} does not replay from design seed for {name}")
            if float(setting["gpuEffectiveControls"][name]) != float32(expected):
                raise CorpusError(f"{setting['id']}.gpuEffectiveControls does not replay from design seed for {name}")

    phase_state["phase"] = "manifest-write"
    normalized_design = {
        **design,
        "computed": computed_design,
        "expectedSettingCount": len(expected_ids),
        "admittedSettingCount": len(admitted_ids),
        "rejectedSettingCount": len(rejected_ids),
    }
    corpus = {
        "schema": CORPUS_SCHEMA,
        "status": "complete",
        "assayStatus": design["campaignStatus"],
        "verdictAuthority": None,
        "failurePhase": None,
        "authority": "checksum-bound-randomized-nonridge-source-basis-v0",
        "source": {
            "capturesManifest": str(captures_path),
            "capturesManifestBytes": len(capture_bytes),
            "capturesManifestSha256": captures_sha,
            "captureAuthority": CAPTURE_AUTHORITY,
        },
        "positivePartitionIdentity": captures["positivePartitionIdentity"],
        "completeFlameIdentity": captures["completeFlameIdentity"],
        "nonRidgeTargetIdentity": captures["nonRidgeTargetIdentity"],
        "frozenAuthority": frozen_authority,
        "frozenStateArtifact": frozen_state_artifact,
        "design": normalized_design,
        "cohort": {
            "identity": "full-grid",
            "worldPositionIdentity": captures["worldPositionIdentity"],
            "retentionPolicy": design["retentionPolicy"],
            "expectedSettingCount": len(expected_ids),
            "retainedSettingCount": len(output_settings),
            "rejectedSettingCount": len(rejected_ids),
            "negativeControlSettingCount": negative_settings,
            "totalRows": total_rows,
            "droppedRowCount": 0,
            "sampleCap": None,
        },
        "featureViews": {
            "current16": {
                "identity": "live-boundary-candidate-current16-v0",
                "order": current_order,
                "provenance": current_provenance,
                "includesControls": False,
                "includesTargets": False,
            },
            "sourceComplete": {
                "identity": "current16-plus-independent-source-evidence-v0",
                "order": augmented_order,
                "provenance": augmented_provenance,
                "includesControls": False,
                "includesTargets": False,
            },
        },
        "targets": {
            "identity": "positive-nonridge-membership-emission-extinction-v0",
            "order": target_order,
            "semanticRole": "supervision-only",
            "membershipTeacherLeakageIntoFeatures": False,
        },
        "controls": {
            "storage": "setting-level-separate-from-local-feature-views-v0",
            "sampledControlOrder": sampled_controls,
            "conditionedArm": None,
        },
        "splits": {
            "identity": "whole-effective-control-setting-holdout-v0",
            "targetCoverage": split_target_coverage,
            "train": {
                "settingIds": sorted(train_ids),
                "effectiveControlIdentities": sorted(
                    setting["effectiveControlIdentity"] for setting in output_settings if setting["splitRole"] == "train"
                ),
            },
            "heldOut": {
                "settingIds": sorted(held_ids),
                "effectiveControlIdentities": sorted(
                    setting["effectiveControlIdentity"] for setting in output_settings if setting["splitRole"] == "heldOut"
                ),
            },
        },
        "ablations": [
            {
                "channel": channel,
                "sourceCompleteIndex": index,
                "baselineView": "current16",
                "ablation": "source-complete-drop-one-channel-v0",
            }
            for index, channel in enumerate(augmented_order)
            if index >= len(CURRENT16)
        ],
        "settings": output_settings,
        "lastTrustworthyEvidence": {
            "capturesManifestSha256": captures_sha,
            "validatedSettingCount": len(output_settings),
            "validatedRowCount": total_rows,
        },
    }
    corpus["identity"] = "sha256:" + sha256_bytes(canonical_json(identity_projection(corpus)).encode("utf-8"))
    atomic_json(out_dir / "corpus-manifest.json", corpus)
    return corpus


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures-manifest", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--held-out-setting", action="append", default=[])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    clear_status_artifacts(out_dir)
    captures_path = args.captures_manifest.resolve()
    last_trustworthy: dict[str, Any] = {"capturesManifest": str(captures_path)}
    phase_state = {"phase": "captures-manifest-read"}
    try:
        if captures_path.is_file():
            capture_bytes = captures_path.read_bytes()
            last_trustworthy["capturesManifestBytes"] = len(capture_bytes)
            last_trustworthy["capturesManifestSha256"] = sha256_bytes(capture_bytes)
        build_corpus(captures_path, args.held_out_setting, out_dir, phase_state)
        return 0
    except Exception as error:  # The durable failure report is part of the evidence contract.
        try:
            (out_dir / "corpus-manifest.json").unlink()
        except FileNotFoundError:
            pass
        failure = {
            "schema": FAILURE_SCHEMA,
            "status": "failed",
            "failurePhase": phase_state["phase"],
            "message": str(error),
            "lastTrustworthyEvidence": last_trustworthy,
        }
        atomic_json(out_dir / "failure-report.json", failure)
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
