#!/usr/bin/env python3
"""Contracts for fixed-count persistent Grid16 optical-mode continuation."""

from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
FITTER_PATH = ROOT / "volume-multiscale-fitting-sequence.py"
SCRIPT_PATH = ROOT / "volume-grid16-persistent-continuation.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def fixture(fitter):
    source_grid = 4
    target_grid = 2
    native_ids = np.arange(source_grid**3, dtype=np.uint32)
    cells = np.stack(
        (
            native_ids % source_grid,
            (native_ids // source_grid) % source_grid,
            native_ids // (source_grid * source_grid),
        ),
        axis=1,
    ).astype(np.float64)
    positions = -1.0 + (cells + 0.5) * 0.5
    source_coefficients = np.zeros((native_ids.size, 8), dtype=np.float64)
    source_coefficients[:, 0] = 0.5 + cells[:, 0]
    source_coefficients[:, 1] = 0.2 + 0.1 * cells[:, 1]
    source_coefficients[:, 3] = 0.1 + 0.05 * cells[:, 2]
    target_coefficients = source_coefficients.copy()
    target_coefficients[:, 0] *= 1.0 + 0.08 * (cells[:, 1] - 1.5)
    target_coefficients[:, 3] *= 1.0 + 0.04 * (cells[:, 0] - 1.5)
    source = fitter.restrict_selected_optical_medium(
        native_ids,
        positions,
        source_coefficients,
        source_grid=source_grid,
        target_grid=target_grid,
        population="ridge",
    )
    target = fitter.restrict_selected_optical_medium(
        native_ids,
        positions,
        target_coefficients,
        source_grid=source_grid,
        target_grid=target_grid,
        population="ridge",
    )
    sequence = fitter.fit_optical_modes(
        source,
        primitive_count=3,
        iteration_count=1,
        soft_neighbors=2,
        temperature_cells=0.9,
        assignment_arm="soft-optics-exclusive-geometry",
    )
    velocities = np.stack(
        (
            0.02 + 0.01 * cells[:, 1],
            0.03 + 0.005 * cells[:, 2],
            -0.01 + 0.004 * cells[:, 0],
        ),
        axis=1,
    )
    return native_ids, source_coefficients, velocities, source, target, sequence[-1]


def exact_target_manifest(temporary: Path, fitter) -> Path:
    states = []
    for step in (118, 120):
        image_path = temporary / f"exact-{step}.png"
        image = np.random.default_rng(step).random((24, 32, 3))
        fitter.write_png(image_path, image)
        rgb = np.clip(np.round(image * 255.0), 0.0, 255.0).astype(np.uint8)
        rgba = np.concatenate((rgb, np.full((24, 32, 1), 255, dtype=np.uint8)), axis=2)
        states.append(
            {
                "id": f"coefficient-state-{step}",
                "replay": {
                    "completedSteps": step,
                    "grid": 96,
                    "effectiveRoute": "native-3d-compute-fluid-raymarch-v0",
                    "backend": "WebGPU:apple",
                },
                "target": {
                    "identity": "ridge-plus-non-ridge-contributions-under-shared-transmittance-v0",
                    "mode": "shared-transmittance-contribution-sum",
                    "path": str(image_path),
                    "bytes": image_path.stat().st_size,
                    "sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
                    "targetPixelSha256": hashlib.sha256(np.ascontiguousarray(rgba).tobytes()).hexdigest(),
                    "width": 32,
                    "height": 24,
                    "litPixels": 10,
                    "effectiveRaySteps": 160,
                    "cameraPoseSha256": "held-camera",
                    "appearanceReceipt": {
                        "effectiveMode": "shared-transmittance-contribution-sum",
                        "fallbackReason": None,
                        "passes": {"raymarchApplied": True, "splatsApplied": False},
                    },
                    "smokeReceipt": {"effectiveMode": "off", "fallbackReason": None},
                },
            }
        )
    manifest_path = temporary / "motion-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema": "kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0",
                "status": "complete",
                "authority": "single-browser-multi-state-exact-bilinear-motion-v0",
                "route": {
                    "effective": "native-3d-compute-fluid-raymarch-v0",
                    "backend": "WebGPU:apple",
                    "fallbackReason": None,
                },
                "states": states,
            }
        )
    )
    return manifest_path


def main() -> None:
    assert SCRIPT_PATH.is_file(), "persistent Grid16 continuation implementation is missing"
    implementation = SCRIPT_PATH.read_text()
    assert '"grid16ReferenceIsRestrictedMediumRaymarch": True' in implementation
    assert '"grid16CellEventTargetIsRaymarch": True' not in implementation
    assert '"grid16CellEventEwaControl"' in implementation
    assert '"fitterImplementationSha256"' in implementation
    fitter = load(FITTER_PATH, "grid16_sequence_fitter_contract")
    continuation = load(SCRIPT_PATH, "grid16_persistent_continuation_contract")
    native_ids, coefficients, velocities, source, target, seed = fixture(fitter)

    coarse_velocity, velocity_receipt = continuation.restrict_weighted_velocity(
        native_ids,
        coefficients,
        velocities,
        source,
    )
    assert coarse_velocity.shape == source.positions.shape
    assert velocity_receipt["sourceRowCount"] == native_ids.size
    assert velocity_receipt["restrictedCellCount"] == source.positions.shape[0]
    assert velocity_receipt["uncoveredRestrictedCellCount"] == 0

    mode_velocity, mode_velocity_receipt = continuation.aggregate_mode_velocity(
        source,
        seed,
        coarse_velocity,
        soft_neighbors=2,
        temperature_cells=0.9,
    )
    assert mode_velocity.shape == seed.positions.shape
    assert mode_velocity_receipt["modeCount"] == seed.mode_ids.size

    dt_seconds = 1.0 / 30.0
    common = dict(
        target_medium=target,
        seed_state=seed,
        mode_velocities=mode_velocity,
        dt_seconds=dt_seconds,
        soft_neighbors=2,
        temperature_cells=0.9,
        trust_radius_cells=0.5,
        covariance_relative_limit=0.25,
    )
    frozen, frozen_receipt = continuation.continue_optical_modes(arm="frozen", **common)
    advected, advected_receipt = continuation.continue_optical_modes(arm="advected", **common)
    corrected, corrected_receipt = continuation.continue_optical_modes(arm="advected-bounded-exclusive", **common)

    assert np.array_equal(frozen.mode_ids, seed.mode_ids)
    assert np.array_equal(advected.mode_ids, seed.mode_ids)
    assert np.array_equal(corrected.mode_ids, seed.mode_ids)
    assert np.array_equal(frozen.positions, seed.positions)
    assert np.array_equal(frozen.covariances, seed.covariances)
    assert np.allclose(advected.positions, seed.positions + mode_velocity * dt_seconds)
    assert np.array_equal(advected.covariances, seed.covariances)
    expected_mass = target.coefficients.sum(axis=0)
    for state in (frozen, advected, corrected):
        assert np.allclose(state.coefficients.sum(axis=0), expected_mass, rtol=1e-10, atol=1e-10)
        assert np.all(np.linalg.eigvalsh(state.covariances) > 0.0)
        assert state.mode_ids.size == seed.mode_ids.size

    predicted = seed.positions + mode_velocity * dt_seconds
    correction_distance = np.linalg.norm(corrected.positions - predicted, axis=1)
    assert np.max(correction_distance) <= np.mean(target.spacing) * 0.5 + 1e-12
    assert corrected_receipt["birthCount"] == 0
    assert corrected_receipt["deathCount"] == 0
    assert corrected_receipt["trustRegionClippedModeCount"] >= 0
    assert frozen_receipt["geometryPolicy"] == "seed-state-frozen"
    assert advected_receipt["geometryPolicy"] == "seed-state-velocity-advected"
    assert corrected_receipt["geometryPolicy"] == "advected-one-step-exclusive-trust-region"

    target_delta = np.asarray([0.2, -0.1, 0.3, -0.2], dtype=np.float64)
    aligned_delta = target_delta * 0.8
    opposed_delta = -target_delta
    assert continuation.signed_delta_alignment(aligned_delta, target_delta) > 0.999
    assert continuation.signed_delta_alignment(opposed_delta, target_delta) < -0.999

    with tempfile.TemporaryDirectory() as temporary_name:
        temporary = Path(temporary_name)
        tiny_path = temporary / "tiny.png"
        tiny = np.random.default_rng(7).random((32, 32, 3))
        fitter.write_png(tiny_path, tiny)
        decoded = continuation.read_png_rgb8(tiny_path)
        assert decoded.shape == tiny.shape
        assert np.allclose(decoded, np.round(tiny * 255.0) / 255.0)
        resized = continuation.resize_bilinear_rgb(decoded, 9, 12)
        assert resized.shape == (12, 9, 3)
        assert np.all(np.isfinite(resized)) and np.min(resized) >= 0.0 and np.max(resized) <= 1.0

        manifest_path = exact_target_manifest(temporary, fitter)
        targets = continuation.authenticate_exact_raymarch_targets(
            manifest_path,
            ("coefficient-state-118", "coefficient-state-120"),
        )
        assert tuple(targets) == ("coefficient-state-118", "coefficient-state-120")
        assert targets["coefficient-state-118"]["scope"] == "full-flame-product-motion-context"
        assert targets["coefficient-state-118"]["populationComparableToGrid16Ridge"] is False
        assert targets["coefficient-state-120"]["cameraPoseSha256"] == "held-camera"

        payload = json.loads(manifest_path.read_text())
        payload["states"][0]["target"]["litPixels"] = 0
        manifest_path.write_text(json.dumps(payload))
        try:
            continuation.authenticate_exact_raymarch_targets(
                manifest_path,
                ("coefficient-state-118", "coefficient-state-120"),
            )
        except continuation.FITTER.SequenceFailure as exc:
            assert "blank" in str(exc)
        else:
            raise AssertionError("blank exact target falsely authenticated")

        manifest_path = exact_target_manifest(temporary, fitter)
        payload = json.loads(manifest_path.read_text())
        payload["states"][0]["target"]["sha256"] = "0" * 64
        manifest_path.write_text(json.dumps(payload))
        try:
            continuation.authenticate_exact_raymarch_targets(
                manifest_path,
                ("coefficient-state-118", "coefficient-state-120"),
            )
        except continuation.FITTER.SequenceFailure as exc:
            assert "hash drifted" in str(exc)
        else:
            raise AssertionError("hash-drifted exact target falsely authenticated")

        manifest_path = exact_target_manifest(temporary, fitter)
        payload = json.loads(manifest_path.read_text())
        payload["states"][0]["target"]["targetPixelSha256"] = "0" * 64
        manifest_path.write_text(json.dumps(payload))
        try:
            continuation.authenticate_exact_raymarch_targets(
                manifest_path,
                ("coefficient-state-118", "coefficient-state-120"),
            )
        except continuation.FITTER.SequenceFailure as exc:
            assert "pixel hash drifted" in str(exc)
        else:
            raise AssertionError("pixel-hash-drifted exact target falsely authenticated")

        manifest_path = exact_target_manifest(temporary, fitter)
        payload = json.loads(manifest_path.read_text())
        payload["states"][0]["target"]["width"] = 33
        manifest_path.write_text(json.dumps(payload))
        try:
            continuation.authenticate_exact_raymarch_targets(
                manifest_path,
                ("coefficient-state-118", "coefficient-state-120"),
            )
        except continuation.FITTER.SequenceFailure as exc:
            assert "dimensions drifted" in str(exc)
        else:
            raise AssertionError("dimension-drifted exact target falsely authenticated")

        manifest_path = exact_target_manifest(temporary, fitter)
        payload = json.loads(manifest_path.read_text())
        payload["states"][0]["replay"]["completedSteps"] = 117
        manifest_path.write_text(json.dumps(payload))
        try:
            continuation.authenticate_exact_raymarch_targets(
                manifest_path,
                ("coefficient-state-118", "coefficient-state-120"),
            )
        except continuation.FITTER.SequenceFailure as exc:
            assert "replay step drifted" in str(exc)
        else:
            raise AssertionError("step-drifted exact target falsely authenticated")

        manifest_path = exact_target_manifest(temporary, fitter)
        viewer = continuation.temporal_toggle_html(
            {
                "grid16-raymarch-reference": {
                    "label": "Grid16 restricted-medium Raymarch reference",
                    "scope": "same-object-ground-truth",
                    "states": {"118": "grid16-raymarch-118.png", "120": "grid16-raymarch-120.png"},
                },
                "grid16-control": {
                    "label": "Grid16 cell-event EWA control",
                    "scope": "ridge-only-mechanistic-control",
                    "states": {"118": "control-118.png", "120": "control-120.png"},
                },
                "bounded-treatment": {
                    "label": "Persistent bounded treatment",
                    "scope": "ridge-only-reconstruction",
                    "states": {"118": "seed-118.png", "120": "bounded-120.png"},
                },
            },
            "report.json",
        )
        assert 'id="viewport-image"' in viewer
        assert 'data-state="118"' in viewer and 'data-state="120"' in viewer
        assert 'data-surface="grid16-raymarch-reference"' in viewer
        assert 'data-surface="grid16-control"' in viewer
        assert 'id="blink"' in viewer
        assert "setInterval" in viewer
        assert "URLSearchParams" in viewer
        assert "history.replaceState" in viewer
        assert "IMAGE LOAD FAILED" in viewer
        assert "Raymarch of the physically restricted Grid16 target is the reference" in viewer
        assert "dot-matrix EWA is a control" in viewer

        payload = json.loads(manifest_path.read_text())
        payload["route"]["fallbackReason"] = "silent-fallback"
        manifest_path.write_text(json.dumps(payload))
        try:
            continuation.authenticate_exact_raymarch_targets(
                manifest_path,
                ("coefficient-state-118", "coefficient-state-120"),
            )
        except continuation.FITTER.SequenceFailure as exc:
            assert "fallback" in str(exc)
        else:
            raise AssertionError("fallback exact-target route falsely authenticated")

    try:
        continuation.continue_optical_modes(arm="cold-refit", **common)
    except continuation.FITTER.SequenceFailure as exc:
        assert "continuation arm" in str(exc)
    else:
        raise AssertionError("unknown continuation arm falsely succeeded")

    with tempfile.TemporaryDirectory() as temporary:
        output = Path(temporary) / "failed"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--source-sequence",
                str(Path(temporary) / "missing-source.json"),
                "--target-sequence",
                str(Path(temporary) / "missing-target.json"),
                "--motion-manifest",
                str(Path(temporary) / "missing-motion.json"),
                "--mode-module",
                str(Path(temporary) / "missing-renderer.py"),
                "--output-dir",
                str(output),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0, "missing continuation sources falsely succeeded"
        report = json.loads((output / "report.json").read_text())
        assert report["status"] == "failed"
        assert report["failurePhase"] == "source-validation"
        assert report["requested"]["source_sequence"].endswith("missing-source.json")

    print("volume Grid16 persistent continuation contracts passed")


if __name__ == "__main__":
    main()
