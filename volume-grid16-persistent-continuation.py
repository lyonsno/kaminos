#!/usr/bin/env python3
"""Continue a fixed Grid16 optical-mode cohort across exact simulator states."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path
import sys
import traceback
from typing import Any

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


def contact_sheet_html(rows: list[dict[str, Any]], report_name: str) -> str:
    figures = "".join(
        f'<figure><a href="{row["image"]}"><img src="{row["image"]}"></a><figcaption>{row["label"]}</figcaption></figure>'
        for row in rows
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Grid16 persistent continuation</title><style>
body{{margin:0;background:#090b0d;color:#e8edf0;font:14px system-ui,sans-serif}}header{{padding:12px 16px;background:#12171b;position:sticky;top:0;z-index:2}}main{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px}}figure{{margin:0;background:#000;border:1px solid #2b343b}}img{{display:block;width:100%;height:auto}}figcaption{{padding:8px;background:#11171b}}a{{color:#ffb45f}}@media(max-width:900px){{main{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}</style></head><body><header>Exact state118→120 fixed-count persistence witness · <a href="{report_name}">report</a></header><main>{figures}</main></body></html>"""


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

    source_target_artifact = write_image("state118-restricted-target", "State118 restricted-cell target", source_target)
    target_target_artifact = write_image("state120-restricted-target", "State120 restricted-cell target", target_target)
    seed_artifact = write_image("state118-seed-reconstruction", "State118 persistent seed (iteration 1)", seed_render)
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
        residual = target_target - rendered
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
            "targetMetrics": FITTER.image_metrics(rendered, target_target),
            "temporalMetrics": temporal_metrics(rendered, seed_render, target_target, source_target),
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

    viewer_path = args.output_dir / "index.html"
    viewer_path.write_text(contact_sheet_html(image_rows, "report.json"))
    report = {
        "schema": CONTINUATION_SCHEMA,
        "identity": CONTINUATION_IDENTITY,
        "status": "complete",
        "failurePhase": None,
        "authority": "exact-adjacent-state118-120-fixed-count-grid16-temporal-falsifier-v0",
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
            "continuationImplementationSha256": FITTER.sha256_file(Path(__file__)),
        },
        "velocity": {
            "restriction": velocity_restriction,
            "modeAggregation": mode_velocity_receipt,
            "meanModeDisplacement": float(np.mean(np.linalg.norm(mode_velocity * dt_seconds, axis=1))),
            "maximumModeDisplacement": float(np.max(np.linalg.norm(mode_velocity * dt_seconds, axis=1))),
        },
        "targetTemporalLinearMae": float(np.mean(np.abs(target_target - source_target))),
        "renders": {
            "sourceTarget": source_target_artifact,
            "targetTarget": target_target_artifact,
            "sourceSeed": seed_artifact,
            "sourceTargetReceipt": source_target_receipt,
            "targetTargetReceipt": target_target_receipt,
            "sourceSeedReceipt": seed_render_receipt,
            "arms": arm_rows,
        },
        "artifacts": {
            "viewer": str(viewer_path),
            "viewerSha256": FITTER.sha256_file(viewer_path),
            "imageCount": len(image_rows),
        },
        "claimBoundary": {
            "fixedCountTemporalContinuationAuthority": True,
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
