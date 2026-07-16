#!/usr/bin/env python3
"""Compose a frozen held Vivisector cue pack into renderer-consumable fields."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.vivisector-held-package-composition.v0"
AUTHORITY = "learned-vivisector-held-package-composition-not-truth-v0"
INFERENCE_AUTHORITY = "precomputed-held-package-inference-not-live-runtime-v0"
FIELD_LAYOUT = "x-fastest-zyx-c-interleaved-v0"
PACKAGE_SHA256 = "15ed4ef7762e89e467bb1fecaba6e270f0b98be9bc06dfd3bd928fbc50d65309"
WEIGHTS_SHA256 = "c648ec41d57e8810a40c30b006c0809ee1707777f75662cfcca69c05d036845f"
TRAINING_MANIFEST_SHA256 = "df456e8837bdf08a540935dffef7737de688734c13213b8ded5be5837bc4ebd7"
STEP101_CUE_SHA256 = "63e04c6bd4fd08de7f7db1f1136c67bef7be96d46d03d660b1d83dfb198ea58c"
STEP101_GATE_SHA256 = "dee83581d4c4746c13c5afc1f84422bbe60855324790669873d38c777e387140"
FIELD_EXPORT_SCHEMA = "kaminos.volume.full-grid-field-export.v0"
EXPECTED_ROUTE = "native-3d-compute-fluid-raymarch-v0"
EXPECTED_BACKEND = "WebGPU:apple"
SOURCE_GRID = 128
TARGET_GRID = 160
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier", "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront", "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
OUTPUT_CHANNELS = [
    "fineSupport", "frontTopologyResidual", "temporalFrontDetail", "ridgeResidual",
    "fuelResidual", "visibleFireCarrierResidual", "fireLickResidual", "detailResidual",
]
BOUNDARY_CHANNELS = ["support", "coverage", "ridge", "footprint"]
RESIDUAL_APPLICATIONS = {
    "frontTopologyResidual": ("front", 0, 0.0, 1.0),
    "fuelResidual": ("fluid", 6, 0.0, 1.0),
    "visibleFireCarrierResidual": ("fluid", 10, 0.0, 1.8),
    "fireLickResidual": ("fluid", 14, 0.0, 1.8),
    "detailResidual": ("fluid", 7, 0.0, 1.8),
}


class CompositionFailure(RuntimeError):
    def __init__(self, phase: str, message: str):
        super().__init__(message)
        self.phase = phase


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-manifest", required=True)
    parser.add_argument("--step", type=int, default=101)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--batch-cells", type=int, default=262144)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def resolve_path(raw: str, owner: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (owner.parent / path).resolve()


def verify_file(path: Path, expected_sha: str, expected_bytes: int, label: str, phase: str) -> None:
    if not path.exists():
        raise CompositionFailure(phase, f"{label} missing: {path}")
    if path.stat().st_size != expected_bytes:
        raise CompositionFailure(phase, f"{label} byte length mismatch: {path.stat().st_size}/{expected_bytes}")
    actual = sha256_file(path)
    if actual != expected_sha:
        raise CompositionFailure(phase, f"{label} SHA-256 mismatch: {actual}/{expected_sha}")


def verify_artifact(
    descriptor: dict[str, Any], owner: Path, shape: list[int], channels: list[str], label: str, phase: str,
) -> Path:
    if descriptor.get("shape") != shape:
        raise CompositionFailure(phase, f"{label} shape mismatch: {descriptor.get('shape')}/{shape}")
    if descriptor.get("channelOrder") != channels:
        raise CompositionFailure(phase, f"{label} channel order mismatch")
    path = resolve_path(str(descriptor.get("path") or ""), owner)
    verify_file(path, str(descriptor.get("sha256") or ""), int(descriptor.get("byteLength") or -1), label, phase)
    return path


def descriptor(path: Path, shape: list[int], channels: list[str], dtype: str = "float32-le") -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "byteLength": path.stat().st_size,
        "dtype": dtype,
        "shape": shape,
        "channelOrder": channels,
    }


def resize_axis(values: np.ndarray, target: int, axis: int) -> np.ndarray:
    source = values.shape[axis]
    coordinate = (np.arange(target, dtype=np.float32) + 0.5) * (source / target) - 0.5
    lower = np.floor(coordinate).astype(np.intp)
    upper = lower + 1
    fraction = coordinate - lower
    lower = np.clip(lower, 0, source - 1)
    upper = np.clip(upper, 0, source - 1)
    shape = [1] * values.ndim
    shape[axis] = target
    fraction = fraction.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - fraction) + np.take(values, upper, axis=axis) * fraction


def trilinear_resize(values: np.ndarray, target: int) -> np.ndarray:
    return resize_axis(resize_axis(resize_axis(values, target, 2), target, 1), target, 0).astype(np.float32)


def load_field_manifest(path: Path, grid: int, phase: str) -> dict[str, Any]:
    raw = path.read_text()
    manifest = json.loads(raw)
    if manifest.get("schema") != FIELD_EXPORT_SCHEMA:
        raise CompositionFailure(phase, f"field manifest schema mismatch: {path}")
    if manifest.get("status") != "captured" or manifest.get("failurePhase") is not None:
        raise CompositionFailure(phase, f"field manifest is not captured cleanly: {path}")
    if manifest.get("grid") != grid or manifest.get("completeFieldCoverage") is not True:
        raise CompositionFailure(phase, f"field manifest grid/coverage mismatch: {path}")
    if manifest.get("effectiveRoute") != EXPECTED_ROUTE or manifest.get("backend") != EXPECTED_BACKEND:
        raise CompositionFailure(phase, f"field manifest route/backend mismatch: {path}")
    fluid = manifest.get("sidecars", {}).get("fluid") or {}
    front = manifest.get("sidecars", {}).get("front") or {}
    boundary = manifest.get("boundarySidecar", {}).get("sidecars", {}).get("boundary") or {}
    return {
        "path": path,
        "sha256": sha256_text(raw),
        "manifest": manifest,
        "fluidDescriptor": fluid,
        "frontDescriptor": front,
        "boundaryDescriptor": boundary,
        "fluidPath": verify_artifact(fluid, path, [grid, grid, grid, 16], FLUID_CHANNELS, "fluid", phase),
        "frontPath": verify_artifact(front, path, [grid, grid, grid, 1], ["frontTopology"], "front", phase),
        "boundaryPath": verify_artifact(boundary, path, [grid, grid, grid, 4], BOUNDARY_CHANNELS, "boundary sidecar", phase),
    }


def validate_native_source_authority(field: dict[str, Any], phase: str) -> dict[str, Any]:
    source_capture = field["manifest"].get("sourceCapture") or {}
    if source_capture.get("schema") != "kaminos.operator-exact-live-splat-basin-capture.v1":
        raise CompositionFailure(phase, "native source capture schema mismatch")
    if source_capture.get("identity") != "derived-native-low-128-exact-splat-basin-v0":
        raise CompositionFailure(phase, "native source capture identity mismatch")
    if source_capture.get("hashMatches") is not True:
        raise CompositionFailure(phase, "native source capture hash is not verified")
    payload_sha = source_capture.get("payloadSha256")
    if not isinstance(payload_sha, str) or payload_sha != source_capture.get("actualPayloadSha256"):
        raise CompositionFailure(phase, "native source capture payload hash mismatch")
    return {
        "identity": "native-source-capture-authority-v0",
        "schema": source_capture["schema"],
        "captureIdentity": source_capture["identity"],
        "payloadSha256": payload_sha,
        "hashMatches": True,
    }


def role_manifest(
    role: str,
    authority: str,
    runtime_truth_available: bool,
    source: dict[str, Any],
    fluid: dict[str, Any],
    front: dict[str, Any],
    boundary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema": "kaminos.volume.phase-aligned-held-field.v0",
        "identity": "phase-aligned-held-render-field-v0",
        "status": "captured",
        "failurePhase": None,
        "role": role,
        "initializationAuthority": authority,
        "runtimeTruthAvailable": runtime_truth_available,
        "renderOnly": True,
        "expectedRoute": EXPECTED_ROUTE,
        "expectedBackend": EXPECTED_BACKEND,
        "layoutIdentity": FIELD_LAYOUT,
        "source": source,
        "receiver": {
            "grid": TARGET_GRID,
            "initialSimStepCount": 0,
            "fluid": fluid,
            "front": front,
            "boundarySidecar": boundary,
        },
    }


def metric(low: np.ndarray, predicted: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    low_error = np.asarray(low, dtype=np.float64) - np.asarray(truth, dtype=np.float64)
    pred_error = np.asarray(predicted, dtype=np.float64) - np.asarray(truth, dtype=np.float64)
    low_sse = float(np.dot(low_error, low_error))
    pred_sse = float(np.dot(pred_error, pred_error))
    return {
        "lowRmse": float(np.sqrt(low_sse / max(1, truth.size))),
        "predictedRmse": float(np.sqrt(pred_sse / max(1, truth.size))),
        "errorReductionVsLow": float(1.0 - pred_sse / low_sse) if low_sse > 0 else 0.0,
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "manifest.json"
    phase = "package-validation"
    evidence: dict[str, Any] = {}
    try:
        package_manifest_path = Path(args.package_manifest).resolve()
        package_manifest_raw = package_manifest_path.read_text()
        package_manifest_sha256 = sha256_text(package_manifest_raw)
        if package_manifest_sha256 != TRAINING_MANIFEST_SHA256:
            raise CompositionFailure(phase, "training manifest SHA-256 differs from the reviewed package wrapper")
        package_manifest = json.loads(package_manifest_raw)
        if (
            package_manifest.get("schema") != "kaminos.volume.vivisector-candidate-head-training.v0"
            or package_manifest.get("identity") != "native128-matched160-shared-coarse-candidate-head-v0"
            or package_manifest.get("status") != "captured"
            or package_manifest.get("failurePhase") is not None
            or package_manifest.get("route") != EXPECTED_ROUTE
            or package_manifest.get("backend") != EXPECTED_BACKEND
            or package_manifest.get("sourceGrid") != SOURCE_GRID
            or package_manifest.get("targetGrid") != TARGET_GRID
        ):
            raise CompositionFailure(phase, "reviewed training manifest contract mismatch")
        package_descriptor = package_manifest.get("package") or {}
        package_path = resolve_path(str(package_descriptor.get("path") or ""), package_manifest_path)
        verify_file(package_path, PACKAGE_SHA256, int(package_path.stat().st_size), "package", phase)
        if package_descriptor.get("sha256") != PACKAGE_SHA256:
            raise CompositionFailure(phase, "package manifest does not bind the expected package SHA-256")
        package = json.loads(package_path.read_text())
        if package.get("model", {}).get("sha256") != WEIGHTS_SHA256:
            raise CompositionFailure(phase, "trained weights SHA-256 differs")
        if package.get("visualClaim") is not False or package.get("fidelityClaim") is not False:
            raise CompositionFailure(phase, "package visual/fidelity claim boundary differs")
        step = int(args.step)
        if step not in package.get("splits", {}).get("heldCurrentSteps", []):
            raise CompositionFailure(phase, f"step {step} is not held")
        binding = package_manifest.get("sourceBindings", {}).get(str(step)) or {}
        native_manifest_path = Path(str(binding.get("nativeManifestPath") or "")).resolve()
        teacher_manifest_path = Path(str(binding.get("teacherManifestPath") or "")).resolve()
        if sha256_file(native_manifest_path) != binding.get("nativeManifestSha256"):
            raise CompositionFailure(phase, "nativeManifestSha256 mismatch")
        if sha256_file(teacher_manifest_path) != binding.get("teacherManifestSha256"):
            raise CompositionFailure(phase, "teacherManifestSha256 mismatch")
        cue_pack = next((item for item in package.get("crossStepFieldPack", []) if item.get("step") == step), None)
        if not cue_pack:
            raise CompositionFailure(phase, f"held cue pack missing for step {step}")
        cue_descriptor = cue_pack.get("cue") or {}
        gate_descriptor = cue_pack.get("admissionMask") or {}
        cue_path = verify_artifact(
            cue_descriptor, package_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 8], OUTPUT_CHANNELS, "held cue", phase,
        )
        gate_path = verify_artifact(
            gate_descriptor, package_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 1], ["sourceHistoryCandidate"], "source gate", phase,
        )
        if step == 101 and (cue_descriptor.get("sha256") != STEP101_CUE_SHA256 or gate_descriptor.get("sha256") != STEP101_GATE_SHA256):
            raise CompositionFailure(phase, "step 101 cue/gate package identity differs")
        evidence = {
            "packageManifestPath": str(package_manifest_path),
            "packageManifestSha256": package_manifest_sha256,
            "packagePath": str(package_path),
            "packageSha256": PACKAGE_SHA256,
            "weightsSha256": WEIGHTS_SHA256,
            "step": step,
            "nativeManifestPath": str(native_manifest_path),
            "nativeManifestSha256": binding.get("nativeManifestSha256"),
            "teacherManifestPath": str(teacher_manifest_path),
            "teacherManifestSha256": binding.get("teacherManifestSha256"),
            "cueSha256": cue_descriptor.get("sha256"),
            "admissionMaskSha256": gate_descriptor.get("sha256"),
            "expectedRoute": EXPECTED_ROUTE,
            "expectedBackend": EXPECTED_BACKEND,
            "inferenceReceipt": "checksum-bound-precomputed-cue-from-pinned-training-manifest-v0",
        }

        phase = "field-validation"
        low = load_field_manifest(native_manifest_path, SOURCE_GRID, phase)
        high = load_field_manifest(teacher_manifest_path, TARGET_GRID, phase)
        evidence["nativeSourceAuthority"] = validate_native_source_authority(low, phase)

        phase = "low-field-upsampling"
        low_fluid = np.memmap(low["fluidPath"], dtype="<f4", mode="r", shape=(SOURCE_GRID, SOURCE_GRID, SOURCE_GRID, 16))
        low_front = np.memmap(low["frontPath"], dtype="<f4", mode="r", shape=(SOURCE_GRID, SOURCE_GRID, SOURCE_GRID))
        low_boundary = np.memmap(low["boundaryPath"], dtype="<f4", mode="r", shape=(SOURCE_GRID, SOURCE_GRID, SOURCE_GRID, 4))
        low_fluid_path = out_dir / "low-phase-aligned.fluid.f32"
        low_front_path = out_dir / "low-phase-aligned.front.f32"
        low_boundary_path = out_dir / "low-phase-aligned.boundary.f32"
        low_fluid_out = np.memmap(low_fluid_path, dtype="<f4", mode="w+", shape=(TARGET_GRID, TARGET_GRID, TARGET_GRID, 16))
        for channel in range(16):
            low_fluid_out[..., channel] = trilinear_resize(low_fluid[..., channel], TARGET_GRID)
        low_front_out = np.memmap(low_front_path, dtype="<f4", mode="w+", shape=(TARGET_GRID, TARGET_GRID, TARGET_GRID))
        low_front_out[...] = trilinear_resize(low_front, TARGET_GRID)
        low_boundary_out = np.memmap(low_boundary_path, dtype="<f4", mode="w+", shape=(TARGET_GRID, TARGET_GRID, TARGET_GRID, 4))
        for channel in range(4):
            low_boundary_out[..., channel] = trilinear_resize(low_boundary[..., channel], TARGET_GRID)
        for output in (low_fluid_out, low_front_out, low_boundary_out):
            output.flush()

        phase = "held-package-composition"
        pred_fluid_path = out_dir / "vivisector-predicted.fluid.f32"
        pred_front_path = out_dir / "vivisector-predicted.front.f32"
        pred_boundary_path = out_dir / "vivisector-predicted.boundary.f32"
        pred_fluid = np.memmap(pred_fluid_path, dtype="<f4", mode="w+", shape=(TARGET_GRID ** 3, 16))
        pred_front = np.memmap(pred_front_path, dtype="<f4", mode="w+", shape=(TARGET_GRID ** 3,))
        pred_boundary = np.memmap(pred_boundary_path, dtype="<f4", mode="w+", shape=(TARGET_GRID ** 3, 4))
        low_fluid_flat = low_fluid_out.reshape(-1, 16)
        low_front_flat = low_front_out.reshape(-1)
        low_boundary_flat = low_boundary_out.reshape(-1, 4)
        pred_fluid[:] = low_fluid_flat
        pred_front[:] = low_front_flat
        pred_boundary[:] = low_boundary_flat
        cues = np.memmap(cue_path, dtype="<f4", mode="r", shape=(TARGET_GRID ** 3, 8))
        gate = np.memmap(gate_path, dtype="u1", mode="r", shape=(TARGET_GRID ** 3,))
        admitted = gate != 0
        if int(np.count_nonzero(admitted)) != int(package_manifest.get("heldMetrics", {}).get(str(step), {}).get("candidateCount", -1)):
            raise CompositionFailure(phase, "sourceHistoryCandidate count differs from held metrics")
        for name, (kind, channel, minimum, maximum) in RESIDUAL_APPLICATIONS.items():
            cue_index = OUTPUT_CHANNELS.index(name)
            if kind == "front":
                pred_front[admitted] = np.clip(low_front_flat[admitted] + cues[admitted, cue_index], minimum, maximum)
            else:
                pred_fluid[admitted, channel] = np.clip(
                    low_fluid_flat[admitted, channel] + cues[admitted, cue_index], minimum, maximum,
                )
        pred_boundary[admitted, 0] = np.clip(cues[admitted, OUTPUT_CHANNELS.index("fineSupport")], 0.0, 1.0)
        pred_boundary[admitted, 2] = np.clip(
            low_boundary_flat[admitted, 2] + cues[admitted, OUTPUT_CHANNELS.index("ridgeResidual")], 0.0, 1.0,
        )
        for output in (pred_fluid, pred_front, pred_boundary):
            output.flush()

        phase = "artifact-description"
        low_fluid_descriptor = descriptor(low_fluid_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 16], FLUID_CHANNELS)
        low_front_descriptor = descriptor(low_front_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 1], ["frontTopology"])
        low_boundary_descriptor = descriptor(low_boundary_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 4], BOUNDARY_CHANNELS)
        pred_fluid_descriptor = descriptor(pred_fluid_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 16], FLUID_CHANNELS)
        pred_front_descriptor = descriptor(pred_front_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 1], ["frontTopology"])
        pred_boundary_descriptor = descriptor(pred_boundary_path, [TARGET_GRID, TARGET_GRID, TARGET_GRID, 4], BOUNDARY_CHANNELS)
        high_fluid_descriptor = {**high["fluidDescriptor"], "path": str(high["fluidPath"])}
        high_front_descriptor = {**high["frontDescriptor"], "path": str(high["frontPath"])}
        high_boundary_descriptor = {**high["boundaryDescriptor"], "path": str(high["boundaryPath"])}
        source = {
            **evidence,
            "highTruthUse": "offline metrics and reference role only; never read by prediction composition",
            "inferenceInputs": "native128 current and previous source fields plus trained coarse latent embedded in frozen cue pack",
        }
        truth_manifest = role_manifest(
            "truthHigh", "offline-high-truth-held-render-only-v0", True, source,
            high_fluid_descriptor, high_front_descriptor, high_boundary_descriptor,
        )
        low_manifest = role_manifest(
            "lowPhaseAligned", "downsampled-same-high-history-held-control-v0", False, source,
            low_fluid_descriptor, low_front_descriptor, low_boundary_descriptor,
        )
        predicted_manifest = {
            "schema": SCHEMA,
            "identity": "vivisector-held-two-stage-residual-composition-v0",
            "status": "captured",
            "failurePhase": None,
            "compositionAuthority": AUTHORITY,
            "inferenceAuthority": INFERENCE_AUTHORITY,
            "expectedRoute": EXPECTED_ROUTE,
            "expectedBackend": EXPECTED_BACKEND,
            "runtimeTruthAvailable": False,
            "renderOnly": True,
            "layoutIdentity": FIELD_LAYOUT,
            "source": source,
            "relationship": {
                "sourceGrid": SOURCE_GRID,
                "targetGrid": TARGET_GRID,
                "step": step,
                "previousStep": cue_pack.get("previousStep"),
                "admissionChannel": "sourceHistoryCandidate",
                "highTruthUse": "offline metrics and reference role only; never read by prediction composition",
            },
            "composition": {
                "stateResiduals": list(RESIDUAL_APPLICATIONS),
                "boundaryDirect": ["fineSupport"],
                "boundaryResiduals": ["ridgeResidual"],
                "temporalFrontDetail": "excluded-from-held-present-state-composition-v0",
            },
            "receiver": {
                "grid": TARGET_GRID,
                "initialSimStepCount": 0,
                "fluid": pred_fluid_descriptor,
                "front": pred_front_descriptor,
                "boundarySidecar": pred_boundary_descriptor,
            },
            "completeFieldCoverage": True,
            "consumptionContract": {
                "requiresExplicitSchemaAdmission": True,
                "mustNotBeAcceptedAs": [
                    "kaminos.volume.coarse-receiver-initial.v0",
                    "kaminos.volume.exact-basin-selective-composition.v0",
                    "live-runtime-inference",
                ],
            },
            "limitations": [
                "Held-step still composition only; temporal stability and live GPU runtime remain unclaimed.",
                "The package predicts only the sourceHistoryCandidate admission region; all other cells remain phase-aligned low control.",
            ],
        }
        role_paths = {
            "truthHigh": out_dir / "truthHigh.manifest.json",
            "lowPhaseAligned": out_dir / "lowPhaseAligned.manifest.json",
            "vivisectorPredicted": out_dir / "vivisectorPredicted.manifest.json",
        }
        write_json(role_paths["truthHigh"], truth_manifest)
        write_json(role_paths["lowPhaseAligned"], low_manifest)
        write_json(role_paths["vivisectorPredicted"], predicted_manifest)

        phase = "offline-metrics"
        high_fluid = np.memmap(high["fluidPath"], dtype="<f4", mode="r", shape=(TARGET_GRID ** 3, 16))
        high_front = np.memmap(high["frontPath"], dtype="<f4", mode="r", shape=(TARGET_GRID ** 3,))
        high_boundary = np.memmap(high["boundaryPath"], dtype="<f4", mode="r", shape=(TARGET_GRID ** 3, 4))
        metrics = {
            "frontTopology": metric(low_front_flat, pred_front, high_front),
            "fuel": metric(low_fluid_flat[:, 6], pred_fluid[:, 6], high_fluid[:, 6]),
            "visibleFireCarrier": metric(low_fluid_flat[:, 10], pred_fluid[:, 10], high_fluid[:, 10]),
            "fireLick": metric(low_fluid_flat[:, 14], pred_fluid[:, 14], high_fluid[:, 14]),
            "detail": metric(low_fluid_flat[:, 7], pred_fluid[:, 7], high_fluid[:, 7]),
            "boundarySupport": metric(low_boundary_flat[:, 0], pred_boundary[:, 0], high_boundary[:, 0]),
            "boundaryRidge": metric(low_boundary_flat[:, 2], pred_boundary[:, 2], high_boundary[:, 2]),
        }
        report = {
            "schema": SCHEMA,
            "identity": "vivisector-held-package-three-role-composition-v0",
            "status": "captured",
            "failurePhase": None,
            "lastTrustworthyEvidence": {**evidence, "phase": phase},
            "compositionAuthority": AUTHORITY,
            "inferenceAuthority": INFERENCE_AUTHORITY,
            "expectedRoute": EXPECTED_ROUTE,
            "expectedBackend": EXPECTED_BACKEND,
            "completeFieldCoverage": True,
            "highTruthUse": "offline metrics and reference role only; never read by prediction composition",
            "roles": {name: {"manifestPath": str(path), "manifestSha256": sha256_file(path)} for name, path in role_paths.items()},
            "metrics": metrics,
        }
        write_json(report_path, report)
        print(json.dumps({"status": "captured", "manifest": str(report_path), "metrics": metrics}, indent=2))
        return 0
    except Exception as error:
        effective_phase = error.phase if isinstance(error, CompositionFailure) else phase
        write_json(report_path, {
            "schema": SCHEMA,
            "identity": "vivisector-held-package-three-role-composition-v0",
            "status": "failed",
            "failurePhase": effective_phase,
            "error": str(error),
            "lastTrustworthyEvidence": {**evidence, "phase": effective_phase},
        })
        print(f"Vivisector held-package composition failed at {effective_phase}: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
