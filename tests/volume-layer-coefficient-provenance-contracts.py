#!/usr/bin/env python3
"""Dependency-light contracts for externally bound oracle provenance."""

from __future__ import annotations

import importlib.util
import hashlib
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

viewer = MODULE.selection_viewer([], [], {
    "status": "complete",
    "manifestSha256": "a" * 64,
    "motionReportSha256": "b" * 64,
    "implementationBundleSha256": "c" * 64,
})
assert "evidenceIdentity" in viewer and '"status":"complete"' in viewer, "viewer omitted evidence status"
assert "aaaaaaaaaaaa" in viewer and "bbbbbbbbbbbb" in viewer and "cccccccccccc" in viewer, "viewer omitted bound source identities"

MODULE.BOUND_IMPLEMENTATION_PAYLOADS = {"synthetic-runtime.py": b"VALUE = 17\n"}
synthetic = MODULE.load_module("synthetic-runtime.py", "kaminos_bound_synthetic_runtime")
assert synthetic.VALUE == 17, "runtime dependency loader reread mutable filesystem state instead of bound bundle bytes"
MODULE.BOUND_IMPLEMENTATION_PAYLOADS = None

bound_payloads = {
    filename: (ROOT / filename).read_bytes()
    for filename in MODULE.IMPLEMENTATION_FILENAMES
}
bound_payloads[MODULE_PATH.name] += b"\nBOUND_EXECUTION_TEST_MARKER = 'captured-budget-bytes'\n"
bound_budget = MODULE.load_bound_budget_module(bound_payloads)
assert bound_budget.BOUND_EXECUTION_TEST_MARKER == "captured-budget-bytes", "top-level oracle did not execute captured budget bytes"
assert bound_budget.BOUND_IMPLEMENTATION_PAYLOADS is bound_payloads, "bound top-level oracle lost its runtime payload binding"
with mock.patch.object(Path, "read_bytes", side_effect=AssertionError("bound receipt reread mutable source files")):
    bound_receipt, rebound_payloads = bound_budget.capture_implementation_bundle()
assert rebound_payloads is bound_payloads, "bound receipt copied or replaced the executing payload map"
assert bound_receipt["payloadSource"] == "captured-bound-execution", "bound receipt hid its execution source"

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

with tempfile.TemporaryDirectory() as temporary:
    output_dir = Path(temporary) / "out"
    states_dir = output_dir / "states"
    states_dir.mkdir(parents=True)
    stale_viewer = output_dir / "selection-viewer.html"
    stale_image = states_dir / "stale-render.png"
    unrelated_output = output_dir / "operator-note.txt"
    stale_viewer.write_text("stale authoritative viewer")
    stale_image.write_bytes(b"stale image")
    unrelated_output.write_text("preserve me")
    report_path = Path(temporary) / "failed-rerun.json"
    result = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "--manifest",
            str(Path(temporary) / "missing-manifest.json"),
            "--motion-report",
            str(Path(temporary) / "missing-motion.json"),
            "--out-dir",
            str(output_dir),
            "--report",
            str(report_path),
            "--implementation-bundle-sha256",
            ACTUAL_SHA256,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0, "missing source rerun falsely succeeded"
    assert not stale_viewer.exists(), "failed rerun left a stale viewer looking current"
    assert not stale_image.exists(), "failed rerun left stale state imagery looking current"
    assert unrelated_output.read_text() == "preserve me", "stale-output cleanup removed unrelated output state"
    failure = json.loads(report_path.read_text())
    assert failure.get("failurePhase") == "source-validation", "stale-output failure phase drifted"

with tempfile.TemporaryDirectory() as temporary:
    output_dir = Path(temporary) / "out"
    output_dir.mkdir()
    stale_viewer = output_dir / "selection-viewer.html"
    stale_viewer.write_text("stale authoritative viewer")
    report_path = Path(temporary) / "cleanup-failure.json"
    argv = [
        str(MODULE_PATH),
        "--manifest", str(Path(temporary) / "missing-manifest.json"),
        "--motion-report", str(Path(temporary) / "missing-motion.json"),
        "--out-dir", str(output_dir),
        "--report", str(report_path),
        "--implementation-bundle-sha256", ACTUAL_SHA256,
    ]
    with mock.patch.object(sys, "argv", argv), mock.patch.object(
        MODULE,
        "invalidate_visual_evidence",
        side_effect=OSError("forced cleanup failure"),
    ):
        try:
            result = MODULE.main()
        except OSError:
            result = 1
    assert result != 0, "cleanup failure falsely succeeded"
    assert report_path.is_file(), "cleanup failure escaped without a durable failure report"
    assert "stale authoritative viewer" not in stale_viewer.read_text(), "cleanup failure left a stale viewer looking current"
    cleanup_failure = json.loads(report_path.read_text())
    assert cleanup_failure.get("failurePhase") == "visual-evidence-invalidation", "cleanup failure phase drifted"

with tempfile.TemporaryDirectory() as temporary:
    output_dir = Path(temporary) / "out"
    manifest_path = Path(temporary) / "manifest.json"
    motion_path = Path(temporary) / "motion.json"
    manifest_path.write_text(json.dumps({
        "schema": MODULE.MANIFEST_SCHEMA,
        "sequence": {"sampleCap": None, "droppedRowCount": 0},
    }))
    manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    motion_path.write_text(json.dumps({
        "schema": MODULE.MOTION_REPORT_SCHEMA,
        "status": "complete",
        "source": {"manifestSha256": manifest_sha256},
    }))
    report_path = Path(temporary) / "late-failure.json"
    stale_viewer = output_dir / "selection-viewer.html"

    def fail_after_viewer(*_args, **_kwargs):
        output_dir.mkdir(parents=True, exist_ok=True)
        stale_viewer.write_text('evidenceIdentity={"status":"complete"}')
        raise RuntimeError("forced post-viewer failure")

    argv = [
        str(MODULE_PATH),
        "--manifest", str(manifest_path),
        "--motion-report", str(motion_path),
        "--out-dir", str(output_dir),
        "--report", str(report_path),
        "--implementation-bundle-sha256", ACTUAL_SHA256,
    ]
    MODULE.BOUND_IMPLEMENTATION_PAYLOADS = None
    with mock.patch.object(sys, "argv", argv), mock.patch.object(MODULE, "initialize_runtime"), mock.patch.object(
        MODULE,
        "run",
        side_effect=fail_after_viewer,
    ):
        result = MODULE.main()
    MODULE.BOUND_IMPLEMENTATION_PAYLOADS = None
    assert result != 0, "post-viewer failure falsely succeeded"
    assert report_path.is_file(), "post-viewer failure escaped without a durable failure report"
    assert not stale_viewer.exists() or '"status":"complete"' not in stale_viewer.read_text(), "post-viewer failure left a complete-stamped viewer"
    late_failure = json.loads(report_path.read_text())
    assert late_failure.get("status") == "failed", "post-viewer failure report hid failure status"

print("volume layer coefficient provenance contracts passed")
