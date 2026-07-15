import numpy as np


NATIVE_SIDECAR_CHANNELS = (
    "support",
    "coverage",
    "ridge",
    "footprint",
    "proximity",
    "normalX",
    "normalY",
    "normalZ",
)
NATIVE_SIDECAR_PYRAMID_RADII = (1, 2, 4, 8)


def candidate_grid_indices(candidates, grid):
    if not isinstance(grid, int) or grid <= 0:
        raise ValueError("native sidecar context requires a positive integer source grid")
    positions = np.asarray(candidates[:, :3], dtype=np.float32)
    indices = np.rint((positions + 1.0) * 0.5 * grid - 0.5).astype(np.int32)
    if np.any(indices < 0) or np.any(indices >= grid):
        raise ValueError("candidate position falls outside the declared source grid")
    reconstructed = (indices.astype(np.float32) + 0.5) * (2.0 / grid) - 1.0
    if np.max(np.abs(reconstructed - positions)) > 1e-5:
        raise ValueError("candidate positions are not exact source-grid cell centers")
    linear = indices[:, 0] + grid * (indices[:, 1] + grid * indices[:, 2])
    if np.unique(linear).size != linear.size:
        raise ValueError("candidate positions contain duplicate source-grid cells")
    return indices, linear


def native_sidecar_neighborhood_feature_names(prefix):
    names = [
        f"{prefix}.occupancy.x-", f"{prefix}.occupancy.x+",
        f"{prefix}.occupancy.y-", f"{prefix}.occupancy.y+",
        f"{prefix}.occupancy.z-", f"{prefix}.occupancy.z+",
    ]
    for statistic in ("mean", "max", "laplacian", "gradient.x", "gradient.y", "gradient.z"):
        names.extend(f"{prefix}.{statistic}.{channel}" for channel in NATIVE_SIDECAR_CHANNELS)
    return names


def native_sidecar_pyramid_feature_names(radii=NATIVE_SIDECAR_PYRAMID_RADII):
    names = [f"native.center.{channel}" for channel in NATIVE_SIDECAR_CHANNELS]
    for radius in radii:
        names.extend(native_sidecar_neighborhood_feature_names(f"native.r{radius}"))
    return names


def native_sidecar_pyramid_channels(candidates, grid, native_fields, radii=NATIVE_SIDECAR_PYRAMID_RADII):
    fields = np.asarray(native_fields, dtype=np.float32)
    expected_shape = (grid ** 3, len(NATIVE_SIDECAR_CHANNELS))
    if fields.shape != expected_shape:
        raise ValueError(f"native sidecar fields must have shape {expected_shape}, received {fields.shape}")
    if not np.all(np.isfinite(fields)):
        raise ValueError("native sidecar fields contain non-finite values")
    if not radii or any(not isinstance(radius, int) or radius <= 0 for radius in radii):
        raise ValueError("native sidecar pyramid radii must be positive integers")

    indices, linear = candidate_grid_indices(candidates, grid)
    center = fields[linear]
    channels = [center]
    axial_directions = np.asarray([
        [-1, 0, 0], [1, 0, 0],
        [0, -1, 0], [0, 1, 0],
        [0, 0, -1], [0, 0, 1],
    ], dtype=np.int32)
    for radius in radii:
        neighbor_cells = indices[:, None, :] + axial_directions[None, :, :] * radius
        in_bounds = np.all((neighbor_cells >= 0) & (neighbor_cells < grid), axis=2)
        clipped = np.clip(neighbor_cells, 0, grid - 1)
        neighbor_linear = clipped[:, :, 0] + grid * (clipped[:, :, 1] + grid * clipped[:, :, 2])
        neighbor_values = fields[neighbor_linear]
        neighbor_values = np.where(in_bounds[:, :, None], neighbor_values, 0.0)
        occupancy = in_bounds.astype(np.float32)
        neighbor_mean = np.mean(neighbor_values, axis=1)
        neighbor_max = np.max(neighbor_values, axis=1)
        laplacian = neighbor_mean - center
        gradients = [
            (neighbor_values[:, 1] - neighbor_values[:, 0]) * 0.5,
            (neighbor_values[:, 3] - neighbor_values[:, 2]) * 0.5,
            (neighbor_values[:, 5] - neighbor_values[:, 4]) * 0.5,
        ]
        channels.append(np.concatenate([
            occupancy,
            neighbor_mean,
            neighbor_max,
            laplacian,
            *gradients,
        ], axis=1))
    return np.concatenate(channels, axis=1).astype(np.float32, copy=False)
