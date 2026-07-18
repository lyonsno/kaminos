#!/usr/bin/env python3
"""Dependency-light contracts for externally bound oracle provenance."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-budget-oracle.py"
SPEC = importlib.util.spec_from_file_location("kaminos_budget_oracle_provenance", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ACTUAL_RECEIPT = MODULE.implementation_bundle_receipt()
ACTUAL_SHA256 = ACTUAL_RECEIPT["sha256"]
WRONG_SHA256 = "0" * 64 if ACTUAL_SHA256 != "0" * 64 else "1" * 64

assert set(ACTUAL_RECEIPT["files"]) == set(MODULE.IMPLEMENTATION_FILENAMES), "implementation bundle omitted a runtime dependency"
assert all((ROOT / filename).is_file() for filename in MODULE.IMPLEMENTATION_FILENAMES), "implementation bundle names a missing runtime dependency"

MODULE.BOUND_IMPLEMENTATION_PAYLOADS = {"synthetic-runtime.py": b"VALUE = 17\n"}
synthetic = MODULE.load_module("synthetic-runtime.py", "kaminos_bound_synthetic_runtime")
assert synthetic.VALUE == 17, "runtime dependency loader reread mutable filesystem state instead of bound bundle bytes"
MODULE.BOUND_IMPLEMENTATION_PAYLOADS = None

render_filename = "volume-layer-coefficient-render-oracle.py"
motion_filename = "volume-layer-coefficient-bilinear-motion-render.py"
pil_module = types.ModuleType("PIL")
image_module = types.ModuleType("PIL.Image")
pil_module.Image = image_module
try:
    MODULE.BOUND_IMPLEMENTATION_PAYLOADS = {
        render_filename: (ROOT / render_filename).read_bytes(),
        motion_filename: (ROOT / motion_filename).read_bytes(),
    }
    with mock.patch.dict(sys.modules, {"PIL": pil_module, "PIL.Image": image_module}):
        MODULE.ORACLE = MODULE.load_module(render_filename, "kaminos_bound_nested_render")
        with mock.patch.object(
            importlib.util,
            "spec_from_file_location",
            side_effect=AssertionError("nested runtime dependency reread mutable filesystem state"),
        ):
            nested_motion = MODULE.load_module(motion_filename, "kaminos_bound_nested_motion")
    assert nested_motion.ORACLE is MODULE.ORACLE, "bound real motion runtime did not consume the already-bound render oracle"
finally:
    MODULE.BOUND_IMPLEMENTATION_PAYLOADS = None
    MODULE.ORACLE = None


with tempfile.TemporaryDirectory() as temporary:
    report_path = Path(temporary) / "binding-failure.json"
    result = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "--manifest",
            str(Path(temporary) / "missing-manifest.json"),
            "--motion-report",
            str(Path(temporary) / "missing-motion.json"),
            "--out-dir",
            str(Path(temporary) / "out"),
            "--report",
            str(report_path),
            "--implementation-bundle-sha256",
            WRONG_SHA256,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0, "mismatched implementation binding falsely succeeded"
    assert report_path.is_file(), "implementation binding failure did not write a durable report"
    failure = json.loads(report_path.read_text())
    assert failure.get("failurePhase") == "implementation-binding", "implementation binding failure phase drifted"
    evidence = failure.get("lastTrustworthyEvidence") or {}
    assert evidence.get("implementationBundleSha256Expected") == WRONG_SHA256, "failure report lost the externally bound bundle digest"
    assert evidence.get("implementationBundleAtStart", {}).get("sha256") == ACTUAL_SHA256, "failure report lost the observed launch bundle digest"
    assert evidence.get("implementationBundleAtFailure", {}).get("sha256") == ACTUAL_SHA256, "failure report lost the failure-time bundle digest"
    assert evidence.get("implementationBundleAtStart", {}).get("files") == ACTUAL_RECEIPT["files"], "failure report lost per-file launch provenance"

print("volume layer coefficient provenance contracts passed")
