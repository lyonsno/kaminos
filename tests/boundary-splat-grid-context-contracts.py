#!/usr/bin/env python3
import importlib.util
import json
import tempfile
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
assert MODULE.infer_fourier_frequencies(names) == [1.0]
incomplete_names = [name for name in names if name != "position.cos.z.1"]
try:
    MODULE.infer_fourier_frequencies(incomplete_names)
except ValueError as error:
    assert "complete sine/cosine axis groups" in str(error)
else:
    raise AssertionError("partial Fourier feature groups must not recover legacy frequency metadata")
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

base_model = MODULE.AttributeMlp(2, 3)
base_model.load_weights([
    ("hidden.weight", MODULE.mx.array([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])),
    ("hidden.bias", MODULE.mx.array([0.2, -0.1])),
    ("output.weight", MODULE.mx.array([[0.1, 0.2]] * len(MODULE.OUTPUTS))),
    ("output.bias", MODULE.mx.array([0.05] * len(MODULE.OUTPUTS))),
])
sample_inputs = MODULE.mx.array([[0.5, -0.25, 0.75]])
base_predictions = np.asarray(base_model(sample_inputs))
wide_model = MODULE.expand_hidden_size(base_model, 4)
np.testing.assert_allclose(np.asarray(wide_model(sample_inputs)), base_predictions, rtol=0, atol=1e-7)
assert wide_model.hidden.weight.shape == (4, 3)
assert wide_model.output.weight.shape == (len(MODULE.OUTPUTS), 4)
assert np.any(np.asarray(wide_model.hidden.weight)[2:] != 0), "new hidden units must be active enough to receive output-weight gradients"
np.testing.assert_array_equal(np.asarray(wide_model.output.weight)[:, 2:], 0)
second_wide_model = MODULE.expand_hidden_size(base_model, 4)
np.testing.assert_array_equal(np.asarray(second_wide_model.hidden.weight), np.asarray(wide_model.hidden.weight))

with tempfile.TemporaryDirectory() as temporary_directory:
    artifact_path = Path(temporary_directory) / "spatial-model-artifact.json"
    MODULE.serialize_spatial_model(
        wide_model,
        np.asarray([[0.0, 1.0]] * len(MODULE.OUTPUTS), dtype=np.float32),
        names,
        "world-grid-neighborhood",
        [1.0],
        artifact_path,
    )
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["fourierFrequencies"] == [1.0]
    assert artifact["hiddenSize"] == 4

print("boundary splat grid context contracts passed")
