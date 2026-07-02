#!/usr/bin/env python3
import argparse
import json
import math
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
from PIL import Image


SCHEMA = "kaminos.volume.residual-upscale-mlx.v0"
PAIR_AUTHORITY = "frame-locked-render-scale-set-v0"
IMAGE_AUTHORITY = "cdp-canvas-clip-capture-after-render-only-frozen-sim-state"


class TinyResidualUpscaler(nn.Module):
    def __init__(self, hidden_channels, input_channels):
        super().__init__()
        self.input = nn.Conv2d(input_channels, hidden_channels, kernel_size=3, padding=1)
        self.mid_a = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.mid_b = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.output = nn.Conv2d(hidden_channels, 3, kernel_size=3, padding=1)
        self.output.weight = mx.zeros_like(self.output.weight)
        self.output.bias = mx.zeros_like(self.output.bias)

    def __call__(self, image):
        base_image = image[..., :3]
        hidden = nn.relu(self.input(image))
        hidden = nn.relu(self.mid_a(hidden))
        hidden = nn.relu(self.mid_b(hidden))
        residual = self.output(hidden)
        return mx.clip(base_image + residual * 0.25, 0.0, 1.0)


def parse_args():
    parser = argparse.ArgumentParser(description="Tiny MLX residual-upscale smoke for Kaminos frame-locked render pairs.")
    parser.add_argument("--corpus-manifest", required=True, help="Path to corpus-manifest.json from frame-locked render-pair captures.")
    parser.add_argument("--out-dir", required=True, help="Directory for report and preview artifacts.")
    parser.add_argument("--low-render-scale", type=float, default=None, help="Optional low render scale filter, e.g. 0.25.")
    parser.add_argument("--max-steps", dest="maxSteps", type=int, default=120, help="Bounded training steps for contention control.")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--patch-size", type=int, default=96)
    parser.add_argument("--hidden-channels", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--eval-patches", type=int, default=64)
    parser.add_argument("--preview-size", type=int, default=384)
    parser.add_argument("--preview-mode", choices=["center", "foreground"], default="center")
    parser.add_argument("--seed", type=int, default=630)
    parser.add_argument("--sleep-ms", dest="sleepMs", type=float, default=0.0, help="Optional per-step sleep throttle for contention control.")
    parser.add_argument("--foreground-threshold", dest="foregroundThreshold", type=float, default=0.025)
    parser.add_argument("--foreground-probability", dest="foregroundProbability", type=float, default=0.85)
    parser.add_argument("--loss-mode", choices=["mse", "weighted"], default="mse")
    parser.add_argument("--foreground-loss-weight", dest="foregroundLossWeight", type=float, default=0.0)
    parser.add_argument("--difference-loss-weight", dest="differenceLossWeight", type=float, default=0.0)
    parser.add_argument("--condition-render-scale", dest="conditionRenderScale", action="store_true")
    parser.add_argument("--temporal-eval", dest="temporalEval", action="store_true")
    parser.add_argument("--temporal-eval-scope", dest="temporalEvalScope", choices=["selected", "train", "eval"], default="selected")
    parser.add_argument("--temporal-crop-size", dest="temporalCropSize", type=int, default=None)
    parser.add_argument("--temporal-loss-weight", dest="temporalLossWeight", type=float, default=0.0, help="Optional paired-frame high-scale delta loss weight.")
    return parser.parse_args()


def load_image(path):
    image = Image.open(path).convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def psnr_from_mse(mse):
    if mse <= 0:
        return float("inf")
    return -10.0 * math.log10(mse)


def assert_pair(pair, corpus_path):
    low = pair.get("low") or {}
    high = pair.get("high") or {}
    if not pair.get("sameStateCaptureId"):
        raise ValueError(f"pair lacks sameStateCaptureId in {corpus_path}: {pair.get('pairId')}")
    if low.get("imageAuthority") != IMAGE_AUTHORITY or high.get("imageAuthority") != IMAGE_AUTHORITY:
        raise ValueError(f"pair lacks clean canvas image authority in {corpus_path}: {pair.get('pairId')}")
    if low.get("sampleAuthority") != "render-only-frozen-sim-state" or high.get("sampleAuthority") != "render-only-frozen-sim-state":
        raise ValueError(f"pair lacks frozen simulator sample authority in {corpus_path}: {pair.get('pairId')}")
    if low.get("frameCount") != high.get("frameCount") or low.get("simStepCount") != high.get("simStepCount"):
        raise ValueError(f"pair is not frame locked in {corpus_path}: {pair.get('pairId')}")
    if low.get("imageWidth") != high.get("imageWidth") or low.get("imageHeight") != high.get("imageHeight"):
        raise ValueError(f"pair image dimensions differ in {corpus_path}: {pair.get('pairId')}")
    if low.get("hudSuppression", {}).get("ok") is not True or high.get("hudSuppression", {}).get("ok") is not True:
        raise ValueError(f"pair lacks HUD suppression receipt in {corpus_path}: {pair.get('pairId')}")
    if not low.get("path") or not high.get("path"):
        raise ValueError(f"pair lacks image paths in {corpus_path}: {pair.get('pairId')}")


def load_pairs(corpus_path, low_render_scale):
    corpus = json.loads(Path(corpus_path).read_text())
    if corpus.get("pairAuthority") != PAIR_AUTHORITY:
        raise ValueError(f"corpus lacks {PAIR_AUTHORITY}: {corpus_path}")
    pairs = []
    for pair in corpus.get("pairs", []):
        if low_render_scale is not None and abs(float(pair.get("lowRenderScale")) - low_render_scale) > 0.015:
            continue
        assert_pair(pair, corpus_path)
        pairs.append(pair)
    if not pairs:
        raise ValueError(f"no pairs selected from {corpus_path}")
    return corpus, sorted(pairs, key=lambda item: (item.get("variantId", ""), item.get("pairId", "")))


def foreground_pixels(low_image, high_image, foregroundThreshold):
    luma_low = np.max(low_image, axis=2)
    luma_high = np.max(high_image, axis=2)
    difference = np.max(np.abs(high_image - low_image), axis=2)
    mask = (luma_low > foregroundThreshold) | (luma_high > foregroundThreshold) | (difference > foregroundThreshold * 0.5)
    return np.argwhere(mask)


def load_pair_arrays(pairs, foregroundThreshold):
    loaded = []
    for pair in pairs:
        low_path = Path(pair["low"]["path"])
        high_path = Path(pair["high"]["path"])
        low_image = load_image(low_path)
        high_image = load_image(high_path)
        if low_image.shape != high_image.shape:
            raise ValueError(f"loaded image shape mismatch: {low_path} vs {high_path}")
        foreground = foreground_pixels(low_image, high_image, foregroundThreshold)
        loaded.append({
            "id": f"{pair.get('variantId')}::{pair.get('pairId')}",
            "low": low_image,
            "high": high_image,
            "foreground": foreground,
            "foregroundPixels": int(foreground.shape[0]),
            "lowPath": str(low_path),
            "highPath": str(high_path),
            "lowRenderScale": float(pair.get("lowRenderScale")),
            "sameStateCaptureId": pair.get("sameStateCaptureId"),
            "temporalSequenceId": pair.get("temporalSequenceId"),
            "temporalFrameIndex": int(pair["temporalFrameIndex"]) if pair.get("temporalFrameIndex") is not None else None,
            "sequenceAuthority": pair.get("sequenceAuthority"),
            "sequenceSettleMs": pair.get("sequenceSettleMs"),
            "sequenceFrameId": pair.get("sequenceFrameId"),
        })
    return loaded


def has_temporal_sequence_metadata(items):
    return any(item.get("temporalSequenceId") and item.get("temporalFrameIndex") is not None for item in items)


def split_pairs(loaded):
    if has_temporal_sequence_metadata(loaded):
        train_items = []
        eval_items = []
        for group in temporal_groups(loaded):
            group = sorted(group, key=temporal_sort_key)
            if len(group) == 1:
                train_items.extend(group)
                eval_items.extend(group)
                continue
            if len(group) == 2:
                train_items.extend(group[:1])
                eval_items.extend(group[1:])
                continue
            if len(group) == 3:
                train_items.extend(group[:2])
                eval_items.extend(group[2:])
                continue
            eval_count = max(2, min(len(group) - 2, len(group) // 4))
            train_items.extend(group[:-eval_count])
            eval_items.extend(group[-eval_count:])
        return train_items, eval_items
    if len(loaded) == 1:
        return loaded, loaded
    eval_count = max(1, min(2, len(loaded) // 4))
    return loaded[:-eval_count], loaded[-eval_count:]


def model_input_from_rgb(low_patch, low_render_scale, conditionRenderScale):
    if not conditionRenderScale:
        return low_patch
    scaleChannel = np.full((*low_patch.shape[:2], 1), float(low_render_scale), dtype=np.float32)
    return np.concatenate([low_patch, scaleChannel], axis=2)


def sample_patch_batch(items, rng, batch_size, patch_size, foregroundProbability, conditionRenderScale):
    lows = []
    highs = []
    for _ in range(batch_size):
        item = items[int(rng.integers(0, len(items)))]
        height, width, _channels = item["low"].shape
        crop_height = min(patch_size, height)
        crop_width = min(patch_size, width)
        foreground = item.get("foreground")
        if foreground is not None and foreground.shape[0] and rng.random() < foregroundProbability:
            center_y, center_x = foreground[int(rng.integers(0, foreground.shape[0]))]
            top = int(np.clip(center_y - crop_height // 2, 0, max(0, height - crop_height)))
            left = int(np.clip(center_x - crop_width // 2, 0, max(0, width - crop_width)))
        else:
            top = int(rng.integers(0, max(1, height - crop_height + 1)))
            left = int(rng.integers(0, max(1, width - crop_width + 1)))
        low_patch = item["low"][top:top + crop_height, left:left + crop_width, :]
        lows.append(model_input_from_rgb(low_patch, item["lowRenderScale"], conditionRenderScale))
        highs.append(item["high"][top:top + crop_height, left:left + crop_width, :])
    return mx.array(np.stack(lows, axis=0)), mx.array(np.stack(highs, axis=0))


def sample_temporal_pair_batch(temporal_pairs, rng, batch_size, patch_size, foregroundProbability, conditionRenderScale):
    previous_lows = []
    current_lows = []
    previous_highs = []
    current_highs = []
    for _ in range(batch_size):
        previous_item, current_item = temporal_pairs[int(rng.integers(0, len(temporal_pairs)))]
        height, width, _channels = current_item["low"].shape
        crop_height = min(patch_size, height)
        crop_width = min(patch_size, width)
        foreground = current_item.get("foreground")
        if (foreground is None or not foreground.shape[0]) and previous_item.get("foreground") is not None:
            foreground = previous_item.get("foreground")
        if foreground is not None and foreground.shape[0] and rng.random() < foregroundProbability:
            center_y, center_x = foreground[int(rng.integers(0, foreground.shape[0]))]
            top = int(np.clip(center_y - crop_height // 2, 0, max(0, height - crop_height)))
            left = int(np.clip(center_x - crop_width // 2, 0, max(0, width - crop_width)))
        else:
            top = int(rng.integers(0, max(1, height - crop_height + 1)))
            left = int(rng.integers(0, max(1, width - crop_width + 1)))
        region = (top, left, crop_height, crop_width)
        _previous_low_rgb, previous_high, previous_model_input = crop_item_arrays(previous_item, region, conditionRenderScale)
        _current_low_rgb, current_high, current_model_input = crop_item_arrays(current_item, region, conditionRenderScale)
        previous_lows.append(previous_model_input)
        current_lows.append(current_model_input)
        previous_highs.append(previous_high)
        current_highs.append(current_high)
    return (
        mx.array(np.stack(previous_lows, axis=0)),
        mx.array(np.stack(current_lows, axis=0)),
        mx.array(np.stack(previous_highs, axis=0)),
        mx.array(np.stack(current_highs, axis=0)),
    )


def mse_value(prediction, target):
    return mx.mean(mx.square(prediction - target))


def rgb_channels(batch):
    return batch[..., :3]


def loss_weight_map(low_batch, high_batch, foregroundThreshold, foregroundLossWeight, differenceLossWeight):
    low_rgb = rgb_channels(low_batch)
    threshold = max(float(foregroundThreshold), 1e-6)
    luma_low = mx.max(low_rgb, axis=3, keepdims=True)
    luma_high = mx.max(high_batch, axis=3, keepdims=True)
    difference = mx.max(mx.abs(high_batch - low_rgb), axis=3, keepdims=True)
    foreground_mask = (luma_low > threshold) | (luma_high > threshold)
    foreground = mx.where(foreground_mask, 1.0, 0.0)
    difference_signal = mx.minimum(difference / threshold, 1.0)
    return 1.0 + max(0.0, float(foregroundLossWeight)) * foreground + max(0.0, float(differenceLossWeight)) * difference_signal


def weighted_mse_value(prediction, target, low_batch, foregroundThreshold, foregroundLossWeight, differenceLossWeight):
    weights = loss_weight_map(low_batch, target, foregroundThreshold, foregroundLossWeight, differenceLossWeight)
    weighted = mx.mean(mx.square(prediction - target) * weights)
    normalizer = mx.maximum(mx.mean(weights), 1e-6)
    return weighted / normalizer


def temporal_loss_value(model_instance, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch):
    previous_prediction = model_instance(previous_low_batch)
    current_prediction = model_instance(current_low_batch)
    prediction_delta = current_prediction - previous_prediction
    target_delta = current_high_batch - previous_high_batch
    return mse_value(prediction_delta, target_delta)


def per_sample_mse(prediction, target):
    error = mx.square(prediction - target)
    return mx.mean(mx.mean(mx.mean(error, axis=3), axis=2), axis=1)


def crop_region(item, crop_size, previewMode):
    low = item["low"]
    height, width, _channels = low.shape
    crop_height = min(crop_size, height)
    crop_width = min(crop_size, width)
    focus = {
        "mode": "center",
        "centerY": height / 2,
        "centerX": width / 2,
        "foregroundPixels": item.get("foregroundPixels", 0),
    }
    if previewMode == "foreground" and item.get("foreground") is not None and item["foreground"].shape[0]:
        center_y, center_x = np.mean(item["foreground"], axis=0)
        focus = {
            "mode": "foreground",
            "centerY": float(center_y),
            "centerX": float(center_x),
            "foregroundPixels": item.get("foregroundPixels", 0),
        }
    top = int(np.clip(focus["centerY"] - crop_height // 2, 0, max(0, height - crop_height)))
    left = int(np.clip(focus["centerX"] - crop_width // 2, 0, max(0, width - crop_width)))
    focus.update({"top": top, "left": left, "height": crop_height, "width": crop_width})
    return top, left, crop_height, crop_width, focus


def crop_item_arrays(item, region, conditionRenderScale):
    top, left, crop_height, crop_width = region
    low_patch = item["low"][top:top + crop_height, left:left + crop_width, :]
    high_patch = item["high"][top:top + crop_height, left:left + crop_width, :]
    model_input = model_input_from_rgb(low_patch, item["lowRenderScale"], conditionRenderScale)
    return low_patch, high_patch, model_input


def predict_patch(model, model_input):
    prediction = model(mx.array(model_input[None, ...]))
    mx.eval(prediction)
    return np.array(prediction[0])


def temporal_scope_items(scope, loaded, train_items, eval_items):
    if scope == "train":
        return train_items
    if scope == "eval":
        return eval_items
    return loaded


def temporal_group_key(item):
    sequence_id = item.get("temporalSequenceId")
    frame_index = item.get("temporalFrameIndex")
    scale_key = f"{item['lowRenderScale']:.3f}"
    if sequence_id and frame_index is not None:
        return f"sequence::{sequence_id}::scale::{scale_key}"
    return f"scale::{scale_key}"


def temporal_sort_key(item):
    frame_index = item.get("temporalFrameIndex")
    if frame_index is None:
        frame_index = 1_000_000_000
    return (int(frame_index), item["id"])


def temporal_groups(items):
    groups = {}
    for item in items:
        key = temporal_group_key(item)
        groups.setdefault(key, []).append(item)
    return [
        sorted(group, key=temporal_sort_key)
        for _key, group in sorted(groups.items())
        if len(group) >= 2
    ]


def temporal_pair_candidates(items):
    pairs = []
    for group in temporal_groups(items):
        for index in range(1, len(group)):
            pairs.append((group[index - 1], group[index]))
    return pairs


def temporal_sequence_metrics(model, loaded, train_items, eval_items, out_dir, crop_size, previewMode, conditionRenderScale, temporalEvalScope):
    scoped_items = temporal_scope_items(temporalEvalScope, loaded, train_items, eval_items)
    groups = temporal_groups(scoped_items)
    if not groups:
        return {
            "temporalEvalScope": temporalEvalScope,
            "temporalPairCount": 0,
            "temporalBaselineDeltaPsnr": None,
            "temporalModelDeltaPsnr": None,
            "temporalDeltaPsnr": None,
            "temporalFlickerAmplification": None,
            "temporalPreview": None,
            "temporalPreviewFocus": None,
        }
    baseline_losses = []
    model_losses = []
    flicker_ratios = []
    temporal_pairs = []
    temporal_preview_path = out_dir / "temporal-preview-low0-low1-model0-model1-target0-target1-delta-diff.png"
    temporal_preview_written = False
    temporal_focus = None
    for group in groups:
        top, left, crop_height, crop_width, focus = crop_region(group[0], crop_size, previewMode)
        region = (top, left, crop_height, crop_width)
        rendered = []
        for item in group:
            low_patch, high_patch, model_input = crop_item_arrays(item, region, conditionRenderScale)
            pred_patch = predict_patch(model, model_input)
            rendered.append((item, low_patch, high_patch, pred_patch))
        for index in range(1, len(rendered)):
            previous_item, previous_low, previous_high, previous_prediction = rendered[index - 1]
            current_item, current_low, current_high, current_prediction = rendered[index]
            target_delta = current_high - previous_high
            baseline_delta = current_low - previous_low
            model_delta = current_prediction - previous_prediction
            baseline_loss = float(np.mean(np.square(baseline_delta - target_delta)))
            model_loss = float(np.mean(np.square(model_delta - target_delta)))
            baseline_losses.append(baseline_loss)
            model_losses.append(model_loss)
            baseline_energy = float(np.mean(np.abs(baseline_delta)))
            model_energy = float(np.mean(np.abs(model_delta)))
            flicker_ratio = model_energy / max(baseline_energy, 1e-8)
            flicker_ratios.append(flicker_ratio)
            temporal_pairs.append({
                "previous": previous_item["id"],
                "current": current_item["id"],
                "lowRenderScale": current_item["lowRenderScale"],
                "temporalSequenceId": current_item.get("temporalSequenceId"),
                "previousTemporalFrameIndex": previous_item.get("temporalFrameIndex"),
                "currentTemporalFrameIndex": current_item.get("temporalFrameIndex"),
                "baselineDeltaMse": baseline_loss,
                "modelDeltaMse": model_loss,
                "temporalDeltaPsnr": psnr_from_mse(model_loss) - psnr_from_mse(baseline_loss),
                "temporalFlickerAmplification": flicker_ratio,
            })
            if not temporal_preview_written:
                delta_diff = np.clip(np.abs(model_delta - target_delta) * 4.0, 0.0, 1.0)
                strip = np.concatenate([
                    previous_low,
                    current_low,
                    previous_prediction,
                    current_prediction,
                    previous_high,
                    current_high,
                    delta_diff,
                ], axis=1)
                Image.fromarray(np.clip(strip * 255.0, 0, 255).astype(np.uint8), "RGB").save(temporal_preview_path)
                temporal_focus = focus
                temporal_preview_written = True
    baseline_mse = float(np.mean(baseline_losses))
    model_mse = float(np.mean(model_losses))
    return {
        "temporalEvalScope": temporalEvalScope,
        "temporalPairCount": len(temporal_pairs),
        "temporalBaselineDeltaMse": baseline_mse,
        "temporalModelDeltaMse": model_mse,
        "temporalBaselineDeltaPsnr": psnr_from_mse(baseline_mse),
        "temporalModelDeltaPsnr": psnr_from_mse(model_mse),
        "temporalDeltaPsnr": psnr_from_mse(model_mse) - psnr_from_mse(baseline_mse),
        "temporalFlickerAmplification": float(np.mean(flicker_ratios)),
        "temporalPairs": temporal_pairs,
        "temporalPreview": str(temporal_preview_path) if temporal_preview_written else None,
        "temporalPreviewFocus": temporal_focus,
    }


def evaluate_model(model, items, rng, batch_size, patch_size, eval_patches, foregroundProbability, conditionRenderScale, foregroundThreshold, foregroundLossWeight, differenceLossWeight):
    baseline_losses = []
    model_losses = []
    weighted_baseline_losses = []
    weighted_model_losses = []
    improved_patches = 0
    compared_patches = 0
    batches = max(1, math.ceil(eval_patches / batch_size))
    for _ in range(batches):
        low_batch, high_batch = sample_patch_batch(items, rng, batch_size, patch_size, foregroundProbability, conditionRenderScale)
        low_rgb = rgb_channels(low_batch)
        prediction = model(low_batch)
        baseline_loss = mse_value(low_rgb, high_batch)
        model_loss = mse_value(prediction, high_batch)
        weighted_baseline_loss = weighted_mse_value(low_rgb, high_batch, low_batch, foregroundThreshold, foregroundLossWeight, differenceLossWeight)
        weighted_model_loss = weighted_mse_value(prediction, high_batch, low_batch, foregroundThreshold, foregroundLossWeight, differenceLossWeight)
        baseline_sample_mse = per_sample_mse(low_rgb, high_batch)
        model_sample_mse = per_sample_mse(prediction, high_batch)
        mx.eval(baseline_loss, model_loss, weighted_baseline_loss, weighted_model_loss, baseline_sample_mse, model_sample_mse)
        baseline_losses.append(float(baseline_loss))
        model_losses.append(float(model_loss))
        weighted_baseline_losses.append(float(weighted_baseline_loss))
        weighted_model_losses.append(float(weighted_model_loss))
        improved_patches += int(np.sum(np.array(model_sample_mse) < np.array(baseline_sample_mse)))
        compared_patches += int(np.array(model_sample_mse).shape[0])
    baseline_mse = float(np.mean(baseline_losses))
    model_mse = float(np.mean(model_losses))
    weighted_baseline_mse = float(np.mean(weighted_baseline_losses))
    weighted_model_mse = float(np.mean(weighted_model_losses))
    return {
        "baselineMse": baseline_mse,
        "modelMse": model_mse,
        "baselinePsnr": psnr_from_mse(baseline_mse),
        "modelPsnr": psnr_from_mse(model_mse),
        "deltaPsnr": psnr_from_mse(model_mse) - psnr_from_mse(baseline_mse),
        "weightedBaselineMse": weighted_baseline_mse,
        "weightedModelMse": weighted_model_mse,
        "weightedBaselinePsnr": psnr_from_mse(weighted_baseline_mse),
        "weightedModelPsnr": psnr_from_mse(weighted_model_mse),
        "weightedDeltaPsnr": psnr_from_mse(weighted_model_mse) - psnr_from_mse(weighted_baseline_mse),
        "improvedPatchFraction": improved_patches / max(1, compared_patches),
    }


def make_preview(model, eval_item, out_path, preview_size, previewMode, conditionRenderScale):
    low = eval_item["low"]
    high = eval_item["high"]
    top, left, crop_height, crop_width, previewFocus = crop_region(eval_item, preview_size, previewMode)
    low_patch = low[top:top + crop_height, left:left + crop_width, :]
    high_patch = high[top:top + crop_height, left:left + crop_width, :]
    model_input = model_input_from_rgb(low_patch, eval_item["lowRenderScale"], conditionRenderScale)
    pred_patch = predict_patch(model, model_input)
    diff_patch = np.clip(np.abs(pred_patch - high_patch) * 4.0, 0.0, 1.0)
    strip = np.concatenate([low_patch, pred_patch, high_patch, diff_patch], axis=1)
    Image.fromarray(np.clip(strip * 255.0, 0, 255).astype(np.uint8), "RGB").save(out_path)
    return previewFocus


def main():
    args = parse_args()
    if args.temporalLossWeight < 0:
        raise ValueError("--temporal-loss-weight must be non-negative")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    corpus, pairs = load_pairs(args.corpus_manifest, args.low_render_scale)
    loaded = load_pair_arrays(pairs, args.foregroundThreshold)
    train_items, eval_items = split_pairs(loaded)
    rng = np.random.default_rng(args.seed)
    mx.random.seed(args.seed)
    input_channels = 4 if args.conditionRenderScale else 3
    scaleChannel = "lowRenderScale" if args.conditionRenderScale else None
    model = TinyResidualUpscaler(args.hidden_channels, input_channels)
    optimizer = optim.Adam(learning_rate=args.learning_rate)
    temporalTrainPairCount = len(temporal_pair_candidates(train_items))
    temporalEvalPairCount = len(temporal_pair_candidates(eval_items))
    temporalSelectedPairCount = len(temporal_pair_candidates(loaded))
    temporal_loss_pairs = temporal_pair_candidates(train_items)
    temporalLossFallback = None
    if args.temporalLossWeight > 0 and not temporal_loss_pairs:
        temporal_loss_pairs = temporal_pair_candidates(loaded)
        temporalLossFallback = "selected-pairs-no-train-adjacent" if temporal_loss_pairs else "no-adjacent-same-scale-pairs"
    temporalLossPairCount = len(temporal_loss_pairs)
    activeTemporalLossWeight = args.temporalLossWeight if temporalLossPairCount else 0.0

    def loss_fn(model_instance, low_batch, high_batch, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch):
        prediction = model_instance(low_batch)
        if args.loss_mode == "weighted":
            still_loss = weighted_mse_value(
                prediction,
                high_batch,
                low_batch,
                args.foregroundThreshold,
                args.foregroundLossWeight,
                args.differenceLossWeight,
            )
        else:
            still_loss = mse_value(prediction, high_batch)
        if activeTemporalLossWeight > 0:
            return still_loss + activeTemporalLossWeight * temporal_loss_value(
                model_instance,
                previous_low_batch,
                current_low_batch,
                previous_high_batch,
                current_high_batch,
            )
        return still_loss

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    training_losses = []
    temporalTrainingLosses = []
    started = time.time()
    for step in range(max(0, args.maxSteps)):
        low_batch, high_batch = sample_patch_batch(train_items, rng, args.batch_size, args.patch_size, args.foregroundProbability, args.conditionRenderScale)
        if activeTemporalLossWeight > 0:
            previous_low_batch, current_low_batch, previous_high_batch, current_high_batch = sample_temporal_pair_batch(
                temporal_loss_pairs,
                rng,
                args.batch_size,
                args.patch_size,
                args.foregroundProbability,
                args.conditionRenderScale,
            )
        else:
            previous_low_batch = low_batch
            current_low_batch = low_batch
            previous_high_batch = high_batch
            current_high_batch = high_batch
        loss, grads = loss_and_grad(model, low_batch, high_batch, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), optimizer.state, loss)
        loss_float = float(loss)
        if step == 0 or step == args.maxSteps - 1 or (step + 1) % max(1, args.maxSteps // 10) == 0:
            entry = {"step": step + 1, "loss": loss_float}
            if activeTemporalLossWeight > 0:
                temporal_loss = temporal_loss_value(model, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch)
                mx.eval(temporal_loss)
                temporal_loss_float = float(temporal_loss)
                entry["temporalLoss"] = temporal_loss_float
                temporalTrainingLosses.append({"step": step + 1, "temporalLoss": temporal_loss_float})
            training_losses.append(entry)
            print(json.dumps(entry))
        if args.sleepMs > 0:
            time.sleep(args.sleepMs / 1000.0)
    duration_seconds = time.time() - started
    eval_rng = np.random.default_rng(args.seed + 1000)
    metrics = evaluate_model(
        model,
        eval_items,
        eval_rng,
        args.batch_size,
        args.patch_size,
        args.eval_patches,
        args.foregroundProbability,
        args.conditionRenderScale,
        args.foregroundThreshold,
        args.foregroundLossWeight,
        args.differenceLossWeight,
    )
    preview_path = out_dir / "residual-preview-low-model-target-diff.png"
    previewFocus = make_preview(model, eval_items[0], preview_path, args.preview_size, args.preview_mode, args.conditionRenderScale)
    temporalMetrics = {}
    if args.temporalEval:
        temporalMetrics = temporal_sequence_metrics(
            model,
            loaded,
            train_items,
            eval_items,
            out_dir,
            args.temporalCropSize or args.preview_size,
            args.preview_mode,
            args.conditionRenderScale,
            args.temporalEvalScope,
        )
    report = {
        "schema": SCHEMA,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "corpusManifest": str(Path(args.corpus_manifest).resolve()),
        "corpusSchema": corpus.get("schema"),
        "pairAuthority": corpus.get("pairAuthority"),
        "imageAuthority": corpus.get("imageAuthority"),
        "lowRenderScale": args.low_render_scale,
        "seed": args.seed,
        "seededRandomGenerators": ["numpy.default_rng", "mlx.core.random"],
        "selectedPairCount": len(loaded),
        "trainPairCount": len(train_items),
        "evalPairCount": len(eval_items),
        "trainPairs": [item["id"] for item in train_items],
        "evalPairs": [item["id"] for item in eval_items],
        "temporalSequenceCount": len({
            item.get("temporalSequenceId")
            for item in loaded
            if item.get("temporalSequenceId")
        }),
        "temporalTrainPairCount": temporalTrainPairCount,
        "temporalEvalPairCount": temporalEvalPairCount,
        "temporalSelectedPairCount": temporalSelectedPairCount,
        "maxSteps": args.maxSteps,
        "sleepMs": args.sleepMs,
        "lossMode": args.loss_mode,
        "foregroundThreshold": args.foregroundThreshold,
        "foregroundProbability": args.foregroundProbability,
        "foregroundLossWeight": args.foregroundLossWeight,
        "differenceLossWeight": args.differenceLossWeight,
        "conditionRenderScale": args.conditionRenderScale,
        "temporalLossWeight": args.temporalLossWeight,
        "activeTemporalLossWeight": activeTemporalLossWeight,
        "temporalLossPairCount": temporalLossPairCount,
        "temporalLossPairs": [
            {
                "previous": previous_item["id"],
                "current": current_item["id"],
                "lowRenderScale": current_item["lowRenderScale"],
            }
            for previous_item, current_item in temporal_loss_pairs
        ],
        "temporalLossFallback": temporalLossFallback,
        "previewMode": args.preview_mode,
        "previewFocus": previewFocus,
        "temporalEval": args.temporalEval,
        "temporalEvalScope": args.temporalEvalScope,
        "inputChannels": input_channels,
        "scaleChannel": scaleChannel,
        "foregroundPixels": {
            item["id"]: item["foregroundPixels"]
            for item in loaded
        },
        "batchSize": args.batch_size,
        "patchSize": args.patch_size,
        "hiddenChannels": args.hidden_channels,
        "learningRate": args.learning_rate,
        "evalPatches": args.eval_patches,
        "durationSeconds": duration_seconds,
        "device": str(mx.default_device()),
        "trainingLosses": training_losses,
        "temporalTrainingLosses": temporalTrainingLosses,
        **metrics,
        **temporalMetrics,
        "preview": str(preview_path),
    }
    report_path = out_dir / "residual-report.json"
    report_path.write_text(json.dumps(report, indent=2))
    print(json.dumps({
        "report": str(report_path),
        "preview": str(preview_path),
        "baselinePsnr": report["baselinePsnr"],
        "modelPsnr": report["modelPsnr"],
        "deltaPsnr": report["deltaPsnr"],
        "durationSeconds": duration_seconds,
    }, indent=2))


if __name__ == "__main__":
    main()
