#!/usr/bin/env python3
"""Apply the frozen selective heads to a genuine native-low simulator field."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.native-low-selective-composition.v0"
IDENTITY = "native-low-zero-shot-selective-composition-v0"
INPUT_AUTHORITY = "native-low-simulator-state-no-synthetic-downsample-v0"
COMPOSITION_AUTHORITY = "frozen-exact-basin-heads-applied-to-native-low-state-v0"
CROSS_GRID_COMPOSITION_AUTHORITY = "frozen-trained-grid-heads-applied-to-explicit-cross-grid-native-state-v0"
NEAREST_MATERIALIZATION = "normalized-nearest-cell-low-to-output-grid-v0"
TRILINEAR_MATERIALIZATION = "normalized-trilinear-low-to-output-grid-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]


def model_identity(high_grid: int, low_grid: int) -> str:
    return f"exact-basin-selective-carrier-heads-{high_grid}-to-{low_grid}-v0"


class ApplicationFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--model-manifest", default=str(
        Path(__file__).with_name("models")
        / "selective-head-live" / "exact-basin-160-to-128-v0" / "manifest.json"
    ))
    parser.add_argument("--batch-cells", type=int, default=32768)
    parser.add_argument("--channels", default="fuel,visibleFireCarrier,fireLick,frontTopology")
    parser.add_argument("--residual-scale", type=float, default=1.0)
    parser.add_argument(
        "--materialization-mode",
        choices=[NEAREST_MATERIALIZATION, TRILINEAR_MATERIALIZATION],
        default=NEAREST_MATERIALIZATION,
    )
    parser.add_argument(
        "--allow-cross-grid-native-input",
        action="store_true",
        help="Explicitly apply the frozen model to a native grid different from its training low grid.",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def resolve_artifact_path(raw: str, manifest_path: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def verify_artifact(
    descriptor: dict[str, Any],
    manifest_path: Path,
    label: str,
    shape: list[int],
    channels: list[str],
) -> Path:
    path = resolve_artifact_path(str(descriptor.get("path") or ""), manifest_path)
    if not path.exists():
        raise ApplicationFailure("input-validation", f"missing {label}: {path}")
    if descriptor.get("shape") != shape or descriptor.get("channelOrder") != channels:
        raise ApplicationFailure("input-validation", f"{label} shape or channel order mismatch", {
            "expectedShape": shape,
            "actualShape": descriptor.get("shape"),
            "expectedChannels": channels,
            "actualChannels": descriptor.get("channelOrder"),
        })
    actual_bytes = path.stat().st_size
    if actual_bytes != int(descriptor.get("byteLength") or -1):
        raise ApplicationFailure("input-validation", f"{label} byte length mismatch")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != descriptor.get("sha256"):
        raise ApplicationFailure("input-validation", f"{label} SHA-256 mismatch", {"actualSha256": actual_sha256})
    return path


def artifact_descriptor(path: Path, shape: list[int], channels: list[str], dtype: str) -> dict[str, Any]:
    item_bytes = 1 if dtype == "uint8" else 4
    count = int(np.prod(shape, dtype=np.int64))
    return {
        "path": str(path),
        "shape": shape,
        "channelOrder": channels,
        "dtype": dtype if dtype == "uint8" else f"{dtype}-le",
        "byteOrder": "not-applicable" if item_bytes == 1 else "little-endian",
        "elementCount": count,
        "byteLength": count * item_bytes,
        "sha256": sha256_file(path),
    }


def load_probe_module() -> Any:
    path = Path(__file__).with_name("volume-exact-basin-support-probe.py")
    spec = importlib.util.spec_from_file_location("kaminos_exact_basin_support_probe", path)
    if spec is None or spec.loader is None:
        raise ApplicationFailure("implementation-load", f"cannot load feature implementation: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def packed_head(values: np.ndarray, descriptor: dict[str, Any], feature_count: int, hidden: int) -> dict[str, Any]:
    offsets = descriptor["offsets"]
    return {
        "w1": values[offsets["w1"]:offsets["w1"] + feature_count * hidden].reshape(feature_count, hidden),
        "b1": values[offsets["b1"]:offsets["b1"] + hidden].reshape(1, hidden),
        "w2": values[offsets["w2"]:offsets["w2"] + hidden].reshape(hidden, 1),
        "b2": values[offsets["b2"]:offsets["b2"] + 1].reshape(1, 1),
        "targetMean": float(values[offsets["targetMean"]]),
        "targetStd": float(values[offsets["targetStd"]]),
    }


def materialize_low_values(
    probe: Any,
    low_fluid: np.ndarray,
    low_front: np.ndarray,
    indexes: np.ndarray,
    low_grid: int,
    high_grid: int,
    mode: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    if mode == NEAREST_MATERIALIZATION:
        return probe.low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)

    x = indexes % high_grid
    y = (indexes // high_grid) % high_grid
    z = indexes // (high_grid * high_grid)

    def axis_coordinates(coordinates: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        q = (coordinates.astype(np.float64) + 0.5) * low_grid / high_grid - 0.5
        q = np.clip(q, 0.0, float(low_grid - 1))
        lower = np.floor(q).astype(np.int64)
        upper = np.minimum(low_grid - 1, lower + 1)
        return lower, upper, (q - lower).astype(np.float32)

    x0, x1, fx = axis_coordinates(x)
    y0, y1, fy = axis_coordinates(y)
    z0, z1, fz = axis_coordinates(z)

    def flat(ix: np.ndarray, iy: np.ndarray, iz: np.ndarray) -> np.ndarray:
        return ix + iy * low_grid + iz * low_grid * low_grid

    corners = [
        flat(x0, y0, z0), flat(x1, y0, z0), flat(x0, y1, z0), flat(x1, y1, z0),
        flat(x0, y0, z1), flat(x1, y0, z1), flat(x0, y1, z1), flat(x1, y1, z1),
    ]

    def interpolate(source: np.ndarray) -> np.ndarray:
        values = [np.asarray(source[corner], dtype=np.float32) for corner in corners]
        expand = (slice(None),) + (None,) * (values[0].ndim - 1)
        fxv, fyv, fzv = fx[expand], fy[expand], fz[expand]
        x00 = values[0] * (1.0 - fxv) + values[1] * fxv
        x10 = values[2] * (1.0 - fxv) + values[3] * fxv
        x01 = values[4] * (1.0 - fxv) + values[5] * fxv
        x11 = values[6] * (1.0 - fxv) + values[7] * fxv
        y0v = x00 * (1.0 - fyv) + x10 * fyv
        y1v = x01 * (1.0 - fyv) + x11 * fyv
        return (y0v * (1.0 - fzv) + y1v * fzv).astype(np.float32, copy=False)

    fluid_values = interpolate(low_fluid)
    front_values = interpolate(low_front)
    return np.concatenate([fluid_values, front_values[:, None]], axis=1), x, y, z


def fail_manifest(path: Path, phase: str, error: Exception, evidence: dict[str, Any]) -> None:
    if isinstance(error, ApplicationFailure):
        phase = error.phase
        evidence = error.evidence
    write_json(path, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence,
        "runtimeTruthAvailable": False,
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(args.manifest).resolve() if args.manifest else out_dir / "manifest.json"
    phase = "input-validation"
    evidence: dict[str, Any] = {}
    try:
        native_path = Path(args.native_manifest).resolve()
        model_manifest_path = Path(args.model_manifest).resolve()
        native = json.loads(native_path.read_text())
        model = json.loads(model_manifest_path.read_text())
        supported_channels = {"fuel", "visibleFireCarrier", "fireLick", "frontTopology"}
        deployed_channels = [channel.strip() for channel in args.channels.split(",") if channel.strip()]
        if not deployed_channels or len(set(deployed_channels)) != len(deployed_channels):
            raise ApplicationFailure(phase, "deployed channels must be a non-empty unique list")
        unknown_channels = sorted(set(deployed_channels) - supported_channels)
        if unknown_channels:
            raise ApplicationFailure(phase, f"unsupported deployed channels: {unknown_channels}")
        if not np.isfinite(args.residual_scale) or args.residual_scale < 0.0:
            raise ApplicationFailure(phase, "residual scale must be finite and non-negative")
        if native.get("schema") != "kaminos.volume.full-grid-field-export.v0" or native.get("status") != "captured":
            raise ApplicationFailure(phase, "native manifest is not a captured full-grid export")
        if native.get("failurePhase") is not None or native.get("completeFieldCoverage") is not True:
            raise ApplicationFailure(phase, "native export is partial or carries a failure phase")
        low_grid = int(native.get("grid") or 0)
        trained_low_grid = int(model.get("source", {}).get("lowGrid") or 0)
        high_grid = int(model.get("source", {}).get("highGrid") or 0)
        if trained_low_grid < 2 or high_grid <= trained_low_grid:
            raise ApplicationFailure(phase, "native/model grid relationship mismatch", {
                "nativeGrid": low_grid, "modelLowGrid": trained_low_grid, "modelHighGrid": high_grid,
            })
        expected_model_identity = str(model.get("identity") or "")
        if low_grid < 2 or low_grid > high_grid:
            raise ApplicationFailure(phase, "native grid is outside the normalized sampling domain", {
                "nativeGrid": low_grid, "outputGrid": high_grid,
            })
        if low_grid != trained_low_grid and not args.allow_cross_grid_native_input:
            raise ApplicationFailure(phase, "cross-grid native input requires explicit caller admission", {
                "nativeGrid": low_grid,
                "trainedLowGrid": trained_low_grid,
                "requiredFlag": "--allow-cross-grid-native-input",
            })
        cross_grid_application = low_grid != trained_low_grid
        composition_authority = (
            CROSS_GRID_COMPOSITION_AUTHORITY if cross_grid_application else COMPOSITION_AUTHORITY
        )
        if native.get("effectiveRoute") != "native-3d-compute-fluid-raymarch-v0":
            raise ApplicationFailure(phase, "native export route identity mismatch")
        deterministic = native.get("deterministicReplay") or {}
        if deterministic.get("grid") != low_grid or deterministic.get("authority") != "same-route-controls-fixed-step-replay":
            raise ApplicationFailure(phase, "native export lacks simulator replay authority")
        sidecars = native.get("sidecars") or {}
        low_fluid_path = verify_artifact(
            sidecars.get("fluid") or {}, native_path, "native fluid",
            [low_grid, low_grid, low_grid, 16], FLUID_CHANNELS,
        )
        low_front_path = verify_artifact(
            sidecars.get("front") or {}, native_path, "native front",
            [low_grid, low_grid, low_grid, 1], ["frontTopology"],
        )
        if (
            model.get("schema") != "kaminos.volume.selective-head-live-model.v0"
            or not expected_model_identity
            or model.get("status") != "captured"
            or model.get("failurePhase") is not None
        ):
            raise ApplicationFailure("model-validation", "frozen model schema/identity/status mismatch", {
                "actualIdentity": model.get("identity"),
            })
        packed_descriptor = model.get("packed") or {}
        packed_path = resolve_artifact_path(str(packed_descriptor.get("path") or ""), model_manifest_path)
        if packed_path.stat().st_size != int(packed_descriptor.get("byteLength") or -1):
            raise ApplicationFailure("model-validation", "frozen model byte length mismatch")
        model_sha256 = sha256_file(packed_path)
        if model_sha256 != packed_descriptor.get("sha256"):
            raise ApplicationFailure("model-validation", "frozen model SHA-256 mismatch", {"modelSha256": model_sha256})
        values = np.fromfile(packed_path, dtype="<f4")
        if values.size != int(packed_descriptor.get("floatCount") or -1):
            raise ApplicationFailure("model-validation", "frozen model float count mismatch")
        feature_count = int(model["features"]["featureCount"])
        hidden = int(model["architecture"]["hiddenWidth"])
        normalization = model["normalization"]
        feature_mean = values[
            normalization["featureMean"]["offset"]:
            normalization["featureMean"]["offset"] + normalization["featureMean"]["floatCount"]
        ]
        feature_std = values[
            normalization["featureStd"]["offset"]:
            normalization["featureStd"]["offset"] + normalization["featureStd"]["floatCount"]
        ]
        output_descriptors = {item["channel"]: item for item in model["outputs"]}
        missing_deployed_heads = sorted(set(deployed_channels) - set(output_descriptors))
        if missing_deployed_heads:
            raise ApplicationFailure("model-validation", f"model omitted deployed heads: {missing_deployed_heads}")
        if "supportProbability" not in output_descriptors:
            raise ApplicationFailure("model-validation", "model omitted supportProbability classifier")
        heads = {channel: packed_head(values, descriptor, feature_count, hidden) for channel, descriptor in output_descriptors.items()}
        evidence = {
            "nativeManifestPath": str(native_path),
            "nativeManifestSha256": sha256_file(native_path),
            "modelManifestPath": str(model_manifest_path),
            "modelManifestSha256": sha256_file(model_manifest_path),
            "modelSha256": model_sha256,
        }

        phase = "field-application"
        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        fluid_path = out_dir / "native-low-selective.fluid.f32"
        front_path = out_dir / "native-low-selective.front.f32"
        probability_path = out_dir / "native-low-selective.support-probability.f32"
        mask_path = out_dir / "native-low-selective.support-mask.u8"
        fluid_out = np.memmap(fluid_path, dtype="<f4", mode="w+", shape=(high_cells, 16))
        front_out = np.memmap(front_path, dtype="<f4", mode="w+", shape=(high_cells,))
        probability_out = np.memmap(probability_path, dtype="<f4", mode="w+", shape=(high_cells,))
        mask_out = np.memmap(mask_path, dtype="u1", mode="w+", shape=(high_cells,))
        probe = load_probe_module()
        threshold = float(model["composition"]["supportThreshold"])
        positive_count = 0
        batch_cells = max(1, int(args.batch_cells))
        for start in range(0, high_cells, batch_cells):
            end = min(high_cells, start + batch_cells)
            indexes = np.arange(start, end, dtype=np.int64)
            low_values, x, y, z = materialize_low_values(
                probe, low_fluid, low_front, indexes, low_grid, high_grid, args.materialization_mode,
            )
            features = probe.build_features(low_values, x, y, z, high_grid)
            features = ((features - feature_mean) / feature_std).astype(np.float32, copy=False)
            probability = probe.predict_mlp(features, heads["supportProbability"], binary=True)
            hard_mask = probability >= np.float32(threshold)
            fluid_out[start:end] = low_values[:, :16]
            front_out[start:end] = low_values[:, 16]
            probability_out[start:end] = probability
            mask_out[start:end] = hard_mask.astype(np.uint8)
            positive_count += int(np.count_nonzero(hard_mask))
            for channel in ("fuel", "visibleFireCarrier", "fireLick"):
                if channel not in deployed_channels:
                    continue
                channel_index = FLUID_CHANNELS.index(channel)
                residual = probe.predict_mlp(features, heads[channel], binary=False)
                fluid_out[start:end, channel_index] = (
                    low_values[:, channel_index]
                    + residual * hard_mask.astype(np.float32) * np.float32(args.residual_scale)
                )
            if "frontTopology" in deployed_channels:
                front_out[start:end] = (
                    low_values[:, 16]
                    + probe.predict_mlp(features, heads["frontTopology"], binary=False)
                    * np.float32(args.residual_scale)
                )
        for output in (fluid_out, front_out, probability_out, mask_out):
            output.flush()
        del fluid_out, front_out, probability_out, mask_out

        phase = "report-write"
        native_manifest_sha256 = evidence["nativeManifestSha256"]
        same_native_state_identity = hashlib.sha256(
            f"{native_manifest_sha256}:{sidecars['fluid']['sha256']}:{sidecars['front']['sha256']}".encode()
        ).hexdigest()
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "inputAuthority": INPUT_AUTHORITY,
            "compositionAuthority": composition_authority,
            "runtimeTruthAvailable": False,
            "sameNativeStateIdentity": same_native_state_identity,
            "source": {
                **evidence,
                "nativeGrid": low_grid,
                "nativeSimStepCount": deterministic.get("simStepCount"),
                "nativeReplayAuthority": deterministic.get("authority"),
                "nativeControlsSignature": deterministic.get("controlsSignature"),
                "effectiveRoute": native.get("effectiveRoute"),
                "backend": native.get("backend"),
                "fluid": {**sidecars["fluid"], "path": str(low_fluid_path)},
                "front": {**sidecars["front"], "path": str(low_front_path)},
            },
            "model": {
                "identity": expected_model_identity,
                "modelSha256": model_sha256,
                "manifestPath": str(model_manifest_path),
                "manifestSha256": evidence["modelManifestSha256"],
                "trainingPairAuthority": model.get("source", {}).get("pairAuthority"),
                "trainingInputAuthority": model.get("source", {}).get("trainingInputAuthority"),
                "trainingInputSyntheticDownsample": model.get("source", {}).get("trainingInputSyntheticDownsample"),
                "nativeDeploymentInputSeenDuringTraining": model.get("source", {}).get("nativeDeploymentInputSeenDuringTraining"),
                "trainedLowGrid": trained_low_grid,
                "trainedHighGrid": high_grid,
                "features": model.get("features"),
                "architecture": model.get("architecture"),
            },
            "relationship": {
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "trainedLowGrid": trained_low_grid,
                "applicationLowGrid": low_grid,
                "outputGrid": high_grid,
                "crossGridApplication": cross_grid_application,
                "crossGridCallerAdmission": bool(args.allow_cross_grid_native_input),
                "samplingIdentity": args.materialization_mode,
                "applicationInput": "native low simulator field only",
                "syntheticDownsampleApplied": False,
                "trainingInputSyntheticDownsample": model.get("source", {}).get("trainingInputSyntheticDownsample"),
                "nativeDeploymentInputSeenDuringTraining": model.get("source", {}).get("nativeDeploymentInputSeenDuringTraining"),
                "highTruthUse": "unavailable; not loaded and not used for application or metrics",
            },
            "support": {
                "threshold": threshold,
                "thresholdAuthority": model["composition"].get("supportThresholdAuthority"),
                "predictedPositiveCount": positive_count,
                "predictedPrevalence": float(positive_count / high_cells),
                "probability": artifact_descriptor(
                    probability_path, [high_grid, high_grid, high_grid, 1], ["acceptedSplatProbability"], "float32"
                ),
                "hardMask": artifact_descriptor(
                    mask_path, [high_grid, high_grid, high_grid, 1], ["acceptedSplatHardMask"], "uint8"
                ),
            },
            "deployment": {
                "channels": deployed_channels,
                "residualScale": float(args.residual_scale),
                "supportClassifierUse": "diagnostic-and-sparse-carrier-gating-only-v0",
                "frontTopologySupportGated": False,
            },
            "channelPolicies": {
                "fuel": "sparse-hard-support-gated-residual-v0" if "fuel" in deployed_channels else "deterministic-materialization-only-v0",
                "visibleFireCarrier": "sparse-hard-support-gated-residual-v0" if "visibleFireCarrier" in deployed_channels else "deterministic-materialization-only-v0",
                "fireLick": "sparse-hard-support-gated-residual-v0" if "fireLick" in deployed_channels else "deterministic-materialization-only-v0",
                "frontTopology": "dense-ungated-residual-v0" if "frontTopology" in deployed_channels else "deterministic-materialization-only-v0",
            },
            "receiver": {
                "grid": high_grid,
                "initialSimStepCount": 0,
                "fluid": artifact_descriptor(
                    fluid_path, [high_grid, high_grid, high_grid, 16], FLUID_CHANNELS, "float32"
                ),
                "front": artifact_descriptor(
                    front_path, [high_grid, high_grid, high_grid, 1], ["frontTopology"], "float32"
                ),
            },
            "batching": {"batchCells": batch_cells, "cellCount": high_cells, "completeFieldCoverage": True},
            "consumptionContract": {
                "requiresExplicitSchemaAdmission": True,
                "mustNotBeAcceptedAs": "filtered-high initialization truth or phase-aligned low control",
                "receiverAdvance": "held render only; simulation advance is forbidden for this assay",
            },
            "limitations": [
                f"Frozen heads were trained on one synthetic phase-aligned {high_grid}-to-{trained_low_grid} basin.",
                (
                    f"This is an explicit cross-grid zero-shot application from native {low_grid} to output {high_grid}; "
                    f"the model training low grid remains {trained_low_grid}."
                    if cross_grid_application
                    else f"This is a zero-shot application to a genuinely native {low_grid}-grid simulator state."
                ),
                "No high truth exists at the native phase, so visual coherence and persistence are the discriminants.",
            ],
        }
        write_json(manifest_path, report)
        print(json.dumps({
            "status": "captured",
            "manifest": str(manifest_path),
            "sameNativeStateIdentity": same_native_state_identity,
            "predictedPositiveCount": positive_count,
            "predictedPrevalence": report["support"]["predictedPrevalence"],
        }, indent=2))
        return 0
    except Exception as error:
        fail_manifest(manifest_path, phase, error, evidence)
        effective_phase = error.phase if isinstance(error, ApplicationFailure) else phase
        print(f"native-low selective application failed at {effective_phase}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
