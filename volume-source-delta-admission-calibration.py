#!/usr/bin/env python3
"""Calibrate a fixed dense admission mask from source-field deltas only."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.pyro.fixed-source-delta-calibration.v1"
IDENTITY = "fixed-full-source-delta-envelope-trilinear-v1"
AUTHORITY = "source-manifests-only-fixed-threshold-v0"
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]
CHANNELS = [*FLUID_CHANNELS, "frontTopology"]


class CalibrationFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        payload,
        indent=2,
        default=lambda value: value.item() if isinstance(value, np.generic) else str(value),
    ) + "\n")


def resolve_path(raw: str, manifest_path: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def artifact_path(
    descriptor: dict[str, Any], manifest_path: Path, shape: list[int], channels: list[str], label: str,
) -> Path:
    path = resolve_path(str(descriptor.get("path") or ""), manifest_path)
    if not path.exists():
        raise CalibrationFailure("input-validation", f"missing {label}: {path}")
    dtype = descriptor.get("dtype")
    byte_order = descriptor.get("byteOrder")
    little_endian_f32 = dtype == "float32-le" or (dtype == "float32" and byte_order == "little-endian")
    if not little_endian_f32 or descriptor.get("shape") != shape:
        raise CalibrationFailure("input-validation", f"{label} dtype or shape mismatch")
    if descriptor.get("channelOrder") != channels:
        raise CalibrationFailure("input-validation", f"{label} channel order mismatch")
    if path.stat().st_size != int(descriptor.get("byteLength") or -1):
        raise CalibrationFailure("input-validation", f"{label} byte length mismatch")
    if sha256_file(path) != descriptor.get("sha256"):
        raise CalibrationFailure("input-validation", f"{label} SHA-256 mismatch")
    return path


def load_source(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise CalibrationFailure("input-validation", f"missing source manifest: {path}")
    payload = json.loads(path.read_text())
    if payload.get("schema") != "kaminos.volume.full-grid-field-export.v0":
        raise CalibrationFailure("input-validation", "source manifest schema mismatch")
    if payload.get("status") != "captured" or payload.get("failurePhase") is not None:
        raise CalibrationFailure("input-validation", "source manifest is not captured")
    if payload.get("completeFieldCoverage") is not True:
        raise CalibrationFailure("input-validation", "source manifest lacks complete field coverage")
    artifacts = payload.get("sidecars") or payload.get("artifacts") or {}
    fluid_descriptor = artifacts.get("fluid") or {}
    front_descriptor = artifacts.get("front") or {}
    fluid_shape = fluid_descriptor.get("shape") or []
    grid = int(payload.get("grid") or (fluid_shape[0] if len(fluid_shape) == 4 else 0))
    step = payload.get("deterministicReplay", {}).get("completedSteps")
    if step is None:
        step = payload.get("simStepCount")
    if grid <= 0 or step is None:
        raise CalibrationFailure("input-validation", "source grid or simulation step is missing")
    fluid_path = artifact_path(
        fluid_descriptor, path, [grid, grid, grid, 16], FLUID_CHANNELS, "source fluid",
    )
    front_path = artifact_path(
        front_descriptor, path, [grid, grid, grid, 1], ["frontTopology"], "source front",
    )
    cells = grid ** 3
    fluid = np.memmap(fluid_path, dtype="<f4", mode="r", shape=(cells, 16))
    front = np.memmap(front_path, dtype="<f4", mode="r", shape=(cells, 1))
    fields = np.concatenate((np.asarray(fluid), np.asarray(front)), axis=1).reshape(grid, grid, grid, 17)
    if not np.all(np.isfinite(fields)):
        raise CalibrationFailure("input-validation", "source fields contain non-finite values")
    route = payload.get("effectiveRoute") or payload.get("deterministicReplay", {}).get("effectiveRoute")
    backend = payload.get("backend") or payload.get("deterministicReplay", {}).get("backend")
    if not route or not backend:
        raise CalibrationFailure("input-validation", "source route or backend is missing")
    return {
        "path": path,
        "manifestSha256": sha256_file(path),
        "step": int(step),
        "grid": grid,
        "route": route,
        "backend": backend,
        "fields": fields.astype(np.float32),
        "fluidSha256": fluid_descriptor["sha256"],
        "frontSha256": front_descriptor["sha256"],
    }


def parse_transition(raw: str) -> tuple[Path, Path]:
    parts = raw.split(":", 1)
    if len(parts) != 2 or not all(parts):
        raise CalibrationFailure("arguments", "transitions must be PREVIOUS_SOURCE:CURRENT_SOURCE")
    return Path(parts[0]).resolve(), Path(parts[1]).resolve()


def resize_axis(values: np.ndarray, target: int, axis: int) -> np.ndarray:
    source = values.shape[axis]
    coordinate = (np.arange(target, dtype=np.float32) + 0.5) * (source / target) - 0.5
    lower = np.floor(coordinate).astype(np.intp)
    upper = lower + 1
    weight = coordinate - lower
    lower = np.clip(lower, 0, source - 1)
    upper = np.clip(upper, 0, source - 1)
    shape = [1] * values.ndim
    shape[axis] = target
    weight = weight.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - weight) + np.take(values, upper, axis=axis) * weight


def trilinear_resize(values: np.ndarray, target: int) -> np.ndarray:
    return resize_axis(resize_axis(resize_axis(values, target, 2), target, 1), target, 0).astype(np.float32)


def source_score(previous: dict[str, Any], current: dict[str, Any], scales: np.ndarray, target: int) -> np.ndarray:
    delta = np.abs(current["fields"] - previous["fields"])
    envelope = np.max(np.clip(delta / scales.reshape(1, 1, 1, 17), 0.0, 1.0), axis=3)
    return trilinear_resize(envelope.astype(np.float32), target)


def pair_receipt(previous: dict[str, Any], current: dict[str, Any], score: np.ndarray, threshold: float) -> dict[str, Any]:
    mask = score >= np.float32(threshold)
    return {
        "previousStep": previous["step"],
        "currentStep": current["step"],
        "candidateCount": int(np.count_nonzero(mask)),
        "coverage": float(np.mean(mask)),
        "threshold": float(threshold),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calibration-transition", required=True)
    parser.add_argument("--test-transition", required=True)
    parser.add_argument("--target-grid", required=True, type=int)
    parser.add_argument("--scale-quantile", type=float, default=0.995)
    parser.add_argument("--coverage-quantile", type=float, default=0.9)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = Path(args.output).resolve()
    phase = "arguments"
    evidence: dict[str, Any] = {}
    try:
        if args.target_grid <= 0:
            raise CalibrationFailure(phase, "target grid must be positive")
        if not (0.0 < args.scale_quantile <= 1.0) or not (0.0 <= args.coverage_quantile < 1.0):
            raise CalibrationFailure(phase, "quantiles are outside their valid ranges")
        calibration_paths = parse_transition(args.calibration_transition)
        test_paths = parse_transition(args.test_transition)
        phase = "input-validation"
        loaded = [load_source(path) for path in (*calibration_paths, *test_paths)]
        calibration_previous, calibration_current, test_previous, test_current = loaded
        if calibration_current["manifestSha256"] != test_previous["manifestSha256"]:
            raise CalibrationFailure(phase, "calibration current source must equal test previous source")
        unique = {
            frame["step"]: frame for frame in (calibration_previous, calibration_current, test_current)
        }
        if len(unique) != 3 or not (
            calibration_previous["step"] < calibration_current["step"] < test_current["step"]
        ):
            raise CalibrationFailure(phase, "source transitions must span three ordered distinct steps")
        identities = {(frame["grid"], frame["route"], frame["backend"]) for frame in unique.values()}
        if len(identities) != 1:
            raise CalibrationFailure(phase, "source grid, route, or backend differs across transitions")
        artifact_sets = [
            (frame["fluidSha256"], frame["frontSha256"]) for frame in unique.values()
        ]
        if len(set(artifact_sets)) != 3:
            raise CalibrationFailure(phase, "duplicate source artifacts across calibration/test steps")
        evidence = {
            str(step): {
                "manifestPath": str(frame["path"]),
                "manifestSha256": frame["manifestSha256"],
                "fluidSha256": frame["fluidSha256"],
                "frontSha256": frame["frontSha256"],
            }
            for step, frame in unique.items()
        }

        phase = "calibration"
        calibration_delta = np.abs(calibration_current["fields"] - calibration_previous["fields"])
        scales = np.quantile(
            calibration_delta.astype(np.float64), args.scale_quantile, axis=(0, 1, 2), method="linear",
        ).astype(np.float32)
        if scales.shape != (17,) or not np.all(np.isfinite(scales)) or np.any(scales <= 0.0):
            raise CalibrationFailure(phase, "calibration produced non-positive or non-finite scales")
        calibration_score = source_score(calibration_previous, calibration_current, scales, args.target_grid)
        threshold = float(np.quantile(
            calibration_score.astype(np.float64), args.coverage_quantile, method="linear",
        ))
        if not math.isfinite(threshold):
            raise CalibrationFailure(phase, "calibration threshold is non-finite")
        test_score = source_score(test_previous, test_current, scales, args.target_grid)
        calibration_pair = f"{calibration_previous['step']}-{calibration_current['step']}"
        test_pair = f"{test_previous['step']}-{test_current['step']}"

        phase = "output-write"
        script_path = Path(__file__).resolve()
        payload = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "authority": AUTHORITY,
            "producer": {
                "identity": script_path.name,
                "scriptPath": str(script_path),
                "scriptSha256": sha256_file(script_path),
                "invocation": {
                    "targetGrid": int(args.target_grid),
                    "scaleQuantile": float(args.scale_quantile),
                    "coverageQuantile": float(args.coverage_quantile),
                },
            },
            "runtimeTruthUsed": False,
            "targetArtifactsRead": False,
            "targetErrorRankingUsed": False,
            "runtimeTopK": False,
            "dynamicPercentile": False,
            "hiddenCandidateCap": False,
            "sourceOnlyThresholdRule": "train-pair-channel-qscale-max-envelope-dense-quantile-v0",
            "sourceFieldChannelOrder": CHANNELS,
            "sourceGrid": calibration_current["grid"],
            "targetGrid": int(args.target_grid),
            "route": calibration_current["route"],
            "backend": calibration_current["backend"],
            "sourceBindings": evidence,
            "calibrationPair": calibration_pair,
            "scaleQuantile": float(args.scale_quantile),
            "coverageCalibrationQuantile": float(args.coverage_quantile),
            "threshold": threshold,
            "channelScales": scales.tolist(),
            "pairs": {
                calibration_pair: pair_receipt(
                    calibration_previous, calibration_current, calibration_score, threshold,
                ),
                test_pair: pair_receipt(test_previous, test_current, test_score, threshold),
            },
        }
        write_json(output, payload)
        print(json.dumps({"status": "captured", "output": str(output), "threshold": threshold}))
        return 0
    except (CalibrationFailure, ValueError, KeyError, json.JSONDecodeError) as error:
        failure_phase = error.phase if isinstance(error, CalibrationFailure) else phase
        failure_evidence = error.evidence if isinstance(error, CalibrationFailure) else {}
        write_json(output, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": failure_phase,
            "error": str(error),
            "lastTrustworthyEvidence": {**evidence, **failure_evidence},
        })
        print(json.dumps({"status": "failed", "failurePhase": failure_phase, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
