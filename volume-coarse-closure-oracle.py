#!/usr/bin/env python3
"""Construct exact coarse-grid closure targets from phase-aligned field states."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


INPUT_SCHEMA = "kaminos.volume.coarse-closure-corpus.v0"
INPUT_IDENTITY = "phase-aligned-filtered-high-low-step-corpus-v0"
OUTPUT_SCHEMA = "kaminos.volume.coarse-closure-oracle.v0"
APPLICATION_AUTHORITY = "offline-oracle-training-and-diagnostic-only"
INITIALIZATION_AUTHORITY = "receiver-initialized-from-filtered-high-t-v0"
FILTER_IDENTITY = "volume-overlap-box-filter-high-to-receiver-v0"
LAYOUT_IDENTITY = "x-fastest-zyx-c-interleaved-v0"
FILTER_AGREEMENT_IDENTITY = "float32-one-ulp-at-unit-floor-v0"
ROLE_ORDER = [
    "filteredHighT",
    "ordinaryLowT1",
    "exactClosureResidual",
    "oracleApplied",
    "filteredHighT1",
]
EXPECTED_FLUID_CHANNELS = [
    "velocityX",
    "velocityY",
    "velocityZ",
    "densityCarrier",
    "smokeDensity",
    "heat",
    "fuel",
    "detail",
    "flame",
    "ember",
    "visibleFireCarrier",
    "combustionFront",
    "microdetail",
    "interfaceShred",
    "fireLick",
    "emberFleck",
]
EXPECTED_FRONT_CHANNELS = ["frontTopology"]


class OracleFailure(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise OracleFailure(message)


def validate_artifact(
    artifact: dict[str, Any],
    expected_grid: int,
    expected_channels: int,
    label: str,
) -> dict[str, Any]:
    require(isinstance(artifact, dict), f"{label} artifact is missing")
    path = Path(str(artifact.get("path", ""))).expanduser().resolve()
    require(path.is_file(), f"{label} artifact is missing: {path}")
    expected_shape = [expected_grid, expected_grid, expected_grid, expected_channels]
    require(artifact.get("shape") == expected_shape, f"{label} shape mismatch: {artifact.get('shape')} != {expected_shape}")
    require(artifact.get("dtype") == "float32-le", f"{label} dtype must be float32-le")
    expected_bytes = expected_grid ** 3 * expected_channels * np.dtype("<f4").itemsize
    require(int(artifact.get("byteLength", -1)) == expected_bytes, f"{label} byteLength mismatch")
    require(path.stat().st_size == expected_bytes, f"{label} file size mismatch")
    actual_sha256 = sha256_file(path)
    require(actual_sha256 == artifact.get("sha256"), f"{label} sha256 mismatch")
    return {
        "path": path,
        "shape": expected_shape,
        "dtype": "float32-le",
        "byteLength": expected_bytes,
        "sha256": actual_sha256,
    }


def load_array(artifact: dict[str, Any]) -> np.ndarray:
    shape = tuple(int(value) for value in artifact["shape"])
    values = np.fromfile(artifact["path"], dtype="<f4")
    require(values.size == math.prod(shape), f"array element count mismatch for {artifact['path']}")
    require(bool(np.isfinite(values).all()), f"non-finite values in {artifact['path']}")
    return values.reshape(shape)


def overlap_weights(source_grid: int, target_grid: int) -> np.ndarray:
    weights = np.zeros((target_grid, source_grid), dtype=np.float64)
    source_width = source_grid / target_grid
    for target in range(target_grid):
        start = target * source_width
        end = (target + 1) * source_width
        first = max(0, int(math.floor(start)))
        last = min(source_grid - 1, int(math.ceil(end) - 1))
        for source in range(first, last + 1):
            overlap = max(0.0, min(end, source + 1.0) - max(start, float(source)))
            weights[target, source] = overlap / source_width
    require(bool(np.allclose(weights.sum(axis=1), 1.0, atol=1e-12)), "volume-overlap weights do not conserve constants")
    return weights


def volume_filter(values: np.ndarray, target_grid: int) -> np.ndarray:
    source_grid = int(values.shape[0])
    require(values.shape[0] == values.shape[1] == values.shape[2], "source field must use a cubic grid")
    require(source_grid >= target_grid > 0, "receiver grid must be positive and no larger than high grid")
    channels = int(values.shape[3])
    weights = overlap_weights(source_grid, target_grid)
    filtered = np.empty((target_grid, target_grid, target_grid, channels), dtype=np.float32)
    for channel in range(channels):
        source = values[:, :, :, channel].astype(np.float64, copy=False)
        along_x = np.tensordot(source, weights.T, axes=([2], [0]))
        along_y = np.tensordot(weights, along_x, axes=([1], [1])).transpose(1, 0, 2)
        along_z = np.tensordot(weights, along_y, axes=([1], [0]))
        filtered[:, :, :, channel] = along_z.astype(np.float32)
    return filtered


def validate_filter_agreement(actual: np.ndarray, expected: np.ndarray, label: str) -> dict[str, float | str]:
    delta = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    scale = np.maximum(np.abs(expected), np.float32(1.0))
    tolerance = np.spacing(scale).astype(np.float64)
    max_abs = float(np.max(delta))
    max_allowed = float(np.max(tolerance))
    require(bool(np.all(delta <= tolerance)), f"{label} does not equal filtered highT within one float32 ulp (maxAbs={max_abs}, maxAllowed={max_allowed})")
    return {
        "identity": FILTER_AGREEMENT_IDENTITY,
        "maxAbs": max_abs,
        "maxAllowed": max_allowed,
    }


def array_metrics(candidate: np.ndarray, target: np.ndarray) -> dict[str, float]:
    delta = candidate.astype(np.float64) - target.astype(np.float64)
    mse = float(np.mean(delta * delta))
    mae = float(np.mean(np.abs(delta)))
    return {
        "rmse": math.sqrt(mse),
        "mae": mae,
        "maxAbs": float(np.max(np.abs(delta))),
    }


def receiver_step_metrics(initial: np.ndarray, ordinary: np.ndarray, target: np.ndarray) -> dict[str, float]:
    initial64 = initial.astype(np.float64, copy=False).reshape(-1)
    ordinary64 = ordinary.astype(np.float64, copy=False).reshape(-1)
    target64 = target.astype(np.float64, copy=False).reshape(-1)
    target_delta = target64 - initial64
    receiver_delta = ordinary64 - initial64
    target_norm = float(np.linalg.norm(target_delta))
    receiver_norm = float(np.linalg.norm(receiver_delta))
    direction_cosine = float(np.dot(target_delta, receiver_delta) / (target_norm * receiver_norm)) if target_norm > 0 and receiver_norm > 0 else 0.0
    hold_rmse = math.sqrt(float(np.mean(target_delta * target_delta)))
    ordinary_error = ordinary64 - target64
    ordinary_rmse = math.sqrt(float(np.mean(ordinary_error * ordinary_error)))
    return {
        "targetDeltaRmse": hold_rmse,
        "receiverDeltaRmse": math.sqrt(float(np.mean(receiver_delta * receiver_delta))),
        "directionCosine": direction_cosine,
        "stepNormRatio": receiver_norm / target_norm if target_norm > 0 else 0.0,
        "ordinaryVsHoldRmseRatio": ordinary_rmse / hold_rmse if hold_rmse > 0 else 0.0,
        "errorReductionVsHoldFraction": (hold_rmse - ordinary_rmse) / hold_rmse if hold_rmse > 0 else 0.0,
    }


def combined_metrics(
    initial_fluid: np.ndarray,
    initial_front: np.ndarray,
    ordinary_fluid: np.ndarray,
    ordinary_front: np.ndarray,
    oracle_fluid: np.ndarray,
    oracle_front: np.ndarray,
    target_fluid: np.ndarray,
    target_front: np.ndarray,
) -> dict[str, float]:
    initial = np.concatenate((initial_fluid.reshape(-1), initial_front.reshape(-1))).astype(np.float64)
    ordinary = np.concatenate((ordinary_fluid.reshape(-1), ordinary_front.reshape(-1))).astype(np.float64)
    oracle = np.concatenate((oracle_fluid.reshape(-1), oracle_front.reshape(-1))).astype(np.float64)
    target = np.concatenate((target_fluid.reshape(-1), target_front.reshape(-1))).astype(np.float64)
    baseline_delta = ordinary - target
    oracle_delta = oracle - target
    baseline_rmse = math.sqrt(float(np.mean(baseline_delta * baseline_delta)))
    oracle_rmse = math.sqrt(float(np.mean(oracle_delta * oracle_delta)))
    hold_delta = initial - target
    hold_rmse = math.sqrt(float(np.mean(hold_delta * hold_delta)))
    step = receiver_step_metrics(initial, ordinary, target)
    return {
        "holdRmse": hold_rmse,
        "holdMae": float(np.mean(np.abs(hold_delta))),
        "baselineRmse": baseline_rmse,
        "baselineMae": float(np.mean(np.abs(baseline_delta))),
        "oracleRmse": oracle_rmse,
        "oracleMae": float(np.mean(np.abs(oracle_delta))),
        "rmseReductionFraction": (baseline_rmse - oracle_rmse) / baseline_rmse if baseline_rmse > 0 else 0.0,
        "receiverStepDirectionCosine": step["directionCosine"],
        "receiverStepNormRatio": step["stepNormRatio"],
        "ordinaryVsHoldRmseRatio": step["ordinaryVsHoldRmseRatio"],
        "errorReductionVsHoldFraction": step["errorReductionVsHoldFraction"],
    }


def write_array(path: Path, values: np.ndarray) -> dict[str, Any]:
    contiguous = np.ascontiguousarray(values, dtype="<f4")
    path.parent.mkdir(parents=True, exist_ok=True)
    contiguous.tofile(path)
    return {
        "path": str(path),
        "shape": list(contiguous.shape),
        "dtype": "float32-le",
        "byteLength": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def artifact_receipt(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": str(artifact["path"]),
        "shape": artifact["shape"],
        "dtype": artifact["dtype"],
        "byteLength": artifact["byteLength"],
        "sha256": artifact["sha256"],
    }


def validate_input(manifest: dict[str, Any], input_path: Path) -> dict[str, Any]:
    require(manifest.get("schema") == INPUT_SCHEMA, f"input schema mismatch: {manifest.get('schema')}")
    require(manifest.get("identity") == INPUT_IDENTITY, f"input identity mismatch: {manifest.get('identity')}")
    basin = manifest.get("basin") or {}
    basin_path = Path(str(basin.get("path", ""))).expanduser().resolve()
    require(basin_path.is_file(), f"basin artifact is missing: {basin_path}")
    actual_basin_sha256 = sha256_file(basin_path)
    require(actual_basin_sha256 == basin.get("sha256"), "basin sha256 mismatch")
    require(bool(basin.get("identity")), "basin identity is missing")
    route = manifest.get("route") or {}
    for key in ("requested", "effective", "backend"):
        require(bool(route.get(key)), f"route {key} is missing")
    grids = manifest.get("grids") or {}
    high_grid = int(grids.get("high", 0))
    receiver_grid = int(grids.get("receiver", 0))
    require(high_grid >= receiver_grid > 0, "invalid high/receiver grids")
    layout = manifest.get("layout") or {}
    require(layout.get("order") == LAYOUT_IDENTITY, "field layout identity mismatch")
    require(layout.get("fluidChannels") == EXPECTED_FLUID_CHANNELS, "canonical fluid channel order mismatch")
    require(layout.get("frontChannels") == EXPECTED_FRONT_CHANNELS, "canonical front channel order mismatch")
    pairs = manifest.get("pairs")
    require(isinstance(pairs, list) and pairs, "input must contain at least one phase-aligned pair")
    validated_pairs = []
    for pair_index, pair in enumerate(pairs):
        pair_id = str(pair.get("id") or f"pair-{pair_index:03d}")
        high_t = pair.get("highT") or {}
        high_t1 = pair.get("highT1") or {}
        ordinary = pair.get("ordinaryLowT1") or {}
        require(int(high_t1.get("simStepCount", -1)) == int(high_t.get("simStepCount", -2)) + 1, f"{pair_id} high states are not consecutive")
        require(ordinary.get("initializationAuthority") == INITIALIZATION_AUTHORITY, f"{pair_id} ordinary low step was not initialized from filtered high t")
        high_t_fluid = validate_artifact(high_t.get("fluid"), high_grid, len(EXPECTED_FLUID_CHANNELS), f"{pair_id} highT fluid")
        high_t_front = validate_artifact(high_t.get("front"), high_grid, len(EXPECTED_FRONT_CHANNELS), f"{pair_id} highT front")
        high_t1_fluid = validate_artifact(high_t1.get("fluid"), high_grid, len(EXPECTED_FLUID_CHANNELS), f"{pair_id} highT1 fluid")
        high_t1_front = validate_artifact(high_t1.get("front"), high_grid, len(EXPECTED_FRONT_CHANNELS), f"{pair_id} highT1 front")
        ordinary_fluid = validate_artifact(ordinary.get("fluid"), receiver_grid, len(EXPECTED_FLUID_CHANNELS), f"{pair_id} ordinaryLowT1 fluid")
        ordinary_front = validate_artifact(ordinary.get("front"), receiver_grid, len(EXPECTED_FRONT_CHANNELS), f"{pair_id} ordinaryLowT1 front")

        initialized_from = ordinary.get("initializedFrom") or {}
        require(initialized_from.get("identity") == INITIALIZATION_AUTHORITY, f"{pair_id} initializedFrom identity mismatch")
        initialized_high_t = initialized_from.get("highT") or {}
        require(int(initialized_high_t.get("simStepCount", -1)) == int(high_t.get("simStepCount", -2)), f"{pair_id} initializedFrom highT sim step mismatch")
        require(initialized_high_t.get("fluidSha256") == high_t_fluid["sha256"], f"{pair_id} initializedFrom highT fluid sha256 mismatch")
        require(initialized_high_t.get("frontSha256") == high_t_front["sha256"], f"{pair_id} initializedFrom highT front sha256 mismatch")
        require(initialized_from.get("filterIdentity") == FILTER_IDENTITY, f"{pair_id} initializedFrom filter identity mismatch")
        require(int(initialized_from.get("receiverGrid", 0)) == receiver_grid, f"{pair_id} initializedFrom receiver grid mismatch")
        require(initialized_from.get("layoutIdentity") == LAYOUT_IDENTITY, f"{pair_id} initializedFrom layout identity mismatch")
        initial_sim_step = int(initialized_from.get("receiverInitialSimStepCount", -1))
        require(int(ordinary.get("simStepCount", -1)) == initial_sim_step + 1, f"{pair_id} ordinary low state is not one step after receiver initialization")
        receiver_initial = initialized_from.get("receiverInitialT") or {}
        receiver_initial_fluid = validate_artifact(receiver_initial.get("fluid"), receiver_grid, len(EXPECTED_FLUID_CHANNELS), f"{pair_id} receiverInitialT fluid")
        receiver_initial_front = validate_artifact(receiver_initial.get("front"), receiver_grid, len(EXPECTED_FRONT_CHANNELS), f"{pair_id} receiverInitialT front")
        computed_initial_fluid = volume_filter(load_array(high_t_fluid), receiver_grid)
        computed_initial_front = volume_filter(load_array(high_t_front), receiver_grid)
        fluid_filter_agreement = validate_filter_agreement(load_array(receiver_initial_fluid), computed_initial_fluid, f"{pair_id} receiverInitialT fluid")
        front_filter_agreement = validate_filter_agreement(load_array(receiver_initial_front), computed_initial_front, f"{pair_id} receiverInitialT front")
        validated_pairs.append({
            "id": pair_id,
            "highT": {
                "simStepCount": int(high_t["simStepCount"]),
                "fluid": high_t_fluid,
                "front": high_t_front,
            },
            "highT1": {
                "simStepCount": int(high_t1["simStepCount"]),
                "fluid": high_t1_fluid,
                "front": high_t1_front,
            },
            "ordinaryLowT1": {
                "simStepCount": int(ordinary.get("simStepCount", -1)),
                "initializationAuthority": ordinary["initializationAuthority"],
                "initializedFrom": {
                    "identity": INITIALIZATION_AUTHORITY,
                    "highT": {
                        "simStepCount": int(initialized_high_t["simStepCount"]),
                        "fluidSha256": high_t_fluid["sha256"],
                        "frontSha256": high_t_front["sha256"],
                    },
                    "filterIdentity": FILTER_IDENTITY,
                    "receiverGrid": receiver_grid,
                    "layoutIdentity": LAYOUT_IDENTITY,
                    "receiverInitialSimStepCount": initial_sim_step,
                    "receiverInitialT": {
                        "fluid": receiver_initial_fluid,
                        "front": receiver_initial_front,
                    },
                    "filterAgreement": {
                        "fluid": fluid_filter_agreement,
                        "front": front_filter_agreement,
                    },
                },
                "fluid": ordinary_fluid,
                "front": ordinary_front,
            },
        })
    return {
        "inputManifest": str(input_path),
        "inputManifestSha256": sha256_file(input_path),
        "basin": {"path": str(basin_path), "sha256": actual_basin_sha256, "identity": basin["identity"]},
        "route": route,
        "grids": {"high": high_grid, "receiver": receiver_grid},
        "layout": layout,
        "pairs": validated_pairs,
    }


def process_pair(pair: dict[str, Any], receiver_grid: int, pair_dir: Path) -> dict[str, Any]:
    high_fluid_t = load_array(pair["highT"]["fluid"])
    high_front_t = load_array(pair["highT"]["front"])
    high_fluid_t1 = load_array(pair["highT1"]["fluid"])
    high_front_t1 = load_array(pair["highT1"]["front"])
    ordinary_fluid_t1 = load_array(pair["ordinaryLowT1"]["fluid"])
    ordinary_front_t1 = load_array(pair["ordinaryLowT1"]["front"])

    filtered_fluid_t = volume_filter(high_fluid_t, receiver_grid)
    filtered_front_t = volume_filter(high_front_t, receiver_grid)
    filtered_fluid_t1 = volume_filter(high_fluid_t1, receiver_grid)
    filtered_front_t1 = volume_filter(high_front_t1, receiver_grid)
    closure_fluid = filtered_fluid_t1 - ordinary_fluid_t1
    closure_front = filtered_front_t1 - ordinary_front_t1
    oracle_fluid = ordinary_fluid_t1 + closure_fluid
    oracle_front = ordinary_front_t1 + closure_front

    role_values = {
        "filteredHighT": (filtered_fluid_t, filtered_front_t),
        "ordinaryLowT1": (ordinary_fluid_t1, ordinary_front_t1),
        "exactClosureResidual": (closure_fluid, closure_front),
        "oracleApplied": (oracle_fluid, oracle_front),
        "filteredHighT1": (filtered_fluid_t1, filtered_front_t1),
    }
    artifacts = {}
    for role in ROLE_ORDER:
        role_slug = role[0].lower() + role[1:]
        fluid_values, front_values = role_values[role]
        artifacts[role] = {
            "fluid": write_array(pair_dir / f"{role_slug}.fluid.f32", fluid_values),
            "front": write_array(pair_dir / f"{role_slug}.front.f32", front_values),
        }

    channels = []
    for channel_index, channel_name in enumerate(EXPECTED_FLUID_CHANNELS):
        hold = array_metrics(filtered_fluid_t[:, :, :, channel_index], filtered_fluid_t1[:, :, :, channel_index])
        baseline = array_metrics(ordinary_fluid_t1[:, :, :, channel_index], filtered_fluid_t1[:, :, :, channel_index])
        oracle = array_metrics(oracle_fluid[:, :, :, channel_index], filtered_fluid_t1[:, :, :, channel_index])
        receiver_step = receiver_step_metrics(
            filtered_fluid_t[:, :, :, channel_index],
            ordinary_fluid_t1[:, :, :, channel_index],
            filtered_fluid_t1[:, :, :, channel_index],
        )
        channels.append({"name": channel_name, "family": "fluid", "hold": hold, "baseline": baseline, "oracle": oracle, "receiverStep": receiver_step})
    front_hold = array_metrics(filtered_front_t[:, :, :, 0], filtered_front_t1[:, :, :, 0])
    front_baseline = array_metrics(ordinary_front_t1[:, :, :, 0], filtered_front_t1[:, :, :, 0])
    front_oracle = array_metrics(oracle_front[:, :, :, 0], filtered_front_t1[:, :, :, 0])
    front_receiver_step = receiver_step_metrics(filtered_front_t[:, :, :, 0], ordinary_front_t1[:, :, :, 0], filtered_front_t1[:, :, :, 0])
    channels.append({"name": "frontTopology", "family": "front", "hold": front_hold, "baseline": front_baseline, "oracle": front_oracle, "receiverStep": front_receiver_step})
    initialized_from = pair["ordinaryLowT1"]["initializedFrom"]

    return {
        "id": pair["id"],
        "sourceSteps": {
            "highT": pair["highT"]["simStepCount"],
            "highT1": pair["highT1"]["simStepCount"],
            "ordinaryLowT1": pair["ordinaryLowT1"]["simStepCount"],
            "ordinaryLowInitializationAuthority": pair["ordinaryLowT1"]["initializationAuthority"],
            "ordinaryLowInitializedFrom": {
                **{key: value for key, value in initialized_from.items() if key != "receiverInitialT"},
                "receiverInitialT": {
                    "fluid": artifact_receipt(initialized_from["receiverInitialT"]["fluid"]),
                    "front": artifact_receipt(initialized_from["receiverInitialT"]["front"]),
                },
            },
        },
        "filterIdentity": FILTER_IDENTITY,
        "metrics": {
            "global": combined_metrics(
                filtered_fluid_t,
                filtered_front_t,
                ordinary_fluid_t1,
                ordinary_front_t1,
                oracle_fluid,
                oracle_front,
                filtered_fluid_t1,
                filtered_front_t1,
            )
        },
        "channels": channels,
        "artifacts": artifacts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--report")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve() if args.report else out_dir / "manifest.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    failure_phase = "input-manifest-read"
    last_trustworthy_evidence: dict[str, Any] = {}
    try:
        input_bytes = input_path.read_bytes()
        last_trustworthy_evidence = {
            "inputManifest": str(input_path),
            "inputManifestSha256": sha256_bytes(input_bytes),
        }
        manifest = json.loads(input_bytes)
        failure_phase = "input-validation"
        validated = validate_input(manifest, input_path)
        last_trustworthy_evidence = {
            **last_trustworthy_evidence,
            "basin": validated["basin"],
            "route": validated["route"],
            "grids": validated["grids"],
            "validatedPairCount": len(validated["pairs"]),
        }
        pair_results = []
        for pair_index, pair in enumerate(validated["pairs"]):
            failure_phase = f"pair-{pair['id']}-closure-construction"
            pair_result = process_pair(pair, validated["grids"]["receiver"], out_dir / f"pair-{pair_index:03d}-{pair['id']}")
            pair_results.append(pair_result)
            last_trustworthy_evidence["completedPairCount"] = len(pair_results)
        report = {
            "schema": OUTPUT_SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "applicationAuthority": APPLICATION_AUTHORITY,
            "runtimeTruthAvailable": False,
            "inputIdentity": INPUT_IDENTITY,
            "filterIdentity": FILTER_IDENTITY,
            "roleOrder": ROLE_ORDER,
            "source": last_trustworthy_evidence,
            "layout": validated["layout"],
            "pairs": pair_results,
            "doesNotProve": [
                "A learned model can predict the exact closure residual.",
                "High-grid truth is available at product runtime.",
                "An independently evolved low simulation is phase aligned with the high trajectory.",
                "One-step exact correction remains stable during an autoregressive rollout.",
            ],
        }
        write_json(report_path, report)
        print(json.dumps({"ok": True, "report": str(report_path), "pairs": len(pair_results)}, indent=2))
        return 0
    except Exception as error:  # The report is the recovery surface for validation and processing failures.
        write_json(report_path, {
            "schema": OUTPUT_SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "reason": str(error),
            "applicationAuthority": APPLICATION_AUTHORITY,
            "runtimeTruthAvailable": False,
            "lastTrustworthyEvidence": last_trustworthy_evidence,
        })
        print(json.dumps({"ok": False, "report": str(report_path), "failurePhase": failure_phase, "reason": str(error)}, indent=2), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
