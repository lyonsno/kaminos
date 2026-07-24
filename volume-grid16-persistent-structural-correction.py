#!/usr/bin/env python3
"""Test one bounded persistent Grid16 correction driven by signed source-space residual."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parent
FITTER_PATH = ROOT / "volume-multiscale-fitting-sequence.py"
PERSISTENT_PATH = ROOT / "volume-grid16-persistent-continuation.py"
RADIOMETRIC_PATH = ROOT / "volume-grid16-radiometric-unit-discriminator.py"
DEFAULT_MODE_MODULE = ROOT / "volume-grid96-off-lattice-optical-modes.py"
SCHEMA = "kaminos.grid16-persistent-structural-correction.v1"
IDENTITY = "source-space-signed-mass-residual-force-v0"


def load_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"{name} could not be loaded: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


FITTER = load_module(FITTER_PATH, "grid16_structural_fitter")
PERSISTENT = load_module(PERSISTENT_PATH, "grid16_structural_persistent")
RADIOMETRIC = load_module(RADIOMETRIC_PATH, "grid16_structural_radiometric")


def normalized_gaussian_mass_basis(source_positions: np.ndarray, state: Any) -> np.ndarray:
    positions = np.asarray(source_positions, dtype=np.float64)
    centers = np.asarray(state.positions, dtype=np.float64)
    covariances = np.asarray(state.covariances, dtype=np.float64)
    FITTER.require(positions.ndim == 2 and positions.shape[1] == 3, "source positions are invalid")
    FITTER.require(centers.ndim == 2 and centers.shape[1] == 3, "mode positions are invalid")
    FITTER.require(covariances.shape == (centers.shape[0], 3, 3), "mode covariances are invalid")
    inverse = np.linalg.inv(covariances)
    offsets = positions[:, None, :] - centers[None, :, :]
    squared_distance = np.einsum("nmi,mij,nmj->nm", offsets, inverse, offsets, optimize=True)
    log_basis = -0.5 * squared_distance
    log_basis -= np.max(log_basis, axis=0, keepdims=True)
    basis = np.exp(log_basis)
    normalizer = np.sum(basis, axis=0, dtype=np.float64)
    FITTER.require(np.all(np.isfinite(normalizer)) and np.all(normalizer > 0.0), "Gaussian mass basis is empty")
    return basis / normalizer[None, :]


def signed_source_space_forces(target_medium: Any, state: Any) -> tuple[np.ndarray, dict[str, Any]]:
    target_mass = FITTER.optical_weight(target_medium.coefficients)
    mode_mass = FITTER.optical_weight(state.coefficients)
    FITTER.require(np.all(target_mass >= 0.0) and np.all(mode_mass >= 0.0), "optical mass is negative")
    FITTER.require(
        np.isclose(np.sum(target_mass), np.sum(mode_mass), rtol=1e-10, atol=1e-8),
        "mode optical mass does not match target optical mass",
    )
    basis = normalized_gaussian_mass_basis(target_medium.positions, state)
    predicted_mass = basis @ mode_mass
    residual = target_mass - predicted_mass
    offsets = target_medium.positions[:, None, :] - state.positions[None, :, :]
    weighted_residual = basis * residual[:, None]
    denominator = np.sum(basis * np.abs(residual)[:, None], axis=0, dtype=np.float64)
    force = np.divide(
        np.einsum("nm,nmi->mi", weighted_residual, offsets, optimize=True),
        denominator[:, None],
        out=np.zeros_like(state.positions, dtype=np.float64),
        where=denominator[:, None] > 1e-15,
    )
    FITTER.require(np.all(np.isfinite(force)), "signed source-space force is nonfinite")
    undercovered = float(np.sum(np.maximum(residual, 0.0), dtype=np.float64))
    overcovered = float(np.sum(np.maximum(-residual, 0.0), dtype=np.float64))
    return force, {
        "identity": IDENTITY,
        "targetMass": float(np.sum(target_mass, dtype=np.float64)),
        "predictedMass": float(np.sum(predicted_mass, dtype=np.float64)),
        "undercoveredMass": undercovered,
        "overcoveredMass": overcovered,
        "massResidualL1": float(np.sum(np.abs(residual), dtype=np.float64)),
        "massResidualMaximumAbsolute": float(np.max(np.abs(residual))),
        "meanForceMagnitude": float(np.mean(np.linalg.norm(force, axis=1))),
        "maximumForceMagnitude": float(np.max(np.linalg.norm(force, axis=1))),
    }


def apply_signed_source_space_correction(
    target_medium: Any,
    state: Any,
    *,
    trust_radius_cells: float,
    soft_neighbors: int,
    temperature_cells: float,
) -> tuple[Any, dict[str, Any]]:
    FITTER.require(math.isfinite(trust_radius_cells) and trust_radius_cells >= 0.0, "trust radius is invalid")
    force, force_receipt = signed_source_space_forces(target_medium, state)
    trust_radius = float(np.mean(target_medium.spacing)) * trust_radius_cells
    magnitude = np.linalg.norm(force, axis=1)
    scale = np.ones_like(magnitude)
    positive = magnitude > trust_radius
    if trust_radius == 0.0:
        scale[magnitude > 0.0] = 0.0
    else:
        scale[positive] = trust_radius / magnitude[positive]
    correction = force * scale[:, None]
    positions = state.positions + correction
    ownership = PERSISTENT.sparse_soft_ownership(
        target_medium,
        positions,
        soft_neighbors=soft_neighbors,
        temperature_cells=temperature_cells,
    )
    corrected = PERSISTENT.fixed_geometry_state(
        target_medium,
        state,
        positions,
        state.covariances,
        ownership,
    )
    FITTER.require(np.array_equal(corrected.mode_ids, state.mode_ids), "signed correction changed mode identity")
    FITTER.require(np.array_equal(corrected.covariances, state.covariances), "signed correction changed covariance")
    expected_mass = np.sum(target_medium.coefficients, axis=0, dtype=np.float64)
    FITTER.require(
        np.allclose(np.sum(corrected.coefficients, axis=0, dtype=np.float64), expected_mass, rtol=1e-10, atol=1e-8),
        "signed correction lost target optical ownership",
    )
    return corrected, {
        **force_receipt,
        "geometryPolicy": "bounded-source-space-signed-residual-center-correction",
        "covariancePolicy": "fixed-input-covariance",
        "coefficientPolicy": "target-state-conservative-soft-ownership",
        "modeCount": int(state.mode_ids.size),
        "birthCount": 0,
        "deathCount": 0,
        "trustRadiusCells": trust_radius_cells,
        "trustRadiusWorld": trust_radius,
        "trustRegionClippedModeCount": int(np.count_nonzero(scale < 1.0)),
        "meanAppliedCorrection": float(np.mean(np.linalg.norm(correction, axis=1))),
        "maximumAppliedCorrection": float(np.max(np.linalg.norm(correction, axis=1))),
    }


def relax_signed_source_space_correction(
    target_medium: Any,
    state: Any,
    *,
    trust_radius_cells: float,
    soft_neighbors: int,
    temperature_cells: float,
    maximum_iterations: int,
) -> tuple[Any, dict[str, Any]]:
    FITTER.require(maximum_iterations > 0, "maximum relaxation iterations must be positive")
    trust_radius = float(np.mean(target_medium.spacing)) * trust_radius_cells
    origin = state.positions.copy()
    current = state
    _, initial_receipt = signed_source_space_forces(target_medium, current)
    current_residual = float(initial_receipt["massResidualL1"])
    iterations: list[dict[str, Any]] = []
    for iteration in range(maximum_iterations):
        force, force_receipt = signed_source_space_forces(target_medium, current)
        accepted = None
        for line_scale in (1.0, 0.5, 0.25, 0.125):
            candidate_positions = current.positions + force * line_scale
            displacement = candidate_positions - origin
            displacement_norm = np.linalg.norm(displacement, axis=1)
            scale = np.ones_like(displacement_norm)
            outside = displacement_norm > trust_radius
            if trust_radius == 0.0:
                scale[displacement_norm > 0.0] = 0.0
            else:
                scale[outside] = trust_radius / displacement_norm[outside]
            candidate_positions = origin + displacement * scale[:, None]
            ownership = PERSISTENT.sparse_soft_ownership(
                target_medium,
                candidate_positions,
                soft_neighbors=soft_neighbors,
                temperature_cells=temperature_cells,
            )
            candidate = PERSISTENT.fixed_geometry_state(
                target_medium,
                state,
                candidate_positions,
                state.covariances,
                ownership,
            )
            _, candidate_receipt = signed_source_space_forces(target_medium, candidate)
            candidate_residual = float(candidate_receipt["massResidualL1"])
            if candidate_residual < current_residual - 1e-12:
                accepted = (candidate, candidate_residual, line_scale, int(np.count_nonzero(scale < 1.0)))
                break
        iterations.append(
            {
                "iteration": iteration + 1,
                "inputMassResidualL1": current_residual,
                "forceMaximum": force_receipt["maximumForceMagnitude"],
                "accepted": accepted is not None,
                "lineScale": None if accepted is None else accepted[2],
                "trustRegionClippedModeCount": 0 if accepted is None else accepted[3],
                "outputMassResidualL1": current_residual if accepted is None else accepted[1],
            }
        )
        if accepted is None:
            break
        current, current_residual, _line_scale, _clipped = accepted
    FITTER.require(np.array_equal(current.mode_ids, state.mode_ids), "relaxation changed mode identity")
    FITTER.require(np.array_equal(current.covariances, state.covariances), "relaxation changed covariance")
    expected_mass = np.sum(target_medium.coefficients, axis=0, dtype=np.float64)
    FITTER.require(
        np.allclose(np.sum(current.coefficients, axis=0, dtype=np.float64), expected_mass, rtol=1e-10, atol=1e-8),
        "relaxation lost target optical ownership",
    )
    final_displacement = np.linalg.norm(current.positions - origin, axis=1)
    return current, {
        "identity": "monotone-source-space-signed-mass-residual-relaxation-v0",
        "geometryPolicy": "bounded-monotone-source-space-signed-residual-center-relaxation",
        "covariancePolicy": "fixed-input-covariance",
        "coefficientPolicy": "target-state-conservative-soft-ownership",
        "trustRegionReference": "input-persistent-state",
        "trustRadiusCells": trust_radius_cells,
        "trustRadiusWorld": trust_radius,
        "maximumIterations": maximum_iterations,
        "attemptedIterationCount": len(iterations),
        "acceptedIterationCount": sum(int(item["accepted"]) for item in iterations),
        "initialMassResidualL1": float(initial_receipt["massResidualL1"]),
        "finalMassResidualL1": current_residual,
        "relativeMassResidualReduction": 1.0 - current_residual / max(float(initial_receipt["massResidualL1"]), 1e-12),
        "meanTotalCorrection": float(np.mean(final_displacement)),
        "maximumTotalCorrection": float(np.max(final_displacement)),
        "modeCount": int(state.mode_ids.size),
        "birthCount": 0,
        "deathCount": 0,
        "iterations": iterations,
    }


def physical_render(
    mode_module: Any,
    target_medium: Any,
    camera: dict[str, Any],
    state: Any,
    *,
    width: int,
    depth_bins: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    planes, receipt = RADIOMETRIC.ewa_planes(
        mode_module,
        target_medium,
        camera,
        width=width,
        depth_bins=depth_bins,
        coefficient_scale_identity="native-cell-projected-area-jacobian",
        mode_state=state,
    )
    linear, transmittance = RADIOMETRIC.compose_corrected_planes(planes, 1.0)
    return linear, transmittance, {
        **receipt,
        "composition": "corrected-zero-limit",
        "coefficientScaleIdentity": "native-cell-projected-area-jacobian",
        "pathScale": 1.0,
    }


def signed_residual_preview(target: np.ndarray, treatment: np.ndarray) -> tuple[np.ndarray, float]:
    residual = np.asarray(target, dtype=np.float64) - np.asarray(treatment, dtype=np.float64)
    scale = max(float(np.percentile(np.abs(residual), 99.5)), 1e-8)
    return np.clip(0.5 + residual / (2.0 * scale), 0.0, 1.0), scale


def viewer_html(rows: list[dict[str, str]]) -> str:
    figures = "".join(
        f'<figure><figcaption>{row["label"]}</figcaption><img src="{row["image"]}" alt="{row["label"]}"></figure>'
        for row in rows
    )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grid16 persistent structural correction</title>
<style>
body{{margin:0;background:#090b0d;color:#edf2f7;font:15px system-ui,sans-serif}}
header{{position:sticky;top:0;z-index:2;padding:14px 18px;background:#11161bcc;border-bottom:1px solid #33404c}}
header p{{margin:.35rem 0 0;color:#aeb9c4}}main{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#33404c}}
figure{{margin:0;background:#050607}}figcaption{{padding:10px 12px;background:#11161b;font-weight:650}}img{{display:block;width:100%;height:auto;background:#000}}
@media(max-width:900px){{main{{grid-template-columns:1fr}}}}
</style></head><body><header><strong>Persistent Grid16 structural correction · state 120</strong>
<p>Fixed 48 identities, fixed covariance, conservative optical ownership, projected-area physical optics. Only center correction changes.</p>
</header><main>{figures}</main></body></html>"""


def artifact(path: Path) -> dict[str, Any]:
    return {"path": str(path), "sha256": FITTER.sha256_file(path), "bytes": path.stat().st_size}


def run_assay(args: argparse.Namespace) -> dict[str, Any]:
    source_sequence_path = args.source_sequence.expanduser().resolve()
    target_sequence_path = args.target_sequence.expanduser().resolve()
    motion_manifest_path = args.motion_manifest.expanduser().resolve()
    mode_path = args.mode_module.expanduser().resolve()
    for path, label in (
        (source_sequence_path, "source sequence"),
        (target_sequence_path, "target sequence"),
        (motion_manifest_path, "motion manifest"),
        (mode_path, "mode module"),
    ):
        FITTER.require(path.is_file(), f"{label} is missing: {path}")

    source_sequence, seed_state = PERSISTENT.load_sequence_state(source_sequence_path, args.seed_iteration)
    target_sequence, _cold_control = PERSISTENT.load_sequence_state(target_sequence_path, args.control_iteration)
    source_state_id = str((source_sequence.get("source") or {}).get("stateId"))
    target_state_id = str((target_sequence.get("source") or {}).get("stateId"))
    FITTER.require(source_state_id == "coefficient-state-118", "source state is not exact state118")
    FITTER.require(target_state_id == "coefficient-state-120", "target state is not exact state120")
    for sequence in (source_sequence, target_sequence):
        source = sequence.get("source") or {}
        FITTER.require(Path(source.get("manifestPath", "")).resolve() == motion_manifest_path, "sequence manifest path drifted")
        FITTER.require(source.get("manifestSha256") == FITTER.sha256_file(motion_manifest_path), "sequence manifest hash drifted")

    source_manifest, source_state, source_ids, source_positions, source_coefficients, source_velocities = (
        PERSISTENT.load_motion_state(motion_manifest_path, source_state_id)
    )
    target_manifest, target_state, target_ids, target_positions, target_coefficients, _ = PERSISTENT.load_motion_state(
        motion_manifest_path,
        target_state_id,
    )
    FITTER.require(source_manifest.get("identity") == target_manifest.get("identity"), "motion manifest identity drifted")
    source_grid = int(source_state["replay"]["grid"])
    target_grid = int(target_state["replay"]["grid"])
    FITTER.require(source_grid == target_grid == 96, "source grid drifted")
    source_medium = FITTER.restrict_selected_optical_medium(
        source_ids,
        source_positions,
        source_coefficients,
        source_grid=source_grid,
        target_grid=16,
        population="ridge",
    )
    target_medium = FITTER.restrict_selected_optical_medium(
        target_ids,
        target_positions,
        target_coefficients,
        source_grid=target_grid,
        target_grid=16,
        population="ridge",
    )
    restricted_velocity, velocity_restriction = PERSISTENT.restrict_weighted_velocity(
        source_ids,
        source_coefficients,
        source_velocities,
        source_medium,
    )
    mode_velocity, mode_velocity_receipt = PERSISTENT.aggregate_mode_velocity(
        source_medium,
        seed_state,
        restricted_velocity,
        soft_neighbors=args.soft_neighbors,
        temperature_cells=args.temperature_cells,
    )
    source_step = int(source_state["replay"]["completedSteps"])
    target_step = int(target_state["replay"]["completedSteps"])
    time_step_ms = float(source_state["replay"]["timeStepMs"])
    FITTER.require(time_step_ms == float(target_state["replay"]["timeStepMs"]), "state time step drifted")
    dt_seconds = (target_step - source_step) * time_step_ms / 1000.0
    FITTER.require(dt_seconds > 0.0, "state order is not forward in time")

    advected, advected_receipt = PERSISTENT.continue_optical_modes(
        target_medium=target_medium,
        seed_state=seed_state,
        mode_velocities=mode_velocity,
        dt_seconds=dt_seconds,
        arm="advected",
        soft_neighbors=args.soft_neighbors,
        temperature_cells=args.temperature_cells,
        trust_radius_cells=args.trust_radius_cells,
        covariance_relative_limit=args.covariance_relative_limit,
    )
    old_bounded, old_bounded_receipt = PERSISTENT.continue_optical_modes(
        target_medium=target_medium,
        seed_state=seed_state,
        mode_velocities=mode_velocity,
        dt_seconds=dt_seconds,
        arm="advected-bounded-exclusive",
        soft_neighbors=args.soft_neighbors,
        temperature_cells=args.temperature_cells,
        trust_radius_cells=args.trust_radius_cells,
        covariance_relative_limit=args.covariance_relative_limit,
    )
    corrected, correction_receipt = apply_signed_source_space_correction(
        target_medium,
        advected,
        trust_radius_cells=args.trust_radius_cells,
        soft_neighbors=args.soft_neighbors,
        temperature_cells=args.temperature_cells,
    )
    relaxed, relaxation_receipt = relax_signed_source_space_correction(
        target_medium,
        advected,
        trust_radius_cells=args.trust_radius_cells,
        soft_neighbors=args.soft_neighbors,
        temperature_cells=args.temperature_cells,
        maximum_iterations=args.relaxation_iterations,
    )

    mode_module = load_module(mode_path, "grid16_structural_mode_renderer")
    camera = target_state.get("target") or {}
    FITTER.require(camera.get("cameraPose") and int(camera.get("width", 0)) > 0, "target held camera is missing")
    target_linear, target_transmittance, target_render_receipt = FITTER.render_restricted_medium(
        target_medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )
    treatments = {
        "advected-baseline": (advected, advected_receipt),
        "old-bounded-exclusive": (old_bounded, old_bounded_receipt),
        "signed-source-correction": (corrected, correction_receipt),
        "signed-source-relaxation": (relaxed, relaxation_receipt),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, str]] = []
    artifacts: dict[str, Any] = {}

    def write_color(name: str, label: str, linear: np.ndarray) -> None:
        path = args.output_dir / f"{name}.png"
        artifacts[name] = RADIOMETRIC.write_color(path, linear, mode_module)
        rows.append({"image": path.name, "label": label})

    write_color("target-grid16-restricted-raymarch", "Target · Grid16 restricted-medium Raymarch", target_linear)
    treatment_rows: dict[str, Any] = {}
    for name, (state, continuation_receipt) in treatments.items():
        linear, transmittance, render_receipt = physical_render(
            mode_module,
            target_medium,
            camera,
            state,
            width=args.render_width,
            depth_bins=args.depth_bins,
        )
        write_color(name, name.replace("-", " ").title(), linear)
        preview, preview_scale = signed_residual_preview(target_linear, linear)
        residual_path = args.output_dir / f"{name}-signed-residual.png"
        FITTER.write_png(residual_path, preview)
        artifacts[f"{name}-signed-residual"] = artifact(residual_path)
        rows.append({"image": residual_path.name, "label": f"{name.replace('-', ' ').title()} · signed residual"})
        treatment_rows[name] = {
            "metrics": RADIOMETRIC.linear_rgb_metrics(target_linear, linear),
            "transport": RADIOMETRIC.transmittance_metrics(target_transmittance, transmittance),
            "renderReceipt": render_receipt,
            "continuationReceipt": continuation_receipt,
            "residualPreviewScale": preview_scale,
            "placement": {
                "meanSeedDisplacement": float(np.mean(np.linalg.norm(state.positions - seed_state.positions, axis=1))),
                "maximumSeedDisplacement": float(np.max(np.linalg.norm(state.positions - seed_state.positions, axis=1))),
            },
            "covarianceChangeFromAdvected": PERSISTENT.covariance_change(advected.covariances, state.covariances),
        }

    index_path = args.output_dir / "index.html"
    index_path.write_text(viewer_html(rows), encoding="utf-8")
    artifacts["viewer"] = artifact(index_path)
    return {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "complete",
        "failurePhase": None,
        "requested": {
            "source_sequence": str(source_sequence_path),
            "target_sequence": str(target_sequence_path),
            "motion_manifest": str(motion_manifest_path),
            "mode_module": str(mode_path),
            "output_dir": str(args.output_dir),
            "seed_iteration": args.seed_iteration,
            "control_iteration": args.control_iteration,
            "soft_neighbors": args.soft_neighbors,
            "temperature_cells": args.temperature_cells,
            "trust_radius_cells": args.trust_radius_cells,
            "covariance_relative_limit": args.covariance_relative_limit,
            "render_width": args.render_width,
            "depth_bins": args.depth_bins,
            "samples_per_cell": args.samples_per_cell,
            "relaxation_iterations": args.relaxation_iterations,
        },
        "effective": {
            "sourceStateId": source_state_id,
            "targetStateId": target_state_id,
            "sourceStep": source_step,
            "targetStep": target_step,
            "dtSeconds": dt_seconds,
            "sourceGrid": source_grid,
            "restrictedGrid": 16,
            "population": "ridge",
            "modeCount": int(seed_state.mode_ids.size),
            "birthCount": 0,
            "deathCount": 0,
            "effectiveRoute": FITTER.EXPECTED_ROUTE,
            "backend": (target_manifest.get("route") or {}).get("backend"),
            "coefficientScaleIdentity": "native-cell-projected-area-jacobian",
            "composition": "corrected-zero-limit",
            "pathScale": 1.0,
        },
        "source": {
            "sourceSequenceSha256": FITTER.sha256_file(source_sequence_path),
            "targetSequenceSha256": FITTER.sha256_file(target_sequence_path),
            "motionManifestSha256": FITTER.sha256_file(motion_manifest_path),
            "modeModuleSha256": FITTER.sha256_file(mode_path),
            "implementationSha256": FITTER.sha256_file(Path(__file__)),
            "selectedCoefficientMass": target_medium.selected_mass,
        },
        "motionReceipts": {
            "velocityRestriction": velocity_restriction,
            "modeAggregation": mode_velocity_receipt,
        },
        "targetRenderReceipt": target_render_receipt,
        "treatments": treatment_rows,
        "artifacts": artifacts,
        "claimBoundary": {
            "fixedCountPersistentStructuralDiscriminator": True,
            "sourceSpaceResidualAuthority": True,
            "heldCameraVisualAuthority": True,
            "adjacentStateTemporalAuthority": False,
            "structuralProgressClaimed": False,
            "visualClosureClaimed": False,
            "productionEligibilityClaimed": False,
            "performanceAuthority": False,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sequence", required=True, type=Path)
    parser.add_argument("--target-sequence", required=True, type=Path)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--mode-module", type=Path, default=DEFAULT_MODE_MODULE)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--seed-iteration", type=int, default=1)
    parser.add_argument("--control-iteration", type=int, default=1)
    parser.add_argument("--soft-neighbors", type=int, default=3)
    parser.add_argument("--temperature-cells", type=float, default=0.9)
    parser.add_argument("--trust-radius-cells", type=float, default=0.5)
    parser.add_argument("--covariance-relative-limit", type=float, default=0.25)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--samples-per-cell", type=int, default=4)
    parser.add_argument("--relaxation-iterations", type=int, default=8)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    phase = "source-validation"
    try:
        report = run_assay(args)
    except Exception as error:
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": f"{type(error).__name__}: {error}",
            "requested": {
                "source_sequence": str(args.source_sequence),
                "target_sequence": str(args.target_sequence),
                "motion_manifest": str(args.motion_manifest),
                "mode_module": str(args.mode_module),
                "output_dir": str(args.output_dir),
            },
            "claimBoundary": {
                "structuralProgressClaimed": False,
                "visualClosureClaimed": False,
                "productionEligibilityClaimed": False,
                "performanceAuthority": False,
            },
        }
        FITTER.write_json(args.output_dir / "report.json", report)
        print(report["error"], file=sys.stderr)
        return 1
    FITTER.write_json(args.output_dir / "report.json", report)
    print(json.dumps({"status": report["status"], "outputDir": str(args.output_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
