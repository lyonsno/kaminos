#!/usr/bin/env python3
"""Contracts for renderer-exact Grid96 bright-peak contribution concentration."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-peak-contribution-concentration.py"
assert SCRIPT.exists(), "Grid96 peak contribution concentration producer is missing"

spec = importlib.util.spec_from_file_location("kaminos_grid96_peak_concentration", SCRIPT)
assert spec is not None and spec.loader is not None
MODULE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MODULE)

assert MODULE.CONTRIBUTION_IDENTITY == "deposited-kernel-times-pre-bin-shared-transmittance-times-local-optical-weight-v0"
assert MODULE.EMISSION_CONTRIBUTION_IDENTITY == "deposited-kernel-times-pre-bin-shared-transmittance-times-parent-emission-luma-times-path-scale-v0"
assert MODULE.COHORT_IDENTITY == "top1-majority-hotspot_top4-submajority-distributed_else-mixed_unattributed-explicit-v0"
assert "<dt>Status</dt><dd>calibration-smoke</dd>" in MODULE.gallery_html(
    [{"cameraIndex": 10, "role": "calibration"}], False
)
assert "<dt>Status</dt><dd>complete</dd>" in MODULE.gallery_html([], True)
held_subset_html = MODULE.gallery_html([{"cameraIndex": 7, "role": "held-out"}], False)
assert "<dt>Status</dt><dd>subset-smoke</dd>" in held_subset_html
assert "<dt>Authority</dt><dd>held-out-camera smoke</dd>" in held_subset_html
producer = MODULE.producer_identity()
assert producer["concentrationScript"]["sha256"] == MODULE.sha256_file(MODULE.Path(MODULE.__file__))
assert producer["parentScript"]["sha256"] == MODULE.sha256_file(MODULE.PARENT_PATH)
assert producer["oracleScript"]["sha256"] == MODULE.sha256_file(
    MODULE.PARENT_PATH.with_name("volume-layer-coefficient-render-oracle.py")
)
assert MODULE.Path(producer["pythonExecutable"]).is_file()


# Four bright positive-peak pixels exercise all cohorts. Pixel zero receives two
# fragments from parent zero; they must aggregate before parent concentration.
rows = np.asarray(
    (0, 0, 1) + tuple(range(2, 12)) + tuple(range(8)),
    dtype=np.int64,
)
x = np.asarray(
    (0, 0, 0) + (1,) * 10 + (2,) * 8,
    dtype=np.int32,
)
y = np.zeros_like(x)
depth = np.asarray(
    (1, 1, 3) + tuple(index % 5 for index in range(10)) + tuple(range(8)),
    dtype=np.int32,
)
weight = np.asarray(
    (0.4, 0.3, 0.3) + (0.1,) * 10 + (0.2,) * 4 + (0.05,) * 4,
    dtype=np.float32,
)
transmittance = np.ones((8, 1, 4), dtype=np.float32)
optical = np.ones(12, dtype=np.float32)
emission_luma = np.ones(12, dtype=np.float32)
target_bright = np.ones((1, 4), dtype=bool)
positive_peak = np.ones((1, 4), dtype=bool)
column_tau = np.asarray(((0.5, 1.0, 1.5, 2.0),), dtype=np.float32)
composed_linear_luma = np.asarray(((2.0, 2.0, 2.0, 0.0),), dtype=np.float32)

metrics, receipt = MODULE.concentrate_parent_contributions(
    row_count=12,
    row_index=rows,
    sample_x=x,
    sample_y=y,
    sample_depth=depth,
    sample_weight=weight,
    transmittance_before=transmittance,
    local_optical_weight=optical,
    parent_emission_luma=emission_luma,
    path_scale=2.0,
    composed_linear_luma=composed_linear_luma,
    target_bright_mask=target_bright,
    positive_peak_mask=positive_peak,
    column_optical_depth=column_tau,
)
column = {name: index for index, name in enumerate(MODULE.PIXEL_ORDER)}
assert metrics.shape == (1, 4, len(MODULE.PIXEL_ORDER))
assert np.isclose(metrics[0, 0, column["top1Fraction"]], 0.7)
assert np.isclose(metrics[0, 0, column["top2Fraction"]], 1.0)
assert np.isclose(metrics[0, 0, column["top4Fraction"]], 1.0)
assert metrics[0, 0, column["contributorCount"]] == 2.0
assert np.isclose(metrics[0, 0, column["effectiveContributorCount"]], 1.0 / (0.7**2 + 0.3**2))
assert metrics[0, 0, column["depthBinCount"]] == 2.0
assert metrics[0, 0, column["depthBinSpan"]] == 2.0
assert metrics[0, 0, column["cohortCode"]] == MODULE.COHORT_HOTSPOT

assert np.isclose(metrics[0, 1, column["top1Fraction"]], 0.1)
assert np.isclose(metrics[0, 1, column["top2Fraction"]], 0.2)
assert np.isclose(metrics[0, 1, column["top4Fraction"]], 0.4)
assert np.isclose(metrics[0, 1, column["effectiveContributorCount"]], 10.0)
assert np.isclose(metrics[0, 1, column["normalizedEntropy"]], 1.0)
assert metrics[0, 1, column["depthBinCount"]] == 5.0
assert metrics[0, 1, column["depthBinSpan"]] == 4.0
assert metrics[0, 1, column["cohortCode"]] == MODULE.COHORT_DISTRIBUTED

assert np.isclose(metrics[0, 2, column["top1Fraction"]], 0.2)
assert np.isclose(metrics[0, 2, column["top4Fraction"]], 0.8)
assert metrics[0, 2, column["cohortCode"]] == MODULE.COHORT_MIXED
assert metrics[0, 3, column["cohortCode"]] == MODULE.COHORT_UNATTRIBUTED
assert np.allclose(metrics[0, :, column["columnOpticalDepth"]], column_tau[0])
assert np.allclose(metrics[0, :, column["composedLinearLuma"]], composed_linear_luma[0])
assert np.allclose(metrics[0, :, column["emissionTotalContribution"]], composed_linear_luma[0])
assert np.max(metrics[0, :, column["emissionReconstructionDelta"]]) < 1e-6
assert np.isclose(metrics[0, 0, column["emissionTop1Fraction"]], 0.7)
assert np.isclose(metrics[0, 1, column["emissionEffectiveContributorCount"]], 10.0)
assert metrics[0, 2, column["emissionCohortCode"]] == MODULE.COHORT_MIXED
assert metrics[0, 3, column["emissionCohortCode"]] == MODULE.COHORT_UNATTRIBUTED
assert receipt["emission"]["identity"] == MODULE.EMISSION_CONTRIBUTION_IDENTITY
assert receipt["emission"]["reconstruction"]["maximumAbsoluteDelta"] < 1e-6
assert receipt["emission"]["reconstruction"]["failingPixelCount"] == 0

# A non-uniform fixture constrains every factor in both contribution products.
# Parent one wins optical influence only after depth transmittance is applied;
# parent zero wins emitted luma because its nearer depth outweighs parent one.
factor_metrics, _ = MODULE.concentrate_parent_contributions(
    row_count=2,
    row_index=np.asarray((0, 1), dtype=np.int64),
    sample_x=np.zeros(2, dtype=np.int32),
    sample_y=np.zeros(2, dtype=np.int32),
    sample_depth=np.asarray((0, 1), dtype=np.int32),
    sample_weight=np.ones(2, dtype=np.float32),
    transmittance_before=np.asarray(([[1.0]], [[0.25]]), dtype=np.float32),
    local_optical_weight=np.asarray((0.1, 1.0), dtype=np.float32),
    parent_emission_luma=np.asarray((0.4, 0.8), dtype=np.float32),
    path_scale=2.0,
    composed_linear_luma=np.asarray(((1.2,),), dtype=np.float32),
    target_bright_mask=np.asarray(((True,),), dtype=bool),
    positive_peak_mask=np.asarray(((True,),), dtype=bool),
    column_optical_depth=np.asarray(((0.5,),), dtype=np.float32),
)
assert np.isclose(factor_metrics[0, 0, column["totalContribution"]], 0.35)
assert np.isclose(factor_metrics[0, 0, column["top1Fraction"]], 5.0 / 7.0)
assert np.isclose(factor_metrics[0, 0, column["emissionTotalContribution"]], 1.2)
assert np.isclose(factor_metrics[0, 0, column["emissionTop1Fraction"]], 2.0 / 3.0)

for mask_name in ("targetBright", "positivePeak"):
    summary = receipt["cohorts"][mask_name]
    assert summary["pixelCount"] == 4
    assert summary["attributedPixelCount"] == 3
    assert np.isclose(summary["attributedPixelFraction"], 0.75)
    assert summary["hotspotPixelCount"] == 1
    assert summary["mixedPixelCount"] == 1
    assert summary["distributedPixelCount"] == 1
    assert summary["unattributedPixelCount"] == 1
    assert np.isclose(summary["hotspotFractionOfAttributed"], 1.0 / 3.0)
    assert np.isclose(summary["mixedFractionOfAttributed"], 1.0 / 3.0)
    assert np.isclose(summary["distributedFractionOfAttributed"], 1.0 / 3.0)


try:
    MODULE.concentrate_parent_contributions(
        row_count=12,
        row_index=rows,
        sample_x=x,
        sample_y=y,
        sample_depth=depth,
        sample_weight=weight,
        transmittance_before=transmittance,
        local_optical_weight=optical,
        parent_emission_luma=emission_luma,
        path_scale=2.0,
        composed_linear_luma=composed_linear_luma + 0.25,
        target_bright_mask=target_bright,
        positive_peak_mask=positive_peak,
        column_optical_depth=column_tau,
    )
except ValueError as exc:
    assert "emitted luma reconstruction" in str(exc)
else:
    raise AssertionError("mismatched emitted luma reconstruction did not fail loud")


with tempfile.TemporaryDirectory(prefix="kaminos-grid96-peak-concentration-") as temp:
    root = Path(temp)
    output = root / "output"
    completed = subprocess.run(
        (
            sys.executable,
            str(SCRIPT),
            "--source-registry",
            str(root / "missing-registry.json"),
            "--manifest",
            str(root / "missing-training-manifest.json"),
            "--capture-report",
            str(root / "missing-capture.json"),
            "--parent-attribution-manifest",
            str(root / "missing-parent-attribution.json"),
            "--output-dir",
            str(output),
            "--path-scale",
            "3.8845837491755066",
            "--camera-index",
            "10",
        ),
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode != 0
    failure = json.loads((output / "report.json").read_text())
    assert failure["status"] == "failed"
    assert failure["failurePhase"] == "parent-attribution-validation"
    assert not (output / "grid96-peak-contribution-concentration-manifest.json").exists()
    assert not (output / "grid96-peak-contribution-per-pixel.f32").exists()

print("volume-grid96 peak contribution concentration contracts passed")
