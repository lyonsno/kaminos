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


SCHEMA = "kaminos-phase-churn-shared-mlx-training-v0"
MODEL_SCHEMA = "kaminos-phase-churn-shared-mlx-model-v0"
INPUT_AUTHORITY = "exact-local-grid-42-feature-contract-v0"
ARCHITECTURE_AUTHORITY = "dense-relu-shared-trunk-three-conditional-logit-heads-v0"
HEADS = ("survival", "birth", "death")
FEATURES = (
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
)
NEIGHBORS = ((-1, 0, 0), (1, 0, 0), (0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1))


def write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def resolve_artifact_path(base_dir, value):
    path = Path(value)
    return path.resolve() if path.is_absolute() else (base_dir / path).resolve()


def stable_key(position):
    return tuple(round(float(value), 6) for value in position)


def key_position(key):
    return np.asarray(key, dtype=np.float32)


def offset_key(key, offset, grid_step):
    return tuple(round(key[index] + offset[index] * grid_step, 6) for index in range(3))


def load_frame(frame, base_dir):
    loaded = {}
    for name, stride in (("candidates", 16), ("splats", 12)):
        artifact = frame.get(name)
        if not artifact or artifact.get("strideFloats") != stride or artifact.get("dtype") != "float32-le":
            raise ValueError(f"{frame.get('id')} {name} contract mismatch")
        path = resolve_artifact_path(base_dir, artifact["path"])
        data = path.read_bytes()
        if len(data) != artifact.get("bytes") or sha256_bytes(data) != artifact.get("sha256"):
            raise ValueError(f"{frame.get('id')} {name} byte/hash mismatch")
        values = np.frombuffer(data, dtype="<f4")
        if values.size != int(artifact.get("count", 0)) * stride:
            raise ValueError(f"{frame.get('id')} {name} count mismatch")
        values = values.reshape(-1, stride).copy()
        if not np.all(np.isfinite(values)):
            raise ValueError(f"{frame.get('id')} {name} contains non-finite values")
        loaded[name] = values
    if loaded["candidates"].shape[0] != loaded["splats"].shape[0]:
        raise ValueError(f"{frame.get('id')} candidate/splat counts differ")
    keys = [stable_key(row[:3]) for row in loaded["splats"]]
    if len(set(keys)) != len(keys):
        raise ValueError(f"{frame.get('id')} contains duplicate world-position keys")
    loaded["keys"] = keys
    loaded["index"] = {key: index for index, key in enumerate(keys)}
    return loaded


def add_site_stat(stats, key, field, splat=None):
    row = stats.setdefault(key, {
        "targetOccupancy": 0,
        "sourceOccupancy": 0,
        "sampleCount": 0,
        "targetPositive": 0,
        "targetNegative": 0,
        "prototypeSplat": None,
    })
    row[field] += 1
    row["sampleCount"] += 1
    if splat is not None and row["prototypeSplat"] is None:
        row["prototypeSplat"] = np.asarray(splat, dtype=np.float32)


def build_site_stats(training_pairs, frames):
    stats = {}
    for pair in training_pairs:
        source = frames[pair["sourceFrameId"]]
        target = frames[pair["targetFrameId"]]
        for key, index in source["index"].items():
            add_site_stat(stats, key, "sourceOccupancy", source["splats"][index])
        for key, index in target["index"].items():
            add_site_stat(stats, key, "targetOccupancy", target["splats"][index])
            stats[key]["targetPositive" if pair["offsetSteps"] >= 0 else "targetNegative"] += 1
    return stats


def make_site_universe(source, stats, sign):
    keys = set(source["keys"])
    signed_field = "targetPositive" if sign >= 0 else "targetNegative"
    keys.update(key for key, row in stats.items() if row["prototypeSplat"] is not None and row[signed_field] > 0)
    return sorted(keys)


def build_base_inputs(keys, source, stats, grid_step):
    inputs = np.zeros((len(keys), 42), dtype=np.float32)
    source_index = source["index"]
    for row_index, key in enumerate(keys):
        direct_index = source_index.get(key)
        stat = stats.get(key)
        sample_count = max(1, int(stat["sampleCount"]) if stat else 1)
        inputs[row_index, 0] = 1.0
        inputs[row_index, 2:5] = key_position(key)
        inputs[row_index, 5] = 1.0 if direct_index is not None else 0.0
        inputs[row_index, 7] = (stat["targetOccupancy"] if stat else 0) / sample_count
        inputs[row_index, 8] = (stat["sourceOccupancy"] if stat else 0) / sample_count
        if direct_index is not None:
            inputs[row_index, 10:26] = source["candidates"][direct_index]
        neighbor_features = []
        for neighbor in NEIGHBORS:
            neighbor_index = source_index.get(offset_key(key, neighbor, grid_step))
            if neighbor_index is not None:
                neighbor_features.append(source["candidates"][neighbor_index])
        inputs[row_index, 9] = len(neighbor_features) / len(NEIGHBORS)
        if neighbor_features:
            inputs[row_index, 26:42] = np.mean(np.stack(neighbor_features), axis=0)
    return inputs


def build_dataset(manifest, frames, training_pairs, max_abs_offset, grid_step):
    source_ids = {pair["sourceFrameId"] for pair in training_pairs}
    if len(source_ids) != 1:
        raise ValueError("shared phase churn trainer currently requires one stable source frame across temporal pairs")
    source = frames[next(iter(source_ids))]
    stats = build_site_stats(training_pairs, frames)
    sign_cache = {}
    pair_rows = []
    all_inputs = []
    all_targets = []
    all_source_masks = []
    cursor = 0
    for pair_index, pair in enumerate(training_pairs):
        sign = 1 if pair["offsetSteps"] >= 0 else -1
        if sign not in sign_cache:
            keys = make_site_universe(source, stats, sign)
            sign_cache[sign] = {
                "keys": keys,
                "base": build_base_inputs(keys, source, stats, grid_step),
            }
        keys = sign_cache[sign]["keys"]
        inputs = sign_cache[sign]["base"].copy()
        inputs[:, 1] = float(pair["offsetSteps"]) / max_abs_offset
        signed_field = "targetPositive" if sign >= 0 else "targetNegative"
        inputs[:, 6] = np.asarray([
            (stats[key][signed_field] / max(1, stats[key]["sampleCount"])) if key in stats else 0.0
            for key in keys
        ], dtype=np.float32)
        target_keys = frames[pair["targetFrameId"]]["index"]
        labels = np.fromiter((1.0 if key in target_keys else 0.0 for key in keys), dtype=np.float32, count=len(keys))
        source_mask = inputs[:, 5].copy()
        all_inputs.append(inputs)
        all_targets.append(labels)
        all_source_masks.append(source_mask)
        pair_rows.append({
            "pairIndex": pair_index,
            "offset": int(pair["offsetSteps"]),
            "start": cursor,
            "end": cursor + len(keys),
            "keys": keys,
            "target": labels,
            "sourceMask": source_mask,
        })
        cursor += len(keys)
    inputs = np.concatenate(all_inputs, axis=0)
    target = np.concatenate(all_targets, axis=0)
    source_mask = np.concatenate(all_source_masks, axis=0)
    head_labels = np.stack((target, target, 1.0 - target), axis=1).astype(np.float32)
    head_masks = np.stack((source_mask, 1.0 - source_mask, source_mask), axis=1).astype(np.float32)
    return {
        "inputs": inputs,
        "labels": head_labels,
        "masks": head_masks,
        "pairRows": pair_rows,
        "siteStats": stats,
        "source": source,
    }


def head_counts(labels, masks):
    result = {}
    for head_index, head_name in enumerate(HEADS):
        active = masks[:, head_index] > 0.5
        positive = int(np.sum(labels[active, head_index] > 0.5))
        count = int(np.sum(active))
        result[head_name] = {"sampleCount": count, "positiveCount": positive, "negativeCount": count - positive}
    return result


def build_ranking_groups(dataset):
    groups = {head: [] for head in HEADS}
    for pair in dataset["pairRows"]:
        start = pair["start"]
        for head_index, head_name in enumerate(HEADS):
            mask = dataset["masks"][start:pair["end"], head_index] > 0.5
            labels = dataset["labels"][start:pair["end"], head_index] > 0.5
            positive = np.flatnonzero(mask & labels) + start
            negative = np.flatnonzero(mask & ~labels) + start
            if positive.size and negative.size:
                groups[head_name].append((positive, negative, pair["offset"]))
    if any(not groups[head] for head in HEADS):
        raise ValueError("every conditional head requires at least one within-pair positive/negative ranking group")
    return groups


def build_consistency_pairs(dataset):
    rows_by_sign = {1: [], -1: []}
    for row in dataset["pairRows"]:
        rows_by_sign[1 if row["offset"] >= 0 else -1].append(row)
    pairs = {head: [] for head in HEADS}
    for rows in rows_by_sign.values():
        rows.sort(key=lambda row: row["offset"])
        for left, right in zip(rows, rows[1:]):
            if left["keys"] != right["keys"]:
                raise ValueError("adjacent same-sign training offsets must share the stable prediction-site universe")
            for head_index, head_name in enumerate(HEADS):
                left_slice = slice(left["start"], left["end"])
                right_slice = slice(right["start"], right["end"])
                left_mask = dataset["masks"][left_slice, head_index] > 0.5
                right_mask = dataset["masks"][right_slice, head_index] > 0.5
                agreement = dataset["labels"][left_slice, head_index] == dataset["labels"][right_slice, head_index]
                local = np.flatnonzero(left_mask & right_mask & agreement)
                if local.size:
                    pairs[head_name].append((local + left["start"], local + right["start"], left["offset"], right["offset"]))
    if any(not pairs[head] for head in HEADS):
        raise ValueError("every conditional head requires same-site adjacent-offset label-agreement pairs")
    return pairs


class SharedChurnModel(nn.Module):
    def __init__(self, input_size, hidden_size):
        super().__init__()
        self.trunk = nn.Linear(input_size, hidden_size)
        self.heads = nn.Linear(hidden_size, len(HEADS))

    def __call__(self, inputs):
        return self.heads(nn.relu(self.trunk(inputs)))


def binary_cross_entropy_logits(logits, labels):
    return mx.maximum(logits, 0) - logits * labels + mx.log1p(mx.exp(-mx.abs(logits)))


def sample_ranking_batch(rng, inputs, groups, count_per_head):
    positive_rows = []
    negative_rows = []
    for head_name in HEADS:
        head_positive = []
        head_negative = []
        active_groups = groups[head_name]
        group_choices = rng.integers(0, len(active_groups), size=count_per_head)
        for group_index in group_choices:
            positive, negative, _ = active_groups[int(group_index)]
            head_positive.append(inputs[int(rng.choice(positive))])
            head_negative.append(inputs[int(rng.choice(negative))])
        positive_rows.append(np.stack(head_positive))
        negative_rows.append(np.stack(head_negative))
    return np.stack(positive_rows).astype(np.float32), np.stack(negative_rows).astype(np.float32)


def sample_consistency_batch(rng, inputs, pairs, count_per_head):
    left_rows = []
    right_rows = []
    for head_name in HEADS:
        head_left = []
        head_right = []
        active_pairs = pairs[head_name]
        pair_choices = rng.integers(0, len(active_pairs), size=count_per_head)
        for pair_index in pair_choices:
            left, right, _, _ = active_pairs[int(pair_index)]
            local = int(rng.integers(0, len(left)))
            head_left.append(inputs[int(left[local])])
            head_right.append(inputs[int(right[local])])
        left_rows.append(np.stack(head_left))
        right_rows.append(np.stack(head_right))
    return np.stack(left_rows).astype(np.float32), np.stack(right_rows).astype(np.float32)


def threshold_calibration(probabilities, labels, masks):
    calibration = {"authority": "training-pair-conditional-pr-threshold-calibration-v0"}
    definitions = {
        "survival": (2.0, "lower"),
        "birth": (0.5, "higher"),
        "death": (0.5, "higher"),
    }
    thresholds = np.arange(0.05, 1.0, 0.05)
    for head_index, head_name in enumerate(HEADS):
        active = masks[:, head_index] > 0.5
        head_probabilities = probabilities[active, head_index]
        head_labels = labels[active, head_index] > 0.5
        beta, tie_break = definitions[head_name]
        beta2 = beta * beta
        rows = []
        for threshold in thresholds:
            predicted = head_probabilities >= threshold
            tp = int(np.sum(predicted & head_labels))
            fp = int(np.sum(predicted & ~head_labels))
            fn = int(np.sum(~predicted & head_labels))
            precision = tp / max(1, tp + fp)
            recall = tp / max(1, tp + fn)
            f_score = (1 + beta2) * precision * recall / max(1e-12, beta2 * precision + recall)
            rows.append({
                "threshold": float(threshold), "precision": precision, "recall": recall, "fScore": f_score,
                "truePositive": tp, "falsePositive": fp, "falseNegative": fn, "sampleCount": int(active.sum()),
            })
        calibration[head_name] = max(
            rows,
            key=lambda row: (row["fScore"], row["precision"], -row["threshold"] if tie_break == "lower" else row["threshold"]),
        )
    return calibration


def predict_all(model, inputs, batch_size):
    outputs = []
    for start in range(0, len(inputs), batch_size):
        outputs.append(np.asarray(mx.sigmoid(model(mx.array(inputs[start:start + batch_size]))), dtype=np.float32))
    return np.concatenate(outputs, axis=0)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--holdout-offset", required=True, type=int)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--grid-size", type=int, default=0)
    parser.add_argument("--hidden-size", type=int, default=24)
    parser.add_argument("--steps", type=int, default=800)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--ranking-batch-size", type=int, default=256)
    parser.add_argument("--consistency-batch-size", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=0.0015)
    parser.add_argument("--ranking-margin", type=float, default=0.2)
    parser.add_argument("--ranking-weight", type=float, default=0.25)
    parser.add_argument("--consistency-weight", type=float, default=0.08)
    parser.add_argument("--l2", type=float, default=0.0001)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--probe-only", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.out_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "training-report.json"
    started_at = time.time()
    failure_phase = "argument-validation"
    last_trustworthy = {"manifestPath": str(Path(args.manifest).resolve())}
    try:
        if args.holdout_offset == 0 or args.grid_size < 0 or args.hidden_size <= 0 or args.steps <= 0 or args.batch_size <= 0:
            raise ValueError("holdout offset must be nonzero and model/training dimensions must be positive")
        if args.ranking_batch_size <= 0 or args.consistency_batch_size <= 0:
            raise ValueError("ranking and consistency batch sizes must be positive")
        failure_phase = "manifest-validation"
        manifest_path = Path(args.manifest).resolve()
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        if manifest.get("schema") != "kaminos-boundary-splat-phase-candidate-corpus-v0":
            raise ValueError("phase churn trainer requires the phase candidate corpus schema")
        if manifest.get("featureOrder") != list(FEATURES):
            raise ValueError("phase churn trainer requires the exact deployed 16-feature candidate contract")
        alignment = manifest.get("temporalAlignment", {})
        if alignment.get("identityKey") != "world-position-stable-key":
            raise ValueError("phase churn trainer requires world-position-stable-key alignment")
        held_out = next((pair for pair in alignment.get("pairs", []) if pair.get("offsetSteps") == args.holdout_offset), None)
        if not held_out:
            raise ValueError(f"holdout offset {args.holdout_offset} is absent from the corpus")
        training_pairs = [pair for pair in alignment["pairs"] if pair["offsetSteps"] != args.holdout_offset]
        training_offsets = sorted(int(pair["offsetSteps"]) for pair in training_pairs)
        max_abs_offset = max(abs(int(value)) for value in alignment["offsetSteps"])
        grid_size = args.grid_size
        if grid_size == 0:
            query = parse_qs(urlparse(manifest.get("requestedRoute", "")).query)
            grid_size = int(query.get("volume_resolution", [160])[0])
        if grid_size <= 0:
            raise ValueError("effective grid size must be positive")
        grid_step = 2.0 / grid_size
        frame_docs = {frame["id"]: frame for frame in manifest.get("frames", [])}
        required_frame_ids = {held_out["targetFrameId"], *(pair["sourceFrameId"] for pair in training_pairs), *(pair["targetFrameId"] for pair in training_pairs)}
        failure_phase = "artifact-validation"
        frames = {frame_id: load_frame(frame_docs[frame_id], manifest_path.parent) for frame_id in required_frame_ids}
        last_trustworthy.update({
            "manifestSha256": sha256_bytes(manifest_bytes),
            "validatedFrameCount": len(frames),
            "holdoutOffset": args.holdout_offset,
            "trainingOffsets": training_offsets,
        })
        failure_phase = "dataset-construction"
        dataset = build_dataset(manifest, frames, training_pairs, max_abs_offset, grid_step)
        counts = head_counts(dataset["labels"], dataset["masks"])
        ranking_groups = build_ranking_groups(dataset)
        consistency_pairs = build_consistency_pairs(dataset)
        input_mean = np.mean(dataset["inputs"], axis=0, dtype=np.float64).astype(np.float32)
        input_scale = np.std(dataset["inputs"], axis=0, dtype=np.float64).astype(np.float32)
        input_scale[input_scale < 1e-6] = 1.0
        normalized = ((dataset["inputs"] - input_mean) / input_scale).astype(np.float32)
        pair_report = [{"offset": row["offset"], "sampleCount": row["end"] - row["start"]} for row in dataset["pairRows"]]
        available_ranking_groups = {head: len(ranking_groups[head]) for head in HEADS}
        available_consistency_pairs = {head: int(sum(len(row[0]) for row in consistency_pairs[head])) for head in HEADS}
        base_report = {
            "schema": SCHEMA,
            "status": "probe-only" if args.probe_only else "training",
            "route": {"backend": "mlx", "device": str(mx.default_device()), "effectiveRunner": sys.executable, "fallbackReason": None},
            "manifest": {"path": str(manifest_path), "bytes": len(manifest_bytes), "sha256": sha256_bytes(manifest_bytes)},
            "holdout": {"offset": args.holdout_offset, "targetFrameId": held_out["targetFrameId"], "trainingOffsets": training_offsets},
            "dataset": {
                "authority": "uncapped-world-position-training-pair-site-universe-v0",
                "sampleCount": int(len(normalized)),
                "pairSamples": pair_report,
                "headSampleCounts": counts,
                "inputFeatureCount": int(normalized.shape[1]),
                "candidateFeatureCount": 16,
                "gridSize": grid_size,
                "gridStep": grid_step,
                "hiddenSampleCap": None,
            },
            "objectives": {
                "conditionalBce": {"authority": "masked-asymmetric-conditional-bce-v0", "evaluatedSampleCount": 0},
                "withinPairRanking": {
                    "authority": "within-training-pair-positive-negative-margin-ranking-v0",
                    "margin": args.ranking_margin, "weight": args.ranking_weight,
                    "availableGroupCount": available_ranking_groups, "evaluatedPairCount": 0,
                },
                "adjacentOffsetConsistency": {
                    "authority": "same-site-adjacent-offset-label-agreement-consistency-v0",
                    "weight": args.consistency_weight, "availablePairCount": available_consistency_pairs,
                    "evaluatedPairCount": 0,
                },
            },
            "startedAt": started_at,
            "finishedAt": None,
            "elapsedSeconds": None,
        }
        if args.probe_only:
            base_report["finishedAt"] = time.time()
            base_report["elapsedSeconds"] = base_report["finishedAt"] - started_at
            write_json(report_path, base_report)
            print(json.dumps({"status": base_report["status"], "device": base_report["route"]["device"], "sampleCount": base_report["dataset"]["sampleCount"]}))
            return
        failure_phase = "mlx-training"
        rng = np.random.default_rng(args.seed)
        model = SharedChurnModel(normalized.shape[1], args.hidden_size)
        optimizer = optim.Adam(learning_rate=args.learning_rate)
        positive_weights = mx.array(np.asarray([1.25, 1.0, 1.0], dtype=np.float32))
        negative_weights = mx.array(np.asarray([1.0, 2.0, 2.0], dtype=np.float32))

        def loss_fn(active_model, classification_x, classification_labels, classification_masks, rank_positive, rank_negative, consistency_left, consistency_right):
            logits = active_model(classification_x)
            sample_weights = classification_labels * positive_weights + (1.0 - classification_labels) * negative_weights
            bce = mx.sum(binary_cross_entropy_logits(logits, classification_labels) * classification_masks * sample_weights) / mx.maximum(mx.sum(classification_masks), 1.0)
            ranking_loss = mx.array(0.0)
            consistency_loss = mx.array(0.0)
            for head_index in range(len(HEADS)):
                positive_logits = active_model(rank_positive[head_index])[:, head_index]
                negative_logits = active_model(rank_negative[head_index])[:, head_index]
                ranking_loss = ranking_loss + mx.mean(mx.maximum(0.0, args.ranking_margin - positive_logits + negative_logits))
                left_probabilities = mx.sigmoid(active_model(consistency_left[head_index])[:, head_index])
                right_probabilities = mx.sigmoid(active_model(consistency_right[head_index])[:, head_index])
                consistency_loss = consistency_loss + mx.mean(mx.square(left_probabilities - right_probabilities))
            ranking_loss = ranking_loss / len(HEADS)
            consistency_loss = consistency_loss / len(HEADS)
            l2_loss = mx.mean(mx.square(active_model.trunk.weight)) + mx.mean(mx.square(active_model.heads.weight))
            total = bce + args.ranking_weight * ranking_loss + args.consistency_weight * consistency_loss + args.l2 * l2_loss
            return total, (bce, ranking_loss, consistency_loss, l2_loss)

        loss_and_grad = nn.value_and_grad(model, loss_fn)
        loss_trace = []
        for step in range(args.steps):
            indices = rng.integers(0, len(normalized), size=args.batch_size)
            rank_positive, rank_negative = sample_ranking_batch(rng, normalized, ranking_groups, args.ranking_batch_size)
            consistency_left, consistency_right = sample_consistency_batch(rng, normalized, consistency_pairs, args.consistency_batch_size)
            (loss, components), gradients = loss_and_grad(
                model,
                mx.array(normalized[indices]), mx.array(dataset["labels"][indices]), mx.array(dataset["masks"][indices]),
                mx.array(rank_positive), mx.array(rank_negative), mx.array(consistency_left), mx.array(consistency_right),
            )
            optimizer.update(model, gradients)
            mx.eval(model.parameters(), optimizer.state, loss, components)
            if step == 0 or (step + 1) % 100 == 0 or step + 1 == args.steps:
                loss_trace.append({
                    "step": step + 1, "total": float(loss.item()), "bce": float(components[0].item()),
                    "ranking": float(components[1].item()), "consistency": float(components[2].item()), "l2": float(components[3].item()),
                })
        failure_phase = "full-corpus-calibration"
        probabilities = predict_all(model, normalized, max(args.batch_size, 8192))
        calibration = threshold_calibration(probabilities, dataset["labels"], dataset["masks"])
        base_report["objectives"]["conditionalBce"]["evaluatedSampleCount"] = args.steps * args.batch_size
        base_report["objectives"]["withinPairRanking"]["evaluatedPairCount"] = args.steps * args.ranking_batch_size * len(HEADS)
        base_report["objectives"]["adjacentOffsetConsistency"]["evaluatedPairCount"] = args.steps * args.consistency_batch_size * len(HEADS)
        base_report["training"] = {
            "authority": "full-corpus-mini-batch-mlx-adam-v0",
            "sampleCount": int(len(normalized)), "headSampleCounts": counts, "steps": args.steps,
            "hiddenSampleCap": None,
            "batchSize": args.batch_size, "learningRate": args.learning_rate, "l2": args.l2, "seed": args.seed,
            "lossTrace": loss_trace,
        }
        trunk_weights = np.asarray(model.trunk.weight, dtype=np.float32).reshape(-1).tolist()
        trunk_bias = np.asarray(model.trunk.bias, dtype=np.float32).reshape(-1).tolist()
        head_weights = np.asarray(model.heads.weight, dtype=np.float32).reshape(-1).tolist()
        head_bias = np.asarray(model.heads.bias, dtype=np.float32).reshape(-1).tolist()
        identity_payload = {
            "manifestSha256": base_report["manifest"]["sha256"], "holdoutOffset": args.holdout_offset,
            "inputMean": input_mean.tolist(), "inputScale": input_scale.tolist(),
            "trunkWeights": trunk_weights, "trunkBias": trunk_bias, "headWeights": head_weights, "headBias": head_bias,
        }
        identity = "sha256:" + sha256_bytes(json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        model_artifact = {
            "schema": MODEL_SCHEMA, "identity": identity, "status": "completed", "route": base_report["route"],
            "manifest": base_report["manifest"], "holdout": base_report["holdout"],
            "input": {
                "authority": INPUT_AUTHORITY, "featureCount": int(normalized.shape[1]), "candidateFeatureCount": 16,
                "mean": input_mean.tolist(), "scale": input_scale.tolist(),
            },
            "architecture": {
                "authority": ARCHITECTURE_AUTHORITY, "hiddenSize": args.hidden_size, "outputOrder": list(HEADS),
                "layers": [
                    {"role": "shared-trunk", "inputSize": int(normalized.shape[1]), "outputSize": args.hidden_size, "activation": "relu", "weights": trunk_weights, "bias": trunk_bias},
                    {"role": "conditional-heads", "inputSize": args.hidden_size, "outputSize": len(HEADS), "activation": "sigmoid", "weights": head_weights, "bias": head_bias},
                ],
            },
            "objectives": base_report["objectives"], "calibration": calibration, "training": base_report["training"],
        }
        failure_phase = "artifact-write"
        model_path = output_dir / "phase-churn-model.json"
        write_json(model_path, model_artifact)
        model_bytes = model_path.read_bytes()
        base_report["status"] = "completed"
        base_report["modelArtifact"] = {"path": str(model_path), "bytes": len(model_bytes), "sha256": sha256_bytes(model_bytes), "identity": identity}
        base_report["calibration"] = calibration
        base_report["finishedAt"] = time.time()
        base_report["elapsedSeconds"] = base_report["finishedAt"] - started_at
        write_json(report_path, base_report)
        print(json.dumps({"status": "completed", "device": base_report["route"]["device"], "sampleCount": len(normalized), "identity": identity}))
    except Exception as error:
        failure = {
            "schema": SCHEMA, "status": "failed", "failurePhase": failure_phase, "error": str(error),
            "lastTrustworthyEvidence": last_trustworthy,
            "route": {"backend": "mlx", "device": str(mx.default_device()), "effectiveRunner": sys.executable, "fallbackReason": None},
            "startedAt": started_at, "finishedAt": time.time(),
        }
        failure["elapsedSeconds"] = failure["finishedAt"] - started_at
        write_json(report_path, failure)
        raise


if __name__ == "__main__":
    main()
