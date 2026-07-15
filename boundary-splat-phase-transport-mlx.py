#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np


SCHEMA = "kaminos-boundary-splat-phase-transport-training-v0"
MODEL_SCHEMA = "kaminos-boundary-splat-phase-transport-model-v0"
DESTINATION_STATE_MODEL_SCHEMA = "kaminos-boundary-splat-phase-destination-state-model-v0"
PREDICTION_SCHEMA = "kaminos-boundary-splat-phase-transport-predictions-v0"
INPUT_AUTHORITY = "exact-16-feature-plus-directional-local-grid-occupancy-v0"
DESTINATION_STATE_INPUT_AUTHORITY = "exact-destination-local-grid-plus-selected-donor-state-and-displacement-v0"
DESTINATION_STATE_OUTPUT_AUTHORITY = "candidate-16-plus-nonposition-splat-9-donor-residual-v0"
DESTINATION_STATE_ARCHITECTURE_AUTHORITY = "offline-two-layer-relu-destination-state-residual-head-v0"
CORRESPONDENCE_AUTHORITY = "stable-site-first-bounded-local-grid-feature-correspondence-v0"
ARCHITECTURE_AUTHORITY = "shared-two-layer-relu-carrier-displacement-and-residual-birth-heads-v0"
LEGACY_OBJECTIVE_FAMILY = "population-weighted-carrier-and-residual-birth-v0"
MOTION_BALANCED_OBJECTIVE_FAMILY = "motion-balanced-static-scaffold-v0"
EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY = "motion-balanced-eulerian-destination-occupancy-v0"
STATE_RECURRENCE_MODES = ("coupled", "protected-splat")
SUPPORT_BUDGET_MODES = ("one-step-ratio", "training-episode-envelope")
FEATURES = (
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
)
DISPLACEMENTS = tuple(
    (dx, dy, dz)
    for dx in (-1, 0, 1)
    for dy in (-1, 0, 1)
    for dz in (-1, 0, 1)
)
DEATH_CLASS = len(DISPLACEMENTS)
CARRIER_COHORTS = ("stable-q1", "stable-q2", "stable-q3", "stable-q4", "transported", "death")
EULERIAN_DESTINATION_COHORTS = (
    "stable-q1", "stable-q2", "stable-q3", "stable-q4",
    "transported", "birth", "death", "empty",
)
DESTINATION_STATE_COHORTS = ("stable-q3", "stable-q4", "transported", "birth")
SUPPORTED_DESTINATION_STATE_COHORTS = (
    "stable-q1", "stable-q2", "stable-q3", "stable-q4", "transported", "birth",
)
DESTINATION_STATE_ATTRIBUTE_COUNT = len(FEATURES) + 9
DESTINATION_STATE_INPUT_COUNT = 64 + DESTINATION_STATE_ATTRIBUTE_COUNT + len(DISPLACEMENTS)
POSITION_PRECISION = 6
DENSE_GRID_MAX_CELLS_PER_SOURCE = 256
DENSE_GRID_MIN_CELL_BUDGET = 4096


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def load_training_support_envelope(identity):
    if (
        not isinstance(identity, dict)
        or not isinstance(identity.get("path"), str)
        or not identity["path"]
        or not isinstance(identity.get("bytes"), int)
        or identity["bytes"] <= 0
        or not isinstance(identity.get("sha256"), str)
        or len(identity["sha256"]) != 64
    ):
        raise ValueError("frozen model training manifest identity is missing or malformed")
    path = Path(identity["path"]).resolve()
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ValueError("frozen model training manifest identity cannot be read") from error
    if len(data) != identity["bytes"] or sha256_bytes(data) != identity["sha256"]:
        raise ValueError("frozen model training manifest identity byte/hash mismatch")
    document = json.loads(data)
    if (
        document.get("schema") != "kaminos-boundary-splat-phase-candidate-corpus-v0"
        or document.get("featureOrder") != list(FEATURES)
        or document.get("effectiveRoute") != "native-3d-compute-fluid-raymarch-v0"
    ):
        raise ValueError("frozen model training manifest corpus contract mismatch")
    frames = sorted(document.get("frames", []), key=lambda frame: int(frame.get("controlledStepFrameIndex", -1)))
    indices = [int(frame.get("controlledStepFrameIndex", -1)) for frame in frames]
    counts = [frame.get("splats", {}).get("count") for frame in frames]
    if (
        len(frames) < 2
        or indices != list(range(len(frames)))
        or any(not isinstance(count, int) or count <= 0 for count in counts)
    ):
        raise ValueError("frozen model training manifest support sequence mismatch")
    frame_zero_count = counts[0]
    minimum_count = min(counts)
    maximum_count = max(counts)
    return {
        "authority": "frozen-model-training-episode-frame-zero-relative-support-envelope-v0",
        "trainingManifest": dict(identity),
        "frameCount": len(counts),
        "frameZeroCount": frame_zero_count,
        "minimumCount": minimum_count,
        "maximumCount": maximum_count,
        "minimumRatio": minimum_count / frame_zero_count,
        "maximumRatio": maximum_count / frame_zero_count,
    }


def resolve_recurrent_support_budget(
    mode,
    inference_initial_count,
    current_count,
    one_step_ratio,
    envelope=None,
    training_manifest_sha256=None,
    inference_frame_zero=None,
):
    if mode not in SUPPORT_BUDGET_MODES:
        raise ValueError("recurrent support budget mode is unsupported")
    if (
        not isinstance(inference_initial_count, int)
        or inference_initial_count <= 0
        or not isinstance(current_count, int)
        or current_count <= 0
        or not math.isfinite(one_step_ratio)
        or one_step_ratio <= 0
    ):
        raise ValueError("recurrent support budget inputs are invalid")
    if (
        not isinstance(training_manifest_sha256, str)
        or len(training_manifest_sha256) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in training_manifest_sha256)
        or not isinstance(inference_frame_zero, dict)
        or not isinstance(inference_frame_zero.get("referenceFrameId"), str)
        or not inference_frame_zero["referenceFrameId"]
        or inference_frame_zero.get("count") != inference_initial_count
    ):
        raise ValueError("recurrent support budget training manifest identity or inference frame-zero anchor is invalid")
    requested_budget = max(1, round(current_count * one_step_ratio))
    minimum_budget = None
    maximum_budget = None
    effective_budget = requested_budget
    envelope_authority = None
    if mode == "training-episode-envelope":
        if (
            not isinstance(envelope, dict)
            or envelope.get("authority") != "frozen-model-training-episode-frame-zero-relative-support-envelope-v0"
            or not math.isfinite(envelope.get("minimumRatio", math.nan))
            or not math.isfinite(envelope.get("maximumRatio", math.nan))
            or envelope["minimumRatio"] <= 0
            or envelope["maximumRatio"] < envelope["minimumRatio"]
            or not isinstance(envelope.get("trainingManifest"), dict)
            or not isinstance(envelope["trainingManifest"].get("sha256"), str)
        ):
            raise ValueError("recurrent training support envelope is missing or malformed")
        if envelope["trainingManifest"]["sha256"] != training_manifest_sha256:
            raise ValueError("recurrent support budget training manifest identity mismatch")
        minimum_budget = max(1, round(inference_initial_count * envelope["minimumRatio"]))
        maximum_budget = max(minimum_budget, round(inference_initial_count * envelope["maximumRatio"]))
        effective_budget = max(minimum_budget, min(maximum_budget, requested_budget))
        envelope_authority = envelope["authority"]
        training_manifest_sha256 = envelope["trainingManifest"]["sha256"]
    return {
        "authority": "explicit-recurrent-support-budget-mode-v0",
        "mode": mode,
        "inferenceInitialCount": inference_initial_count,
        "currentCount": current_count,
        "oneStepRatio": float(one_step_ratio),
        "requestedBudget": requested_budget,
        "minimumBudget": minimum_budget,
        "maximumBudget": maximum_budget,
        "effectiveBudget": effective_budget,
        "clamped": effective_budget != requested_budget,
        "envelopeAuthority": envelope_authority,
        "trainingManifestSha256": training_manifest_sha256,
        "inferenceFrameZero": dict(inference_frame_zero),
    }


def stable_key(position):
    return tuple(round(float(value), POSITION_PRECISION) for value in position)


def offset_key(key, offset, grid_step):
    return tuple(round(key[axis] + offset[axis] * grid_step, POSITION_PRECISION) for axis in range(3))


def displacement_class(delta):
    try:
        return DISPLACEMENTS.index(tuple(int(value) for value in delta))
    except ValueError as error:
        raise ValueError(f"displacement {delta} is outside the one-cell class universe") from error


def index_frame(candidates, splats):
    candidates = np.asarray(candidates, dtype=np.float32)
    splats = np.asarray(splats, dtype=np.float32)
    if candidates.ndim != 2 or candidates.shape[1] != 16:
        raise ValueError("candidate rows must preserve the exact 16-feature contract")
    if splats.ndim != 2 or splats.shape[1] != 12 or len(splats) != len(candidates):
        raise ValueError("splat rows must contain 12 floats and align one-to-one with candidates")
    if not np.all(np.isfinite(candidates)) or not np.all(np.isfinite(splats)):
        raise ValueError("candidate and splat rows must be finite")
    keys = [stable_key(row[:3]) for row in splats]
    if len(set(keys)) != len(keys):
        raise ValueError("frame contains duplicate world-position keys")
    return {
        "candidates": candidates,
        "splats": splats,
        "keys": keys,
        "index": {key: index for index, key in enumerate(keys)},
    }


def load_frame(frame_doc, base_dir):
    loaded = {}
    for name, stride in (("candidates", 16), ("splats", 12)):
        artifact = frame_doc.get(name, {})
        if artifact.get("strideFloats") != stride or artifact.get("dtype") != "float32-le":
            raise ValueError(f"{frame_doc.get('id')} {name} contract mismatch")
        path = Path(artifact.get("path", ""))
        path = path.resolve() if path.is_absolute() else (base_dir / path).resolve()
        data = path.read_bytes()
        if len(data) != int(artifact.get("bytes", -1)) or sha256_bytes(data) != artifact.get("sha256"):
            raise ValueError(f"{frame_doc.get('id')} {name} byte/hash mismatch")
        values = np.frombuffer(data, dtype="<f4")
        if values.size != int(artifact.get("count", 0)) * stride:
            raise ValueError(f"{frame_doc.get('id')} {name} count mismatch")
        loaded[name] = values.reshape(-1, stride).copy()
    return index_frame(loaded["candidates"], loaded["splats"])


def make_directional_input(key, source, grid_step):
    key = stable_key(key)
    result = np.zeros(64, dtype=np.float32)
    result[0] = 1.0
    result[1:4] = key
    direct_index = source["index"].get(key)
    result[4] = 1.0 if direct_index is not None else 0.0
    if direct_index is not None:
        result[5:21] = source["candidates"][direct_index]
    neighbor_features = []
    for class_index, delta in enumerate(DISPLACEMENTS):
        neighbor_index = source["index"].get(offset_key(key, delta, grid_step))
        if neighbor_index is None:
            continue
        result[21 + class_index] = 1.0
        neighbor_features.append(source["candidates"][neighbor_index])
    if neighbor_features:
        result[48:64] = np.mean(np.stack(neighbor_features), axis=0)
    return result


def grid_coordinates(keys, grid_step, origin=None):
    if not math.isfinite(grid_step) or grid_step <= 0:
        raise ValueError("grid step must be finite and positive")
    positions = np.asarray(keys, dtype=np.float64).reshape(-1, 3)
    if origin is None:
        if not len(positions):
            origin = np.zeros(3, dtype=np.float64)
        else:
            origin = np.mod(positions[0], grid_step)
    origin = np.asarray(origin, dtype=np.float64).reshape(3)
    coordinates = np.rint((positions - origin) / grid_step).astype(np.int64)
    reconstructed = origin + coordinates.astype(np.float64) * grid_step
    tolerance = max(10 ** (-POSITION_PRECISION), grid_step * 1e-5)
    if positions.size and float(np.max(np.abs(positions - reconstructed))) > tolerance:
        raise ValueError("world-position keys are not aligned to the declared local grid")
    return coordinates, origin


def local_grid_plan(source, grid_step):
    source_coordinates, origin = grid_coordinates(source["keys"], grid_step)
    minimum = np.min(source_coordinates, axis=0)
    maximum = np.max(source_coordinates, axis=0)
    shape = tuple(int(value) for value in (maximum - minimum + 1).tolist())
    bounding_volume_cells = math.prod(shape)
    dense_cell_budget = max(DENSE_GRID_MIN_CELL_BUDGET, len(source_coordinates) * DENSE_GRID_MAX_CELLS_PER_SOURCE)
    strategy = "dense-bounded-grid" if bounding_volume_cells <= dense_cell_budget else "sparse-key-lookup"
    return {
        "authority": "measured-bounding-volume-dense-or-exact-sparse-local-grid-v0",
        "strategy": strategy,
        "sourceCount": len(source_coordinates),
        "shape": shape,
        "boundingVolumeCells": bounding_volume_cells,
        "denseCellBudget": dense_cell_budget,
        "minimum": minimum,
        "maximum": maximum,
        "origin": origin,
        "sourceCoordinates": source_coordinates,
    }


def make_directional_inputs(keys, source, grid_step, plan=None):
    keys = [stable_key(key) for key in keys]
    if not keys:
        return np.zeros((0, 64), dtype=np.float32)
    plan = plan or local_grid_plan(source, grid_step)
    if plan["strategy"] == "sparse-key-lookup":
        return np.stack([make_directional_input(key, source, grid_step) for key in keys]).astype(np.float32)
    source_coordinates = plan["sourceCoordinates"]
    origin = plan["origin"]
    query_coordinates, _ = grid_coordinates(keys, grid_step, origin)
    minimum = plan["minimum"]
    shape = plan["shape"]
    lookup = np.full(shape, -1, dtype=np.int32)
    source_local = source_coordinates - minimum
    lookup[tuple(source_local.T)] = np.arange(len(source_coordinates), dtype=np.int32)

    result = np.zeros((len(keys), 64), dtype=np.float32)
    result[:, 0] = 1.0
    result[:, 1:4] = np.asarray(keys, dtype=np.float32)
    feature_sum = np.zeros((len(keys), 16), dtype=np.float32)
    neighbor_count = np.zeros(len(keys), dtype=np.int32)
    for class_index, delta in enumerate(DISPLACEMENTS):
        neighbor_local = query_coordinates + np.asarray(delta, dtype=np.int64) - minimum
        in_bounds = np.all((neighbor_local >= 0) & (neighbor_local < np.asarray(shape)), axis=1)
        source_indices = np.full(len(keys), -1, dtype=np.int32)
        if np.any(in_bounds):
            bounded = neighbor_local[in_bounds]
            source_indices[in_bounds] = lookup[tuple(bounded.T)]
        occupied = source_indices >= 0
        result[occupied, 21 + class_index] = 1.0
        if np.any(occupied):
            feature_sum[occupied] += source["candidates"][source_indices[occupied]]
            neighbor_count[occupied] += 1
        if delta == (0, 0, 0):
            result[occupied, 4] = 1.0
            result[occupied, 5:21] = source["candidates"][source_indices[occupied]]
    has_neighbors = neighbor_count > 0
    result[has_neighbors, 48:64] = feature_sum[has_neighbors] / neighbor_count[has_neighbors, None]
    return result


def feature_distance(left, right):
    return float(np.mean((left - right) ** 2))


def build_correspondence(source, target, grid_step, radius_cells=1):
    if radius_cells != 1:
        raise ValueError("v0 transport correspondence supports exactly one local-grid cell")
    stable_keys = set(source["index"]) & set(target["index"])
    matched_source = set()
    matched_target = set()
    matches = []
    for key in sorted(stable_keys):
        source_index = source["index"][key]
        target_index = target["index"][key]
        matched_source.add(source_index)
        matched_target.add(target_index)
        matches.append((source_index, target_index, (0, 0, 0), "stable", feature_distance(
            source["candidates"][source_index], target["candidates"][target_index],
        )))
    edges = []
    candidate_scores = {}
    for source_index, key in enumerate(source["keys"]):
        if source_index in matched_source:
            continue
        for delta in DISPLACEMENTS:
            if delta == (0, 0, 0):
                continue
            target_index = target["index"].get(offset_key(key, delta, grid_step))
            if target_index is None or target_index in matched_target:
                continue
            distance = feature_distance(source["candidates"][source_index], target["candidates"][target_index])
            score = distance + sum(value * value for value in delta) * 1e-6
            edges.append((score, source_index, target_index, delta, distance))
            candidate_scores.setdefault(source_index, []).append(score)
    ambiguous_sources = {
        source_index
        for source_index, scores in candidate_scores.items()
        if len(scores) > 1 and abs(sorted(scores)[0] - sorted(scores)[1]) <= 1e-9
    }
    edges.sort(key=lambda row: (row[0], source["keys"][row[1]], target["keys"][row[2]]))
    for _, source_index, target_index, delta, distance in edges:
        if source_index in matched_source or target_index in matched_target:
            continue
        matched_source.add(source_index)
        matched_target.add(target_index)
        matches.append((source_index, target_index, delta, "transported", distance))
    births = [index for index in range(len(target["keys"])) if index not in matched_target]
    deaths = [index for index in range(len(source["keys"])) if index not in matched_source]
    return {
        "authority": CORRESPONDENCE_AUTHORITY,
        "matches": matches,
        "births": births,
        "deaths": deaths,
        "stableCount": len(stable_keys),
        "transportedCount": len(matches) - len(stable_keys),
        "birthCount": len(births),
        "deathCount": len(deaths),
        "ambiguityCount": sum(1 for row in matches if row[0] in ambiguous_sources),
    }


def build_birth_universe(source, target, correspondence, grid_step):
    keys = set(source["keys"]) | set(target["keys"])
    for key in source["keys"]:
        keys.update(offset_key(key, delta, grid_step) for delta in DISPLACEMENTS)
    source_keys = set(source["keys"])
    return sorted(key for key in keys if key not in source_keys)


def carrier_motion_cohorts(source, target, correspondence, stable_bin_count=4):
    if stable_bin_count != 4:
        raise ValueError("motion-balanced transport currently requires four stable state-change bins")
    candidate_scale = np.maximum(np.std(source["candidates"], axis=0, dtype=np.float64), 1e-6)
    splat_scale = np.maximum(np.std(source["splats"][:, 3:12], axis=0, dtype=np.float64), 1e-6)
    cohorts = np.full(len(source["keys"]), "", dtype="<U12")
    stable_rows = []
    for source_index, target_index, _, kind, _ in correspondence["matches"]:
        if kind == "transported":
            cohorts[source_index] = "transported"
            continue
        candidate_delta = (
            source["candidates"][source_index].astype(np.float64)
            - target["candidates"][target_index].astype(np.float64)
        ) / candidate_scale
        splat_delta = (
            source["splats"][source_index, 3:12].astype(np.float64)
            - target["splats"][target_index, 3:12].astype(np.float64)
        ) / splat_scale
        score = math.sqrt(float((np.sum(candidate_delta ** 2) + np.sum(splat_delta ** 2)) / 25.0))
        stable_rows.append((score, target["keys"][target_index], source_index))
    stable_rows.sort(key=lambda row: (row[0], row[1]))
    for rank, (_, _, source_index) in enumerate(stable_rows):
        bin_index = min(stable_bin_count - 1, math.floor(rank * stable_bin_count / len(stable_rows)))
        cohorts[source_index] = f"stable-q{bin_index + 1}"
    for source_index in correspondence["deaths"]:
        cohorts[source_index] = "death"
    if np.any(cohorts == ""):
        raise ValueError("carrier motion cohorts are incomplete")
    counts = {cohort: int(np.sum(cohorts == cohort)) for cohort in CARRIER_COHORTS}
    return cohorts, counts


def build_pair_dataset(source, target, grid_step, radius_cells=1):
    correspondence = build_correspondence(source, target, grid_step, radius_cells)
    carrier_labels = np.full(len(source["keys"]), DEATH_CLASS, dtype=np.int32)
    for source_index, _, delta, _, _ in correspondence["matches"]:
        carrier_labels[source_index] = displacement_class(delta)
    carrier_inputs = np.stack([
        make_directional_input(key, source, grid_step)
        for key in source["keys"]
    ]).astype(np.float32)
    birth_keys = build_birth_universe(source, target, correspondence, grid_step)
    residual_birth_keys = {target["keys"][index] for index in correspondence["births"]}
    birth_inputs = np.stack([
        make_directional_input(key, source, grid_step)
        for key in birth_keys
    ]).astype(np.float32)
    birth_labels = np.asarray([1.0 if key in residual_birth_keys else 0.0 for key in birth_keys], dtype=np.float32)
    carrier_cohorts, cohort_counts = carrier_motion_cohorts(source, target, correspondence)
    return {
        "correspondence": correspondence,
        "carrierInputs": carrier_inputs,
        "carrierLabels": carrier_labels,
        "carrierCohorts": carrier_cohorts,
        "cohortCounts": cohort_counts,
        "birthInputs": birth_inputs,
        "birthLabels": birth_labels,
        "birthKeys": birth_keys,
    }


def eulerian_destination_universe(source, grid_step, plan=None):
    return sorted(set(source["keys"]) | set(prediction_universe(source, grid_step, plan)))


def local_destination_donors(destination_key, source, grid_step):
    donors = []
    for class_index, delta in enumerate(DISPLACEMENTS):
        source_key = offset_key(destination_key, tuple(-value for value in delta), grid_step)
        source_index = source["index"].get(source_key)
        if source_index is not None:
            donors.append((class_index, source_index))
    return donors


def build_eulerian_pair_dataset(source, target, grid_step, radius_cells=1):
    correspondence = build_correspondence(source, target, grid_step, radius_cells)
    source_cohorts, _ = carrier_motion_cohorts(source, target, correspondence)
    matched_targets = {
        target_index: (source_index, delta, kind)
        for source_index, target_index, delta, kind, _ in correspondence["matches"]
    }
    destination_keys = eulerian_destination_universe(source, grid_step)
    destination_key_set = set(destination_keys)
    carrier_labels = np.full(len(destination_keys), DEATH_CLASS, dtype=np.int32)
    occupancy_labels = np.zeros(len(destination_keys), dtype=np.float32)
    destination_cohorts = np.full(len(destination_keys), "empty", dtype="<U12")
    source_destination_mask = np.zeros(len(destination_keys), dtype=bool)
    destination_donor_indices = np.full(len(destination_keys), -1, dtype=np.int32)
    destination_target_indices = np.full(len(destination_keys), -1, dtype=np.int32)

    for destination_index, key in enumerate(destination_keys):
        direct_source_index = source["index"].get(key)
        source_destination_mask[destination_index] = direct_source_index is not None
        target_index = target["index"].get(key)
        if target_index is None:
            if direct_source_index is not None:
                destination_cohorts[destination_index] = "death"
            continue
        occupancy_labels[destination_index] = 1.0
        destination_target_indices[destination_index] = target_index
        matched = matched_targets.get(target_index)
        if matched is not None:
            source_index, delta, kind = matched
            destination_donor_indices[destination_index] = source_index
            carrier_labels[destination_index] = displacement_class(delta)
            destination_cohorts[destination_index] = (
                "transported" if kind == "transported" else source_cohorts[source_index]
            )
            continue
        donors = local_destination_donors(key, source, grid_step)
        if not donors:
            raise ValueError("supported Eulerian birth has no local attribute donor")
        class_index, source_index = min(
            donors,
            key=lambda row: (
                feature_distance(source["candidates"][row[1]], target["candidates"][target_index]),
                source["keys"][row[1]],
            ),
        )
        destination_donor_indices[destination_index] = source_index
        carrier_labels[destination_index] = class_index
        destination_cohorts[destination_index] = "birth"

    unsupported_birth_count = sum(
        1
        for target_index in correspondence["births"]
        if target["keys"][target_index] not in destination_key_set
    )
    cohort_counts = {
        cohort: int(np.sum(destination_cohorts == cohort))
        for cohort in EULERIAN_DESTINATION_COHORTS
    }
    if np.any(~np.isin(destination_cohorts, EULERIAN_DESTINATION_COHORTS)):
        raise ValueError("Eulerian destination cohorts are incomplete")
    destination_inputs = make_directional_inputs(destination_keys, source, grid_step)
    birth_mask = ~source_destination_mask
    return {
        "correspondence": correspondence,
        "destinationKeys": destination_keys,
        "destinationInputs": destination_inputs,
        "destinationCohorts": destination_cohorts,
        "destinationDonorIndices": destination_donor_indices,
        "destinationTargetIndices": destination_target_indices,
        "occupancyLabels": occupancy_labels,
        "sourceDestinationMask": source_destination_mask,
        "unsupportedBirthCount": unsupported_birth_count,
        "carrierInputs": destination_inputs,
        "carrierLabels": carrier_labels,
        "carrierCohorts": destination_cohorts,
        "cohortCounts": cohort_counts,
        "birthInputs": destination_inputs[birth_mask],
        "birthLabels": occupancy_labels[birth_mask],
        "birthKeys": [key for key, include in zip(destination_keys, birth_mask) if include],
    }


def build_frozen_seed_eulerian_exposure(training_pairs, frames, grid_step, predict_step):
    if not training_pairs or not callable(predict_step):
        raise ValueError("frozen-seed rollout exposure requires training pairs and a predictor")
    segments = []
    for left, right in training_pairs:
        left_index = int(left.get("controlledStepFrameIndex", -1))
        right_index = int(right.get("controlledStepFrameIndex", -1))
        if right_index != left_index + 1 or left.get("id") not in frames or right.get("id") not in frames:
            raise ValueError("frozen-seed rollout exposure pairs must be exact contiguous corpus frames")
        if segments and segments[-1][-1][1].get("id") == left.get("id"):
            segments[-1].append((left, right))
        else:
            segments.append([(left, right)])

    datasets = []
    pair_receipts = []
    segment_frame_ids = []
    for segment in segments:
        segment_frame_ids.append([segment[0][0]["id"], *[right["id"] for _, right in segment]])
        recurrent_source = frames[segment[0][0]["id"]]
        for rollout_depth in range(1, len(segment)):
            previous_left, _ = segment[rollout_depth - 1]
            recurrent_source, accounting = predict_step(
                recurrent_source,
                previous_left["id"],
                rollout_depth,
            )
            predicted_count = accounting.get("predictedCount") if isinstance(accounting, dict) else None
            composition_authority = (
                accounting.get("compositionAuthority") if isinstance(accounting, dict) else None
            )
            if (
                not isinstance(accounting, dict)
                or not isinstance(predicted_count, int)
                or isinstance(predicted_count, bool)
                or predicted_count != len(recurrent_source["keys"])
                or not isinstance(composition_authority, str)
                or not composition_authority.strip()
            ):
                raise ValueError("frozen-seed rollout exposure predictor accounting mismatch")
            source_doc, target_doc = segment[rollout_depth]
            target = frames[target_doc["id"]]
            dataset = build_eulerian_pair_dataset(recurrent_source, target, grid_step)
            supported_exact_target_count = int(np.sum(dataset["occupancyLabels"]))
            if supported_exact_target_count <= 0:
                raise ValueError("frozen-seed rollout exposure has zero supported exact targets")
            unsupported_birth_count = int(dataset["unsupportedBirthCount"])
            if supported_exact_target_count + unsupported_birth_count != len(target["keys"]):
                raise ValueError("frozen-seed rollout exposure target representability accounting mismatch")
            negative_destination_count = len(dataset["destinationKeys"]) - supported_exact_target_count
            datasets.append(dataset)
            pair_receipts.append({
                "sourceAuthority": "frozen-seed-model-induced-eulerian-support-v0",
                "targetAuthority": "exact-next-corpus-frame-grid-identity-v0",
                "sourceReferenceFrameId": source_doc["id"],
                "targetFrameId": target_doc["id"],
                "rolloutDepth": rollout_depth,
                "sourceCount": len(recurrent_source["keys"]),
                "targetCount": len(target["keys"]),
                "destinationSampleCount": len(dataset["destinationKeys"]),
                "supportedExactTargetCount": supported_exact_target_count,
                "negativeDestinationCount": negative_destination_count,
                "unsupportedBirthCount": unsupported_birth_count,
                "representableTargetFraction": supported_exact_target_count / len(target["keys"]),
                "sampleCap": None,
                "prediction": dict(accounting),
            })
    if not datasets:
        raise ValueError("frozen-seed rollout exposure produced no recurrent training pairs")
    return datasets, {
        "authority": "frozen-seed-recurrent-eulerian-support-exposure-v0",
        "segmentFrameIds": segment_frame_ids,
        "pairCount": len(pair_receipts),
        "pairs": pair_receipts,
        "sampleCap": None,
    }


def build_transport_training_exposure(
    training_pairs,
    frames,
    grid_step,
    objective_family,
    predict_step=None,
):
    if not training_pairs:
        raise ValueError("transport training exposure requires exact training pairs")
    datasets = []
    pair_reports = []
    for left, right in training_pairs:
        dataset = (
            build_eulerian_pair_dataset(frames[left["id"]], frames[right["id"]], grid_step)
            if objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
            else build_pair_dataset(frames[left["id"]], frames[right["id"]], grid_step)
        )
        datasets.append(dataset)
        pair_reports.append({
            "sourceAuthority": "exact-corpus-frame-grid-identity-v0",
            "targetAuthority": "exact-next-corpus-frame-grid-identity-v0",
            "sourceFrameId": left["id"],
            "targetFrameId": right["id"],
            **{
                key: value
                for key, value in dataset["correspondence"].items()
                if key != "matches" and key not in ("births", "deaths")
            },
            "carrierSampleCount": len(dataset["carrierLabels"]),
            "sourceCount": len(frames[left["id"]]["keys"]),
            "targetCount": len(frames[right["id"]]["keys"]),
            "birthSampleCount": len(dataset["birthLabels"]),
            "birthPositiveCount": int(np.sum(dataset["birthLabels"])),
            "carrierCohorts": dataset["cohortCounts"],
            "sampleCap": None,
            **(
                {"unsupportedBirthCount": dataset["unsupportedBirthCount"]}
                if objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
                else {}
            ),
        })
    if predict_step is None:
        return datasets, pair_reports, None
    if objective_family != EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
        raise ValueError("frozen-seed recurrent exposure requires the Eulerian occupancy objective")
    recurrent_datasets, recurrent_receipt = build_frozen_seed_eulerian_exposure(
        training_pairs,
        frames,
        grid_step,
        predict_step,
    )
    recurrent_reports = []
    for dataset, receipt in zip(recurrent_datasets, recurrent_receipt["pairs"]):
        recurrent_reports.append({
            **receipt,
            "carrierSampleCount": len(dataset["carrierLabels"]),
            "birthSampleCount": len(dataset["birthLabels"]),
            "birthPositiveCount": int(np.sum(dataset["birthLabels"])),
            "carrierCohorts": dataset["cohortCounts"],
        })
    datasets.extend(recurrent_datasets)
    pair_reports.extend(recurrent_reports)
    return datasets, pair_reports, {
        "authority": "exact-plus-frozen-seed-recurrent-eulerian-support-exposure-v0",
        "exactPairCount": len(training_pairs),
        "recurrentPairCount": len(recurrent_datasets),
        "pairCount": len(datasets),
        "sampleCap": None,
        "recurrent": recurrent_receipt,
    }


def build_destination_state_dataset(source, target, grid_step, radius_cells=1, state_cohorts=None):
    eulerian = build_eulerian_pair_dataset(source, target, grid_step, radius_cells)
    state_cohorts = tuple(state_cohorts or DESTINATION_STATE_COHORTS)
    if (
        not state_cohorts
        or len(set(state_cohorts)) != len(state_cohorts)
        or any(cohort not in SUPPORTED_DESTINATION_STATE_COHORTS for cohort in state_cohorts)
    ):
        raise ValueError("destination-state supervision cohorts must be unique supported destinations")
    cohort_order = {cohort: index for index, cohort in enumerate(state_cohorts)}
    selected = [
        index
        for index, cohort in enumerate(eulerian["destinationCohorts"])
        if cohort in cohort_order
    ]
    selected.sort(key=lambda index: (
        cohort_order[eulerian["destinationCohorts"][index]],
        eulerian["destinationKeys"][index],
    ))
    if not selected:
        raise ValueError("destination-state supervision requires selected supported destinations")

    donor_indices = eulerian["destinationDonorIndices"][selected]
    target_indices = eulerian["destinationTargetIndices"][selected]
    carrier_classes = eulerian["carrierLabels"][selected]
    if np.any(donor_indices < 0) or np.any(target_indices < 0):
        raise ValueError("destination-state supervision contains an unresolved donor or target")
    if np.any(carrier_classes >= DEATH_CLASS):
        raise ValueError("destination-state supervision cannot use the death class as a donor")

    baselines = np.concatenate((
        source["candidates"][donor_indices],
        source["splats"][donor_indices, 3:],
    ), axis=1).astype(np.float32)
    targets = np.concatenate((
        target["candidates"][target_indices],
        target["splats"][target_indices, 3:],
    ), axis=1).astype(np.float32)
    donor_codes = np.zeros((len(selected), DEATH_CLASS), dtype=np.float32)
    donor_codes[np.arange(len(selected)), carrier_classes] = 1.0
    state_inputs = np.concatenate((
        eulerian["destinationInputs"][selected],
        baselines,
        donor_codes,
    ), axis=1).astype(np.float32)
    if state_inputs.shape[1] != DESTINATION_STATE_INPUT_COUNT:
        raise ValueError("destination-state input width violates its explicit contract")
    return {
        "stateInputs": state_inputs,
        "stateTargets": targets,
        "stateBaselines": baselines,
        "stateResidualTargets": (targets - baselines).astype(np.float32),
        "stateCohorts": eulerian["destinationCohorts"][selected].copy(),
        "stateDestinationKeys": [eulerian["destinationKeys"][index] for index in selected],
        "stateDonorIndices": donor_indices.copy(),
        "stateTargetIndices": target_indices.copy(),
        "stateCarrierClasses": carrier_classes.copy(),
        "correspondence": eulerian["correspondence"],
    }


def build_destination_state_inference_inputs(source, carried, donor_classes, grid_step):
    donor_classes = np.asarray(donor_classes, dtype=np.int32)
    if donor_classes.shape != (len(carried["keys"]),):
        raise ValueError("destination-state donor classes must align with carried support")
    if np.any(donor_classes < 0) or np.any(donor_classes >= DEATH_CLASS):
        raise ValueError("destination-state donor classes must name a local displacement")
    destination_inputs = make_directional_inputs(carried["keys"], source, grid_step)
    baselines = np.concatenate((carried["candidates"], carried["splats"][:, 3:]), axis=1).astype(np.float32)
    donor_codes = np.zeros((len(carried["keys"]), DEATH_CLASS), dtype=np.float32)
    donor_codes[np.arange(len(carried["keys"])), donor_classes] = 1.0
    inputs = np.concatenate((destination_inputs, baselines, donor_codes), axis=1).astype(np.float32)
    if inputs.shape != (len(carried["keys"]), DESTINATION_STATE_INPUT_COUNT):
        raise ValueError("destination-state inference input violates its explicit contract")
    return inputs


def build_motion_sampling_pools(cohorts):
    cohorts = np.asarray(cohorts)
    pools = {}
    for cohort in CARRIER_COHORTS:
        indices = np.flatnonzero(cohorts == cohort)
        if not len(indices):
            raise ValueError(f"motion-balanced sampling requires populated cohort {cohort}")
        pools[cohort] = indices
    return pools


def sample_motion_balanced_indices(rng, pools, batch_size):
    if tuple(pools) != CARRIER_COHORTS or any(not len(pools[cohort]) for cohort in CARRIER_COHORTS):
        raise ValueError("motion-balanced sampling pools are incomplete or out of order")
    if batch_size < len(pools):
        raise ValueError("motion-balanced batch must contain at least one row per carrier cohort")
    base, remainder = divmod(int(batch_size), len(pools))
    sampled = []
    for cohort_index, cohort in enumerate(CARRIER_COHORTS):
        indices = pools[cohort]
        count = base + (1 if cohort_index < remainder else 0)
        sampled.append(rng.choice(indices, size=count, replace=True))
    result = np.concatenate(sampled).astype(np.int64)
    rng.shuffle(result)
    return result


def build_eulerian_sampling_pools(cohorts):
    cohorts = np.asarray(cohorts)
    pools = {}
    for cohort in EULERIAN_DESTINATION_COHORTS:
        indices = np.flatnonzero(cohorts == cohort)
        if not len(indices):
            raise ValueError(f"Eulerian balanced sampling requires populated cohort {cohort}")
        pools[cohort] = indices
    return pools


def sample_eulerian_balanced_indices(rng, pools, batch_size):
    if tuple(pools) != EULERIAN_DESTINATION_COHORTS:
        raise ValueError("Eulerian balanced sampling pools are incomplete or out of order")
    if batch_size < len(pools):
        raise ValueError("Eulerian balanced batch must contain at least one row per destination cohort")
    base, remainder = divmod(int(batch_size), len(pools))
    sampled = []
    for cohort_index, cohort in enumerate(EULERIAN_DESTINATION_COHORTS):
        indices = pools[cohort]
        if not len(indices):
            raise ValueError(f"Eulerian balanced sampling requires populated cohort {cohort}")
        count = base + (1 if cohort_index < remainder else 0)
        sampled.append(rng.choice(indices, size=count, replace=True))
    result = np.concatenate(sampled).astype(np.int64)
    rng.shuffle(result)
    return result


def build_destination_state_sampling_pools(cohorts):
    cohorts = np.asarray(cohorts)
    pools = {}
    for cohort in DESTINATION_STATE_COHORTS:
        indices = np.flatnonzero(cohorts == cohort)
        if not len(indices):
            raise ValueError(f"destination-state sampling requires populated cohort {cohort}")
        pools[cohort] = indices
    if np.any(~np.isin(cohorts, DESTINATION_STATE_COHORTS)):
        raise ValueError("destination-state sampling received a non-motion cohort")
    return pools


def sample_destination_state_balanced_indices(rng, pools, batch_size):
    if tuple(pools) != DESTINATION_STATE_COHORTS:
        raise ValueError("destination-state sampling pools are incomplete or out of order")
    if batch_size < len(pools):
        raise ValueError("destination-state batch must contain at least one row per cohort")
    base, remainder = divmod(int(batch_size), len(pools))
    sampled = []
    for cohort_index, cohort in enumerate(DESTINATION_STATE_COHORTS):
        indices = pools[cohort]
        if not len(indices):
            raise ValueError(f"destination-state sampling requires populated cohort {cohort}")
        count = base + (1 if cohort_index < remainder else 0)
        sampled.append(rng.choice(indices, size=count, replace=True))
    result = np.concatenate(sampled).astype(np.int64)
    rng.shuffle(result)
    return result


def build_binary_sampling_pools(labels):
    labels = np.asarray(labels) > 0.5
    negative = np.flatnonzero(~labels)
    positive = np.flatnonzero(labels)
    if not len(negative) or not len(positive):
        raise ValueError("balanced birth sampling requires positive and negative rows")
    return {"negative": negative, "positive": positive}


def sample_binary_balanced_indices(rng, pools, batch_size):
    negative = pools.get("negative", ())
    positive = pools.get("positive", ())
    if not len(negative) or not len(positive):
        raise ValueError("balanced birth sampling pools are incomplete")
    negative_count = int(batch_size) // 2
    positive_count = int(batch_size) - negative_count
    result = np.concatenate((
        rng.choice(negative, size=negative_count, replace=True),
        rng.choice(positive, size=positive_count, replace=True),
    )).astype(np.int64)
    rng.shuffle(result)
    return result


class TransportModel(nn.Module):
    def __init__(self, hidden_size):
        super().__init__()
        self.trunk_a = nn.Linear(64, hidden_size)
        self.trunk_b = nn.Linear(hidden_size, hidden_size)
        self.carrier = nn.Linear(hidden_size, DEATH_CLASS + 1)
        self.birth = nn.Linear(hidden_size, 1)

    def __call__(self, inputs):
        hidden = nn.relu(self.trunk_a(inputs))
        hidden = nn.relu(self.trunk_b(hidden))
        return self.carrier(hidden), self.birth(hidden).squeeze(-1)


class DestinationStateModel(nn.Module):
    def __init__(self, hidden_size):
        super().__init__()
        self.trunk_a = nn.Linear(DESTINATION_STATE_INPUT_COUNT, hidden_size)
        self.trunk_b = nn.Linear(hidden_size, hidden_size)
        self.residual = nn.Linear(hidden_size, DESTINATION_STATE_ATTRIBUTE_COUNT)

    def __call__(self, inputs):
        hidden = nn.relu(self.trunk_a(inputs))
        hidden = nn.relu(self.trunk_b(hidden))
        return self.residual(hidden)


def destination_state_loss(model, inputs, residual_targets):
    residuals = model(inputs)
    return mx.mean((residuals - residual_targets) ** 2)


def predict_destination_state_model(
    model,
    inputs,
    input_mean,
    input_scale,
    residual_mean,
    residual_scale,
    batch_size,
):
    rows = []
    for start in range(0, len(inputs), batch_size):
        normalized = (inputs[start:start + batch_size] - input_mean) / input_scale
        rows.append(np.asarray(model(mx.array(normalized)), dtype=np.float32))
    if not rows:
        return np.zeros((0, DESTINATION_STATE_ATTRIBUTE_COUNT), dtype=np.float32)
    normalized_residuals = np.concatenate(rows)
    return (normalized_residuals * residual_scale + residual_mean).astype(np.float32)


def weighted_loss(model, carrier_inputs, carrier_labels, birth_inputs, birth_labels, class_weights, birth_positive_weight):
    carrier_logits, _ = model(carrier_inputs)
    carrier_log_probabilities = carrier_logits - mx.logsumexp(carrier_logits, axis=1, keepdims=True)
    selected = mx.take_along_axis(carrier_log_probabilities, carrier_labels[:, None], axis=1).squeeze(1)
    selected_weights = mx.take(class_weights, carrier_labels)
    carrier_loss = -mx.sum(selected * selected_weights) / mx.maximum(mx.sum(selected_weights), 1e-6)
    _, birth_logits = model(birth_inputs)
    birth_loss_rows = mx.maximum(birth_logits, 0) - birth_logits * birth_labels + mx.log1p(mx.exp(-mx.abs(birth_logits)))
    birth_weights = mx.where(birth_labels > 0.5, birth_positive_weight, 1.0)
    birth_loss = mx.sum(birth_loss_rows * birth_weights) / mx.maximum(mx.sum(birth_weights), 1e-6)
    return carrier_loss + birth_loss, (carrier_loss, birth_loss)


def predict_model(model, inputs, input_mean, input_scale, batch_size):
    carrier_rows = []
    birth_rows = []
    for start in range(0, len(inputs), batch_size):
        normalized = (inputs[start:start + batch_size] - input_mean) / input_scale
        carrier_logits, birth_logits = model(mx.array(normalized))
        carrier_rows.append(np.asarray(mx.softmax(carrier_logits, axis=1), dtype=np.float32))
        birth_rows.append(np.asarray(mx.sigmoid(birth_logits), dtype=np.float32))
    return np.concatenate(carrier_rows), np.concatenate(birth_rows)


def calibrate_birth(probabilities, labels):
    rows = []
    truth = labels > 0.5
    for threshold in np.arange(0.05, 1.0, 0.05):
        predicted = probabilities >= threshold
        tp = int(np.sum(predicted & truth))
        fp = int(np.sum(predicted & ~truth))
        fn = int(np.sum(~predicted & truth))
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        f_score = 2 * precision * recall / max(1e-12, precision + recall)
        rows.append({
            "threshold": float(threshold), "precision": precision, "recall": recall,
            "fScore": f_score, "truePositive": tp, "falsePositive": fp,
            "falseNegative": fn, "sampleCount": len(labels),
        })
    return max(rows, key=lambda row: (row["fScore"], row["precision"], row["threshold"]))


def calibrate_action_margin(probabilities, labels):
    probabilities = np.asarray(probabilities, dtype=np.float32)
    labels = np.asarray(labels, dtype=np.int32)
    stable_class = displacement_class((0, 0, 0))
    action_probabilities = probabilities.copy()
    action_probabilities[:, stable_class] = -np.inf
    margins = np.max(action_probabilities, axis=1) - probabilities[:, stable_class]
    truth = labels != stable_class
    order = np.argsort(-margins, kind="stable")
    sorted_margins = margins[order]
    sorted_truth = truth[order].astype(np.int64)
    cumulative_true = np.cumsum(sorted_truth)
    group_ends = np.flatnonzero(np.r_[sorted_margins[1:] != sorted_margins[:-1], True])
    total_true = int(np.sum(truth))
    positive_group_ends = [int(end) for end in group_ends if float(sorted_margins[end]) > 0.0]
    threshold_candidate_count = len(positive_group_ends) + 1
    predicted_at_zero = margins >= 0.0
    zero_tp = int(np.sum(predicted_at_zero & truth))
    zero_fp = int(np.sum(predicted_at_zero & ~truth))
    zero_fn = total_true - zero_tp
    zero_precision = zero_tp / max(1, zero_tp + zero_fp)
    zero_recall = zero_tp / max(1, zero_tp + zero_fn)
    zero_f_score = 2 * zero_precision * zero_recall / max(1e-12, zero_precision + zero_recall)
    best = {
        "authority": "training-carrier-action-margin-f1-v0",
        "algorithmAuthority": "descending-margin-cumulative-confusion-v0",
        "thresholdCandidateCount": threshold_candidate_count,
        "threshold": 0.0,
        "precision": zero_precision,
        "recall": zero_recall,
        "fScore": zero_f_score,
        "truePositive": zero_tp,
        "falsePositive": zero_fp,
        "falseNegative": zero_fn,
        "sampleCount": len(labels),
    }
    for end in positive_group_ends:
        predicted_count = int(end) + 1
        tp = int(cumulative_true[end])
        fp = predicted_count - tp
        fn = total_true - tp
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        f_score = 2 * precision * recall / max(1e-12, precision + recall)
        row = {
            "authority": "training-carrier-action-margin-f1-v0",
            "algorithmAuthority": "descending-margin-cumulative-confusion-v0",
            "thresholdCandidateCount": threshold_candidate_count,
            "threshold": float(sorted_margins[end]),
            "precision": precision,
            "recall": recall,
            "fScore": f_score,
            "truePositive": tp,
            "falsePositive": fp,
            "falseNegative": fn,
            "sampleCount": len(labels),
        }
        if best is None or (row["fScore"], row["precision"], row["threshold"]) > (
            best["fScore"], best["precision"], best["threshold"]
        ):
            best = row
    return best


def calibrate_destination_death_margin(probabilities, labels, inputs, source_destination_mask):
    probabilities = np.asarray(probabilities, dtype=np.float32)
    labels = np.asarray(labels, dtype=np.int32)
    inputs = np.asarray(inputs, dtype=np.float32)
    source_destination_mask = np.asarray(source_destination_mask, dtype=bool)
    if (
        probabilities.shape != (len(labels), DEATH_CLASS + 1)
        or inputs.shape != (len(labels), 64)
        or source_destination_mask.shape != (len(labels),)
    ):
        raise ValueError("Eulerian death calibration rows do not align")
    selected_probabilities = probabilities[source_destination_mask]
    selected_labels = labels[source_destination_mask]
    selected_inputs = inputs[source_destination_mask]
    if not len(selected_labels) or not np.any(selected_labels == DEATH_CLASS):
        raise ValueError("Eulerian death calibration requires source-cell death examples")
    valid_probabilities = np.full((len(selected_labels), DEATH_CLASS), -np.inf, dtype=np.float32)
    for class_index, delta in enumerate(DISPLACEMENTS):
        inverse_class = displacement_class(tuple(-value for value in delta))
        valid = selected_inputs[:, 21 + inverse_class] > 0.5
        valid_probabilities[valid, class_index] = selected_probabilities[valid, class_index]
    best_valid = np.max(valid_probabilities, axis=1)
    if np.any(~np.isfinite(best_valid)):
        raise ValueError("Eulerian death calibration found a source cell without a valid donor")
    margins = selected_probabilities[:, DEATH_CLASS] - best_valid
    truth = selected_labels == DEATH_CLASS
    order = np.argsort(-margins, kind="stable")
    sorted_margins = margins[order]
    sorted_truth = truth[order].astype(np.int64)
    cumulative_true = np.cumsum(sorted_truth)
    group_ends = np.flatnonzero(np.r_[sorted_margins[1:] != sorted_margins[:-1], True])
    total_true = int(np.sum(truth))
    candidate_ends = [int(end) for end in group_ends if float(sorted_margins[end]) > 0.0]
    predicted_at_zero = margins >= 0.0
    zero_tp = int(np.sum(predicted_at_zero & truth))
    zero_fp = int(np.sum(predicted_at_zero & ~truth))
    zero_fn = total_true - zero_tp
    zero_precision = zero_tp / max(1, zero_tp + zero_fp)
    zero_recall = zero_tp / max(1, zero_tp + zero_fn)
    best = {
        "authority": "training-eulerian-source-death-margin-f1-v0",
        "algorithmAuthority": "descending-margin-cumulative-confusion-v0",
        "thresholdCandidateCount": len(candidate_ends) + 1,
        "threshold": 0.0,
        "precision": zero_precision,
        "recall": zero_recall,
        "fScore": 2 * zero_precision * zero_recall / max(1e-12, zero_precision + zero_recall),
        "truePositive": zero_tp,
        "falsePositive": zero_fp,
        "falseNegative": zero_fn,
        "sampleCount": len(selected_labels),
    }
    for end in candidate_ends:
        predicted_count = end + 1
        tp = int(cumulative_true[end])
        fp = predicted_count - tp
        fn = total_true - tp
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        row = {
            **best,
            "threshold": float(sorted_margins[end]),
            "precision": precision,
            "recall": recall,
            "fScore": 2 * precision * recall / max(1e-12, precision + recall),
            "truePositive": tp,
            "falsePositive": fp,
            "falseNegative": fn,
        }
        if (row["fScore"], row["precision"], row["threshold"]) > (
            best["fScore"], best["precision"], best["threshold"]
        ):
            best = row
    return best


def calibrate_target_support_ratio(pair_rows):
    ratios = []
    for row in pair_rows:
        source_count = int(row["sourceCount"])
        target_count = int(row["targetCount"])
        if source_count <= 0 or target_count <= 0:
            raise ValueError("target support calibration requires positive source and target counts")
        ratios.append(target_count / source_count)
    if not ratios:
        raise ValueError("target support calibration requires at least one training pair")
    return {
        "authority": "training-adjacent-target-source-count-ratio-median-v0",
        "pairCount": len(ratios),
        "ratios": ratios,
        "minimumRatio": min(ratios),
        "maximumRatio": max(ratios),
        "medianRatio": float(np.median(np.asarray(ratios, dtype=np.float64))),
    }


def select_ranked_births(birth_keys, birth_probabilities, claimed_keys, target_support_budget, claimed_count):
    birth_budget = max(0, int(target_support_budget) - int(claimed_count))
    ranked = sorted(
        (
            (key, float(probability))
            for key, probability in zip(birth_keys, birth_probabilities)
            if key not in claimed_keys
        ),
        key=lambda row: (-row[1], row[0]),
    )
    return ranked[:birth_budget]


def carrier_metrics(probabilities, labels):
    predicted = np.argmax(probabilities, axis=1)
    exact = predicted == labels
    moving_truth = (labels != displacement_class((0, 0, 0))) & (labels != DEATH_CLASS)
    moving_predicted = (predicted != displacement_class((0, 0, 0))) & (predicted != DEATH_CLASS)
    tp = int(np.sum(moving_truth & moving_predicted & exact))
    fp = int(np.sum(moving_predicted & ~exact))
    fn = int(np.sum(moving_truth & ~exact))
    return {
        "accuracy": float(np.mean(exact)),
        "sampleCount": len(labels),
        "movingClassAccuracy": float(np.mean(exact[moving_truth])) if np.any(moving_truth) else 0.0,
        "movingTruePositive": tp,
        "movingFalsePositive": fp,
        "movingFalseNegative": fn,
        "movingPrecision": tp / max(1, tp + fp),
        "movingRecall": tp / max(1, tp + fn),
    }


def model_layer(layer, role, activation):
    return {
        "role": role,
        "inputSize": int(layer.weight.shape[1]),
        "outputSize": int(layer.weight.shape[0]),
        "activation": activation,
        "weights": np.asarray(layer.weight, dtype=np.float32).reshape(-1).tolist(),
        "bias": np.asarray(layer.bias, dtype=np.float32).reshape(-1).tolist(),
    }


def validate_frozen_model_document(document):
    if document.get("schema") != MODEL_SCHEMA or document.get("status") != "completed":
        raise ValueError("frozen model schema/status mismatch")
    route = document.get("route", {})
    if route.get("backend") != "mlx" or route.get("fallbackReason") not in (None, ""):
        raise ValueError("frozen model route must be non-fallback MLX")
    input_document = document.get("input", {})
    if input_document.get("authority") != INPUT_AUTHORITY:
        raise ValueError("frozen model input authority mismatch")
    if (
        input_document.get("featureCount") != 64
        or input_document.get("candidateFeatureCount") != 16
        or input_document.get("directionalOccupancyCount") != len(DISPLACEMENTS)
    ):
        raise ValueError("frozen model input shape contract mismatch")
    mean = np.asarray(input_document.get("mean", []), dtype=np.float32)
    scale = np.asarray(input_document.get("scale", []), dtype=np.float32)
    if mean.shape != (64,) or scale.shape != (64,) or not np.all(np.isfinite(mean)) or not np.all(np.isfinite(scale)):
        raise ValueError("frozen model normalization contract mismatch")
    if np.any(scale <= 0):
        raise ValueError("frozen model normalization scale must be positive")
    architecture = document.get("architecture", {})
    if architecture.get("authority") != ARCHITECTURE_AUTHORITY:
        raise ValueError("frozen model architecture authority mismatch")
    expected_order = [list(delta) for delta in DISPLACEMENTS] + ["death"]
    if architecture.get("carrierOutputOrder") != expected_order:
        raise ValueError("frozen model carrier output order mismatch")
    expected_layers = (
        ("shared-trunk-a", "relu", 64, None),
        ("shared-trunk-b", "relu", None, None),
        ("carrier-displacement-death-head", "softmax", None, DEATH_CLASS + 1),
        ("residual-birth-head", "sigmoid", None, 1),
    )
    layers = architecture.get("layers", [])
    if len(layers) != len(expected_layers):
        raise ValueError("frozen model must contain exactly four deployed layers")
    hidden_size = int(layers[0].get("outputSize", 0))
    if hidden_size < 1:
        raise ValueError("frozen model hidden size must be positive")
    expected_layers = (
        ("shared-trunk-a", "relu", 64, hidden_size),
        ("shared-trunk-b", "relu", hidden_size, hidden_size),
        ("carrier-displacement-death-head", "softmax", hidden_size, DEATH_CLASS + 1),
        ("residual-birth-head", "sigmoid", hidden_size, 1),
    )
    for layer, (role, activation, input_size, output_size) in zip(layers, expected_layers):
        if (
            layer.get("role") != role
            or layer.get("activation") != activation
            or layer.get("inputSize") != input_size
            or layer.get("outputSize") != output_size
        ):
            raise ValueError(f"frozen model layer contract mismatch for {role}")
        weights = np.asarray(layer.get("weights", []), dtype=np.float32)
        bias = np.asarray(layer.get("bias", []), dtype=np.float32)
        if weights.size != input_size * output_size or bias.size != output_size:
            raise ValueError(f"frozen model parameter shape mismatch for {role}")
        if not np.all(np.isfinite(weights)) or not np.all(np.isfinite(bias)):
            raise ValueError(f"frozen model parameters must be finite for {role}")
    birth = document.get("calibration", {}).get("birth", {})
    target_support = document.get("calibration", {}).get("targetSupport", {})
    if not math.isfinite(float(birth.get("threshold", math.nan))) or not math.isfinite(float(birth.get("precision", math.nan))):
        raise ValueError("frozen model birth calibration mismatch")
    if not math.isfinite(float(target_support.get("medianRatio", math.nan))) or float(target_support["medianRatio"]) <= 0:
        raise ValueError("frozen model target support calibration mismatch")
    objective_family = document.get("training", {}).get("objectiveFamily", LEGACY_OBJECTIVE_FAMILY)
    if objective_family not in (
        LEGACY_OBJECTIVE_FAMILY,
        MOTION_BALANCED_OBJECTIVE_FAMILY,
        EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY,
    ):
        raise ValueError("frozen model objective family mismatch")
    composition_authority = "carrier-argmax-with-ranked-residual-birth-v0"
    if objective_family == MOTION_BALANCED_OBJECTIVE_FAMILY:
        action = document.get("calibration", {}).get("carrierAction", {})
        if (
            action.get("authority") != "training-carrier-action-margin-f1-v0"
            or not math.isfinite(float(action.get("threshold", math.nan)))
            or not math.isfinite(float(action.get("precision", math.nan)))
            or not math.isfinite(float(action.get("recall", math.nan)))
        ):
            raise ValueError("frozen motion-balanced model action calibration mismatch")
        if float(action["threshold"]) < 0:
            raise ValueError("frozen motion-balanced model action calibration threshold must be nonnegative")
        composition_authority = "copied-static-scaffold-with-calibrated-carrier-actions-v0"
    elif objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
        destination_death = document.get("calibration", {}).get("destinationDeath", {})
        if (
            destination_death.get("authority") != "training-eulerian-source-death-margin-f1-v0"
            or not math.isfinite(float(destination_death.get("threshold", math.nan)))
            or not math.isfinite(float(destination_death.get("precision", math.nan)))
            or not math.isfinite(float(destination_death.get("recall", math.nan)))
        ):
            raise ValueError("frozen Eulerian model destination death calibration mismatch")
        if float(destination_death["threshold"]) < 0:
            raise ValueError("frozen Eulerian model destination death calibration threshold must be nonnegative")
        composition_authority = "copied-static-scaffold-with-eulerian-destination-occupancy-residual-v0"
    return {
        "hiddenSize": hidden_size,
        "mean": mean,
        "scale": scale,
        "objectiveFamily": objective_family,
        "compositionAuthority": composition_authority,
    }


def hydrate_frozen_model_document(document):
    validated = validate_frozen_model_document(document)
    model = TransportModel(validated["hiddenSize"])
    targets = (model.trunk_a, model.trunk_b, model.carrier, model.birth)
    for target, layer in zip(targets, document["architecture"]["layers"]):
        output_size = int(layer["outputSize"])
        input_size = int(layer["inputSize"])
        target.weight = mx.array(np.asarray(layer["weights"], dtype=np.float32).reshape(output_size, input_size))
        target.bias = mx.array(np.asarray(layer["bias"], dtype=np.float32))
    mx.eval(model.parameters())
    return model, validated["mean"], validated["scale"]


def load_rollout_seed_model(
    model_path,
    expected_sha256,
    manifest_receipt,
    objective_family,
    requested_hidden_size,
):
    if objective_family != EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
        raise ValueError("rollout seed model requires the Eulerian occupancy objective")
    if (
        not isinstance(expected_sha256, str)
        or len(expected_sha256) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in expected_sha256)
    ):
        raise ValueError("rollout seed model expected SHA-256 is malformed")
    model_path = Path(model_path).resolve()
    model_bytes = model_path.read_bytes()
    model_sha256 = sha256_bytes(model_bytes)
    if model_sha256.lower() != expected_sha256.lower():
        raise ValueError("rollout seed model byte/hash mismatch")
    document = json.loads(model_bytes)
    validated = validate_frozen_model_document(document)
    if validated["objectiveFamily"] != EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
        raise ValueError("rollout seed model requires the Eulerian occupancy objective")
    training_manifest = document.get("manifest", {})
    if (
        not isinstance(training_manifest, dict)
        or not isinstance(training_manifest.get("path"), str)
        or not training_manifest["path"]
        or not isinstance(training_manifest.get("bytes"), int)
        or isinstance(training_manifest.get("bytes"), bool)
        or training_manifest["bytes"] < 1
        or not isinstance(training_manifest.get("sha256"), str)
        or len(training_manifest["sha256"]) != 64
    ):
        raise ValueError("rollout seed model training manifest identity is malformed")
    if (
        training_manifest["bytes"] != manifest_receipt.get("bytes")
        or training_manifest["sha256"].lower() != str(manifest_receipt.get("sha256", "")).lower()
    ):
        raise ValueError("rollout seed model training manifest identity mismatch")
    if (
        not isinstance(requested_hidden_size, int)
        or isinstance(requested_hidden_size, bool)
        or requested_hidden_size != validated["hiddenSize"]
    ):
        raise ValueError("rollout seed model hidden size mismatch")
    model, input_mean, input_scale = hydrate_frozen_model_document(document)
    return {
        "model": model,
        "document": document,
        "inputMean": input_mean,
        "inputScale": input_scale,
        "receipt": {
            "authority": "byte-hash-bound-frozen-eulerian-rollout-seed-v0",
            "path": str(model_path),
            "bytes": len(model_bytes),
            "sha256": model_sha256,
            "schema": MODEL_SCHEMA,
            "trainingManifestSha256": training_manifest["sha256"],
            "objectiveFamily": validated["objectiveFamily"],
            "hiddenSize": validated["hiddenSize"],
            "normalizationAuthority": "frozen-seed-model-input-normalization-v0",
        },
    }


def validate_frozen_destination_state_model_document(document):
    if document.get("schema") != DESTINATION_STATE_MODEL_SCHEMA or document.get("status") != "completed":
        raise ValueError("frozen destination-state model schema/status mismatch")
    route = document.get("route", {})
    if route.get("backend") != "mlx" or route.get("fallbackReason") not in (None, ""):
        raise ValueError("frozen destination-state model route must be non-fallback MLX")
    input_document = document.get("input", {})
    if input_document.get("authority") != DESTINATION_STATE_INPUT_AUTHORITY:
        raise ValueError("frozen destination-state model input authority mismatch")
    if (
        input_document.get("featureCount") != DESTINATION_STATE_INPUT_COUNT
        or input_document.get("destinationLocalGridFeatureCount") != 64
        or input_document.get("selectedDonorAttributeCount") != DESTINATION_STATE_ATTRIBUTE_COUNT
        or input_document.get("selectedDonorDisplacementCount") != DEATH_CLASS
    ):
        raise ValueError("frozen destination-state model input shape mismatch")
    input_mean = np.asarray(input_document.get("mean", []), dtype=np.float32)
    input_scale = np.asarray(input_document.get("scale", []), dtype=np.float32)
    output_document = document.get("output", {})
    if (
        output_document.get("authority") != DESTINATION_STATE_OUTPUT_AUTHORITY
        or output_document.get("attributeCount") != DESTINATION_STATE_ATTRIBUTE_COUNT
    ):
        raise ValueError("frozen destination-state model output contract mismatch")
    residual_mean = np.asarray(output_document.get("residualMean", []), dtype=np.float32)
    residual_scale = np.asarray(output_document.get("residualScale", []), dtype=np.float32)
    for name, values, shape in (
        ("input mean", input_mean, (DESTINATION_STATE_INPUT_COUNT,)),
        ("input scale", input_scale, (DESTINATION_STATE_INPUT_COUNT,)),
        ("residual mean", residual_mean, (DESTINATION_STATE_ATTRIBUTE_COUNT,)),
        ("residual scale", residual_scale, (DESTINATION_STATE_ATTRIBUTE_COUNT,)),
    ):
        if values.shape != shape or not np.all(np.isfinite(values)):
            raise ValueError(f"frozen destination-state model {name} mismatch")
    if np.any(input_scale <= 0) or np.any(residual_scale <= 0):
        raise ValueError("frozen destination-state model scales must be positive")

    architecture = document.get("architecture", {})
    if architecture.get("authority") != DESTINATION_STATE_ARCHITECTURE_AUTHORITY:
        raise ValueError("frozen destination-state model architecture authority mismatch")
    layers = architecture.get("layers", [])
    if len(layers) != 3:
        raise ValueError("frozen destination-state model must contain exactly three offline layers")
    hidden_size = int(layers[0].get("outputSize", 0))
    if hidden_size < 1:
        raise ValueError("frozen destination-state model hidden size must be positive")
    expected_layers = (
        ("destination-state-trunk-a", "relu", DESTINATION_STATE_INPUT_COUNT, hidden_size),
        ("destination-state-trunk-b", "relu", hidden_size, hidden_size),
        ("destination-state-residual-head", "linear", hidden_size, DESTINATION_STATE_ATTRIBUTE_COUNT),
    )
    for layer, (role, activation, input_size, output_size) in zip(layers, expected_layers):
        if (
            layer.get("role") != role
            or layer.get("activation") != activation
            or layer.get("inputSize") != input_size
            or layer.get("outputSize") != output_size
        ):
            raise ValueError(f"frozen destination-state model layer contract mismatch for {role}")
        weights = np.asarray(layer.get("weights", []), dtype=np.float32)
        bias = np.asarray(layer.get("bias", []), dtype=np.float32)
        if weights.size != input_size * output_size or bias.size != output_size:
            raise ValueError(f"frozen destination-state model parameter shape mismatch for {role}")
        if not np.all(np.isfinite(weights)) or not np.all(np.isfinite(bias)):
            raise ValueError(f"frozen destination-state model parameters must be finite for {role}")
    return {
        "hiddenSize": hidden_size,
        "inputMean": input_mean,
        "inputScale": input_scale,
        "residualMean": residual_mean,
        "residualScale": residual_scale,
    }


def hydrate_frozen_destination_state_model_document(document):
    validated = validate_frozen_destination_state_model_document(document)
    model = DestinationStateModel(validated["hiddenSize"])
    targets = (model.trunk_a, model.trunk_b, model.residual)
    for target, layer in zip(targets, document["architecture"]["layers"]):
        output_size = int(layer["outputSize"])
        input_size = int(layer["inputSize"])
        target.weight = mx.array(np.asarray(layer["weights"], dtype=np.float32).reshape(output_size, input_size))
        target.bias = mx.array(np.asarray(layer["bias"], dtype=np.float32))
    mx.eval(model.parameters())
    return model, validated


def prediction_universe(source, grid_step, plan=None):
    plan = plan or local_grid_plan(source, grid_step)
    if plan["strategy"] == "sparse-key-lookup":
        keys = set()
        source_keys = set(source["keys"])
        for key in source["keys"]:
            keys.update(offset_key(key, delta, grid_step) for delta in DISPLACEMENTS)
        return sorted(key for key in keys if key not in source_keys)
    source_coordinates = plan["sourceCoordinates"]
    origin = plan["origin"]
    minimum = np.min(source_coordinates, axis=0) - 1
    maximum = np.max(source_coordinates, axis=0) + 1
    shape = tuple((maximum - minimum + 1).tolist())
    occupied = np.zeros(shape, dtype=bool)
    local = source_coordinates - minimum
    occupied[tuple(local.T)] = True
    expanded = np.zeros(shape, dtype=bool)
    for delta in DISPLACEMENTS:
        shifted = local + np.asarray(delta, dtype=np.int64)
        expanded[tuple(shifted.T)] = True
    expanded[tuple(local.T)] = False
    universe_coordinates = np.argwhere(expanded) + minimum
    positions = np.round(origin + universe_coordinates.astype(np.float64) * grid_step, POSITION_PRECISION)
    return [tuple(row) for row in positions.tolist()]


def compose_static_scaffold_claims(source, carrier_probabilities, grid_step, action_margin_threshold):
    carrier_probabilities = np.asarray(carrier_probabilities, dtype=np.float32)
    if carrier_probabilities.shape != (len(source["keys"]), DEATH_CLASS + 1):
        raise ValueError("carrier probabilities do not align with the scaffold source")
    if not math.isfinite(action_margin_threshold):
        raise ValueError("carrier action margin threshold must be finite")
    stable_class = displacement_class((0, 0, 0))
    claims = {}
    default_static_count = 0
    activated_transport_count = 0
    activated_death_count = 0
    action_count = 0
    for source_index, probabilities in enumerate(carrier_probabilities):
        action_probabilities = probabilities.copy()
        action_probabilities[stable_class] = -np.inf
        action_class = int(np.argmax(action_probabilities))
        action_margin = float(action_probabilities[action_class] - probabilities[stable_class])
        if action_margin < action_margin_threshold:
            class_index = stable_class
            score = float(probabilities[stable_class])
            default_static_count += 1
        else:
            class_index = action_class
            score = float(probabilities[action_class])
            action_count += 1
            if class_index == DEATH_CLASS:
                activated_death_count += 1
                continue
            activated_transport_count += 1
        target_key = offset_key(source["keys"][source_index], DISPLACEMENTS[class_index], grid_step)
        incumbent = claims.get(target_key)
        if incumbent is None or score > incumbent[0] or (score == incumbent[0] and source_index < incumbent[1]):
            claims[target_key] = (score, source_index, class_index)
    collision_count = len(source["keys"]) - activated_death_count - len(claims)
    return claims, {
        "compositionAuthority": "copied-static-scaffold-with-calibrated-carrier-actions-v0",
        "actionMarginThreshold": float(action_margin_threshold),
        "defaultStaticCount": default_static_count,
        "activatedActionCount": action_count,
        "activatedTransportCount": activated_transport_count,
        "activatedDeathCount": activated_death_count,
        "collisionCount": collision_count,
    }


def compose_eulerian_destination_occupancy(
    source,
    destination_keys,
    carrier_probabilities,
    occupancy_probabilities,
    grid_step,
    death_margin_threshold,
    birth_threshold,
    target_support_ratio,
    destination_inputs=None,
    target_support_budget=None,
):
    destination_keys = [stable_key(key) for key in destination_keys]
    carrier_probabilities = np.asarray(carrier_probabilities, dtype=np.float32)
    occupancy_probabilities = np.asarray(occupancy_probabilities, dtype=np.float32)
    if carrier_probabilities.shape != (len(destination_keys), DEATH_CLASS + 1):
        raise ValueError("Eulerian carrier probabilities do not align with destination cells")
    if occupancy_probabilities.shape != (len(destination_keys),):
        raise ValueError("Eulerian occupancy probabilities do not align with destination cells")
    if (
        not math.isfinite(death_margin_threshold)
        or death_margin_threshold < 0
        or not math.isfinite(birth_threshold)
        or not 0 <= birth_threshold <= 1
        or not math.isfinite(target_support_ratio)
        or target_support_ratio <= 0
    ):
        raise ValueError("Eulerian composition calibration is invalid")

    destination_inputs = (
        make_directional_inputs(destination_keys, source, grid_step)
        if destination_inputs is None
        else np.asarray(destination_inputs, dtype=np.float32)
    )
    if destination_inputs.shape != (len(destination_keys), 64):
        raise ValueError("Eulerian destination inputs do not align with destination cells")
    inverse_classes = np.asarray([
        displacement_class(tuple(-value for value in delta))
        for delta in DISPLACEMENTS
    ], dtype=np.int32)
    valid_donors = destination_inputs[:, 21 + inverse_classes] > 0.5
    donor_probabilities = np.where(valid_donors, carrier_probabilities[:, :DEATH_CLASS], -np.inf)
    best_classes = np.argmax(donor_probabilities, axis=1)
    best_scores = np.take_along_axis(donor_probabilities, best_classes[:, None], axis=1).squeeze(1)
    has_donor = np.isfinite(best_scores)
    source_present = destination_inputs[:, 4] > 0.5
    death_margins = carrier_probabilities[:, DEATH_CLASS] - best_scores
    activated_deaths = source_present & has_donor & (death_margins >= death_margin_threshold)
    scaffold_rows = np.flatnonzero(source_present & has_donor & ~activated_deaths)
    birth_rows = np.flatnonzero(
        ~source_present & has_donor & (occupancy_probabilities >= birth_threshold)
    )

    claims = {}
    for destination_index in scaffold_rows:
        key = destination_keys[destination_index]
        class_index = int(best_classes[destination_index])
        donor_key = offset_key(key, tuple(-value for value in DISPLACEMENTS[class_index]), grid_step)
        source_index = source["index"].get(donor_key)
        if source_index is None:
            raise ValueError("Eulerian scaffold selected a missing attribute donor")
        claims[key] = (float(best_scores[destination_index]), source_index, class_index, "scaffold")

    birth_candidates = []
    for destination_index in birth_rows:
        key = destination_keys[destination_index]
        class_index = int(best_classes[destination_index])
        donor_key = offset_key(key, tuple(-value for value in DISPLACEMENTS[class_index]), grid_step)
        source_index = source["index"].get(donor_key)
        if source_index is None:
            raise ValueError("Eulerian birth selected a missing attribute donor")
        birth_candidates.append((
            float(occupancy_probabilities[destination_index]),
            key,
            source_index,
            class_index,
        ))

    requested_target_support_budget = max(1, round(len(source["keys"]) * target_support_ratio))
    if target_support_budget is None:
        effective_target_support_budget = requested_target_support_budget
    elif not isinstance(target_support_budget, int) or target_support_budget <= 0:
        raise ValueError("Eulerian absolute support budget is invalid")
    else:
        effective_target_support_budget = target_support_budget
        if len(claims) > effective_target_support_budget:
            raise ValueError("Eulerian scaffold claims exceed the absolute support budget")
    birth_budget = max(0, effective_target_support_budget - len(claims))
    birth_candidates.sort(key=lambda row: (-row[0], row[1]))
    for occupancy, key, source_index, class_index in birth_candidates[:birth_budget]:
        claims[key] = (occupancy, source_index, class_index, "birth")

    rows = []
    features = []
    donor_classes = []
    stable_attribute_count = 0
    transported_attribute_count = 0
    selected_birth_count = 0
    if not claims:
        raise ValueError("Eulerian composition removed all support")
    for target_key, (_, source_index, class_index, kind) in sorted(claims.items()):
        row = source["splats"][source_index].copy()
        row[:3] = target_key
        rows.append(row)
        features.append(source["candidates"][source_index].copy())
        donor_classes.append(class_index)
        if DISPLACEMENTS[class_index] == (0, 0, 0):
            stable_attribute_count += 1
        else:
            transported_attribute_count += 1
        if kind == "birth":
            selected_birth_count += 1
    result = index_frame(np.asarray(features, dtype=np.float32), np.asarray(rows, dtype=np.float32))
    result["donorClasses"] = np.asarray(donor_classes, dtype=np.int32)
    return result, {
        "compositionAuthority": "copied-static-scaffold-with-eulerian-destination-occupancy-residual-v0",
        "sourceCount": len(source["keys"]),
        "predictedCount": len(result["keys"]),
        "destinationCandidateCount": len(destination_keys),
        "defaultStaticCount": len(scaffold_rows),
        "activatedDeathCount": int(np.sum(activated_deaths)),
        "stableAttributeCount": stable_attribute_count,
        "transportedAttributeCount": transported_attribute_count,
        "invalidDonorCount": int(np.sum(~has_donor)),
        "birthThreshold": float(birth_threshold),
        "deathMarginThreshold": float(death_margin_threshold),
        "requestedTargetSupportBudget": requested_target_support_budget,
        "targetSupportBudget": effective_target_support_budget,
        "supportBudgetClamped": effective_target_support_budget != requested_target_support_budget,
        "thresholdQualifiedBirthCount": len(birth_rows),
        "selectedBirthCount": selected_birth_count,
    }


def recurrent_predict(
    model,
    source,
    grid_step,
    input_mean,
    input_scale,
    birth_calibration,
    target_support_calibration,
    batch_size,
    action_calibration=None,
    destination_death_calibration=None,
    destination_state_bundle=None,
    target_support_budget=None,
):
    grid_plan = local_grid_plan(source, grid_step)
    if destination_death_calibration is not None:
        destination_keys = eulerian_destination_universe(source, grid_step, grid_plan)
        destination_inputs = make_directional_inputs(destination_keys, source, grid_step, grid_plan)
        carrier_probabilities, occupancy_probabilities = predict_model(
            model, destination_inputs, input_mean, input_scale, batch_size,
        )
        result, accounting = compose_eulerian_destination_occupancy(
            source,
            destination_keys,
            carrier_probabilities,
            occupancy_probabilities,
            grid_step,
            float(destination_death_calibration["threshold"]),
            float(birth_calibration["threshold"]),
            float(target_support_calibration["medianRatio"]),
            destination_inputs,
            target_support_budget,
        )
        accounting["gridLookup"] = {
            "authority": grid_plan["authority"],
            "strategy": grid_plan["strategy"],
            "boundingVolumeCells": grid_plan["boundingVolumeCells"],
            "denseCellBudget": grid_plan["denseCellBudget"],
        }
        if destination_state_bundle is not None:
            result, state_accounting = apply_frozen_destination_state_model(
                destination_state_bundle["model"],
                destination_state_bundle["normalization"],
                source,
                result,
                grid_step,
                batch_size,
            )
            accounting["destinationState"] = state_accounting
            accounting["compositionAuthority"] = (
                "eulerian-destination-occupancy-plus-frozen-destination-state-residual-v0"
            )
        return result, accounting
    carrier_inputs = make_directional_inputs(source["keys"], source, grid_step, grid_plan)
    carrier_probabilities, _ = predict_model(model, carrier_inputs, input_mean, input_scale, batch_size)
    scaffold_accounting = None
    if action_calibration is not None:
        claims, scaffold_accounting = compose_static_scaffold_claims(
            source,
            carrier_probabilities,
            grid_step,
            float(action_calibration["threshold"]),
        )
        death_count = scaffold_accounting["activatedDeathCount"]
        collision_count = scaffold_accounting["collisionCount"]
    else:
        claims = {}
        death_count = 0
        for source_index, probabilities in enumerate(carrier_probabilities):
            class_index = int(np.argmax(probabilities))
            if class_index == DEATH_CLASS:
                death_count += 1
                continue
            delta = DISPLACEMENTS[class_index]
            target_key = offset_key(source["keys"][source_index], delta, grid_step)
            score = float(probabilities[class_index])
            incumbent = claims.get(target_key)
            if incumbent is None or score > incumbent[0] or (score == incumbent[0] and source_index < incumbent[1]):
                claims[target_key] = (score, source_index, class_index)
        collision_count = sum(1 for probabilities in carrier_probabilities if int(np.argmax(probabilities)) != DEATH_CLASS) - len(claims)
    birth_keys = prediction_universe(source, grid_step, grid_plan)
    birth_inputs = make_directional_inputs(birth_keys, source, grid_step, grid_plan)
    _, birth_probabilities = predict_model(model, birth_inputs, input_mean, input_scale, batch_size)
    requested_target_support_budget = max(1, round(len(source["keys"]) * target_support_calibration["medianRatio"]))
    effective_target_support_budget = requested_target_support_budget if target_support_budget is None else target_support_budget
    if not isinstance(effective_target_support_budget, int) or effective_target_support_budget <= 0:
        raise ValueError("recurrent absolute support budget is invalid")
    if target_support_budget is not None and len(claims) > effective_target_support_budget:
        raise ValueError("recurrent carrier claims exceed the absolute support budget")
    selected_births = select_ranked_births(
        birth_keys,
        birth_probabilities,
        set(claims),
        effective_target_support_budget,
        len(claims),
    )
    threshold_qualified_birth_count = int(np.sum(birth_probabilities >= birth_calibration["threshold"]))
    rows = []
    features = []
    transported_count = 0
    stable_count = 0
    for target_key, (_, source_index, class_index) in sorted(claims.items()):
        row = source["splats"][source_index].copy()
        row[:3] = target_key
        rows.append(row)
        features.append(source["candidates"][source_index].copy())
        if DISPLACEMENTS[class_index] == (0, 0, 0):
            stable_count += 1
        else:
            transported_count += 1
    for target_key, probability in selected_births:
        local_sources = []
        for delta in DISPLACEMENTS:
            source_index = source["index"].get(offset_key(target_key, delta, grid_step))
            if source_index is not None:
                local_sources.append(source_index)
        if not local_sources:
            continue
        source_index = max(local_sources, key=lambda index: (source["candidates"][index, 0], -index))
        row = source["splats"][source_index].copy()
        row[:3] = target_key
        row[7] *= probability * max(0.05, birth_calibration["precision"])
        rows.append(row)
        features.append(source["candidates"][source_index].copy())
    result = index_frame(np.asarray(features, dtype=np.float32), np.asarray(rows, dtype=np.float32))
    accounting = {
        "sourceCount": len(source["keys"]),
        "predictedCount": len(result["keys"]),
        "stableCarrierCount": stable_count,
        "transportedCarrierCount": transported_count,
        "deathCount": death_count,
        "collisionCount": collision_count,
        "birthCandidateCount": len(birth_keys),
        "gridLookup": {
            "authority": grid_plan["authority"],
            "strategy": grid_plan["strategy"],
            "boundingVolumeCells": grid_plan["boundingVolumeCells"],
            "denseCellBudget": grid_plan["denseCellBudget"],
        },
        "birthSelectionAuthority": "training-target-count-calibrated-ranked-residual-birth-v0",
        "requestedTargetSupportBudget": requested_target_support_budget,
        "targetSupportBudget": effective_target_support_budget,
        "supportBudgetClamped": effective_target_support_budget != requested_target_support_budget,
        "thresholdQualifiedBirthCount": threshold_qualified_birth_count,
        "selectedBirthCount": len(result["keys"]) - len(claims),
    }
    if scaffold_accounting is not None:
        accounting["staticScaffold"] = scaffold_accounting
    else:
        accounting["compositionAuthority"] = "carrier-argmax-with-ranked-residual-birth-v0"
    return result, accounting


def support_metrics(source, prediction, exact):
    source_keys = set(source["keys"])
    prediction_keys = set(prediction["keys"])
    exact_keys = set(exact["keys"])
    def iou(left, right):
        return len(left & right) / max(1, len(left | right))
    return {
        "identityIoU": iou(source_keys, exact_keys),
        "predictionIoU": iou(prediction_keys, exact_keys),
        "beatsIdentity": iou(prediction_keys, exact_keys) > iou(source_keys, exact_keys),
        "predictionToIdentityRatio": iou(prediction_keys, exact_keys) / max(1e-12, iou(source_keys, exact_keys)),
        "exactCount": len(exact_keys),
        "predictionCount": len(prediction_keys),
    }


def apply_destination_state_residuals(carried, residuals):
    residuals = np.asarray(residuals, dtype=np.float32)
    if residuals.shape != (len(carried["keys"]), DESTINATION_STATE_ATTRIBUTE_COUNT):
        raise ValueError("destination-state residuals must align with carried support and attributes")
    if not np.all(np.isfinite(residuals)):
        raise ValueError("destination-state residuals must be finite")
    candidates = carried["candidates"].copy()
    splats = carried["splats"].copy()
    candidates += residuals[:, :len(FEATURES)]
    splats[:, 3:] += residuals[:, len(FEATURES):]
    return index_frame(candidates, splats)


def apply_frozen_destination_state_model(
    model,
    normalization,
    source,
    carried,
    grid_step,
    batch_size,
):
    donor_classes = carried.get("donorClasses")
    if donor_classes is None:
        raise ValueError("predicted support lacks destination-state donor provenance")
    inputs = build_destination_state_inference_inputs(source, carried, donor_classes, grid_step)
    residuals = predict_destination_state_model(
        model,
        inputs,
        normalization["inputMean"],
        normalization["inputScale"],
        normalization["residualMean"],
        normalization["residualScale"],
        batch_size,
    )
    predicted = apply_destination_state_residuals(carried, residuals)
    return predicted, {
        "authority": "frozen-destination-state-residual-on-predicted-support-v0",
        "updatedCount": len(predicted["keys"]),
        "supportChanged": predicted["keys"] != carried["keys"],
        "meanAbsoluteResidual": float(np.mean(np.abs(residuals), dtype=np.float64)),
        "maximumAbsoluteResidual": float(np.max(np.abs(residuals))),
    }


def apply_protected_splat_destination_state_model(
    model,
    normalization,
    canonical_source,
    appearance_source,
    carried,
    grid_step,
    batch_size,
):
    if set(appearance_source["keys"]) != set(canonical_source["keys"]):
        raise ValueError("protected appearance support must match canonical support")
    donor_classes = carried.get("donorClasses")
    if donor_classes is None:
        raise ValueError("protected carried support lacks destination-state donor provenance")
    donor_classes = np.asarray(donor_classes, dtype=np.int32)
    if donor_classes.shape != (len(carried["keys"]),):
        raise ValueError("protected donor classes must align with carried support")

    appearance_splats = carried["splats"].copy()
    for target_index, (target_key, class_index) in enumerate(zip(carried["keys"], donor_classes)):
        if class_index < 0 or class_index >= DEATH_CLASS:
            raise ValueError("protected donor classes must name a local displacement")
        donor_key = offset_key(
            target_key,
            tuple(-value for value in DISPLACEMENTS[int(class_index)]),
            grid_step,
        )
        appearance_index = appearance_source["index"].get(donor_key)
        if appearance_index is None:
            raise ValueError("protected appearance source lacks the canonical donor")
        appearance_splats[target_index, 3:] = appearance_source["splats"][appearance_index, 3:]

    appearance_carried = index_frame(carried["candidates"].copy(), appearance_splats)
    inputs = build_destination_state_inference_inputs(
        canonical_source,
        appearance_carried,
        donor_classes,
        grid_step,
    )
    residuals = predict_destination_state_model(
        model,
        inputs,
        normalization["inputMean"],
        normalization["inputScale"],
        normalization["residualMean"],
        normalization["residualScale"],
        batch_size,
    )
    predicted_splats = appearance_carried["splats"].copy()
    predicted_splats[:, 3:] += residuals[:, len(FEATURES):]
    predicted = index_frame(carried["candidates"].copy(), predicted_splats)
    splat_residuals = residuals[:, len(FEATURES):]
    return predicted, {
        "authority": "protected-canonical-candidate-splat-only-recurrence-v0",
        "updatedCount": len(predicted["keys"]),
        "supportChanged": predicted["keys"] != carried["keys"],
        "candidateStateProtected": True,
        "occupancyFeedbackEnabled": False,
        "meanAbsoluteSplatResidual": float(np.mean(np.abs(splat_residuals), dtype=np.float64)),
        "maximumAbsoluteSplatResidual": float(np.max(np.abs(splat_residuals))),
    }


def protected_splat_recurrent_predict(
    model,
    canonical_source,
    appearance_source,
    grid_step,
    input_mean,
    input_scale,
    birth_calibration,
    target_support_calibration,
    batch_size,
    destination_death_calibration,
    destination_state_bundle,
    target_support_budget=None,
):
    if destination_death_calibration is None or destination_state_bundle is None:
        raise ValueError("protected splat recurrence requires Eulerian occupancy and destination-state models")
    canonical_next, accounting = recurrent_predict(
        model,
        canonical_source,
        grid_step,
        input_mean,
        input_scale,
        birth_calibration,
        target_support_calibration,
        batch_size,
        destination_death_calibration=destination_death_calibration,
        target_support_budget=target_support_budget,
    )
    appearance_next, state_accounting = apply_protected_splat_destination_state_model(
        destination_state_bundle["model"],
        destination_state_bundle["normalization"],
        canonical_source,
        appearance_source,
        canonical_next,
        grid_step,
        batch_size,
    )
    accounting["destinationState"] = state_accounting
    accounting["compositionAuthority"] = "protected-occupancy-with-splat-only-state-recurrence-v0"
    return canonical_next, appearance_next, accounting


def summarize_count_drift_gate(source_count, exact_counts, predicted_counts):
    source_count = int(source_count)
    exact_counts = [int(value) for value in exact_counts]
    predicted_counts = [int(value) for value in predicted_counts]
    if source_count <= 0 or not exact_counts or len(exact_counts) != len(predicted_counts):
        raise ValueError("count-drift gate requires positive source support and aligned nonempty episodes")
    if any(value <= 0 for value in exact_counts) or any(value < 0 for value in predicted_counts):
        raise ValueError("count-drift gate received invalid support counts")
    steps = []
    for step, (exact_count, predicted_count) in enumerate(zip(exact_counts, predicted_counts), start=1):
        predicted_error = abs(predicted_count - exact_count)
        identity_error = abs(source_count - exact_count)
        steps.append({
            "step": step,
            "sourceCount": source_count,
            "exactCount": exact_count,
            "predictedCount": predicted_count,
            "predictedCountError": predicted_error,
            "identityCountError": identity_error,
            "predictedToExactRatio": predicted_count / exact_count,
            "notWorseThanIdentity": predicted_error <= identity_error,
        })
    worse_steps = [row["step"] for row in steps if not row["notWorseThanIdentity"]]
    return {
        "authority": "every-recurrent-step-count-drift-versus-identity-v0",
        "evaluatedStepCount": len(steps),
        "steps": steps,
        "firstWorseThanIdentityStep": worse_steps[0] if worse_steps else None,
        "allStepsNotWorseThanIdentity": not worse_steps,
        "maximumAbsolutePredictedCountError": max(row["predictedCountError"] for row in steps),
        "maximumPredictedToExactRatio": max(row["predictedToExactRatio"] for row in steps),
        "stepsMayBeTruncated": False,
        "manualToleranceApplied": False,
    }


def summarize_destination_state_metrics(baselines, predictions, targets, cohorts, target_scale):
    baselines = np.asarray(baselines, dtype=np.float32)
    predictions = np.asarray(predictions, dtype=np.float32)
    targets = np.asarray(targets, dtype=np.float32)
    cohorts = np.asarray(cohorts)
    target_scale = np.asarray(target_scale, dtype=np.float32)
    expected_shape = (len(cohorts), DESTINATION_STATE_ATTRIBUTE_COUNT)
    if baselines.shape != expected_shape or predictions.shape != expected_shape or targets.shape != expected_shape:
        raise ValueError("destination-state metrics require aligned 25-attribute rows")
    if target_scale.shape != (DESTINATION_STATE_ATTRIBUTE_COUNT,) or np.any(target_scale <= 0):
        raise ValueError("destination-state metrics require a positive training target scale")
    if not all(np.all(np.isfinite(values)) for values in (baselines, predictions, targets, target_scale)):
        raise ValueError("destination-state metrics require finite values")
    if np.any(~np.isin(cohorts, DESTINATION_STATE_COHORTS)):
        raise ValueError("destination-state metrics received a non-motion cohort")

    def metric_rows(indices):
        baseline_error = (baselines[indices] - targets[indices]) / target_scale
        prediction_error = (predictions[indices] - targets[indices]) / target_scale
        donor_mse = float(np.mean(baseline_error ** 2, dtype=np.float64))
        prediction_mse = float(np.mean(prediction_error ** 2, dtype=np.float64))
        candidate_donor_mse = float(np.mean(baseline_error[:, :len(FEATURES)] ** 2, dtype=np.float64))
        candidate_prediction_mse = float(np.mean(prediction_error[:, :len(FEATURES)] ** 2, dtype=np.float64))
        splat_donor_mse = float(np.mean(baseline_error[:, len(FEATURES):] ** 2, dtype=np.float64))
        splat_prediction_mse = float(np.mean(prediction_error[:, len(FEATURES):] ** 2, dtype=np.float64))
        return {
            "sampleCount": int(len(indices)),
            "carriedDonorMse": donor_mse,
            "predictionMse": prediction_mse,
            "predictionToDonorMseRatio": prediction_mse / max(donor_mse, 1e-12),
            "beatsCarriedDonor": prediction_mse < donor_mse,
            "candidateCarriedDonorMse": candidate_donor_mse,
            "candidatePredictionMse": candidate_prediction_mse,
            "splatCarriedDonorMse": splat_donor_mse,
            "splatPredictionMse": splat_prediction_mse,
        }

    cohort_metrics = {}
    for cohort in DESTINATION_STATE_COHORTS:
        indices = np.flatnonzero(cohorts == cohort)
        if not len(indices):
            raise ValueError(f"destination-state metrics require populated cohort {cohort}")
        cohort_metrics[cohort] = metric_rows(indices)
    aggregate = metric_rows(np.arange(len(cohorts)))
    return {
        "authority": "cross-episode-state-mse-versus-carried-donor-v0",
        "normalizationAuthority": "training-residual-channel-standard-deviation-v0",
        "aggregate": aggregate,
        "cohorts": cohort_metrics,
        "allCohortsBeatCarriedDonor": all(
            cohort_metrics[cohort]["beatsCarriedDonor"]
            for cohort in DESTINATION_STATE_COHORTS
        ),
        "aggregateMayCloseCohortClaim": False,
    }


def summarize_rollout_gate(metrics):
    if not metrics:
        raise ValueError("rollout gate requires at least one recurrent step")
    beat_steps = [row for row in metrics if row.get("beatsIdentity") is True]
    loss_steps = [int(row["step"]) for row in metrics if row.get("beatsIdentity") is not True]
    return {
        "authority": "every-recurrent-step-support-advantage-gate-v0",
        "evaluatedStepCount": len(metrics),
        "beatStepCount": len(beat_steps),
        "firstIdentityLossStep": min(loss_steps) if loss_steps else None,
        "allStepsBeatIdentity": len(beat_steps) == len(metrics),
        "minimumPredictionToIdentityRatio": min(float(row["predictionToIdentityRatio"]) for row in metrics),
        "aggregateOrEarlyStepCanCloseClaim": False,
    }


def validate_state_recurrence_mode(mode, has_transport_model, has_state_model, objective_family):
    if mode not in STATE_RECURRENCE_MODES:
        raise ValueError("state recurrence mode is unsupported")
    if mode == "protected-splat":
        if not has_transport_model:
            raise ValueError("protected splat recurrence requires a frozen transport model")
        if not has_state_model:
            raise ValueError("protected splat recurrence requires a destination-state model")
        if objective_family != EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
            raise ValueError("protected splat recurrence requires the Eulerian occupancy objective")
    return {
        "authority": "explicit-state-recurrence-mode-v0",
        "mode": mode,
        "occupancyFeedbackEnabled": mode == "coupled" and bool(has_state_model),
        "candidateStateProtected": mode == "protected-splat",
        "splatAppearanceRecurrent": mode == "protected-splat" and bool(has_state_model),
    }


def write_frame_artifacts(out_dir, label, frame):
    feature_path = out_dir / f"{label}.features.f32"
    splat_path = out_dir / f"{label}.splats.f32"
    feature_bytes = np.asarray(frame["candidates"], dtype="<f4").tobytes()
    splat_bytes = np.asarray(frame["splats"], dtype="<f4").tobytes()
    feature_path.write_bytes(feature_bytes)
    splat_path.write_bytes(splat_bytes)
    return {
        "candidates": {
            "path": str(feature_path), "bytes": len(feature_bytes), "sha256": sha256_bytes(feature_bytes),
            "count": len(frame["keys"]), "strideFloats": 16, "dtype": "float32-le",
        },
        "splats": {
            "path": str(splat_path), "bytes": len(splat_bytes), "sha256": sha256_bytes(splat_bytes),
            "count": len(frame["keys"]), "strideFloats": 12, "dtype": "float32-le",
            "authority": "learned-local-grid-transport-plus-residual-churn-v0",
        },
    }


def build_prediction_document(
    *, inference_manifest, training_manifest, model, route, temporal, frames, recurrent, support_metrics,
    state_model=None, state_recurrence=None, count_drift_gate=None, support_budget=None,
):
    return {
        "schema": PREDICTION_SCHEMA,
        "status": "completed",
        "manifest": inference_manifest,
        "modelTrainingManifest": training_manifest,
        "model": model,
        **({"destinationStateModel": state_model} if state_model is not None else {}),
        **({"stateRecurrence": state_recurrence} if state_recurrence is not None else {}),
        **({"supportBudget": support_budget} if support_budget is not None else {}),
        "route": route,
        "temporal": temporal,
        "frames": frames,
        "recurrent": recurrent,
        "supportMetrics": support_metrics,
        "rolloutGate": summarize_rollout_gate(support_metrics) if support_metrics else None,
        "countDriftGate": count_drift_gate,
        "claimBoundary": (
            "isolated protected occupancy recurrence with splat-only destination-state residuals; "
            "candidate state cannot feed occupancy; no live renderer or instancing integration"
            if state_recurrence is not None and state_recurrence.get("mode") == "protected-splat"
            else "isolated recurrent one-cell transport with frozen destination-state residuals on predicted support; "
            "no live renderer or instancing integration"
            if state_model is not None
            else "isolated recurrent one-cell transport with carried candidate attributes and locally synthesized residual births; no live renderer or instancing integration"
        ),
    }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--model", default="")
    parser.add_argument("--rollout-seed-model", default="")
    parser.add_argument("--rollout-seed-model-sha256", default="")
    parser.add_argument("--state-model", default="")
    parser.add_argument("--state-recurrence-mode", choices=STATE_RECURRENCE_MODES, default="coupled")
    parser.add_argument("--support-budget-mode", choices=SUPPORT_BUDGET_MODES, default="one-step-ratio")
    parser.add_argument("--inference-start", type=int, default=0)
    parser.add_argument("--inference-steps", type=int, default=0)
    parser.add_argument("--holdout-start", type=int, default=6)
    parser.add_argument("--holdout-steps", type=int, default=3)
    parser.add_argument("--grid-size", type=int, default=0)
    parser.add_argument("--hidden-size", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=0.0015)
    parser.add_argument("--weight-decay", type=float, default=0.0001)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument(
        "--objective-family",
        choices=(
            LEGACY_OBJECTIVE_FAMILY,
            MOTION_BALANCED_OBJECTIVE_FAMILY,
            EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY,
        ),
        default=LEGACY_OBJECTIVE_FAMILY,
    )
    return parser.parse_args()


def main():
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "training-report.json"
    failure_phase = "argument-validation"
    last_trustworthy = {"manifestPath": str(Path(args.manifest).resolve())}
    started_at = time.time()
    try:
        if args.holdout_steps < 1 or args.hidden_size < 1 or args.epochs < 1 or args.batch_size < 1:
            raise ValueError("holdout, model, epoch, and batch dimensions must be positive")
        if bool(args.rollout_seed_model) != bool(args.rollout_seed_model_sha256):
            raise ValueError("rollout seed model path and expected SHA-256 must be supplied together")
        if args.rollout_seed_model and args.model:
            raise ValueError("rollout seed model is valid only during training")
        if args.rollout_seed_model and args.objective_family != EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
            raise ValueError("rollout seed model requires the Eulerian occupancy objective")
        if args.state_model and not args.model:
            raise ValueError("destination-state model is valid only during frozen transport inference")
        if args.support_budget_mode != "one-step-ratio" and not args.model:
            raise ValueError("training-episode support envelope is valid only during frozen model inference")
        failure_phase = "manifest-validation"
        manifest_path = Path(args.manifest).resolve()
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        if manifest.get("schema") != "kaminos-boundary-splat-phase-candidate-corpus-v0":
            raise ValueError("transport trainer requires the phase candidate corpus schema")
        if manifest.get("featureOrder") != list(FEATURES):
            raise ValueError("transport trainer requires the exact deployed 16-feature candidate contract")
        if manifest.get("effectiveRoute") != "native-3d-compute-fluid-raymarch-v0":
            raise ValueError("transport trainer effective corpus route mismatch")
        frames_docs = sorted(manifest.get("frames", []), key=lambda frame: int(frame.get("controlledStepFrameIndex", -1)))
        indices = [int(frame.get("controlledStepFrameIndex", -1)) for frame in frames_docs]
        if indices != list(range(len(frames_docs))):
            raise ValueError("transport trainer requires a contiguous controlled-step frame sequence")
        if args.model:
            inference_steps = args.inference_steps or (len(frames_docs) - args.inference_start - 1)
            if args.inference_start < 0 or inference_steps < 1:
                raise ValueError("frozen inference start and step count must select a nonempty forward episode")
            inference_indices = list(range(args.inference_start, args.inference_start + inference_steps + 1))
            if not set(inference_indices).issubset(indices):
                raise ValueError("requested frozen inference episode exceeds the corpus")
            holdout_indices = set(inference_indices)
            training_pairs = []
        else:
            holdout_indices = set(range(args.holdout_start, args.holdout_start + args.holdout_steps + 1))
            if not holdout_indices.issubset(indices):
                raise ValueError("requested holdout episode exceeds the corpus")
            training_pairs = [
                (left, right)
                for left, right in zip(frames_docs, frames_docs[1:])
                if int(left["controlledStepFrameIndex"]) not in holdout_indices
                and int(right["controlledStepFrameIndex"]) not in holdout_indices
            ]
            if len(training_pairs) < 2:
                raise ValueError("transport trainer requires at least two non-holdout adjacent pairs")
        query = parse_qs(urlparse(manifest.get("requestedRoute", "")).query)
        grid_size = args.grid_size or int(query.get("volume_resolution", [160])[0])
        grid_step = 2.0 / grid_size
        failure_phase = "artifact-validation"
        frames = {frame["id"]: load_frame(frame, manifest_path.parent) for frame in frames_docs}
        last_trustworthy.update({
            "manifestSha256": sha256_bytes(manifest_bytes),
            "effectiveRoute": manifest.get("effectiveRoute"),
            "validatedFrameCount": len(frames),
            "mode": "frozen-model-inference" if args.model else "train-and-heldout-inference",
            "trainingPairIds": [f"{left['id']}->{right['id']}" for left, right in training_pairs],
            "holdoutFrameIds": [frames_docs[index]["id"] for index in sorted(holdout_indices)],
        })
        manifest_receipt = {
            "path": str(manifest_path),
            "bytes": len(manifest_bytes),
            "sha256": sha256_bytes(manifest_bytes),
        }
        rollout_seed_bundle = None
        if args.rollout_seed_model:
            failure_phase = "rollout-seed-model-validation"
            rollout_seed_bundle = load_rollout_seed_model(
                args.rollout_seed_model,
                args.rollout_seed_model_sha256,
                manifest_receipt,
                args.objective_family,
                args.hidden_size,
            )
            last_trustworthy.update({
                "rolloutSeedModelPath": rollout_seed_bundle["receipt"]["path"],
                "rolloutSeedModelSha256": rollout_seed_bundle["receipt"]["sha256"],
                "rolloutSeedTrainingManifestSha256": rollout_seed_bundle["receipt"]["trainingManifestSha256"],
                "rolloutSeedNormalizationAuthority": rollout_seed_bundle["receipt"]["normalizationAuthority"],
            })
        if args.model:
            failure_phase = "frozen-model-validation"
            model_path = Path(args.model).resolve()
            model_bytes = model_path.read_bytes()
            frozen_model_document = json.loads(model_bytes)
            frozen_model, input_mean, input_scale = hydrate_frozen_model_document(frozen_model_document)
            model_receipt = {"path": str(model_path), "sha256": sha256_bytes(model_bytes), "schema": MODEL_SCHEMA}
            last_trustworthy.update({
                "modelPath": str(model_path),
                "modelSha256": model_receipt["sha256"],
                "modelTrainingManifest": frozen_model_document["manifest"],
            })
            objective_family = frozen_model_document.get("training", {}).get("objectiveFamily", LEGACY_OBJECTIVE_FAMILY)
            destination_state_bundle = None
            state_model_receipt = None
            if args.state_model:
                if objective_family != EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
                    raise ValueError("destination-state inference requires the Eulerian occupancy objective")
                state_model_path = Path(args.state_model).resolve()
                state_model_bytes = state_model_path.read_bytes()
                state_model_document = json.loads(state_model_bytes)
                state_model, state_normalization = hydrate_frozen_destination_state_model_document(state_model_document)
                state_model_receipt = {
                    "path": str(state_model_path),
                    "sha256": sha256_bytes(state_model_bytes),
                    "schema": DESTINATION_STATE_MODEL_SCHEMA,
                    "trainingManifest": state_model_document.get("trainingManifest"),
                    "evaluationManifest": state_model_document.get("evaluationManifest"),
                }
                destination_state_bundle = {
                    "model": state_model,
                    "normalization": state_normalization,
                }
                last_trustworthy.update({
                    "destinationStateModelPath": str(state_model_path),
                    "destinationStateModelSha256": state_model_receipt["sha256"],
                })
            state_recurrence = validate_state_recurrence_mode(
                args.state_recurrence_mode,
                has_transport_model=True,
                has_state_model=destination_state_bundle is not None,
                objective_family=objective_family,
            )
            last_trustworthy["stateRecurrence"] = state_recurrence
            failure_phase = "route-validation"
            device = str(mx.default_device())
            if not device.lower().startswith("device(gpu"):
                raise RuntimeError(f"frozen transport inference requires MLX GPU, effective device was {device}")
            route = {"backend": "mlx", "device": device, "effectiveRunner": sys.executable, "fallbackReason": None}
            failure_phase = "frozen-recurrent-inference"
            inference_docs = [frames_docs[index] for index in sorted(holdout_indices)]
            current = frames[inference_docs[0]["id"]]
            canonical_current = current
            appearance_current = current
            prediction_frames = [current]
            recurrent_rows = []
            inference_metrics = []
            birth_calibration = frozen_model_document["calibration"]["birth"]
            target_support_calibration = frozen_model_document["calibration"]["targetSupport"]
            training_support_envelope = (
                load_training_support_envelope(frozen_model_document["manifest"])
                if args.support_budget_mode == "training-episode-envelope"
                else None
            )
            inference_frame_zero = {
                "referenceFrameId": inference_docs[0]["id"],
                "count": len(prediction_frames[0]["keys"]),
            }
            training_manifest_sha256 = frozen_model_document["manifest"]["sha256"]
            support_budget_contract = {
                "authority": "explicit-recurrent-support-budget-mode-v0",
                "mode": args.support_budget_mode,
                "inferenceInitialCount": len(prediction_frames[0]["keys"]),
                "inferenceFrameZero": inference_frame_zero,
                "trainingManifestSha256": training_manifest_sha256,
                "trainingEnvelope": training_support_envelope,
                "legacyBehaviorPreservedByDefault": args.support_budget_mode == "one-step-ratio",
            }
            last_trustworthy["supportBudget"] = support_budget_contract
            action_calibration = (
                frozen_model_document["calibration"]["carrierAction"]
                if objective_family == MOTION_BALANCED_OBJECTIVE_FAMILY
                else None
            )
            destination_death_calibration = (
                frozen_model_document["calibration"]["destinationDeath"]
                if objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
                else None
            )
            for step_index in range(1, len(inference_docs)):
                support_budget = resolve_recurrent_support_budget(
                    args.support_budget_mode,
                    len(prediction_frames[0]["keys"]),
                    len(canonical_current["keys"] if state_recurrence["mode"] == "protected-splat" else current["keys"]),
                    float(target_support_calibration["medianRatio"]),
                    training_support_envelope,
                    training_manifest_sha256,
                    inference_frame_zero,
                )
                absolute_support_budget = (
                    support_budget["effectiveBudget"]
                    if args.support_budget_mode == "training-episode-envelope"
                    else None
                )
                if state_recurrence["mode"] == "protected-splat":
                    canonical_current, predicted, recurrent = protected_splat_recurrent_predict(
                        frozen_model,
                        canonical_current,
                        appearance_current,
                        grid_step,
                        input_mean,
                        input_scale,
                        birth_calibration,
                        target_support_calibration,
                        args.batch_size,
                        destination_death_calibration,
                        destination_state_bundle,
                        absolute_support_budget,
                    )
                    appearance_current = predicted
                else:
                    predicted, recurrent = recurrent_predict(
                        frozen_model,
                        current,
                        grid_step,
                        input_mean,
                        input_scale,
                        birth_calibration,
                        target_support_calibration,
                        args.batch_size,
                        action_calibration,
                        destination_death_calibration,
                        destination_state_bundle,
                        absolute_support_budget,
                    )
                    current = predicted
                exact = frames[inference_docs[step_index]["id"]]
                recurrent_rows.append({"step": step_index, **recurrent, "supportBudget": support_budget})
                inference_metrics.append({"step": step_index, **support_metrics(prediction_frames[0], predicted, exact)})
                prediction_frames.append(predicted)
            failure_phase = "prediction-write"
            prediction_docs = []
            for step_index, (frame_doc, predicted) in enumerate(zip(inference_docs, prediction_frames)):
                artifacts = write_frame_artifacts(out_dir, f"prediction-step-{step_index:02d}", predicted)
                prediction_docs.append({
                    "step": step_index,
                    "referenceFrameId": frame_doc["id"],
                    "controlFrameId": inference_docs[0]["id"],
                    **artifacts,
                })
            training_manifest = frozen_model_document["manifest"]
            count_drift_gate = summarize_count_drift_gate(
                len(prediction_frames[0]["keys"]),
                [row["exactCount"] for row in inference_metrics],
                [row["predictionCount"] for row in inference_metrics],
            )
            prediction_artifact = build_prediction_document(
                inference_manifest=manifest_receipt,
                training_manifest=training_manifest,
                model=model_receipt,
                route=route,
                temporal={
                    "authority": "frozen-model-recurrent-one-controlled-step-local-grid-continuation-v0",
                    "controlledStepDeltaMs": int(inference_docs[0].get("controlledStepDeltaMs", 160)),
                    "sourceFrameId": inference_docs[0]["id"],
                    "heldoutReferenceFrameIds": [frame["id"] for frame in inference_docs],
                    "trainingFrameIdsExcluded": [frame["id"] for frame in inference_docs],
                    "inferenceCorpusSeenDuringTraining": training_manifest.get("sha256") == manifest_receipt["sha256"],
                },
                frames=prediction_docs,
                recurrent=recurrent_rows,
                support_metrics=inference_metrics,
                state_model=state_model_receipt,
                state_recurrence=state_recurrence,
                count_drift_gate=count_drift_gate,
                support_budget=support_budget_contract,
            )
            prediction_path = out_dir / "transport-predictions.json"
            write_json(prediction_path, prediction_artifact)
            failure_phase = "report-write"
            report = {
                "schema": SCHEMA,
                "status": "completed",
                "mode": "frozen-model-inference",
                "startedAt": started_at,
                "completedAt": time.time(),
                "route": route,
                "manifest": manifest_receipt,
                "modelTrainingManifest": training_manifest,
                "model": model_receipt,
                **({"destinationStateModel": state_model_receipt} if state_model_receipt is not None else {}),
                "predictions": {"path": str(prediction_path), "sha256": sha256_bytes(prediction_path.read_bytes())},
                "holdoutMetrics": inference_metrics,
                "rolloutGate": summarize_rollout_gate(inference_metrics),
                "countDriftGate": count_drift_gate,
                "supportBudget": support_budget_contract,
                "recurrent": recurrent_rows,
            }
            write_json(report_path, report)
            print(json.dumps(report, indent=2))
            return
        failure_phase = "dataset-construction"
        seed_predict_step = None
        if rollout_seed_bundle is not None:
            seed_document = rollout_seed_bundle["document"]

            def seed_predict_step(source, _source_reference_frame_id, _rollout_depth):
                return recurrent_predict(
                    rollout_seed_bundle["model"],
                    source,
                    grid_step,
                    rollout_seed_bundle["inputMean"],
                    rollout_seed_bundle["inputScale"],
                    seed_document["calibration"]["birth"],
                    seed_document["calibration"]["targetSupport"],
                    args.batch_size,
                    destination_death_calibration=seed_document["calibration"]["destinationDeath"],
                )

        datasets, pair_reports, rollout_exposure = build_transport_training_exposure(
            training_pairs,
            frames,
            grid_step,
            args.objective_family,
            seed_predict_step,
        )
        last_trustworthy.update({
            "trainingExposureAuthority": (
                rollout_exposure["authority"]
                if rollout_exposure is not None
                else "exact-adjacent-corpus-pairs-only-v0"
            ),
            "trainingExposurePairCount": len(pair_reports),
            "trainingExposureSampleCap": None,
        })
        carrier_inputs = np.concatenate([dataset["carrierInputs"] for dataset in datasets])
        carrier_labels = np.concatenate([dataset["carrierLabels"] for dataset in datasets])
        carrier_cohorts = np.concatenate([dataset["carrierCohorts"] for dataset in datasets])
        birth_inputs = np.concatenate([dataset["birthInputs"] for dataset in datasets])
        birth_labels = np.concatenate([dataset["birthLabels"] for dataset in datasets])
        source_destination_mask = (
            np.concatenate([dataset["sourceDestinationMask"] for dataset in datasets])
            if args.objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
            else None
        )
        raw_carrier_inputs = carrier_inputs
        if rollout_seed_bundle is not None:
            input_mean = rollout_seed_bundle["inputMean"].copy()
            input_scale = rollout_seed_bundle["inputScale"].copy()
            normalization_authority = "frozen-seed-model-input-normalization-v0"
        else:
            all_inputs = np.concatenate((carrier_inputs, birth_inputs))
            input_mean = np.mean(all_inputs, axis=0, dtype=np.float64).astype(np.float32)
            input_scale = np.std(all_inputs, axis=0, dtype=np.float64).astype(np.float32)
            input_scale[input_scale < 1e-6] = 1.0
            normalization_authority = "combined-training-population-channel-standardization-v0"
        carrier_inputs = ((carrier_inputs - input_mean) / input_scale).astype(np.float32)
        birth_inputs = ((birth_inputs - input_mean) / input_scale).astype(np.float32)
        class_counts = np.bincount(carrier_labels, minlength=DEATH_CLASS + 1).astype(np.float32)
        if args.objective_family == MOTION_BALANCED_OBJECTIVE_FAMILY:
            class_weights = np.ones(DEATH_CLASS + 1, dtype=np.float32)
            birth_positive_weight = 1.0
            carrier_sampling_pools = build_motion_sampling_pools(carrier_cohorts)
            birth_sampling_pools = build_binary_sampling_pools(birth_labels)
        elif args.objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
            class_weights = np.ones(DEATH_CLASS + 1, dtype=np.float32)
            birth_positive_weight = 1.0
            carrier_sampling_pools = build_eulerian_sampling_pools(carrier_cohorts)
            birth_sampling_pools = build_binary_sampling_pools(birth_labels)
        else:
            class_weights = np.sqrt(np.sum(class_counts) / np.maximum(class_counts, 1.0))
            class_weights /= np.mean(class_weights)
            birth_positive_weight = float(np.sum(birth_labels == 0) / max(1, np.sum(birth_labels > 0.5)))
            carrier_sampling_pools = None
            birth_sampling_pools = None
        failure_phase = "route-validation"
        device = str(mx.default_device())
        if not device.lower().startswith("device(gpu"):
            raise RuntimeError(f"transport trainer requires MLX GPU, effective device was {device}")
        failure_phase = "model-training"
        rng = np.random.default_rng(args.seed)
        mx.random.seed(args.seed)
        model = (
            rollout_seed_bundle["model"]
            if rollout_seed_bundle is not None
            else TransportModel(args.hidden_size)
        )
        mx.eval(model.parameters())
        optimizer = optim.AdamW(learning_rate=args.learning_rate, weight_decay=args.weight_decay)
        loss_and_grad = nn.value_and_grad(model, weighted_loss)
        steps_per_epoch = max(math.ceil(len(carrier_inputs) / args.batch_size), math.ceil(len(birth_inputs) / args.batch_size))
        step_count = steps_per_epoch * args.epochs
        losses = []
        for step in range(step_count):
            if args.objective_family == MOTION_BALANCED_OBJECTIVE_FAMILY:
                carrier_indices = sample_motion_balanced_indices(rng, carrier_sampling_pools, args.batch_size)
                birth_indices = sample_binary_balanced_indices(rng, birth_sampling_pools, args.batch_size)
            elif args.objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
                carrier_indices = sample_eulerian_balanced_indices(rng, carrier_sampling_pools, args.batch_size)
                birth_indices = sample_binary_balanced_indices(rng, birth_sampling_pools, args.batch_size)
            else:
                carrier_indices = rng.integers(0, len(carrier_inputs), size=min(args.batch_size, len(carrier_inputs)))
                birth_indices = rng.integers(0, len(birth_inputs), size=min(args.batch_size, len(birth_inputs)))
            (loss, components), gradients = loss_and_grad(
                model,
                mx.array(carrier_inputs[carrier_indices]),
                mx.array(carrier_labels[carrier_indices]),
                mx.array(birth_inputs[birth_indices]),
                mx.array(birth_labels[birth_indices]),
                mx.array(class_weights),
                mx.array(birth_positive_weight),
            )
            optimizer.update(model, gradients)
            mx.eval(model.parameters(), optimizer.state, loss, components)
            if step == 0 or step == step_count - 1 or (step + 1) % steps_per_epoch == 0:
                losses.append({
                    "step": step + 1,
                    "total": float(loss.item()),
                    "carrier": float(components[0].item()),
                    "birth": float(components[1].item()),
                })
        failure_phase = "training-calibration"
        carrier_probabilities, _ = predict_model(model, (carrier_inputs * input_scale) + input_mean, input_mean, input_scale, args.batch_size)
        _, birth_probabilities = predict_model(model, (birth_inputs * input_scale) + input_mean, input_mean, input_scale, args.batch_size)
        carrier_training_metrics = carrier_metrics(carrier_probabilities, carrier_labels)
        birth_calibration = calibrate_birth(birth_probabilities, birth_labels)
        target_support_calibration = calibrate_target_support_ratio(pair_reports)
        action_calibration = (
            calibrate_action_margin(carrier_probabilities, carrier_labels)
            if args.objective_family == MOTION_BALANCED_OBJECTIVE_FAMILY
            else None
        )
        destination_death_calibration = (
            calibrate_destination_death_margin(
                carrier_probabilities,
                carrier_labels,
                raw_carrier_inputs,
                source_destination_mask,
            )
            if args.objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
            else None
        )
        failure_phase = "model-write"
        model_artifact = {
            "schema": MODEL_SCHEMA,
            "status": "completed",
            "route": {"backend": "mlx", "device": device, "effectiveRunner": sys.executable, "fallbackReason": None},
            "manifest": manifest_receipt,
            "input": {
                "authority": INPUT_AUTHORITY, "featureCount": 64, "candidateFeatureCount": 16,
                "directionalOccupancyCount": 27,
                "normalizationAuthority": normalization_authority,
                "mean": input_mean.tolist(), "scale": input_scale.tolist(),
            },
            "architecture": {
                "authority": ARCHITECTURE_AUTHORITY,
                "carrierOutputOrder": [list(delta) for delta in DISPLACEMENTS] + ["death"],
                "layers": [
                    model_layer(model.trunk_a, "shared-trunk-a", "relu"),
                    model_layer(model.trunk_b, "shared-trunk-b", "relu"),
                    model_layer(model.carrier, "carrier-displacement-death-head", "softmax"),
                    model_layer(model.birth, "residual-birth-head", "sigmoid"),
                ],
            },
            "training": {
                "holdoutFrameIds": last_trustworthy["holdoutFrameIds"],
                "trainingPairs": pair_reports,
                "carrierSampleCount": len(carrier_labels),
                "birthSampleCount": len(birth_labels),
                "birthPositiveCount": int(np.sum(birth_labels)),
                "epochs": args.epochs,
                "stepsPerEpoch": steps_per_epoch,
                "stepCount": step_count,
                "batchSize": args.batch_size,
                "learningRate": args.learning_rate,
                "weightDecay": args.weight_decay,
                "seed": args.seed,
                "losses": losses,
                "objectiveFamily": args.objective_family,
                "initializationAuthority": (
                    "frozen-seed-model-weights-v0"
                    if rollout_seed_bundle is not None
                    else "seeded-random-initialization-v0"
                ),
                "requestedHiddenSize": args.hidden_size,
                "effectiveHiddenSize": int(model.trunk_a.weight.shape[0]),
                "calibrationPopulationAuthority": (
                    "exact-plus-frozen-seed-recurrent-exposure-v0"
                    if rollout_exposure is not None
                    else "exact-adjacent-training-pairs-v0"
                ),
                **(
                    {
                        "rolloutSeedModel": rollout_seed_bundle["receipt"],
                        "rolloutExposure": rollout_exposure,
                    }
                    if rollout_seed_bundle is not None
                    else {}
                ),
                "carrierSamplingAuthority": (
                    "uniform-with-replacement-across-q1-q4-transported-death-v0"
                    if args.objective_family == MOTION_BALANCED_OBJECTIVE_FAMILY
                    else (
                        "uniform-with-replacement-across-eulerian-q1-q4-transported-birth-death-empty-v0"
                        if args.objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
                        else "population-random-with-replacement-v0"
                    )
                ),
                "birthSamplingAuthority": (
                    "balanced-positive-negative-with-replacement-v0"
                    if args.objective_family in (
                        MOTION_BALANCED_OBJECTIVE_FAMILY,
                        EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY,
                    )
                    else "population-random-with-positive-loss-weight-v0"
                ),
                "carrierCohortCounts": {
                    cohort: int(np.sum(carrier_cohorts == cohort))
                    for cohort in (
                        EULERIAN_DESTINATION_COHORTS
                        if args.objective_family == EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY
                        else CARRIER_COHORTS
                    )
                },
            },
            "calibration": {
                "carrier": carrier_training_metrics,
                "birth": {"authority": "training-residual-birth-f1-threshold-v0", **birth_calibration},
                "targetSupport": target_support_calibration,
                **({"carrierAction": action_calibration} if action_calibration is not None else {}),
                **(
                    {"destinationDeath": destination_death_calibration}
                    if destination_death_calibration is not None
                    else {}
                ),
            },
            "correspondence": {
                "authority": CORRESPONDENCE_AUTHORITY,
                "radiusCells": 1,
                "stableReservation": True,
                "oneToOneCarrierAssignment": True,
                "ambiguityRecorded": True,
            },
        }
        model_path = out_dir / "transport-model.json"
        write_json(model_path, model_artifact)
        failure_phase = "heldout-recurrent-inference"
        holdout_docs = [frames_docs[index] for index in sorted(holdout_indices)]
        current = frames[holdout_docs[0]["id"]]
        prediction_frames = [current]
        recurrent_rows = []
        holdout_metrics = []
        for step_index in range(1, len(holdout_docs)):
            predicted, recurrent = recurrent_predict(
                model,
                current,
                grid_step,
                input_mean,
                input_scale,
                birth_calibration,
                target_support_calibration,
                args.batch_size,
                action_calibration,
                destination_death_calibration,
            )
            exact = frames[holdout_docs[step_index]["id"]]
            recurrent_rows.append({"step": step_index, **recurrent})
            holdout_metrics.append({"step": step_index, **support_metrics(prediction_frames[0], predicted, exact)})
            prediction_frames.append(predicted)
            current = predicted
        failure_phase = "prediction-write"
        prediction_docs = []
        for step_index, (frame_doc, predicted) in enumerate(zip(holdout_docs, prediction_frames)):
            artifacts = write_frame_artifacts(out_dir, f"prediction-step-{step_index:02d}", predicted)
            prediction_docs.append({
                "step": step_index,
                "referenceFrameId": frame_doc["id"],
                "controlFrameId": holdout_docs[0]["id"],
                **artifacts,
            })
        prediction_artifact = build_prediction_document(
            inference_manifest=model_artifact["manifest"],
            training_manifest=model_artifact["manifest"],
            model={"path": str(model_path), "sha256": sha256_bytes(model_path.read_bytes()), "schema": MODEL_SCHEMA},
            route=model_artifact["route"],
            temporal={
                "authority": "recurrent-one-controlled-step-local-grid-continuation-v0",
                "controlledStepDeltaMs": int(holdout_docs[0].get("controlledStepDeltaMs", 160)),
                "sourceFrameId": holdout_docs[0]["id"],
                "heldoutReferenceFrameIds": [frame["id"] for frame in holdout_docs],
                "trainingFrameIdsExcluded": [frame["id"] for frame in holdout_docs],
            },
            frames=prediction_docs,
            recurrent=recurrent_rows,
            support_metrics=holdout_metrics,
        )
        prediction_path = out_dir / "transport-predictions.json"
        write_json(prediction_path, prediction_artifact)
        failure_phase = "report-write"
        report = {
            "schema": SCHEMA,
            "status": "completed",
            "startedAt": started_at,
            "completedAt": time.time(),
            "route": model_artifact["route"],
            "manifest": model_artifact["manifest"],
            "model": {"path": str(model_path), "sha256": sha256_bytes(model_path.read_bytes())},
            "predictions": {"path": str(prediction_path), "sha256": sha256_bytes(prediction_path.read_bytes())},
            "trainingPairs": pair_reports,
            **(
                {
                    "rolloutSeedModel": rollout_seed_bundle["receipt"],
                    "rolloutExposure": rollout_exposure,
                }
                if rollout_seed_bundle is not None
                else {}
            ),
            "calibration": model_artifact["calibration"],
            "holdoutMetrics": holdout_metrics,
            "rolloutGate": summarize_rollout_gate(holdout_metrics),
            "recurrent": recurrent_rows,
        }
        write_json(report_path, report)
        print(json.dumps(report, indent=2))
    except Exception as error:
        failure = {
            "schema": SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "error": f"{type(error).__name__}: {error}",
            "lastTrustworthyEvidence": last_trustworthy,
            "startedAt": started_at,
            "failedAt": time.time(),
        }
        write_json(report_path, failure)
        raise


if __name__ == "__main__":
    main()
