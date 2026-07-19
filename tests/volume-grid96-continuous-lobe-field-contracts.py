#!/usr/bin/env python3
"""Contracts for the Grid96 continuous lobe-field allocation oracle."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-continuous-lobe-field.py"
assert SCRIPT.is_file(), "continuous lobe-field producer is missing"

spec = importlib.util.spec_from_file_location("grid96_continuous_lobe_field", SCRIPT)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


assert module.EXPECTED_ROW_COUNT == 370194
assert module.EXPECTED_GRID == 96
assert module.EXPECTED_STEP == 120
assert module.FIELD_ORDER == (
    "peak.heldAll",
    "peak.heldEven",
    "peak.heldOdd",
    "peak.calibration",
    "wisp.heldAll",
)
assert module.DEFAULT_BANDWIDTHS == (0.0, 1.0, 2.0, 4.0)
assert module.CLAIM_BOUNDARY["placementChosen"] is False
assert module.CLAIM_BOUNDARY["candidateCentersProduced"] is False
assert module.CLAIM_BOUNDARY["continuousImportanceTeacherOnly"] is True
assert module.CLAIM_BOUNDARY["componentCountClaimed"] is False
assert module.CLAIM_BOUNDARY["temporalPersistenceClaimed"] is False


native = np.asarray([0, 1, 8, 9, 63], dtype=np.uint32)
weights = np.asarray([1.0, 2.0, 3.0, 4.0, 5.0], dtype=np.float32)
dense = module.dense_field(native, weights, grid=4)
assert dense.shape == (4, 4, 4)
assert np.isclose(float(np.sum(dense, dtype=np.float64)), 15.0)
assert dense.reshape(-1)[63] == 5.0


impulse = np.zeros((9, 9, 9), dtype=np.float32)
impulse[4, 4, 4] = 1.0
raw = module.gaussian_smooth(impulse, 0.0)
smooth = module.gaussian_smooth(impulse, 1.0)
assert np.array_equal(raw, impulse)
assert smooth.shape == impulse.shape
assert np.all(np.isfinite(smooth)) and float(np.min(smooth)) >= 0.0
assert np.isclose(float(np.sum(smooth, dtype=np.float64)), 1.0, atol=1e-6)
assert 0.0 < smooth[4, 4, 4] < 1.0
assert np.isclose(smooth[3, 4, 4], smooth[5, 4, 4], atol=1e-7)


edge = np.zeros((9, 9, 9), dtype=np.float32)
edge[0, 0, 0] = 1.0
edge_smooth = module.gaussian_smooth(edge, 1.0)
assert 0.0 < float(np.sum(edge_smooth, dtype=np.float64)) < 1.0


metrics = module.field_metrics(smooth)
assert metrics["positiveVoxelCount"] > 1
assert metrics["totalMass"] > 0.999999
assert metrics["effectiveVoxelCount"] > 1.0
assert metrics["topVoxelBasis"] == "full-grid-voxel-count-v0"
assert metrics["topMassFractions"]["0.01"] > 0.0
assert metrics["topMassFractions"]["0.10"] > metrics["topMassFractions"]["0.01"]
assert len(metrics["weightedCentroidGrid"]) == 3
assert len(metrics["weightedCovarianceGrid"]) == 6


same = module.compare_fields(smooth, smooth)
assert np.isclose(same["cosineSimilarity"], 1.0, atol=1e-7)
assert np.isclose(same["normalizedL1"], 0.0, atol=1e-7)
assert np.isclose(same["jensenShannonDivergence"], 0.0, atol=1e-7)
opposite = np.flip(smooth, axis=0).copy()
shifted = module.compare_fields(smooth, opposite)
assert 0.0 <= shifted["cosineSimilarity"] <= 1.0
assert shifted["normalizedL1"] >= 0.0
assert shifted["jensenShannonDivergence"] >= 0.0


projection = module.render_projection(smooth, axis=0, mode="maximum")
integral = module.render_projection(smooth, axis=2, mode="integral")
slice_image = module.render_projection(smooth, axis=1, mode="slice", slice_index=4)
assert projection.shape == (9, 9, 3) and projection.dtype == np.uint8
assert integral.shape == (9, 9, 3) and integral.dtype == np.uint8
assert slice_image.shape == (9, 9, 3) and slice_image.dtype == np.uint8
assert int(np.max(projection)) > 0 and int(np.max(integral)) > 0 and int(np.max(slice_image)) > 0
assert np.array_equal(module._colorize(np.zeros((3, 3), dtype=np.float32)), np.zeros((3, 3, 3), dtype=np.uint8))


rows = [
    {
        "field": "peak.heldAll",
        "bandwidthCells": 1.0,
        "axis": "x",
        "mode": "maximum",
        "sliceIndex": None,
        "image": "peak-heldAll-bw1-x-maximum.png",
    }
]
page = module.gallery_html(
    rows,
    bandwidths=[0.0, 1.0],
    grid=9,
    source_identity="sha256:test-source",
    attribution_identity="sha256:test-attribution",
)
for contract in (
    "Continuous Grid96 lobe importance",
    "teacher only",
    "No candidate centers",
    "peak.heldAll",
    "bandwidth",
    "slice",
    "maximum",
    "integral",
    "sha256:test-source",
    "sha256:test-attribution",
):
    assert contract in page


source = SCRIPT.read_text()
for contract in (
    "source registry sha256 drifted",
    "parent attribution manifest sha256 drifted",
    "source and attribution native-id rows are misaligned",
    "descriptor position native ids drifted",
    "all-parent peak field is blank",
    "sampleCap",
    "droppedRowCount",
    "fallbackRowCount",
    "cachedOutputUsed",
    "failurePhase",
    "producerIdentity",
    "candidateCentersProduced",
    "componentCountClaimed",
):
    assert contract in source


with tempfile.TemporaryDirectory() as directory:
    out = Path(directory) / "missing-source"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--source-registry",
            str(Path(directory) / "missing-registry.json"),
            "--parent-attribution-manifest",
            str(Path(directory) / "missing-attribution.json"),
            "--output-dir",
            str(out),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    failure = json.loads((out / "report.json").read_text())
    assert failure["status"] == "failed"
    assert failure["failurePhase"] == "source-validation"
    assert "source registry is missing" in failure["error"]
    assert not (out / "grid96-continuous-lobe-field-manifest.json").exists()


print("volume-grid96 continuous lobe-field contracts passed")
