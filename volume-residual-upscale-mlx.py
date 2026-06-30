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
    def __init__(self, hidden_channels):
        super().__init__()
        self.input = nn.Conv2d(3, hidden_channels, kernel_size=3, padding=1)
        self.mid_a = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.mid_b = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.output = nn.Conv2d(hidden_channels, 3, kernel_size=3, padding=1)
        self.output.weight = mx.zeros_like(self.output.weight)
        self.output.bias = mx.zeros_like(self.output.bias)

    def __call__(self, image):
        hidden = nn.relu(self.input(image))
        hidden = nn.relu(self.mid_a(hidden))
        hidden = nn.relu(self.mid_b(hidden))
        residual = self.output(hidden)
        return mx.clip(image + residual * 0.25, 0.0, 1.0)


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
    parser.add_argument("--seed", type=int, default=630)
    parser.add_argument("--sleep-ms", dest="sleepMs", type=float, default=0.0, help="Optional per-step sleep throttle for contention control.")
    parser.add_argument("--foreground-threshold", dest="foregroundThreshold", type=float, default=0.025)
    parser.add_argument("--foreground-probability", dest="foregroundProbability", type=float, default=0.85)
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
            "lowRenderScale": pair.get("lowRenderScale"),
            "sameStateCaptureId": pair.get("sameStateCaptureId"),
        })
    return loaded


def split_pairs(loaded):
    if len(loaded) == 1:
        return loaded, loaded
    eval_count = max(1, min(2, len(loaded) // 4))
    return loaded[:-eval_count], loaded[-eval_count:]


def sample_patch_batch(items, rng, batch_size, patch_size, foregroundProbability):
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
        lows.append(item["low"][top:top + crop_height, left:left + crop_width, :])
        highs.append(item["high"][top:top + crop_height, left:left + crop_width, :])
    return mx.array(np.stack(lows, axis=0)), mx.array(np.stack(highs, axis=0))


def mse_value(prediction, target):
    return mx.mean(mx.square(prediction - target))


def evaluate_model(model, items, rng, batch_size, patch_size, eval_patches, foregroundProbability):
    baseline_losses = []
    model_losses = []
    batches = max(1, math.ceil(eval_patches / batch_size))
    for _ in range(batches):
        low_batch, high_batch = sample_patch_batch(items, rng, batch_size, patch_size, foregroundProbability)
        prediction = model(low_batch)
        baseline_loss = mse_value(low_batch, high_batch)
        model_loss = mse_value(prediction, high_batch)
        mx.eval(baseline_loss, model_loss)
        baseline_losses.append(float(baseline_loss))
        model_losses.append(float(model_loss))
    baseline_mse = float(np.mean(baseline_losses))
    model_mse = float(np.mean(model_losses))
    return {
        "baselineMse": baseline_mse,
        "modelMse": model_mse,
        "baselinePsnr": psnr_from_mse(baseline_mse),
        "modelPsnr": psnr_from_mse(model_mse),
        "deltaPsnr": psnr_from_mse(model_mse) - psnr_from_mse(baseline_mse),
    }


def make_preview(model, eval_item, out_path, preview_size):
    low = eval_item["low"]
    high = eval_item["high"]
    height, width, _channels = low.shape
    crop_height = min(preview_size, height)
    crop_width = min(preview_size, width)
    top = max(0, (height - crop_height) // 2)
    left = max(0, (width - crop_width) // 2)
    low_patch = low[top:top + crop_height, left:left + crop_width, :]
    high_patch = high[top:top + crop_height, left:left + crop_width, :]
    prediction = model(mx.array(low_patch[None, ...]))
    mx.eval(prediction)
    pred_patch = np.array(prediction[0])
    diff_patch = np.clip(np.abs(pred_patch - high_patch) * 4.0, 0.0, 1.0)
    strip = np.concatenate([low_patch, pred_patch, high_patch, diff_patch], axis=1)
    Image.fromarray(np.clip(strip * 255.0, 0, 255).astype(np.uint8), "RGB").save(out_path)


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    corpus, pairs = load_pairs(args.corpus_manifest, args.low_render_scale)
    loaded = load_pair_arrays(pairs, args.foregroundThreshold)
    train_items, eval_items = split_pairs(loaded)
    rng = np.random.default_rng(args.seed)
    model = TinyResidualUpscaler(args.hidden_channels)
    optimizer = optim.Adam(learning_rate=args.learning_rate)

    def loss_fn(model_instance, low_batch, high_batch):
        prediction = model_instance(low_batch)
        return mse_value(prediction, high_batch)

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    training_losses = []
    started = time.time()
    for step in range(max(0, args.maxSteps)):
        low_batch, high_batch = sample_patch_batch(train_items, rng, args.batch_size, args.patch_size, args.foregroundProbability)
        loss, grads = loss_and_grad(model, low_batch, high_batch)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), optimizer.state, loss)
        loss_float = float(loss)
        if step == 0 or step == args.maxSteps - 1 or (step + 1) % max(1, args.maxSteps // 10) == 0:
            training_losses.append({"step": step + 1, "loss": loss_float})
            print(json.dumps({"step": step + 1, "loss": loss_float}))
        if args.sleepMs > 0:
            time.sleep(args.sleepMs / 1000.0)
    duration_seconds = time.time() - started
    eval_rng = np.random.default_rng(args.seed + 1000)
    metrics = evaluate_model(model, eval_items, eval_rng, args.batch_size, args.patch_size, args.eval_patches, args.foregroundProbability)
    preview_path = out_dir / "residual-preview-low-model-target-diff.png"
    make_preview(model, eval_items[0], preview_path, args.preview_size)
    report = {
        "schema": SCHEMA,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "corpusManifest": str(Path(args.corpus_manifest).resolve()),
        "corpusSchema": corpus.get("schema"),
        "pairAuthority": corpus.get("pairAuthority"),
        "imageAuthority": corpus.get("imageAuthority"),
        "lowRenderScale": args.low_render_scale,
        "selectedPairCount": len(loaded),
        "trainPairCount": len(train_items),
        "evalPairCount": len(eval_items),
        "trainPairs": [item["id"] for item in train_items],
        "evalPairs": [item["id"] for item in eval_items],
        "maxSteps": args.maxSteps,
        "sleepMs": args.sleepMs,
        "foregroundThreshold": args.foregroundThreshold,
        "foregroundProbability": args.foregroundProbability,
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
        **metrics,
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
