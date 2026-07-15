#!/usr/bin/env python3
import importlib.util
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "boundary_splat_native_sidecar.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_native_sidecar", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def cell_center(index, grid):
    return (np.asarray(index, dtype=np.float32) + 0.5) * (2.0 / grid) - 1.0


grid = 4
candidate_cell = np.asarray([1, 1, 1], dtype=np.int32)
candidates = np.zeros((1, 19), dtype=np.float32)
candidates[0, :3] = cell_center(candidate_cell, grid)

cell_count = grid ** 3
native_fields = np.arange(cell_count * len(MODULE.NATIVE_SIDECAR_CHANNELS), dtype=np.float32).reshape(cell_count, -1)
channels = MODULE.native_sidecar_pyramid_channels(candidates, grid, native_fields, radii=(1,))

center_linear = candidate_cell[0] + grid * (candidate_cell[1] + grid * candidate_cell[2])
neighbor_cells = np.asarray([
    [0, 1, 1], [2, 1, 1],
    [1, 0, 1], [1, 2, 1],
    [1, 1, 0], [1, 1, 2],
], dtype=np.int32)
neighbor_linear = neighbor_cells[:, 0] + grid * (neighbor_cells[:, 1] + grid * neighbor_cells[:, 2])
neighbor_values = native_fields[neighbor_linear]
center = native_fields[center_linear]
neighbor_mean = neighbor_values.mean(axis=0)
neighbor_max = neighbor_values.max(axis=0)
expected = np.concatenate([
    center,
    np.ones(6, dtype=np.float32),
    neighbor_mean,
    neighbor_max,
    neighbor_mean - center,
    (neighbor_values[1] - neighbor_values[0]) * 0.5,
    (neighbor_values[3] - neighbor_values[2]) * 0.5,
    (neighbor_values[5] - neighbor_values[4]) * 0.5,
])

assert channels.shape == (1, expected.size)
np.testing.assert_allclose(channels[0], expected, rtol=0, atol=0)
assert np.all(channels[0, len(MODULE.NATIVE_SIDECAR_CHANNELS):len(MODULE.NATIVE_SIDECAR_CHANNELS) + 6] == 1)

feature_names = MODULE.native_sidecar_pyramid_feature_names((1,))
assert len(feature_names) == expected.size
assert feature_names[:8] == [f"native.center.{name}" for name in MODULE.NATIVE_SIDECAR_CHANNELS]
assert "native.r1.gradient.z.normalZ" in feature_names

off_center = candidates.copy()
off_center[0, 0] += 0.01
try:
    MODULE.native_sidecar_pyramid_channels(off_center, grid, native_fields, radii=(1,))
except ValueError as error:
    assert "exact source-grid cell centers" in str(error)
else:
    raise AssertionError("native sidecar context accepted a non-cell-center candidate")

print("boundary splat native sidecar context: PASS")
