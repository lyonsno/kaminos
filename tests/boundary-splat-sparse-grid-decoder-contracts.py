#!/usr/bin/env python3
import importlib.util
from pathlib import Path

import numpy as np
from mlx.utils import tree_flatten


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "boundary-splat-radiance-mlx.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_radiance_mlx", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SOURCE = SCRIPT_PATH.read_text(encoding="utf-8")


def position(index, grid):
    return (np.asarray(index, dtype=np.float32) + 0.5) * (2.0 / grid) - 1.0


assert MODULE.SPARSE_GRID_MODEL_SCHEMA == "kaminos-boundary-splat-sparse-grid-residual-v0"
assert 'choices=["none", "six-neighbor-hidden-residual", "sparse-grid-residual"]' in SOURCE
assert "sparse-grid-residual requires an explicit disjoint frame holdout" in SOURCE
assert "exact-26-neighbor-source-grid-adjacency-v0" in SOURCE
assert "three-round-sparse-grid-residual-attribute-decoder-v0" in SOURCE
assert '"deployable": False' in SOURCE

grid = 5
indices = [
    (2, 2, 2),
    *[
        (2 + offset_x, 2 + offset_y, 2 + offset_z)
        for offset_z in (-1, 0, 1)
        for offset_y in (-1, 0, 1)
        for offset_x in (-1, 0, 1)
        if (offset_x, offset_y, offset_z) != (0, 0, 0)
    ],
]
candidates = np.zeros(
    (len(indices), len(MODULE.BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER)),
    dtype=np.float32,
)
for row, index in enumerate(indices):
    candidates[row, :3] = position(index, grid)
    candidates[row, 3:] = row / max(len(indices) - 1, 1)

neighbor_rows = MODULE.local_grid_neighbor_rows_26(candidates, grid)
assert neighbor_rows.shape == (27, 26)
assert np.all(neighbor_rows[0] >= 0)
assert set(neighbor_rows[0].tolist()) == set(range(1, 27))

base_model = MODULE.AttributeMlp(8, len(MODULE.FEATURES))
sample_inputs = MODULE.mx.array(candidates[:, 3:])
base_prediction = np.asarray(base_model(sample_inputs))
decoder = MODULE.SparseGridResidualAttributeDecoder.from_base(base_model)
decoded_prediction = np.asarray(decoder(sample_inputs, MODULE.mx.array(neighbor_rows)))
np.testing.assert_allclose(decoded_prediction, base_prediction, rtol=0, atol=1e-7)
assert decoder.mixing_rounds == 3

trainable_names = {name for name, _ in tree_flatten(decoder.trainable_parameters())}
assert trainable_names
assert not any(name.startswith(("hidden.", "output.")) for name in trainable_names)
assert any(name.startswith("block0.") for name in trainable_names)
assert any(name.startswith("block1.") for name in trainable_names)
assert any(name.startswith("block2.") for name in trainable_names)
assert any(name.startswith("residual_output.") for name in trainable_names)

np.testing.assert_array_equal(np.asarray(decoder.residual_output.weight), 0)
np.testing.assert_array_equal(np.asarray(decoder.residual_output.bias), 0)

opened_weight = np.zeros_like(np.asarray(decoder.residual_output.weight))
opened_weight[0, 0] = 0.5
decoder.load_weights([
    ("residual_output.weight", MODULE.mx.array(opened_weight)),
    ("residual_output.bias", decoder.residual_output.bias),
], strict=False)
with_neighbors = np.asarray(decoder(sample_inputs, MODULE.mx.array(neighbor_rows)))[0]
without_neighbors = np.asarray(
    decoder(sample_inputs, MODULE.mx.array(np.full_like(neighbor_rows, -1)))
)[0]
assert not np.allclose(with_neighbors, without_neighbors), (
    "opened structural branch must respond to the exact occupied 26-neighbor state"
)

print("boundary splat sparse-grid decoder contracts passed")
