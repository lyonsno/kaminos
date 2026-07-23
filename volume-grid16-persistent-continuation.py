#!/usr/bin/env python3
"""Continue a fixed Grid16 optical-mode cohort across exact simulator states."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import traceback
from typing import Any
import zlib

import numpy as np


CONTINUATION_SCHEMA = "kaminos.volume.grid16-persistent-continuation.v0"
CONTINUATION_IDENTITY = "fixed-count-frozen-advected-bounded-exclusive-v0"


def load_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {name}: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


FITTER = load_module(Path(__file__).with_name("volume-multiscale-fitting-sequence.py"), "grid16_sequence_fitter")


def sparse_soft_ownership(
    medium: Any,
    centers: np.ndarray,
    *,
    soft_neighbors: int,
    temperature_cells: float,
) -> np.ndarray:
    mode_positions = np.asarray(centers, dtype=np.float64)
    FITTER.require(mode_positions.ndim == 2 and mode_positions.shape[1] == 3, "mode centers must be an M-by-3 matrix")
    mode_count = mode_positions.shape[0]
    FITTER.require(0 < soft_neighbors <= mode_count, "soft neighbor count is invalid")
    scale = float(np.mean(medium.spacing)) * temperature_cells
    FITTER.require(math.isfinite(scale) and scale > 0.0, "soft assignment temperature is invalid")
    squared_distance = np.sum(np.square(medium.positions[:, None, :] - mode_positions[None, :, :]), axis=2)
    nearest = np.argpartition(squared_distance, soft_neighbors - 1, axis=1)[:, :soft_neighbors]
    selected_distance = np.take_along_axis(squared_distance, nearest, axis=1)
    logits = -0.5 * selected_distance / (scale * scale)
    logits -= np.max(logits, axis=1, keepdims=True)
    selected_weights = np.exp(logits)
    selected_weights /= np.sum(selected_weights, axis=1, keepdims=True)
    ownership = np.zeros_like(squared_distance)
    ownership[np.arange(medium.positions.shape[0])[:, None], nearest] = selected_weights
    FITTER.require(np.allclose(np.sum(ownership, axis=1), 1.0), "soft optical ownership is not conservative")
    return ownership


def unique_mode_anchors(source_positions: np.ndarray, centers: np.ndarray) -> np.ndarray:
    squared_distance = np.sum(np.square(source_positions[:, None, :] - centers[None, :, :]), axis=2)
    FITTER.require(source_positions.shape[0] >= centers.shape[0], "source cells cannot anchor every persistent mode")
    available = np.ones(source_positions.shape[0], dtype=bool)
    anchors = np.empty(centers.shape[0], dtype=np.int64)
    mode_order = np.argsort(np.min(squared_distance, axis=0), kind="stable")
    for mode_index in mode_order:
        ranked = np.argsort(squared_distance[:, mode_index], kind="stable")
        source_index = int(ranked[np.flatnonzero(available[ranked])[0]])
        anchors[mode_index] = source_index
        available[source_index] = False
    return anchors


def exclusive_geometry_ownership(medium: Any, centers: np.ndarray, soft_ownership: np.ndarray) -> np.ndarray:
    owner = np.argmax(soft_ownership, axis=1)
    anchors = unique_mode_anchors(medium.positions, centers)
    owner[anchors] = np.arange(centers.shape[0])
    result = np.eye(centers.shape[0], dtype=np.float64)[owner]
    FITTER.require(np.all(np.sum(result, axis=0) > 0.0), "exclusive continuation retired a persistent mode")
    return result


def restrict_weighted_velocity(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    velocities: np.ndarray,
    medium: Any,
) -> tuple[np.ndarray, dict[str, Any]]:
    ids = np.asarray(native_ids)
    values = np.asarray(coefficients, dtype=np.float64)
    flow = np.asarray(velocities, dtype=np.float64)
    FITTER.require(ids.ndim == 1 and values.shape == (ids.size, 8), "velocity source optical rows are misaligned")
    FITTER.require(flow.shape == (ids.size, 3) and np.all(np.isfinite(flow)), "velocity source rows are invalid")
    selected, _ = FITTER.population_coefficients(values, medium.population)
    weights = FITTER.optical_weight(selected)
    factor = medium.source_grid // medium.grid
    source_cells = np.stack(
        (ids % medium.source_grid, (ids // medium.source_grid) % medium.source_grid, ids // (medium.source_grid**2)),
        axis=1,
    ).astype(np.int64)
    coarse_cells = source_cells // factor
    coarse_ids = coarse_cells[:, 0] + medium.grid * (coarse_cells[:, 1] + medium.grid * coarse_cells[:, 2])
    weighted_velocity = np.zeros((medium.grid**3, 3), dtype=np.float64)
    weight_mass = np.zeros(medium.grid**3, dtype=np.float64)
    np.add.at(weighted_velocity, coarse_ids, flow * weights[:, None])
    np.add.at(weight_mass, coarse_ids, weights)
    active_mass = weight_mass[medium.coarse_cell_ids]
    restricted_velocity = np.zeros((medium.coarse_cell_ids.size, 3), dtype=np.float64)
    covered = active_mass > 0.0
    restricted_velocity[covered] = weighted_velocity[medium.coarse_cell_ids[covered]] / active_mass[covered, None]
    return restricted_velocity, {
        "identity": "population-optical-weighted-grid-restriction-velocity-v0",
        "sourceRowCount": int(ids.size),
        "restrictedCellCount": int(medium.coarse_cell_ids.size),
        "uncoveredRestrictedCellCount": int(np.count_nonzero(~covered)),
        "population": medium.population,
    }


def aggregate_mode_velocity(
    source_medium: Any,
    seed_state: Any,
    restricted_cell_velocities: np.ndarray,
    *,
    soft_neighbors: int,
    temperature_cells: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    cell_velocity = np.asarray(restricted_cell_velocities, dtype=np.float64)
    FITTER.require(cell_velocity.shape == source_medium.positions.shape, "restricted cell velocities are misaligned")
    ownership = sparse_soft_ownership(
        source_medium,
        seed_state.positions,
        soft_neighbors=soft_neighbors,
        temperature_cells=temperature_cells,
    )
    weighted_ownership = ownership * np.maximum(FITTER.optical_weight(source_medium.coefficients), 1e-12)[:, None]
    mode_mass = np.sum(weighted_ownership, axis=0, dtype=np.float64)
    FITTER.require(np.all(mode_mass > 0.0), "velocity aggregation found an unsupported persistent mode")
    mode_velocity = np.einsum("nm,ni->mi", weighted_ownership, cell_velocity, optimize=True) / mode_mass[:, None]
    return mode_velocity, {
        "identity": "source-state-soft-optical-mode-velocity-v0",
        "modeCount": int(seed_state.mode_ids.size),
        "maximumSpeed": float(np.max(np.linalg.norm(mode_velocity, axis=1))),
        "meanSpeed": float(np.mean(np.linalg.norm(mode_velocity, axis=1))),
    }


def fixed_geometry_state(target_medium: Any, seed_state: Any, positions: np.ndarray, covariances: np.ndarray, ownership: np.ndarray) -> Any:
    coefficients = ownership.T @ target_medium.coefficients
    owner = np.argmax(ownership, axis=1)
    counts = np.bincount(owner, minlength=seed_state.mode_ids.size).astype(np.uint32)
    source_weights = np.maximum(FITTER.optical_weight(target_medium.coefficients), 1e-12)
    squared_distance = np.sum(np.square(target_medium.positions[:, None, :] - positions[None, :, :]), axis=2)
    objective = float(np.sum(ownership * source_weights[:, None] * squared_distance))
    return FITTER.ModeState(
        iteration=1,
        mode_ids=seed_state.mode_ids.copy(),
        positions=np.asarray(positions, dtype=np.float64).copy(),
        covariances=np.asarray(covariances, dtype=np.float64).copy(),
        coefficients=coefficients,
        source_row_counts=counts,
        objective=objective,
        maximum_position_delta=float(np.max(np.linalg.norm(positions - seed_state.positions, axis=1))),
    )


def bounded_covariances(seed_covariances: np.ndarray, candidates: np.ndarray, relative_limit: float) -> tuple[np.ndarray, int]:
    FITTER.require(0.0 <= relative_limit <= 1.0, "covariance relative limit must lie in [0, 1]")
    result = np.empty_like(seed_covariances)
    clipped = 0
    for index, (seed, candidate) in enumerate(zip(seed_covariances, candidates, strict=True)):
        delta = candidate - seed
        allowed = relative_limit * max(float(np.linalg.norm(seed)), 1e-12)
        magnitude = float(np.linalg.norm(delta))
        scale = min(1.0, allowed / magnitude) if magnitude > 0.0 else 1.0
        clipped += int(scale < 1.0)
        covariance = seed + scale * delta
        covariance = 0.5 * (covariance + covariance.T)
        eigenvalues, eigenvectors = np.linalg.eigh(covariance)
        result[index] = (eigenvectors * np.maximum(eigenvalues, 1e-12)) @ eigenvectors.T
    return result, clipped


def continue_optical_modes(
    *,
    target_medium: Any,
    seed_state: Any,
    mode_velocities: np.ndarray,
    dt_seconds: float,
    arm: str,
    soft_neighbors: int,
    temperature_cells: float,
    trust_radius_cells: float,
    covariance_relative_limit: float,
) -> tuple[Any, dict[str, Any]]:
    FITTER.require(arm in ("frozen", "advected", "advected-bounded-exclusive"), f"unknown continuation arm: {arm}")
    velocity = np.asarray(mode_velocities, dtype=np.float64)
    FITTER.require(velocity.shape == seed_state.positions.shape and np.all(np.isfinite(velocity)), "mode velocities are invalid")
    FITTER.require(math.isfinite(dt_seconds) and dt_seconds >= 0.0, "continuation time delta is invalid")
    predicted = seed_state.positions.copy() if arm == "frozen" else seed_state.positions + velocity * dt_seconds
    ownership = sparse_soft_ownership(
        target_medium,
        predicted,
        soft_neighbors=soft_neighbors,
        temperature_cells=temperature_cells,
    )
    clipped_positions = 0
    clipped_covariances = 0
    if arm != "advected-bounded-exclusive":
        state = fixed_geometry_state(target_medium, seed_state, predicted, seed_state.covariances, ownership)
        geometry_policy = "seed-state-frozen" if arm == "frozen" else "seed-state-velocity-advected"
    else:
        exclusive = exclusive_geometry_ownership(target_medium, predicted, ownership)
        candidate = FITTER.state_from_responsibilities(
            target_medium,
            exclusive,
            predicted,
            1,
            coefficient_responsibilities=ownership,
        )
        trust_radius = float(np.mean(target_medium.spacing)) * trust_radius_cells
        FITTER.require(math.isfinite(trust_radius) and trust_radius >= 0.0, "position trust radius is invalid")
        correction = candidate.positions - predicted
        correction_norm = np.linalg.norm(correction, axis=1)
        scale = np.ones_like(correction_norm)
        positive = correction_norm > trust_radius
        if trust_radius == 0.0:
            scale[correction_norm > 0.0] = 0.0
        else:
            scale[positive] = trust_radius / correction_norm[positive]
        corrected_positions = predicted + correction * scale[:, None]
        clipped_positions = int(np.count_nonzero(scale < 1.0))
        corrected_covariances, clipped_covariances = bounded_covariances(
            seed_state.covariances,
            candidate.covariances,
            covariance_relative_limit,
        )
        corrected_ownership = sparse_soft_ownership(
            target_medium,
            corrected_positions,
            soft_neighbors=soft_neighbors,
            temperature_cells=temperature_cells,
        )
        state = fixed_geometry_state(
            target_medium,
            seed_state,
            corrected_positions,
            corrected_covariances,
            corrected_ownership,
        )
        geometry_policy = "advected-one-step-exclusive-trust-region"
    expected_mass = np.sum(target_medium.coefficients, axis=0, dtype=np.float64)
    FITTER.require(
        np.allclose(np.sum(state.coefficients, axis=0, dtype=np.float64), expected_mass, rtol=1e-10, atol=1e-8),
        "persistent continuation lost target optical ownership",
    )
    FITTER.require(np.array_equal(state.mode_ids, seed_state.mode_ids), "persistent mode identity changed")
    return state, {
        "identity": CONTINUATION_IDENTITY,
        "arm": arm,
        "geometryPolicy": geometry_policy,
        "coefficientPolicy": "target-state-conservative-soft-ownership",
        "modeCount": int(state.mode_ids.size),
        "birthCount": 0,
        "deathCount": 0,
        "trustRegionClippedModeCount": clipped_positions,
        "covarianceClippedModeCount": clipped_covariances,
        "maximumSeedDisplacement": float(np.max(np.linalg.norm(state.positions - seed_state.positions, axis=1))),
        "maximumPredictedCorrection": float(np.max(np.linalg.norm(state.positions - predicted, axis=1))),
    }


def signed_delta_alignment(candidate_delta: np.ndarray, target_delta: np.ndarray) -> float:
    candidate = np.asarray(candidate_delta, dtype=np.float64).reshape(-1)
    target = np.asarray(target_delta, dtype=np.float64).reshape(-1)
    FITTER.require(candidate.shape == target.shape, "signed temporal deltas are misaligned")
    denominator = float(np.linalg.norm(candidate) * np.linalg.norm(target))
    return float(np.dot(candidate, target) / denominator) if denominator > 0.0 else 0.0


def load_json(path: Path, label: str) -> dict[str, Any]:
    FITTER.require(path.is_file(), f"{label} is missing: {path}")
    payload = json.loads(path.read_text())
    FITTER.require(isinstance(payload, dict), f"{label} is not a JSON object")
    return payload


def authenticate_exact_raymarch_targets(
    manifest_path: Path,
    state_ids: tuple[str, ...],
) -> dict[str, dict[str, Any]]:
    manifest_path = manifest_path.expanduser().resolve()
    manifest = load_json(manifest_path, "exact Raymarch motion manifest")
    FITTER.require(manifest.get("schema") == FITTER.EXPECTED_SOURCE_SCHEMA, "exact Raymarch manifest schema drifted")
    FITTER.require(manifest.get("status") == "complete", "exact Raymarch manifest is incomplete")
    FITTER.require(
        manifest.get("authority") == "single-browser-multi-state-exact-bilinear-motion-v0",
        "exact Raymarch manifest authority drifted",
    )
    route = manifest.get("route") or {}
    FITTER.require(route.get("effective") == FITTER.EXPECTED_ROUTE, "exact Raymarch effective route drifted")
    FITTER.require(route.get("backend") == "WebGPU:apple", "exact Raymarch backend drifted")
    FITTER.require(route.get("fallbackReason") is None, "exact Raymarch route used a fallback")
    states = {str(state.get("id")): state for state in manifest.get("states", []) if isinstance(state, dict)}
    authenticated: dict[str, dict[str, Any]] = {}
    held_camera_sha: str | None = None
    held_dimensions: tuple[int, int] | None = None
    for state_id in state_ids:
        state = states.get(state_id)
        FITTER.require(isinstance(state, dict), f"exact Raymarch state is missing: {state_id}")
        replay = state.get("replay") or {}
        expected_step = int(state_id.rsplit("-", 1)[-1])
        FITTER.require(int(replay.get("completedSteps", -1)) == expected_step, f"{state_id} replay step drifted")
        FITTER.require(replay.get("effectiveRoute") == FITTER.EXPECTED_ROUTE, f"{state_id} replay route drifted")
        FITTER.require(replay.get("backend") == "WebGPU:apple", f"{state_id} replay backend drifted")
        FITTER.require(int(replay.get("grid", 0)) == 96, f"{state_id} replay grid drifted")
        target = state.get("target") or {}
        FITTER.require(
            target.get("identity") == "ridge-plus-non-ridge-contributions-under-shared-transmittance-v0",
            f"{state_id} exact Raymarch target identity drifted",
        )
        FITTER.require(
            target.get("mode") == "shared-transmittance-contribution-sum",
            f"{state_id} exact Raymarch appearance mode drifted",
        )
        appearance = target.get("appearanceReceipt") or {}
        passes = appearance.get("passes") or {}
        FITTER.require(appearance.get("effectiveMode") == target.get("mode"), f"{state_id} appearance mode was not applied")
        FITTER.require(appearance.get("fallbackReason") is None, f"{state_id} appearance used a fallback")
        FITTER.require(passes.get("raymarchApplied") is True, f"{state_id} exact target did not apply Raymarch")
        FITTER.require(passes.get("splatsApplied") is False, f"{state_id} exact target is contaminated by splats")
        smoke = target.get("smokeReceipt") or {}
        FITTER.require(smoke.get("effectiveMode") == "off", f"{state_id} exact target smoke presentation drifted")
        FITTER.require(smoke.get("fallbackReason") is None, f"{state_id} smoke presentation used a fallback")
        target_path = Path(str(target.get("path", ""))).expanduser()
        if not target_path.is_absolute():
            target_path = manifest_path.parent / target_path
        target_path = target_path.resolve()
        FITTER.require(target_path.is_file(), f"{state_id} exact target is missing: {target_path}")
        FITTER.require(target_path.stat().st_size == int(target.get("bytes", -1)), f"{state_id} exact target byte length drifted")
        target_sha = FITTER.sha256_file(target_path)
        FITTER.require(target_sha == target.get("sha256"), f"{state_id} exact target hash drifted")
        declared_dimensions = (int(target.get("width", 0)), int(target.get("height", 0)))
        FITTER.require(all(value > 0 for value in declared_dimensions), f"{state_id} exact target dimensions are invalid")
        decoded_rgba = read_png_rgba8(target_path)
        actual_dimensions = (int(decoded_rgba.shape[1]), int(decoded_rgba.shape[0]))
        FITTER.require(actual_dimensions == declared_dimensions, f"{state_id} exact target dimensions drifted")
        pixel_sha = hashlib.sha256(np.ascontiguousarray(decoded_rgba).tobytes()).hexdigest()
        FITTER.require(pixel_sha == target.get("targetPixelSha256"), f"{state_id} exact target pixel hash drifted")
        FITTER.require(int(target.get("litPixels", 0)) > 0, f"{state_id} exact target is blank")
        FITTER.require(int(target.get("effectiveRaySteps", 0)) > 0, f"{state_id} exact Raymarch step count is missing")
        camera_sha = str(target.get("cameraPoseSha256", ""))
        FITTER.require(bool(camera_sha), f"{state_id} exact target camera identity is missing")
        held_camera_sha = held_camera_sha or camera_sha
        FITTER.require(camera_sha == held_camera_sha, "exact Raymarch targets do not share one held camera")
        held_dimensions = held_dimensions or declared_dimensions
        FITTER.require(declared_dimensions == held_dimensions, "exact Raymarch targets do not share one native pixel grid")
        authenticated[state_id] = {
            "stateId": state_id,
            "step": int(replay.get("completedSteps", 0)),
            "path": str(target_path),
            "bytes": target_path.stat().st_size,
            "sha256": target_sha,
            "targetPixelSha256": pixel_sha,
            "width": declared_dimensions[0],
            "height": declared_dimensions[1],
            "litPixels": int(target["litPixels"]),
            "effectiveRaySteps": int(target["effectiveRaySteps"]),
            "cameraPoseSha256": camera_sha,
            "effectiveRoute": replay["effectiveRoute"],
            "backend": replay["backend"],
            "targetIdentity": target["identity"],
            "scope": "full-flame-product-motion-context",
            "populationComparableToGrid16Ridge": False,
        }
    return authenticated


def read_png_rgba8(path: Path) -> np.ndarray:
    payload = path.read_bytes()
    FITTER.require(payload.startswith(b"\x89PNG\r\n\x1a\n"), f"exact target is not PNG: {path}")
    offset = 8
    width = height = bit_depth = color_type = interlace = 0
    compressed = bytearray()
    while offset < len(payload):
        FITTER.require(offset + 12 <= len(payload), f"exact target PNG is truncated: {path}")
        length = struct.unpack(">I", payload[offset : offset + 4])[0]
        kind = payload[offset + 4 : offset + 8]
        data = payload[offset + 8 : offset + 8 + length]
        FITTER.require(len(data) == length, f"exact target PNG chunk is truncated: {path}")
        offset += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", data)
            FITTER.require(compression == 0 and filtering == 0, f"exact target PNG encoding is unsupported: {path}")
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            break
    FITTER.require(width > 0 and height > 0 and bit_depth == 8, f"exact target PNG dimensions or depth are unsupported: {path}")
    FITTER.require(color_type in (2, 6) and interlace == 0, f"exact target PNG color/interlace is unsupported: {path}")
    channels = 3 if color_type == 2 else 4
    stride = width * channels
    raw = zlib.decompress(bytes(compressed))
    FITTER.require(len(raw) == height * (stride + 1), f"exact target PNG scanline length drifted: {path}")
    rows = np.empty((height, stride), dtype=np.uint8)
    previous = np.zeros(stride, dtype=np.uint8)
    cursor = 0
    for row_index in range(height):
        filter_kind = raw[cursor]
        encoded = np.frombuffer(raw, dtype=np.uint8, count=stride, offset=cursor + 1).copy()
        cursor += stride + 1
        decoded = np.empty(stride, dtype=np.uint8)
        for byte_index in range(stride):
            left = int(decoded[byte_index - channels]) if byte_index >= channels else 0
            above = int(previous[byte_index])
            upper_left = int(previous[byte_index - channels]) if byte_index >= channels else 0
            value = int(encoded[byte_index])
            if filter_kind == 1:
                value += left
            elif filter_kind == 2:
                value += above
            elif filter_kind == 3:
                value += (left + above) // 2
            elif filter_kind == 4:
                predictor = left + above - upper_left
                distances = (abs(predictor - left), abs(predictor - above), abs(predictor - upper_left))
                value += (left, above, upper_left)[int(np.argmin(distances))]
            else:
                FITTER.require(filter_kind == 0, f"exact target PNG filter is unsupported: {filter_kind}")
            decoded[byte_index] = value & 0xFF
        rows[row_index] = decoded
        previous = decoded
    pixels = rows.reshape(height, width, channels)
    if channels == 3:
        alpha = np.full((height, width, 1), 255, dtype=np.uint8)
        pixels = np.concatenate((pixels, alpha), axis=2)
    return pixels


def read_png_rgb8(path: Path) -> np.ndarray:
    return read_png_rgba8(path)[:, :, :3].astype(np.float64) / 255.0


def resize_bilinear_rgb(image: np.ndarray, width: int, height: int) -> np.ndarray:
    source = np.asarray(image, dtype=np.float64)
    FITTER.require(source.ndim == 3 and source.shape[2] == 3, "display reference must be RGB")
    FITTER.require(width > 0 and height > 0, "display reference dimensions are invalid")
    source_height, source_width, _ = source.shape
    x = np.clip((np.arange(width) + 0.5) * source_width / width - 0.5, 0.0, source_width - 1.0)
    y = np.clip((np.arange(height) + 0.5) * source_height / height - 0.5, 0.0, source_height - 1.0)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, source_width - 1)
    y1 = np.minimum(y0 + 1, source_height - 1)
    x_weight = (x - x0)[None, :, None]
    y_weight = (y - y0)[:, None, None]
    top = source[y0[:, None], x0[None, :]] * (1.0 - x_weight) + source[y0[:, None], x1[None, :]] * x_weight
    bottom = source[y1[:, None], x0[None, :]] * (1.0 - x_weight) + source[y1[:, None], x1[None, :]] * x_weight
    return top * (1.0 - y_weight) + bottom * y_weight


def load_sequence_state(path: Path, iteration: int) -> tuple[dict[str, Any], Any]:
    sequence = load_json(path, "fitting sequence")
    FITTER.require(sequence.get("schema") == FITTER.SEQUENCE_SCHEMA, "fitting sequence schema drifted")
    FITTER.require(sequence.get("status") == "captured", "fitting sequence is incomplete")
    solver = sequence.get("solver") or {}
    FITTER.require(solver.get("primitiveCount") == 48, "persistent assay requires the exact 48-mode seed/control")
    FITTER.require(solver.get("assignmentArm") == "soft-optics-exclusive-geometry", "seed/control assignment arm drifted")
    restriction = sequence.get("restriction") or {}
    FITTER.require(restriction.get("targetGrid") == 16 and restriction.get("population") == "ridge", "seed/control restriction drifted")
    frame = next((item for item in sequence.get("frames", []) if item.get("iteration") == iteration), None)
    FITTER.require(isinstance(frame, dict), f"fitting sequence iteration is missing: {iteration}")
    primitives = frame.get("primitives") or []
    FITTER.require(len(primitives) == 48, "fitting sequence primitive count drifted")
    world_center = np.asarray(sequence.get("worldCenter"), dtype=np.float64)
    FITTER.require(world_center.shape == (3,), "fitting sequence world center is missing")
    mode_ids = np.asarray([item["id"] for item in primitives], dtype=np.uint64)
    FITTER.require(np.array_equal(mode_ids, np.arange(48, dtype=np.uint64)), "fitting sequence mode identity drifted")
    state = FITTER.ModeState(
        iteration=iteration,
        mode_ids=mode_ids,
        positions=np.asarray([item["position"] for item in primitives], dtype=np.float64) + world_center,
        covariances=np.asarray([item["covariance"] for item in primitives], dtype=np.float64),
        coefficients=np.asarray([item["coefficients"] for item in primitives], dtype=np.float64),
        source_row_counts=np.asarray([item["sourceRowCount"] for item in primitives], dtype=np.uint32),
        objective=float(frame["objective"]),
        maximum_position_delta=float(frame["maximumPositionDelta"]),
    )
    return sequence, state


def load_motion_state(
    manifest_path: Path,
    state_id: str,
) -> tuple[dict[str, Any], dict[str, Any], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, state_id)
    feature_view = manifest.get("featureView") or {}
    order = feature_view.get("order") or []
    FITTER.require(order[17:20] == ["velocity.x", "velocity.y", "velocity.z"], "motion feature velocity order drifted")
    rows = state.get("rows") or {}
    descriptor = rows.get("features") or {}
    row_count = int(rows.get("count", 0))
    FITTER.require(descriptor.get("shape") == [row_count, 24], "motion feature shape drifted")
    feature_path = FITTER.resolve_artifact(descriptor, manifest_path, "motion features")
    features = np.memmap(feature_path, dtype="<f4", mode="r", shape=(row_count, 24))
    velocities = np.asarray(features[:, 17:20], dtype=np.float64)
    FITTER.require(np.all(np.isfinite(velocities)), "motion velocities contain nonfinite values")
    return manifest, state, native_ids, positions, coefficients, velocities


def temporal_metrics(candidate: np.ndarray, seed: np.ndarray, target: np.ndarray, source_target: np.ndarray) -> dict[str, float]:
    candidate_delta = candidate - seed
    target_delta = target - source_target
    target_magnitude = float(np.mean(np.abs(target_delta)))
    candidate_magnitude = float(np.mean(np.abs(candidate_delta)))
    return {
        "targetTemporalLinearMae": target_magnitude,
        "reconstructionTemporalLinearMae": candidate_magnitude,
        "absoluteExcessTemporalLinearMae": candidate_magnitude - target_magnitude,
        "relativeTemporalMagnitude": candidate_magnitude / max(target_magnitude, 1e-12),
        "signedDeltaAlignment": signed_delta_alignment(candidate_delta, target_delta),
        "targetStateLinearMae": float(np.mean(np.abs(candidate - target))),
    }


def covariance_change(seed: np.ndarray, candidate: np.ndarray) -> dict[str, float]:
    delta = np.linalg.norm(candidate - seed, axis=(1, 2))
    scale = np.maximum(np.linalg.norm(seed, axis=(1, 2)), 1e-12)
    relative = delta / scale
    return {
        "meanFrobenius": float(np.mean(delta)),
        "maximumFrobenius": float(np.max(delta)),
        "meanRelativeFrobenius": float(np.mean(relative)),
        "maximumRelativeFrobenius": float(np.max(relative)),
    }


def ownership_churn(seed: Any, candidate: Any) -> dict[str, float | int]:
    delta = np.abs(candidate.source_row_counts.astype(np.int64) - seed.source_row_counts.astype(np.int64))
    return {
        "changedModeCount": int(np.count_nonzero(delta)),
        "changedModeFraction": float(np.count_nonzero(delta) / delta.size),
        "meanAbsoluteSourceCellCountChange": float(np.mean(delta)),
        "maximumAbsoluteSourceCellCountChange": int(np.max(delta)),
    }


def temporal_toggle_html(surfaces: dict[str, dict[str, Any]], report_name: str) -> str:
    FITTER.require(bool(surfaces), "temporal viewer has no surfaces")
    for surface_id, surface in surfaces.items():
        states = surface.get("states") or {}
        FITTER.require(set(states) == {"118", "120"}, f"temporal viewer surface is missing a state pair: {surface_id}")
    surface_buttons = "".join(
        f'<button type="button" data-surface="{surface_id}">{surface["label"]}</button>'
        for surface_id, surface in surfaces.items()
    )
    encoded = json.dumps(surfaces, separators=(",", ":")).replace("</", "<\\/")
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grid16 dual-target temporal witness</title><style>
:root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{margin:0;background:#080a0c;color:#eef2f4;font:14px system-ui,sans-serif}}header{{padding:12px 16px;background:#12171b;border-bottom:1px solid #2b343b}}header strong{{display:block;font-size:16px}}header p{{margin:5px 0 0;color:#b9c2c8}}a{{color:#ffb45f}}main{{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);min-height:calc(100vh - 82px)}}aside{{padding:14px;border-right:1px solid #2b343b;background:#0e1215}}.controls{{display:grid;gap:8px}}.button-row{{display:flex;flex-wrap:wrap;gap:6px}}button{{border:1px solid #3b464d;background:#182027;color:#eef2f4;border-radius:5px;padding:8px 10px;cursor:pointer}}button.active{{background:#8b4e16;border-color:#ffad5b}}#scope{{margin-top:12px;padding:10px;background:#17130d;border:1px solid #5e421f;color:#ffd9ad}}#scope.load-error{{background:#2a0d0d;border-color:#b83d36;color:#ffd2cf}}#stage{{display:grid;place-items:center;min-width:0;background:#000;overflow:hidden}}#viewport-image{{display:block;width:min(100%,900px);height:min(calc(100vh - 100px),960px);object-fit:contain;image-rendering:auto}}.hint{{color:#97a4ab;font-size:12px;line-height:1.4}}@media(max-width:800px){{main{{grid-template-columns:1fr}}aside{{border-right:0;border-bottom:1px solid #2b343b}}#viewport-image{{height:auto}}}}</style></head><body>
<header><strong>State 118→120 same-object Grid16 temporal witness</strong><p>Raymarch of the physically restricted Grid16 target is the reference. Grid16 dot-matrix EWA is a control; authenticated Grid96 full-flame Raymarch is product context. · <a href="{report_name}">report</a></p></header>
<main><aside><div class="controls"><div><b>State</b><div class="button-row"><button type="button" data-state="118">118</button><button type="button" data-state="120">120</button><button type="button" id="blink">Blink states</button></div></div><div><b>Surface</b><div class="button-row">{surface_buttons}</div></div></div><div id="scope"></div><p class="hint">Space toggles state. B starts/stops blinking. Number keys select surfaces. Camera, crop, exposure, zoom, and viewport stay fixed while the image changes in place.</p></aside><section id="stage"><img id="viewport-image" alt="Temporal comparison"></section></main>
<script>const surfaces={encoded};const surfaceIds=Object.keys(surfaces);const query=new URLSearchParams(location.search);let state=['118','120'].includes(query.get('state'))?query.get('state'):'118';let surface=surfaceIds.includes(query.get('surface'))?query.get('surface'):surfaceIds[0];let timer=null;const image=document.querySelector('#viewport-image');const scope=document.querySelector('#scope');const blink=document.querySelector('#blink');function syncUrl(){{const url=new URL(location.href);url.searchParams.set('surface',surface);url.searchParams.set('state',state);history.replaceState(null,'',url);}}function render(){{const entry=surfaces[surface];scope.classList.remove('load-error');image.src=entry.states[state];image.alt=`${{entry.label}}, state ${{state}}`;scope.textContent=`${{entry.label}} · ${{entry.scope}}`;document.querySelectorAll('[data-state]').forEach(button=>button.classList.toggle('active',button.dataset.state===state));document.querySelectorAll('[data-surface]').forEach(button=>button.classList.toggle('active',button.dataset.surface===surface));syncUrl();}}image.addEventListener('error',()=>{{scope.classList.add('load-error');scope.textContent=`IMAGE LOAD FAILED · ${{surface}} · state ${{state}} · ${{image.getAttribute('src')}}`;}});function toggleState(){{state=state==='118'?'120':'118';render();}}function stopBlink(){{if(timer!==null){{clearInterval(timer);timer=null;blink.classList.remove('active');blink.textContent='Blink states';}}}}document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>{{stopBlink();state=button.dataset.state;render();}}));document.querySelectorAll('[data-surface]').forEach(button=>button.addEventListener('click',()=>{{surface=button.dataset.surface;render();}}));blink.addEventListener('click',()=>{{if(timer!==null){{stopBlink();return;}}timer=setInterval(toggleState,450);blink.classList.add('active');blink.textContent='Stop blinking';}});addEventListener('keydown',event=>{{if(event.code==='Space'){{event.preventDefault();stopBlink();toggleState();}}else if(event.key.toLowerCase()==='b'){{blink.click();}}else if(/^[1-9]$/.test(event.key)){{const next=surfaceIds[Number(event.key)-1];if(next){{surface=next;render();}}}}}});render();</script></body></html>"""


def run_assay(args: argparse.Namespace) -> dict[str, Any]:
    source_sequence_path = args.source_sequence.expanduser().resolve()
    target_sequence_path = args.target_sequence.expanduser().resolve()
    motion_manifest_path = args.motion_manifest.expanduser().resolve()
    mode_path = args.mode_module.expanduser().resolve()
    source_sequence, seed_state = load_sequence_state(source_sequence_path, args.seed_iteration)
    target_sequence, cold_control = load_sequence_state(target_sequence_path, args.control_iteration)
    source_state_id = str((source_sequence.get("source") or {}).get("stateId"))
    target_state_id = str((target_sequence.get("source") or {}).get("stateId"))
    FITTER.require(source_state_id == "coefficient-state-118", "source continuation state is not exact state118")
    FITTER.require(target_state_id == "coefficient-state-120", "target continuation state is not exact state120")
    for sequence, sequence_path in ((source_sequence, source_sequence_path), (target_sequence, target_sequence_path)):
        source = sequence.get("source") or {}
        FITTER.require(Path(source.get("manifestPath", "")).resolve() == motion_manifest_path, "sequence source manifest path drifted")
        FITTER.require(source.get("manifestSha256") == FITTER.sha256_file(motion_manifest_path), "sequence source manifest hash drifted")
    exact_targets = authenticate_exact_raymarch_targets(
        motion_manifest_path,
        (source_state_id, target_state_id),
    )

    source_manifest, source_state, source_ids, source_positions, source_coefficients, source_velocities = load_motion_state(
        motion_manifest_path,
        source_state_id,
    )
    target_manifest, target_state, target_ids, target_positions, target_coefficients, _ = load_motion_state(
        motion_manifest_path,
        target_state_id,
    )
    FITTER.require(source_manifest.get("identity") == target_manifest.get("identity"), "motion manifest identity changed between states")
    source_grid = int(source_state["replay"]["grid"])
    target_grid = int(target_state["replay"]["grid"])
    FITTER.require(source_grid == target_grid == 96, "persistent assay source grid drifted")
    source_medium = FITTER.restrict_selected_optical_medium(
        source_ids,
        source_positions,
        source_coefficients,
        source_grid=source_grid,
        target_grid=16,
        population="ridge",
    )
    target_medium = FITTER.restrict_selected_optical_medium(
        target_ids,
        target_positions,
        target_coefficients,
        source_grid=target_grid,
        target_grid=16,
        population="ridge",
    )
    restricted_velocity, velocity_restriction = restrict_weighted_velocity(
        source_ids,
        source_coefficients,
        source_velocities,
        source_medium,
    )
    mode_velocity, mode_velocity_receipt = aggregate_mode_velocity(
        source_medium,
        seed_state,
        restricted_velocity,
        soft_neighbors=args.soft_neighbors,
        temperature_cells=args.temperature_cells,
    )
    source_step = int(source_state["replay"]["completedSteps"])
    target_step = int(target_state["replay"]["completedSteps"])
    time_step_ms = float(source_state["replay"]["timeStepMs"])
    FITTER.require(time_step_ms == float(target_state["replay"]["timeStepMs"]), "state time step drifted")
    dt_seconds = (target_step - source_step) * time_step_ms / 1000.0
    FITTER.require(dt_seconds > 0.0, "continuation state order is not forward in time")

    continuation_states: dict[str, Any] = {}
    continuation_receipts: dict[str, Any] = {}
    for arm in ("frozen", "advected", "advected-bounded-exclusive"):
        state, receipt = continue_optical_modes(
            target_medium=target_medium,
            seed_state=seed_state,
            mode_velocities=mode_velocity,
            dt_seconds=dt_seconds,
            arm=arm,
            soft_neighbors=args.soft_neighbors,
            temperature_cells=args.temperature_cells,
            trust_radius_cells=args.trust_radius_cells,
            covariance_relative_limit=args.covariance_relative_limit,
        )
        continuation_states[arm] = state
        continuation_receipts[arm] = receipt
    continuation_states["cold-control"] = cold_control

    mode_module = load_module(mode_path, "grid16_persistent_mode_renderer")
    camera = target_state.get("target") or {}
    FITTER.require(camera.get("cameraPose") and int(camera.get("width", 0)) > 0, "target held camera is missing")
    source_raymarch_reference, _, source_raymarch_receipt = FITTER.render_restricted_medium(
        source_medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )
    target_raymarch_reference, _, target_raymarch_receipt = FITTER.render_restricted_medium(
        target_medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )
    source_target, source_target_receipt = FITTER.render_modes(
        mode_module,
        FITTER.restricted_medium_oracle_state(source_medium),
        "ridge",
        camera,
        width=args.render_width,
        depth_bins=args.depth_bins,
        path_scale=args.path_scale,
    )
    target_target, target_target_receipt = FITTER.render_modes(
        mode_module,
        FITTER.restricted_medium_oracle_state(target_medium),
        "ridge",
        camera,
        width=args.render_width,
        depth_bins=args.depth_bins,
        path_scale=args.path_scale,
    )
    seed_render, seed_render_receipt = FITTER.render_modes(
        mode_module,
        seed_state,
        "ridge",
        camera,
        width=args.render_width,
        depth_bins=args.depth_bins,
        path_scale=args.path_scale,
    )
    image_rows: list[dict[str, str]] = []

    def write_image(name: str, label: str, values: np.ndarray) -> dict[str, Any]:
        path = args.output_dir / f"{name}.png"
        artifact = FITTER.visual_artifact(path, values, mode_module)
        image_rows.append({"image": path.name, "label": label})
        return artifact

    source_raymarch_artifact = write_image(
        "state118-grid16-restricted-raymarch-reference",
        "State118 Grid16 restricted-medium Raymarch reference",
        source_raymarch_reference,
    )
    target_raymarch_artifact = write_image(
        "state120-grid16-restricted-raymarch-reference",
        "State120 Grid16 restricted-medium Raymarch reference",
        target_raymarch_reference,
    )
    source_target_artifact = write_image("state118-grid16-cell-event-control", "State118 Grid16 cell-event EWA control", source_target)
    target_target_artifact = write_image("state120-grid16-cell-event-control", "State120 Grid16 cell-event EWA control", target_target)
    seed_artifact = write_image("state118-seed-reconstruction", "State118 persistent seed (iteration 1)", seed_render)
    exact_target_artifacts: dict[str, dict[str, Any]] = {}
    for state_id, state_label in ((source_state_id, "118"), (target_state_id, "120")):
        source_path = Path(exact_targets[state_id]["path"])
        native_path = args.output_dir / f"state{state_label}-exact-full-raymarch-native.png"
        shutil.copyfile(source_path, native_path)
        FITTER.require(FITTER.sha256_file(native_path) == exact_targets[state_id]["sha256"], f"state{state_label} exact target copy drifted")
        display_path = args.output_dir / f"state{state_label}-exact-full-raymarch-display.png"
        exact_rgb = read_png_rgb8(native_path)
        display_rgb = resize_bilinear_rgb(exact_rgb, source_target.shape[1], source_target.shape[0])
        FITTER.write_png(display_path, display_rgb)
        exact_target_artifacts[state_id] = {
            **exact_targets[state_id],
            "sourcePath": str(source_path),
            "nativePath": str(native_path),
            "nativeName": native_path.name,
            "displayPath": str(display_path),
            "displayName": display_path.name,
            "displaySha256": FITTER.sha256_file(display_path),
            "displayWidth": int(source_target.shape[1]),
            "displayHeight": int(source_target.shape[0]),
            "displayResizeIdentity": "tone-mapped-rgb8-center-aligned-bilinear-v0",
        }
    arm_rows: dict[str, Any] = {}
    for arm, state in continuation_states.items():
        rendered, render_receipt = FITTER.render_modes(
            mode_module,
            state,
            "ridge",
            camera,
            width=args.render_width,
            depth_bins=args.depth_bins,
            path_scale=args.path_scale,
        )
        artifact = write_image(f"state120-{arm}", f"State120 {arm}", rendered)
        residual = target_raymarch_reference - rendered
        scale = max(float(np.percentile(np.abs(residual), 99.5)), 1e-8)
        residual_preview = np.clip(0.5 + residual / (2.0 * scale), 0.0, 1.0)
        residual_path = args.output_dir / f"state120-{arm}-signed-residual.png"
        FITTER.write_png(residual_path, residual_preview)
        image_rows.append({"image": residual_path.name, "label": f"State120 {arm} signed residual"})
        arm_rows[arm] = {
            "artifact": artifact,
            "residualArtifact": {
                "path": str(residual_path),
                "sha256": FITTER.sha256_file(residual_path),
                "signedPreviewScale": scale,
            },
            "targetMetrics": FITTER.image_metrics(rendered, target_raymarch_reference),
            "matchedControlMetrics": FITTER.image_metrics(rendered, target_target),
            "temporalMetrics": temporal_metrics(
                rendered,
                seed_render,
                target_raymarch_reference,
                source_raymarch_reference,
            ),
            "placement": {
                "meanSeedDisplacement": float(np.mean(np.linalg.norm(state.positions - seed_state.positions, axis=1))),
                "maximumSeedDisplacement": float(np.max(np.linalg.norm(state.positions - seed_state.positions, axis=1))),
                "meanImpliedSpeed": float(np.mean(np.linalg.norm(state.positions - seed_state.positions, axis=1)) / dt_seconds),
                "maximumImpliedSpeed": float(np.max(np.linalg.norm(state.positions - seed_state.positions, axis=1)) / dt_seconds),
            },
            "covarianceChange": covariance_change(seed_state.covariances, state.covariances),
            "coefficientChange": {
                "meanAbsolute": float(np.mean(np.abs(state.coefficients - seed_state.coefficients))),
                "maximumAbsolute": float(np.max(np.abs(state.coefficients - seed_state.coefficients))),
            },
            "ownershipChurn": ownership_churn(seed_state, state),
            "renderReceipt": render_receipt,
            "continuationReceipt": continuation_receipts.get(arm),
        }

    surfaces = {
        "grid16-raymarch-reference": {
            "label": "Grid16 restricted-medium Raymarch reference",
            "scope": "ridge-only same-object ground truth consumed by the fitter; native-step optical recurrence",
            "states": {
                "118": Path(source_raymarch_artifact["path"]).name,
                "120": Path(target_raymarch_artifact["path"]).name,
            },
        },
        "exact-raymarch": {
            "label": "Grid96 full-flame Raymarch context (matched display)",
            "scope": "product context only; full ridge+non-ridge shared transmittance; not the Grid16 reconstruction reference",
            "states": {
                "118": exact_target_artifacts[source_state_id]["displayName"],
                "120": exact_target_artifacts[target_state_id]["displayName"],
            },
        },
        "exact-raymarch-native": {
            "label": "Grid96 full-flame Raymarch context (native)",
            "scope": (
                f"untouched authenticated {exact_targets[source_state_id]['width']}x{exact_targets[source_state_id]['height']} "
                "product-motion context; not pixel-grid matched to the Grid16 witness and not a ridge-only score target"
            ),
            "states": {
                "118": exact_target_artifacts[source_state_id]["nativeName"],
                "120": exact_target_artifacts[target_state_id]["nativeName"],
            },
        },
        "grid16-cell-event-control": {
            "label": "Grid16 cell-event EWA control",
            "scope": "ridge-only dot-matrix mechanistic control; not ground truth",
            "states": {
                "118": Path(source_target_artifact["path"]).name,
                "120": Path(target_target_artifact["path"]).name,
            },
        },
        "persistent-frozen": {
            "label": "Persistent frozen",
            "scope": "ridge-only reconstruction",
            "states": {"118": Path(seed_artifact["path"]).name, "120": Path(arm_rows["frozen"]["artifact"]["path"]).name},
        },
        "persistent-advected": {
            "label": "Persistent advected",
            "scope": "ridge-only reconstruction",
            "states": {"118": Path(seed_artifact["path"]).name, "120": Path(arm_rows["advected"]["artifact"]["path"]).name},
        },
        "persistent-bounded": {
            "label": "Persistent advected + bounded correction",
            "scope": "ridge-only reconstruction",
            "states": {"118": Path(seed_artifact["path"]).name, "120": Path(arm_rows["advected-bounded-exclusive"]["artifact"]["path"]).name},
        },
        "cold-control": {
            "label": "Cold independent refit",
            "scope": "ridge-only negative control",
            "states": {"118": Path(seed_artifact["path"]).name, "120": Path(arm_rows["cold-control"]["artifact"]["path"]).name},
        },
    }
    viewer_path = args.output_dir / "index.html"
    viewer_path.write_text(temporal_toggle_html(surfaces, "report.json"))
    report = {
        "schema": CONTINUATION_SCHEMA,
        "identity": CONTINUATION_IDENTITY,
        "status": "complete",
        "failurePhase": None,
        "authority": "grid16-restricted-raymarch-reference-with-ewa-control-and-grid96-context-v0",
        "requested": {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
        "effective": {
            "sourceStateId": source_state_id,
            "targetStateId": target_state_id,
            "sourceStep": source_step,
            "targetStep": target_step,
            "dtSeconds": dt_seconds,
            "sourceGrid": 96,
            "restrictedGrid": 16,
            "population": "ridge",
            "modeCount": 48,
            "birthCount": 0,
            "deathCount": 0,
            "sampleCap": None,
            "droppedRowCount": 0,
            "effectiveRoute": target_state["replay"]["effectiveRoute"],
            "backend": target_state["replay"].get("backend"),
        },
        "source": {
            "motionManifestSha256": FITTER.sha256_file(motion_manifest_path),
            "sourceSequenceSha256": FITTER.sha256_file(source_sequence_path),
            "targetSequenceSha256": FITTER.sha256_file(target_sequence_path),
            "modeModuleSha256": FITTER.sha256_file(mode_path),
            "fitterImplementationSha256": FITTER.sha256_file(
                Path(__file__).with_name("volume-multiscale-fitting-sequence.py")
            ),
            "continuationImplementationSha256": FITTER.sha256_file(Path(__file__)),
        },
        "velocity": {
            "restriction": velocity_restriction,
            "modeAggregation": mode_velocity_receipt,
            "meanModeDisplacement": float(np.mean(np.linalg.norm(mode_velocity * dt_seconds, axis=1))),
            "maximumModeDisplacement": float(np.max(np.linalg.norm(mode_velocity * dt_seconds, axis=1))),
        },
        "targetTemporalLinearMae": float(np.mean(np.abs(target_raymarch_reference - source_raymarch_reference))),
        "targetTemporalLinearMaeAuthority": "grid16-restricted-medium-raymarch-reference",
        "restrictedGrid16RaymarchTemporalLinearMae": float(
            np.mean(np.abs(target_raymarch_reference - source_raymarch_reference))
        ),
        "matchedGrid16ControlTemporalLinearMae": float(np.mean(np.abs(target_target - source_target))),
        "temporalAuthority": {
            "primaryVisualReference": "ridge-only-grid16-restricted-medium-raymarch-state118-120",
            "productVisualContext": "exact-full-flame-grid96-raymarch-state118-120",
            "matchedMechanisticControl": "ridge-only-grid16-cell-event-ewa-state118-120",
            "numericTreatmentScoringTarget": "ridge-only-grid16-restricted-medium-raymarch-state120",
            "crossPopulationExactRaymarchScoringPermitted": False,
            "reason": "the exact Raymarch target contains ridge plus non-ridge under shared transmittance while the fixed 48-mode treatment reconstructs ridge only",
        },
        "visualComparison": {
            "treatmentWidth": int(source_target.shape[1]),
            "treatmentHeight": int(source_target.shape[0]),
            "exactNativeDimensions": {
                "118": [int(exact_targets[source_state_id]["width"]), int(exact_targets[source_state_id]["height"])],
                "120": [int(exact_targets[target_state_id]["width"]), int(exact_targets[target_state_id]["height"])],
            },
            "exactDisplayWidth": int(source_target.shape[1]),
            "exactDisplayHeight": int(source_target.shape[0]),
            "pixelGridMatched": True,
            "exactDisplayResizeIdentity": "tone-mapped-rgb8-center-aligned-bilinear-v0",
            "nativeExactPreservedSeparately": True,
            "heldCameraPoseSha256": exact_targets[source_state_id]["cameraPoseSha256"],
        },
        "renders": {
            "exactRaymarchFullFlameContext": exact_target_artifacts,
            "restrictedGrid16RaymarchReference": {
                "source": source_raymarch_artifact,
                "target": target_raymarch_artifact,
                "sourceReceipt": source_raymarch_receipt,
                "targetReceipt": target_raymarch_receipt,
            },
            "grid16CellEventEwaControl": {
                "source": source_target_artifact,
                "target": target_target_artifact,
                "sourceReceipt": source_target_receipt,
                "targetReceipt": target_target_receipt,
            },
            "sourceSeed": seed_artifact,
            "sourceSeedReceipt": seed_render_receipt,
            "arms": arm_rows,
        },
        "artifacts": {
            "viewer": str(viewer_path),
            "viewerSha256": FITTER.sha256_file(viewer_path),
            "imageCount": len(image_rows) + 2 * len(exact_target_artifacts),
            "viewerIdentity": "same-viewport-state-surface-toggle-v0",
            "surfaces": surfaces,
        },
        "claimBoundary": {
            "fixedCountTemporalContinuationAuthority": True,
            "exactRaymarchProductMotionVisualContext": True,
            "exactRaymarchRidgeOnlyNumericScoring": False,
            "restrictedGrid16RaymarchRidgeOnlyNumericScoring": True,
            "grid16ReferenceIsRestrictedMediumRaymarch": True,
            "grid16CellEventEwaIsGroundTruth": False,
            "fullVolumeAuthority": False,
            "productionEligibilityClaimed": False,
            "visualClosureClaimed": False,
            "performanceAuthority": False,
        },
    }
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sequence", required=True, type=Path)
    parser.add_argument("--target-sequence", required=True, type=Path)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--mode-module", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--seed-iteration", type=int, default=1)
    parser.add_argument("--control-iteration", type=int, default=1)
    parser.add_argument("--soft-neighbors", type=int, default=3)
    parser.add_argument("--temperature-cells", type=float, default=0.9)
    parser.add_argument("--trust-radius-cells", type=float, default=0.5)
    parser.add_argument("--covariance-relative-limit", type=float, default=0.25)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--samples-per-cell", type=int, default=4)
    parser.add_argument("--path-scale", type=float, default=FITTER.DEFAULT_PATH_SCALE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schema": CONTINUATION_SCHEMA,
        "identity": CONTINUATION_IDENTITY,
        "status": "failed",
        "failurePhase": "source-validation",
        "requested": {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
    }
    try:
        report = run_assay(args)
        report_path = args.output_dir / "report.json"
        report_path.write_text(json.dumps(FITTER.json_value(report), indent=2) + "\n")
        print(report_path)
        return 0
    except Exception as exc:
        report["error"] = str(exc)
        report["traceback"] = traceback.format_exc()
        (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
