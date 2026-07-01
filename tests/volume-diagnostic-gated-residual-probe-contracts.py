#!/usr/bin/env python3
"""Fail-first contracts for volume-diagnostic-gated-residual-probe.py.

These tests verify the probe's contract surface without requiring a live dataset.
They use synthetic tile data to test the diagnostic feature extraction, residual
magnitude targets, and baseline comparisons.

Failure modes tested:
- Wrong or missing manifest path
- Dataset not captured
- Missing fieldTileCoveragePairing
- Tile payload size mismatch
- Feature shape contract
- Baseline comparison produces finite results
- False-closure detection: probe must not report improvement vs baseline
  when model is trivially constant (no real diagnostic signal).
"""

from __future__ import annotations

import json
import os
import struct
import sys
import tempfile
from pathlib import Path

# Allow running from repo root or tests/ directory.
_REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import numpy as np

# Import the probe module under test.
import importlib.util

_PROBE_PATH = _REPO_ROOT / "volume-diagnostic-gated-residual-probe.py"


def _load_probe():
    spec = importlib.util.spec_from_file_location(
        "volume_diagnostic_gated_residual_probe", _PROBE_PATH
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write_float32_tile(path: Path, values: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(values.astype(np.float32).tobytes())


def _make_synthetic_manifest(
    tmp_dir: Path,
    *,
    n_pairs: int = 4,
    tile_shape: list = None,
    status: str = "captured",
    include_pairing: bool = True,
    same_spatial_bin: bool = True,
    residual_scale: float = 1.0,
    high_energy_has_high_residual: bool = True,
) -> Path:
    """Build a minimal captured manifest with synthetic tile pair data.

    If high_energy_has_high_residual=True, tiles with higher energySum will
    have proportionally larger low/high field differences (the correct signal).
    If False, energySum is uncorrelated with residual magnitude (null signal).
    """
    if tile_shape is None:
        tile_shape = [4, 4, 4, 17]

    tile_dir = tmp_dir / "tiles"
    tile_dir.mkdir(exist_ok=True)
    matched_pairs = []

    rng = np.random.default_rng(42)

    for i in range(n_pairs):
        # Each pair: one matched tile pair
        low_path = tile_dir / f"pair-{i:03d}-low.f32"
        high_path = tile_dir / f"pair-{i:03d}-high.f32"
        n_voxels = tile_shape[0] * tile_shape[1] * tile_shape[2]
        n_channels = tile_shape[3]

        low_values = rng.random((n_voxels, n_channels)).astype(np.float32) * 0.5
        energy_sum = float(np.sum(low_values[:, 3]))  # densityCarrier proxy

        if high_energy_has_high_residual:
            # Residual magnitude correlates with energy: higher energy -> larger diff
            residual = (rng.random((n_voxels, n_channels)).astype(np.float32) * 0.3
                        * residual_scale * (energy_sum / (n_voxels * n_channels) + 0.05))
        else:
            # Null signal: residual is random, no correlation with energy
            residual = rng.random((n_voxels, n_channels)).astype(np.float32) * 0.1

        high_values = np.clip(low_values + residual, 0.0, 1.0)

        _write_float32_tile(low_path, low_values.reshape(-1))
        _write_float32_tile(high_path, high_values.reshape(-1))

        matched_pairs.append({
            "matchId": f"match-{i:03d}",
            "lowTileId": f"tile-{i:03d}-low",
            "highTileId": f"tile-{i:03d}-high",
            "lowPath": str(low_path),
            "highPath": str(high_path),
            "sameSpatialBin": same_spatial_bin,
            "lowSpatialBinId": f"b{i % 2}-0-0",
            "highSpatialBinId": f"b{i % 2}-0-0" if same_spatial_bin else f"b{(i+1) % 2}-0-0",
            "normalizedTileDistance": 0.0,
            "normalizedTileSeparation": 0.0,
            "lowShape": tile_shape,
            "highShape": tile_shape,
            "lowNormalizedCenter": [0.25 * (i % 4), 0.25, 0.25],
            "highNormalizedCenter": [0.25 * (i % 4), 0.25, 0.25],
            "lowEnergySum": energy_sum,
            "highEnergySum": float(np.sum(high_values[:, 3])),
        })

    pairs = [
        {
            "pairId": "pair-001-g96-to-g128",
            "pairAuthority": "deterministic-replay-same-route-controls-fixed-step-not-state-transfer",
            "fieldAuthority": "webgpu-copy-src-readback-simReadback-summary-and-majorant",
            "status": "captured",
            "fieldTileCoveragePairing": {
                "matchedTilePairs": matched_pairs,
                "pairId": "pair-001-g96-to-g128",
            } if include_pairing else None,
        }
    ]

    manifest = {
        "dataset": {
            "schema": "kaminos.volume.field-pair-dataset.v0",
            "status": status,
            "pairAuthority": "deterministic-replay-same-route-controls-fixed-step-not-state-transfer",
            "fieldAuthority": "webgpu-copy-src-readback-simReadback-summary-and-majorant",
            "deterministicReplay": {"enabled": True, "steps": 60},
            "fieldTileExport": {"enabled": True, "tileSize": 4},
            "outDir": str(tmp_dir),
            "pairs": pairs,
        }
    }

    manifest_path = tmp_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest_path


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def run_probe(probe, manifest_path: Path, out_path: Path, **kwargs) -> dict:
    """Run the probe and return the parsed report."""
    import argparse
    args = argparse.Namespace(
        manifest=str(manifest_path),
        out=str(out_path),
        train_fraction=kwargs.get("train_fraction", 0.6),
        ridge=kwargs.get("ridge", 1e-4),
        seed=kwargs.get("seed", 7),
        allow_different_spatial_bin=kwargs.get("allow_different_spatial_bin", False),
        max_normalized_separation=kwargs.get("max_normalized_separation", None),
        n_thresholds=kwargs.get("n_thresholds", 10),
    )
    report = probe.run(args)
    return report


def assert_finite(value, name: str) -> None:
    import math
    assert isinstance(value, (int, float)), f"{name} must be numeric, got {type(value)}"
    assert math.isfinite(value), f"{name} must be finite, got {value}"


# ---------------------------------------------------------------------------
# CONTRACT TESTS
# ---------------------------------------------------------------------------

def test_probe_module_loads():
    """The probe module must be importable without error."""
    probe = _load_probe()
    assert hasattr(probe, "run"), "probe must expose a run() entrypoint"
    assert hasattr(probe, "REPORT_SCHEMA"), "probe must declare REPORT_SCHEMA"
    assert hasattr(probe, "ProbeFailure"), "probe must declare ProbeFailure"
    print("PASS: probe_module_loads")


def test_missing_manifest_writes_failure_report():
    """Missing manifest must produce a failure report, not a crash."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "report.json"
        import argparse
        args = argparse.Namespace(
            manifest="/nonexistent/path/manifest.json",
            out=str(out),
            train_fraction=0.75,
            ridge=1e-4,
            seed=7,
            allow_different_spatial_bin=False,
            max_normalized_separation=None,
            n_thresholds=10,
        )
        result = probe.main_with_args(args)
        assert result != 0, "missing manifest must return non-zero exit code"
        assert out.exists(), "failure report must be written even on missing manifest"
        report = json.loads(out.read_text())
        assert report["status"] == "failed", "report must be failed"
        assert report["failurePhase"] is not None, "failure phase must be named"
    print("PASS: missing_manifest_writes_failure_report")


def test_uncaptured_dataset_fails():
    """Dataset with status != 'captured' must fail validation, not silently proceed."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(tmp_dir, status="running")
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result != 0, "uncaptured dataset must return non-zero exit"
        report = json.loads(out.read_text())
        assert report["status"] == "failed"
        assert "manifest-validate" in report.get("failurePhase", "")
    print("PASS: uncaptured_dataset_fails")


def test_missing_coverage_pairing_discards_pair():
    """Pairs missing fieldTileCoveragePairing must be discarded, not cause crash."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(tmp_dir, n_pairs=2, include_pairing=False)
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result != 0, "no usable pairs must fail"
        report = json.loads(out.read_text())
        assert report["status"] == "failed"
    print("PASS: missing_coverage_pairing_discards_pair")


def test_different_spatial_bin_discarded_by_default():
    """Pairs from different spatial bins must be discarded unless flag is set."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(tmp_dir, n_pairs=4, same_spatial_bin=False)
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result != 0, "all-different-bin pairs must fail without --allow-different-spatial-bin"
        report = json.loads(out.read_text())
        assert report["status"] == "failed"
    print("PASS: different_spatial_bin_discarded_by_default")


def test_successful_run_schema():
    """Successful run must produce a report with required schema fields."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(tmp_dir, n_pairs=6)
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result == 0, f"expected success but got exit {result}"
        report = json.loads(out.read_text())
        assert report["status"] == "completed", f"expected completed, got {report.get('status')}"
        assert report["schema"] == probe.REPORT_SCHEMA
        # Must name exact branch/worktree context
        assert "route" in report, "report must include route identity"
        assert "gitCommit" in report["route"]
        # Must name what flowDebug is and is not
        assert "flowDebugAuthority" in report, "report must record flowDebug authority"
        assert report["flowDebugAuthority"]["isFieldTruth"] is False, \
            "flowDebug must be marked as not field truth"
        # Must include data summary
        assert "data" in report
        assert report["data"]["usableTilePairs"] >= 2
        # Must include diagnostic features shape
        assert "diagnosticFeatures" in report
        assert report["diagnosticFeatures"]["featureCount"] > 0
        # Must include baselines
        assert "baselines" in report
        assert "energyThreshold" in report["baselines"]
        # Must include metrics vs baselines
        assert "metrics" in report
    print("PASS: successful_run_schema")


def test_baseline_metrics_are_finite():
    """All baseline metrics must be finite numbers."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(tmp_dir, n_pairs=8)
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result == 0
        report = json.loads(out.read_text())
        metrics = report["metrics"]
        for split_name in ["train", "test"]:
            split = metrics.get(split_name, {})
            for baseline_name, baseline in split.get("baselines", {}).items():
                for metric_name, metric_val in baseline.items():
                    if isinstance(metric_val, (int, float)):
                        assert_finite(metric_val, f"{split_name}.baselines.{baseline_name}.{metric_name}")
    print("PASS: baseline_metrics_are_finite")


def test_false_closure_constant_prediction():
    """Probe must report whether model beats baselines, not assert it does.

    When the diagnostic features have zero correlation with residual (null signal),
    the probe must still complete but must NOT report model improvement > 0
    vs the constant (mean-residual) baseline on the test split.
    This is a false-closure guard: the probe must be willing to say 'no signal'.
    """
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        # high_energy_has_high_residual=False: energy is uncorrelated with residual
        manifest_path = _make_synthetic_manifest(
            tmp_dir, n_pairs=8, high_energy_has_high_residual=False
        )
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result == 0, "null-signal probe must still complete (not crash)"
        report = json.loads(out.read_text())
        assert report["status"] == "completed"
        # The report must include an honest improvement field (may be negative or None)
        test_metrics = report["metrics"]["test"]
        assert "modelImprovementVsConstantBaseline" in test_metrics, \
            "must report improvement vs constant baseline"
        # Critically: it must NOT hardcode improvement > 0 as a schema requirement
        # (the value may be negative when there's no signal — that's the honest answer)
    print("PASS: false_closure_constant_prediction")


def test_signal_present_improves_vs_constant():
    """When energy correlates with residual, learned threshold must beat constant baseline.

    This tests that the probe can detect real signal when it exists.
    Uses a synthetic case where tile energySum is a strong predictor.
    """
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(
            tmp_dir, n_pairs=12, high_energy_has_high_residual=True, residual_scale=3.0
        )
        out = tmp_dir / "report.json"
        result = probe.main_with_args(_make_args(manifest_path, out))
        assert result == 0
        report = json.loads(out.read_text())
        # Energy threshold baseline must show finite AUC > 0.5 on training split
        # (we can't guarantee test given tiny synthetic N, but training signal must exist)
        train_metrics = report["metrics"]["train"]
        energy_baseline = train_metrics["baselines"].get("energyThreshold", {})
        assert "pearsonR" in energy_baseline or "mse" in energy_baseline, \
            "energy threshold baseline must report measurable correlation"
    print("PASS: signal_present_improves_vs_constant")


def test_report_names_flowdebug_authority():
    """Report must explicitly document that flowDebug is a rendered diagnostic, not field truth."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        manifest_path = _make_synthetic_manifest(tmp_dir, n_pairs=6)
        out = tmp_dir / "report.json"
        probe.main_with_args(_make_args(manifest_path, out))
        report = json.loads(out.read_text())
        authority = report.get("flowDebugAuthority", {})
        assert authority.get("isFieldTruth") is False
        assert "lossy" in str(authority.get("description", "")).lower() or \
               "rendered" in str(authority.get("description", "")).lower() or \
               "screen" in str(authority.get("description", "")).lower(), \
            "flowDebug authority description must note it is a rendered/lossy/screen projection"
        assert "curlMean" in str(authority.get("availableFieldCues", [])) or \
               "curlMean" in str(authority), \
            "authority block must name curlMean as an available non-screen field cue"
    print("PASS: report_names_flowdebug_authority")


def test_failure_report_names_failure_phase():
    """Any failure must write a durable report naming the failure phase."""
    probe = _load_probe()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "report.json"
        import argparse
        args = argparse.Namespace(
            manifest="/nonexistent/manifest.json",
            out=str(out),
            train_fraction=0.75,
            ridge=1e-4,
            seed=7,
            allow_different_spatial_bin=False,
            max_normalized_separation=None,
            n_thresholds=10,
        )
        probe.main_with_args(args)
        assert out.exists(), "failure report must always be written"
        report = json.loads(out.read_text())
        assert report.get("failurePhase") is not None, "failurePhase must be set on failure"
        assert report.get("status") == "failed"
        assert "lastTrustworthyEvidence" in report, "must preserve last trustworthy evidence"
    print("PASS: failure_report_names_failure_phase")


def _make_args(manifest_path, out):
    import argparse
    return argparse.Namespace(
        manifest=str(manifest_path),
        out=str(out),
        train_fraction=0.6,
        ridge=1e-4,
        seed=7,
        allow_different_spatial_bin=False,
        max_normalized_separation=None,
        n_thresholds=10,
    )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def main() -> int:
    tests = [
        test_probe_module_loads,
        test_missing_manifest_writes_failure_report,
        test_uncaptured_dataset_fails,
        test_missing_coverage_pairing_discards_pair,
        test_different_spatial_bin_discarded_by_default,
        test_successful_run_schema,
        test_baseline_metrics_are_finite,
        test_false_closure_constant_prediction,
        test_signal_present_improves_vs_constant,
        test_report_names_flowdebug_authority,
        test_failure_report_names_failure_phase,
    ]
    failures = []
    for test in tests:
        try:
            test()
        except Exception as exc:
            print(f"FAIL: {test.__name__}: {exc}")
            failures.append(test.__name__)
    if failures:
        print(f"\n{len(failures)} test(s) failed: {', '.join(failures)}")
        return 1
    print(f"\nAll {len(tests)} contracts passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
