#!/usr/bin/env python3
"""Apply exact-basin support and channel checkpoints to a complete high-grid field."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.exact-basin-selective-composition.v0"
IDENTITY = "dense-topology-plus-support-aware-sparse-carriers-v0"
AUTHORITY = "learned-selective-head-composition-not-filtered-high-truth-v0"
DENSE_POLICY = "dense-ungated-residual-v0"
SPARSE_POLICY = "sparse-hard-support-gated-residual-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
SUPPORTED_POLICIES = {
    "frontTopology": DENSE_POLICY,
    "fuel": SPARSE_POLICY,
    "fireLick": SPARSE_POLICY,
    "visibleFireCarrier": SPARSE_POLICY,
}


class CompositionFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True)
    parser.add_argument("--support-probe-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--batch-cells", type=int, default=32768)
    return parser.parse_args()


def load_probe_module() -> Any:
    path = Path(__file__).with_name("volume-exact-basin-support-probe.py")
    spec = importlib.util.spec_from_file_location("kaminos_exact_basin_support_probe", path)
    if spec is None or spec.loader is None:
        raise CompositionFailure("implementation-load", f"cannot load support probe implementation from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
    phase: str,
    label: str,
    expected_shape: list[int] | None = None,
    expected_channels: list[str] | None = None,
) -> Path:
    path = resolve_artifact_path(str(descriptor.get("path") or ""), manifest_path)
    if not path.exists():
        raise CompositionFailure(phase, f"missing {label}: {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if actual_bytes != expected_bytes:
        raise CompositionFailure(phase, f"{label} byte length mismatch", {
            "path": str(path), "expectedBytes": expected_bytes, "actualBytes": actual_bytes,
        })
    expected_sha = str(descriptor.get("sha256") or "")
    actual_sha = sha256_file(path)
    if not expected_sha or actual_sha != expected_sha:
        raise CompositionFailure(phase, f"{label} SHA-256 mismatch", {
            "path": str(path), "expectedSha256": expected_sha, "actualSha256": actual_sha,
        })
    if expected_shape is not None and descriptor.get("shape") != expected_shape:
        raise CompositionFailure(phase, f"{label} shape mismatch", {
            "expected": expected_shape, "actual": descriptor.get("shape"),
        })
    if expected_channels is not None and descriptor.get("channelOrder") != expected_channels:
        raise CompositionFailure(phase, f"{label} channel order mismatch", {
            "expected": expected_channels, "actual": descriptor.get("channelOrder"),
        })
    return path


def model_state(archive: Any, prefix: str = "") -> dict[str, np.ndarray | float]:
    def name(key: str) -> str:
        return f"{prefix}.{key}" if prefix else key

    required = [name(key) for key in ["w1", "b1", "w2", "b2", "targetMean", "targetStd"]]
    missing = [key for key in required if key not in archive.files]
    if missing:
        raise CompositionFailure("model-validation", f"model omitted arrays: {missing}")
    return {
        "w1": np.asarray(archive[name("w1")], dtype=np.float32),
        "b1": np.asarray(archive[name("b1")], dtype=np.float32),
        "w2": np.asarray(archive[name("w2")], dtype=np.float32),
        "b2": np.asarray(archive[name("b2")], dtype=np.float32),
        "targetMean": float(np.asarray(archive[name("targetMean")]).reshape(-1)[0]),
        "targetStd": float(np.asarray(archive[name("targetStd")]).reshape(-1)[0]),
    }


def artifact_descriptor(path: Path, shape: list[int], channels: list[str], dtype: str) -> dict[str, Any]:
    item_bytes = 1 if dtype == "uint8" else 4
    count = int(np.prod(shape, dtype=np.int64))
    return {
        "path": str(path),
        "shape": shape,
        "channelOrder": channels,
        "dtype": f"{dtype}-le" if dtype != "uint8" else dtype,
        "byteOrder": "little-endian" if item_bytes > 1 else "not-applicable",
        "elementCount": count,
        "byteLength": count * item_bytes,
        "sha256": sha256_file(path),
    }


def metric_accumulator() -> dict[str, float]:
    return {"count": 0.0, "lowSquared": 0.0, "composedSquared": 0.0, "lowAbs": 0.0, "composedAbs": 0.0}


def update_metrics(
    accumulator: dict[str, float], low: np.ndarray, composed: np.ndarray, truth: np.ndarray,
) -> None:
    low_error = low.astype(np.float64) - truth.astype(np.float64)
    composed_error = composed.astype(np.float64) - truth.astype(np.float64)
    accumulator["count"] += float(truth.size)
    accumulator["lowSquared"] += float(np.sum(low_error * low_error))
    accumulator["composedSquared"] += float(np.sum(composed_error * composed_error))
    accumulator["lowAbs"] += float(np.sum(np.abs(low_error)))
    accumulator["composedAbs"] += float(np.sum(np.abs(composed_error)))


def finish_metrics(accumulator: dict[str, float]) -> dict[str, Any]:
    count = max(1.0, accumulator["count"])
    low_rmse = float(np.sqrt(accumulator["lowSquared"] / count))
    composed_rmse = float(np.sqrt(accumulator["composedSquared"] / count))
    low_mae = float(accumulator["lowAbs"] / count)
    composed_mae = float(accumulator["composedAbs"] / count)
    return {
        "count": int(accumulator["count"]),
        "low": {"rmse": low_rmse, "mae": low_mae},
        "composed": {"rmse": composed_rmse, "mae": composed_mae},
        "improvementVsLow": {
            "rmseReductionFraction": float((low_rmse - composed_rmse) / max(low_rmse, 1.0e-12)),
            "maeReductionFraction": float((low_mae - composed_mae) / max(low_mae, 1.0e-12)),
        },
    }


def fail_manifest(path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    if isinstance(error, CompositionFailure):
        phase = error.phase
        evidence = error.evidence
    write_json(path, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(args.manifest).resolve() if args.manifest else out_dir / "manifest.json"
    phase = "manifest-validation"
    evidence: dict[str, Any] = {}
    try:
        pair_path = Path(args.pair_manifest).resolve()
        probe_manifest_path = Path(args.support_probe_manifest).resolve()
        pair = json.loads(pair_path.read_text())
        probe_report = json.loads(probe_manifest_path.read_text())
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0" or pair.get("status") != "captured":
            raise CompositionFailure(phase, "pair manifest is not a captured full-grid pair")
        if probe_report.get("schema") != "kaminos.volume.exact-basin-support-probe.v0" or probe_report.get("status") != "captured":
            raise CompositionFailure(phase, "support probe manifest is not captured")
        if probe_report.get("failurePhase") is not None:
            raise CompositionFailure(phase, "support probe manifest carries a failure phase")
        pair_sha = sha256_file(pair_path)
        expected_pair_sha = str(probe_report.get("inputs", {}).get("pairManifest", {}).get("sha256") or "")
        if pair_sha != expected_pair_sha:
            raise CompositionFailure(phase, "support probe was trained against a different pair manifest", {
                "expectedSha256": expected_pair_sha, "actualSha256": pair_sha,
            })
        low_grid = int(pair.get("lowGrid") or 0)
        high_grid = int(pair.get("highGrid") or 0)
        if low_grid < 1 or high_grid <= low_grid:
            raise CompositionFailure(phase, "invalid low/high grid relationship", {"lowGrid": low_grid, "highGrid": high_grid})
        if int(probe_report.get("inputs", {}).get("lowGrid") or 0) != low_grid or int(probe_report.get("inputs", {}).get("highGrid") or 0) != high_grid:
            raise CompositionFailure(phase, "support probe grid relationship disagrees with pair")

        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        low_fluid_path = verify_artifact(pair["low"]["fluid"], pair_path, phase, "low fluid", [low_grid, low_grid, low_grid, 16], FLUID_CHANNELS)
        low_front_path = verify_artifact(pair["low"]["front"], pair_path, phase, "low front", [low_grid, low_grid, low_grid, 1], ["frontTopology"])
        high_fluid_path = verify_artifact(pair["high"]["fluid"], pair_path, phase, "high fluid", [high_grid, high_grid, high_grid, 16], FLUID_CHANNELS)
        high_front_path = verify_artifact(pair["high"]["front"], pair_path, phase, "high front", [high_grid, high_grid, high_grid, 1], ["frontTopology"])
        evidence = {"pairManifestSha256": pair_sha, "lowGrid": low_grid, "highGrid": high_grid}

        phase = "model-validation"
        classifier_descriptor = probe_report.get("classifier", {}).get("artifact") or {}
        heads_descriptor = probe_report.get("channelHeadArtifact") or {}
        classifier_path = verify_artifact(classifier_descriptor, probe_manifest_path, phase, "support classifier")
        heads_path = verify_artifact(heads_descriptor, probe_manifest_path, phase, "channel heads")
        requested_channels = [str(item.get("channel")) for item in probe_report.get("gatedChannels", [])]
        unsupported = [channel for channel in requested_channels if channel not in SUPPORTED_POLICIES]
        if unsupported:
            raise CompositionFailure(phase, f"no explicit composition policy for channels: {unsupported}")
        if "frontTopology" not in requested_channels:
            raise CompositionFailure(phase, "composition requires the dense frontTopology head")
        if not any(SUPPORTED_POLICIES[channel] == SPARSE_POLICY for channel in requested_channels):
            raise CompositionFailure(phase, "composition requires at least one sparse support-gated carrier head")

        probe_module = load_probe_module()
        with np.load(classifier_path, allow_pickle=False) as classifier_archive:
            classifier = model_state(classifier_archive)
            if "featureMean" not in classifier_archive.files or "featureStd" not in classifier_archive.files or "threshold" not in classifier_archive.files:
                raise CompositionFailure(phase, "support classifier omitted feature standardization or threshold")
            feature_mean = np.asarray(classifier_archive["featureMean"], dtype=np.float32)
            feature_std = np.asarray(classifier_archive["featureStd"], dtype=np.float32)
            threshold = float(np.asarray(classifier_archive["threshold"]).reshape(-1)[0])
        with np.load(heads_path, allow_pickle=False) as heads_archive:
            channel_states = {channel: model_state(heads_archive, channel) for channel in requested_channels}
        if classifier["w1"].shape[0] != feature_mean.size or feature_mean.shape != feature_std.shape:
            raise CompositionFailure(phase, "classifier feature shape mismatch")
        for channel, state in channel_states.items():
            if state["w1"].shape[0] != feature_mean.size:
                raise CompositionFailure(phase, f"{channel} feature shape mismatch")

        phase = "field-composition"
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, 16))
        high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))
        fluid_path = out_dir / "selective-composed.fluid.f32"
        front_path = out_dir / "selective-composed.front.f32"
        probability_path = out_dir / "predicted-support.probability.f32"
        mask_path = out_dir / "predicted-support.hard-mask.u8"
        fluid_out = np.memmap(fluid_path, dtype="<f4", mode="w+", shape=(high_cells, 16))
        front_out = np.memmap(front_path, dtype="<f4", mode="w+", shape=(high_cells,))
        probability_out = np.memmap(probability_path, dtype="<f4", mode="w+", shape=(high_cells,))
        mask_out = np.memmap(mask_path, dtype="u1", mode="w+", shape=(high_cells,))
        metrics = {channel: metric_accumulator() for channel in requested_channels}
        positive_count = 0
        batch_cells = max(1, int(args.batch_cells))
        for start in range(0, high_cells, batch_cells):
            end = min(high_cells, start + batch_cells)
            indexes = np.arange(start, end, dtype=np.int64)
            low_values, x, y, z = probe_module.low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)
            features = probe_module.build_features(low_values, x, y, z, high_grid)
            features = ((features - feature_mean) / feature_std).astype(np.float32, copy=False)
            probability = probe_module.predict_mlp(features, classifier, binary=True)
            hard_mask = probability >= np.float32(threshold)
            fluid_out[start:end] = low_values[:, :16]
            front_out[start:end] = low_values[:, 16]
            probability_out[start:end] = probability
            mask_out[start:end] = hard_mask.astype(np.uint8)
            positive_count += int(np.count_nonzero(hard_mask))
            for channel in requested_channels:
                policy = SUPPORTED_POLICIES[channel]
                channel_index = 16 if channel == "frontTopology" else FLUID_CHANNELS.index(channel)
                low_channel = low_values[:, channel_index]
                residual = probe_module.predict_mlp(features, channel_states[channel], binary=False)
                composed = low_channel + residual
                if policy == SPARSE_POLICY:
                    composed = low_channel + residual * hard_mask.astype(np.float32)
                truth = high_front[indexes] if channel == "frontTopology" else high_fluid[indexes, channel_index]
                if channel == "frontTopology":
                    front_out[start:end] = composed
                else:
                    fluid_out[start:end, channel_index] = composed
                update_metrics(metrics[channel], low_channel, composed, truth)
        for output in [fluid_out, front_out, probability_out, mask_out]:
            output.flush()
        del fluid_out, front_out, probability_out, mask_out

        phase = "report-write"
        channel_policies = {channel: SUPPORTED_POLICIES[channel] for channel in requested_channels}
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "compositionAuthority": AUTHORITY,
            "runtimeTruthAvailable": False,
            "source": {
                "pairManifestPath": str(pair_path),
                "pairManifestSha256": pair_sha,
                "supportProbeManifestPath": str(probe_manifest_path),
                "supportProbeManifestSha256": sha256_file(probe_manifest_path),
                "exactBasinSourceCaptureSha256": probe_report.get("route", {}).get("exactBasinSourceCaptureSha256"),
                "effectiveRoute": probe_report.get("route", {}).get("effectiveRoute"),
                "backend": probe_report.get("route", {}).get("backend"),
                "classifier": {**classifier_descriptor, "path": str(classifier_path)},
                "channelHeads": {**heads_descriptor, "path": str(heads_path)},
            },
            "relationship": {
                "authority": pair.get("authority"),
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "applicationInput": "phase-aligned low field only",
                "highTruthUse": "offline metrics only; not read by checkpoint application features",
            },
            "features": probe_report.get("features"),
            "support": {
                "identity": probe_report.get("classifier", {}).get("identity"),
                "threshold": threshold,
                "thresholdSelection": probe_report.get("classifier", {}).get("thresholdSelection"),
                "predictedPositiveCount": positive_count,
                "predictedPrevalence": float(positive_count / high_cells),
                "probability": artifact_descriptor(probability_path, [high_grid, high_grid, high_grid, 1], ["acceptedSplatProbability"], "float32"),
                "hardMask": artifact_descriptor(mask_path, [high_grid, high_grid, high_grid, 1], ["acceptedSplatHardMask"], "uint8"),
            },
            "channelPolicies": channel_policies,
            "channelMetrics": {channel: finish_metrics(value) for channel, value in metrics.items()},
            "receiver": {
                "grid": high_grid,
                "initialSimStepCount": 0,
                "fluid": artifact_descriptor(fluid_path, [high_grid, high_grid, high_grid, 16], FLUID_CHANNELS, "float32"),
                "front": artifact_descriptor(front_path, [high_grid, high_grid, high_grid, 1], ["frontTopology"], "float32"),
            },
            "batching": {"batchCells": batch_cells, "cellCount": high_cells, "completeFieldCoverage": True},
            "consumptionContract": {
                "requiresExplicitSchemaAdmission": True,
                "mustNotBeAcceptedAs": "kaminos.volume.coarse-receiver-initial.v0",
                "receiverAdvance": "held render first; any simulation advance is a separate experiment",
            },
            "limitations": [
                "One exact basin and a same-high-history phase-aligned teacher pair.",
                "No native-low transfer, replay generalization, temporal stability, or renderer improvement is claimed.",
                "This manifest is learned composition authority and must not impersonate filtered-high initialization truth.",
            ],
        }
        write_json(manifest_path, report)
        print(json.dumps({
            "status": "captured", "manifest": str(manifest_path),
            "predictedPositiveCount": positive_count,
            "predictedPrevalence": report["support"]["predictedPrevalence"],
            "channelMetrics": report["channelMetrics"],
        }, indent=2))
        return 0
    except Exception as error:
        fail_manifest(manifest_path, phase, error, evidence)
        effective_phase = error.phase if isinstance(error, CompositionFailure) else phase
        print(f"selective composition failed at {effective_phase}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
