#!/usr/bin/env python3
import importlib.util
import json
import tempfile
from pathlib import Path

import numpy as np
from mlx.utils import tree_flatten


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
neighbor_rows = MODULE.local_grid_neighbor_rows(candidates, grid)

assert encoded.shape == (3, len(names))
np.testing.assert_array_equal(neighbor_rows[0], [1, 2, -1, -1, -1, -1])
np.testing.assert_array_equal(neighbor_rows[1], [-1, 0, -1, -1, -1, -1])
np.testing.assert_array_equal(neighbor_rows[2], [0, -1, -1, -1, -1, -1])
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

pyramid_grid = 10
pyramid_candidates = np.zeros((5, len(MODULE.BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER)), dtype=np.float32)
for row, index in enumerate(((4, 4, 4), (3, 4, 4), (5, 4, 4), (2, 4, 4), (6, 4, 4))):
    pyramid_candidates[row, :3] = position(index, pyramid_grid)
pyramid_candidates[:, 3] = [10.0, 1.0, 2.0, 3.0, 4.0]
pyramid_names = MODULE.context_feature_names("world-grid-pyramid", [1.0])
pyramid_encoded = np.asarray(MODULE.encode_candidate_inputs(pyramid_candidates, "world-grid-pyramid", [1.0], pyramid_grid))
assert pyramid_encoded.shape == (5, len(pyramid_names))
assert "neighbor.r1.occupancy.x-" in pyramid_names
assert "neighbor.r2.occupancy.x-" in pyramid_names
base_offset = len(MODULE.FEATURES) + 3 + 6
radius_block = 6 + len(MODULE.FEATURES) * 6
np.testing.assert_array_equal(pyramid_encoded[0, base_offset:base_offset + 6], [1, 1, 0, 0, 0, 0])
np.testing.assert_array_equal(
    pyramid_encoded[0, base_offset + radius_block:base_offset + radius_block + 6],
    [1, 1, 0, 0, 0, 0],
)
radius_two_mean = base_offset + radius_block + 6
np.testing.assert_allclose(pyramid_encoded[0, radius_two_mean], 7.0 / 6.0)

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

message_model = MODULE.GridMessageAttributeMlp.from_base(base_model, message_size=3)
message_predictions = np.asarray(message_model(sample_inputs, MODULE.mx.array([[-1, -1, -1, -1, -1, -1]])))
np.testing.assert_allclose(message_predictions, base_predictions, rtol=0, atol=1e-7)
assert np.any(np.asarray(message_model.message_hidden.weight) != 0), "message features must be active enough to train"
np.testing.assert_array_equal(np.asarray(message_model.message_output.weight), 0)
np.testing.assert_array_equal(np.asarray(message_model.message_output.bias), 0)

paired_inputs = MODULE.mx.array([[0.5, -0.25, 0.75], [0.1, 0.8, -0.4]])
paired_rows = MODULE.mx.array([[1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1]])
with_neighbor = np.asarray(message_model(paired_inputs, paired_rows))[0]
without_neighbor = np.asarray(message_model(paired_inputs, MODULE.mx.array([[-1] * 6, [-1] * 6])))[0]
np.testing.assert_allclose(with_neighbor, without_neighbor, rtol=0, atol=1e-7)

# Once the zero-delta output gate is opened, the same center can depend on a real neighbor.
message_output_weight = np.zeros_like(np.asarray(message_model.message_output.weight))
message_output_weight[0, 0] = 0.5
message_model.load_weights([
    ("message_output.weight", MODULE.mx.array(message_output_weight)),
    ("message_output.bias", message_model.message_output.bias),
], strict=False)
with_neighbor = np.asarray(message_model(paired_inputs, paired_rows))[0]
without_neighbor = np.asarray(message_model(paired_inputs, MODULE.mx.array([[-1] * 6, [-1] * 6])))[0]
assert not np.allclose(with_neighbor, without_neighbor), "opened message branch must depend on neighbor state"

frozen_message_model = MODULE.GridMessageAttributeMlp.from_base(base_model, message_size=3)
MODULE.freeze_grid_message_base(frozen_message_model)
trainable_names = {name for name, _ in tree_flatten(frozen_message_model.trainable_parameters())}
assert trainable_names == {
    "message_hidden.weight",
    "message_hidden.bias",
    "message_output.weight",
    "message_output.bias",
}

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

    serial_base_model = MODULE.AttributeMlp(2, len(names))
    serial_message_model = MODULE.GridMessageAttributeMlp.from_base(serial_base_model, message_size=3)
    serial_inputs = MODULE.mx.array(np.linspace(-0.5, 0.5, len(names), dtype=np.float32)[None, :])
    serial_rows = MODULE.mx.array([[-1] * 6])
    message_artifact_path = Path(temporary_directory) / "grid-message-model-artifact.json"
    MODULE.serialize_grid_message_model(
        serial_message_model,
        np.asarray([[0.0, 1.0]] * len(MODULE.OUTPUTS), dtype=np.float32),
        names,
        [1.0],
        message_artifact_path,
    )
    message_artifact = json.loads(message_artifact_path.read_text(encoding="utf-8"))
    assert message_artifact["schema"] == "kaminos-boundary-splat-grid-message-attribute-mlp-v0"
    assert message_artifact["architecture"] == "dense-relu-dense-plus-six-neighbor-residual"
    assert message_artifact["messageSize"] == 3
    assert message_artifact["messageAuthority"] == "zero-delta-active-six-neighbor-hidden-residual-v0"
    reloaded_model, _, _, reload_receipt, reload_schema, reload_context, reload_frequencies, reload_mixing = MODULE.load_warm_start(
        message_artifact_path,
        "world-grid-neighborhood",
        [1.0],
        "six-neighbor-hidden-residual",
    )
    assert reload_schema == MODULE.GRID_MESSAGE_MODEL_SCHEMA
    assert reload_context == "world-grid-neighborhood"
    assert reload_frequencies == [1.0]
    assert reload_mixing == "six-neighbor-hidden-residual"
    assert reload_receipt["continuation"] is True
    np.testing.assert_allclose(
        np.asarray(reloaded_model(serial_inputs, serial_rows)),
        np.asarray(serial_message_model(serial_inputs, serial_rows)),
        rtol=0,
        atol=1e-7,
    )

print("boundary splat grid context contracts passed")
