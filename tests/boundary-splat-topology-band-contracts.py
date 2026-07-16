#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import sys

import mlx.core as mx
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("boundary_splat_radiance_mlx", ROOT / "boundary-splat-radiance-mlx.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


constant = mx.full((12, 10, 3), 0.375)
constant_macro, constant_topology = MODULE.topology_band_decompose(constant, passes=2)
np.testing.assert_allclose(np.asarray(constant_macro), 0.375, rtol=0, atol=1e-7)
np.testing.assert_allclose(np.asarray(constant_topology), 0.0, rtol=0, atol=1e-7)

checkerboard = np.indices((12, 10)).sum(axis=0) % 2
checkerboard = np.repeat(checkerboard[:, :, None], 3, axis=2).astype(np.float32)
checker_macro, checker_topology = MODULE.topology_band_decompose(mx.array(checkerboard), passes=2)
np.testing.assert_allclose(
    np.asarray(checker_macro + checker_topology),
    checkerboard,
    rtol=0,
    atol=1e-7,
)
assert float(np.max(np.abs(np.asarray(checker_topology)))) > 0.25

decoder = MODULE.ScreenTopologyBandUnet(
    input_channels=5,
    base_channels=4,
    residual_scale=1.0,
    topology_scale=1.0,
    topology_passes=2,
)
base_prediction = mx.array(np.random.default_rng(7).random((16, 12, 3), dtype=np.float32))
macro_prediction, topology_residual, final_prediction = decoder.predict_components(base_prediction)
mx.eval(macro_prediction, topology_residual, final_prediction)
np.testing.assert_allclose(np.asarray(macro_prediction), np.asarray(base_prediction), rtol=0, atol=1e-7)
np.testing.assert_allclose(np.asarray(topology_residual), 0.0, rtol=0, atol=1e-7)
np.testing.assert_allclose(np.asarray(final_prediction), np.asarray(base_prediction), rtol=0, atol=1e-7)

perfect_target = mx.array(checkerboard)
perfect_macro, perfect_topology = MODULE.topology_band_decompose(perfect_target, passes=2)
perfect_losses = MODULE.topology_band_losses(
    perfect_macro,
    perfect_topology,
    perfect_macro + perfect_topology,
    perfect_target,
    passes=2,
    macro_weight=1.0,
    topology_weight=1.0,
    edge_weight=1.0,
)
mx.eval(*perfect_losses.values())
for loss_name, loss_value in perfect_losses.items():
    assert float(loss_value.item()) < 1e-7, f"perfect {loss_name} must be zero"

wrong_topology_losses = MODULE.topology_band_losses(
    perfect_macro,
    mx.zeros_like(perfect_topology),
    perfect_macro,
    perfect_target,
    passes=2,
    macro_weight=1.0,
    topology_weight=1.0,
    edge_weight=1.0,
)
mx.eval(*wrong_topology_losses.values())
assert float(wrong_topology_losses["topology"].item()) > 0.1
assert float(wrong_topology_losses["total"].item()) > float(wrong_topology_losses["macro"].item())

print("boundary splat topology band contracts passed")
