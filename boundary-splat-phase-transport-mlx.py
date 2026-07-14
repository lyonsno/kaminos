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
PREDICTION_SCHEMA = "kaminos-boundary-splat-phase-transport-predictions-v0"
INPUT_AUTHORITY = "exact-16-feature-plus-directional-local-grid-occupancy-v0"
CORRESPONDENCE_AUTHORITY = "stable-site-first-bounded-local-grid-feature-correspondence-v0"
ARCHITECTURE_AUTHORITY = "shared-two-layer-relu-carrier-displacement-and-residual-birth-heads-v0"
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
POSITION_PRECISION = 6


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


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


def make_directional_inputs(keys, source, grid_step):
    keys = [stable_key(key) for key in keys]
    if not keys:
        return np.zeros((0, 64), dtype=np.float32)
    source_coordinates, origin = grid_coordinates(source["keys"], grid_step)
    query_coordinates, _ = grid_coordinates(keys, grid_step, origin)
    minimum = np.min(source_coordinates, axis=0)
    maximum = np.max(source_coordinates, axis=0)
    shape = tuple((maximum - minimum + 1).tolist())
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
    return {
        "correspondence": correspondence,
        "carrierInputs": carrier_inputs,
        "carrierLabels": carrier_labels,
        "birthInputs": birth_inputs,
        "birthLabels": birth_labels,
        "birthKeys": birth_keys,
    }


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
    return {"hiddenSize": hidden_size, "mean": mean, "scale": scale}


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


def prediction_universe(source, grid_step):
    source_coordinates, origin = grid_coordinates(source["keys"], grid_step)
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


def recurrent_predict(model, source, grid_step, input_mean, input_scale, birth_calibration, target_support_calibration, batch_size):
    carrier_inputs = make_directional_inputs(source["keys"], source, grid_step)
    carrier_probabilities, _ = predict_model(model, carrier_inputs, input_mean, input_scale, batch_size)
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
    birth_keys = prediction_universe(source, grid_step)
    birth_inputs = make_directional_inputs(birth_keys, source, grid_step)
    _, birth_probabilities = predict_model(model, birth_inputs, input_mean, input_scale, batch_size)
    target_support_budget = max(1, round(len(source["keys"]) * target_support_calibration["medianRatio"]))
    selected_births = select_ranked_births(
        birth_keys,
        birth_probabilities,
        set(claims),
        target_support_budget,
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
    return result, {
        "sourceCount": len(source["keys"]),
        "predictedCount": len(result["keys"]),
        "stableCarrierCount": stable_count,
        "transportedCarrierCount": transported_count,
        "deathCount": death_count,
        "collisionCount": collision_count,
        "birthCandidateCount": len(birth_keys),
        "birthSelectionAuthority": "training-target-count-calibrated-ranked-residual-birth-v0",
        "targetSupportBudget": target_support_budget,
        "thresholdQualifiedBirthCount": threshold_qualified_birth_count,
        "selectedBirthCount": len(result["keys"]) - len(claims),
    }


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
):
    return {
        "schema": PREDICTION_SCHEMA,
        "status": "completed",
        "manifest": inference_manifest,
        "modelTrainingManifest": training_manifest,
        "model": model,
        "route": route,
        "temporal": temporal,
        "frames": frames,
        "recurrent": recurrent,
        "supportMetrics": support_metrics,
        "claimBoundary": "isolated recurrent one-cell transport with carried candidate attributes and locally synthesized residual births; no live renderer or instancing integration",
    }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--model", default="")
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
            failure_phase = "route-validation"
            device = str(mx.default_device())
            if not device.lower().startswith("device(gpu"):
                raise RuntimeError(f"frozen transport inference requires MLX GPU, effective device was {device}")
            route = {"backend": "mlx", "device": device, "effectiveRunner": sys.executable, "fallbackReason": None}
            failure_phase = "frozen-recurrent-inference"
            inference_docs = [frames_docs[index] for index in sorted(holdout_indices)]
            current = frames[inference_docs[0]["id"]]
            prediction_frames = [current]
            recurrent_rows = []
            inference_metrics = []
            birth_calibration = frozen_model_document["calibration"]["birth"]
            target_support_calibration = frozen_model_document["calibration"]["targetSupport"]
            for step_index in range(1, len(inference_docs)):
                predicted, recurrent = recurrent_predict(
                    frozen_model,
                    current,
                    grid_step,
                    input_mean,
                    input_scale,
                    birth_calibration,
                    target_support_calibration,
                    args.batch_size,
                )
                exact = frames[inference_docs[step_index]["id"]]
                recurrent_rows.append({"step": step_index, **recurrent})
                inference_metrics.append({"step": step_index, **support_metrics(prediction_frames[0], predicted, exact)})
                prediction_frames.append(predicted)
                current = predicted
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
                "predictions": {"path": str(prediction_path), "sha256": sha256_bytes(prediction_path.read_bytes())},
                "holdoutMetrics": inference_metrics,
                "recurrent": recurrent_rows,
            }
            write_json(report_path, report)
            print(json.dumps(report, indent=2))
            return
        failure_phase = "dataset-construction"
        datasets = []
        pair_reports = []
        for left, right in training_pairs:
            dataset = build_pair_dataset(frames[left["id"]], frames[right["id"]], grid_step)
            datasets.append(dataset)
            pair_reports.append({
                "sourceFrameId": left["id"], "targetFrameId": right["id"],
                **{key: value for key, value in dataset["correspondence"].items() if key != "matches" and key not in ("births", "deaths")},
                "carrierSampleCount": len(dataset["carrierLabels"]),
                "sourceCount": len(frames[left["id"]]["keys"]),
                "targetCount": len(frames[right["id"]]["keys"]),
                "birthSampleCount": len(dataset["birthLabels"]),
                "birthPositiveCount": int(np.sum(dataset["birthLabels"])),
            })
        carrier_inputs = np.concatenate([dataset["carrierInputs"] for dataset in datasets])
        carrier_labels = np.concatenate([dataset["carrierLabels"] for dataset in datasets])
        birth_inputs = np.concatenate([dataset["birthInputs"] for dataset in datasets])
        birth_labels = np.concatenate([dataset["birthLabels"] for dataset in datasets])
        all_inputs = np.concatenate((carrier_inputs, birth_inputs))
        input_mean = np.mean(all_inputs, axis=0, dtype=np.float64).astype(np.float32)
        input_scale = np.std(all_inputs, axis=0, dtype=np.float64).astype(np.float32)
        input_scale[input_scale < 1e-6] = 1.0
        carrier_inputs = ((carrier_inputs - input_mean) / input_scale).astype(np.float32)
        birth_inputs = ((birth_inputs - input_mean) / input_scale).astype(np.float32)
        class_counts = np.bincount(carrier_labels, minlength=DEATH_CLASS + 1).astype(np.float32)
        class_weights = np.sqrt(np.sum(class_counts) / np.maximum(class_counts, 1.0))
        class_weights /= np.mean(class_weights)
        birth_positive_weight = float(np.sum(birth_labels == 0) / max(1, np.sum(birth_labels > 0.5)))
        failure_phase = "route-validation"
        device = str(mx.default_device())
        if not device.lower().startswith("device(gpu"):
            raise RuntimeError(f"transport trainer requires MLX GPU, effective device was {device}")
        failure_phase = "model-training"
        rng = np.random.default_rng(args.seed)
        mx.random.seed(args.seed)
        model = TransportModel(args.hidden_size)
        mx.eval(model.parameters())
        optimizer = optim.AdamW(learning_rate=args.learning_rate, weight_decay=args.weight_decay)
        loss_and_grad = nn.value_and_grad(model, weighted_loss)
        steps_per_epoch = max(math.ceil(len(carrier_inputs) / args.batch_size), math.ceil(len(birth_inputs) / args.batch_size))
        step_count = steps_per_epoch * args.epochs
        losses = []
        for step in range(step_count):
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
        failure_phase = "model-write"
        model_artifact = {
            "schema": MODEL_SCHEMA,
            "status": "completed",
            "route": {"backend": "mlx", "device": device, "effectiveRunner": sys.executable, "fallbackReason": None},
            "manifest": manifest_receipt,
            "input": {
                "authority": INPUT_AUTHORITY, "featureCount": 64, "candidateFeatureCount": 16,
                "directionalOccupancyCount": 27, "mean": input_mean.tolist(), "scale": input_scale.tolist(),
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
            },
            "calibration": {
                "carrier": carrier_training_metrics,
                "birth": {"authority": "training-residual-birth-f1-threshold-v0", **birth_calibration},
                "targetSupport": target_support_calibration,
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
                model, current, grid_step, input_mean, input_scale, birth_calibration, target_support_calibration, args.batch_size,
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
            "calibration": model_artifact["calibration"],
            "holdoutMetrics": holdout_metrics,
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
