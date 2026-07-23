#!/usr/bin/env python3
"""Construct conserved off-lattice optical modes from exact Grid96 parents."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import heapq
import math

import numpy as np


POPULATION_NAMES = ("ridge", "nonridge")
FIELD_NAMES = (
    "ridge-emission",
    "ridge-extinction",
    "nonridge-emission",
    "nonridge-extinction",
)
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
LUMA_WEIGHTS = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float64)


@dataclass(frozen=True)
class OpticalModes:
    mode_ids: np.ndarray
    brick_ids: np.ndarray
    population_ids: np.ndarray
    child_ids: np.ndarray
    positions: np.ndarray
    covariances: np.ndarray
    coefficients: np.ndarray
    source_row_counts: np.ndarray
    optical_weights: np.ndarray
    split_scores: np.ndarray


@dataclass(frozen=True)
class RasterReceipt:
    planes: np.ndarray
    projected_mode_count: int
    projected_sample_count: int
    projected_fragment_count: int
    nominal_coefficient_mass: np.ndarray
    viewport_coefficient_mass: np.ndarray


@dataclass(frozen=True)
class SparseEmissionProjection:
    flat_pixel_indices: np.ndarray
    linear_rgb: np.ndarray
    projected_mode_count: int
    projected_depth_slice_count: int
    projected_fragment_count: int


@dataclass(frozen=True)
class ImportanceCohort:
    core_row_indices: np.ndarray
    halo_row_indices: np.ndarray
    sampled_importance: np.ndarray
    captured_mass_fraction: float


@dataclass(frozen=True)
class OpticalCollapseReceipt:
    boundaries: tuple[tuple[int, int], ...]
    segment_emission: np.ndarray
    segment_optical_depth: np.ndarray
    linear_rgb: np.ndarray
    final_transmittance: np.ndarray
    objective: float


@dataclass(frozen=True)
class _OpticalSegment:
    start: int
    end: int
    emission: np.ndarray
    optical_depth: np.ndarray
    exact_color: np.ndarray
    transmittance: np.ndarray
    objective: float


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _positive_semidefinite(matrix: np.ndarray, floor: float) -> np.ndarray:
    symmetric = 0.5 * (matrix + matrix.T)
    eigenvalues, eigenvectors = np.linalg.eigh(symmetric)
    return (eigenvectors * np.maximum(eigenvalues, floor)) @ eigenvectors.T


def _population_weight(local_coefficients: np.ndarray) -> np.ndarray:
    return local_coefficients[:, :3] @ LUMA_WEIGHTS + local_coefficients[:, 3]


def _field_channels(field_id: int) -> tuple[int, ...]:
    require(0 <= field_id < len(FIELD_NAMES), "optical field id is invalid")
    if field_id == 0:
        return (0, 1, 2)
    if field_id == 1:
        return (3,)
    if field_id == 2:
        return (4, 5, 6)
    return (7,)


def _field_weight(coefficients: np.ndarray, field_id: int) -> np.ndarray:
    channels = _field_channels(field_id)
    if len(channels) == 3:
        return coefficients[:, channels] @ LUMA_WEIGHTS
    return coefficients[:, channels[0]]


def _ordered_unique_indices(indices: np.ndarray, size: int, role: str) -> np.ndarray:
    values = np.asarray(indices)
    require(values.ndim == 1, f"{role} row indices must be a vector")
    require(np.issubdtype(values.dtype, np.integer), f"{role} row indices must be integers")
    values = values.astype(np.int64, copy=False)
    require(np.all((values >= 0) & (values < size)), f"{role} row index is out of range")
    require(np.unique(values).size == values.size, f"{role} row indices contain duplicates")
    return values


def _optical_layers(planes: np.ndarray, path_scale: float) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(planes)
    require(values.ndim == 4 and values.shape[-1] == 8, "optical planes must have depth/height/width/eight-channel shape")
    require(values.shape[0] > 0 and values.shape[1] > 0 and values.shape[2] > 0, "optical planes must be nonempty")
    require(np.all(np.isfinite(values)), "optical planes contain nonfinite values")
    require(np.all(values >= 0.0), "optical planes contain negative values")
    require(math.isfinite(path_scale) and path_scale > 0.0, "path scale must be positive and finite")
    emission = (values[..., 0:3] + values[..., 4:7]).astype(np.float64, copy=False) * path_scale
    optical_depth = (values[..., 3] + values[..., 7]).astype(np.float64, copy=False) * path_scale
    return emission, optical_depth


def _homogeneous_optical_transfer(
    emission: np.ndarray,
    optical_depth: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    transmittance = np.exp(-optical_depth)
    alpha = -np.expm1(-optical_depth)
    source_scale = np.divide(
        alpha,
        optical_depth,
        out=np.zeros_like(optical_depth, dtype=np.float64),
        where=optical_depth > 1e-6,
    )
    return emission * source_scale[..., None], transmittance


def _compose_segment_arrays(
    segment_emission: np.ndarray,
    segment_optical_depth: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    height, width = segment_optical_depth.shape[1:]
    color = np.zeros((height, width, 3), dtype=np.float64)
    foreground_transmittance = np.ones((height, width), dtype=np.float64)
    for segment_index in range(segment_optical_depth.shape[0]):
        emitted_color, segment_transmittance = _homogeneous_optical_transfer(
            segment_emission[segment_index],
            segment_optical_depth[segment_index],
        )
        color += foreground_transmittance[..., None] * emitted_color
        foreground_transmittance *= segment_transmittance
    return color, foreground_transmittance


def compose_homogeneous_optical_planes(planes: np.ndarray, *, path_scale: float) -> np.ndarray:
    emission, optical_depth = _optical_layers(planes, path_scale)
    color, _ = _compose_segment_arrays(emission, optical_depth)
    return color


def tone_map_float(linear: np.ndarray) -> np.ndarray:
    values = np.asarray(linear, dtype=np.float64)
    require(np.all(np.isfinite(values)), "tone-map input contains nonfinite values")
    exposed = 1.0 - np.exp(-np.maximum(values, 0.0) * 0.96)
    return np.power(np.clip(exposed, 0.0, 1.0), 0.84)


def marginal_tone_mapped_error_gain(
    control_linear_rgb: np.ndarray,
    target_srgb: np.ndarray,
    flat_pixel_indices: np.ndarray,
    delta_linear_rgb: np.ndarray,
) -> float:
    control = np.asarray(control_linear_rgb, dtype=np.float64)
    target = np.asarray(target_srgb, dtype=np.float64)
    indices = np.asarray(flat_pixel_indices)
    delta = np.asarray(delta_linear_rgb, dtype=np.float64)
    require(control.ndim == 3 and control.shape[-1] == 3, "marginal control image must be height/width/rgb")
    require(target.shape == control.shape, "marginal target image shape differs from control")
    require(np.all(np.isfinite(control)) and np.all(control >= 0.0), "marginal control image is invalid")
    require(np.all(np.isfinite(target)) and np.all((target >= 0.0) & (target <= 1.0)), "marginal target image is invalid")
    require(indices.ndim == 1 and np.issubdtype(indices.dtype, np.integer), "marginal pixel indices must be an integer vector")
    indices = indices.astype(np.int64, copy=False)
    require(np.unique(indices).size == indices.size, "marginal pixel indices contain duplicates")
    require(np.all((indices >= 0) & (indices < control.shape[0] * control.shape[1])), "marginal pixel index is out of range")
    require(delta.shape == (indices.size, 3), "marginal delta must align as pixel/rgb rows")
    require(np.all(np.isfinite(delta)), "marginal delta contains nonfinite values")
    if indices.size == 0:
        return 0.0
    flat_control = control.reshape((-1, 3))[indices]
    flat_target = target.reshape((-1, 3))[indices]
    before = tone_map_float(flat_control) - flat_target
    after = tone_map_float(np.maximum(flat_control + delta, 0.0)) - flat_target
    return float(np.sum(np.square(before), dtype=np.float64) - np.sum(np.square(after), dtype=np.float64))


def _prefix_transmittance(optical_depth: np.ndarray) -> np.ndarray:
    prefix = np.ones((optical_depth.shape[0] + 1, *optical_depth.shape[1:]), dtype=np.float64)
    for depth_index in range(optical_depth.shape[0]):
        prefix[depth_index + 1] = prefix[depth_index] * np.exp(-optical_depth[depth_index])
    return prefix


def _segment_from_layers(
    emission: np.ndarray,
    optical_depth: np.ndarray,
    prefix_transmittance: np.ndarray,
    start: int,
    end: int,
) -> _OpticalSegment:
    exact_color = np.zeros((*optical_depth.shape[1:], 3), dtype=np.float64)
    interval_transmittance = np.ones(optical_depth.shape[1:], dtype=np.float64)
    for depth_index in range(start, end):
        emitted_color, layer_transmittance = _homogeneous_optical_transfer(
            emission[depth_index],
            optical_depth[depth_index],
        )
        exact_color += interval_transmittance[..., None] * emitted_color
        interval_transmittance *= layer_transmittance
    segment_emission = np.sum(emission[start:end], axis=0, dtype=np.float64)
    segment_optical_depth = np.sum(optical_depth[start:end], axis=0, dtype=np.float64)
    approximate_color, _ = _homogeneous_optical_transfer(segment_emission, segment_optical_depth)
    weighted_delta = prefix_transmittance[start][..., None] * (approximate_color - exact_color)
    luma_delta = weighted_delta @ LUMA_WEIGHTS
    objective = float(np.mean(np.sum(np.square(weighted_delta), axis=-1) + np.square(luma_delta)))
    return _OpticalSegment(
        start=start,
        end=end,
        emission=segment_emission,
        optical_depth=segment_optical_depth,
        exact_color=exact_color,
        transmittance=interval_transmittance,
        objective=objective,
    )


def _merge_optical_segments(
    left: _OpticalSegment,
    right: _OpticalSegment,
    prefix_transmittance: np.ndarray,
) -> _OpticalSegment:
    require(left.end == right.start, "optical segments must be adjacent")
    emission = left.emission + right.emission
    optical_depth = left.optical_depth + right.optical_depth
    exact_color = left.exact_color + left.transmittance[..., None] * right.exact_color
    transmittance = left.transmittance * right.transmittance
    approximate_color, _ = _homogeneous_optical_transfer(emission, optical_depth)
    weighted_delta = prefix_transmittance[left.start][..., None] * (approximate_color - exact_color)
    luma_delta = weighted_delta @ LUMA_WEIGHTS
    objective = float(np.mean(np.sum(np.square(weighted_delta), axis=-1) + np.square(luma_delta)))
    return _OpticalSegment(
        start=left.start,
        end=right.end,
        emission=emission,
        optical_depth=optical_depth,
        exact_color=exact_color,
        transmittance=transmittance,
        objective=objective,
    )


def _collapse_receipt(segments: list[_OpticalSegment]) -> OpticalCollapseReceipt:
    ordered = sorted(segments, key=lambda segment: segment.start)
    require(all(left.end == right.start for left, right in zip(ordered, ordered[1:])), "collapsed optical segments are not contiguous")
    segment_emission = np.stack([segment.emission for segment in ordered])
    segment_optical_depth = np.stack([segment.optical_depth for segment in ordered])
    linear_rgb, final_transmittance = _compose_segment_arrays(segment_emission, segment_optical_depth)
    return OpticalCollapseReceipt(
        boundaries=tuple((segment.start, segment.end) for segment in ordered),
        segment_emission=segment_emission,
        segment_optical_depth=segment_optical_depth,
        linear_rgb=linear_rgb,
        final_transmittance=final_transmittance,
        objective=float(sum(segment.objective for segment in ordered)),
    )


def uniform_optical_collapse(
    planes: np.ndarray,
    *,
    target_segments: int,
    path_scale: float,
) -> OpticalCollapseReceipt:
    emission, optical_depth = _optical_layers(planes, path_scale)
    depth_count = emission.shape[0]
    require(isinstance(target_segments, int) and 0 < target_segments <= depth_count, "target segment count is invalid")
    prefix = _prefix_transmittance(optical_depth)
    boundaries = [round(index * depth_count / target_segments) for index in range(target_segments + 1)]
    require(all(left < right for left, right in zip(boundaries, boundaries[1:])), "uniform collapse produced an empty segment")
    return _collapse_receipt([
        _segment_from_layers(emission, optical_depth, prefix, start, end)
        for start, end in zip(boundaries, boundaries[1:])
    ])


def greedy_transport_error_collapse(
    planes: np.ndarray,
    *,
    target_segments: int,
    path_scale: float,
) -> OpticalCollapseReceipt:
    emission, optical_depth = _optical_layers(planes, path_scale)
    depth_count = emission.shape[0]
    require(isinstance(target_segments, int) and 0 < target_segments <= depth_count, "target segment count is invalid")
    prefix = _prefix_transmittance(optical_depth)
    segments: dict[int, _OpticalSegment] = {
        depth_index: _segment_from_layers(emission, optical_depth, prefix, depth_index, depth_index + 1)
        for depth_index in range(depth_count)
    }
    previous_ids: dict[int, int | None] = {depth_index: depth_index - 1 if depth_index > 0 else None for depth_index in range(depth_count)}
    next_ids: dict[int, int | None] = {depth_index: depth_index + 1 if depth_index + 1 < depth_count else None for depth_index in range(depth_count)}
    candidates: list[tuple[float, int, int, int, int]] = []
    next_segment_id = depth_count

    def push_candidate(left_id: int, right_id: int) -> None:
        if left_id not in segments or right_id not in segments or next_ids.get(left_id) != right_id:
            return
        merged = _merge_optical_segments(segments[left_id], segments[right_id], prefix)
        delta = merged.objective - segments[left_id].objective - segments[right_id].objective
        heapq.heappush(candidates, (delta, merged.start, merged.end, left_id, right_id))

    for depth_index in range(depth_count - 1):
        push_candidate(depth_index, depth_index + 1)

    while len(segments) > target_segments:
        require(bool(candidates), "adaptive collapse exhausted merge candidates")
        _, _, _, left_id, right_id = heapq.heappop(candidates)
        if left_id not in segments or right_id not in segments or next_ids.get(left_id) != right_id:
            continue
        left_previous = previous_ids[left_id]
        right_next = next_ids[right_id]
        merged = _merge_optical_segments(segments[left_id], segments[right_id], prefix)
        del segments[left_id]
        del segments[right_id]
        new_id = next_segment_id
        next_segment_id += 1
        segments[new_id] = merged
        previous_ids[new_id] = left_previous
        next_ids[new_id] = right_next
        if left_previous is not None:
            next_ids[left_previous] = new_id
        if right_next is not None:
            previous_ids[right_next] = new_id
        push_candidate(left_previous, new_id) if left_previous is not None else None
        push_candidate(new_id, right_next) if right_next is not None else None

    return _collapse_receipt(list(segments.values()))


def select_importance_cohort(
    native_ids: np.ndarray,
    importance_field: np.ndarray,
    *,
    eligible_rows: np.ndarray | None = None,
    mass_fraction: float = 0.9,
    grid: int = 96,
) -> ImportanceCohort:
    ids = np.asarray(native_ids)
    field = np.asarray(importance_field, dtype=np.float64)
    require(ids.ndim == 1 and ids.size > 0, "native ids must be a nonempty vector")
    require(np.issubdtype(ids.dtype, np.integer), "native ids must be integers")
    require(np.unique(ids).size == ids.size, "native ids contain duplicate rows")
    require(isinstance(grid, int) and grid > 0, "grid must be a positive integer")
    require(np.all((ids >= 0) & (ids < grid**3)), "native id is out of range for grid")
    require(field.shape == (grid, grid, grid), "importance field must match the z/y/x source grid")
    require(np.all(np.isfinite(field)) and np.all(field >= 0.0), "importance field is invalid")
    require(math.isfinite(mass_fraction) and 0.0 < mass_fraction <= 1.0, "importance mass fraction is invalid")
    if eligible_rows is None:
        eligible = np.ones(ids.size, dtype=bool)
    else:
        eligible = np.asarray(eligible_rows)
        require(eligible.shape == (ids.size,) and eligible.dtype == np.bool_, "eligible rows must be a boolean vector aligned with native ids")

    ids64 = ids.astype(np.int64, copy=False)
    sampled = field.reshape(-1)[ids64]
    positive_rows = np.flatnonzero((sampled > 0.0) & eligible)
    require(positive_rows.size > 0, "importance field nominates no source parents")
    ranked = positive_rows[np.lexsort((ids64[positive_rows], -sampled[positive_rows]))]
    cumulative = np.cumsum(sampled[ranked], dtype=np.float64)
    total = float(cumulative[-1])
    core_count = int(np.searchsorted(cumulative, total * mass_fraction, side="left") + 1)
    core_rows = ranked[:core_count]
    captured = float(cumulative[core_count - 1] / total)

    row_by_native_id = np.full(grid**3, -1, dtype=np.int64)
    row_by_native_id[ids64] = np.arange(ids64.size, dtype=np.int64)
    core_ids = ids64[core_rows]
    core_x = core_ids % grid
    core_y = (core_ids // grid) % grid
    core_z = core_ids // (grid * grid)
    halo_parts = [core_rows]
    for dz in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0 and dz == 0:
                    continue
                valid = (
                    (core_x + dx >= 0)
                    & (core_x + dx < grid)
                    & (core_y + dy >= 0)
                    & (core_y + dy < grid)
                    & (core_z + dz >= 0)
                    & (core_z + dz < grid)
                )
                neighbor_ids = (
                    core_ids[valid]
                    + dx
                    + dy * grid
                    + dz * grid * grid
                )
                neighbor_rows = row_by_native_id[neighbor_ids]
                halo_parts.append(neighbor_rows[neighbor_rows >= 0])
    halo_rows = np.unique(np.concatenate(halo_parts))
    core_rows = core_rows[np.argsort(ids64[core_rows], kind="stable")]
    halo_rows = halo_rows[np.argsort(ids64[halo_rows], kind="stable")]
    return ImportanceCohort(
        core_row_indices=core_rows,
        halo_row_indices=halo_rows,
        sampled_importance=sampled,
        captured_mass_fraction=captured,
    )


def matched_brick_mode_counts(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    core_row_indices: np.ndarray,
    *,
    grid: int = 96,
    brick_size: int = 2,
) -> tuple[int, int]:
    ids = np.asarray(native_ids)
    optical_coefficients = np.asarray(coefficients, dtype=np.float64)
    core_rows = _ordered_unique_indices(core_row_indices, ids.size, "core")
    require(ids.ndim == 1 and np.issubdtype(ids.dtype, np.integer), "native ids must be an integer vector")
    require(np.unique(ids).size == ids.size, "native ids contain duplicate rows")
    require(optical_coefficients.shape == (ids.size, 8), "coefficients must align as eight-channel rows")
    require(isinstance(grid, int) and grid > 0, "grid must be a positive integer")
    require(isinstance(brick_size, int) and brick_size > 0, "brick size must be a positive integer")
    ids64 = ids.astype(np.int64, copy=False)
    cells_x = ids64 % grid
    cells_y = (ids64 // grid) % grid
    cells_z = ids64 // (grid * grid)
    bricks_per_axis = (grid + brick_size - 1) // brick_size
    brick_ids = (
        cells_x // brick_size
        + (cells_y // brick_size) * bricks_per_axis
        + (cells_z // brick_size) * bricks_per_axis * bricks_per_axis
    )
    counts = []
    for population_id in range(2):
        coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
        positive = np.any(optical_coefficients[core_rows, coefficient_slice] > 0.0, axis=1)
        counts.append(int(np.unique(brick_ids[core_rows[positive]]).size))
    return counts[0], counts[1]


def _connected_context_components(
    native_ids: np.ndarray,
    core_mask: np.ndarray,
    context_mask: np.ndarray,
    positive_mask: np.ndarray,
    grid: int,
) -> list[tuple[np.ndarray, np.ndarray]]:
    active_rows = np.flatnonzero(context_mask & positive_mask)
    active_by_id = np.zeros(grid**3, dtype=bool)
    active_by_id[native_ids[active_rows]] = True
    row_by_id = np.full(grid**3, -1, dtype=np.int64)
    row_by_id[native_ids] = np.arange(native_ids.size, dtype=np.int64)
    visited = np.zeros(grid**3, dtype=bool)
    components: list[tuple[np.ndarray, np.ndarray]] = []
    offsets = tuple(
        (dx, dy, dz)
        for dz in (-1, 0, 1)
        for dy in (-1, 0, 1)
        for dx in (-1, 0, 1)
        if (dx, dy, dz) != (0, 0, 0)
    )
    for seed_id in np.sort(native_ids[active_rows]):
        seed_id = int(seed_id)
        if visited[seed_id]:
            continue
        stack = [seed_id]
        visited[seed_id] = True
        context_rows: list[int] = []
        while stack:
            native_id = stack.pop()
            row_index = int(row_by_id[native_id])
            context_rows.append(row_index)
            x = native_id % grid
            y = (native_id // grid) % grid
            z = native_id // (grid * grid)
            for dx, dy, dz in offsets:
                nx, ny, nz = x + dx, y + dy, z + dz
                if not (0 <= nx < grid and 0 <= ny < grid and 0 <= nz < grid):
                    continue
                neighbor_id = nx + ny * grid + nz * grid * grid
                if active_by_id[neighbor_id] and not visited[neighbor_id]:
                    visited[neighbor_id] = True
                    stack.append(neighbor_id)
        context = np.asarray(context_rows, dtype=np.int64)
        core = context[core_mask[context] & positive_mask[context]]
        if core.size:
            components.append((core, context))
    return components


def _cluster_geometry(
    rows: np.ndarray,
    *,
    population_id: int,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    covariance_floor_world: float,
) -> tuple[np.ndarray, np.ndarray, float, float]:
    coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
    weights = _population_weight(coefficients[rows, coefficient_slice])
    total_weight = float(np.sum(weights, dtype=np.float64))
    require(total_weight > 0.0, "adaptive optical cluster weight must be positive")
    centroid = np.sum(positions[rows] * weights[:, None], axis=0, dtype=np.float64) / total_weight
    offsets = positions[rows] - centroid
    spatial = np.einsum("n,ni,nj->ij", weights, offsets, offsets, optimize=True) / total_weight
    parent = np.einsum("n,nij->ij", weights, parent_covariances[rows], optimize=True) / total_weight
    covariance = _positive_semidefinite(spatial + parent, covariance_floor_world)
    distortion = total_weight * float(np.trace(covariance))
    return centroid, covariance, total_weight, distortion


def _split_adaptive_cluster(
    core_rows: np.ndarray,
    context_rows: np.ndarray,
    *,
    population_id: int,
    native_ids: np.ndarray,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    covariance_floor_world: float,
) -> tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]] | None:
    if core_rows.size < 2:
        return None
    centroid, covariance, _, _ = _cluster_geometry(
        context_rows,
        population_id=population_id,
        positions=positions,
        parent_covariances=parent_covariances,
        coefficients=coefficients,
        covariance_floor_world=covariance_floor_world,
    )
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    principal = eigenvectors[:, int(np.argmax(eigenvalues))]
    dominant_axis = int(np.argmax(np.abs(principal)))
    if principal[dominant_axis] < 0.0:
        principal = -principal
    core_projection = (positions[core_rows] - centroid) @ principal
    coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
    core_weights = _population_weight(coefficients[core_rows, coefficient_slice])
    order = np.lexsort((native_ids[core_rows], core_projection))
    ordered_rows = core_rows[order]
    cumulative = np.cumsum(core_weights[order], dtype=np.float64)
    split_index = int(np.searchsorted(cumulative, cumulative[-1] * 0.5, side="left") + 1)
    split_index = min(max(split_index, 1), ordered_rows.size - 1)
    left_core = ordered_rows[:split_index]
    right_core = ordered_rows[split_index:]
    threshold = 0.5 * (float(core_projection[order[split_index - 1]]) + float(core_projection[order[split_index]]))
    context_projection = (positions[context_rows] - centroid) @ principal
    left_context = context_rows[context_projection <= threshold]
    right_context = context_rows[context_projection > threshold]
    left_context = np.unique(np.concatenate((left_context, left_core)))
    right_context = np.unique(np.concatenate((right_context, right_core)))
    return (left_core, left_context), (right_core, right_context)


def build_adaptive_cohort_modes(
    native_ids: np.ndarray,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    *,
    core_row_indices: np.ndarray,
    halo_row_indices: np.ndarray,
    target_mode_counts: tuple[int, int],
    split_priority_weights: np.ndarray | None = None,
    split_priority_evaluator: Callable[[OpticalModes, OpticalModes], float] | None = None,
    frontier_evaluator: Callable[[OpticalModes, OpticalModes], None] | None = None,
    grid: int = 96,
    covariance_floor_world: float = 1e-8,
) -> OpticalModes:
    ids = np.asarray(native_ids)
    world_positions = np.asarray(positions, dtype=np.float64)
    covariances = np.asarray(parent_covariances, dtype=np.float64)
    optical_coefficients = np.asarray(coefficients, dtype=np.float64)
    priority_weights = None if split_priority_weights is None else np.asarray(split_priority_weights, dtype=np.float64)
    require(ids.ndim == 1 and ids.size > 0, "native ids must be a nonempty vector")
    require(np.issubdtype(ids.dtype, np.integer), "native ids must be integers")
    require(np.unique(ids).size == ids.size, "native ids contain duplicate rows")
    require(np.all((ids >= 0) & (ids < grid**3)), "native id is out of range for grid")
    require(world_positions.shape == (ids.size, 3), "positions must align as rows by xyz")
    require(covariances.shape == (ids.size, 3, 3), "parent covariances must align as 3x3 rows")
    require(optical_coefficients.shape == (ids.size, 8), "coefficients must align as eight-channel rows")
    require(np.all(np.isfinite(world_positions)), "positions contain nonfinite values")
    require(np.all(np.isfinite(covariances)), "parent covariances contain nonfinite values")
    require(np.all(np.isfinite(optical_coefficients)) and np.all(optical_coefficients >= 0.0), "coefficients are invalid")
    if priority_weights is not None:
        require(priority_weights.shape == (ids.size,), "split priority weights must align with source rows")
        require(np.all(np.isfinite(priority_weights)) and np.all(priority_weights >= 0.0), "split priority weights are invalid")
    require(
        priority_weights is None or split_priority_evaluator is None,
        "split priority weights and evaluator are mutually exclusive",
    )
    require(isinstance(target_mode_counts, tuple) and len(target_mode_counts) == 2, "target mode counts must name two populations")
    require(all(isinstance(value, int) and value >= 0 for value in target_mode_counts), "target mode count is invalid")
    require(math.isfinite(covariance_floor_world) and covariance_floor_world > 0.0, "covariance floor is invalid")
    core_rows_original = _ordered_unique_indices(core_row_indices, ids.size, "core")
    halo_rows_original = _ordered_unique_indices(halo_row_indices, ids.size, "halo")
    require(np.all(np.isin(core_rows_original, halo_rows_original)), "halo must include every core row")

    order = np.argsort(ids, kind="stable")
    inverse_order = np.empty(ids.size, dtype=np.int64)
    inverse_order[order] = np.arange(ids.size, dtype=np.int64)
    ids = ids[order].astype(np.int64, copy=False)
    world_positions = world_positions[order]
    covariances = covariances[order]
    optical_coefficients = optical_coefficients[order]
    if priority_weights is not None:
        priority_weights = priority_weights[order]
    core_rows = inverse_order[core_rows_original]
    halo_rows = inverse_order[halo_rows_original]
    core_mask = np.zeros(ids.size, dtype=bool)
    context_mask = np.zeros(ids.size, dtype=bool)
    core_mask[core_rows] = True
    context_mask[halo_rows] = True

    output_rows: list[tuple[int, int, int, int, np.ndarray, np.ndarray, np.ndarray, int, float, float]] = []
    for population_id, target_count in enumerate(target_mode_counts):
        coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
        positive_mask = np.any(optical_coefficients[:, coefficient_slice] > 0.0, axis=1)
        positive_core_count = int(np.count_nonzero(core_mask & positive_mask))
        if positive_core_count == 0:
            require(target_count == 0, f"population {population_id} has no core mass but received a mode budget")
            continue
        require(0 < target_count <= positive_core_count, f"population {population_id} target mode count is outside core capacity")
        components = _connected_context_components(ids, core_mask, context_mask, positive_mask, grid)
        require(components, f"population {population_id} produced no connected source components")
        require(target_count >= len(components), f"population {population_id} mode budget is below connected-component count")
        if priority_weights is None:
            priority_normalizer = 1.0
        else:
            population_priority = priority_weights[core_mask & positive_mask]
            positive_priority = population_priority[population_priority > 0.0]
            priority_normalizer = float(np.mean(positive_priority, dtype=np.float64)) if positive_priority.size else 1.0

        def cluster_output_row(
            cluster_core: np.ndarray,
            *,
            split_score: float = 0.0,
        ) -> tuple[int, int, int, int, np.ndarray, np.ndarray, np.ndarray, int, float, float]:
            anchor_native_id = int(np.min(ids[cluster_core]))
            centroid, covariance, _, _ = _cluster_geometry(
                cluster_core,
                population_id=population_id,
                positions=world_positions,
                parent_covariances=covariances,
                coefficients=optical_coefficients,
                covariance_floor_world=covariance_floor_world,
            )
            local_coefficients = optical_coefficients[cluster_core, coefficient_slice]
            mode_coefficients = np.zeros(8, dtype=np.float64)
            mode_coefficients[coefficient_slice] = np.sum(local_coefficients, axis=0, dtype=np.float64)
            optical_weight = float(np.sum(_population_weight(local_coefficients), dtype=np.float64))
            return (
                (1 << 62) | (population_id << 61) | anchor_native_id,
                anchor_native_id,
                population_id,
                0,
                centroid,
                covariance,
                mode_coefficients,
                int(cluster_core.size),
                optical_weight,
                split_score,
            )

        def rows_to_modes(
            rows: list[tuple[int, int, int, int, np.ndarray, np.ndarray, np.ndarray, int, float, float]],
        ) -> OpticalModes:
            return OpticalModes(
                mode_ids=np.asarray([row[0] for row in rows], dtype=np.uint64),
                brick_ids=np.asarray([row[1] for row in rows], dtype=np.uint64),
                population_ids=np.asarray([row[2] for row in rows], dtype=np.uint8),
                child_ids=np.asarray([row[3] for row in rows], dtype=np.uint8),
                positions=np.stack([row[4] for row in rows]).astype(np.float64, copy=False),
                covariances=np.stack([row[5] for row in rows]).astype(np.float64, copy=False),
                coefficients=np.stack([row[6] for row in rows]).astype(np.float64, copy=False),
                source_row_counts=np.asarray([row[7] for row in rows], dtype=np.uint32),
                optical_weights=np.asarray([row[8] for row in rows], dtype=np.float64),
                split_scores=np.asarray([row[9] for row in rows], dtype=np.float64),
            )

        def queue_priority(
            cluster_core: np.ndarray,
            cluster_context: np.ndarray,
        ) -> tuple[float, tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]] | None]:
            _, _, _, distortion = _cluster_geometry(
                cluster_core,
                population_id=population_id,
                positions=world_positions,
                parent_covariances=covariances,
                coefficients=optical_coefficients,
                covariance_floor_world=covariance_floor_world,
            )
            if split_priority_evaluator is not None:
                split = _split_adaptive_cluster(
                    cluster_core,
                    cluster_context,
                    population_id=population_id,
                    native_ids=ids,
                    positions=world_positions,
                    parent_covariances=covariances,
                    coefficients=optical_coefficients,
                    covariance_floor_world=covariance_floor_world,
                )
                if split is None:
                    return -math.inf, None
                parent_modes = rows_to_modes([cluster_output_row(cluster_core)])
                child_modes = rows_to_modes([cluster_output_row(child[0]) for child in split])
                score = float(split_priority_evaluator(parent_modes, child_modes))
                require(math.isfinite(score), "split priority evaluator returned a nonfinite score")
                return score, split
            if priority_weights is None:
                return distortion, None
            local_optical_weights = _population_weight(optical_coefficients[cluster_core, coefficient_slice])
            local_priority = float(
                np.sum(local_optical_weights * priority_weights[cluster_core], dtype=np.float64)
                / np.sum(local_optical_weights, dtype=np.float64)
            )
            normalized_priority = max(local_priority / priority_normalizer, np.finfo(np.float64).tiny)
            return distortion * normalized_priority, None

        clusters = list(components)
        heap: list[tuple[float, int]] = []
        evaluated_splits: dict[int, tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]] = {}
        for cluster_index, (cluster_core, _) in enumerate(clusters):
            if cluster_core.size >= 2:
                cluster_context = clusters[cluster_index][1]
                priority, evaluated_split = queue_priority(cluster_core, cluster_context)
                if evaluated_split is not None:
                    evaluated_splits[cluster_index] = evaluated_split
                heapq.heappush(heap, (-priority, cluster_index))
        active = np.ones(len(clusters), dtype=bool)
        active_count = len(clusters)
        while active_count < target_count:
            require(heap, f"population {population_id} exhausted splittable source clusters")
            _, cluster_index = heapq.heappop(heap)
            if not active[cluster_index]:
                continue
            cluster_core, cluster_context = clusters[cluster_index]
            split = evaluated_splits.pop(cluster_index, None)
            if split is None:
                split = _split_adaptive_cluster(
                    cluster_core,
                    cluster_context,
                    population_id=population_id,
                    native_ids=ids,
                    positions=world_positions,
                    parent_covariances=covariances,
                    coefficients=optical_coefficients,
                    covariance_floor_world=covariance_floor_world,
                )
            require(split is not None, f"population {population_id} could not realize matched local mode capacity")
            active[cluster_index] = False
            active_count -= 1
            for child in split:
                child_index = len(clusters)
                clusters.append(child)
                active = np.append(active, True)
                active_count += 1
                if child[0].size >= 2:
                    priority, evaluated_split = queue_priority(child[0], child[1])
                    if evaluated_split is not None:
                        evaluated_splits[child_index] = evaluated_split
                    heapq.heappush(heap, (-priority, child_index))
        if frontier_evaluator is not None:
            for cluster_index in np.flatnonzero(active):
                cluster_core, cluster_context = clusters[int(cluster_index)]
                split = _split_adaptive_cluster(
                    cluster_core,
                    cluster_context,
                    population_id=population_id,
                    native_ids=ids,
                    positions=world_positions,
                    parent_covariances=covariances,
                    coefficients=optical_coefficients,
                    covariance_floor_world=covariance_floor_world,
                )
                if split is None:
                    continue
                parent_modes = rows_to_modes([cluster_output_row(cluster_core)])
                child_modes = rows_to_modes([cluster_output_row(child[0]) for child in split])
                frontier_evaluator(parent_modes, child_modes)
        population_clusters = [clusters[index] for index in np.flatnonzero(active)]
        population_clusters.sort(key=lambda cluster: int(np.min(ids[cluster[0]])))
        output_rows.extend(cluster_output_row(cluster_core) for cluster_core, _ in population_clusters)
    require(output_rows, "no adaptive optical modes were produced")
    return OpticalModes(
        mode_ids=np.asarray([row[0] for row in output_rows], dtype=np.uint64),
        brick_ids=np.asarray([row[1] for row in output_rows], dtype=np.uint64),
        population_ids=np.asarray([row[2] for row in output_rows], dtype=np.uint8),
        child_ids=np.asarray([row[3] for row in output_rows], dtype=np.uint8),
        positions=np.stack([row[4] for row in output_rows]).astype(np.float64, copy=False),
        covariances=np.stack([row[5] for row in output_rows]).astype(np.float64, copy=False),
        coefficients=np.stack([row[6] for row in output_rows]).astype(np.float64, copy=False),
        source_row_counts=np.asarray([row[7] for row in output_rows], dtype=np.uint32),
        optical_weights=np.asarray([row[8] for row in output_rows], dtype=np.float64),
        split_scores=np.asarray([row[9] for row in output_rows], dtype=np.float64),
    )


def _component_soft_responsibilities(
    row_native_ids: np.ndarray,
    row_positions: np.ndarray,
    mode_anchor_ids: np.ndarray,
    mode_positions: np.ndarray,
    mode_covariances: np.ndarray,
    mode_weights: np.ndarray,
    *,
    grid: int,
    bucket_size_cells: int,
    soft_neighbors: int,
    soft_temperature: float,
    anchor_responsibility_floor: float,
) -> tuple[np.ndarray, np.ndarray]:
    require(row_native_ids.ndim == 1 and row_native_ids.size > 0, "soft-assignment rows must be nonempty")
    require(row_positions.shape == (row_native_ids.size, 3), "soft-assignment row positions are misaligned")
    require(mode_anchor_ids.ndim == 1 and mode_anchor_ids.size > 0, "soft-assignment modes must be nonempty")
    require(mode_positions.shape == (mode_anchor_ids.size, 3), "soft-assignment mode positions are misaligned")
    require(mode_covariances.shape == (mode_anchor_ids.size, 3, 3), "soft-assignment mode covariances are misaligned")
    require(mode_weights.shape == (mode_anchor_ids.size,), "soft-assignment mode weights are misaligned")
    require(isinstance(bucket_size_cells, int) and bucket_size_cells > 0, "soft-assignment bucket size is invalid")
    require(isinstance(soft_neighbors, int) and soft_neighbors > 0, "soft-assignment neighbor count is invalid")
    require(math.isfinite(soft_temperature) and soft_temperature > 0.0, "soft-assignment temperature is invalid")
    require(
        math.isfinite(anchor_responsibility_floor) and 0.0 < anchor_responsibility_floor < 1.0,
        "anchor responsibility floor is invalid",
    )
    require(np.all(mode_weights > 0.0), "soft-assignment mode weights must be positive")

    neighbor_count = min(soft_neighbors, mode_anchor_ids.size)
    bucket_count = int(math.ceil(grid / bucket_size_cells))

    def bucket_coordinates(native_values: np.ndarray) -> np.ndarray:
        native_values = native_values.astype(np.int64, copy=False)
        cells = np.column_stack((
            native_values % grid,
            (native_values // grid) % grid,
            native_values // (grid * grid),
        ))
        return np.clip(cells // bucket_size_cells, 0, bucket_count - 1)

    row_buckets = bucket_coordinates(row_native_ids)
    mode_buckets = bucket_coordinates(mode_anchor_ids)
    modes_by_bucket: dict[tuple[int, int, int], list[int]] = {}
    for local_mode_index, bucket in enumerate(mode_buckets):
        modes_by_bucket.setdefault(tuple(int(value) for value in bucket), []).append(local_mode_index)

    inverses = np.linalg.inv(mode_covariances)
    signs, log_determinants = np.linalg.slogdet(mode_covariances)
    require(np.all(signs > 0.0) and np.all(np.isfinite(log_determinants)), "soft-assignment covariance is not positive definite")
    normalized_priors = mode_weights / np.sum(mode_weights, dtype=np.float64)
    log_priors = np.log(normalized_priors)
    assignment_indices = np.empty((row_native_ids.size, neighbor_count), dtype=np.int64)
    responsibilities = np.zeros((row_native_ids.size, neighbor_count), dtype=np.float64)

    row_keys = row_buckets[:, 0] + row_buckets[:, 1] * bucket_count + row_buckets[:, 2] * bucket_count * bucket_count
    row_order = np.argsort(row_keys, kind="stable")
    ordered_keys = row_keys[row_order]
    boundaries = np.flatnonzero(np.r_[True, ordered_keys[1:] != ordered_keys[:-1], True])
    for boundary_index in range(boundaries.size - 1):
        rows = row_order[boundaries[boundary_index] : boundaries[boundary_index + 1]]
        bucket = row_buckets[rows[0]]
        candidate_set: set[int] = set()
        for radius in range(bucket_count):
            for dz in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    for dx in range(-radius, radius + 1):
                        if radius and max(abs(dx), abs(dy), abs(dz)) != radius:
                            continue
                        candidate_bucket = bucket + np.asarray((dx, dy, dz), dtype=np.int64)
                        if np.all((candidate_bucket >= 0) & (candidate_bucket < bucket_count)):
                            candidate_set.update(modes_by_bucket.get(tuple(int(value) for value in candidate_bucket), ()))
            if len(candidate_set) >= neighbor_count:
                break
        require(candidate_set, "soft assignment found no component-local candidate modes")
        candidate_indices = np.asarray(sorted(candidate_set), dtype=np.int64)
        offsets = row_positions[rows, None, :] - mode_positions[candidate_indices][None, :, :]
        mahalanobis = np.einsum(
            "rmi,mij,rmj->rm",
            offsets,
            inverses[candidate_indices],
            offsets,
            optimize=True,
        )
        logits = (
            log_priors[candidate_indices][None, :]
            - 0.5 * log_determinants[candidate_indices][None, :]
            - 0.5 * mahalanobis / (soft_temperature * soft_temperature)
        )
        selected_count = min(neighbor_count, candidate_indices.size)
        selected_local = np.argpartition(-logits, selected_count - 1, axis=1)[:, :selected_count]
        anchor_constraints: list[tuple[int, int]] = []
        bucket_row_native_ids = row_native_ids[rows]
        for local_mode_index, anchor_native_id in enumerate(mode_anchor_ids):
            anchor_rows = np.flatnonzero(bucket_row_native_ids == anchor_native_id)
            if anchor_rows.size == 0:
                continue
            require(anchor_rows.size == 1, "mode anchor maps to duplicate component rows")
            candidate_positions = np.flatnonzero(candidate_indices == local_mode_index)
            require(candidate_positions.size == 1, "mode anchor is absent from its local candidate set")
            anchor_row = int(anchor_rows[0])
            candidate_position = int(candidate_positions[0])
            selected_columns = np.flatnonzero(selected_local[anchor_row] == candidate_position)
            if selected_columns.size == 0:
                selected_local[anchor_row, -1] = candidate_position
                selected_column = selected_count - 1
            else:
                selected_column = int(selected_columns[0])
            anchor_constraints.append((anchor_row, selected_column))
        selected_logits = np.take_along_axis(logits, selected_local, axis=1)
        selected_indices = candidate_indices[selected_local]
        selected_logits -= np.max(selected_logits, axis=1, keepdims=True)
        selected_weights = np.exp(selected_logits)
        selected_weights /= np.sum(selected_weights, axis=1, keepdims=True)
        for anchor_row, selected_column in anchor_constraints:
            if selected_weights[anchor_row, selected_column] < anchor_responsibility_floor:
                selected_weights[anchor_row, selected_column] = anchor_responsibility_floor
                selected_weights[anchor_row] /= np.sum(selected_weights[anchor_row], dtype=np.float64)
        assignment_indices[rows, :selected_count] = selected_indices
        responsibilities[rows, :selected_count] = selected_weights
        if selected_count < neighbor_count:
            assignment_indices[rows, selected_count:] = selected_indices[:, -1:]

    require(np.allclose(np.sum(responsibilities, axis=1), 1.0), "soft responsibilities do not conserve row ownership")
    return assignment_indices, responsibilities


def refine_adaptive_cohort_modes_soft_assignment(
    seed_modes: OpticalModes,
    native_ids: np.ndarray,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    *,
    core_row_indices: np.ndarray,
    halo_row_indices: np.ndarray,
    grid: int = 96,
    bucket_size_cells: int = 4,
    soft_neighbors: int = 2,
    soft_temperature: float = 1.0,
    relaxation_iterations: int = 2,
    covariance_floor_world: float = 1e-8,
    anchor_responsibility_floor: float = 1e-6,
) -> tuple[OpticalModes, dict[str, object]]:
    ids = np.asarray(native_ids)
    world_positions = np.asarray(positions, dtype=np.float64)
    parent = np.asarray(parent_covariances, dtype=np.float64)
    optical_coefficients = np.asarray(coefficients, dtype=np.float64)
    require(ids.ndim == 1 and ids.size > 0 and np.issubdtype(ids.dtype, np.integer), "native ids must be a nonempty integer vector")
    require(np.unique(ids).size == ids.size, "native ids contain duplicate rows")
    require(np.all((ids >= 0) & (ids < grid**3)), "native id is out of range for grid")
    require(world_positions.shape == (ids.size, 3), "positions must align as rows by xyz")
    require(parent.shape == (ids.size, 3, 3), "parent covariances must align as 3x3 rows")
    require(optical_coefficients.shape == (ids.size, 8), "coefficients must align as eight-channel rows")
    require(np.all(np.isfinite(world_positions)), "positions contain nonfinite values")
    require(np.all(np.isfinite(parent)), "parent covariances contain nonfinite values")
    require(np.all(np.isfinite(optical_coefficients)) and np.all(optical_coefficients >= 0.0), "coefficients are invalid")
    require(isinstance(relaxation_iterations, int) and relaxation_iterations > 0, "relaxation iteration count is invalid")
    require(math.isfinite(covariance_floor_world) and covariance_floor_world > 0.0, "covariance floor is invalid")
    core_rows_original = _ordered_unique_indices(core_row_indices, ids.size, "core")
    halo_rows_original = _ordered_unique_indices(halo_row_indices, ids.size, "halo")
    require(np.all(np.isin(core_rows_original, halo_rows_original)), "halo must include every core row")

    mode_ids = np.asarray(seed_modes.mode_ids, dtype=np.uint64)
    mode_anchors = np.asarray(seed_modes.brick_ids, dtype=np.int64)
    populations = np.asarray(seed_modes.population_ids, dtype=np.int64)
    centers = np.asarray(seed_modes.positions, dtype=np.float64).copy()
    mode_covariances = np.asarray(seed_modes.covariances, dtype=np.float64).copy()
    mode_weights = np.asarray(seed_modes.optical_weights, dtype=np.float64).copy()
    require(mode_ids.ndim == 1 and mode_ids.size > 0 and np.unique(mode_ids).size == mode_ids.size, "seed modes are invalid")
    require(mode_anchors.shape == mode_ids.shape and populations.shape == mode_ids.shape, "seed mode identities are misaligned")
    require(centers.shape == (mode_ids.size, 3), "seed mode positions are misaligned")
    require(mode_covariances.shape == (mode_ids.size, 3, 3), "seed mode covariances are misaligned")
    require(mode_weights.shape == mode_ids.shape and np.all(mode_weights > 0.0), "seed mode weights are invalid")

    order = np.argsort(ids, kind="stable")
    inverse_order = np.empty(ids.size, dtype=np.int64)
    inverse_order[order] = np.arange(ids.size, dtype=np.int64)
    ids = ids[order].astype(np.int64, copy=False)
    world_positions = world_positions[order]
    parent = parent[order]
    optical_coefficients = optical_coefficients[order]
    core_rows = inverse_order[core_rows_original]
    halo_rows = inverse_order[halo_rows_original]
    core_mask = np.zeros(ids.size, dtype=bool)
    context_mask = np.zeros(ids.size, dtype=bool)
    core_mask[core_rows] = True
    context_mask[halo_rows] = True

    component_records: list[tuple[int, np.ndarray, np.ndarray]] = []
    component_count_by_population = {"ridge": 0, "nonridge": 0}
    for population_id, population_name in enumerate(POPULATION_NAMES):
        coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
        positive_mask = np.any(optical_coefficients[:, coefficient_slice] > 0.0, axis=1)
        components = _connected_context_components(ids, core_mask, context_mask, positive_mask, grid)
        component_count_by_population[population_name] = len(components)
        population_mode_indices = np.flatnonzero(populations == population_id)
        if not components:
            require(population_mode_indices.size == 0, f"population {population_id} has seed modes but no source components")
            continue
        assigned_population_modes: list[int] = []
        for component_core, component_context in components:
            component_native_ids = ids[component_core]
            local_mode_indices = population_mode_indices[np.isin(mode_anchors[population_mode_indices], component_native_ids)]
            require(local_mode_indices.size > 0, f"population {population_id} source component has no seed modes")
            assigned_population_modes.extend(local_mode_indices.tolist())
            component_records.append((population_id, component_core, local_mode_indices))
        require(
            np.array_equal(np.sort(np.asarray(assigned_population_modes, dtype=np.int64)), population_mode_indices),
            f"population {population_id} seed modes are not uniquely owned by source components",
        )

    maximum_responsibility_error = 0.0
    final_assignments: list[tuple[int, np.ndarray, np.ndarray, np.ndarray]] = []
    for _ in range(relaxation_iterations):
        coefficient_accumulator = np.zeros((mode_ids.size, 8), dtype=np.float64)
        covariance_accumulator = np.zeros((mode_ids.size, 3, 3), dtype=np.float64)
        geometry_weight_accumulator = np.zeros(mode_ids.size, dtype=np.float64)
        position_accumulator = np.zeros((mode_ids.size, 3), dtype=np.float64)
        source_counts = np.zeros(mode_ids.size, dtype=np.uint32)
        soft_support_assignment_count = 0
        current_assignments: list[tuple[int, np.ndarray, np.ndarray, np.ndarray]] = []
        for population_id, component_rows, local_mode_indices in component_records:
            coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
            local_assignments, local_responsibilities = _component_soft_responsibilities(
                ids[component_rows],
                world_positions[component_rows],
                mode_anchors[local_mode_indices],
                centers[local_mode_indices],
                mode_covariances[local_mode_indices],
                mode_weights[local_mode_indices],
                grid=grid,
                bucket_size_cells=bucket_size_cells,
                soft_neighbors=soft_neighbors,
                soft_temperature=soft_temperature,
                anchor_responsibility_floor=anchor_responsibility_floor,
            )
            assigned_modes = local_mode_indices[local_assignments]
            responsibility_error = float(np.max(np.abs(np.sum(local_responsibilities, axis=1) - 1.0)))
            maximum_responsibility_error = max(maximum_responsibility_error, responsibility_error)
            row_geometry_weights = _population_weight(optical_coefficients[component_rows, coefficient_slice])
            local_coefficients = optical_coefficients[component_rows, coefficient_slice]
            hard_owner_columns = np.argmax(local_responsibilities, axis=1)
            hard_owner_modes = assigned_modes[np.arange(component_rows.size), hard_owner_columns]
            np.add.at(source_counts, hard_owner_modes, np.ones(component_rows.size, dtype=np.uint32))
            soft_support_assignment_count += int(np.count_nonzero(local_responsibilities > 1e-10))
            for neighbor_index in range(local_responsibilities.shape[1]):
                target_modes = assigned_modes[:, neighbor_index]
                ownership = local_responsibilities[:, neighbor_index]
                geometry_weights = row_geometry_weights * ownership
                np.add.at(geometry_weight_accumulator, target_modes, geometry_weights)
                for axis in range(3):
                    np.add.at(position_accumulator[:, axis], target_modes, geometry_weights * world_positions[component_rows, axis])
                for channel in range(4):
                    np.add.at(
                        coefficient_accumulator[:, coefficient_slice.start + channel],
                        target_modes,
                        local_coefficients[:, channel] * ownership,
                    )
            current_assignments.append((population_id, component_rows, assigned_modes, local_responsibilities))

        require(np.all(geometry_weight_accumulator > 0.0), "soft assignment retired a seed mode")
        centers = position_accumulator / geometry_weight_accumulator[:, None]
        for population_id, component_rows, assigned_modes, local_responsibilities in current_assignments:
            coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
            row_geometry_weights = _population_weight(optical_coefficients[component_rows, coefficient_slice])
            for neighbor_index in range(local_responsibilities.shape[1]):
                target_modes = assigned_modes[:, neighbor_index]
                geometry_weights = row_geometry_weights * local_responsibilities[:, neighbor_index]
                offsets = world_positions[component_rows] - centers[target_modes]
                for axis in range(3):
                    for cross_axis in range(3):
                        values = geometry_weights * (
                            offsets[:, axis] * offsets[:, cross_axis]
                            + parent[component_rows, axis, cross_axis]
                        )
                        np.add.at(covariance_accumulator[:, axis, cross_axis], target_modes, values)
        mode_covariances = covariance_accumulator / geometry_weight_accumulator[:, None, None]
        for mode_index in range(mode_ids.size):
            mode_covariances[mode_index] = _positive_semidefinite(mode_covariances[mode_index], covariance_floor_world)
        mode_weights = geometry_weight_accumulator
        final_assignments = current_assignments

    source_mass = np.sum(optical_coefficients[core_rows], axis=0, dtype=np.float64)
    mode_mass = np.sum(coefficient_accumulator, axis=0, dtype=np.float64)
    mass_delta = np.abs(mode_mass - source_mass)
    require(np.all(mass_delta <= 1e-8 + np.abs(source_mass) * 1e-10), "soft assignment does not conserve optical mass")
    maximum_assigned_modes = max(assignment[3].shape[1] for assignment in final_assignments)
    return OpticalModes(
        mode_ids=mode_ids.copy(),
        brick_ids=np.asarray(seed_modes.brick_ids).copy(),
        population_ids=np.asarray(seed_modes.population_ids).copy(),
        child_ids=np.asarray(seed_modes.child_ids).copy(),
        positions=centers,
        covariances=mode_covariances,
        coefficients=coefficient_accumulator,
        source_row_counts=source_counts,
        optical_weights=mode_weights,
        split_scores=np.zeros(mode_ids.size, dtype=np.float64),
    ), {
        "identity": "component-bounded-source-local-soft-optical-assignment-v0",
        "inputModeCount": int(mode_ids.size),
        "outputModeCount": int(mode_ids.size),
        "componentCountByPopulation": component_count_by_population,
        "crossComponentAssignmentCount": 0,
        "bucketSizeCells": bucket_size_cells,
        "softNeighbors": soft_neighbors,
        "softTemperature": soft_temperature,
        "anchorResponsibilityFloor": anchor_responsibility_floor,
        "relaxationIterations": relaxation_iterations,
        "maximumAssignedModesPerRow": maximum_assigned_modes,
        "uniqueCoreRowCount": int(core_rows.size),
        "hardOwnedPopulationRowCount": int(np.sum(source_counts, dtype=np.uint64)),
        "softSupportAssignmentCount": soft_support_assignment_count,
        "maximumResponsibilitySumError": maximum_responsibility_error,
        "coefficientMassAbsoluteDelta": mass_delta.tolist(),
        "coefficientMassConserved": True,
    }


def _aggregate_mode(
    row_indices: np.ndarray,
    *,
    population_id: int,
    brick_id: int,
    child_id: int,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    covariance_floor_world: float,
    split_score: float,
) -> tuple[int, int, int, int, np.ndarray, np.ndarray, np.ndarray, int, float, float]:
    coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
    local_coefficients = coefficients[row_indices, coefficient_slice]
    weights = _population_weight(local_coefficients)
    total_weight = float(np.sum(weights, dtype=np.float64))
    require(total_weight > 0.0, "optical mode weight must be positive")
    centroid = np.sum(positions[row_indices] * weights[:, None], axis=0, dtype=np.float64) / total_weight
    offsets = positions[row_indices] - centroid
    spatial_covariance = np.einsum("n,ni,nj->ij", weights, offsets, offsets, optimize=True) / total_weight
    parent_covariance = np.einsum(
        "n,nij->ij",
        weights,
        parent_covariances[row_indices],
        optimize=True,
    ) / total_weight
    covariance = _positive_semidefinite(spatial_covariance + parent_covariance, covariance_floor_world)
    mode_coefficients = np.zeros(8, dtype=np.float64)
    mode_coefficients[coefficient_slice] = np.sum(local_coefficients, axis=0, dtype=np.float64)
    mode_id = (((brick_id * 2) + population_id) * 2) + child_id
    return (
        mode_id,
        brick_id,
        population_id,
        child_id,
        centroid,
        covariance,
        mode_coefficients,
        int(row_indices.size),
        total_weight,
        split_score,
    )


def _split_rows(
    row_indices: np.ndarray,
    *,
    population_id: int,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    covariance_floor_world: float,
    minimum_child_rows: int,
    minimum_child_fraction: float,
) -> tuple[np.ndarray, np.ndarray, float] | None:
    coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
    weights = _population_weight(coefficients[row_indices, coefficient_slice])
    total_weight = float(np.sum(weights, dtype=np.float64))
    centroid = np.sum(positions[row_indices] * weights[:, None], axis=0, dtype=np.float64) / total_weight
    offsets = positions[row_indices] - centroid
    spatial_covariance = np.einsum("n,ni,nj->ij", weights, offsets, offsets, optimize=True) / total_weight
    parent_covariance = np.einsum(
        "n,nij->ij",
        weights,
        parent_covariances[row_indices],
        optimize=True,
    ) / total_weight
    covariance = _positive_semidefinite(spatial_covariance + parent_covariance, covariance_floor_world)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    principal = eigenvectors[:, int(np.argmax(eigenvalues))]
    dominant_axis = int(np.argmax(np.abs(principal)))
    if principal[dominant_axis] < 0.0:
        principal = -principal
    projections = offsets @ principal
    negative = row_indices[projections < 0.0]
    positive = row_indices[projections >= 0.0]
    if negative.size < minimum_child_rows or positive.size < minimum_child_rows:
        return None
    negative_weight = float(np.sum(_population_weight(coefficients[negative, coefficient_slice]), dtype=np.float64))
    positive_weight = float(np.sum(_population_weight(coefficients[positive, coefficient_slice]), dtype=np.float64))
    if min(negative_weight, positive_weight) / total_weight < minimum_child_fraction:
        return None

    within_trace = 0.0
    for child_rows, child_weight in ((negative, negative_weight), (positive, positive_weight)):
        child_weights = _population_weight(coefficients[child_rows, coefficient_slice])
        child_centroid = np.sum(positions[child_rows] * child_weights[:, None], axis=0, dtype=np.float64) / child_weight
        child_offsets = positions[child_rows] - child_centroid
        child_spatial = np.einsum("n,ni,nj->ij", child_weights, child_offsets, child_offsets, optimize=True) / child_weight
        child_parent = np.einsum(
            "n,nij->ij",
            child_weights,
            parent_covariances[child_rows],
            optimize=True,
        ) / child_weight
        within_trace += child_weight * float(np.trace(child_spatial + child_parent))
    total_trace = total_weight * float(np.trace(covariance))
    split_score = max(0.0, min(1.0, 1.0 - within_trace / max(total_trace, 1e-300)))
    return negative, positive, split_score


def build_optical_modes(
    native_ids: np.ndarray,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    *,
    grid: int = 96,
    brick_size: int = 2,
    arm: str = "one-mode",
    split_threshold: float = 0.85,
    minimum_child_rows: int = 2,
    minimum_child_fraction: float = 0.1,
    covariance_floor_world: float = 1e-8,
    preserve_ridge_parents: bool = False,
) -> OpticalModes:
    ids = np.asarray(native_ids)
    world_positions = np.asarray(positions, dtype=np.float64)
    covariances = np.asarray(parent_covariances, dtype=np.float64)
    optical_coefficients = np.asarray(coefficients, dtype=np.float64)

    require(ids.ndim == 1 and ids.size > 0, "native ids must be a nonempty vector")
    require(np.issubdtype(ids.dtype, np.integer), "native ids must be integers")
    require(np.unique(ids).size == ids.size, "native ids contain duplicate rows")
    require(isinstance(grid, int) and grid > 0, "grid must be a positive integer")
    require(np.all((ids >= 0) & (ids < grid**3)), "native id is out of range for grid")
    require(world_positions.shape == (ids.size, 3), "positions must align as rows by xyz")
    require(np.all(np.isfinite(world_positions)), "positions contain nonfinite values")
    require(covariances.shape == (ids.size, 3, 3), "parent covariances must align as 3x3 rows")
    require(np.all(np.isfinite(covariances)), "parent covariances contain nonfinite values")
    require(np.allclose(covariances, np.swapaxes(covariances, 1, 2), rtol=0.0, atol=1e-10), "parent covariances are not symmetric")
    require(float(np.min(np.linalg.eigvalsh(covariances))) >= -1e-10, "parent covariances are not positive semidefinite")
    require(optical_coefficients.shape == (ids.size, 8), "coefficients must align as eight-channel rows")
    require(np.all(np.isfinite(optical_coefficients)), "coefficients contain nonfinite values")
    require(np.all(optical_coefficients >= 0.0), "coefficients contain negative values")
    require(isinstance(brick_size, int) and brick_size > 0, "brick size must be a positive integer")
    require(arm in ("one-mode", "earned-two-mode"), "arm must be one-mode or earned-two-mode")
    require(math.isfinite(split_threshold) and 0.0 <= split_threshold <= 1.0, "split threshold is invalid")
    require(isinstance(minimum_child_rows, int) and minimum_child_rows > 0, "minimum child rows is invalid")
    require(
        math.isfinite(minimum_child_fraction) and 0.0 < minimum_child_fraction <= 0.5,
        "minimum child fraction is invalid",
    )
    require(math.isfinite(covariance_floor_world) and covariance_floor_world > 0.0, "covariance floor is invalid")
    require(type(preserve_ridge_parents) is bool, "preserve ridge parents must be boolean")

    order = np.argsort(ids, kind="stable")
    ids = ids[order].astype(np.int64, copy=False)
    world_positions = world_positions[order]
    covariances = covariances[order]
    optical_coefficients = optical_coefficients[order]
    cells_x = ids % grid
    cells_y = (ids // grid) % grid
    cells_z = ids // (grid * grid)
    bricks_per_axis = (grid + brick_size - 1) // brick_size
    brick_ids = (
        cells_x // brick_size
        + (cells_y // brick_size) * bricks_per_axis
        + (cells_z // brick_size) * bricks_per_axis * bricks_per_axis
    )

    rows: list[tuple[int, int, int, int, np.ndarray, np.ndarray, np.ndarray, int, float, float]] = []
    if preserve_ridge_parents:
        ridge_rows = np.flatnonzero(np.any(optical_coefficients[:, :4] > 0.0, axis=1))
        for row_index in ridge_rows:
            ridge_coefficients = np.zeros(8, dtype=np.float64)
            ridge_coefficients[:4] = optical_coefficients[row_index, :4]
            ridge_weight = float(_population_weight(optical_coefficients[row_index : row_index + 1, :4])[0])
            rows.append(
                (
                    (1 << 63) | int(ids[row_index]),
                    int(brick_ids[row_index]),
                    0,
                    0,
                    world_positions[row_index],
                    _positive_semidefinite(covariances[row_index], covariance_floor_world),
                    ridge_coefficients,
                    1,
                    ridge_weight,
                    0.0,
                )
            )
    brick_order = np.argsort(brick_ids, kind="stable")
    ordered_bricks = brick_ids[brick_order]
    brick_boundaries = np.flatnonzero(np.r_[True, ordered_bricks[1:] != ordered_bricks[:-1], True])
    for boundary_index in range(brick_boundaries.size - 1):
        start = int(brick_boundaries[boundary_index])
        stop = int(brick_boundaries[boundary_index + 1])
        brick_rows = brick_order[start:stop]
        brick_id = int(ordered_bricks[start])
        for population_id in range(2):
            if preserve_ridge_parents and population_id == 0:
                continue
            coefficient_slice = slice(population_id * 4, population_id * 4 + 4)
            population_rows = brick_rows[np.any(optical_coefficients[brick_rows, coefficient_slice] > 0.0, axis=1)]
            if population_rows.size == 0:
                continue
            split = _split_rows(
                population_rows,
                population_id=population_id,
                positions=world_positions,
                parent_covariances=covariances,
                coefficients=optical_coefficients,
                covariance_floor_world=covariance_floor_world,
                minimum_child_rows=minimum_child_rows,
                minimum_child_fraction=minimum_child_fraction,
            )
            split_score = 0.0 if split is None else split[2]
            if arm == "earned-two-mode" and split is not None and split_score >= split_threshold:
                for child_id, child_rows in enumerate(split[:2]):
                    rows.append(
                        _aggregate_mode(
                            child_rows,
                            population_id=population_id,
                            brick_id=brick_id,
                            child_id=child_id,
                            positions=world_positions,
                            parent_covariances=covariances,
                            coefficients=optical_coefficients,
                            covariance_floor_world=covariance_floor_world,
                            split_score=split_score,
                        )
                    )
            else:
                rows.append(
                    _aggregate_mode(
                        population_rows,
                        population_id=population_id,
                        brick_id=brick_id,
                        child_id=0,
                        positions=world_positions,
                        parent_covariances=covariances,
                        coefficients=optical_coefficients,
                        covariance_floor_world=covariance_floor_world,
                        split_score=split_score,
                    )
                )

    require(bool(rows), "no positive optical modes were produced")
    return OpticalModes(
        mode_ids=np.asarray([row[0] for row in rows], dtype=np.uint64),
        brick_ids=np.asarray([row[1] for row in rows], dtype=np.uint64),
        population_ids=np.asarray([row[2] for row in rows], dtype=np.uint8),
        child_ids=np.asarray([row[3] for row in rows], dtype=np.uint8),
        positions=np.stack([row[4] for row in rows]).astype(np.float64, copy=False),
        covariances=np.stack([row[5] for row in rows]).astype(np.float64, copy=False),
        coefficients=np.stack([row[6] for row in rows]).astype(np.float64, copy=False),
        source_row_counts=np.asarray([row[7] for row in rows], dtype=np.uint32),
        optical_weights=np.asarray([row[8] for row in rows], dtype=np.float64),
        split_scores=np.asarray([row[9] for row in rows], dtype=np.float64),
    )


def build_split_field_optical_modes(
    native_ids: np.ndarray,
    positions: np.ndarray,
    parent_covariances: np.ndarray,
    coefficients: np.ndarray,
    *,
    grid: int = 96,
    brick_size: int = 2,
    emission_brick_size: int | None = None,
    extinction_brick_size: int | None = None,
    emission_split_threshold: float | None = None,
    covariance_floor_world: float = 1e-8,
) -> OpticalModes:
    ids = np.asarray(native_ids)
    world_positions = np.asarray(positions, dtype=np.float64)
    covariances = np.asarray(parent_covariances, dtype=np.float64)
    optical_coefficients = np.asarray(coefficients, dtype=np.float64)

    require(ids.ndim == 1 and ids.size > 0, "native ids must be a nonempty vector")
    require(np.issubdtype(ids.dtype, np.integer), "native ids must be integers")
    require(np.unique(ids).size == ids.size, "native ids contain duplicate rows")
    require(isinstance(grid, int) and grid > 0, "grid must be a positive integer")
    require(np.all((ids >= 0) & (ids < grid**3)), "native id is out of range for grid")
    require(world_positions.shape == (ids.size, 3), "positions must align as rows by xyz")
    require(np.all(np.isfinite(world_positions)), "positions contain nonfinite values")
    require(covariances.shape == (ids.size, 3, 3), "parent covariances must align as 3x3 rows")
    require(np.all(np.isfinite(covariances)), "parent covariances contain nonfinite values")
    require(np.allclose(covariances, np.swapaxes(covariances, 1, 2), rtol=0.0, atol=1e-10), "parent covariances are not symmetric")
    require(float(np.min(np.linalg.eigvalsh(covariances))) >= -1e-10, "parent covariances are not positive semidefinite")
    require(optical_coefficients.shape == (ids.size, 8), "coefficients must align as eight-channel rows")
    require(np.all(np.isfinite(optical_coefficients)), "coefficients contain nonfinite values")
    require(np.all(optical_coefficients >= 0.0), "coefficients contain negative values")
    require(isinstance(brick_size, int) and brick_size > 0, "brick size must be a positive integer")
    emission_brick_size = brick_size if emission_brick_size is None else emission_brick_size
    extinction_brick_size = brick_size if extinction_brick_size is None else extinction_brick_size
    require(
        isinstance(emission_brick_size, int) and emission_brick_size > 0,
        "emission brick size must be a positive integer",
    )
    require(
        isinstance(extinction_brick_size, int) and extinction_brick_size > 0,
        "extinction brick size must be a positive integer",
    )
    require(
        emission_split_threshold is None
        or (math.isfinite(emission_split_threshold) and 0.0 <= emission_split_threshold <= 1.0),
        "emission split threshold is invalid",
    )
    require(math.isfinite(covariance_floor_world) and covariance_floor_world > 0.0, "covariance floor is invalid")

    order = np.argsort(ids, kind="stable")
    ids = ids[order].astype(np.int64, copy=False)
    world_positions = world_positions[order]
    covariances = covariances[order]
    optical_coefficients = optical_coefficients[order]
    cells_x = ids % grid
    cells_y = (ids // grid) % grid
    cells_z = ids // (grid * grid)
    emission_only_coefficients = optical_coefficients.copy()
    emission_only_coefficients[:, 3] = 0.0
    emission_only_coefficients[:, 7] = 0.0
    rows: list[tuple[int, int, int, int, np.ndarray, np.ndarray, np.ndarray, int, float, float]] = []
    for field_id in range(len(FIELD_NAMES)):
        channels = _field_channels(field_id)
        field_rows = np.flatnonzero(np.any(optical_coefficients[:, channels] > 0.0, axis=1))
        if field_rows.size == 0:
            continue
        field_brick_size = emission_brick_size if len(channels) == 3 else extinction_brick_size
        bricks_per_axis = (grid + field_brick_size - 1) // field_brick_size
        field_brick_ids = (
            cells_x[field_rows] // field_brick_size
            + (cells_y[field_rows] // field_brick_size) * bricks_per_axis
            + (cells_z[field_rows] // field_brick_size) * bricks_per_axis * bricks_per_axis
        )
        brick_order = np.argsort(field_brick_ids, kind="stable")
        ordered_bricks = field_brick_ids[brick_order]
        brick_boundaries = np.flatnonzero(np.r_[True, ordered_bricks[1:] != ordered_bricks[:-1], True])
        for boundary_index in range(brick_boundaries.size - 1):
            start = int(brick_boundaries[boundary_index])
            stop = int(brick_boundaries[boundary_index + 1])
            local_rows = field_rows[brick_order[start:stop]]
            brick_id = int(ordered_bricks[start])
            split = None
            if len(channels) == 3 and emission_split_threshold is not None:
                split = _split_rows(
                    local_rows,
                    population_id=0 if field_id == 0 else 1,
                    positions=world_positions,
                    parent_covariances=covariances,
                    coefficients=emission_only_coefficients,
                    covariance_floor_world=covariance_floor_world,
                    minimum_child_rows=2,
                    minimum_child_fraction=0.1,
                )
            split_score = 0.0 if split is None else split[2]
            child_groups = split[:2] if split is not None and split_score >= emission_split_threshold else (local_rows,)
            for child_id, child_rows in enumerate(child_groups):
                weights = _field_weight(optical_coefficients[child_rows], field_id)
                total_weight = float(np.sum(weights, dtype=np.float64))
                require(total_weight > 0.0, "split optical field weight must be positive")
                centroid = np.sum(world_positions[child_rows] * weights[:, None], axis=0, dtype=np.float64) / total_weight
                offsets = world_positions[child_rows] - centroid
                spatial_covariance = np.einsum("n,ni,nj->ij", weights, offsets, offsets, optimize=True) / total_weight
                parent_covariance = np.einsum(
                    "n,nij->ij",
                    weights,
                    covariances[child_rows],
                    optimize=True,
                ) / total_weight
                mode_coefficients = np.zeros(8, dtype=np.float64)
                mode_coefficients[list(channels)] = np.sum(
                    optical_coefficients[child_rows][:, channels],
                    axis=0,
                    dtype=np.float64,
                )
                rows.append(
                    (
                        (((brick_id * len(FIELD_NAMES)) + field_id) * 2) + child_id,
                        brick_id,
                        field_id,
                        child_id,
                        centroid,
                        _positive_semidefinite(spatial_covariance + parent_covariance, covariance_floor_world),
                        mode_coefficients,
                        int(child_rows.size),
                        total_weight,
                        split_score,
                    )
                )

    require(bool(rows), "no positive split-field optical modes were produced")
    rows.sort(key=lambda row: row[0])
    return OpticalModes(
        mode_ids=np.asarray([row[0] for row in rows], dtype=np.uint64),
        brick_ids=np.asarray([row[1] for row in rows], dtype=np.uint64),
        population_ids=np.asarray([row[2] for row in rows], dtype=np.uint8),
        child_ids=np.asarray([row[3] for row in rows], dtype=np.uint8),
        positions=np.stack([row[4] for row in rows]).astype(np.float64, copy=False),
        covariances=np.stack([row[5] for row in rows]).astype(np.float64, copy=False),
        coefficients=np.stack([row[6] for row in rows]).astype(np.float64, copy=False),
        source_row_counts=np.asarray([row[7] for row in rows], dtype=np.uint32),
        optical_weights=np.asarray([row[8] for row in rows], dtype=np.float64),
        split_scores=np.asarray([row[9] for row in rows], dtype=np.float64),
    )


def rasterize_optical_modes(
    modes: OpticalModes,
    camera: dict[str, object],
    *,
    depth_bins: int,
    near_depth: float,
    far_depth: float,
    cubature_order: int = 3,
) -> RasterReceipt:
    require(isinstance(modes, OpticalModes), "raster input must be OpticalModes")
    mode_count = int(modes.mode_ids.size)
    require(mode_count > 0, "raster input has no optical modes")
    require(modes.positions.shape == (mode_count, 3), "raster positions shape drifted")
    require(modes.covariances.shape == (mode_count, 3, 3), "raster covariance shape drifted")
    require(modes.coefficients.shape == (mode_count, 8), "raster coefficient shape drifted")
    require(np.all(np.isfinite(modes.positions)), "raster positions contain nonfinite values")
    require(np.all(np.isfinite(modes.covariances)), "raster covariances contain nonfinite values")
    require(np.all(np.isfinite(modes.coefficients)) and np.all(modes.coefficients >= 0.0), "raster coefficients are invalid")
    require(isinstance(depth_bins, int) and depth_bins > 1, "depth bins must exceed one")
    require(math.isfinite(near_depth) and math.isfinite(far_depth) and far_depth > near_depth, "depth range is invalid")
    require(isinstance(cubature_order, int) and cubature_order >= 1 and cubature_order % 2 == 1, "cubature order must be positive and odd")

    width = camera.get("width")
    height = camera.get("height")
    pose = camera.get("cameraPose")
    require(isinstance(width, int) and width > 0, "camera width is invalid")
    require(isinstance(height, int) and height > 0, "camera height is invalid")
    require(isinstance(pose, dict), "camera pose is missing")
    matrix_world_inverse = pose.get("matrixWorldInverse")
    projection_matrix = pose.get("projectionMatrix")
    require(isinstance(matrix_world_inverse, list) and len(matrix_world_inverse) == 16, "camera view matrix is invalid")
    require(isinstance(projection_matrix, list) and len(projection_matrix) == 16, "camera projection matrix is invalid")

    view = np.asarray(matrix_world_inverse, dtype=np.float64).reshape(4, 4, order="F")
    projection = np.asarray(projection_matrix, dtype=np.float64).reshape(4, 4, order="F")

    def project(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        homogeneous = np.concatenate((points, np.ones((points.shape[0], 1), dtype=np.float64)), axis=1)
        view_points = homogeneous @ view.T
        clip = view_points @ projection.T
        clip_w = clip[:, 3]
        valid_projection = clip_w > 1e-5
        ndc = np.zeros((points.shape[0], 2), dtype=np.float64)
        ndc[valid_projection] = clip[valid_projection, :2] / clip_w[valid_projection, None]
        depth = -view_points[:, 2]
        return ndc, depth, valid_projection

    eigenvalues, eigenvectors = np.linalg.eigh(0.5 * (modes.covariances + np.swapaxes(modes.covariances, 1, 2)))
    require(float(np.min(eigenvalues)) >= -1e-10, "raster covariance is not positive semidefinite")
    square_roots = eigenvectors * np.sqrt(np.maximum(eigenvalues, 0.0))[:, None, :]
    raw_nodes, raw_weights = np.polynomial.hermite.hermgauss(cubature_order)
    nodes = np.sqrt(2.0) * raw_nodes
    weights = raw_weights / math.sqrt(math.pi)
    planes = np.zeros((depth_bins, height, width, 8), dtype=np.float32)
    flat_planes = planes.reshape((-1, 8))
    center_ndc, center_depth, center_valid = project(modes.positions)
    center_x = (center_ndc[:, 0] * 0.5 + 0.5) * width
    center_y = (1.0 - (center_ndc[:, 1] * 0.5 + 0.5)) * height
    center_valid &= (
        (center_x >= 0.0)
        & (center_x < width)
        & (center_y >= 0.0)
        & (center_y < height)
        & np.isfinite(center_depth)
    )
    projected_sample_count = 0
    projected_fragment_count = 0

    for first_index, first_weight in enumerate(weights):
        for second_index, second_weight in enumerate(weights):
            for third_index, third_weight in enumerate(weights):
                standard_offset = np.asarray(
                    (nodes[first_index], nodes[second_index], nodes[third_index]),
                    dtype=np.float64,
                )
                world_offset = np.einsum("nij,j->ni", square_roots, standard_offset, optimize=True)
                sample_positions = modes.positions + world_offset
                ndc, depth, valid = project(sample_positions)
                pixel_x = (ndc[:, 0] * 0.5 + 0.5) * width
                pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height
                valid &= np.isfinite(depth)
                depth_index = np.clip(
                    ((depth - near_depth) / (far_depth - near_depth) * (depth_bins - 1)).astype(np.int32),
                    0,
                    depth_bins - 1,
                )
                pixel_x_floor = np.floor(pixel_x).astype(np.int32)
                pixel_y_floor = np.floor(pixel_y).astype(np.int32)
                fraction_x = pixel_x - pixel_x_floor
                fraction_y = pixel_y - pixel_y_floor
                quadrature_weight = float(first_weight * second_weight * third_weight)
                projected_sample_count += int(
                    np.count_nonzero(valid & (pixel_x >= 0.0) & (pixel_x < width) & (pixel_y >= 0.0) & (pixel_y < height))
                )
                for offset_x, offset_y, pixel_weight in (
                    (0, 0, (1.0 - fraction_x) * (1.0 - fraction_y)),
                    (1, 0, fraction_x * (1.0 - fraction_y)),
                    (0, 1, (1.0 - fraction_x) * fraction_y),
                    (1, 1, fraction_x * fraction_y),
                ):
                    sample_x = pixel_x_floor + offset_x
                    sample_y = pixel_y_floor + offset_y
                    selected = (
                        valid
                        & (pixel_weight > 0.0)
                        & (sample_x >= 0)
                        & (sample_x < width)
                        & (sample_y >= 0)
                        & (sample_y < height)
                    )
                    row_indices = np.flatnonzero(selected)
                    if row_indices.size == 0:
                        continue
                    projected_fragment_count += int(row_indices.size)
                    flat_indices = (
                        (depth_index[row_indices] * height + sample_y[row_indices]) * width
                        + sample_x[row_indices]
                    ).astype(np.int64)
                    weighted_coefficients = (
                        modes.coefficients[row_indices]
                        * (quadrature_weight * pixel_weight[row_indices])[:, None]
                    )
                    np.add.at(flat_planes, flat_indices, weighted_coefficients.astype(np.float32, copy=False))

    nominal_mass = np.sum(modes.coefficients, axis=0, dtype=np.float64)
    viewport_mass = np.sum(planes, axis=(0, 1, 2), dtype=np.float64)
    return RasterReceipt(
        planes=planes,
        projected_mode_count=int(np.count_nonzero(center_valid)),
        projected_sample_count=projected_sample_count,
        projected_fragment_count=projected_fragment_count,
        nominal_coefficient_mass=nominal_mass,
        viewport_coefficient_mass=viewport_mass,
    )


def project_optical_modes_ewa_emission_sparse(
    modes: OpticalModes,
    camera: dict[str, object],
    foreground_transmittance: np.ndarray,
    *,
    path_scale: float,
    near_depth: float,
    far_depth: float,
    support_sigma: float = 3.5,
    pixel_variance_floor: float = 0.04,
    covariance_scale: float = 1.0,
) -> SparseEmissionProjection:
    require(isinstance(modes, OpticalModes), "sparse projection input must be OpticalModes")
    mode_count = int(modes.mode_ids.size)
    require(mode_count > 0, "sparse projection input has no optical modes")
    require(modes.positions.shape == (mode_count, 3), "sparse projection positions shape drifted")
    require(modes.covariances.shape == (mode_count, 3, 3), "sparse projection covariance shape drifted")
    require(modes.coefficients.shape == (mode_count, 8), "sparse projection coefficient shape drifted")
    require(np.all(np.isfinite(modes.positions)), "sparse projection positions contain nonfinite values")
    require(np.all(np.isfinite(modes.covariances)), "sparse projection covariances contain nonfinite values")
    require(np.all(np.isfinite(modes.coefficients)) and np.all(modes.coefficients >= 0.0), "sparse projection coefficients are invalid")
    require(math.isfinite(path_scale) and path_scale > 0.0, "sparse projection path scale is invalid")
    require(math.isfinite(near_depth) and math.isfinite(far_depth) and far_depth > near_depth, "sparse projection depth range is invalid")
    require(math.isfinite(support_sigma) and support_sigma > 0.0, "sparse projection support sigma is invalid")
    require(math.isfinite(pixel_variance_floor) and pixel_variance_floor > 0.0, "sparse projection pixel variance floor is invalid")
    require(math.isfinite(covariance_scale) and covariance_scale > 0.0, "sparse projection covariance scale is invalid")

    width = camera.get("width")
    height = camera.get("height")
    pose = camera.get("cameraPose")
    require(isinstance(width, int) and width > 0, "sparse projection camera width is invalid")
    require(isinstance(height, int) and height > 0, "sparse projection camera height is invalid")
    require(isinstance(pose, dict), "sparse projection camera pose is missing")
    matrix_world_inverse = pose.get("matrixWorldInverse")
    projection_matrix = pose.get("projectionMatrix")
    require(isinstance(matrix_world_inverse, list) and len(matrix_world_inverse) == 16, "sparse projection view matrix is invalid")
    require(isinstance(projection_matrix, list) and len(projection_matrix) == 16, "sparse projection matrix is invalid")
    visibility = np.asarray(foreground_transmittance, dtype=np.float64)
    require(visibility.ndim == 3 and visibility.shape[1:] == (height, width), "foreground transmittance shape differs from camera")
    require(visibility.shape[0] > 1, "foreground transmittance depth must exceed one")
    require(np.all(np.isfinite(visibility)) and np.all((visibility >= 0.0) & (visibility <= 1.0)), "foreground transmittance is invalid")

    view = np.asarray(matrix_world_inverse, dtype=np.float64).reshape(4, 4, order="F")
    projection = np.asarray(projection_matrix, dtype=np.float64).reshape(4, 4, order="F")

    def project(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        homogeneous = np.concatenate((points, np.ones((points.shape[0], 1), dtype=np.float64)), axis=1)
        view_points = homogeneous @ view.T
        clip = view_points @ projection.T
        clip_w = clip[:, 3]
        valid = clip_w > 1e-5
        projected = np.full((points.shape[0], 3), np.nan, dtype=np.float64)
        projected[valid, 0] = (clip[valid, 0] / clip_w[valid] * 0.5 + 0.5) * width
        projected[valid, 1] = (1.0 - (clip[valid, 1] / clip_w[valid] * 0.5 + 0.5)) * height
        projected[valid, 2] = -view_points[valid, 2]
        valid &= np.all(np.isfinite(projected), axis=1)
        return projected, valid

    centers, center_valid = project(modes.positions)
    epsilon = 1e-4
    jacobian = np.empty((mode_count, 3, 3), dtype=np.float64)
    derivative_valid = center_valid.copy()
    for axis in range(3):
        delta = np.zeros(3, dtype=np.float64)
        delta[axis] = epsilon
        plus, plus_valid = project(modes.positions + delta)
        minus, minus_valid = project(modes.positions - delta)
        derivative_valid &= plus_valid & minus_valid
        jacobian[:, :, axis] = (plus - minus) / (2.0 * epsilon)
    projected_covariances = np.einsum(
        "nai,nij,nbj->nab",
        jacobian,
        modes.covariances,
        jacobian,
        optimize=True,
    )
    projected_covariances *= covariance_scale * covariance_scale
    projected_covariances = 0.5 * (projected_covariances + np.swapaxes(projected_covariances, 1, 2))
    center_valid = derivative_valid & (
        centers[:, 2] + support_sigma * np.sqrt(np.maximum(projected_covariances[:, 2, 2], 0.0)) >= near_depth
    )
    center_valid &= (
        centers[:, 2] - support_sigma * np.sqrt(np.maximum(projected_covariances[:, 2, 2], 0.0)) <= far_depth
    )
    require(np.all(np.isfinite(projected_covariances[center_valid])), "sparse projected covariance contains nonfinite values")

    depth_bins = visibility.shape[0]
    depth_axis = np.arange(depth_bins, dtype=np.float64)
    depth_scale = (depth_bins - 1) / (far_depth - near_depth)
    flat_index_parts: list[np.ndarray] = []
    contribution_parts: list[np.ndarray] = []
    projected_mode_count = 0
    projected_depth_slice_count = 0
    projected_fragment_count = 0
    for mode_index in np.flatnonzero(center_valid):
        center_x, center_y, center_depth = centers[mode_index]
        screen_covariance = _positive_semidefinite(projected_covariances[mode_index, :2, :2], pixel_variance_floor)
        inverse_screen_covariance = np.linalg.inv(screen_covariance)
        radius_x = support_sigma * math.sqrt(screen_covariance[0, 0])
        radius_y = support_sigma * math.sqrt(screen_covariance[1, 1])
        x_coordinates = np.arange(math.floor(center_x - radius_x), math.ceil(center_x + radius_x) + 1)
        y_coordinates = np.arange(math.floor(center_y - radius_y), math.ceil(center_y + radius_y) + 1)
        grid_x, grid_y = np.meshgrid(x_coordinates, y_coordinates)
        offsets = np.stack((grid_x - center_x, grid_y - center_y), axis=-1)
        squared_distance = np.einsum("...i,ij,...j->...", offsets, inverse_screen_covariance, offsets, optimize=True)
        support = squared_distance <= support_sigma * support_sigma
        if not np.any(support):
            continue
        spatial_weights = np.exp(-0.5 * squared_distance[support])
        spatial_weights /= np.sum(spatial_weights, dtype=np.float64)
        support_x = grid_x[support]
        support_y = grid_y[support]
        viewport = (support_x >= 0) & (support_x < width) & (support_y >= 0) & (support_y < height)
        if not np.any(viewport):
            continue
        support_x = support_x[viewport].astype(np.int64, copy=False)
        support_y = support_y[viewport].astype(np.int64, copy=False)
        spatial_weights = spatial_weights[viewport]

        center_depth_bin = (center_depth - near_depth) * depth_scale
        depth_sigma_bins = math.sqrt(max(projected_covariances[mode_index, 2, 2], 0.0)) * depth_scale
        if depth_sigma_bins < 1e-5:
            depth_weights = np.zeros(depth_bins, dtype=np.float64)
            depth_weights[int(np.clip(round(center_depth_bin), 0, depth_bins - 1))] = 1.0
        else:
            depth_offsets = (depth_axis - center_depth_bin) / depth_sigma_bins
            depth_support = np.abs(depth_offsets) <= support_sigma
            depth_weights = np.zeros(depth_bins, dtype=np.float64)
            depth_weights[depth_support] = np.exp(-0.5 * np.square(depth_offsets[depth_support]))
            depth_weight_sum = float(np.sum(depth_weights, dtype=np.float64))
            if depth_weight_sum <= 0.0:
                continue
            depth_weights /= depth_weight_sum

        emission = modes.coefficients[mode_index, 0:3] + modes.coefficients[mode_index, 4:7]
        active_depths = np.flatnonzero(depth_weights > 0.0)
        for depth_index in active_depths:
            weights = spatial_weights * depth_weights[depth_index]
            flat_indices = support_y * width + support_x
            linear_rgb = (
                weights[:, None]
                * visibility[depth_index, support_y, support_x, None]
                * path_scale
                * emission[None, :]
            )
            flat_index_parts.append(flat_indices)
            contribution_parts.append(linear_rgb)
            projected_fragment_count += int(weights.size)
        projected_mode_count += 1
        projected_depth_slice_count += int(active_depths.size)

    if not flat_index_parts:
        return SparseEmissionProjection(
            flat_pixel_indices=np.empty(0, dtype=np.int64),
            linear_rgb=np.empty((0, 3), dtype=np.float64),
            projected_mode_count=0,
            projected_depth_slice_count=0,
            projected_fragment_count=0,
        )
    flat_indices = np.concatenate(flat_index_parts).astype(np.int64, copy=False)
    contributions = np.concatenate(contribution_parts).astype(np.float64, copy=False)
    unique_indices, inverse = np.unique(flat_indices, return_inverse=True)
    accumulated = np.zeros((unique_indices.size, 3), dtype=np.float64)
    np.add.at(accumulated, inverse, contributions)
    return SparseEmissionProjection(
        flat_pixel_indices=unique_indices,
        linear_rgb=accumulated,
        projected_mode_count=projected_mode_count,
        projected_depth_slice_count=projected_depth_slice_count,
        projected_fragment_count=projected_fragment_count,
    )


def rasterize_optical_modes_ewa(
    modes: OpticalModes,
    camera: dict[str, object],
    *,
    depth_bins: int,
    near_depth: float,
    far_depth: float,
    support_sigma: float = 3.5,
    pixel_variance_floor: float = 0.04,
    covariance_scale: float = 1.0,
) -> RasterReceipt:
    require(isinstance(modes, OpticalModes), "raster input must be OpticalModes")
    mode_count = int(modes.mode_ids.size)
    require(mode_count > 0, "raster input has no optical modes")
    require(modes.positions.shape == (mode_count, 3), "raster positions shape drifted")
    require(modes.covariances.shape == (mode_count, 3, 3), "raster covariance shape drifted")
    require(modes.coefficients.shape == (mode_count, 8), "raster coefficient shape drifted")
    require(np.all(np.isfinite(modes.positions)), "raster positions contain nonfinite values")
    require(np.all(np.isfinite(modes.covariances)), "raster covariances contain nonfinite values")
    require(np.all(np.isfinite(modes.coefficients)) and np.all(modes.coefficients >= 0.0), "raster coefficients are invalid")
    require(isinstance(depth_bins, int) and depth_bins > 1, "depth bins must exceed one")
    require(math.isfinite(near_depth) and math.isfinite(far_depth) and far_depth > near_depth, "depth range is invalid")
    require(math.isfinite(support_sigma) and support_sigma > 0.0, "support sigma is invalid")
    require(math.isfinite(pixel_variance_floor) and pixel_variance_floor > 0.0, "pixel variance floor is invalid")
    require(math.isfinite(covariance_scale) and covariance_scale > 0.0, "covariance scale is invalid")

    width = camera.get("width")
    height = camera.get("height")
    pose = camera.get("cameraPose")
    require(isinstance(width, int) and width > 0, "camera width is invalid")
    require(isinstance(height, int) and height > 0, "camera height is invalid")
    require(isinstance(pose, dict), "camera pose is missing")
    matrix_world_inverse = pose.get("matrixWorldInverse")
    projection_matrix = pose.get("projectionMatrix")
    require(isinstance(matrix_world_inverse, list) and len(matrix_world_inverse) == 16, "camera view matrix is invalid")
    require(isinstance(projection_matrix, list) and len(projection_matrix) == 16, "camera projection matrix is invalid")
    view = np.asarray(matrix_world_inverse, dtype=np.float64).reshape(4, 4, order="F")
    projection = np.asarray(projection_matrix, dtype=np.float64).reshape(4, 4, order="F")

    def project(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        homogeneous = np.concatenate((points, np.ones((points.shape[0], 1), dtype=np.float64)), axis=1)
        view_points = homogeneous @ view.T
        clip = view_points @ projection.T
        clip_w = clip[:, 3]
        valid = clip_w > 1e-5
        projected = np.full((points.shape[0], 3), np.nan, dtype=np.float64)
        projected[valid, 0] = (clip[valid, 0] / clip_w[valid] * 0.5 + 0.5) * width
        projected[valid, 1] = (1.0 - (clip[valid, 1] / clip_w[valid] * 0.5 + 0.5)) * height
        projected[valid, 2] = -view_points[valid, 2]
        valid &= np.all(np.isfinite(projected), axis=1)
        return projected, valid

    centers, center_valid = project(modes.positions)
    epsilon = 1e-4
    jacobian = np.empty((mode_count, 3, 3), dtype=np.float64)
    derivative_valid = center_valid.copy()
    for axis in range(3):
        delta = np.zeros(3, dtype=np.float64)
        delta[axis] = epsilon
        plus, plus_valid = project(modes.positions + delta)
        minus, minus_valid = project(modes.positions - delta)
        derivative_valid &= plus_valid & minus_valid
        jacobian[:, :, axis] = (plus - minus) / (2.0 * epsilon)
    projected_covariances = np.einsum(
        "nai,nij,nbj->nab",
        jacobian,
        modes.covariances,
        jacobian,
        optimize=True,
    )
    projected_covariances *= covariance_scale * covariance_scale
    projected_covariances = 0.5 * (projected_covariances + np.swapaxes(projected_covariances, 1, 2))
    center_valid = derivative_valid & (centers[:, 2] + support_sigma * np.sqrt(np.maximum(projected_covariances[:, 2, 2], 0.0)) >= near_depth)
    center_valid &= centers[:, 2] - support_sigma * np.sqrt(np.maximum(projected_covariances[:, 2, 2], 0.0)) <= far_depth
    require(np.all(np.isfinite(projected_covariances[center_valid])), "projected covariance contains nonfinite values")

    planes = np.zeros((depth_bins, height, width, 8), dtype=np.float32)
    depth_axis = np.arange(depth_bins, dtype=np.float64)
    depth_scale = (depth_bins - 1) / (far_depth - near_depth)
    projected_mode_count = 0
    projected_depth_slice_count = 0
    projected_fragment_count = 0
    for mode_index in np.flatnonzero(center_valid):
        center_x, center_y, center_depth = centers[mode_index]
        screen_covariance = _positive_semidefinite(
            projected_covariances[mode_index, :2, :2],
            pixel_variance_floor,
        )
        inverse_screen_covariance = np.linalg.inv(screen_covariance)
        radius_x = support_sigma * math.sqrt(screen_covariance[0, 0])
        radius_y = support_sigma * math.sqrt(screen_covariance[1, 1])
        x_coordinates = np.arange(math.floor(center_x - radius_x), math.ceil(center_x + radius_x) + 1)
        y_coordinates = np.arange(math.floor(center_y - radius_y), math.ceil(center_y + radius_y) + 1)
        grid_x, grid_y = np.meshgrid(x_coordinates, y_coordinates)
        offsets = np.stack((grid_x - center_x, grid_y - center_y), axis=-1)
        squared_distance = np.einsum("...i,ij,...j->...", offsets, inverse_screen_covariance, offsets, optimize=True)
        support = squared_distance <= support_sigma * support_sigma
        if not np.any(support):
            continue
        spatial_weights = np.exp(-0.5 * squared_distance[support])
        spatial_weights /= np.sum(spatial_weights, dtype=np.float64)
        support_x = grid_x[support]
        support_y = grid_y[support]
        viewport = (support_x >= 0) & (support_x < width) & (support_y >= 0) & (support_y < height)
        if not np.any(viewport):
            continue
        support_x = support_x[viewport].astype(np.int64, copy=False)
        support_y = support_y[viewport].astype(np.int64, copy=False)
        spatial_weights = spatial_weights[viewport]

        center_depth_bin = (center_depth - near_depth) * depth_scale
        depth_sigma_bins = math.sqrt(max(projected_covariances[mode_index, 2, 2], 0.0)) * depth_scale
        if depth_sigma_bins < 1e-5:
            depth_weights = np.zeros(depth_bins, dtype=np.float64)
            depth_weights[int(np.clip(round(center_depth_bin), 0, depth_bins - 1))] = 1.0
        else:
            depth_offsets = (depth_axis - center_depth_bin) / depth_sigma_bins
            depth_support = np.abs(depth_offsets) <= support_sigma
            depth_weights = np.zeros(depth_bins, dtype=np.float64)
            depth_weights[depth_support] = np.exp(-0.5 * np.square(depth_offsets[depth_support]))
            depth_weight_sum = float(np.sum(depth_weights, dtype=np.float64))
            if depth_weight_sum <= 0.0:
                continue
            depth_weights /= depth_weight_sum

        coefficient = modes.coefficients[mode_index]
        active_depths = np.flatnonzero(depth_weights > 0.0)
        for depth_index in active_depths:
            weights = spatial_weights * depth_weights[depth_index]
            planes[depth_index, support_y, support_x] += (weights[:, None] * coefficient).astype(np.float32)
            projected_fragment_count += int(weights.size)
        projected_mode_count += 1
        projected_depth_slice_count += int(active_depths.size)

    return RasterReceipt(
        planes=planes,
        projected_mode_count=projected_mode_count,
        projected_sample_count=projected_depth_slice_count,
        projected_fragment_count=projected_fragment_count,
        nominal_coefficient_mass=np.sum(modes.coefficients, axis=0, dtype=np.float64),
        viewport_coefficient_mass=np.sum(planes, axis=(0, 1, 2), dtype=np.float64),
    )
