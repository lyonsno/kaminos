#!/usr/bin/env python3
"""Compare Grid16 Raymarch and EWA optical units without invoking a fitter."""

from __future__ import annotations

import argparse
from dataclasses import replace
import importlib.util
import json
import math
from pathlib import Path
import sys
import traceback
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parent
FITTER_PATH = ROOT / "volume-multiscale-fitting-sequence.py"
DEFAULT_MODE_MODULE = ROOT / "volume-grid96-off-lattice-optical-modes.py"
SCHEMA = "kaminos.volume.grid16-radiometric-unit-discriminator.v0"
IDENTITY = "frozen-grid16-cell-event-raymarch-ewa-component-discriminator-v0"
COMPONENTS = ("emission-only", "extinction-only", "combined")
LUMA = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float64)


class DiscriminatorFailure(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DiscriminatorFailure(message)


def load_module(path: Path, name: str) -> Any:
    require(path.is_file(), f"{name} implementation is missing: {path}")
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, f"{name} implementation could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


FITTER = load_module(FITTER_PATH, "grid16_radiometric_fitter")


def component_coefficients(coefficients: np.ndarray, component: str) -> np.ndarray:
    values = np.asarray(coefficients, dtype=np.float64)
    require(values.ndim == 2 and values.shape[1] == 8, "optical coefficients must be rows of eight channels")
    require(np.all(np.isfinite(values)) and np.all(values >= 0.0), "optical coefficients are invalid")
    result = values.copy()
    if component == "emission-only":
        result[:, [3, 7]] = 0.0
    elif component == "extinction-only":
        result[:, [0, 1, 2, 4, 5, 6]] = 0.0
    elif component != "combined":
        raise DiscriminatorFailure(f"unknown optical component: {component}")
    return result


def homogeneous_transfer(emission: np.ndarray, optical_depth: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    emitted = np.asarray(emission, dtype=np.float64)
    depth = np.asarray(optical_depth, dtype=np.float64)
    require(emitted.shape == (*depth.shape, 3), "emission and optical depth shapes differ")
    require(np.all(np.isfinite(emitted)) and np.all(emitted >= 0.0), "emission is invalid")
    require(np.all(np.isfinite(depth)) and np.all(depth >= 0.0), "optical depth is invalid")
    transmittance = np.exp(-depth)
    alpha = -np.expm1(-depth)
    source_scale = np.divide(
        alpha,
        depth,
        out=np.ones_like(depth, dtype=np.float64),
        where=depth > 1e-8,
    )
    return emitted * source_scale[..., None], transmittance


def compose_corrected_planes(planes: np.ndarray, path_scale: float) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(planes)
    require(values.ndim == 4 and values.shape[-1] == 8, "optical planes shape drifted")
    emission = (values[..., :3] + values[..., 4:7]).astype(np.float64, copy=False) * path_scale
    optical_depth = (values[..., 3] + values[..., 7]).astype(np.float64, copy=False) * path_scale
    color = np.zeros((*values.shape[1:3], 3), dtype=np.float64)
    transmittance = np.ones(values.shape[1:3], dtype=np.float64)
    for depth_index in range(values.shape[0]):
        emitted, segment_transmittance = homogeneous_transfer(
            emission[depth_index],
            optical_depth[depth_index],
        )
        color += transmittance[..., None] * emitted
        transmittance *= segment_transmittance
    return color, transmittance


def projected_native_cell_area_scales(
    positions: np.ndarray,
    camera: dict[str, Any],
    source_spacing: np.ndarray,
    *,
    epsilon: float = 1e-4,
) -> np.ndarray:
    world = np.asarray(positions, dtype=np.float64)
    spacing = np.asarray(source_spacing, dtype=np.float64)
    require(world.ndim == 2 and world.shape[1] == 3, "projected-area positions must be world-space triples")
    require(np.all(np.isfinite(world)), "projected-area positions contain nonfinite values")
    require(spacing.shape == (3,) and np.all(np.isfinite(spacing)) and np.all(spacing > 0.0), "source spacing is invalid")
    require(math.isfinite(epsilon) and epsilon > 0.0, "projected-area derivative epsilon is invalid")
    width = camera.get("width")
    height = camera.get("height")
    pose = camera.get("cameraPose")
    require(isinstance(width, int) and width > 0, "camera width is invalid")
    require(isinstance(height, int) and height > 0, "camera height is invalid")
    require(isinstance(pose, dict), "camera pose is missing")
    matrix_world_inverse = pose.get("matrixWorldInverse")
    projection_matrix = pose.get("projectionMatrix")
    require(isinstance(matrix_world_inverse, list) and len(matrix_world_inverse) == 16, "camera view matrix is invalid")
    require(isinstance(projection_matrix, list) and len(projection_matrix) == 16, "camera projection matrix is invalid")
    view = np.asarray(matrix_world_inverse, dtype=np.float64).reshape(4, 4, order="F")
    projection = np.asarray(projection_matrix, dtype=np.float64).reshape(4, 4, order="F")

    def project(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        homogeneous = np.concatenate((points, np.ones((points.shape[0], 1), dtype=np.float64)), axis=1)
        view_points = homogeneous @ view.T
        clip = view_points @ projection.T
        clip_w = clip[:, 3]
        valid = clip_w > 1e-5
        pixels = np.full((points.shape[0], 2), np.nan, dtype=np.float64)
        pixels[valid, 0] = (clip[valid, 0] / clip_w[valid] * 0.5 + 0.5) * width
        pixels[valid, 1] = (1.0 - (clip[valid, 1] / clip_w[valid] * 0.5 + 0.5)) * height
        valid &= np.all(np.isfinite(pixels), axis=1)
        return pixels, valid

    _centers, valid = project(world)
    jacobian = np.empty((world.shape[0], 2, 3), dtype=np.float64)
    for axis in range(3):
        delta = np.zeros(3, dtype=np.float64)
        delta[axis] = epsilon
        plus, plus_valid = project(world + delta)
        minus, minus_valid = project(world - delta)
        valid &= plus_valid & minus_valid
        jacobian[:, :, axis] = (plus - minus) / (2.0 * epsilon)
    gram = np.einsum("nai,nbi->nab", jacobian, jacobian, optimize=True)
    area_jacobian = np.sqrt(np.maximum(np.linalg.det(gram), 0.0))
    native_cell_area = float(np.prod(spacing) / np.mean(spacing))
    scales = area_jacobian * native_cell_area
    require(np.all(np.isfinite(scales[valid])) and np.all(scales[valid] > 0.0), "projected native-cell area scale is invalid")
    scales[~valid] = 0.0
    return scales


def linear_rgb_metrics(target: np.ndarray, treatment: np.ndarray) -> dict[str, Any]:
    reference = np.asarray(target, dtype=np.float64)
    candidate = np.asarray(treatment, dtype=np.float64)
    require(reference.shape == candidate.shape and reference.ndim == 3 and reference.shape[2] == 3, "RGB comparison shape drifted")
    require(np.all(np.isfinite(reference)) and np.all(np.isfinite(candidate)), "RGB comparison contains nonfinite values")
    target_luma = float(np.mean(reference @ LUMA))
    treatment_luma = float(np.mean(candidate @ LUMA))
    delta = candidate - reference
    return {
        "linearMae": float(np.mean(np.abs(delta))),
        "linearRmse": float(np.sqrt(np.mean(np.square(delta)))),
        "targetMeanLuma": target_luma,
        "treatmentMeanLuma": treatment_luma,
        "meanLumaRatio": treatment_luma / max(target_luma, 1e-12),
        "targetIntegratedRgb": np.sum(reference, axis=(0, 1), dtype=np.float64).tolist(),
        "treatmentIntegratedRgb": np.sum(candidate, axis=(0, 1), dtype=np.float64).tolist(),
    }


def transmittance_metrics(target: np.ndarray, treatment: np.ndarray) -> dict[str, float]:
    reference = np.asarray(target, dtype=np.float64)
    candidate = np.asarray(treatment, dtype=np.float64)
    require(reference.shape == candidate.shape and reference.ndim == 2, "transmittance comparison shape drifted")
    require(
        np.all(np.isfinite(reference))
        and np.all(np.isfinite(candidate))
        and np.all((reference >= 0.0) & (reference <= 1.0))
        and np.all((candidate >= 0.0) & (candidate <= 1.0)),
        "transmittance comparison is invalid",
    )
    return {
        "transmittanceMae": float(np.mean(np.abs(candidate - reference))),
        "targetMeanTransmittance": float(np.mean(reference)),
        "treatmentMeanTransmittance": float(np.mean(candidate)),
        "targetMeanOpacity": float(np.mean(1.0 - reference)),
        "treatmentMeanOpacity": float(np.mean(1.0 - candidate)),
    }


def load_target_medium(sequence_path: Path) -> tuple[dict[str, Any], dict[str, Any], Any, dict[str, Any]]:
    require(sequence_path.is_file(), f"target sequence is missing: {sequence_path}")
    sequence = json.loads(sequence_path.read_text())
    require(sequence.get("schema") == FITTER.SEQUENCE_SCHEMA, "target sequence schema drifted")
    require(sequence.get("status") == "captured", "target sequence is incomplete")
    restriction = sequence.get("restriction") or {}
    require(restriction.get("targetGrid") == 16, "target sequence is not Grid16")
    require(restriction.get("population") == "ridge", "target sequence population drifted")
    source = sequence.get("source") or {}
    state_id = str(source.get("stateId") or "")
    manifest_path = Path(str(source.get("manifestPath") or "")).expanduser().resolve()
    require(manifest_path.is_file(), f"source motion manifest is missing: {manifest_path}")
    require(source.get("manifestSha256") == FITTER.sha256_file(manifest_path), "source motion manifest hash drifted")
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, state_id)
    replay = state.get("replay") or {}
    require(replay.get("effectiveRoute") == FITTER.EXPECTED_ROUTE, "effective source route drifted")
    source_grid = int(replay.get("grid", 0))
    require(source_grid == 96, "source state is not Grid96")
    medium = FITTER.restrict_selected_optical_medium(
        native_ids,
        positions,
        coefficients,
        source_grid=source_grid,
        target_grid=16,
        population="ridge",
    )
    camera = state.get("target") or {}
    require(camera.get("cameraPose") and int(camera.get("width", 0)) > 0, "held camera is missing")
    return sequence, manifest, medium, camera


def sequence_mode_state(sequence: dict[str, Any], iteration: int) -> Any:
    frames = sequence.get("frames")
    require(isinstance(frames, list), "mode sequence frames are missing")
    frame = next(
        (candidate for candidate in frames if isinstance(candidate, dict) and candidate.get("iteration") == iteration),
        None,
    )
    require(isinstance(frame, dict), f"mode sequence iteration is missing: {iteration}")
    primitives = frame.get("primitives")
    require(isinstance(primitives, list) and primitives, f"mode sequence iteration {iteration} has no primitives")
    mode_ids = np.asarray([primitive.get("id") for primitive in primitives], dtype=np.uint64)
    positions = np.asarray([primitive.get("position") for primitive in primitives], dtype=np.float64)
    covariances = np.asarray([primitive.get("covariance") for primitive in primitives], dtype=np.float64)
    coefficients = np.asarray([primitive.get("coefficients") for primitive in primitives], dtype=np.float64)
    source_row_counts = np.asarray([primitive.get("sourceRowCount") for primitive in primitives], dtype=np.uint32)
    mode_count = mode_ids.size
    require(np.unique(mode_ids).size == mode_count, "mode sequence contains duplicate primitive identities")
    require(positions.shape == (mode_count, 3), "mode sequence positions are malformed")
    require(covariances.shape == (mode_count, 3, 3), "mode sequence covariances are malformed")
    require(coefficients.shape == (mode_count, 8), "mode sequence coefficients are malformed")
    require(source_row_counts.shape == (mode_count,), "mode sequence source-row counts are malformed")
    require(
        np.all(np.isfinite(positions))
        and np.all(np.isfinite(covariances))
        and np.all(np.isfinite(coefficients))
        and np.all(coefficients >= 0.0),
        "mode sequence contains invalid numeric values",
    )
    return FITTER.ModeState(
        iteration=iteration,
        mode_ids=mode_ids,
        positions=positions,
        covariances=covariances,
        coefficients=coefficients,
        source_row_counts=source_row_counts,
        objective=float(frame.get("objective", 0.0)),
        maximum_position_delta=float(frame.get("maximumPositionDelta", 0.0)),
    )


def ewa_planes(
    mode_module: Any,
    medium: Any,
    camera: dict[str, Any],
    *,
    width: int,
    depth_bins: int,
    coefficient_scale_identity: str = "none",
    mode_state: Any | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    state = FITTER.restricted_medium_oracle_state(medium) if mode_state is None else mode_state
    resized, camera_position, _forward, _right, _up = FITTER.camera_basis(camera, width)
    coefficient_scales = np.ones(state.positions.shape[0], dtype=np.float64)
    if coefficient_scale_identity == "native-cell-projected-area-jacobian":
        coefficient_scales = projected_native_cell_area_scales(
            state.positions,
            resized,
            medium.source_spacing,
        )
        state = replace(state, coefficients=state.coefficients * coefficient_scales[:, None])
    elif coefficient_scale_identity != "none":
        raise DiscriminatorFailure(f"unknown EWA coefficient scale: {coefficient_scale_identity}")
    distance = np.linalg.norm(state.positions - camera_position[None, :], axis=1)
    covariance_radii = np.sqrt(np.linalg.eigvalsh(state.covariances))
    near_depth = max(1e-4, float(np.min(distance)) - float(np.max(covariance_radii)))
    far_depth = float(np.max(distance)) + float(np.max(covariance_radii))
    receipt = mode_module.rasterize_optical_modes_ewa(
        FITTER.mode_object(mode_module, state, "ridge"),
        resized,
        depth_bins=depth_bins,
        near_depth=near_depth,
        far_depth=far_depth,
        support_sigma=3.5,
        pixel_variance_floor=0.04,
        covariance_scale=1.0,
    )
    return receipt.planes, {
        "identity": "grid16-cell-event-ewa" if mode_state is None else "grid16-sequence-mode-ewa",
        "depthBins": depth_bins,
        "nearDepth": near_depth,
        "farDepth": far_depth,
        "projectedModeCount": receipt.projected_mode_count,
        "projectedDepthSliceCount": receipt.projected_sample_count,
        "projectedFragmentCount": receipt.projected_fragment_count,
        "nominalCoefficientMass": receipt.nominal_coefficient_mass,
        "viewportCoefficientMass": receipt.viewport_coefficient_mass,
        "coefficientScale": {
            "identity": coefficient_scale_identity,
            "minimum": float(np.min(coefficient_scales)),
            "median": float(np.median(coefficient_scales)),
            "p95": float(np.percentile(coefficient_scales, 95.0)),
            "maximum": float(np.max(coefficient_scales)),
        },
    }


def low_tau_deletion_receipt(planes: np.ndarray, path_scale: float) -> dict[str, Any]:
    values = np.asarray(planes, dtype=np.float64)
    emission = (values[..., :3] + values[..., 4:7]) * path_scale
    optical_depth = (values[..., 3] + values[..., 7]) * path_scale
    luma = emission @ LUMA
    positive = luma > 0.0
    deleted = positive & (optical_depth <= 1e-6)
    total_luma = float(np.sum(luma, dtype=np.float64))
    deleted_luma = float(np.sum(luma[deleted], dtype=np.float64))
    return {
        "identity": "legacy-low-tau-source-deletion",
        "legacyThreshold": 1e-6,
        "positiveEmissionSampleCount": int(np.count_nonzero(positive)),
        "deletedEmissionSampleCount": int(np.count_nonzero(deleted)),
        "deletedEmissionSampleFraction": float(np.count_nonzero(deleted) / max(np.count_nonzero(positive), 1)),
        "rawEmissionLuma": total_luma,
        "deletedRawEmissionLuma": deleted_luma,
        "deletedRawEmissionLumaFraction": deleted_luma / max(total_luma, 1e-12),
    }


def artifact(path: Path) -> dict[str, Any]:
    require(path.is_file() and path.stat().st_size > 100, f"visual artifact is missing or partial: {path}")
    return {"path": str(path), "sha256": FITTER.sha256_file(path), "bytes": path.stat().st_size}


def write_color(path: Path, linear: np.ndarray, mode_module: Any) -> dict[str, Any]:
    FITTER.write_png(path, mode_module.tone_map_float(linear))
    return artifact(path)


def write_opacity(path: Path, transmittance: np.ndarray) -> dict[str, Any]:
    opacity = np.clip(1.0 - np.asarray(transmittance, dtype=np.float64), 0.0, 1.0)
    FITTER.write_png(path, np.repeat(opacity[..., None], 3, axis=2))
    return artifact(path)


def viewer_html(rows: list[dict[str, str]]) -> str:
    figures = "".join(
        f'<figure><figcaption>{row["label"]}</figcaption><img src="{row["image"]}" alt="{row["label"]}"></figure>'
        for row in rows
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grid16 radiometric unit discriminator</title><style>
:root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{margin:0;background:#080a0c;color:#eef2f4;font:14px system-ui,sans-serif}}header{{padding:12px 16px;background:#12171b;border-bottom:1px solid #2b343b}}header strong{{display:block;font-size:17px}}header p{{margin:5px 0 0;color:#b9c2c8}}main{{display:grid;grid-template-columns:repeat(3,minmax(260px,1fr));gap:1px;background:#283038}}figure{{position:relative;margin:0;min-height:280px;background:#000;display:grid;place-items:center}}figure img{{display:block;width:100%;height:100%;max-height:48vh;object-fit:contain}}figcaption{{position:absolute;z-index:1;left:8px;top:7px;padding:4px 7px;background:#000c;border-radius:4px}}@media(max-width:900px){{main{{grid-template-columns:1fr}}}}</style></head><body>
<header><strong>Frozen Grid16 Raymarch ↔ EWA radiometric-unit discriminator</strong><p>No fit. One restricted Ridge medium, one camera, one EWA plane tensor. “Corrected” changes only the homogeneous source limit as optical depth approaches zero.</p></header><main>{figures}</main></body></html>"""


def run_assay(args: argparse.Namespace) -> dict[str, Any]:
    sequence_path = args.target_sequence.expanduser().resolve()
    mode_path = args.mode_module.expanduser().resolve()
    sequence, manifest, medium, camera = load_target_medium(sequence_path)
    mode_module = load_module(mode_path, "grid16_radiometric_mode_renderer")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    treatment_state = None if args.mode_frame is None else sequence_mode_state(sequence, args.mode_frame)
    treatment_identity = "restricted-cell-events" if treatment_state is None else f"sequence-frame-{args.mode_frame}"

    combined_raymarch, raymarch_transmittance, raymarch_receipt = FITTER.render_restricted_medium(
        medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )
    emission_medium = replace(
        medium,
        coefficients=component_coefficients(medium.coefficients, "emission-only"),
        density_coefficients=component_coefficients(medium.density_coefficients, "emission-only"),
    )
    emission_raymarch, _, emission_raymarch_receipt = FITTER.render_restricted_medium(
        emission_medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )

    planes, ewa_receipt = ewa_planes(
        mode_module,
        medium,
        camera,
        width=args.render_width,
        depth_bins=args.depth_bins,
        mode_state=treatment_state,
    )
    projected_area_planes, projected_area_receipt = ewa_planes(
        mode_module,
        medium,
        camera,
        width=args.render_width,
        depth_bins=args.depth_bins,
        coefficient_scale_identity="native-cell-projected-area-jacobian",
        mode_state=treatment_state,
    )
    legacy_combined = mode_module.compose_homogeneous_optical_planes(planes, path_scale=args.path_scale)
    corrected_combined, ewa_transmittance = compose_corrected_planes(planes, args.path_scale)
    projected_area_combined, projected_area_transmittance = compose_corrected_planes(projected_area_planes, 1.0)
    emission_planes = planes.copy()
    emission_planes[..., [3, 7]] = 0.0
    projected_area_emission_planes = projected_area_planes.copy()
    projected_area_emission_planes[..., [3, 7]] = 0.0
    legacy_emission = mode_module.compose_homogeneous_optical_planes(emission_planes, path_scale=args.path_scale)
    corrected_emission, _ = compose_corrected_planes(emission_planes, args.path_scale)
    projected_area_emission, _ = compose_corrected_planes(projected_area_emission_planes, 1.0)

    rows: list[dict[str, str]] = []
    artifacts: dict[str, Any] = {}

    def color(name: str, label: str, values: np.ndarray) -> None:
        path = args.output_dir / f"{name}.png"
        artifacts[name] = write_color(path, values, mode_module)
        rows.append({"image": path.name, "label": label})

    def opacity(name: str, label: str, values: np.ndarray) -> None:
        path = args.output_dir / f"{name}.png"
        artifacts[name] = write_opacity(path, values)
        rows.append({"image": path.name, "label": label})

    color("raymarch-emission-only", "Raymarch · emission only", emission_raymarch)
    color("ewa-emission-only-legacy", "EWA · emission only · legacy", legacy_emission)
    color("ewa-emission-only-corrected", "EWA · emission only · corrected zero limit", corrected_emission)
    color("ewa-emission-only-projected-area", "EWA · emission only · projected-area units", projected_area_emission)
    opacity("raymarch-extinction-opacity", "Raymarch · extinction opacity", raymarch_transmittance)
    opacity("ewa-extinction-opacity", "EWA · extinction opacity", ewa_transmittance)
    opacity("ewa-extinction-opacity-projected-area", "EWA · extinction opacity · projected-area units", projected_area_transmittance)
    color("raymarch-combined", "Raymarch · combined", combined_raymarch)
    color("ewa-combined-legacy", "EWA · combined · legacy", legacy_combined)
    color("ewa-combined-corrected", "EWA · combined · corrected zero limit", corrected_combined)
    color("ewa-combined-projected-area", "EWA · combined · projected-area units", projected_area_combined)
    index_path = args.output_dir / "index.html"
    index_path.write_text(viewer_html(rows), encoding="utf-8")

    return {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "complete",
        "failurePhase": None,
        "requested": {
            "target_sequence": str(sequence_path),
            "mode_module": str(mode_path),
            "output_dir": str(args.output_dir),
            "render_width": args.render_width,
            "depth_bins": args.depth_bins,
            "samples_per_cell": args.samples_per_cell,
            "path_scale": args.path_scale,
            "mode_frame": args.mode_frame,
        },
        "effective": {
            "stateId": (sequence.get("source") or {}).get("stateId"),
            "sourceGrid": 96,
            "targetGrid": 16,
            "population": "ridge",
            "restrictedCellCount": int(medium.positions.shape[0]),
            "treatmentIdentity": treatment_identity,
            "treatmentModeCount": int(
                medium.positions.shape[0] if treatment_state is None else treatment_state.positions.shape[0]
            ),
            "fitInvoked": False,
            "effectiveRoute": FITTER.EXPECTED_ROUTE,
            "backend": (manifest.get("route") or {}).get("backend"),
            "components": list(COMPONENTS),
            "legacyComposition": "legacy-low-tau-source-deletion",
            "correctedComposition": "corrected-zero-limit",
            "projectedAreaComposition": "native-cell-projected-area-jacobian",
        },
        "source": {
            "targetSequenceSha256": FITTER.sha256_file(sequence_path),
            "motionManifestPath": (sequence.get("source") or {}).get("manifestPath"),
            "motionManifestSha256": (sequence.get("source") or {}).get("manifestSha256"),
            "modeModuleSha256": FITTER.sha256_file(mode_path),
            "implementationSha256": FITTER.sha256_file(Path(__file__)),
            "selectedCoefficientMass": medium.selected_mass,
        },
        "renderReceipts": {
            "grid16-restricted-raymarch": raymarch_receipt,
            "grid16-restricted-raymarch-emission-only": emission_raymarch_receipt,
            "grid16-cell-event-ewa": {**ewa_receipt, "pathScale": args.path_scale},
            "grid16-cell-event-ewa-projected-area": {**projected_area_receipt, "pathScale": 1.0},
            "lowTauDeletion": low_tau_deletion_receipt(planes, args.path_scale),
        },
        "metrics": {
            "emissionOnlyLegacy": linear_rgb_metrics(emission_raymarch, legacy_emission),
            "emissionOnlyCorrected": linear_rgb_metrics(emission_raymarch, corrected_emission),
            "emissionOnlyProjectedArea": linear_rgb_metrics(emission_raymarch, projected_area_emission),
            "extinctionOnly": transmittance_metrics(raymarch_transmittance, ewa_transmittance),
            "extinctionOnlyProjectedArea": transmittance_metrics(raymarch_transmittance, projected_area_transmittance),
            "combinedLegacy": linear_rgb_metrics(combined_raymarch, legacy_combined),
            "combinedCorrected": linear_rgb_metrics(combined_raymarch, corrected_combined),
            "combinedProjectedArea": linear_rgb_metrics(combined_raymarch, projected_area_combined),
            "legacyToCorrected": linear_rgb_metrics(corrected_combined, legacy_combined),
        },
        "artifacts": {
            **artifacts,
            "viewer": artifact(index_path),
        },
        "claimBoundary": {
            "frozenCellEventTransportDiagnostic": True,
            "radiometricClosureClaimed": False,
            "modeRepresentationAuthority": False,
            "continuousReferenceAuthority": False,
            "motionAuthority": False,
            "productionEligibilityClaimed": False,
            "performanceAuthority": False,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-sequence", required=True, type=Path)
    parser.add_argument("--mode-module", type=Path, default=DEFAULT_MODE_MODULE)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--samples-per-cell", type=int, default=4)
    parser.add_argument("--path-scale", type=float, default=FITTER.DEFAULT_PATH_SCALE)
    parser.add_argument("--mode-frame", type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": "source-validation",
        "requested": {
            "target_sequence": str(args.target_sequence),
            "mode_module": str(args.mode_module),
            "output_dir": str(args.output_dir),
            "render_width": args.render_width,
            "depth_bins": args.depth_bins,
            "samples_per_cell": args.samples_per_cell,
            "path_scale": args.path_scale,
            "mode_frame": args.mode_frame,
        },
        "claimBoundary": {
            "radiometricClosureClaimed": False,
            "modeRepresentationAuthority": False,
            "productionEligibilityClaimed": False,
        },
    }
    try:
        report = run_assay(args)
        report_path = args.output_dir / "report.json"
        report_path.write_text(json.dumps(FITTER.json_value(report), indent=2) + "\n", encoding="utf-8")
        print(report_path)
        return 0
    except Exception as exc:
        report["error"] = str(exc)
        report["traceback"] = traceback.format_exc()
        (args.output_dir / "report.json").write_text(json.dumps(FITTER.json_value(report), indent=2) + "\n", encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
