#!/usr/bin/env python3
"""Evaluate an earlier fire-flow carrier checkpoint on a later exact replay without target fitting."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.fire-flow-carrier-frozen-transfer.v0"
TRANSFER_IDENTITY = "checksum-bound-frozen-fire-flow-carrier-transfer-v0"
TRANSFER_AUTHORITY = "earlier-replay-frozen-model-on-later-replay-no-target-fit-v0"


class TransferFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_support_module():
    path = Path(__file__).with_name("volume-exact-basin-support-probe.py")
    spec = importlib.util.spec_from_file_location("kaminos_exact_basin_support_probe", path)
    if spec is None or spec.loader is None:
        raise TransferFailure("module-load", f"cannot load support probe module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SUPPORT = load_support_module()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-probe-manifest", required=True)
    parser.add_argument("--target-pair-manifest", required=True)
    parser.add_argument("--target-full-grid-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--test-samples", type=int, default=80_000)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def verify_artifact(descriptor: dict[str, Any], phase: str, role: str) -> Path:
    path = Path(str(descriptor.get("path") or "")).resolve()
    if not path.is_file():
        raise TransferFailure(phase, f"missing {role} artifact {path}", {"role": role, "descriptor": descriptor})
    actual_bytes = path.stat().st_size
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_sha = SUPPORT.sha256_file(path)
    expected_sha = str(descriptor.get("sha256") or "")
    if actual_bytes != expected_bytes or actual_sha != expected_sha:
        raise TransferFailure(phase, f"{role} artifact authority mismatch", {
            "role": role,
            "path": str(path),
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
            "expectedSha256": expected_sha,
            "actualSha256": actual_sha,
        })
    return path


def scalar(value: np.ndarray, key: str) -> float:
    array = np.asarray(value)
    if array.size != 1:
        raise TransferFailure("frozen-model-validation", f"{key} must contain one scalar", {"shape": list(array.shape)})
    return float(array.reshape(-1)[0])


def load_frozen_state(source: dict[str, Any]) -> dict[str, Any]:
    phase = "frozen-model-validation"
    classifier_descriptor = source.get("classifier", {}).get("artifact") or {}
    heads_descriptor = source.get("channelHeadArtifact") or {}
    classifier_path = verify_artifact(classifier_descriptor, phase, "classifier")
    heads_path = verify_artifact(heads_descriptor, phase, "channel-heads")
    channel = SUPPORT.FIRE_FLOW_CARRIER
    channel_report = next(
        (item for item in source.get("gatedChannels", []) if item.get("channel") == channel),
        None,
    )
    if channel_report is None:
        raise TransferFailure(phase, f"source probe does not contain {channel}")
    if channel_report.get("targetAuthority") != SUPPORT.DERIVED_TARGETS[channel]:
        raise TransferFailure(phase, "source carrier target authority mismatch", {
            "expected": SUPPORT.DERIVED_TARGETS[channel],
            "actual": channel_report.get("targetAuthority"),
        })
    try:
        with np.load(classifier_path, allow_pickle=False) as payload:
            required = ["w1", "b1", "w2", "b2", "targetMean", "targetStd", "featureMean", "featureStd", "threshold"]
            missing = [key for key in required if key not in payload]
            if missing:
                raise TransferFailure(phase, "classifier checkpoint is incomplete", {"missingKeys": missing})
            classifier = {key: np.asarray(payload[key], dtype=np.float32) for key in ["w1", "b1", "w2", "b2"]}
            classifier["targetMean"] = scalar(payload["targetMean"], "targetMean")
            classifier["targetStd"] = scalar(payload["targetStd"], "targetStd")
            feature_mean = np.asarray(payload["featureMean"], dtype=np.float32)
            feature_std = np.asarray(payload["featureStd"], dtype=np.float32)
            threshold = scalar(payload["threshold"], "threshold")
        prefix = f"{channel}."
        with np.load(heads_path, allow_pickle=False) as payload:
            required = [
                f"{prefix}w1", f"{prefix}b1", f"{prefix}w2", f"{prefix}b2",
                f"{prefix}targetMean", f"{prefix}targetStd",
                f"{prefix}linearWeights", f"{prefix}linearBias", f"{prefix}linearRidgeAlpha",
            ]
            missing = [key for key in required if key not in payload]
            if missing:
                raise TransferFailure(phase, "channel-head checkpoint is incomplete", {"missingKeys": missing})
            head = {key: np.asarray(payload[f"{prefix}{key}"], dtype=np.float32) for key in ["w1", "b1", "w2", "b2"]}
            head["targetMean"] = scalar(payload[f"{prefix}targetMean"], f"{prefix}targetMean")
            head["targetStd"] = scalar(payload[f"{prefix}targetStd"], f"{prefix}targetStd")
            linear = {
                "identity": SUPPORT.LINEAR_CONTEXT_IDENTITY,
                "weights": np.asarray(payload[f"{prefix}linearWeights"], dtype=np.float32),
                "bias": scalar(payload[f"{prefix}linearBias"], f"{prefix}linearBias"),
                "ridgeAlpha": scalar(payload[f"{prefix}linearRidgeAlpha"], f"{prefix}linearRidgeAlpha"),
            }
    except TransferFailure:
        raise
    except Exception as error:
        raise TransferFailure(phase, f"cannot decode frozen checkpoint: {error}") from error
    feature_count = int(source.get("features", {}).get("featureCount") or 0)
    shapes = {
        "featureMean": list(feature_mean.shape),
        "featureStd": list(feature_std.shape),
        "classifierW1": list(classifier["w1"].shape),
        "headW1": list(head["w1"].shape),
        "linearWeights": list(linear["weights"].shape),
    }
    if feature_count <= 0 or any(array.shape != (feature_count,) for array in [feature_mean, feature_std, linear["weights"]]):
        raise TransferFailure(phase, "frozen feature-vector shapes disagree with source report", {
            "featureCount": feature_count,
            "shapes": shapes,
        })
    if classifier["w1"].shape[0] != feature_count or head["w1"].shape[0] != feature_count:
        raise TransferFailure(phase, "frozen MLP input width disagrees with source report", {
            "featureCount": feature_count,
            "shapes": shapes,
        })
    calibration = channel_report.get("calibratedResidual", {}).get("calibration") or {}
    constant = calibration.get("constantControl") or {}
    constant_scale = constant.get("scale")
    if calibration.get("selectedOn") != "validation" or calibration.get("testDataUsedForSelection") is not False:
        raise TransferFailure(phase, "source calibration does not prove validation-only selection", {"calibration": calibration})
    if not isinstance(constant_scale, (int, float)) or not np.isfinite(constant_scale):
        raise TransferFailure(phase, "source checkpoint lacks a finite constant residual scale", {"constantControl": constant})
    return {
        "classifier": classifier,
        "head": head,
        "linear": linear,
        "featureMean": feature_mean,
        "featureStd": feature_std,
        "threshold": threshold,
        "calibration": calibration,
        "constantScale": float(constant_scale),
        "channelReport": channel_report,
        "classifierDescriptor": classifier_descriptor,
        "headsDescriptor": heads_descriptor,
    }


def replay_key(replay: Any) -> str:
    return json.dumps(replay or {}, sort_keys=True, separators=(",", ":"))


def fail_report(out_dir: Path, error: Exception, phase: str, evidence: dict[str, Any]) -> None:
    if isinstance(error, (TransferFailure, SUPPORT.ProbeFailure)):
        phase = error.phase
        evidence = {**evidence, **getattr(error, "evidence", {})}
    write_json(out_dir / "manifest.json", {
        "schema": REPORT_SCHEMA,
        "identity": TRANSFER_IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence,
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    phase = "input-manifest-validation"
    evidence: dict[str, Any] = {
        "targetDataUsedForTraining": False,
        "targetDataUsedForCalibration": False,
        "targetLabelsUsedForModelSelection": False,
    }
    try:
        source_path = Path(args.source_probe_manifest).resolve()
        pair_path = Path(args.target_pair_manifest).resolve()
        full_path = Path(args.target_full_grid_manifest).resolve()
        source = read_json(source_path)
        pair = read_json(pair_path)
        full = read_json(full_path)
        evidence.update({
            "sourceProbeManifest": {"path": str(source_path), "sha256": SUPPORT.sha256_file(source_path)},
            "targetPairManifest": {"path": str(pair_path), "sha256": SUPPORT.sha256_file(pair_path)},
            "targetFullGridManifest": {"path": str(full_path), "sha256": SUPPORT.sha256_file(full_path)},
        })
        if source.get("schema") != SUPPORT.REPORT_SCHEMA or source.get("status") != "captured" or source.get("failurePhase") is not None:
            raise TransferFailure(phase, "source probe is not a captured support-probe artifact", {"sourceStatus": source.get("status")})
        if source.get("features", {}).get("identity") != SUPPORT.FEATURE_IDENTITY:
            raise TransferFailure(phase, "source feature identity is incompatible", {"features": source.get("features")})
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0" or pair.get("status") != "captured":
            raise TransferFailure(phase, "target pair is not captured")
        if full.get("schema") != "kaminos.volume.full-grid-field-export.v0" or full.get("status") != "captured":
            raise TransferFailure(phase, "target full-grid export is not captured")
        if full.get("failurePhase") is not None or full.get("completeFieldCoverage") is not True:
            raise TransferFailure(phase, "target full-grid export is incomplete", {"failurePhase": full.get("failurePhase")})
        low_grid = int(pair.get("lowGrid") or 0)
        high_grid = int(pair.get("highGrid") or 0)
        source_inputs = source.get("inputs") or {}
        if (low_grid, high_grid) != (int(source_inputs.get("lowGrid") or 0), int(source_inputs.get("highGrid") or 0)):
            raise TransferFailure(phase, "source and target grid relationship differs", {
                "source": [source_inputs.get("lowGrid"), source_inputs.get("highGrid")],
                "target": [low_grid, high_grid],
            })
        if int(full.get("grid") or 0) != high_grid:
            raise TransferFailure(phase, "target pair/full-grid high grid mismatch")
        exact_sha = pair.get("source", {}).get("exactBasinSourceCaptureSha256")
        if exact_sha != full.get("sourceCapture", {}).get("payloadSha256"):
            raise TransferFailure(phase, "target pair/full-grid source hash mismatch")
        if full.get("boundarySplats", {}).get("draw", {}).get("overflowCount") != 0:
            raise TransferFailure(phase, "target splat labels overflowed", {"draw": full.get("boundarySplats", {}).get("draw")})

        phase = "frozen-model-validation"
        frozen = load_frozen_state(source)

        phase = "target-sidecar-validation"
        low_fluid_path = SUPPORT.verify_descriptor(pair["low"]["fluid"], phase)
        low_front_path = SUPPORT.verify_descriptor(pair["low"]["front"], phase)
        high_fluid_path = SUPPORT.verify_descriptor(pair["high"]["fluid"], phase)
        high_front_path = SUPPORT.verify_descriptor(pair["high"]["front"], phase)
        boundary_descriptor = full["boundarySidecar"]["sidecars"]["boundary"]
        boundary_path = SUPPORT.verify_descriptor(boundary_descriptor, phase)
        splat_descriptor = full["boundarySplats"]["sidecars"]["boundarySplats"]
        splat_path = SUPPORT.verify_descriptor(splat_descriptor, phase)
        if pair["high"]["fluid"]["sha256"] != full["sidecars"]["fluid"]["sha256"] or pair["high"]["front"]["sha256"] != full["sidecars"]["front"]["sha256"]:
            raise TransferFailure(phase, "target pair high fields differ from full-grid fields")

        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, 16))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, 16))
        high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))
        high_boundary = np.memmap(boundary_path, dtype="<f4", mode="r", shape=(high_cells, 4))
        splats = np.memmap(splat_path, dtype="<f4", mode="r", shape=tuple(int(value) for value in splat_descriptor["shape"]))

        phase = "target-derived-fields"
        low_carrier, low_context_fields, low_receipt = SUPPORT.derive_fire_flow_visibility_carrier(low_fluid, low_front, low_grid)
        high_carrier, _high_context, high_receipt = SUPPORT.derive_fire_flow_visibility_carrier(high_fluid, high_front, high_grid)
        labels, _structural_signal, label_authority = SUPPORT.derive_and_validate_labels(high_fluid, high_boundary, splats, high_grid)

        phase = "target-test-split"
        source_split = source.get("split") or {}
        block_size = int(source_split.get("spatialBlockSize") or 0)
        seed = int(source_split.get("hashSeed") or 0)
        roles, split_receipt = SUPPORT.spatial_split(high_grid, block_size, seed)
        pools = {
            "test": np.flatnonzero(roles == 0),
            "validation": np.flatnonzero(roles == 1),
            "train": np.flatnonzero(roles == 2),
        }
        test_pool = pools["test"]
        positive_count = int(np.count_nonzero(labels[test_pool]))
        if positive_count == 0 or positive_count == test_pool.size:
            raise TransferFailure(phase, "target test split lacks both classes", {
                "poolCount": int(test_pool.size), "positiveCount": positive_count,
            })
        source_roles = source_split.get("roles") or {}
        if any(role not in source_roles for role in ["train", "validation", "test"]):
            raise TransferFailure(phase, "source probe lacks exact sampling counts", {"sourceRoles": source_roles})
        source_train_count = int(source_roles["train"].get("sampleCount") or 0)
        source_train_positive = int(source_roles["train"].get("samplePositiveCount") or 0)
        source_validation_count = int(source_roles["validation"].get("sampleCount") or 0)
        source_test_count = int(source_roles["test"].get("sampleCount") or 0)
        if min(source_train_count, source_validation_count, source_test_count) <= 0:
            raise TransferFailure(phase, "source probe sampling counts are invalid", {"sourceRoles": source_roles})
        train_positive_fraction = source_train_positive / source_train_count
        rng = np.random.default_rng(seed)
        SUPPORT.sample_balanced(
            pools["train"], labels, source_train_count, train_positive_fraction, rng,
        )
        SUPPORT.sample_uniform(pools["validation"], source_validation_count, rng)
        effective_test_samples = min(int(args.test_samples), source_test_count)
        if effective_test_samples != source_test_count:
            raise TransferFailure(phase, "test sample override would break source sampling identity", {
                "requestedTestSamples": int(args.test_samples),
                "sourceTestSamples": source_test_count,
                "effectiveTestSamples": effective_test_samples,
            })
        test_indexes = SUPPORT.sample_uniform(test_pool, effective_test_samples, rng)
        split_receipt["targetTest"] = {
            "samplingIdentity": "reproduced-probe-rng-sequence-without-fit-v0",
            "sameSamplingContractAsSourceProbe": True,
            "poolCount": int(test_pool.size),
            "poolPositiveCount": positive_count,
            "sampleCount": int(test_indexes.size),
            "samplePositiveCount": int(np.count_nonzero(labels[test_indexes])),
            "targetDataUsedForTraining": False,
            "targetDataUsedForCalibration": False,
            "targetLabelsUsedForModelSelection": False,
            "targetLabelsUsedForEvaluationSampling": True,
        }

        phase = "target-feature-build"
        low_test, x, y, z = SUPPORT.low_values_for_high_cells(low_fluid, low_front, test_indexes, low_grid, high_grid)
        context = SUPPORT.sample_low_context_for_high_cells(low_context_fields, x, y, z, low_grid, high_grid)
        raw_features = SUPPORT.build_features(low_test, x, y, z, high_grid, context)
        if raw_features.shape[1] != frozen["featureMean"].size:
            raise TransferFailure(phase, "target feature width differs from frozen checkpoint", {
                "targetFeatureCount": int(raw_features.shape[1]),
                "sourceFeatureCount": int(frozen["featureMean"].size),
            })
        features = ((raw_features - frozen["featureMean"]) / frozen["featureStd"]).astype(np.float32)

        phase = "frozen-inference"
        probability = SUPPORT.predict_mlp(features, frozen["classifier"], binary=True)
        residual = SUPPORT.predict_mlp(features, frozen["head"], binary=False)
        low_channel = SUPPORT.sample_low_scalar_for_high_cells(low_carrier, x, y, z, low_grid, high_grid)
        truth = np.asarray(high_carrier[test_indexes], dtype=np.float32)
        linear = np.clip(low_channel + SUPPORT.predict_ridge_residual(features, frozen["linear"]), 0.0, 1.0)
        ungated = np.clip(low_channel + residual, 0.0, 1.0)
        raw_soft = np.clip(low_channel + residual * probability, 0.0, 1.0)
        selected_gate = SUPPORT.apply_selected_residual_gate(probability, frozen["calibration"])
        selected = np.clip(low_channel + residual * selected_gate, 0.0, 1.0)
        constant = np.clip(low_channel + residual * np.float32(frozen["constantScale"]), 0.0, 1.0)
        metrics = {
            "low": SUPPORT.scalar_metrics(low_channel, truth),
            "linear": SUPPORT.scalar_metrics(linear, truth),
            "ungated": SUPPORT.scalar_metrics(ungated, truth),
            "rawSoft": SUPPORT.scalar_metrics(raw_soft, truth),
            "selected": SUPPORT.scalar_metrics(selected, truth),
            "constant": SUPPORT.scalar_metrics(constant, truth),
        }
        source_replay = source.get("route", {}).get("deterministicReplay")
        target_replay = full.get("deterministicReplay")
        report = {
            "schema": REPORT_SCHEMA,
            "identity": TRANSFER_IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "authority": TRANSFER_AUTHORITY,
            "transfer": {
                "sourceReplay": source_replay,
                "targetReplay": target_replay,
                "distinctReplay": replay_key(source_replay) != replay_key(target_replay),
                "targetDataUsedForTraining": False,
                "targetDataUsedForCalibration": False,
                "targetLabelsUsedForModelSelection": False,
                "targetUse": "held spatial test metrics only",
            },
            "source": {
                "probeManifest": evidence["sourceProbeManifest"],
                "classifier": frozen["classifierDescriptor"],
                "channelHeads": frozen["headsDescriptor"],
                "featureIdentity": SUPPORT.FEATURE_IDENTITY,
                "threshold": frozen["threshold"],
                "calibration": frozen["calibration"],
            },
            "target": {
                "pairManifest": evidence["targetPairManifest"],
                "fullGridManifest": evidence["targetFullGridManifest"],
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "effectiveRoute": full.get("effectiveRoute"),
                "backend": full.get("backend"),
                "exactBasinSourceCaptureSha256": exact_sha,
                "failurePhase": full.get("failurePhase"),
            },
            "split": split_receipt,
            "labelAuthority": label_authority,
            "derivedTarget": {
                "contract": SUPPORT.DERIVED_TARGETS[SUPPORT.FIRE_FLOW_CARRIER],
                "lowDerived": low_receipt,
                "truthHigh": high_receipt,
            },
            "channel": {
                "channel": SUPPORT.FIRE_FLOW_CARRIER,
                "lowUpsampled": metrics["low"],
                "linearContext": {
                    "identity": SUPPORT.LINEAR_CONTEXT_IDENTITY,
                    "metrics": metrics["linear"],
                    "improvementVsLow": SUPPORT.improvement(metrics["low"], metrics["linear"]),
                },
                "ungated": {
                    "metrics": metrics["ungated"],
                    "improvementVsLow": SUPPORT.improvement(metrics["low"], metrics["ungated"]),
                    "improvementVsLinearContext": SUPPORT.improvement(metrics["linear"], metrics["ungated"]),
                },
                "rawSoftSupport": {
                    "metrics": metrics["rawSoft"],
                    "improvementVsLow": SUPPORT.improvement(metrics["low"], metrics["rawSoft"]),
                },
                "sourceSelectedResidual": {
                    "family": frozen["calibration"].get("selectedFamily"),
                    "metrics": metrics["selected"],
                    "improvementVsLow": SUPPORT.improvement(metrics["low"], metrics["selected"]),
                    "improvementVsLinearContext": SUPPORT.improvement(metrics["linear"], metrics["selected"]),
                },
                "constantResidual": {
                    "scale": frozen["constantScale"],
                    "metrics": metrics["constant"],
                    "improvementVsLow": SUPPORT.improvement(metrics["low"], metrics["constant"]),
                    "improvementVsLinearContext": SUPPORT.improvement(metrics["linear"], metrics["constant"]),
                    "improvementVsSourceSelected": SUPPORT.improvement(metrics["selected"], metrics["constant"]),
                },
                "classifier": {
                    "threshold": frozen["threshold"],
                    "testMetrics": SUPPORT.classification_metrics(probability, labels[test_indexes], frozen["threshold"]),
                },
            },
            "limitations": [
                "This assay evaluates one later deterministic replay and does not establish cross-look transfer.",
                "The low input remains downsampled from the target high history; native independent low-grid phase transfer is not claimed.",
                "No image, motion, injection, or renderer-coupled temporal witness is produced by this field-only evaluator.",
            ],
        }
        write_json(out_dir / "manifest.json", report)
        print(json.dumps({
            "status": "captured",
            "manifest": str(out_dir / "manifest.json"),
            "distinctReplay": report["transfer"]["distinctReplay"],
            "constantScale": frozen["constantScale"],
            "constantImprovementVsLow": report["channel"]["constantResidual"]["improvementVsLow"],
        }, indent=2))
        return 0
    except Exception as error:
        fail_report(out_dir, error, phase, evidence)
        print(f"frozen transfer failed at {getattr(error, 'phase', phase)}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
