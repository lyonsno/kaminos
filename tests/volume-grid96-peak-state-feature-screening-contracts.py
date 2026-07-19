#!/usr/bin/env python3
"""Fail-first contracts for exact Grid96 peak-state feature screening."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-grid96-peak-state-feature-screening.py"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require(MODULE_PATH.is_file(), "the Grid96 peak-state feature screening implementation is absent")
SPEC = importlib.util.spec_from_file_location("kaminos_grid96_peak_state_screening", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


require(
    tuple(MODULE.validate_coefficient_order(list(MODULE.EXPECTED_COEFFICIENT_ORDER)))
    == MODULE.EXPECTED_COEFFICIENT_ORDER,
    "exact coefficient order validation changed the source contract",
)
try:
    MODULE.validate_coefficient_order([
        *MODULE.EXPECTED_COEFFICIENT_ORDER[:-2],
        MODULE.EXPECTED_COEFFICIENT_ORDER[-1],
        MODULE.EXPECTED_COEFFICIENT_ORDER[-2],
    ])
except ValueError as error:
    require("order drifted" in str(error), f"coefficient-order rejection failed unclearly: {error}")
else:
    raise AssertionError("coefficient controls accepted a reordered source payload")

original_row_count = MODULE.EXPECTED_ROW_COUNT
MODULE.EXPECTED_ROW_COUNT = 2
try:
    descriptor_order = [
        "kernel.normalizedMass", "kernel.radiusWorld", "kernel.coherence",
        "flow.coherence", "flow.curlMagnitude", "flow.divergence", "flow.curlActivity",
        "majorant.density", "majorant.fire", "majorant.extinction", "majorant.importance",
    ]
    for family in ("sidecar", "material", "fire", "micro"):
        for channel in ("x", "y", "z", "w"):
            descriptor_order.append(f"value.{family}.{channel}")
            descriptor_order.extend(f"gradient.{family}.{channel}.{axis}" for axis in ("x", "y", "z"))
    state_signals, _ = MODULE.build_signals(
        np.zeros((2, len(MODULE.EXPECTED_STATE_FEATURE_ORDER)), dtype=np.float32),
        np.zeros((2, len(descriptor_order)), dtype=np.float32),
        np.zeros((2, len(MODULE.EXPECTED_COEFFICIENT_ORDER)), dtype=np.float32),
        descriptor_order,
    )
finally:
    MODULE.EXPECTED_ROW_COUNT = original_row_count
require(
    all(not name.startswith(("state24.", "derived.")) for name in state_signals),
    "unauthenticated 24-column feature labels leaked into state-only selector claims",
)


native_ids = np.asarray([90, 12, 44, 71, 3, 28, 61, 8, 105, 34], dtype=np.uint32)
scores = np.asarray([0.2, 0.9, 0.4, 0.7, 0.3, 0.8, 0.1, 1.0, 0.6, 0.5], dtype=np.float32)
high = MODULE.stable_ranked_indices(native_ids, scores, 3, "high")
low = MODULE.stable_ranked_indices(native_ids, scores, 3, "low")
require(native_ids[high].tolist() == [8, 12, 28], "high ranking did not select the strongest scores")
require(native_ids[low].tolist() == [61, 90, 3], "low ranking did not select the weakest scores")

permutation = np.asarray([8, 4, 2, 0, 9, 3, 7, 1, 6, 5], dtype=np.int64)
permuted = MODULE.stable_ranked_indices(native_ids[permutation], scores[permutation], 3, "high")
require(
    native_ids[permutation][permuted].tolist() == native_ids[high].tolist(),
    "ranked selection depends on source row order",
)

tied_scores = np.ones(native_ids.size, dtype=np.float32)
tied = MODULE.stable_ranked_indices(native_ids, tied_scores, 4, "high")
require(native_ids[tied].tolist() == [3, 8, 12, 28], "score ties are not broken by stable native identity")
tied_capture = MODULE.mass_capture_receipt(native_ids, tied_scores, labels := np.ones(native_ids.size, dtype=np.float32), 0.4, "high")
require(tied_capture["selectionBoundaryFullyResolved"] is False, "partial score plateau masqueraded as budget-discriminating")
require(tied_capture["boundaryTiePopulation"] == native_ids.size, "tie receipt hid the full score plateau")
require(tied_capture["boundaryTieSelectedCount"] == 4, "tie receipt hid native-ID tie-break work")

labels = np.asarray([0, 9, 0, 7, 0, 5, 0, 11, 0, 0], dtype=np.float32)
capture = MODULE.mass_capture_receipt(native_ids, scores, labels, 0.3, "high")
require(capture["selectedCount"] == 3, "mass capture changed the exact requested budget")
require(abs(capture["capturedMassFraction"] - 25 / 32) <= 1e-7, "mass capture fraction is incorrect")
require(capture["liftOverUniform"] > 2.6, "mass capture hid concentrated signal")

anti_scores = -scores
anti_capture = MODULE.mass_capture_receipt(native_ids, anti_scores, labels, 0.3, "low")
require(
    anti_capture["selectedNativeCellIndexSha256"] == capture["selectedNativeCellIndexSha256"],
    "low-direction screening cannot recover an inverse feature",
)

for bad_scores, message in (
    (scores[:-1], "screening score rows drifted"),
    (np.asarray([*scores[:-1], np.nan], dtype=np.float32), "screening scores must be finite"),
):
    try:
        MODULE.mass_capture_receipt(native_ids, bad_scores, labels, 0.3, "high")
    except ValueError as error:
        require(message in str(error), f"unexpected screening rejection: {error}")
    else:
        raise AssertionError(f"screening accepted invalid scores: {message}")

with tempfile.TemporaryDirectory() as temporary_directory:
    temporary = Path(temporary_directory)
    artifact = temporary / "values.f32"
    np.asarray([1, 2, 3, 4], dtype="<f4").tofile(artifact)
    descriptor = {
        "path": str(artifact),
        "bytes": artifact.stat().st_size,
        "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "dtype": "float32-le",
        "shape": [4],
    }
    validated = MODULE.validate_artifact_descriptor(descriptor, "synthetic values")
    require(validated == artifact.resolve(), "artifact validation changed the caller-owned path")
    artifact.write_bytes(artifact.read_bytes()[:-4])
    try:
        MODULE.validate_artifact_descriptor(descriptor, "synthetic values")
    except ValueError as error:
        require("partial" in str(error), f"partial artifact failed unclearly: {error}")
    else:
        raise AssertionError("artifact validator accepted a partial payload")

    report_path = temporary / "failed-report.json"
    result = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "--source-registry",
            str(temporary / "missing-registry.json"),
            "--attribution-manifest",
            str(temporary / "missing-attribution.json"),
            "--attribution-reduced",
            str(temporary / "missing-reduced.f32"),
            "--report",
            str(report_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    require(result.returncode == 1, "missing sources did not fail the evidence harness")
    require(report_path.is_file(), "pre-output failure did not leave a durable report")
    failed = json.loads(report_path.read_text())
    require(failed["status"] == "failed", "pre-output failure masqueraded as complete")
    require(failed["failurePhase"] == "source-registry-validation", "failure report hid the failing phase")
    require(failed["claimBoundary"]["productionClaim"] is False, "failed harness minted production authority")

for route, message in (
    ({"effective": "fallback", "backend": "WebGPU:apple", "fallbackReason": None}, "effective route"),
    ({"effective": "native-3d-compute-fluid-raymarch-v0", "backend": "cpu", "fallbackReason": None}, "backend"),
    ({"effective": "native-3d-compute-fluid-raymarch-v0", "backend": "WebGPU:apple", "fallbackReason": "fallback"}, "fallback"),
):
    try:
        MODULE.validate_effective_route(route)
    except ValueError as error:
        require(message in str(error), f"wrong-route rejection failed unclearly: {error}")
    else:
        raise AssertionError(f"route validator accepted invalid evidence: {route}")

try:
    MODULE.validate_execution_receipt(
        {
            "rowCount": MODULE.EXPECTED_ROW_COUNT,
            "sampleCap": None,
            "droppedRowCount": 0,
            "fallbackRowCount": 0,
            "cachedCameraCount": 1,
        },
        "attribution",
        require_uncached=True,
    )
except ValueError as error:
    require("cached" in str(error), f"cached-attribution rejection failed unclearly: {error}")
else:
    raise AssertionError("cached attribution masqueraded as fresh exact evidence")

print("volume Grid96 peak-state feature screening contracts: ok")
