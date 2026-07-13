#!/usr/bin/env python3
import importlib.util
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("boundary_splat_radiance_mlx", ROOT / "boundary-splat-radiance-mlx.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def position(index, grid):
    return (np.asarray(index, dtype=np.float32) + 0.5) * (2.0 / grid) - 1.0


grid = 4
candidates = np.zeros((3, len(MODULE.BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER)), dtype=np.float32)
candidates[0, :3] = position((1, 1, 1), grid)
candidates[1, :3] = position((0, 1, 1), grid)
candidates[2, :3] = position((2, 1, 1), grid)
candidates[:, 3] = [2.0, 1.0, 3.0]

names = MODULE.context_feature_names("world-grid-neighborhood", [1.0])
encoded = np.asarray(MODULE.encode_candidate_inputs(candidates, "world-grid-neighborhood", [1.0], grid))

assert encoded.shape == (3, len(names))
assert len(names) == len(MODULE.FEATURES) + 3 + 6 + 6 + len(MODULE.FEATURES) * 6
offset = len(MODULE.FEATURES) + 3 + 6
np.testing.assert_array_equal(encoded[0, offset:offset + 6], [1, 1, 0, 0, 0, 0])
offset += 6
np.testing.assert_allclose(encoded[0, offset], 4.0 / 6.0)
offset += len(MODULE.FEATURES)
np.testing.assert_allclose(encoded[0, offset], 3.0)
offset += len(MODULE.FEATURES)
np.testing.assert_allclose(encoded[0, offset], 4.0 / 6.0 - 2.0)
offset += len(MODULE.FEATURES)
np.testing.assert_allclose(encoded[0, offset], 1.0)

print("boundary splat grid context contracts passed")
