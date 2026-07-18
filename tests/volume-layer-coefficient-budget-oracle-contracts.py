#!/usr/bin/env python3
"""Fail-first contracts for the fixed-budget quadrature selection oracle."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-budget-oracle.py"
SPEC = importlib.util.spec_from_file_location("kaminos_budget_oracle", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODULE.initialize_runtime()
IMPLEMENTATION_BUNDLE_SHA256 = MODULE.implementation_bundle_receipt()["sha256"]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


ids = np.asarray([91, 7, 42, 3, 101, 66, 18, 55], dtype=np.uint32)
uniform_a = MODULE.select_stable_uniform(ids, 3)
uniform_b = MODULE.select_stable_uniform(ids[::-1], 3)
require(uniform_a.size == 3, "stable-uniform selector changed the fixed budget")
require(set(ids[uniform_a].tolist()) == set(ids[::-1][uniform_b].tolist()), "stable-uniform membership depends on row order")

coefficients = np.zeros((ids.size, 8), dtype=np.float32)
coefficients[:, 0] = np.asarray([0.1, 0.2, 0.3, 8.0, 0.4, 0.5, 0.6, 7.0], dtype=np.float32)
coefficients[:, 3] = np.asarray([0.1, 0.1, 0.1, 0.1, 0.1, 6.0, 0.1, 0.1], dtype=np.float32)
optical = MODULE.select_optical_energy(ids, coefficients, 3)
require(optical.size == 3, "optical selector changed the fixed budget")
require(set(ids[optical].tolist()) == {3, 55, 66}, "optical selector missed the strongest exact local coefficients")
uninitialized = MODULE.select_optical_hysteresis(ids, coefficients, 3, None, hysteresis_ratio=0.1)
require(np.array_equal(uninitialized, optical), "first-state hysteretic selection drifted from the stateless optical control")

near_boundary_coefficients = coefficients.copy()
near_boundary_coefficients[:, 0] = np.asarray([0.1, 6.1, 0.3, 8.0, 0.4, 6.0, 0.6, 7.0], dtype=np.float32)
hysteretic = MODULE.select_optical_hysteresis(
    ids,
    near_boundary_coefficients,
    3,
    ids[optical],
    hysteresis_ratio=0.1,
)
require(hysteretic.size == 3, "hysteretic selector changed the fixed budget")
require(
    set(ids[hysteretic].tolist()) == {3, 55, 66},
    "hysteretic selector replaced a prior member for a near-boundary newcomer",
)
reversed_hysteretic = MODULE.select_optical_hysteresis(
    ids[::-1],
    near_boundary_coefficients[::-1],
    3,
    ids[optical][::-1],
    hysteresis_ratio=0.1,
)
require(
    set(ids[::-1][reversed_hysteretic].tolist()) == {3, 55, 66},
    "hysteretic membership depends on row or previous-membership order",
)
tied_coefficients = np.zeros_like(coefficients)
tied_coefficients[:, 0] = 1.0
tied_a = MODULE.select_optical_hysteresis(ids, tied_coefficients, 3, ids[optical], hysteresis_ratio=0.1)
tied_b = MODULE.select_optical_hysteresis(ids[::-1], tied_coefficients[::-1], 3, ids[optical][::-1], hysteresis_ratio=0.1)
require(set(ids[tied_a].tolist()) == set(ids[::-1][tied_b].tolist()), "exact-score hysteretic ties depend on row order")
clear_replacement_coefficients = near_boundary_coefficients.copy()
clear_replacement_coefficients[ids == 7, 0] = 12.0
clear_replacement_coefficients[ids == 66, 0] = 0.05
clear_replacement_coefficients[ids == 66, 3] = 0.0
replaced = MODULE.select_optical_hysteresis(
    ids,
    clear_replacement_coefficients,
    3,
    ids[optical],
    hysteresis_ratio=0.1,
)
require(
    set(ids[replaced].tolist()) == {3, 7, 55},
    "hysteretic selector retained a stale member after a clear causal-score replacement",
)
missing_previous = MODULE.select_optical_hysteresis(
    ids[ids != 66],
    near_boundary_coefficients[ids != 66],
    3,
    ids[optical],
    hysteresis_ratio=0.1,
)
require(66 not in set(ids[ids != 66][missing_previous].tolist()), "hysteretic selector retained a node absent from the current state")

selections = MODULE.fixed_budget_selections(
    ids,
    coefficients,
    0.375,
    previous_optical_ids=ids[optical],
    hysteresis_ratio=0.1,
)
require(
    set(selections) == {"stable-uniform", "optical-energy", "optical-hysteresis"},
    "fixed-budget arms drifted",
)
require({rows.size for rows in selections.values()} == {3}, "fixed-budget arms do not spend identical candidate counts")
require(MODULE.DEPOSITS_PER_CANDIDATE == 20, "deposit budget no longer matches five taps times four bilinear neighbors")
require(
    MODULE.actual_deposit_count(np.asarray([20, 19, 20], dtype=np.int16)) == 59,
    "actual deposit accounting silently substituted the nominal maximum",
)

expanded_ids = np.concatenate((ids, np.asarray([202, 303], dtype=np.uint32)))
expanded_coefficients = np.pad(coefficients, ((0, 2), (0, 0)))
anchored = MODULE.fixed_budget_selections(
    expanded_ids,
    expanded_coefficients,
    0.375,
    candidate_budget=3,
    previous_optical_ids=ids[optical],
    hysteresis_ratio=0.1,
)
require(
    {rows.size for rows in anchored.values()} == {3},
    "adjacent states silently changed the absolute candidate/deposit budget with population",
)

previous = {
    "ids": np.asarray([3, 7, 42], dtype=np.uint32),
    "placements": np.zeros((3, 5, 2), dtype=np.float32),
    "multiplicity": np.full(3, 20, dtype=np.int16),
    "target": np.zeros((2, 2, 3), dtype=np.uint8),
    "render": np.zeros((2, 2, 3), dtype=np.uint8),
    "steps": 10,
    "stateId": "state-010",
}
current = {
    "ids": np.asarray([3, 42, 55], dtype=np.uint32),
    "placements": np.ones((3, 5, 2), dtype=np.float32),
    "multiplicity": np.asarray([20, 19, 20], dtype=np.int16),
    "target": np.ones((2, 2, 3), dtype=np.uint8),
    "render": np.ones((2, 2, 3), dtype=np.uint8),
    "steps": 12,
    "stateId": "state-012",
}
motion = MODULE.adjacent_motion_receipt(previous, current)
require(set(motion) >= {
    "nodeIdentityTurnover",
    "multiplicityChurn",
    "placementVelocity",
    "adjacentFramePixelDiffs",
}, "positive budget arms can evade the four-part adjacent-state gate")

valid_manifest = {
    "schema": MODULE.MANIFEST_SCHEMA,
    "sequence": {"sampleCap": None, "droppedRowCount": 0},
}
valid_motion_report = {
    "schema": MODULE.MOTION_REPORT_SCHEMA,
    "status": "complete",
    "source": {"manifestSha256": "manifest-sha"},
}
MODULE.validate_source_contract(valid_manifest, valid_motion_report, "manifest-sha")
for mutation, reason in (
    ({"sequence": {"sampleCap": 1000, "droppedRowCount": 0}}, "hidden sample cap"),
    ({"sequence": {"sampleCap": None, "droppedRowCount": 1}}, "dropped candidates"),
):
    candidate = dict(valid_manifest)
    candidate.update(mutation)
    try:
        MODULE.validate_source_contract(candidate, valid_motion_report, "manifest-sha")
    except ValueError:
        pass
    else:
        raise AssertionError(f"source validation accepted {reason}")
stale_report = dict(valid_motion_report)
stale_report["source"] = {"manifestSha256": "stale-sha"}
try:
    MODULE.validate_source_contract(valid_manifest, stale_report, "manifest-sha")
except ValueError:
    pass
else:
    raise AssertionError("source validation accepted a stale motion report")

with tempfile.TemporaryDirectory() as temporary:
    source_path = Path(temporary) / "source.json"
    original_bytes = b'{"identity":"original"}'
    source_path.write_bytes(original_bytes)
    payload, binding = MODULE.load_json_binding(source_path)
    require(payload == {"identity": "original"}, "bound JSON payload drifted")
    require(binding == hashlib.sha256(original_bytes).hexdigest(), "bound JSON digest was not computed from parsed bytes")
    source_path.write_text('{"identity":"replacement"}')
    try:
        MODULE.require_unchanged_binding(source_path, binding)
    except ValueError:
        pass
    else:
        raise AssertionError("source replacement after parse escaped the immutable binding gate")

require(MODULE.IMPLEMENTATION_PATH == MODULE_PATH, "implementation provenance binds the wrong script path")
require(MODULE.implementation_bundle_receipt()["sha256"] == IMPLEMENTATION_BUNDLE_SHA256, "implementation bundle provenance drifted")

with tempfile.TemporaryDirectory() as temporary:
    manifest_path = Path(temporary) / "manifest.json"
    motion_path = Path(temporary) / "motion.json"
    manifest_path.write_text("{}")
    motion_path.write_text("{}")
    report_path = Path(temporary) / "invalid-source.json"
    environment = dict(os.environ)
    environment["KAMINOS_BUDGET_ORACLE_FAIL_RUNTIME_INIT"] = "1"
    result = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--manifest", str(manifest_path),
        "--motion-report", str(motion_path),
        "--out-dir", str(Path(temporary) / "out"),
        "--report", str(report_path),
        "--implementation-bundle-sha256", IMPLEMENTATION_BUNDLE_SHA256,
    ], check=False, capture_output=True, text=True, env=environment)
    require(result.returncode != 0, "malformed source falsely succeeded")
    failure = json.loads(report_path.read_text())
    require(failure.get("failurePhase") == "source-validation", "malformed source was masked by runtime initialization")

with tempfile.TemporaryDirectory() as temporary:
    manifest_path = Path(temporary) / "manifest.json"
    motion_path = Path(temporary) / "motion.json"
    manifest_path.write_text(json.dumps(valid_manifest))
    manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    runtime_motion_report = dict(valid_motion_report)
    runtime_motion_report["source"] = {"manifestSha256": manifest_sha256}
    motion_path.write_text(json.dumps(runtime_motion_report))
    report_path = Path(temporary) / "runtime-failure.json"
    environment = dict(os.environ)
    environment["KAMINOS_BUDGET_ORACLE_FAIL_RUNTIME_INIT"] = "1"
    result = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--manifest", str(manifest_path),
        "--motion-report", str(motion_path),
        "--out-dir", str(Path(temporary) / "out"),
        "--report", str(report_path),
        "--implementation-bundle-sha256", IMPLEMENTATION_BUNDLE_SHA256,
    ], check=False, capture_output=True, text=True, env=environment)
    require(result.returncode != 0, "forced runtime initialization failure falsely succeeded")
    require(report_path.is_file(), "runtime initialization failure did not write a durable report")
    failure = json.loads(report_path.read_text())
    require(failure.get("failurePhase") == "runtime-initialization", "runtime initialization failure phase drifted")

with tempfile.TemporaryDirectory() as temporary:
    report_path = Path(temporary) / "failure.json"
    result = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--manifest", str(Path(temporary) / "missing-manifest.json"),
        "--motion-report", str(Path(temporary) / "missing-motion.json"),
        "--out-dir", str(Path(temporary) / "out"),
        "--report", str(report_path),
        "--implementation-bundle-sha256", IMPLEMENTATION_BUNDLE_SHA256,
    ], check=False, capture_output=True, text=True)
    require(result.returncode != 0, "missing source artifacts falsely succeeded")
    require(report_path.is_file(), "pre-artifact failure did not write a durable report")
    failure = json.loads(report_path.read_text())
    require(failure.get("status") == "failed", "durable failure report status drifted")
    require(failure.get("failurePhase") == "source-validation", "durable failure phase drifted")

print("volume layer coefficient budget oracle contracts passed")
