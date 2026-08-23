#!/usr/bin/env python3
"""Record one physically restricted simulation-grid optical fitting sequence."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import traceback
from typing import Any
import zlib

import numpy as np


SEQUENCE_SCHEMA = "kaminos.volume.multiscale-fitting-sequence.v0"
SEQUENCE_IDENTITY = "simulation-grid-restriction-not-screen-downsample-v0"
RESTRICTION_IDENTITY = "volume-average-selected-optical-density-with-integrated-mass-receipt-v0"
SOLVER_IDENTITY = "persistent-world-space-soft-em-optical-mass-fit-v0"
EXPECTED_SOURCE_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0"
EXPECTED_ROUTE = "native-3d-compute-fluid-raymarch-v0"
COEFFICIENT_ORDER = (
    "ridge.emission.r",
    "ridge.emission.g",
    "ridge.emission.b",
    "ridge.extinction",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
)
LUMA = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float64)
DEFAULT_PATH_SCALE = 3.8845837491755066
RESTRICTED_VOXEL_NATIVE_STEP_SCALE = 1.0


class SequenceFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class RestrictedMedium:
    source_grid: int
    grid: int
    population: str
    origin: np.ndarray
    source_spacing: np.ndarray
    spacing: np.ndarray
    positions: np.ndarray
    covariances: np.ndarray
    coefficients: np.ndarray
    density_coefficients: np.ndarray
    source_counts: np.ndarray
    coarse_cell_ids: np.ndarray
    selected_mass: np.ndarray
    remainder_mass: np.ndarray
    conservation: dict[str, Any]


@dataclass(frozen=True)
class ModeState:
    iteration: int
    mode_ids: np.ndarray
    positions: np.ndarray
    covariances: np.ndarray
    coefficients: np.ndarray
    source_row_counts: np.ndarray
    objective: float
    maximum_position_delta: float


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SequenceFailure(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(json_value(payload), indent=2) + "\n", encoding="utf-8")


def json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    return value


def load_module(path: Path, name: str) -> Any:
    require(path.is_file(), f"{name} implementation is missing: {path}")
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, f"{name} implementation could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def resolve_artifact(descriptor: dict[str, Any], manifest_path: Path, label: str) -> Path:
    require(isinstance(descriptor, dict), f"{label} descriptor is missing")
    raw_path = str(descriptor.get("path") or "")
    path = Path(raw_path)
    path = path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()
    require(path.is_file(), f"{label} artifact is missing: {path}")
    require(path.stat().st_size == int(descriptor.get("bytes", -1)), f"{label} byte length mismatch")
    require(sha256_file(path) == descriptor.get("sha256"), f"{label} sha256 mismatch")
    return path


def infer_grid_transform(native_ids: np.ndarray, positions: np.ndarray, grid: int) -> tuple[np.ndarray, np.ndarray, float]:
    ids = np.asarray(native_ids, dtype=np.int64)
    world = np.asarray(positions, dtype=np.float64)
    require(ids.ndim == 1 and world.shape == (ids.size, 3), "native ids and world positions are misaligned")
    cells = np.stack((ids % grid, (ids // grid) % grid, ids // (grid * grid)), axis=1).astype(np.float64)
    origin = np.zeros(3, dtype=np.float64)
    spacing = np.zeros(3, dtype=np.float64)
    maximum_residual = 0.0
    for axis in range(3):
        design = np.stack((np.ones(ids.size, dtype=np.float64), cells[:, axis] + 0.5), axis=1)
        solution, *_ = np.linalg.lstsq(design, world[:, axis], rcond=None)
        origin[axis], spacing[axis] = solution
        residual = np.abs(design @ solution - world[:, axis])
        maximum_residual = max(maximum_residual, float(np.max(residual)))
    require(np.all(spacing > 0.0), "inferred source spacing is not positive")
    require(maximum_residual <= float(np.min(spacing)) * 1e-3, "world positions do not lie on the declared source grid")
    return origin, spacing, maximum_residual


def population_coefficients(coefficients: np.ndarray, population: str) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(coefficients, dtype=np.float64)
    require(values.ndim == 2 and values.shape[1] == 8, "optical coefficients must have eight channels")
    require(np.all(np.isfinite(values)) and np.all(values >= 0.0), "optical coefficients are invalid")
    selected = np.zeros_like(values)
    remainder = np.zeros_like(values)
    if population == "ridge":
        selected[:, :4] = values[:, :4]
        remainder[:, 4:] = values[:, 4:]
    elif population == "nonridge":
        selected[:, 4:] = values[:, 4:]
        remainder[:, :4] = values[:, :4]
    elif population == "combined":
        selected[:] = values
    else:
        raise SequenceFailure(f"unknown optical population: {population}")
    return selected, remainder


def restrict_selected_optical_medium(
    native_ids: np.ndarray,
    positions: np.ndarray,
    coefficients: np.ndarray,
    *,
    source_grid: int,
    target_grid: int,
    population: str,
) -> RestrictedMedium:
    ids = np.asarray(native_ids)
    world = np.asarray(positions, dtype=np.float64)
    values = np.asarray(coefficients, dtype=np.float64)
    require(ids.ndim == 1 and np.issubdtype(ids.dtype, np.integer), "native cell indices must be an integer vector")
    require(np.unique(ids).size == ids.size, "native cell indices contain duplicates")
    require(world.shape == (ids.size, 3) and values.shape == (ids.size, 8), "selected source rows are misaligned")
    require(source_grid >= target_grid > 0, "target grid must be positive and no larger than source grid")
    require(source_grid % target_grid == 0, "first witness requires an exact integer simulation-grid restriction")
    require(np.all((ids >= 0) & (ids < source_grid**3)), "native cell index is outside the source grid")
    selected, remainder = population_coefficients(values, population)
    factor = source_grid // target_grid
    source_cells = np.stack(
        (ids % source_grid, (ids // source_grid) % source_grid, ids // (source_grid * source_grid)),
        axis=1,
    ).astype(np.int64)
    coarse_cells = source_cells // factor
    coarse_ids = coarse_cells[:, 0] + target_grid * (coarse_cells[:, 1] + target_grid * coarse_cells[:, 2])
    all_coefficients = np.zeros((target_grid**3, 8), dtype=np.float64)
    all_source_counts = np.zeros(target_grid**3, dtype=np.uint32)
    np.add.at(all_coefficients, coarse_ids, selected)
    np.add.at(all_source_counts, coarse_ids, np.ones(ids.size, dtype=np.uint32))
    active = np.any(all_coefficients > 0.0, axis=1)
    active_ids = np.flatnonzero(active).astype(np.uint32)
    require(active_ids.size > 0, "selected structure has no positive optical cells after restriction")
    origin, source_spacing, transform_residual = infer_grid_transform(ids, world, source_grid)
    target_spacing = source_spacing * factor
    active_cells = np.stack(
        (
            active_ids % target_grid,
            (active_ids // target_grid) % target_grid,
            active_ids // (target_grid * target_grid),
        ),
        axis=1,
    ).astype(np.float64)
    active_positions = origin + (active_cells + 0.5) * target_spacing
    cell_covariance = np.diag(np.square(target_spacing) / 12.0)
    active_covariances = np.repeat(cell_covariance[None, :, :], active_ids.size, axis=0)
    target_cell_volume = float(factor**3)
    selected_mass = np.sum(selected, axis=0, dtype=np.float64)
    restricted_mass = np.sum(all_coefficients, axis=0, dtype=np.float64)
    delta = np.abs(restricted_mass - selected_mass)
    allowed = 1e-9 + np.abs(selected_mass) * 1e-11
    conservation = {
        "identity": RESTRICTION_IDENTITY,
        "sourceCellVolume": 1.0,
        "targetCellVolume": target_cell_volume,
        "sourceGrid": source_grid,
        "targetGrid": target_grid,
        "fixedWorldExtent": (source_spacing * source_grid).tolist(),
        "sourceSpacing": source_spacing.tolist(),
        "targetSpacing": target_spacing.tolist(),
        "worldTransformMaximumResidual": transform_residual,
        "integratedEmission": {
            "source": selected_mass[[0, 1, 2, 4, 5, 6]].tolist(),
            "restricted": restricted_mass[[0, 1, 2, 4, 5, 6]].tolist(),
        },
        "integratedExtinction": {
            "source": selected_mass[[3, 7]].tolist(),
            "restricted": restricted_mass[[3, 7]].tolist(),
        },
        "absoluteDelta": delta.tolist(),
        "allowedDelta": allowed.tolist(),
        "conserved": bool(np.all(delta <= allowed)),
    }
    require(conservation["conserved"], "simulation-grid optical restriction lost selected coefficient mass")
    return RestrictedMedium(
        source_grid=source_grid,
        grid=target_grid,
        population=population,
        origin=origin,
        source_spacing=source_spacing,
        spacing=target_spacing,
        positions=active_positions,
        covariances=active_covariances,
        coefficients=all_coefficients[active_ids],
        density_coefficients=all_coefficients[active_ids] / target_cell_volume,
        source_counts=all_source_counts[active_ids],
        coarse_cell_ids=active_ids,
        selected_mass=selected_mass,
        remainder_mass=np.sum(remainder, axis=0, dtype=np.float64),
        conservation=conservation,
    )


def optical_weight(coefficients: np.ndarray) -> np.ndarray:
    values = np.asarray(coefficients, dtype=np.float64)
    return values[:, :3] @ LUMA + values[:, 3] + values[:, 4:7] @ LUMA + values[:, 7]


def deterministic_seeds(positions: np.ndarray, weights: np.ndarray, count: int) -> np.ndarray:
    require(0 < count <= positions.shape[0], "primitive count must not exceed positive restricted cells")
    selected = [int(np.argmax(weights))]
    minimum_distance = np.sum(np.square(positions - positions[selected[0]]), axis=1)
    for _ in range(1, count):
        priority = minimum_distance * np.maximum(weights, 1e-12)
        priority[np.asarray(selected, dtype=np.int64)] = -1.0
        next_index = int(np.argmax(priority))
        selected.append(next_index)
        distance = np.sum(np.square(positions - positions[next_index]), axis=1)
        minimum_distance = np.minimum(minimum_distance, distance)
    return np.asarray(selected, dtype=np.int64)


def state_from_responsibilities(
    medium: RestrictedMedium,
    responsibilities: np.ndarray,
    prior_positions: np.ndarray,
    iteration: int,
    *,
    fixed_covariances: np.ndarray | None = None,
    coefficient_responsibilities: np.ndarray | None = None,
) -> ModeState:
    source_weights = np.maximum(optical_weight(medium.coefficients), 1e-12)
    require(
        responsibilities.shape[0] == medium.positions.shape[0],
        "geometry responsibilities do not align with source cells",
    )
    optical_ownership = responsibilities if coefficient_responsibilities is None else coefficient_responsibilities
    require(optical_ownership.shape == responsibilities.shape, "optical responsibilities shape drifted")
    require(np.allclose(np.sum(optical_ownership, axis=1), 1.0), "optical responsibilities do not conserve ownership")
    geometry = responsibilities * source_weights[:, None]
    geometry_mass = np.sum(geometry, axis=0, dtype=np.float64)
    require(np.all(geometry_mass > 0.0), "soft fit produced an empty primitive")
    centers = (geometry.T @ medium.positions) / geometry_mass[:, None]
    mode_count = responsibilities.shape[1]
    if fixed_covariances is not None:
        require(fixed_covariances.shape == (mode_count, 3, 3), "fixed covariance shape drifted")
        covariances = fixed_covariances.copy()
    else:
        covariances = np.empty((mode_count, 3, 3), dtype=np.float64)
        for mode_index in range(mode_count):
            offsets = medium.positions - centers[mode_index]
            weighted_outer = np.einsum(
                "n,ni,nj->ij",
                geometry[:, mode_index],
                offsets,
                offsets,
                optimize=True,
            )
            weighted_cell = np.einsum(
                "n,nij->ij",
                geometry[:, mode_index],
                medium.covariances,
                optimize=True,
            )
            covariance = (weighted_outer + weighted_cell) / geometry_mass[mode_index]
            covariance = 0.5 * (covariance + covariance.T)
            eigenvalues, eigenvectors = np.linalg.eigh(covariance)
            floor = float(np.min(np.square(medium.source_spacing))) / 12.0
            covariances[mode_index] = (eigenvectors * np.maximum(eigenvalues, floor)) @ eigenvectors.T
    mode_coefficients = optical_ownership.T @ medium.coefficients
    hard_owner = np.argmax(responsibilities, axis=1)
    counts = np.bincount(hard_owner, minlength=mode_count).astype(np.uint32)
    deltas = centers - prior_positions
    objective = float(np.sum(geometry * np.sum(np.square(medium.positions[:, None, :] - centers[None, :, :]), axis=2)))
    return ModeState(
        iteration=iteration,
        mode_ids=np.arange(mode_count, dtype=np.uint64),
        positions=centers,
        covariances=covariances,
        coefficients=mode_coefficients,
        source_row_counts=counts,
        objective=objective,
        maximum_position_delta=float(np.max(np.linalg.norm(deltas, axis=1))),
    )


def soft_responsibilities(
    medium: RestrictedMedium,
    centers: np.ndarray,
    anchors: np.ndarray,
    *,
    soft_neighbors: int,
    temperature_cells: float,
) -> np.ndarray:
    count = centers.shape[0]
    require(0 < soft_neighbors <= count, "soft neighbor count is invalid")
    scale = float(np.mean(medium.spacing)) * temperature_cells
    require(math.isfinite(scale) and scale > 0.0, "soft assignment temperature is invalid")
    squared_distance = np.sum(np.square(medium.positions[:, None, :] - centers[None, :, :]), axis=2)
    nearest = np.argpartition(squared_distance, soft_neighbors - 1, axis=1)[:, :soft_neighbors]
    selected_distance = np.take_along_axis(squared_distance, nearest, axis=1)
    logits = -0.5 * selected_distance / (scale * scale)
    logits -= np.max(logits, axis=1, keepdims=True)
    selected_weights = np.exp(logits)
    selected_weights /= np.sum(selected_weights, axis=1, keepdims=True)
    result = np.zeros_like(squared_distance)
    rows = np.arange(medium.positions.shape[0])[:, None]
    result[rows, nearest] = selected_weights
    for mode_index, source_index in enumerate(anchors):
        result[source_index, mode_index] = max(result[source_index, mode_index], 0.25)
        result[source_index] /= np.sum(result[source_index], dtype=np.float64)
    require(np.allclose(np.sum(result, axis=1), 1.0), "soft assignments do not conserve source ownership")
    return result


def hard_responsibilities(medium: RestrictedMedium, centers: np.ndarray, anchors: np.ndarray) -> np.ndarray:
    squared_distance = np.sum(np.square(medium.positions[:, None, :] - centers[None, :, :]), axis=2)
    owner = np.argmin(squared_distance, axis=1)
    owner[anchors] = np.arange(centers.shape[0])
    result = np.eye(centers.shape[0], dtype=np.float64)[owner]
    require(np.all(np.sum(result, axis=0) > 0.0), "hard assignment produced an empty primitive")
    return result


def exclusive_geometry_responsibilities(soft_ownership: np.ndarray, anchors: np.ndarray) -> np.ndarray:
    require(soft_ownership.ndim == 2, "soft ownership must be a source-by-mode matrix")
    owner = np.argmax(soft_ownership, axis=1)
    owner[anchors] = np.arange(soft_ownership.shape[1])
    result = np.eye(soft_ownership.shape[1], dtype=np.float64)[owner]
    require(np.all(np.sum(result, axis=0) > 0.0), "exclusive geometry produced an empty primitive")
    return result


def fit_optical_modes(
    medium: RestrictedMedium,
    *,
    primitive_count: int,
    iteration_count: int,
    soft_neighbors: int,
    temperature_cells: float,
    assignment_arm: str = "soft-full",
) -> list[ModeState]:
    require(iteration_count > 0, "iteration count must be positive")
    require(
        assignment_arm in (
            "hard-full",
            "soft-frozen-covariance",
            "soft-full",
            "soft-optics-exclusive-geometry",
        ),
        f"unknown assignment arm: {assignment_arm}",
    )
    weights = np.maximum(optical_weight(medium.coefficients), 1e-12)
    anchors = deterministic_seeds(medium.positions, weights, primitive_count)
    centers = medium.positions[anchors].copy()
    squared_distance = np.sum(np.square(medium.positions[:, None, :] - centers[None, :, :]), axis=2)
    hard_owner = np.argmin(squared_distance, axis=1)
    hard_owner[anchors] = np.arange(primitive_count)
    responsibilities = np.eye(primitive_count, dtype=np.float64)[hard_owner]
    sequence = [state_from_responsibilities(medium, responsibilities, centers, 0)]
    centers = sequence[-1].positions
    for iteration in range(1, iteration_count + 1):
        coefficient_responsibilities = None
        if assignment_arm == "hard-full":
            responsibilities = hard_responsibilities(medium, centers, anchors)
        else:
            soft_ownership = soft_responsibilities(
                medium,
                centers,
                anchors,
                soft_neighbors=soft_neighbors,
                temperature_cells=temperature_cells,
            )
            if assignment_arm == "soft-optics-exclusive-geometry":
                responsibilities = exclusive_geometry_responsibilities(soft_ownership, anchors)
                coefficient_responsibilities = soft_ownership
            else:
                responsibilities = soft_ownership
        fixed_covariances = sequence[0].covariances if assignment_arm == "soft-frozen-covariance" else None
        state = state_from_responsibilities(
            medium,
            responsibilities,
            centers,
            iteration,
            fixed_covariances=fixed_covariances,
            coefficient_responsibilities=coefficient_responsibilities,
        )
        sequence.append(state)
        centers = state.positions
    expected_mass = np.sum(medium.coefficients, axis=0, dtype=np.float64)
    for state in sequence:
        require(
            np.allclose(np.sum(state.coefficients, axis=0, dtype=np.float64), expected_mass, rtol=1e-10, atol=1e-8),
            f"iteration {state.iteration} lost optical ownership",
        )
    return sequence


def dense_restricted_grid(medium: RestrictedMedium) -> np.ndarray:
    grid = np.zeros((medium.grid**3, 8), dtype=np.float64)
    grid[medium.coarse_cell_ids] = medium.density_coefficients
    return grid.reshape((medium.grid, medium.grid, medium.grid, 8), order="F")


def restricted_medium_oracle_state(medium: RestrictedMedium) -> ModeState:
    count = medium.coarse_cell_ids.size
    return ModeState(
        iteration=-1,
        mode_ids=medium.coarse_cell_ids.astype(np.uint64),
        positions=medium.positions.copy(),
        covariances=medium.covariances.copy(),
        coefficients=medium.coefficients.copy(),
        source_row_counts=medium.source_counts.copy(),
        objective=0.0,
        maximum_position_delta=0.0,
    )


def camera_basis(camera: dict[str, Any], width: int) -> tuple[dict[str, Any], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    source_width = int(camera["width"])
    source_height = int(camera["height"])
    height = max(1, round(width * source_height / source_width))
    resized = {**camera, "width": width, "height": height}
    pose = camera["cameraPose"]
    position = np.asarray(pose["position"], dtype=np.float64)
    target = np.asarray(pose["target"], dtype=np.float64)
    forward = target - position
    forward /= np.linalg.norm(forward)
    reference_up = np.asarray((0.0, 1.0, 0.0), dtype=np.float64)
    right = np.cross(forward, reference_up)
    if np.linalg.norm(right) < 1e-6:
        reference_up = np.asarray((0.0, 0.0, 1.0), dtype=np.float64)
        right = np.cross(forward, reference_up)
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    up /= np.linalg.norm(up)
    return resized, position, forward, right, up


def ray_box_intersection(origins: np.ndarray, directions: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    safe = np.where(np.abs(directions) < 1e-12, np.copysign(1e-12, directions + 1e-30), directions)
    first = (lower - origins) / safe
    second = (upper - origins) / safe
    near = np.max(np.minimum(first, second), axis=1)
    far = np.min(np.maximum(first, second), axis=1)
    return np.maximum(near, 0.0), far


def render_restricted_medium(
    medium: RestrictedMedium,
    camera: dict[str, Any],
    *,
    width: int,
    samples_per_cell: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    require(samples_per_cell > 0, "samples_per_cell must be positive")
    resized, position, forward, right, up = camera_basis(camera, width)
    height = int(resized["height"])
    projection = np.asarray(camera["cameraPose"]["projectionMatrix"], dtype=np.float64).reshape(4, 4, order="F")
    focal_x = float(projection[0, 0])
    focal_y = float(projection[1, 1])
    pixel_x = (np.arange(width, dtype=np.float64) + 0.5) / width * 2.0 - 1.0
    pixel_y = 1.0 - (np.arange(height, dtype=np.float64) + 0.5) / height * 2.0
    ndc_x, ndc_y = np.meshgrid(pixel_x, pixel_y)
    directions = (
        forward[None, None, :]
        + right[None, None, :] * (ndc_x[..., None] / focal_x)
        + up[None, None, :] * (ndc_y[..., None] / focal_y)
    )
    directions /= np.linalg.norm(directions, axis=2, keepdims=True)
    flat_directions = directions.reshape((-1, 3))
    flat_origins = np.repeat(position[None, :], flat_directions.shape[0], axis=0)
    lower = medium.origin
    upper = medium.origin + medium.source_spacing * medium.source_grid
    near, far = ray_box_intersection(flat_origins, flat_directions, lower, upper)
    hit = far > near
    sample_count = medium.grid * samples_per_cell
    fractions = (np.arange(sample_count, dtype=np.float64) + 0.5) / sample_count
    color = np.zeros((flat_directions.shape[0], 3), dtype=np.float64)
    transmittance = np.ones(flat_directions.shape[0], dtype=np.float64)
    grid_values = dense_restricted_grid(medium)
    path_length = np.maximum(far - near, 0.0)
    fine_step_world = float(np.mean(medium.source_spacing))
    for fraction in fractions:
        distance = near + path_length * fraction
        points = flat_origins + flat_directions * distance[:, None]
        cells = np.floor((points - lower) / medium.spacing).astype(np.int64)
        valid = hit & np.all((cells >= 0) & (cells < medium.grid), axis=1)
        if not np.any(valid):
            continue
        values = np.zeros((flat_directions.shape[0], 8), dtype=np.float64)
        selected_cells = cells[valid]
        values[valid] = grid_values[selected_cells[:, 0], selected_cells[:, 1], selected_cells[:, 2]]
        segment_scale = np.where(
            hit,
            path_length / sample_count / fine_step_world * RESTRICTED_VOXEL_NATIVE_STEP_SCALE,
            0.0,
        )
        emission = (values[:, :3] + values[:, 4:7]) * segment_scale[:, None]
        optical_depth = (values[:, 3] + values[:, 7]) * segment_scale
        alpha = -np.expm1(-optical_depth)
        source_scale = np.divide(alpha, optical_depth, out=np.ones_like(alpha), where=optical_depth > 1e-8)
        color += transmittance[:, None] * emission * source_scale[:, None]
        transmittance *= np.exp(-optical_depth)
    return color.reshape((height, width, 3)), transmittance.reshape((height, width)), {
        "identity": "restricted-voxel-native-step-raymarch-v1",
        "width": width,
        "height": height,
        "samplesPerCell": samples_per_cell,
        "sampleCount": sample_count,
        "nativeStepScale": RESTRICTED_VOXEL_NATIVE_STEP_SCALE,
        "nativeStepAuthority": "full-grid-capture-coefficients-already-include-one-native-ray-step-v0",
        "integrationScaleIdentity": "world-distance-in-source-cell-widths-v0",
        "gaussianPathScaleApplied": False,
        "hitPixelCount": int(np.count_nonzero(hit)),
    }


def mode_object(mode_module: Any, state: ModeState, population: str) -> Any:
    population_id = 0 if population == "ridge" else 1
    if population == "combined":
        population_id = 2
    count = state.mode_ids.size
    return mode_module.OpticalModes(
        mode_ids=state.mode_ids,
        brick_ids=state.mode_ids.copy(),
        population_ids=np.full(count, population_id, dtype=np.uint8),
        child_ids=np.zeros(count, dtype=np.uint8),
        positions=state.positions,
        covariances=state.covariances,
        coefficients=state.coefficients,
        source_row_counts=state.source_row_counts,
        optical_weights=optical_weight(state.coefficients),
        split_scores=np.zeros(count, dtype=np.float64),
    )


def render_modes(
    mode_module: Any,
    state: ModeState,
    population: str,
    camera: dict[str, Any],
    *,
    width: int,
    depth_bins: int,
    path_scale: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    resized, position, _forward, _right, _up = camera_basis(camera, width)
    distance = np.linalg.norm(state.positions - position[None, :], axis=1)
    near_depth = max(1e-4, float(np.min(distance)) - float(np.max(np.sqrt(np.linalg.eigvalsh(state.covariances)))))
    far_depth = float(np.max(distance)) + float(np.max(np.sqrt(np.linalg.eigvalsh(state.covariances))))
    receipt = mode_module.rasterize_optical_modes_ewa(
        mode_object(mode_module, state, population),
        resized,
        depth_bins=depth_bins,
        near_depth=near_depth,
        far_depth=far_depth,
        support_sigma=3.5,
        pixel_variance_floor=0.04,
        covariance_scale=1.0,
    )
    linear = mode_module.compose_homogeneous_optical_planes(receipt.planes, path_scale=path_scale)
    return linear, {
        "identity": "existing-ewa-shared-transmittance-optical-mode-render-v0",
        "depthBins": depth_bins,
        "pathScale": path_scale,
        "nearDepth": near_depth,
        "farDepth": far_depth,
        "projectedModeCount": receipt.projected_mode_count,
        "projectedDepthSliceCount": receipt.projected_sample_count,
        "projectedFragmentCount": receipt.projected_fragment_count,
        "nominalCoefficientMass": receipt.nominal_coefficient_mass,
        "viewportCoefficientMass": receipt.viewport_coefficient_mass,
    }


def write_png(path: Path, values: np.ndarray) -> None:
    pixels = np.clip(np.round(values * 255.0), 0.0, 255.0).astype(np.uint8)
    require(pixels.ndim == 3 and pixels.shape[2] == 3 and pixels.size > 0, "visual artifact is blank")
    height, width, _ = pixels.shape

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    scanlines = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines, level=6))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(payload)
    require(path.is_file() and path.stat().st_size > 100, f"visual artifact is missing or partial: {path}")


def visual_artifact(path: Path, linear: np.ndarray, mode_module: Any) -> dict[str, Any]:
    write_png(path, mode_module.tone_map_float(linear))
    return {"path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size}


def image_metrics(candidate: np.ndarray, target: np.ndarray) -> dict[str, float]:
    delta = candidate - target
    return {
        "linearMae": float(np.mean(np.abs(delta))),
        "linearRmse": float(np.sqrt(np.mean(np.square(delta)))),
        "targetMeanLuma": float(np.mean(target @ LUMA)),
        "reconstructionMeanLuma": float(np.mean(candidate @ LUMA)),
    }


def sequence_viewer_html(payload: dict[str, Any]) -> str:
    encoded = json.dumps(json_value(payload), separators=(",", ":")).replace("</", "<\\/")
    return f"""<!doctype html>
<html><head><meta charset=\"utf-8\"><title>Multiscale fitting oscilloscope</title>
<style>
html,body{{margin:0;height:100%;background:#090b0d;color:#dce4ea;font:13px system-ui,sans-serif}}body{{display:grid;grid-template-rows:auto 1fr}}header{{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#11161b;border-bottom:1px solid #26313a}}button,input{{accent-color:#ff8a32}}#step{{flex:1}}main{{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(360px,1fr);min-height:0}}#orbit{{width:100%;height:100%;display:block;background:#020304}}#images{{display:grid;grid-template-rows:repeat(3,1fr);min-height:0;border-left:1px solid #26313a}}figure{{position:relative;margin:0;min-height:0;background:#000;border-bottom:1px solid #26313a}}figure img{{width:100%;height:100%;object-fit:contain}}figure.load-error::after{{content:'image failed to load';position:absolute;inset:0;display:grid;place-items:center;color:#ff796f;background:#190907}}figcaption{{position:absolute;z-index:1;left:8px;top:6px;padding:3px 6px;background:#000a;border-radius:4px}}#readout{{font:11px ui-monospace,monospace;color:#9eb0bd;min-width:220px}}#orbit-help{{color:#82919c;white-space:nowrap}}
</style></head><body>
<header><button id=\"play\">Play fit</button><input id=\"step\" type=\"range\" min=\"0\" value=\"0\"><span id=\"orbit-help\">drag left panel to orbit</span><span id=\"readout\"></span></header>
<main><canvas id=\"orbit\"></canvas><section id=\"images\"><figure><figcaption>restricted-medium Raymarch reference</figcaption><img id=\"target\"></figure><figure><figcaption>reconstruction</figcaption><img id=\"reconstruction\"></figure><figure><figcaption>signed residual</figcaption><img id=\"residual\"></figure></section></main>
<script>const data={encoded};const frames=data.frames;const slider=document.querySelector('#step');slider.max=frames.length-1;let index=0,playing=false,yaw=.55,pitch=.15,last=performance.now(),drag=false,px=0,py=0;const canvas=document.querySelector('#orbit'),ctx=canvas.getContext('2d');
const assetUrl=path=>new URL(String(path).split('/').pop(),location.href).href;for(const role of ['target','reconstruction','residual']){{const img=document.querySelector('#'+role);img.onerror=()=>img.closest('figure').classList.add('load-error');img.onload=()=>img.closest('figure').classList.remove('load-error')}}
function fit(){{const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.max(1,r.width*d);canvas.height=Math.max(1,r.height*d);ctx.setTransform(d,0,0,d,0,0)}}new ResizeObserver(fit).observe(canvas);fit();
function project(p){{const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);let x=cy*p[0]-sy*p[2],z=sy*p[0]+cy*p[2],y=cp*p[1]-sp*z;z=sp*p[1]+cp*z;const s=Math.min(canvas.clientWidth,canvas.clientHeight)*.42/data.worldRadius;return [canvas.clientWidth/2+x*s,canvas.clientHeight/2-y*s,z]}}
function draw(){{ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);const f=frames[index],items=[];for(const s of data.sourceCells){{const p=project(s.position);items.push({{z:p[2],x:p[0],y:p[1],r:Math.max(1.2,2.2*s.weight/data.maxSourceWeight),c:'rgba(255,105,30,.25)'}})}}for(const m of f.primitives){{const p=project(m.position),e=Math.max(...m.covarianceEigenvalues);items.push({{z:p[2],x:p[0],y:p[1],r:Math.max(3,Math.sqrt(e)*Math.min(canvas.clientWidth,canvas.clientHeight)*.42/data.worldRadius),c:'rgba(255,220,115,.72)'}})}}items.sort((a,b)=>b.z-a.z);for(const q of items){{ctx.beginPath();ctx.arc(q.x,q.y,q.r,0,Math.PI*2);ctx.fillStyle=q.c;ctx.fill()}}document.querySelector('#readout').textContent=`iter ${{f.iteration}} · ${{f.primitives.length}} modes · objective ${{f.objective.toExponential(3)}}`;for(const role of ['target','reconstruction','residual']){{const img=document.querySelector('#'+role),next=assetUrl(f[role].path);if(img.src!==next)img.src=next}}}}
function setStep(v){{index=Math.max(0,Math.min(frames.length-1,Number(v)));slider.value=index;draw()}}slider.oninput=e=>setStep(e.target.value);document.querySelector('#play').onclick=()=>{{playing=!playing;last=performance.now();document.querySelector('#play').textContent=playing?'Pause fit':'Play fit'}};canvas.onpointerdown=e=>{{drag=true;px=e.clientX;py=e.clientY;canvas.setPointerCapture(e.pointerId)}};canvas.onpointermove=e=>{{if(!drag)return;yaw+=(e.clientX-px)*.008;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-py)*.008));px=e.clientX;py=e.clientY;draw()}};canvas.onpointerup=()=>drag=false;
function tick(t){{if(playing&&t-last>520){{setStep((index+1)%frames.length);last=t}}requestAnimationFrame(tick)}}setStep(0);requestAnimationFrame(tick);
</script></body></html>"""


def load_source_rows(manifest_path: Path, state_id: str) -> tuple[dict[str, Any], dict[str, Any], np.ndarray, np.ndarray, np.ndarray]:
    require(manifest_path.is_file(), f"source manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get("schema") == EXPECTED_SOURCE_SCHEMA and manifest.get("status") == "complete", "source manifest is not the accepted exact motion corpus")
    require(manifest.get("coefficientTargets", {}).get("order") == list(COEFFICIENT_ORDER), "source coefficient order drifted")
    state = next((item for item in manifest.get("states", []) if item.get("id") == state_id), None)
    require(isinstance(state, dict), f"source state is missing: {state_id}")
    replay = state.get("replay") or {}
    require(replay.get("effectiveRoute") == EXPECTED_ROUTE, "source effective route is not the native 3D volume route")
    require(int(replay.get("grid", 0)) > 0, "source grid is missing")
    rows = state.get("rows") or {}
    row_count = int(rows.get("count", 0))
    native_descriptor = rows.get("nativeCellIndices") or {}
    coefficient_descriptor = rows.get("coefficients") or {}
    kernel_descriptor = rows.get("kernelDescriptors") or {}
    require(native_descriptor.get("shape") == [row_count], "native index shape drifted")
    require(coefficient_descriptor.get("shape") == [row_count, 8], "coefficient shape drifted")
    require(kernel_descriptor.get("shape") == [row_count, 8], "kernel projection shape drifted")
    native_path = resolve_artifact(native_descriptor, manifest_path, "native indices")
    coefficient_path = resolve_artifact(coefficient_descriptor, manifest_path, "coefficients")
    kernel_path = resolve_artifact(kernel_descriptor, manifest_path, "kernel descriptors")
    native_ids = np.memmap(native_path, dtype="<u4", mode="r", shape=(row_count,)).astype(np.uint32)
    coefficients = np.memmap(coefficient_path, dtype="<f4", mode="r", shape=(row_count, 8)).astype(np.float64)
    kernel = np.memmap(kernel_path, dtype="<f4", mode="r", shape=(row_count, 8)).astype(np.float64)
    positions = kernel[:, :3]
    require(np.allclose(kernel[:, 3], native_ids.astype(np.float64)), "kernel descriptor native ids do not align")
    return manifest, state, native_ids, positions, coefficients


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--state-id", default="coefficient-state-120")
    parser.add_argument("--mode-module", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--target-grid", type=int, default=16)
    parser.add_argument("--primitive-count", type=int, default=48)
    parser.add_argument("--iterations", type=int, default=12)
    parser.add_argument("--capture-cadence", type=int, default=1)
    parser.add_argument("--soft-neighbors", type=int, default=3)
    parser.add_argument("--temperature-cells", type=float, default=0.9)
    parser.add_argument(
        "--assignment-arm",
        choices=(
            "hard-full",
            "soft-frozen-covariance",
            "soft-full",
            "soft-optics-exclusive-geometry",
        ),
        default="soft-full",
    )
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--samples-per-cell", type=int, default=4)
    parser.add_argument("--path-scale", type=float, default=DEFAULT_PATH_SCALE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "report.json"
    phase = "source-validation"
    evidence: dict[str, Any] = {
        "requestedManifest": str(args.manifest.expanduser().resolve()),
        "requestedStateId": args.state_id,
        "requestedTargetGrid": args.target_grid,
        "requestedPopulation": args.population,
        "requestedAssignmentArm": args.assignment_arm,
    }
    report: dict[str, Any] = {
        "schema": SEQUENCE_SCHEMA,
        "identity": SEQUENCE_IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "lastTrustworthyEvidence": evidence,
        "sampleCap": None,
        "droppedRowCount": None,
    }
    try:
        manifest_path = args.manifest.expanduser().resolve()
        mode_path = args.mode_module.expanduser().resolve()
        manifest, state, native_ids, positions, coefficients = load_source_rows(manifest_path, args.state_id)
        replay = state["replay"]
        source_grid = int(replay["grid"])
        evidence.update({
            "sourceManifestSha256": sha256_file(manifest_path),
            "sourceRowCount": int(native_ids.size),
            "sourceGrid": source_grid,
            "effectiveRoute": replay["effectiveRoute"],
            "backend": replay.get("backend"),
        })
        phase = "simulation-grid-restriction"
        medium = restrict_selected_optical_medium(
            native_ids,
            positions,
            coefficients,
            source_grid=source_grid,
            target_grid=args.target_grid,
            population=args.population,
        )
        evidence.update({
            "restrictedPositiveCellCount": int(medium.positions.shape[0]),
            "restrictionConserved": medium.conservation["conserved"],
        })
        phase = "fit-sequence"
        full_sequence = fit_optical_modes(
            medium,
            primitive_count=args.primitive_count,
            iteration_count=args.iterations,
            soft_neighbors=args.soft_neighbors,
            temperature_cells=args.temperature_cells,
            assignment_arm=args.assignment_arm,
        )
        require(args.capture_cadence > 0, "capture cadence must be positive")
        captured = [state for state in full_sequence if state.iteration % args.capture_cadence == 0 or state.iteration == args.iterations]
        mode_module = load_module(mode_path, "multiscale_optical_mode_renderer")
        camera = state.get("target") or {}
        require(camera.get("cameraPose") and int(camera.get("width", 0)) > 0, "source held camera is missing")
        phase = "restricted-medium-raymarch-reference-render"
        target_linear, _, target_render = render_restricted_medium(
            medium,
            camera,
            width=args.render_width,
            samples_per_cell=args.samples_per_cell,
        )
        target_render.update({
            "comparisonContract": "same-restricted-optical-medium-raymarch-versus-fitted-events-v0",
            "restrictedCellCount": int(medium.coarse_cell_ids.size),
        })
        target_path = args.output_dir / "target-restricted-medium-raymarch.png"
        target_artifact = visual_artifact(target_path, target_linear, mode_module)
        phase = "restricted-cell-ewa-control-render"
        control_linear, control_render = render_modes(
            mode_module,
            restricted_medium_oracle_state(medium),
            args.population,
            camera,
            width=args.render_width,
            depth_bins=args.depth_bins,
            path_scale=args.path_scale,
        )
        control_render.update({
            "identity": "restricted-cell-ewa-control-v0",
            "comparisonContract": "same-renderer-same-coefficients-cell-events-versus-fitted-events-control-v0",
            "restrictedCellEventCount": int(medium.coarse_cell_ids.size),
        })
        control_path = args.output_dir / "control-restricted-cell-ewa.png"
        control_artifact = visual_artifact(control_path, control_linear, mode_module)
        frame_rows: list[dict[str, Any]] = []
        phase = "sequence-render"
        for mode_state in captured:
            reconstruction, reconstruction_receipt = render_modes(
                mode_module,
                mode_state,
                args.population,
                camera,
                width=args.render_width,
                depth_bins=args.depth_bins,
                path_scale=args.path_scale,
            )
            residual = target_linear - reconstruction
            residual_scale = float(np.percentile(np.abs(residual), 99.5))
            residual_scale = max(residual_scale, 1e-8)
            residual_preview = np.clip(0.5 + residual / (2.0 * residual_scale), 0.0, 1.0)
            stem = f"iteration-{mode_state.iteration:03d}"
            reconstruction_artifact = visual_artifact(args.output_dir / f"{stem}-reconstruction.png", reconstruction, mode_module)
            residual_path = args.output_dir / f"{stem}-signed-residual.png"
            write_png(residual_path, residual_preview)
            eigenvalues = np.linalg.eigvalsh(mode_state.covariances)
            frame_rows.append({
                "iteration": mode_state.iteration,
                "stablePrimitiveIdentity": "mode-id-persists-across-recorded-soft-em-iterations-v0",
                "objective": mode_state.objective,
                "maximumPositionDelta": mode_state.maximum_position_delta,
                "coefficientMass": np.sum(mode_state.coefficients, axis=0, dtype=np.float64),
                "metrics": image_metrics(reconstruction, target_linear),
                "controlMetrics": image_metrics(reconstruction, control_linear),
                "target": target_artifact,
                "reconstruction": reconstruction_artifact,
                "residual": {
                    "path": str(residual_path),
                    "sha256": sha256_file(residual_path),
                    "bytes": residual_path.stat().st_size,
                    "signedPreviewScale": residual_scale,
                },
                "renderReceipt": reconstruction_receipt,
                "primitives": [
                    {
                        "id": int(mode_state.mode_ids[index]),
                        "position": mode_state.positions[index],
                        "covariance": mode_state.covariances[index],
                        "covarianceEigenvalues": eigenvalues[index],
                        "coefficients": mode_state.coefficients[index],
                        "sourceRowCount": int(mode_state.source_row_counts[index]),
                    }
                    for index in range(mode_state.mode_ids.size)
                ],
            })
        phase = "artifact-write"
        source_weights = optical_weight(medium.coefficients)
        world_center = medium.origin + medium.source_spacing * source_grid * 0.5
        world_radius = float(np.linalg.norm(medium.source_spacing * source_grid) * 0.5)
        sequence_manifest = {
            "schema": SEQUENCE_SCHEMA,
            "identity": SEQUENCE_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "authority": "exact-selected-optical-source-physically-restricted-first-fitting-oscilloscope-v0",
            "claimBoundary": {
                "fullVolumeAuthority": False,
                "selectedOpticalMediumAuthority": True,
                "screenSpaceDownsampleUsed": False,
                "independentLowResolutionSimulationUsed": False,
                "visualClosureClaimed": False,
                "productionEconomicsClaimed": False,
            },
            "source": {
                "manifestPath": str(manifest_path),
                "manifestSha256": sha256_file(manifest_path),
                "manifestIdentity": manifest.get("identity"),
                "stateId": args.state_id,
                "sameStateCaptureId": state.get("sameStateCaptureId"),
                "sourceFieldManifest": state.get("sourceFieldManifest"),
                "requestedControlIdentity": state.get("requestedControlIdentity"),
                "effectiveControlIdentity": state.get("effectiveControlIdentity"),
                "requestedRoute": manifest.get("route", {}).get("requested"),
                "effectiveRoute": replay["effectiveRoute"],
                "backend": replay.get("backend"),
                "sourceGrid": source_grid,
                "sourceRowCount": int(native_ids.size),
                "sampleCap": None,
                "droppedRowCount": 0,
            },
            "restriction": {
                "identity": RESTRICTION_IDENTITY,
                "population": args.population,
                "targetGrid": args.target_grid,
                "positiveCellCount": int(medium.positions.shape[0]),
                "origin": medium.origin,
                "spacing": medium.spacing,
                "selectedMass": medium.selected_mass,
                "explicitRemainderMass": medium.remainder_mass,
                "conservation": medium.conservation,
            },
            "solver": {
                "identity": SOLVER_IDENTITY,
                "primitiveCount": args.primitive_count,
                "iterationCount": args.iterations,
                "captureCadence": args.capture_cadence,
                "softNeighbors": args.soft_neighbors,
                "temperatureCells": args.temperature_cells,
                "assignmentArm": args.assignment_arm,
                "geometryOwnership": (
                    "exclusive-winner-from-soft-responsibilities"
                    if args.assignment_arm == "soft-optics-exclusive-geometry"
                    else args.assignment_arm
                ),
                "coefficientOwnership": (
                    "three-neighbor-soft-conservative"
                    if args.assignment_arm == "soft-optics-exclusive-geometry"
                    else args.assignment_arm
                ),
                "covariancePolicy": (
                    "iteration-zero-frozen"
                    if args.assignment_arm == "soft-frozen-covariance"
                    else "full-moment-update"
                ),
                "stablePrimitiveIdentity": True,
            },
            "viewerContract": {
                "playPauseScrub": True,
                "continuousOrbit": True,
                "worldSpaceSourceAndPrimitives": True,
                "heldCameraTargetReconstructionResidual": True,
                "orbitRenderAuthority": "diagnostic-world-space-geometry-only-v0",
            },
            "reference": {
                "identity": "restricted-medium-raymarch-reference",
                "artifact": target_artifact,
                "renderReceipt": target_render,
            },
            "control": {
                "identity": "restricted-cell-ewa-control",
                "artifact": control_artifact,
                "renderReceipt": control_render,
            },
            "targetRender": target_render,
            "worldCenter": world_center,
            "worldRadius": world_radius,
            "maxSourceWeight": float(np.max(source_weights)),
            "sourceCells": [
                {
                    "id": int(medium.coarse_cell_ids[index]),
                    "position": medium.positions[index] - world_center,
                    "weight": float(source_weights[index]),
                    "coefficients": medium.coefficients[index],
                }
                for index in range(medium.positions.shape[0])
            ],
            "frames": frame_rows,
        }
        for frame in sequence_manifest["frames"]:
            for primitive in frame["primitives"]:
                primitive["position"] = np.asarray(primitive["position"]) - world_center
        sequence_path = args.output_dir / "sequence-manifest.json"
        write_json(sequence_path, sequence_manifest)
        viewer_path = args.output_dir / "index.html"
        viewer_path.write_text(sequence_viewer_html(sequence_manifest), encoding="utf-8")
        require(viewer_path.stat().st_size > 1000, "sequence viewer is blank or partial")
        report = {
            "schema": SEQUENCE_SCHEMA,
            "identity": SEQUENCE_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "lastTrustworthyEvidence": evidence,
            "sampleCap": None,
            "droppedRowCount": 0,
            "sequenceManifest": {"path": str(sequence_path), "sha256": sha256_file(sequence_path)},
            "viewer": {"path": str(viewer_path), "sha256": sha256_file(viewer_path)},
            "frameCount": len(frame_rows),
            "firstIteration": frame_rows[0]["iteration"],
            "lastIteration": frame_rows[-1]["iteration"],
            "restrictionConservation": medium.conservation,
            "finalMetrics": frame_rows[-1]["metrics"],
        }
        write_json(report_path, report)
        print(json.dumps(json_value(report), indent=2))
        return 0
    except Exception as error:
        report.update({
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "traceback": traceback.format_exc(),
            "lastTrustworthyEvidence": evidence,
        })
        write_json(report_path, report)
        print(json.dumps(json_value(report), indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
