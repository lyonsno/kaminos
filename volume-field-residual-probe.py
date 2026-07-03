#!/usr/bin/env python3
"""Tiny field-space residual probe for Kaminos low/high tile pairs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.field-residual-probe.v0"
RESIDUAL_APPLICATION_ARTIFACT_SCHEMA = "kaminos.volume.field-residual-application-artifact.v0"
RESIDUAL_APPLICATION_ARTIFACT_IDENTITY = "offline-test-tile-target-residual-application-v0"
AFFINE_MODEL_IDENTITY = "same-bin-per-channel-affine-ridge-v0"
SPATIAL_CONTEXT_MODEL_IDENTITY = "spatial-context-linear-ridge-v0"
SPATIAL_CONTEXT_MLP_MODEL_IDENTITY = "spatial-context-mlp-residual-v0"
NO_ROUTE_CONDITIONING_IDENTITY = "none"
ROUTE_CONTROLS_CONDITIONING_IDENTITY = "route-controls-v0"
ROUTE_CONTROLS_REPLAY_CONDITIONING_IDENTITY = "route-controls-replay-v0"
RANDOM_TILE_PAIR_SPLIT_IDENTITY = "random-tile-pair-v0"
REPLAY_BALANCED_TILE_PAIR_SPLIT_IDENTITY = "replay-balanced-tile-pair-v0"
MODEL_IDENTITY = AFFINE_MODEL_IDENTITY
BACKEND = "numpy"
ROUTE_CONTROL_CHANNELS = [
    "density",
    "fire",
    "radiance",
    "absorption",
    "glow",
    "smoke",
    "curl",
    "microdetail",
    "interfaceShred",
    "fireLicks",
    "projection",
    "speed",
    "fireScale",
    "detailScale",
    "plumeHeight",
    "windStrength",
    "windAngle",
    "windHeight",
    "inputRadius",
    "flowRate",
    "reactionFuelScale",
    "majorantCadence",
    "pressureIterations",
    "occupancySkip",
    "majorantSkip",
    "majorantSmooth",
    "majorantGuard",
]
ROUTE_QUERY_PARAM_BY_CONTROL = {
    "density": "volume_density",
    "fire": "volume_fire",
    "radiance": "volume_radiance",
    "absorption": "volume_absorption",
    "glow": "volume_glow",
    "smoke": "volume_smoke",
    "curl": "volume_curl",
    "microdetail": "volume_microdetail",
    "interfaceShred": "volume_interface_shred",
    "fireLicks": "volume_fire_licks",
    "projection": "volume_projection",
    "speed": "volume_speed",
    "fireScale": "volume_fire_scale",
    "detailScale": "volume_detail_scale",
    "plumeHeight": "volume_plume_height",
    "windStrength": "volume_wind_strength",
    "windAngle": "volume_wind_angle",
    "windHeight": "volume_wind_height",
    "inputRadius": "volume_input_radius",
    "flowRate": "volume_flow_rate",
    "reactionFuelScale": "volume_reaction_fuel",
    "majorantCadence": "volume_majorant_cadence",
    "pressureIterations": "volume_pressure_iterations",
    "occupancySkip": "volume_occupancy_skip",
    "majorantSkip": "volume_majorant_skip",
    "majorantSmooth": "volume_majorant_smooth",
    "majorantGuard": "volume_majorant_guard",
}
REPLAY_CONDITIONING_CHANNELS = [
    "replayStartTimeMs",
    "replayTimeStepMs",
    "replaySteps",
]
FIELD_TILE_CHANNELS = [
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
    "frontTopology",
]
TARGET_CHANNEL_GROUPS = {
    "all": FIELD_TILE_CHANNELS,
    "motion": ["velocityX", "velocityY", "velocityZ"],
    "smoke-density": ["densityCarrier", "smokeDensity"],
    "thermal-fuel": ["heat", "fuel"],
    "visible-fire": ["flame", "ember", "visibleFireCarrier", "combustionFront", "emberFleck"],
    "micro-structure": ["detail", "microdetail", "interfaceShred", "fireLick", "frontTopology"],
    "curl-interface": ["microdetail", "interfaceShred", "fireLick", "frontTopology"],
}


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to a volume field-pair dataset manifest JSON.")
    parser.add_argument("--out", required=True, help="Path to write the residual probe report JSON.")
    parser.add_argument("--train-fraction", type=float, default=0.75, help="Tile-pair training fraction.")
    parser.add_argument(
        "--split-strategy",
        choices=[RANDOM_TILE_PAIR_SPLIT_IDENTITY, REPLAY_BALANCED_TILE_PAIR_SPLIT_IDENTITY],
        default=RANDOM_TILE_PAIR_SPLIT_IDENTITY,
        help="Train/test split strategy for non-holdout probes.",
    )
    parser.add_argument("--ridge", type=float, default=1.0e-4, help="Ridge penalty for the selected linear model.")
    parser.add_argument("--seed", type=int, default=7, help="Deterministic tile-pair split seed.")
    parser.add_argument(
        "--model",
        choices=[AFFINE_MODEL_IDENTITY, SPATIAL_CONTEXT_MODEL_IDENTITY, SPATIAL_CONTEXT_MLP_MODEL_IDENTITY],
        default=AFFINE_MODEL_IDENTITY,
        help="Residual probe model identity to train.",
    )
    parser.add_argument(
        "--context-radius",
        type=int,
        default=1,
        help="Spatial-context radius for spatial-context-linear-ridge-v0; radius 1 means a 3x3x3 voxel neighborhood.",
    )
    parser.add_argument("--hidden-width", type=int, default=32, help="Hidden width for spatial-context-mlp-residual-v0.")
    parser.add_argument("--epochs", type=int, default=180, help="Training epochs for spatial-context-mlp-residual-v0.")
    parser.add_argument("--learning-rate", type=float, default=0.003, help="Adam learning rate for spatial-context-mlp-residual-v0.")
    parser.add_argument("--batch-size", type=int, default=512, help="Minibatch size for spatial-context-mlp-residual-v0.")
    parser.add_argument(
        "--independent-target-heads",
        action="store_true",
        help="For spatial-context-mlp-residual-v0, train one independent nonlinear residual head per target channel to diagnose multi-target interference.",
    )
    parser.add_argument(
        "--allow-different-spatial-bin",
        action="store_true",
        help="Allow matched pairs whose sidecars do not report the same spatial bin.",
    )
    parser.add_argument(
        "--max-normalized-separation",
        type=float,
        default=None,
        help="Optional maximum normalized tile separation for usable pairs.",
    )
    parser.add_argument(
        "--holdout-route-variant",
        default=None,
        help="Train on all other route variants and test on this routeVariantIdentity.",
    )
    parser.add_argument(
        "--holdout-route-variant-list",
        default=None,
        help="Comma-separated routeVariantIdentity list to hold out as one route family.",
    )
    parser.add_argument(
        "--holdout-replay-state",
        default=None,
        help="Train on all other deterministic replay states and test on this replayStateIdentity.",
    )
    parser.add_argument(
        "--include-replay-state-list",
        default=None,
        help="Comma-separated replayStateIdentity list to include before train/test splitting; excluded replay states remain reported.",
    )
    parser.add_argument(
        "--route-conditioning",
        choices=[NO_ROUTE_CONDITIONING_IDENTITY, ROUTE_CONTROLS_CONDITIONING_IDENTITY, ROUTE_CONTROLS_REPLAY_CONDITIONING_IDENTITY],
        default=NO_ROUTE_CONDITIONING_IDENTITY,
        help="Append effective route-control and optional replay scalar features to spatial-context probe inputs.",
    )
    parser.add_argument(
        "--target-channel-list",
        default=None,
        help="Comma-separated output channel names or indexes to train/evaluate while reading the full field input.",
    )
    parser.add_argument(
        "--target-channel-group",
        choices=sorted(TARGET_CHANNEL_GROUPS.keys()),
        default="all",
        help="Named target channel group for decomposition probes.",
    )
    parser.add_argument(
        "--artifact-dir",
        default=None,
        help="Optional directory for offline residual application artifacts over the held-out test tiles.",
    )
    return parser.parse_args()


def model_identity(args: argparse.Namespace) -> str:
    return str(getattr(args, "model", AFFINE_MODEL_IDENTITY) or AFFINE_MODEL_IDENTITY)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def git_value(args: list[str], fallback: str | None = None) -> str | None:
    try:
        value = subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL, text=True).strip()
        return value or fallback
    except Exception:
        return fallback


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(payload), indent=2) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_float32_payload(path: Path, values: np.ndarray) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.asarray(values, dtype=np.float32).tofile(path)
    return {
        "path": str(path),
        "dtype": "float32",
        "byteLength": int(path.stat().st_size),
        "sha256": sha256_file(path),
    }


def to_jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def base_report(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "schema": REPORT_SCHEMA,
        "identity": model_identity(args),
        "status": "started",
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "failurePhase": None,
        "backend": {
            "name": BACKEND,
            "numpyVersion": np.__version__,
            "pythonVersion": platform.python_version(),
            "platform": platform.platform(),
        },
        "sourceManifest": str(Path(args.manifest).resolve()),
        "requested": {
            "trainFraction": args.train_fraction,
            "splitStrategy": args.split_strategy,
            "ridge": args.ridge,
            "seed": args.seed,
            "model": model_identity(args),
            "contextRadius": args.context_radius,
            "hiddenWidth": args.hidden_width,
            "epochs": args.epochs,
            "learningRate": args.learning_rate,
            "batchSize": args.batch_size,
            "requireSameSpatialBin": not args.allow_different_spatial_bin,
            "maxNormalizedSeparation": args.max_normalized_separation,
            "holdoutRouteVariant": args.holdout_route_variant,
            "holdoutRouteVariantList": args.holdout_route_variant_list,
            "holdoutReplayState": args.holdout_replay_state,
            "includeReplayStateList": args.include_replay_state_list,
            "routeConditioning": args.route_conditioning,
            "targetChannelList": args.target_channel_list,
            "targetChannelGroup": args.target_channel_group,
            "artifactDir": args.artifact_dir,
        },
        "route": {
            "cwd": str(Path.cwd()),
            "gitCommit": git_value(["rev-parse", "HEAD"]),
            "gitBranch": git_value(["branch", "--show-current"]),
            "gitStatusShort": git_value(["status", "--short"], ""),
        },
        "limitations": [
            "This is a same-bin tile ingestion and learnability probe, not a product residual model.",
            "The affine model has no spatial context; spatial-context models remain local probes with no temporal memory.",
            "Pairs inherit deterministic replay field authority from the dataset and do not prove literal cross-grid GPU snapshot transfer.",
        ],
    }


def fail_report(args: argparse.Namespace, phase: str, message: str, evidence: dict[str, Any] | None = None) -> int:
    report = base_report(args)
    report.update({
        "status": "failed",
        "updatedAt": utc_now(),
        "failurePhase": phase,
        "error": message,
        "lastTrustworthyEvidence": evidence or {},
    })
    write_json(Path(args.out), report)
    return 1


def read_manifest(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProbeFailure("manifest-read", f"source manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ProbeFailure("manifest-read", f"source manifest is not valid JSON: {exc}") from exc
    dataset = payload.get("dataset", payload)
    if not isinstance(dataset, dict):
        raise ProbeFailure("manifest-read", "source manifest does not contain a dataset object")
    return dataset


def resolve_payload_path(raw_path: str, manifest_path: Path, dataset: dict[str, Any]) -> Path:
    path = Path(str(raw_path))
    if path.is_absolute():
        return path
    out_dir = dataset.get("outDir")
    candidates = []
    if out_dir:
        candidates.append(Path(str(out_dir)) / path)
    candidates.append(manifest_path.parent / path)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def product(values: list[Any]) -> int:
    result = 1
    for value in values:
        result *= int(value)
    return result


def load_tile(path: Path, shape: list[Any]) -> np.ndarray:
    if len(shape) < 2:
        raise ProbeFailure("tile-read", f"tile shape must include spatial axes and channels: {shape}")
    expected = product(shape)
    array = np.fromfile(path, dtype=np.float32)
    if array.size != expected:
        raise ProbeFailure(
            "tile-read",
            f"tile payload size mismatch for {path}: expected {expected} float32 values, found {array.size}",
            {"path": str(path), "shape": shape, "expectedFloat32Values": expected, "actualFloat32Values": int(array.size)},
        )
    if not np.isfinite(array).all():
        raise ProbeFailure("tile-read", f"tile payload contains non-finite values: {path}", {"path": str(path)})
    return array.reshape(tuple(int(value) for value in shape))


def finite_float(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def route_conditioning_channels(mode: str) -> list[str]:
    if mode == ROUTE_CONTROLS_CONDITIONING_IDENTITY:
        return list(ROUTE_CONTROL_CHANNELS)
    if mode == ROUTE_CONTROLS_REPLAY_CONDITIONING_IDENTITY:
        return [*ROUTE_CONTROL_CHANNELS, *REPLAY_CONDITIONING_CHANNELS]
    return []


def effective_controls_for_pair(pair: dict[str, Any]) -> dict[str, Any]:
    low_controls = pair.get("low", {}).get("effective", {}).get("controls")
    high_controls = pair.get("high", {}).get("effective", {}).get("controls")
    if isinstance(low_controls, dict):
        return low_controls
    if isinstance(high_controls, dict):
        return high_controls
    return {}


def route_query_params_for_pair(pair: dict[str, Any]) -> dict[str, Any]:
    query = pair.get("routeVariant", {}).get("queryParams")
    return query if isinstance(query, dict) else {}


def replay_for_pair(pair: dict[str, Any]) -> dict[str, Any]:
    replay = pair.get("replayState", {}).get("deterministicReplay")
    if isinstance(replay, dict):
        return replay
    low_replay = pair.get("low", {}).get("effective", {}).get("deterministicReplay")
    if isinstance(low_replay, dict):
        return low_replay
    high_replay = pair.get("high", {}).get("effective", {}).get("deterministicReplay")
    return high_replay if isinstance(high_replay, dict) else {}


def parse_holdout_route_variant_list(raw_value: str | None) -> list[str]:
    return parse_csv_unique(raw_value)


def parse_include_replay_state_list(raw_value: str | None) -> list[str]:
    return parse_csv_unique(raw_value)


def parse_csv_unique(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    seen: set[str] = set()
    values: list[str] = []
    for item in str(raw_value).split(","):
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)
    return values


def infer_field_tile_channels(dataset: dict[str, Any], expected_count: int) -> list[str]:
    channel_orders: list[list[str]] = []
    for pair in dataset.get("pairs") or []:
        for role in ["low", "high"]:
            export = pair.get(role, {}).get("effective", {}).get("fieldTileExport")
            channels = export.get("channels") if isinstance(export, dict) else None
            if isinstance(channels, list) and channels:
                channel_orders.append([str(channel) for channel in channels])
    if channel_orders:
        first = channel_orders[0]
        for channels in channel_orders[1:]:
            if channels != first:
                raise ProbeFailure(
                    "channel-identity",
                    "field tile channel order changed across low/high exports",
                    {"firstChannels": first, "mismatchedChannels": channels},
                )
        if len(first) != expected_count:
            raise ProbeFailure(
                "channel-identity",
                "field tile channel count does not match tile payload width",
                {"channels": first, "expectedCount": expected_count},
            )
        return first
    if len(FIELD_TILE_CHANNELS) == expected_count:
        return list(FIELD_TILE_CHANNELS)
    return [f"channel-{index}" for index in range(expected_count)]


def resolve_target_channels(args: argparse.Namespace, channel_names: list[str]) -> dict[str, Any]:
    explicit = parse_csv_unique(args.target_channel_list)
    group = str(args.target_channel_group or "all")
    if explicit and group != "all":
        raise ProbeFailure(
            "target-channel-config",
            "choose either --target-channel-list or a non-all --target-channel-group, not both",
            {"targetChannelList": explicit, "targetChannelGroup": group},
        )
    requested = explicit if explicit else TARGET_CHANNEL_GROUPS.get(group, TARGET_CHANNEL_GROUPS["all"])
    indexes: list[int] = []
    selected: list[str] = []
    for raw in requested:
        token = str(raw).strip()
        if not token:
            continue
        if token.isdigit():
            index = int(token)
            if index < 0 or index >= len(channel_names):
                raise ProbeFailure(
                    "target-channel-config",
                    "target channel index is out of range",
                    {"targetChannel": token, "availableChannels": channel_names},
                )
            name = channel_names[index]
        else:
            if token not in channel_names:
                raise ProbeFailure(
                    "target-channel-config",
                    "target channel name is not present in field tile channels",
                    {"targetChannel": token, "availableChannels": channel_names},
                )
            index = channel_names.index(token)
            name = token
        if index not in indexes:
            indexes.append(index)
            selected.append(name)
    if not indexes:
        raise ProbeFailure("target-channel-config", "at least one target channel is required", {"availableChannels": channel_names})
    return {
        "identity": "explicit-target-channel-list-v0" if explicit else f"target-channel-group-{group}-v0",
        "targetChannelGroup": group if not explicit else None,
        "sourceChannels": channel_names,
        "targetChannelIndexes": indexes,
        "targetChannels": selected,
        "inputChannelCount": len(channel_names),
        "targetChannelCount": len(indexes),
        "selectionAuthority": "model-output-target-selection-only-full-field-input-preserved",
    }


def select_channels(values: np.ndarray, indexes: list[int]) -> np.ndarray:
    return values[:, indexes].astype(np.float64)


def route_conditioning_for_pair(pair: dict[str, Any], mode: str) -> dict[str, Any]:
    channels = route_conditioning_channels(mode)
    controls = effective_controls_for_pair(pair)
    query = route_query_params_for_pair(pair)
    replay = replay_for_pair(pair)
    values: list[float] = []
    for channel in channels:
        if channel in ROUTE_CONTROL_CHANNELS:
            values.append(finite_float(controls.get(channel, query.get(ROUTE_QUERY_PARAM_BY_CONTROL.get(channel, "")))))
        elif channel == "replayStartTimeMs":
            values.append(finite_float(replay.get("startTimeMs")))
        elif channel == "replayTimeStepMs":
            values.append(finite_float(replay.get("timeStepMs")))
        elif channel == "replaySteps":
            values.append(finite_float(replay.get("steps")))
        else:
            values.append(0.0)
    return {
        "identity": mode,
        "channels": channels,
        "values": values,
        "source": "effective-witness-controls-with-route-query-fallback-and-deterministic-replay-scalars",
    }


def candidate_matches(dataset: dict[str, Any], manifest_path: Path, args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pairs = dataset.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        raise ProbeFailure("pairing-read", "dataset contains no field pairs", {"datasetKeys": sorted(dataset.keys())})
    usable: list[dict[str, Any]] = []
    discarded: list[dict[str, Any]] = []
    require_same_bin = not args.allow_different_spatial_bin
    for pair in pairs:
        pairing = pair.get("fieldTileCoveragePairing") if isinstance(pair, dict) else None
        if not isinstance(pairing, dict):
            discarded.append({"pairId": pair.get("pairId"), "reason": "missing-fieldTileCoveragePairing"})
            continue
        for match in pairing.get("matchedTilePairs", []):
            match_id = f"{pair.get('pairId')}:{match.get('matchId')}"
            if require_same_bin and not match.get("sameSpatialBin"):
                discarded.append({"matchId": match_id, "reason": "different-spatial-bin"})
                continue
            separation = match.get("normalizedTileSeparation")
            if args.max_normalized_separation is not None and float(separation or 0.0) > args.max_normalized_separation:
                discarded.append({
                    "matchId": match_id,
                    "reason": "normalized-separation-above-limit",
                    "normalizedTileSeparation": separation,
                })
                continue
            low_shape = match.get("lowShape")
            high_shape = match.get("highShape")
            if low_shape != high_shape:
                discarded.append({"matchId": match_id, "reason": "shape-mismatch", "lowShape": low_shape, "highShape": high_shape})
                continue
            if not isinstance(low_shape, list) or len(low_shape) < 2:
                discarded.append({"matchId": match_id, "reason": "bad-shape", "shape": low_shape})
                continue
            low_path = resolve_payload_path(match.get("lowPath"), manifest_path, dataset)
            high_path = resolve_payload_path(match.get("highPath"), manifest_path, dataset)
            if not low_path.exists() or not high_path.exists():
                discarded.append({
                    "matchId": match_id,
                    "reason": "missing-payload",
                    "lowPath": str(low_path),
                    "highPath": str(high_path),
                })
                continue
            usable.append({
                "pairId": pair.get("pairId"),
                "routeVariantIdentity": pair.get("routeVariantIdentity"),
                "replayStateIdentity": pair.get("replayStateIdentity"),
                "routeConditioning": route_conditioning_for_pair(pair, args.route_conditioning),
                "matchId": match.get("matchId"),
                "lowTileId": match.get("lowTileId"),
                "highTileId": match.get("highTileId"),
                "sameSpatialBin": bool(match.get("sameSpatialBin")),
                "lowSpatialBinId": match.get("lowSpatialBinId"),
                "highSpatialBinId": match.get("highSpatialBinId"),
                "normalizedTileDistance": match.get("normalizedTileDistance"),
                "normalizedTileSeparation": match.get("normalizedTileSeparation"),
                "shape": [int(value) for value in low_shape],
                "lowPath": str(low_path),
                "highPath": str(high_path),
                "lowEnergySum": match.get("lowEnergySum"),
                "highEnergySum": match.get("highEnergySum"),
            })
    return usable, discarded


def filter_matches_by_replay_state(matches: list[dict[str, Any]], args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    include_replay_states = parse_include_replay_state_list(args.include_replay_state_list)
    available_counts: dict[str, int] = {}
    for match in matches:
        replay_state = str(match.get("replayStateIdentity") or "unknown-replay-state")
        available_counts[replay_state] = available_counts.get(replay_state, 0) + 1
    if not include_replay_states:
        return matches, {
            "identity": "none",
            "requestedReplayStateIdentities": [],
            "includedReplayStateIdentities": sorted(available_counts.keys()),
            "excludedReplayStateIdentities": [],
            "availableReplayCounts": dict(sorted(available_counts.items())),
            "includedReplayCounts": dict(sorted(available_counts.items())),
            "excludedReplayCounts": {},
            "limitation": "No replay-state include filter was requested.",
        }
    include_set = set(include_replay_states)
    unknown = [value for value in include_replay_states if value not in available_counts]
    if unknown:
        raise ProbeFailure(
            "replay-state-filter",
            "requested replay-state include filter names states that are absent from usable matches",
            {
                "requestedReplayStateIdentities": include_replay_states,
                "missingReplayStateIdentities": unknown,
                "availableReplayStateIdentities": sorted(available_counts.keys()),
                "availableReplayCounts": dict(sorted(available_counts.items())),
            },
        )
    filtered = [match for match in matches if str(match.get("replayStateIdentity") or "unknown-replay-state") in include_set]
    if len(filtered) < 2:
        raise ProbeFailure(
            "replay-state-filter",
            "replay-state include filter left fewer than two usable tile pairs",
            {
                "requestedReplayStateIdentities": include_replay_states,
                "usableTilePairsBeforeReplayStateFilter": len(matches),
                "usableTilePairsAfterReplayStateFilter": len(filtered),
                "availableReplayCounts": dict(sorted(available_counts.items())),
            },
        )
    included_counts: dict[str, int] = {}
    excluded_counts: dict[str, int] = {}
    for replay_state, count in available_counts.items():
        if replay_state in include_set:
            included_counts[replay_state] = count
        else:
            excluded_counts[replay_state] = count
    excluded_states = sorted(excluded_counts.keys())
    return filtered, {
        "identity": "include-replay-state-list-v0",
        "requestedReplayStateIdentities": include_replay_states,
        "includedReplayStateIdentities": [value for value in include_replay_states if value in included_counts],
        "excludedReplayStateIdentities": excluded_states,
        "availableReplayCounts": dict(sorted(available_counts.items())),
        "includedReplayCounts": dict(sorted(included_counts.items())),
        "excludedReplayCounts": dict(sorted(excluded_counts.items())),
        "usableTilePairsBeforeReplayStateFilter": len(matches),
        "usableTilePairsAfterReplayStateFilter": len(filtered),
        "limitation": "This narrows a diagnostic probe over existing field-pair payloads; it does not mutate the source corpus or claim excluded replay states are physically irrelevant.",
    }


def split_matches(matches: list[dict[str, Any]], args: argparse.Namespace) -> tuple[list[int], list[int], dict[str, Any]]:
    if len(matches) < 2:
        raise ProbeFailure("split", "at least two usable tile pairs are required for a held-out split", {"usableTilePairs": len(matches)})
    holdout_route_variants = parse_holdout_route_variant_list(args.holdout_route_variant_list)
    requested_holdout_axes = sum(
        1
        for value in [args.holdout_route_variant, args.holdout_replay_state, holdout_route_variants]
        if bool(value)
    )
    if requested_holdout_axes > 1:
        raise ProbeFailure(
            "split",
            "choose only one held-out axis per probe run",
            {
                "holdoutRouteVariant": args.holdout_route_variant,
                "holdoutRouteVariantList": holdout_route_variants,
                "holdoutReplayState": args.holdout_replay_state,
            },
        )
    if holdout_route_variants:
        holdout = set(holdout_route_variants)
        test = [index for index, match in enumerate(matches) if str(match.get("routeVariantIdentity")) in holdout]
        train = [index for index, match in enumerate(matches) if str(match.get("routeVariantIdentity")) not in holdout]
        if not train or not test:
            raise ProbeFailure(
                "split",
                "route-variant-list holdout requires at least one train and one test tile pair",
                {
                    "holdoutRouteVariantList": holdout_route_variants,
                    "usableTilePairs": len(matches),
                    "availableRouteVariants": sorted({str(match.get("routeVariantIdentity")) for match in matches}),
                    "trainTilePairs": len(train),
                    "testTilePairs": len(test),
                },
            )
        return train, test, {
            "splitStrategy": "holdout-route-variant-list-v0",
            "holdoutAxis": "routeVariantIdentity[]",
            "holdoutValue": holdout_route_variants,
            "trainFraction": None,
            "seed": None,
        }
    if args.holdout_route_variant:
        holdout = str(args.holdout_route_variant)
        test = [index for index, match in enumerate(matches) if match.get("routeVariantIdentity") == holdout]
        train = [index for index, match in enumerate(matches) if match.get("routeVariantIdentity") != holdout]
        if not train or not test:
            raise ProbeFailure(
                "split",
                "route-variant holdout requires at least one train and one test tile pair",
                {
                    "holdoutRouteVariant": holdout,
                    "usableTilePairs": len(matches),
                    "availableRouteVariants": sorted({str(match.get("routeVariantIdentity")) for match in matches}),
                    "trainTilePairs": len(train),
                    "testTilePairs": len(test),
                },
            )
        return train, test, {
            "splitStrategy": "holdout-route-variant-v0",
            "holdoutAxis": "routeVariantIdentity",
            "holdoutValue": holdout,
            "trainFraction": None,
            "seed": None,
        }
    if args.holdout_replay_state:
        holdout = str(args.holdout_replay_state)
        test = [index for index, match in enumerate(matches) if match.get("replayStateIdentity") == holdout]
        train = [index for index, match in enumerate(matches) if match.get("replayStateIdentity") != holdout]
        if not train or not test:
            raise ProbeFailure(
                "split",
                "replay-state holdout requires at least one train and one test tile pair",
                {
                    "holdoutReplayState": holdout,
                    "usableTilePairs": len(matches),
                    "availableReplayStates": sorted({str(match.get("replayStateIdentity")) for match in matches}),
                    "trainTilePairs": len(train),
                    "testTilePairs": len(test),
                },
            )
        return train, test, {
            "splitStrategy": "holdout-replay-state-v0",
            "holdoutAxis": "replayStateIdentity",
            "holdoutValue": holdout,
            "trainFraction": None,
            "seed": None,
        }
    fraction = min(0.95, max(0.05, float(args.train_fraction)))
    if args.split_strategy == REPLAY_BALANCED_TILE_PAIR_SPLIT_IDENTITY:
        rng = np.random.default_rng(args.seed)
        by_replay: dict[str, list[int]] = {}
        for index, match in enumerate(matches):
            replay_state = str(match.get("replayStateIdentity") or "unknown-replay-state")
            by_replay.setdefault(replay_state, []).append(index)
        if len(by_replay) < 2:
            raise ProbeFailure(
                "split",
                "replay-balanced split requires at least two replay states",
                {
                    "splitStrategy": REPLAY_BALANCED_TILE_PAIR_SPLIT_IDENTITY,
                    "availableReplayStates": sorted(by_replay.keys()),
                    "usableTilePairs": len(matches),
                },
            )
        available_counts = {key: len(value) for key, value in sorted(by_replay.items())}
        replay_quota = min(available_counts.values())
        if replay_quota < 2:
            raise ProbeFailure(
                "split",
                "replay-balanced split requires at least two usable tile pairs in every replay state",
                {
                    "splitStrategy": REPLAY_BALANCED_TILE_PAIR_SPLIT_IDENTITY,
                    "availableReplayCounts": available_counts,
                    "usableTilePairs": len(matches),
                },
            )
        train_per_replay = int(math.floor(replay_quota * fraction))
        train_per_replay = min(max(1, train_per_replay), replay_quota - 1)
        test_per_replay = replay_quota - train_per_replay
        train: list[int] = []
        test: list[int] = []
        selected_counts: dict[str, dict[str, int]] = {}
        for replay_state, indexes in sorted(by_replay.items()):
            selected = list(map(int, rng.permutation(indexes)[:replay_quota]))
            selected_train = sorted(selected[:train_per_replay])
            selected_test = sorted(selected[train_per_replay:])
            train.extend(selected_train)
            test.extend(selected_test)
            selected_counts[replay_state] = {
                "available": len(indexes),
                "selected": replay_quota,
                "train": len(selected_train),
                "test": len(selected_test),
            }
        return sorted(train), sorted(test), {
            "splitStrategy": REPLAY_BALANCED_TILE_PAIR_SPLIT_IDENTITY,
            "holdoutAxis": None,
            "holdoutValue": None,
            "trainFraction": fraction,
            "seed": args.seed,
            "replayBalancedPolicy": {
                "identity": "equal-tile-pair-quota-per-replay-state-v0",
                "availableReplayCounts": available_counts,
                "selectedReplayQuota": replay_quota,
                "trainPerReplay": train_per_replay,
                "testPerReplay": test_per_replay,
                "selectedReplayCounts": selected_counts,
                "limitation": "Replay states with more usable tile pairs are downsampled for balanced split diagnostics; this changes split composition, not field authority.",
            },
        }
    train_count = int(math.floor(len(matches) * fraction))
    train_count = min(max(1, train_count), len(matches) - 1)
    rng = np.random.default_rng(args.seed)
    permutation = list(map(int, rng.permutation(len(matches))))
    return sorted(permutation[:train_count]), sorted(permutation[train_count:]), {
        "splitStrategy": RANDOM_TILE_PAIR_SPLIT_IDENTITY,
        "holdoutAxis": None,
        "holdoutValue": None,
        "trainFraction": fraction,
        "seed": args.seed,
    }


def load_split(matches: list[dict[str, Any]], indexes: list[int]) -> tuple[np.ndarray, np.ndarray]:
    lows = []
    highs = []
    for index in indexes:
        match = matches[index]
        low = load_tile(Path(match["lowPath"]), match["shape"]).reshape(-1, match["shape"][-1])
        high = load_tile(Path(match["highPath"]), match["shape"]).reshape(-1, match["shape"][-1])
        lows.append(low)
        highs.append(high)
    return np.concatenate(lows, axis=0), np.concatenate(highs, axis=0)


def load_split_tiles(matches: list[dict[str, Any]], indexes: list[int]) -> tuple[list[np.ndarray], list[np.ndarray]]:
    lows = []
    highs = []
    for index in indexes:
        match = matches[index]
        lows.append(load_tile(Path(match["lowPath"]), match["shape"]))
        highs.append(load_tile(Path(match["highPath"]), match["shape"]))
    return lows, highs


def flatten_tiles(tiles: list[np.ndarray]) -> np.ndarray:
    return np.concatenate([tile.reshape(-1, tile.shape[-1]) for tile in tiles], axis=0)


def fit_affine_ridge(low: np.ndarray, high: np.ndarray, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    channels = low.shape[1]
    scales = np.zeros(channels, dtype=np.float64)
    biases = np.zeros(channels, dtype=np.float64)
    for channel in range(channels):
        x = low[:, channel].astype(np.float64)
        y = high[:, channel].astype(np.float64)
        design = np.stack([x, np.ones_like(x)], axis=1)
        normal = design.T @ design
        normal[0, 0] += max(0.0, float(ridge))
        target = design.T @ y
        try:
            coeff = np.linalg.solve(normal, target)
        except np.linalg.LinAlgError:
            coeff = np.linalg.pinv(normal) @ target
        scales[channel] = coeff[0]
        biases[channel] = coeff[1]
    return scales, biases


def predict(low: np.ndarray, scales: np.ndarray, biases: np.ndarray) -> np.ndarray:
    return low.astype(np.float64) * scales.reshape(1, -1) + biases.reshape(1, -1)


def context_window(radius: int) -> int:
    return radius * 2 + 1


def context_feature_count(channels: int, radius: int) -> int:
    window = context_window(radius)
    return int(channels * window * window * window)


def context_features_for_tile(tile: np.ndarray, radius: int) -> np.ndarray:
    if radius < 0:
        raise ProbeFailure("model-config", f"context radius must be non-negative, got {radius}")
    if tile.ndim != 4:
        raise ProbeFailure("tile-read", f"spatial-context model requires 4D tile tensors, got shape {list(tile.shape)}")
    if radius == 0:
        return tile.reshape(-1, tile.shape[-1]).astype(np.float64)
    sx, sy, sz, _channels = tile.shape
    padded = np.pad(tile, ((radius, radius), (radius, radius), (radius, radius), (0, 0)), mode="edge")
    neighborhoods = []
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                view = padded[
                    radius + dx:radius + dx + sx,
                    radius + dy:radius + dy + sy,
                    radius + dz:radius + dz + sz,
                    :,
                ]
                neighborhoods.append(view.reshape(-1, tile.shape[-1]))
    return np.concatenate(neighborhoods, axis=1).astype(np.float64)


def context_feature_matrix(tiles: list[np.ndarray], radius: int) -> np.ndarray:
    return np.concatenate([context_features_for_tile(tile, radius) for tile in tiles], axis=0)


def route_conditioning_feature_matrix(matches: list[dict[str, Any]], indexes: list[int], tiles: list[np.ndarray]) -> np.ndarray:
    if not indexes:
        return np.zeros((0, 0), dtype=np.float64)
    channel_count = len(matches[indexes[0]].get("routeConditioning", {}).get("channels", []))
    rows = []
    for match_index, tile in zip(indexes, tiles):
        sample_count = int(np.prod(tile.shape[:-1]))
        values = np.asarray(matches[match_index].get("routeConditioning", {}).get("values", []), dtype=np.float64)
        if values.size != channel_count:
            raise ProbeFailure(
                "route-conditioning",
                "route conditioning vector width changed across tile pairs",
                {
                    "matchIndex": match_index,
                    "expectedChannels": channel_count,
                    "actualChannels": int(values.size),
                },
            )
        rows.append(np.broadcast_to(values.reshape(1, -1), (sample_count, channel_count)))
    if not rows:
        return np.zeros((0, channel_count), dtype=np.float64)
    return np.concatenate(rows, axis=0)


def append_route_conditioning(features: np.ndarray, conditioning: np.ndarray) -> np.ndarray:
    if conditioning.shape[1] == 0:
        return features
    if conditioning.shape[0] != features.shape[0]:
        raise ProbeFailure(
            "route-conditioning",
            "route conditioning row count does not match spatial feature rows",
            {"featureRows": int(features.shape[0]), "conditioningRows": int(conditioning.shape[0])},
        )
    return np.concatenate([features.astype(np.float64), conditioning.astype(np.float64)], axis=1)


def fit_linear_ridge(features: np.ndarray, high: np.ndarray, ridge: float) -> tuple[np.ndarray, np.ndarray]:
    design = np.concatenate([features.astype(np.float64), np.ones((features.shape[0], 1), dtype=np.float64)], axis=1)
    normal = design.T @ design
    feature_count = features.shape[1]
    if ridge > 0:
        normal[:feature_count, :feature_count] += float(ridge) * np.eye(feature_count, dtype=np.float64)
    target = design.T @ high.astype(np.float64)
    try:
        coeff = np.linalg.solve(normal, target)
    except np.linalg.LinAlgError:
        coeff = np.linalg.pinv(normal) @ target
    return coeff[:feature_count, :], coeff[feature_count, :]


def predict_linear(features: np.ndarray, weights: np.ndarray, bias: np.ndarray) -> np.ndarray:
    return features.astype(np.float64) @ weights.astype(np.float64) + bias.reshape(1, -1)


def standardize_train_test(train: np.ndarray, test: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    mean = np.mean(train.astype(np.float64), axis=0)
    std = np.std(train.astype(np.float64), axis=0)
    std = np.where(std < 1.0e-6, 1.0, std)
    return (train - mean) / std, (test - mean) / std, mean, std


def tanh_forward(features: np.ndarray, weights1: np.ndarray, bias1: np.ndarray, weights2: np.ndarray, bias2: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hidden = np.tanh(features @ weights1 + bias1.reshape(1, -1))
    output = hidden @ weights2 + bias2.reshape(1, -1)
    return hidden, output


def train_mlp_residual_joint(
    train_features: np.ndarray,
    train_low: np.ndarray,
    train_high: np.ndarray,
    test_features: np.ndarray,
    test_low: np.ndarray,
    args: argparse.Namespace,
) -> dict[str, Any]:
    hidden_width = max(1, int(args.hidden_width))
    epochs = max(1, int(args.epochs))
    batch_size = max(1, int(args.batch_size))
    learning_rate = max(1.0e-6, float(args.learning_rate))
    l2 = max(0.0, float(args.ridge))
    seed = int(args.seed)
    train_x, test_x, feature_mean, feature_std = standardize_train_test(train_features.astype(np.float64), test_features.astype(np.float64))
    residual = train_high.astype(np.float64) - train_low.astype(np.float64)
    residual_mean = np.mean(residual, axis=0)
    residual_std = np.std(residual, axis=0)
    residual_std = np.where(residual_std < 1.0e-6, 1.0, residual_std)
    target = (residual - residual_mean.reshape(1, -1)) / residual_std.reshape(1, -1)
    rng = np.random.default_rng(seed)
    input_width = train_x.shape[1]
    output_width = train_high.shape[1]
    weights1 = rng.normal(0.0, np.sqrt(1.0 / max(1, input_width)), size=(input_width, hidden_width))
    bias1 = np.zeros(hidden_width, dtype=np.float64)
    weights2 = rng.normal(0.0, np.sqrt(1.0 / max(1, hidden_width)), size=(hidden_width, output_width))
    bias2 = np.zeros(output_width, dtype=np.float64)
    adam_state = {
        "mW1": np.zeros_like(weights1),
        "vW1": np.zeros_like(weights1),
        "mb1": np.zeros_like(bias1),
        "vb1": np.zeros_like(bias1),
        "mW2": np.zeros_like(weights2),
        "vW2": np.zeros_like(weights2),
        "mb2": np.zeros_like(bias2),
        "vb2": np.zeros_like(bias2),
    }
    beta1 = 0.9
    beta2 = 0.999
    epsilon = 1.0e-8
    first_loss = None
    final_loss = None
    step = 0
    for epoch in range(epochs):
        order = rng.permutation(train_x.shape[0])
        for start in range(0, train_x.shape[0], batch_size):
            step += 1
            batch_index = order[start:start + batch_size]
            x = train_x[batch_index]
            y = target[batch_index]
            hidden, output = tanh_forward(x, weights1, bias1, weights2, bias2)
            error = output - y
            loss = float(np.mean(error * error))
            if first_loss is None:
                first_loss = loss
            final_loss = loss
            grad_output = (2.0 / max(1, error.size)) * error
            grad_w2 = hidden.T @ grad_output + l2 * weights2
            grad_b2 = np.sum(grad_output, axis=0)
            grad_hidden = (grad_output @ weights2.T) * (1.0 - hidden * hidden)
            grad_w1 = x.T @ grad_hidden + l2 * weights1
            grad_b1 = np.sum(grad_hidden, axis=0)
            gradients = {
                "W1": grad_w1,
                "b1": grad_b1,
                "W2": grad_w2,
                "b2": grad_b2,
            }
            params = {
                "W1": weights1,
                "b1": bias1,
                "W2": weights2,
                "b2": bias2,
            }
            for name, grad in gradients.items():
                adam_state[f"m{name}"] = beta1 * adam_state[f"m{name}"] + (1.0 - beta1) * grad
                adam_state[f"v{name}"] = beta2 * adam_state[f"v{name}"] + (1.0 - beta2) * (grad * grad)
                m_hat = adam_state[f"m{name}"] / (1.0 - beta1 ** step)
                v_hat = adam_state[f"v{name}"] / (1.0 - beta2 ** step)
                params[name] -= learning_rate * m_hat / (np.sqrt(v_hat) + epsilon)
    train_hidden, train_output = tanh_forward(train_x, weights1, bias1, weights2, bias2)
    _test_hidden, test_output = tanh_forward(test_x, weights1, bias1, weights2, bias2)
    train_residual_prediction = train_output * residual_std.reshape(1, -1) + residual_mean.reshape(1, -1)
    test_residual_prediction = test_output * residual_std.reshape(1, -1) + residual_mean.reshape(1, -1)
    return {
        "trainPrediction": train_low.astype(np.float64) + train_residual_prediction,
        "testPrediction": test_low.astype(np.float64) + test_residual_prediction,
        "payload": {
            "identity": SPATIAL_CONTEXT_MLP_MODEL_IDENTITY,
            "backend": BACKEND,
            "optimizer": "adam-full-local-minibatch-v0",
            "activation": "tanh",
            "residualTarget": "high-minus-low-center-voxel",
            "hiddenWidth": hidden_width,
            "epochs": epochs,
            "batchSize": batch_size,
            "learningRate": learning_rate,
            "l2": l2,
            "firstBatchLoss": first_loss,
            "finalBatchLoss": final_loss,
            "trainableParameters": int(weights1.size + bias1.size + weights2.size + bias2.size),
            "featureMean": feature_mean,
            "featureStd": feature_std,
            "residualMean": residual_mean,
            "residualStd": residual_std,
            "weights1Shape": list(weights1.shape),
            "bias1Shape": list(bias1.shape),
            "weights2Shape": list(weights2.shape),
            "bias2Shape": list(bias2.shape),
            "weights1": weights1,
            "bias1": bias1,
            "weights2": weights2,
            "bias2": bias2,
        },
    }


def train_mlp_residual(
    train_features: np.ndarray,
    train_low: np.ndarray,
    train_high: np.ndarray,
    test_features: np.ndarray,
    test_low: np.ndarray,
    args: argparse.Namespace,
    target_channels: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not bool(getattr(args, "independent_target_heads", False)):
        result = train_mlp_residual_joint(train_features, train_low, train_high, test_features, test_low, args)
        result["payload"]["independentTargetHeads"] = {"enabled": False}
        return result
    if train_high.shape[1] <= 1:
        result = train_mlp_residual_joint(train_features, train_low, train_high, test_features, test_low, args)
        result["payload"]["independentTargetHeads"] = {
            "enabled": True,
            "effective": False,
            "reason": "single-target-channel",
        }
        return result

    train_predictions = []
    test_predictions = []
    heads = []
    target_names = []
    if target_channels is not None:
        target_names = [str(name) for name in target_channels.get("targetChannels", [])]
    for channel_index in range(train_high.shape[1]):
        head = train_mlp_residual_joint(
            train_features,
            train_low[:, channel_index:channel_index + 1],
            train_high[:, channel_index:channel_index + 1],
            test_features,
            test_low[:, channel_index:channel_index + 1],
            args,
        )
        train_predictions.append(head["trainPrediction"])
        test_predictions.append(head["testPrediction"])
        payload = head["payload"]
        heads.append({
            "channelIndex": channel_index,
            "channel": target_names[channel_index] if channel_index < len(target_names) else str(channel_index),
            "hiddenWidth": payload.get("hiddenWidth"),
            "epochs": payload.get("epochs"),
            "batchSize": payload.get("batchSize"),
            "learningRate": payload.get("learningRate"),
            "l2": payload.get("l2"),
            "firstBatchLoss": payload.get("firstBatchLoss"),
            "finalBatchLoss": payload.get("finalBatchLoss"),
            "trainableParameters": payload.get("trainableParameters"),
            "featureMean": payload.get("featureMean"),
            "featureStd": payload.get("featureStd"),
            "residualMean": payload.get("residualMean"),
            "residualStd": payload.get("residualStd"),
            "weights1Shape": payload.get("weights1Shape"),
            "bias1Shape": payload.get("bias1Shape"),
            "weights2Shape": payload.get("weights2Shape"),
            "bias2Shape": payload.get("bias2Shape"),
            "weights1": payload.get("weights1"),
            "bias1": payload.get("bias1"),
            "weights2": payload.get("weights2"),
            "bias2": payload.get("bias2"),
        })

    return {
        "trainPrediction": np.concatenate(train_predictions, axis=1),
        "testPrediction": np.concatenate(test_predictions, axis=1),
        "payload": {
            "identity": SPATIAL_CONTEXT_MLP_MODEL_IDENTITY,
            "backend": BACKEND,
            "optimizer": "adam-independent-local-minibatch-v0",
            "activation": "tanh",
            "residualTarget": "high-minus-low-center-voxel",
            "hiddenWidth": max(1, int(args.hidden_width)),
            "epochs": max(1, int(args.epochs)),
            "batchSize": max(1, int(args.batch_size)),
            "learningRate": max(1.0e-6, float(args.learning_rate)),
            "l2": max(0.0, float(args.ridge)),
            "trainableParameters": int(sum(int(head["trainableParameters"]) for head in heads)),
            "weights1Shape": [head["weights1Shape"] for head in heads],
            "bias1Shape": [head["bias1Shape"] for head in heads],
            "weights2Shape": [head["weights2Shape"] for head in heads],
            "bias2Shape": [head["bias2Shape"] for head in heads],
            "independentTargetHeads": {
                "enabled": True,
                "effective": True,
                "identity": "independent-target-channel-mlp-heads-v0",
                "headCount": len(heads),
                "heads": heads,
                "limitation": "Diagnostic target-decomposition mode; it tests multi-target interference but does not change field authority or product integration status.",
            },
        },
    }


def metrics(prediction: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    error = prediction.astype(np.float64) - target.astype(np.float64)
    squared = error * error
    absolute = np.abs(error)
    return {
        "mse": float(np.mean(squared)),
        "mae": float(np.mean(absolute)),
        "rmse": float(np.sqrt(np.mean(squared))),
        "perChannelMse": np.mean(squared, axis=0),
        "perChannelMae": np.mean(absolute, axis=0),
    }


def improvement_vs_identity(model_metrics: dict[str, Any], identity_metrics: dict[str, Any]) -> float | None:
    identity_mse = float(identity_metrics["mse"])
    if identity_mse <= 0:
        return None
    return float((identity_mse - float(model_metrics["mse"])) / identity_mse)


def split_report(
    name: str,
    low: np.ndarray,
    high: np.ndarray,
    model_prediction: np.ndarray,
    mean_high: np.ndarray,
    mean_residual: np.ndarray,
    comparisons: dict[str, np.ndarray] | None = None,
) -> dict[str, Any]:
    identity = metrics(low, high)
    mean_high_prediction = np.broadcast_to(mean_high.reshape(1, -1), high.shape)
    mean_residual_prediction = low.astype(np.float64) + mean_residual.reshape(1, -1)
    model_metrics = metrics(model_prediction, high)
    mean_residual_metrics = metrics(mean_residual_prediction, high)
    report = {
        "split": name,
        "samples": int(low.shape[0]),
        "channels": int(low.shape[1]),
        "identityBaseline": identity,
        "meanHighBaseline": metrics(mean_high_prediction, high),
        "meanResidualBaseline": mean_residual_metrics,
        "model": model_metrics,
        "improvementVsIdentity": improvement_vs_identity(model_metrics, identity),
        "meanResidualImprovementVsIdentity": improvement_vs_identity(mean_residual_metrics, identity),
    }
    for comparison_name, comparison_prediction in (comparisons or {}).items():
        comparison_metrics = metrics(comparison_prediction, high)
        comparison_mse = float(comparison_metrics["mse"])
        model_mse = float(model_metrics["mse"])
        report[comparison_name] = {
            "baseline": comparison_metrics,
            "modelMseDelta": model_mse - comparison_mse,
            "improvement": None if comparison_mse <= 0 else float((comparison_mse - model_mse) / comparison_mse),
        }
        if comparison_name == "affineComparison":
            report[comparison_name]["affineBaseline"] = comparison_metrics
            report[comparison_name]["modelMseDeltaVsAffine"] = model_mse - comparison_mse
            report[comparison_name]["improvementVsAffine"] = report[comparison_name]["improvement"]
        if comparison_name == "linearContextComparison":
            report[comparison_name]["linearContextBaseline"] = comparison_metrics
            report[comparison_name]["modelMseDeltaVsLinearContext"] = model_mse - comparison_mse
            report[comparison_name]["improvementVsLinearContext"] = report[comparison_name]["improvement"]
    return report


def summarize_matches(matches: list[dict[str, Any]], indexes: list[int]) -> list[dict[str, Any]]:
    return [
        {
            "pairId": matches[index]["pairId"],
            "routeVariantIdentity": matches[index].get("routeVariantIdentity"),
            "replayStateIdentity": matches[index].get("replayStateIdentity"),
            "routeConditioningValues": matches[index].get("routeConditioning", {}).get("values", []),
            "matchId": matches[index]["matchId"],
            "lowTileId": matches[index]["lowTileId"],
            "highTileId": matches[index]["highTileId"],
            "sameSpatialBin": matches[index]["sameSpatialBin"],
            "lowSpatialBinId": matches[index]["lowSpatialBinId"],
            "highSpatialBinId": matches[index]["highSpatialBinId"],
            "normalizedTileDistance": matches[index]["normalizedTileDistance"],
            "normalizedTileSeparation": matches[index]["normalizedTileSeparation"],
        }
        for index in indexes
    ]


def safe_slug(value: Any) -> str:
    chars = []
    for char in str(value):
        chars.append(char if char.isalnum() or char in ("-", "_") else "-")
    slug = "".join(chars).strip("-")
    return slug or "unknown"


def artifact_tile_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    error = prediction.astype(np.float64) - truth.astype(np.float64)
    absolute = np.abs(error)
    return {
        "mse": float(np.mean(error ** 2)),
        "mae": float(np.mean(absolute)),
        "maxAbsError": float(np.max(absolute)),
    }


def write_residual_application_artifact(
    args: argparse.Namespace,
    manifest_path: Path,
    dataset: dict[str, Any],
    report: dict[str, Any],
    matches: list[dict[str, Any]],
    test_indexes: list[int],
    test_low_tiles: list[np.ndarray],
    test_high_tiles: list[np.ndarray],
    model_prediction_test: np.ndarray,
    target_indexes: list[int],
    target_channels: dict[str, Any],
) -> dict[str, Any] | None:
    if not args.artifact_dir:
        return None
    artifact_dir = Path(args.artifact_dir).resolve()
    tile_dir = artifact_dir / "tiles"
    target_channel_count = int(target_channels["targetChannelCount"])
    if target_channel_count <= 0:
        raise ProbeFailure("artifact-write", "artifact target channel count must be positive", {"targetChannels": target_channels})

    offset = 0
    tiles: list[dict[str, Any]] = []
    for order, match_index in enumerate(test_indexes):
        match = matches[match_index]
        low_tile = test_low_tiles[order]
        high_tile = test_high_tiles[order]
        spatial_shape = [int(value) for value in low_tile.shape[:-1]]
        voxel_count = product(spatial_shape)
        target_shape = [*spatial_shape, target_channel_count]
        low_target = select_channels(low_tile.reshape(-1, low_tile.shape[-1]), target_indexes).reshape(target_shape)
        truth_target = select_channels(high_tile.reshape(-1, high_tile.shape[-1]), target_indexes).reshape(target_shape)
        prediction_target = model_prediction_test[offset:offset + voxel_count].reshape(target_shape)
        offset += voxel_count
        residual_target = prediction_target - low_target
        error_target = prediction_target - truth_target
        stem = f"{order + 1:04d}-{safe_slug(match.get('pairId'))}-{safe_slug(match.get('matchId'))}"
        tiles.append({
            "order": order,
            "pairId": match.get("pairId"),
            "matchId": match.get("matchId"),
            "routeVariantIdentity": match.get("routeVariantIdentity"),
            "replayStateIdentity": match.get("replayStateIdentity"),
            "shape": target_shape,
            "targetChannels": target_channels["targetChannels"],
            "sourceLowPath": match.get("lowPath"),
            "sourceHighPath": match.get("highPath"),
            "lowTarget": write_float32_payload(tile_dir / f"{stem}-low-target.f32", low_target),
            "predictedHighTarget": write_float32_payload(tile_dir / f"{stem}-predicted-high-target.f32", prediction_target),
            "residualTarget": write_float32_payload(tile_dir / f"{stem}-residual-target.f32", residual_target),
            "truthHighTarget": write_float32_payload(tile_dir / f"{stem}-truth-high-target.f32", truth_target),
            "errorTarget": write_float32_payload(tile_dir / f"{stem}-error-target.f32", error_target),
            "metrics": artifact_tile_metrics(prediction_target, truth_target),
        })

    if offset != int(model_prediction_test.shape[0]):
        raise ProbeFailure(
            "artifact-write",
            "artifact prediction/test tile sample counts diverged",
            {"predictionSamples": int(model_prediction_test.shape[0]), "writtenSamples": offset},
        )

    manifest = {
        "schema": RESIDUAL_APPLICATION_ARTIFACT_SCHEMA,
        "identity": RESIDUAL_APPLICATION_ARTIFACT_IDENTITY,
        "status": "written",
        "createdAt": utc_now(),
        "artifactAuthority": "offline-residual-application-on-heldout-field-tiles-not-renderer-integration",
        "sourceManifest": str(manifest_path),
        "sourceDataset": {
            "schema": dataset.get("schema"),
            "status": dataset.get("status"),
            "gitCommit": dataset.get("gitCommit"),
            "pairAuthority": dataset.get("pairAuthority"),
            "fieldAuthority": dataset.get("fieldAuthority"),
            "fieldTileExport": dataset.get("fieldTileExport"),
        },
        "probeReport": str(Path(args.out).resolve()),
        "model": {
            "identity": report.get("identity"),
            "backend": report.get("backend"),
            "targetChannels": target_channels,
        },
        "split": {
            "splitStrategy": report.get("data", {}).get("splitStrategy"),
            "holdoutAxis": report.get("data", {}).get("holdoutAxis"),
            "holdoutValue": report.get("data", {}).get("holdoutValue"),
            "replayStateFilter": report.get("data", {}).get("replayStateFilter"),
        },
        "metrics": {
            "test": report.get("metrics", {}).get("test"),
        },
        "tileCount": len(tiles),
        "sampleCount": int(model_prediction_test.shape[0]),
        "tiles": tiles,
        "limitation": "Offline field-target application artifact only; does not mutate simulator state, rendering, or product paths.",
    }
    artifact_manifest_path = artifact_dir / "manifest.json"
    write_json(artifact_manifest_path, manifest)
    return {
        "schema": RESIDUAL_APPLICATION_ARTIFACT_SCHEMA,
        "identity": RESIDUAL_APPLICATION_ARTIFACT_IDENTITY,
        "status": "written",
        "artifactDir": str(artifact_dir),
        "manifestPath": str(artifact_manifest_path),
        "manifestSha256": sha256_file(artifact_manifest_path),
        "artifactAuthority": manifest["artifactAuthority"],
        "tileCount": len(tiles),
        "sampleCount": int(model_prediction_test.shape[0]),
        "targetChannels": target_channels["targetChannels"],
        "limitation": manifest["limitation"],
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = Path(args.manifest).resolve()
    dataset = read_manifest(manifest_path)
    if dataset.get("status") != "captured":
        raise ProbeFailure("manifest-validate", "source dataset is not captured", {"status": dataset.get("status")})
    usable_matches, discarded_matches = candidate_matches(dataset, manifest_path, args)
    usable_matches_before_replay_state_filter = len(usable_matches)
    usable_matches, replay_state_filter = filter_matches_by_replay_state(usable_matches, args)
    train_indexes, test_indexes, split_strategy = split_matches(usable_matches, args)
    train_low_tiles, train_high_tiles = load_split_tiles(usable_matches, train_indexes)
    test_low_tiles, test_high_tiles = load_split_tiles(usable_matches, test_indexes)
    train_low = flatten_tiles(train_low_tiles)
    train_high = flatten_tiles(train_high_tiles)
    test_low = flatten_tiles(test_low_tiles)
    test_high = flatten_tiles(test_high_tiles)
    if train_low.shape[1] != test_low.shape[1]:
        raise ProbeFailure("tile-read", "train/test channel counts differ", {"trainChannels": train_low.shape[1], "testChannels": test_low.shape[1]})
    channel_names = infer_field_tile_channels(dataset, train_low.shape[1])
    target_channels = resolve_target_channels(args, channel_names)
    target_indexes = [int(index) for index in target_channels["targetChannelIndexes"]]
    train_low_target = select_channels(train_low, target_indexes)
    train_high_target = select_channels(train_high, target_indexes)
    test_low_target = select_channels(test_low, target_indexes)
    test_high_target = select_channels(test_high, target_indexes)
    affine_scales, affine_biases = fit_affine_ridge(train_low_target, train_high_target, args.ridge)
    train_affine_prediction = predict(train_low_target, affine_scales, affine_biases)
    test_affine_prediction = predict(test_low_target, affine_scales, affine_biases)
    mean_high = np.mean(train_high_target.astype(np.float64), axis=0)
    mean_residual = np.mean(train_high_target.astype(np.float64) - train_low_target.astype(np.float64), axis=0)
    model = model_identity(args)
    context_radius_value = max(0, int(args.context_radius))
    context = None
    train_linear_context_prediction = None
    test_linear_context_prediction = None
    if model == AFFINE_MODEL_IDENTITY:
        model_prediction_train = train_affine_prediction
        model_prediction_test = test_affine_prediction
        model_payload = {
            "identity": model,
            "backend": BACKEND,
            "ridge": args.ridge,
            "trainableParameters": int(train_low_target.shape[1] * 2),
            "targetChannels": target_channels,
            "scale": affine_scales,
            "bias": affine_biases,
            "meanHigh": mean_high,
            "meanResidual": mean_residual,
        }
    elif model in (SPATIAL_CONTEXT_MODEL_IDENTITY, SPATIAL_CONTEXT_MLP_MODEL_IDENTITY):
        train_local_features = context_feature_matrix(train_low_tiles, context_radius_value)
        test_local_features = context_feature_matrix(test_low_tiles, context_radius_value)
        train_route_conditioning = route_conditioning_feature_matrix(usable_matches, train_indexes, train_low_tiles)
        test_route_conditioning = route_conditioning_feature_matrix(usable_matches, test_indexes, test_low_tiles)
        train_features = append_route_conditioning(train_local_features, train_route_conditioning)
        test_features = append_route_conditioning(test_local_features, test_route_conditioning)
        weights, bias = fit_linear_ridge(train_features, train_high_target, args.ridge)
        train_linear_context_prediction = predict_linear(train_features, weights, bias)
        test_linear_context_prediction = predict_linear(test_features, weights, bias)
        context = {
            "contextRadius": context_radius_value,
            "contextWindow": [context_window(context_radius_value)] * 3,
            "contextFeatureCount": context_feature_count(train_low.shape[1], context_radius_value),
            "localContextFeatureCount": int(train_local_features.shape[1]),
            "conditionedFeatureCount": int(train_features.shape[1]),
            "routeConditioning": {
                "identity": args.route_conditioning,
                "routeConditioningChannels": route_conditioning_channels(args.route_conditioning),
                "routeConditioningFeatureCount": int(train_route_conditioning.shape[1]),
                "source": "effective witness controls with query fallback; replay scalars included only for route-controls-replay-v0",
            },
            "contextFeatureOrder": "dx-major,dy,dz over edge-padded low tile, channels preserved per offset",
        }
        if model == SPATIAL_CONTEXT_MODEL_IDENTITY:
            model_prediction_train = train_linear_context_prediction
            model_prediction_test = test_linear_context_prediction
            model_payload = {
                "identity": model,
                "backend": BACKEND,
                "ridge": args.ridge,
                "trainableParameters": int(weights.size + bias.size),
                "context": context,
                "targetChannels": target_channels,
                "weightsShape": list(weights.shape),
                "biasShape": list(bias.shape),
                "weights": weights,
                "bias": bias,
                "affineBaseline": {
                    "identity": AFFINE_MODEL_IDENTITY,
                    "scale": affine_scales,
                    "bias": affine_biases,
                },
                "meanHigh": mean_high,
                "meanResidual": mean_residual,
            }
        else:
            mlp = train_mlp_residual(train_features, train_low_target, train_high_target, test_features, test_low_target, args, target_channels)
            model_prediction_train = mlp["trainPrediction"]
            model_prediction_test = mlp["testPrediction"]
            model_payload = mlp["payload"]
            model_payload.update({
                "context": context,
                "targetChannels": target_channels,
                "linearContextBaseline": {
                    "identity": SPATIAL_CONTEXT_MODEL_IDENTITY,
                    "ridge": args.ridge,
                    "weightsShape": list(weights.shape),
                    "biasShape": list(bias.shape),
                },
                "affineBaseline": {
                    "identity": AFFINE_MODEL_IDENTITY,
                    "scale": affine_scales,
                    "bias": affine_biases,
                },
                "meanHigh": mean_high,
                "meanResidual": mean_residual,
            })
    else:
        raise ProbeFailure("model-config", f"unsupported model identity: {model}", {"model": model})
    report = base_report(args)
    train_tile_pairs = summarize_matches(usable_matches, train_indexes)
    test_tile_pairs = summarize_matches(usable_matches, test_indexes)
    report.update({
        "status": "completed",
        "updatedAt": utc_now(),
        "sourceDataset": {
            "schema": dataset.get("schema"),
            "status": dataset.get("status"),
            "manifestPath": dataset.get("manifestPath"),
            "gitCommit": dataset.get("gitCommit"),
            "gitBranch": dataset.get("gitBranch"),
            "pairAuthority": dataset.get("pairAuthority"),
            "fieldAuthority": dataset.get("fieldAuthority"),
            "deterministicReplay": dataset.get("deterministicReplay"),
            "deterministicReplayStates": dataset.get("deterministicReplayStates"),
            "routeVariants": dataset.get("routeVariants"),
            "fieldTileExport": dataset.get("fieldTileExport"),
            "coverageExpansion": dataset.get("coverageExpansion"),
            "baseUrl": dataset.get("baseUrl"),
        },
        "data": {
            **split_strategy,
            "replayStateFilter": replay_state_filter,
            "candidateMatchedTilePairs": usable_matches_before_replay_state_filter + len(discarded_matches),
            "usableTilePairsBeforeReplayStateFilter": usable_matches_before_replay_state_filter,
            "usableTilePairs": len(usable_matches),
            "discardedTilePairs": len(discarded_matches),
            "discarded": discarded_matches,
            "tileShape": usable_matches[0]["shape"] if usable_matches else None,
            "channels": int(train_low.shape[1]),
            "inputChannels": channel_names,
            "inputChannelCount": int(train_low.shape[1]),
            "targetChannels": target_channels["targetChannels"],
            "targetChannelIndexes": target_channels["targetChannelIndexes"],
            "targetChannelCount": target_channels["targetChannelCount"],
            "trainTilePairCount": len(train_indexes),
            "testTilePairCount": len(test_indexes),
            "trainSamples": int(train_low.shape[0]),
            "testSamples": int(test_low.shape[0]),
            "trainTilePairs": train_tile_pairs,
            "testTilePairs": test_tile_pairs,
        },
        "model": model_payload,
        "metrics": {
            "train": split_report(
                "train",
                train_low_target,
                train_high_target,
                model_prediction_train,
                mean_high,
                mean_residual,
                comparisons={
                    key: value for key, value in {
                        "affineComparison": None if model == AFFINE_MODEL_IDENTITY else train_affine_prediction,
                        "linearContextComparison": train_linear_context_prediction if model == SPATIAL_CONTEXT_MLP_MODEL_IDENTITY else None,
                    }.items() if value is not None
                },
            ),
            "test": split_report(
                "test",
                test_low_target,
                test_high_target,
                model_prediction_test,
                mean_high,
                mean_residual,
                comparisons={
                    key: value for key, value in {
                        "affineComparison": None if model == AFFINE_MODEL_IDENTITY else test_affine_prediction,
                        "linearContextComparison": test_linear_context_prediction if model == SPATIAL_CONTEXT_MLP_MODEL_IDENTITY else None,
                    }.items() if value is not None
                },
            ),
        },
    })
    if context is not None:
        report["data"]["contextWindow"] = context["contextWindow"]
        report["data"]["contextFeatureCount"] = context["contextFeatureCount"]
        report["data"]["conditionedFeatureCount"] = context["conditionedFeatureCount"]
        report["data"]["routeConditioning"] = context["routeConditioning"]
    residual_application_artifact = write_residual_application_artifact(
        args,
        manifest_path,
        dataset,
        report,
        usable_matches,
        test_indexes,
        test_low_tiles,
        test_high_tiles,
        model_prediction_test,
        target_indexes,
        target_channels,
    )
    if residual_application_artifact is not None:
        report["residualApplicationArtifact"] = residual_application_artifact
    return report


def main() -> int:
    args = parse_args()
    try:
        report = run(args)
        write_json(Path(args.out), report)
        return 0
    except ProbeFailure as exc:
        return fail_report(args, exc.phase, str(exc), exc.evidence)
    except Exception as exc:  # Keep unexpected crashes durable for agent recovery.
        return fail_report(args, "unexpected", f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
