#!/usr/bin/env python3
import argparse
import hashlib
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
MODEL_ARTIFACT_SCHEMA = "kaminos.volume.residual-upscale-model-artifact.v0"
MODEL_ARTIFACT_AUTHORITY = "offline-mlx-residual-upscaler-weights-v0"
PAIR_AUTHORITY = "frame-locked-render-scale-set-v0"
IMAGE_AUTHORITY = "cdp-canvas-clip-capture-after-render-only-frozen-sim-state"
FEATURE_INPUT_AUTHORITY = "shader-material-authority-residual-feature-v0"
FLOW_DEBUG_AUXILIARY_INPUT_AUTHORITY = "flow-debug-interface-canvas-capture-v0"
IMAGE_FEATURE_INPUT_MODES = {"feature-rgba", "aux-rgba"}


def constrain_residual_color(residual, residualColorMode, chromaResidualScale):
    if residualColorMode == "luma-chroma":
        luma_residual = mx.mean(residual, axis=3, keepdims=True)
        chroma_residual = residual - luma_residual
        return luma_residual + chroma_residual * float(chromaResidualScale)
    return residual


def apply_limited_residual(base_image, residual, residualOutputLimit, residualApplicationMask=None, residualColorMode="rgb", chromaResidualScale=1.0):
    color_residual = constrain_residual_color(residual, residualColorMode, chromaResidualScale)
    scaled_residual = color_residual * 0.25
    if residualApplicationMask is not None:
        scaled_residual = scaled_residual * mx.clip(residualApplicationMask, 0.0, 1.0)
    if residualOutputLimit and residualOutputLimit > 0:
        scaled_residual = mx.clip(scaled_residual, -float(residualOutputLimit), float(residualOutputLimit))
    return mx.clip(base_image + scaled_residual, 0.0, 1.0)


def feather_residual_mask(mask, featherRadius):
    if mask is None:
        return None
    radius = max(0, int(featherRadius))
    clipped = mx.clip(mask, 0.0, 1.0)
    if radius == 0:
        return clipped
    padded = mx.pad(clipped, [(0, 0), (radius, radius), (radius, radius), (0, 0)])
    height = clipped.shape[1]
    width = clipped.shape[2]
    softened = clipped
    for offset_y in range(-radius, radius + 1):
        for offset_x in range(-radius, radius + 1):
            distance = max(abs(offset_y), abs(offset_x))
            weight = max(0.0, 1.0 - (distance / float(radius + 1)))
            if weight <= 0:
                continue
            shifted = padded[:, radius + offset_y:radius + offset_y + height, radius + offset_x:radius + offset_x + width, :]
            softened = mx.maximum(softened, shifted * weight)
    return mx.clip(softened, 0.0, 1.0)


class TinyResidualUpscaler(nn.Module):
    def __init__(self, hidden_channels, input_channels, residual_output_limit, residual_color_mode, chroma_residual_scale):
        super().__init__()
        self.residualOutputLimit = float(residual_output_limit)
        self.residualColorMode = residual_color_mode
        self.chromaResidualScale = float(chroma_residual_scale)
        self.input = nn.Conv2d(input_channels, hidden_channels, kernel_size=3, padding=1)
        self.mid_a = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.mid_b = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.output = nn.Conv2d(hidden_channels, 3, kernel_size=3, padding=1)
        self.output.weight = mx.zeros_like(self.output.weight)
        self.output.bias = mx.zeros_like(self.output.bias)

    def __call__(self, image, residualApplicationMask=None):
        base_image = image[..., :3]
        hidden = nn.relu(self.input(image))
        hidden = nn.relu(self.mid_a(hidden))
        hidden = nn.relu(self.mid_b(hidden))
        residual = self.output(hidden)
        return apply_limited_residual(base_image, residual, self.residualOutputLimit, residualApplicationMask, self.residualColorMode, self.chromaResidualScale)


class DirectResidualUpscaler(nn.Module):
    def __init__(self, input_channels, residual_output_limit, residual_color_mode, chroma_residual_scale):
        super().__init__()
        self.residualOutputLimit = float(residual_output_limit)
        self.residualColorMode = residual_color_mode
        self.chromaResidualScale = float(chroma_residual_scale)
        self.output = nn.Conv2d(input_channels, 3, kernel_size=3, padding=1)
        self.output.weight = mx.zeros_like(self.output.weight)
        self.output.bias = mx.zeros_like(self.output.bias)

    def __call__(self, image, residualApplicationMask=None):
        base_image = image[..., :3]
        residual = self.output(image)
        return apply_limited_residual(base_image, residual, self.residualOutputLimit, residualApplicationMask, self.residualColorMode, self.chromaResidualScale)


class HybridResidualUpscaler(nn.Module):
    def __init__(self, hidden_channels, input_channels, residual_output_limit, residual_color_mode, chroma_residual_scale):
        super().__init__()
        self.residualOutputLimit = float(residual_output_limit)
        self.residualColorMode = residual_color_mode
        self.chromaResidualScale = float(chroma_residual_scale)
        self.direct_output = nn.Conv2d(input_channels, 3, kernel_size=3, padding=1)
        self.detail_input = nn.Conv2d(input_channels, hidden_channels, kernel_size=3, padding=1)
        self.detail_mid_a = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.detail_mid_b = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.detail_output = nn.Conv2d(hidden_channels, 3, kernel_size=3, padding=1)
        self.direct_output.weight = mx.zeros_like(self.direct_output.weight)
        self.direct_output.bias = mx.zeros_like(self.direct_output.bias)
        self.detail_output.weight = mx.zeros_like(self.detail_output.weight)
        self.detail_output.bias = mx.zeros_like(self.detail_output.bias)

    def __call__(self, image, residualApplicationMask=None):
        base_image = image[..., :3]
        direct_residual = self.direct_output(image)
        detail = nn.relu(self.detail_input(image))
        detail = nn.relu(self.detail_mid_a(detail))
        detail = nn.relu(self.detail_mid_b(detail))
        detail_residual = self.detail_output(detail)
        return apply_limited_residual(base_image, direct_residual + detail_residual, self.residualOutputLimit, residualApplicationMask, self.residualColorMode, self.chromaResidualScale)


class GatedDetailResidualUpscaler(nn.Module):
    def __init__(self, hidden_channels, input_channels, detail_gate, residual_output_limit, residual_color_mode, chroma_residual_scale):
        super().__init__()
        self.detailGate = float(detail_gate)
        self.residualOutputLimit = float(residual_output_limit)
        self.residualColorMode = residual_color_mode
        self.chromaResidualScale = float(chroma_residual_scale)
        self.direct_output = nn.Conv2d(input_channels, 3, kernel_size=3, padding=1)
        self.detail_input = nn.Conv2d(input_channels, hidden_channels, kernel_size=3, padding=1)
        self.detail_mid_a = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.detail_mid_b = nn.Conv2d(hidden_channels, hidden_channels, kernel_size=3, padding=1)
        self.detail_output = nn.Conv2d(hidden_channels, 3, kernel_size=3, padding=1)
        self.direct_output.weight = mx.zeros_like(self.direct_output.weight)
        self.direct_output.bias = mx.zeros_like(self.direct_output.bias)
        self.detail_output.weight = mx.zeros_like(self.detail_output.weight)
        self.detail_output.bias = mx.zeros_like(self.detail_output.bias)

    def __call__(self, image, residualApplicationMask=None):
        base_image = image[..., :3]
        direct_residual = self.direct_output(image)
        detail = nn.relu(self.detail_input(image))
        detail = nn.relu(self.detail_mid_a(detail))
        detail = nn.relu(self.detail_mid_b(detail))
        detail_residual = self.detail_output(detail) * self.detailGate
        return apply_limited_residual(base_image, direct_residual + detail_residual, self.residualOutputLimit, residualApplicationMask, self.residualColorMode, self.chromaResidualScale)


def parse_args():
    parser = argparse.ArgumentParser(description="Tiny MLX residual-upscale smoke for Kaminos frame-locked render pairs.")
    parser.add_argument("--corpus-manifest", required=True, help="Path to corpus-manifest.json from frame-locked render-pair captures.")
    parser.add_argument("--out-dir", required=True, help="Directory for report and preview artifacts.")
    parser.add_argument("--low-render-scale", type=float, default=None, help="Optional low render scale filter, e.g. 0.25.")
    parser.add_argument("--max-steps", dest="maxSteps", type=int, default=120, help="Bounded training steps for contention control.")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--patch-size", type=int, default=96)
    parser.add_argument("--model-arch", dest="modelArch", choices=["tiny-conv", "direct-residual", "hybrid-residual", "gated-detail-residual"], default="tiny-conv")
    parser.add_argument("--feature-input-mode", dest="featureInputMode", choices=["rgb", "feature-rgba", "aux-rgba"], default="rgb", help="Model input source: low RGB only, low RGB plus shader/material residual feature RGBA, or low RGB plus auxiliary debug RGBA.")
    parser.add_argument("--hidden-channels", type=int, default=16)
    parser.add_argument("--detail-residual-gate", dest="detailResidualGate", type=float, default=2.0, help="Fixed multiplier for the hidden detail residual in gated-detail-residual probes.")
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--eval-patches", type=int, default=64)
    parser.add_argument("--preview-size", type=int, default=384)
    parser.add_argument("--preview-mode", choices=["center", "foreground", "edge-band", "full-frame"], default="center")
    parser.add_argument("--preview-frame-count", dest="previewFrameCount", type=int, default=1, help="Number of eval-item preview frames to emit for product-view witnesses.")
    parser.add_argument("--seed", type=int, default=630)
    parser.add_argument("--sleep-ms", dest="sleepMs", type=float, default=0.0, help="Optional per-step sleep throttle for contention control.")
    parser.add_argument("--foreground-threshold", dest="foregroundThreshold", type=float, default=0.025)
    parser.add_argument("--foreground-probability", dest="foregroundProbability", type=float, default=0.85)
    parser.add_argument("--loss-mode", choices=["mse", "weighted"], default="mse")
    parser.add_argument("--foreground-loss-weight", dest="foregroundLossWeight", type=float, default=0.0)
    parser.add_argument("--difference-loss-weight", dest="differenceLossWeight", type=float, default=0.0)
    parser.add_argument("--edge-band-mode", dest="edgeBandMode", choices=["off", "difference", "gradient", "difference-gradient", "low-gradient", "low-luma", "low-gradient-luma"], default="off", help="Derive edge bands from target low/high pairs or inference-available low-image proxy signals for sampling, loss, metrics, and previews.")
    parser.add_argument("--edge-band-threshold", dest="edgeBandThreshold", type=float, default=0.03)
    parser.add_argument("--edge-band-dilate", dest="edgeBandDilate", type=int, default=2)
    parser.add_argument("--edge-sampling-probability", dest="edgeSamplingProbability", type=float, default=0.0)
    parser.add_argument("--edge-loss-weight", dest="edgeLossWeight", type=float, default=0.0)
    parser.add_argument("--edge-gradient-loss-weight", dest="edgeGradientLossWeight", type=float, default=0.0)
    parser.add_argument("--outside-edge-residual-weight", dest="outsideEdgeResidualWeight", type=float, default=0.0)
    parser.add_argument("--residual-output-limit", dest="residualOutputLimit", type=float, default=0.0, help="Optional symmetric clamp on the scaled RGB residual before adding it to the low image; 0 disables the clamp.")
    parser.add_argument("--residual-color-mode", dest="residualColorMode", choices=["rgb", "luma-chroma"], default="rgb", help="Optionally decompose learned residuals into luma plus scaled chroma before applying them.")
    parser.add_argument("--chroma-residual-scale", dest="chromaResidualScale", type=float, default=1.0, help="Chroma multiplier used when --residual-color-mode=luma-chroma.")
    parser.add_argument("--chroma-residual-loss-weight", dest="chromaResidualLossWeight", type=float, default=0.0, help="Optional active-edge penalty on chromatic residual energy.")
    parser.add_argument("--residual-application-mask-mode", dest="residualApplicationMaskMode", choices=["off", "active-edge-band", "soft-active-edge-band"], default="off", help="Optionally multiply the applied residual by the active edge-band mask; low-* edge-band modes are inference-available, target-derived modes are teacher-only upper bounds.")
    parser.add_argument("--residual-mask-feather-radius", dest="residualMaskFeatherRadius", type=int, default=0, help="Optional pixel radius for soft-active-edge-band residual application masks.")
    parser.add_argument("--residual-smoothness-loss-weight", dest="residualSmoothnessLossWeight", type=float, default=0.0, help="Optional smoothness loss on the applied residual to suppress ringing artifacts.")
    parser.add_argument("--condition-render-scale", dest="conditionRenderScale", action="store_true")
    parser.add_argument("--temporal-eval", dest="temporalEval", action="store_true")
    parser.add_argument("--temporal-eval-scope", dest="temporalEvalScope", choices=["selected", "train", "eval"], default="selected")
    parser.add_argument("--temporal-crop-size", dest="temporalCropSize", type=int, default=None)
    parser.add_argument("--temporal-loss-weight", dest="temporalLossWeight", type=float, default=0.0, help="Optional paired-frame high-scale delta loss weight.")
    parser.add_argument("--residual-temporal-loss-weight", dest="residualTemporalLossWeight", type=float, default=0.0, help="Optional paired-frame residual-delta damping loss weight.")
    parser.add_argument("--residual-continuation-mode", dest="residualContinuationMode", choices=["none", "ema"], default="none", help="Optional inference-time residual continuation mode for temporal evaluation.")
    parser.add_argument("--residual-continuation-alpha", dest="residualContinuationAlpha", type=float, default=1.0, help="EMA current-residual weight for residual continuation; 1.0 is raw model output.")
    parser.add_argument("--save-model-dir", dest="saveModelDir", default=None, help="Optional directory for a reusable residual-upscaler model artifact.")
    parser.add_argument("--load-model-dir", dest="loadModelDir", default=None, help="Optional directory containing a saved residual-upscaler model artifact.")
    parser.add_argument("--eval-only", dest="evalOnly", action="store_true", help="Evaluate a loaded model artifact without training or optimizer updates.")
    return parser.parse_args()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_model(model_arch, hidden_channels, input_channels, detail_gate, residual_output_limit, residual_color_mode, chroma_residual_scale):
    if model_arch == "tiny-conv":
        return TinyResidualUpscaler(hidden_channels, input_channels, residual_output_limit, residual_color_mode, chroma_residual_scale)
    if model_arch == "direct-residual":
        return DirectResidualUpscaler(input_channels, residual_output_limit, residual_color_mode, chroma_residual_scale)
    if model_arch == "hybrid-residual":
        return HybridResidualUpscaler(hidden_channels, input_channels, residual_output_limit, residual_color_mode, chroma_residual_scale)
    if model_arch == "gated-detail-residual":
        return GatedDetailResidualUpscaler(hidden_channels, input_channels, detail_gate, residual_output_limit, residual_color_mode, chroma_residual_scale)
    raise ValueError(f"unsupported model architecture: {model_arch}")


def model_config(model_arch, hidden_channels, input_channels, condition_render_scale, scale_channel, feature_input_mode, detail_gate, residual_output_limit, residual_application_mask_mode, residual_mask_feather_radius, residual_color_mode, chroma_residual_scale):
    return {
        "modelArch": model_arch,
        "hiddenChannels": hidden_channels,
        "inputChannels": input_channels,
        "conditionRenderScale": condition_render_scale,
        "scaleChannel": scale_channel,
        "featureInputMode": feature_input_mode,
        "featureInputAuthority": feature_input_authority(feature_input_mode),
        "featureInputChannels": feature_input_channels(feature_input_mode),
        "detailGate": detail_gate if model_arch == "gated-detail-residual" else None,
        "residualOutputLimit": residual_output_limit,
        "residualApplicationMaskMode": residual_application_mask_mode,
        "residualMaskFeatherRadius": residual_mask_feather_radius,
        "residualColorMode": residual_color_mode,
        "chromaResidualScale": chroma_residual_scale,
    }


def artifact_manifest_path(model_dir):
    return Path(model_dir) / "model-artifact.json"


def save_model_artifact(model, model_dir, config, args, corpus, metrics, effective_max_steps, model_config_source):
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    weights_path = model_dir / "weights.safetensors"
    model.save_weights(str(weights_path))
    weights_sha256 = sha256_file(weights_path)
    manifest = {
        "schema": MODEL_ARTIFACT_SCHEMA,
        "authority": MODEL_ARTIFACT_AUTHORITY,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "weights": {
            "path": str(weights_path.resolve()),
            "filename": weights_path.name,
            "sha256": weights_sha256,
            "bytes": weights_path.stat().st_size,
        },
        "model": config,
        "training": {
            "seed": args.seed,
            "requestedMaxSteps": args.maxSteps,
            "effectiveMaxSteps": effective_max_steps,
            "evalOnly": args.evalOnly,
            "batchSize": args.batch_size,
            "patchSize": args.patch_size,
            "learningRate": args.learning_rate,
            "lossMode": args.loss_mode,
            "modelConfigSource": model_config_source,
            "featureInputMode": config.get("featureInputMode"),
            "featureInputAuthority": config.get("featureInputAuthority"),
            "featureInputChannels": config.get("featureInputChannels"),
            "foregroundThreshold": args.foregroundThreshold,
            "foregroundProbability": args.foregroundProbability,
            "foregroundLossWeight": args.foregroundLossWeight,
            "differenceLossWeight": args.differenceLossWeight,
            "edgeBandMode": args.edgeBandMode,
            "edgeBandAuthority": edge_band_authority(args.edgeBandMode),
            "edgeBandThreshold": args.edgeBandThreshold,
            "edgeBandDilate": args.edgeBandDilate,
            "edgeSamplingProbability": args.edgeSamplingProbability,
            "edgeLossWeight": args.edgeLossWeight,
            "edgeGradientLossWeight": args.edgeGradientLossWeight,
            "outsideEdgeResidualWeight": args.outsideEdgeResidualWeight,
            "residualOutputLimit": args.residualOutputLimit,
            "residualColorMode": args.residualColorMode,
            "chromaResidualScale": args.chromaResidualScale,
            "chromaResidualLossWeight": args.chromaResidualLossWeight,
            "residualApplicationMaskMode": args.residualApplicationMaskMode,
            "residualMaskFeatherRadius": args.residualMaskFeatherRadius,
            "residualApplicationMaskAuthority": residual_application_mask_authority(args.residualApplicationMaskMode, args.edgeBandMode),
            "residualSmoothnessLossWeight": args.residualSmoothnessLossWeight,
            "temporalLossWeight": args.temporalLossWeight,
            "residualTemporalLossWeight": args.residualTemporalLossWeight,
        },
        "source": {
            "corpusManifest": str(Path(args.corpus_manifest).resolve()),
            "corpusSchema": corpus.get("schema"),
            "pairAuthority": corpus.get("pairAuthority"),
            "imageAuthority": corpus.get("imageAuthority"),
            "featureInputAuthority": config.get("featureInputAuthority"),
            "lowRenderScale": args.low_render_scale,
        },
        "metricsAtSave": {
            key: metrics.get(key)
            for key in [
                "baselinePsnr",
                "modelPsnr",
                "deltaPsnr",
                "weightedBaselinePsnr",
                "weightedModelPsnr",
                "weightedDeltaPsnr",
                "edgeBandBaselinePsnr",
                "edgeBandModelPsnr",
                "edgeBandDeltaPsnr",
                "targetEdgeBandBaselinePsnr",
                "targetEdgeBandModelPsnr",
                "targetEdgeBandDeltaPsnr",
                "outsideEdgeResidualMse",
                "improvedPatchFraction",
            ]
            if key in metrics
        },
    }
    manifest_path = artifact_manifest_path(model_dir)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    manifest_sha256 = sha256_file(manifest_path)
    return {
        "schema": manifest["schema"],
        "authority": manifest["authority"],
        "manifestPath": str(manifest_path.resolve()),
        "manifestSha256": manifest_sha256,
        "weightsPath": manifest["weights"]["path"],
        "weightsSha256": manifest["weights"]["sha256"],
        "model": manifest["model"],
    }


def load_model_artifact(model_dir):
    model_dir = Path(model_dir)
    manifest_path = artifact_manifest_path(model_dir)
    if not manifest_path.exists():
        raise ValueError(f"--load-model-dir lacks model-artifact.json: {model_dir}")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != MODEL_ARTIFACT_SCHEMA:
        raise ValueError(f"unsupported model artifact schema in {manifest_path}: {manifest.get('schema')}")
    if manifest.get("authority") != MODEL_ARTIFACT_AUTHORITY:
        raise ValueError(f"unsupported model artifact authority in {manifest_path}: {manifest.get('authority')}")
    config = manifest.get("model") or {}
    weights = manifest.get("weights") or {}
    weights_path = Path(weights.get("path") or model_dir / weights.get("filename", "weights.safetensors"))
    if not weights_path.exists():
        weights_path = model_dir / weights.get("filename", "weights.safetensors")
    if not weights_path.exists():
        raise ValueError(f"model artifact weights missing: {weights_path}")
    expected_sha256 = weights.get("sha256")
    actual_sha256 = sha256_file(weights_path)
    if expected_sha256 and actual_sha256 != expected_sha256:
        raise ValueError(f"model artifact weights checksum mismatch: {weights_path}")
    return {
        "schema": manifest["schema"],
        "authority": manifest["authority"],
        "manifestPath": str(manifest_path.resolve()),
        "manifestSha256": sha256_file(manifest_path),
        "weightsPath": str(weights_path.resolve()),
        "weightsSha256": actual_sha256,
        "model": config,
        "raw": manifest,
    }


def load_image(path):
    image = Image.open(path).convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def load_feature_image(path, target_height, target_width):
    image = Image.open(path).convert("RGBA")
    if image.size != (target_width, target_height):
        image = image.resize((target_width, target_height), Image.Resampling.BILINEAR)
    return np.asarray(image, dtype=np.float32) / 255.0


def feature_input_channels(featureInputMode):
    return 4 if featureInputMode in IMAGE_FEATURE_INPUT_MODES else 0


def feature_input_authority(featureInputMode):
    if featureInputMode == "feature-rgba":
        return FEATURE_INPUT_AUTHORITY
    if featureInputMode == "aux-rgba":
        return FLOW_DEBUG_AUXILIARY_INPUT_AUTHORITY
    return "off"


def uses_feature_image(featureInputMode):
    return featureInputMode in IMAGE_FEATURE_INPUT_MODES


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
    raw_corpus = json.loads(Path(corpus_path).read_text())
    corpus = raw_corpus.get("dataset") if isinstance(raw_corpus.get("dataset"), dict) else raw_corpus
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


def image_gradient_signal(image):
    luma = np.max(image, axis=2)
    gradient = np.zeros_like(luma, dtype=np.float32)
    gradient[:, 1:] = np.maximum(gradient[:, 1:], np.abs(luma[:, 1:] - luma[:, :-1]))
    gradient[:, :-1] = np.maximum(gradient[:, :-1], np.abs(luma[:, 1:] - luma[:, :-1]))
    gradient[1:, :] = np.maximum(gradient[1:, :], np.abs(luma[1:, :] - luma[:-1, :]))
    gradient[:-1, :] = np.maximum(gradient[:-1, :], np.abs(luma[1:, :] - luma[:-1, :]))
    return gradient


def dilate_bool_mask(mask, radius):
    radius = max(0, int(radius))
    if radius == 0 or not np.any(mask):
        return mask
    padded = np.pad(mask, radius, mode="constant", constant_values=False)
    dilated = np.zeros_like(mask, dtype=bool)
    height, width = mask.shape
    for offset_y in range(radius * 2 + 1):
        for offset_x in range(radius * 2 + 1):
            dilated |= padded[offset_y:offset_y + height, offset_x:offset_x + width]
    return dilated


def edge_band_authority(edgeBandMode):
    if edgeBandMode == "off":
        return "off"
    if edgeBandMode in {"difference", "gradient", "difference-gradient"}:
        return "target-derived-low-high"
    if edgeBandMode in {"low-gradient", "low-luma", "low-gradient-luma"}:
        return "inference-available-low-image-proxy"
    return "unknown"


def residual_application_mask_authority(residualApplicationMaskMode, edgeBandMode):
    if residualApplicationMaskMode == "off":
        return "off"
    if residualApplicationMaskMode == "active-edge-band":
        edge_authority = edge_band_authority(edgeBandMode)
        if edge_authority == "inference-available-low-image-proxy":
            return "inference-available-active-edge-band"
        if edge_authority == "target-derived-low-high":
            return "teacher-upper-bound-target-derived-active-edge-band"
        if edge_authority == "off":
            return "inactive-edge-band-mask"
    if residualApplicationMaskMode == "soft-active-edge-band":
        edge_authority = edge_band_authority(edgeBandMode)
        if edge_authority == "inference-available-low-image-proxy":
            return "inference-available-soft-active-edge-band"
        if edge_authority == "target-derived-low-high":
            return "teacher-upper-bound-target-derived-soft-active-edge-band"
        if edge_authority == "off":
            return "inactive-soft-edge-band-mask"
    return "unknown"


def residual_application_mask(mask, residualApplicationMaskMode, residualMaskFeatherRadius=0):
    if residualApplicationMaskMode == "active-edge-band":
        return mx.clip(mask, 0.0, 1.0) if mask is not None else None
    if residualApplicationMaskMode == "soft-active-edge-band":
        return feather_residual_mask(mask, residualMaskFeatherRadius)
    return None


def edge_band_mask(low_image, high_image, edgeBandMode, edgeBandThreshold, edgeBandDilate):
    if edgeBandMode == "off":
        signal = np.zeros(low_image.shape[:2], dtype=np.float32)
        return np.zeros(low_image.shape[:2], dtype=bool), signal
    signals = []
    if edgeBandMode in {"difference", "difference-gradient"}:
        signals.append(np.max(np.abs(high_image - low_image), axis=2))
    if edgeBandMode in {"gradient", "difference-gradient"}:
        low_gradient = image_gradient_signal(low_image)
        high_gradient = image_gradient_signal(high_image)
        signals.append(np.maximum(high_gradient - low_gradient, 0.0))
    if edgeBandMode in {"low-gradient", "low-gradient-luma"}:
        signals.append(image_gradient_signal(low_image))
    if edgeBandMode in {"low-luma", "low-gradient-luma"}:
        signals.append(np.max(low_image, axis=2))
    signal = np.maximum.reduce(signals).astype(np.float32) if signals else np.zeros(low_image.shape[:2], dtype=np.float32)
    mask = signal > max(float(edgeBandThreshold), 0.0)
    mask = dilate_bool_mask(mask, edgeBandDilate)
    return mask, signal


def load_pair_arrays(pairs, foregroundThreshold, edgeBandMode, edgeBandThreshold, edgeBandDilate, featureInputMode):
    loaded = []
    for pair in pairs:
        low_path = Path(pair["low"]["path"])
        high_path = Path(pair["high"]["path"])
        low_image = load_image(low_path)
        high_image = load_image(high_path)
        if low_image.shape != high_image.shape:
            raise ValueError(f"loaded image shape mismatch: {low_path} vs {high_path}")
        feature_image = None
        feature_path = None
        feature_capture = pair.get("low", {}).get("featureCapture") or {}
        if featureInputMode == "feature-rgba":
            feature_path = pair.get("low", {}).get("featurePath") or feature_capture.get("path")
            if not feature_path:
                raise ValueError(f"pair lacks featurePath for --feature-input-mode=feature-rgba: {pair.get('pairId')}")
            feature_authority = pair.get("low", {}).get("featureAuthority") or feature_capture.get("featureAuthority")
            if feature_authority != FEATURE_INPUT_AUTHORITY:
                raise ValueError(f"pair feature authority is not {FEATURE_INPUT_AUTHORITY}: {pair.get('pairId')} got {feature_authority!r}")
            feature_image = load_feature_image(feature_path, low_image.shape[0], low_image.shape[1])
        elif featureInputMode == "aux-rgba":
            auxiliary_captures = pair.get("low", {}).get("auxiliaryCaptures") or {}
            flow_debug_capture = auxiliary_captures.get("flowDebug") or {}
            feature_path = flow_debug_capture.get("path")
            if not feature_path:
                raise ValueError(f"pair lacks auxiliaryCaptures.flowDebug.path for --feature-input-mode=aux-rgba: {pair.get('pairId')}")
            auxiliary_authority = flow_debug_capture.get("auxiliaryAuthority")
            if auxiliary_authority != FLOW_DEBUG_AUXILIARY_INPUT_AUTHORITY:
                raise ValueError(f"pair Flow Debug auxiliary authority is not {FLOW_DEBUG_AUXILIARY_INPUT_AUTHORITY}: {pair.get('pairId')} got {auxiliary_authority!r}")
            feature_image = load_feature_image(feature_path, low_image.shape[0], low_image.shape[1])
        foreground = foreground_pixels(low_image, high_image, foregroundThreshold)
        edge_mask, edge_signal = edge_band_mask(low_image, high_image, edgeBandMode, edgeBandThreshold, edgeBandDilate)
        target_edge_mask, target_edge_signal = edge_band_mask(low_image, high_image, "difference-gradient", edgeBandThreshold, edgeBandDilate)
        edge_pixels = np.argwhere(edge_mask)
        target_edge_pixels = np.argwhere(target_edge_mask)
        loaded.append({
            "id": f"{pair.get('variantId')}::{pair.get('pairId')}",
            "low": low_image,
            "high": high_image,
            "feature": feature_image,
            "featurePath": str(feature_path) if feature_path else None,
            "featureInputMode": featureInputMode,
            "featureInputAuthority": feature_input_authority(featureInputMode),
            "featureInputChannels": feature_input_channels(featureInputMode),
            "foreground": foreground,
            "foregroundPixels": int(foreground.shape[0]),
            "edgeBandMask": edge_mask.astype(np.float32)[..., None],
            "edgeBand": edge_pixels,
            "edgeBandPixels": int(edge_pixels.shape[0]),
            "edgeBandCoverage": float(np.mean(edge_mask)),
            "edgeBandSignalMean": float(np.mean(edge_signal)),
            "edgeBandSignalMax": float(np.max(edge_signal)),
            "targetEdgeBandMask": target_edge_mask.astype(np.float32)[..., None],
            "targetEdgeBand": target_edge_pixels,
            "targetEdgeBandPixels": int(target_edge_pixels.shape[0]),
            "targetEdgeBandCoverage": float(np.mean(target_edge_mask)),
            "targetEdgeBandSignalMean": float(np.mean(target_edge_signal)),
            "targetEdgeBandSignalMax": float(np.max(target_edge_signal)),
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


def model_input_from_rgb(low_patch, low_render_scale, conditionRenderScale, feature_patch=None, featureInputMode="rgb"):
    input_parts = [low_patch]
    if uses_feature_image(featureInputMode):
        if feature_patch is None:
            raise ValueError(f"{featureInputMode} model input requires a feature_patch")
        input_parts.append(feature_patch)
    scaleChannel = np.full((*low_patch.shape[:2], 1), float(low_render_scale), dtype=np.float32)
    if conditionRenderScale:
        input_parts.append(scaleChannel)
    return np.concatenate(input_parts, axis=2)


def sample_patch_batch(items, rng, batch_size, patch_size, foregroundProbability, edgeSamplingProbability, conditionRenderScale, featureInputMode):
    lows = []
    highs = []
    edge_masks = []
    target_edge_masks = []
    for _ in range(batch_size):
        item = items[int(rng.integers(0, len(items)))]
        height, width, _channels = item["low"].shape
        crop_height = min(patch_size, height)
        crop_width = min(patch_size, width)
        foreground = item.get("foreground")
        edge_band = item.get("edgeBand")
        if edge_band is not None and edge_band.shape[0] and rng.random() < edgeSamplingProbability:
            center_y, center_x = edge_band[int(rng.integers(0, edge_band.shape[0]))]
            top = int(np.clip(center_y - crop_height // 2, 0, max(0, height - crop_height)))
            left = int(np.clip(center_x - crop_width // 2, 0, max(0, width - crop_width)))
        elif foreground is not None and foreground.shape[0] and rng.random() < foregroundProbability:
            center_y, center_x = foreground[int(rng.integers(0, foreground.shape[0]))]
            top = int(np.clip(center_y - crop_height // 2, 0, max(0, height - crop_height)))
            left = int(np.clip(center_x - crop_width // 2, 0, max(0, width - crop_width)))
        else:
            top = int(rng.integers(0, max(1, height - crop_height + 1)))
            left = int(rng.integers(0, max(1, width - crop_width + 1)))
        low_patch = item["low"][top:top + crop_height, left:left + crop_width, :]
        feature_patch = item["feature"][top:top + crop_height, left:left + crop_width, :] if uses_feature_image(featureInputMode) else None
        lows.append(model_input_from_rgb(low_patch, item["lowRenderScale"], conditionRenderScale, feature_patch, featureInputMode))
        highs.append(item["high"][top:top + crop_height, left:left + crop_width, :])
        edge_masks.append(item.get("edgeBandMask", np.zeros((*item["low"].shape[:2], 1), dtype=np.float32))[top:top + crop_height, left:left + crop_width, :])
        target_edge_masks.append(item.get("targetEdgeBandMask", item.get("edgeBandMask", np.zeros((*item["low"].shape[:2], 1), dtype=np.float32)))[top:top + crop_height, left:left + crop_width, :])
    return (
        mx.array(np.stack(lows, axis=0)),
        mx.array(np.stack(highs, axis=0)),
        mx.array(np.stack(edge_masks, axis=0)),
        mx.array(np.stack(target_edge_masks, axis=0)),
    )


def sample_temporal_pair_batch(temporal_pairs, rng, batch_size, patch_size, foregroundProbability, conditionRenderScale, featureInputMode):
    previous_lows = []
    current_lows = []
    previous_highs = []
    current_highs = []
    previous_masks = []
    current_masks = []
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
        _previous_low_rgb, previous_high, previous_model_input, previous_mask = crop_item_arrays(previous_item, region, conditionRenderScale, featureInputMode)
        _current_low_rgb, current_high, current_model_input, current_mask = crop_item_arrays(current_item, region, conditionRenderScale, featureInputMode)
        previous_lows.append(previous_model_input)
        current_lows.append(current_model_input)
        previous_highs.append(previous_high)
        current_highs.append(current_high)
        previous_masks.append(previous_mask)
        current_masks.append(current_mask)
    return (
        mx.array(np.stack(previous_lows, axis=0)),
        mx.array(np.stack(current_lows, axis=0)),
        mx.array(np.stack(previous_highs, axis=0)),
        mx.array(np.stack(current_highs, axis=0)),
        mx.array(np.stack(previous_masks, axis=0)),
        mx.array(np.stack(current_masks, axis=0)),
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


def masked_mse_value(prediction, target, mask):
    mask = mx.clip(mask, 0.0, 1.0)
    numerator = mx.mean(mx.square(prediction - target) * mask)
    normalizer = mx.maximum(mx.mean(mask), 1e-6)
    return numerator / normalizer


def edge_gradient_loss_value(prediction, target, edge_mask):
    edge_mask = mx.clip(edge_mask, 0.0, 1.0)
    dx_prediction = prediction[:, :, 1:, :] - prediction[:, :, :-1, :]
    dx_target = target[:, :, 1:, :] - target[:, :, :-1, :]
    dx_mask = mx.maximum(edge_mask[:, :, 1:, :], edge_mask[:, :, :-1, :])
    dy_prediction = prediction[:, 1:, :, :] - prediction[:, :-1, :, :]
    dy_target = target[:, 1:, :, :] - target[:, :-1, :, :]
    dy_mask = mx.maximum(edge_mask[:, 1:, :, :], edge_mask[:, :-1, :, :])
    return 0.5 * (masked_mse_value(dx_prediction, dx_target, dx_mask) + masked_mse_value(dy_prediction, dy_target, dy_mask))


def residual_smoothness_loss_value(prediction, low_batch, edge_mask):
    residual = prediction - rgb_channels(low_batch)
    edge_mask = mx.clip(edge_mask, 0.0, 1.0)
    dx_residual = residual[:, :, 1:, :] - residual[:, :, :-1, :]
    dx_mask = mx.maximum(edge_mask[:, :, 1:, :], edge_mask[:, :, :-1, :])
    dy_residual = residual[:, 1:, :, :] - residual[:, :-1, :, :]
    dy_mask = mx.maximum(edge_mask[:, 1:, :, :], edge_mask[:, :-1, :, :])
    return 0.5 * (
        masked_mse_value(dx_residual, mx.zeros_like(dx_residual), dx_mask)
        + masked_mse_value(dy_residual, mx.zeros_like(dy_residual), dy_mask)
    )


def chroma_residual_loss_value(prediction, low_batch, edge_mask):
    residual = prediction - rgb_channels(low_batch)
    chroma_residual = residual - mx.mean(residual, axis=3, keepdims=True)
    return masked_mse_value(chroma_residual, mx.zeros_like(chroma_residual), edge_mask)


def edge_band_loss_value(prediction, target, low_batch, edge_mask, edgeLossWeight, edgeGradientLossWeight, outsideEdgeResidualWeight):
    total = mx.array(0.0)
    if edgeLossWeight > 0:
        total = total + float(edgeLossWeight) * masked_mse_value(prediction, target, edge_mask)
    if edgeGradientLossWeight > 0:
        total = total + float(edgeGradientLossWeight) * edge_gradient_loss_value(prediction, target, edge_mask)
    if outsideEdgeResidualWeight > 0:
        low_rgb = rgb_channels(low_batch)
        outside_mask = 1.0 - mx.clip(edge_mask, 0.0, 1.0)
        total = total + float(outsideEdgeResidualWeight) * masked_mse_value(prediction - low_rgb, mx.zeros_like(prediction), outside_mask)
    return total


def temporal_loss_value(model_instance, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch, previous_mask_batch, current_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius):
    previous_prediction = model_instance(previous_low_batch, residual_application_mask(previous_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius))
    current_prediction = model_instance(current_low_batch, residual_application_mask(current_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius))
    prediction_delta = current_prediction - previous_prediction
    target_delta = current_high_batch - previous_high_batch
    return mse_value(prediction_delta, target_delta)


def residual_temporal_loss_value(model_instance, previous_low_batch, current_low_batch, previous_mask_batch, current_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius):
    previous_prediction = model_instance(previous_low_batch, residual_application_mask(previous_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius))
    current_prediction = model_instance(current_low_batch, residual_application_mask(current_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius))
    previous_residual = previous_prediction - rgb_channels(previous_low_batch)
    current_residual = current_prediction - rgb_channels(current_low_batch)
    return mse_value(current_residual - previous_residual, mx.zeros_like(previous_residual))


def per_sample_mse(prediction, target):
    error = mx.square(prediction - target)
    return mx.mean(mx.mean(mx.mean(error, axis=3), axis=2), axis=1)


def crop_region(item, crop_size, previewMode):
    low = item["low"]
    height, width, _channels = low.shape
    if previewMode == "full-frame":
        return 0, 0, height, width, {
            "mode": "full-frame",
            "centerY": height / 2,
            "centerX": width / 2,
            "foregroundPixels": item.get("foregroundPixels", 0),
            "edgeBandPixels": item.get("edgeBandPixels", 0),
            "fullFrame": True,
            "top": 0,
            "left": 0,
            "height": height,
            "width": width,
        }
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
    if previewMode == "edge-band" and item.get("edgeBand") is not None and item["edgeBand"].shape[0]:
        center_y, center_x = np.mean(item["edgeBand"], axis=0)
        focus = {
            "mode": "edge-band",
            "centerY": float(center_y),
            "centerX": float(center_x),
            "foregroundPixels": item.get("foregroundPixels", 0),
            "edgeBandPixels": item.get("edgeBandPixels", 0),
        }
    top = int(np.clip(focus["centerY"] - crop_height // 2, 0, max(0, height - crop_height)))
    left = int(np.clip(focus["centerX"] - crop_width // 2, 0, max(0, width - crop_width)))
    focus.update({"top": top, "left": left, "height": crop_height, "width": crop_width})
    return top, left, crop_height, crop_width, focus


def crop_item_arrays(item, region, conditionRenderScale, featureInputMode="rgb"):
    top, left, crop_height, crop_width = region
    low_patch = item["low"][top:top + crop_height, left:left + crop_width, :]
    high_patch = item["high"][top:top + crop_height, left:left + crop_width, :]
    feature_patch = item["feature"][top:top + crop_height, left:left + crop_width, :] if uses_feature_image(featureInputMode) else None
    model_input = model_input_from_rgb(low_patch, item["lowRenderScale"], conditionRenderScale, feature_patch, featureInputMode)
    edge_mask = item.get("edgeBandMask", np.zeros((*item["low"].shape[:2], 1), dtype=np.float32))[top:top + crop_height, left:left + crop_width, :]
    return low_patch, high_patch, model_input, edge_mask


def predict_patch(model, model_input, residual_mask=None, residualApplicationMaskMode="off", residualMaskFeatherRadius=0):
    mask = None
    if residual_mask is not None:
        mask = mx.array(residual_mask[None, ...])
    prediction = model(mx.array(model_input[None, ...]), residual_application_mask(mask, residualApplicationMaskMode, residualMaskFeatherRadius))
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


def apply_residual_continuation(rendered, residualContinuationMode, residualContinuationAlpha):
    if residualContinuationMode == "none":
        return [
            (item, low_patch, high_patch, prediction, prediction)
            for item, low_patch, high_patch, prediction in rendered
        ]
    continued = []
    previous_continued_residual = None
    for item, low_patch, high_patch, prediction in rendered:
        raw_residual = prediction - low_patch
        if previous_continued_residual is None:
            continued_residual = raw_residual
        else:
            continued_residual = (
                residualContinuationAlpha * raw_residual
                + (1.0 - residualContinuationAlpha) * previous_continued_residual
            )
        continued_prediction = np.clip(low_patch + continued_residual, 0.0, 1.0)
        continued.append((item, low_patch, high_patch, prediction, continued_prediction))
        previous_continued_residual = continued_residual
    return continued


def empty_temporal_metrics(temporalEvalScope, residualContinuationMode, residualContinuationAlpha, effectiveMode):
    return {
        "temporalEvalScope": temporalEvalScope,
        "temporalPairCount": 0,
        "temporalBaselineDeltaPsnr": None,
        "temporalModelDeltaPsnr": None,
        "temporalDeltaPsnr": None,
        "temporalFlickerAmplification": None,
        "temporalPreview": None,
        "temporalPreviewFocus": None,
        "temporalSequencePreview": None,
        "temporalSequenceFrames": [],
        "residualContinuationMode": residualContinuationMode,
        "residualContinuationEffectiveMode": effectiveMode,
        "residualContinuationAlpha": residualContinuationAlpha,
        "residualContinuationAuthority": "offline-temporal-residual-ema-v0" if residualContinuationMode == "ema" else None,
        "continuationStillBaselinePsnr": None,
        "continuationStillRawModelPsnr": None,
        "continuationStillModelPsnr": None,
        "continuationStillDeltaPsnr": None,
        "continuationStillVsRawDeltaPsnr": None,
        "continuationTemporalModelDeltaPsnr": None,
        "continuationTemporalDeltaPsnr": None,
        "continuationFlickerAmplification": None,
        "continuationPreview": None,
    }


def temporal_sequence_metrics(model, loaded, train_items, eval_items, out_dir, crop_size, previewMode, conditionRenderScale, featureInputMode, temporalEvalScope, residualContinuationMode, residualContinuationAlpha, residualApplicationMaskMode, residualMaskFeatherRadius):
    scoped_items = temporal_scope_items(temporalEvalScope, loaded, train_items, eval_items)
    groups = temporal_groups(scoped_items)
    continuation_active = residualContinuationMode == "ema"
    continuation_effective_mode = "ema" if continuation_active else "none"
    if not groups:
        return empty_temporal_metrics(
            temporalEvalScope,
            residualContinuationMode,
            residualContinuationAlpha,
            "no-temporal-pairs" if continuation_active else "none",
        )
    baseline_losses = []
    model_losses = []
    continuation_losses = []
    still_baseline_losses = []
    still_model_losses = []
    still_continuation_losses = []
    flicker_ratios = []
    continuation_flicker_ratios = []
    temporal_pairs = []
    temporal_preview_path = out_dir / "temporal-preview-low0-low1-model0-model1-target0-target1-delta-diff.png"
    temporal_sequence_preview_path = out_dir / "temporal-sequence-preview-low-model-target-error-mask.png"
    continuation_preview_path = out_dir / "temporal-preview-continuation-low0-low1-model0-model1-cont0-cont1-target0-target1-delta-diff.png"
    temporal_preview_written = False
    temporal_sequence_preview_written = False
    continuation_preview_written = False
    temporal_focus = None
    temporal_sequence_frames = []
    for group in groups:
        top, left, crop_height, crop_width, focus = crop_region(group[0], crop_size, previewMode)
        region = (top, left, crop_height, crop_width)
        rendered = []
        for item in group:
            low_patch, high_patch, model_input, residual_mask = crop_item_arrays(item, region, conditionRenderScale, featureInputMode)
            pred_patch = predict_patch(model, model_input, residual_mask, residualApplicationMaskMode, residualMaskFeatherRadius)
            rendered.append((item, low_patch, high_patch, pred_patch))
        if not temporal_sequence_preview_written:
            temporal_sequence_frames = save_temporal_sequence_preview(
                rendered,
                focus,
                temporal_sequence_preview_path,
            )
            temporal_sequence_preview_written = True
        continued_rendered = apply_residual_continuation(
            rendered,
            residualContinuationMode,
            residualContinuationAlpha,
        )
        for _item, low_patch, high_patch, prediction, continued_prediction in continued_rendered:
            still_baseline_losses.append(float(np.mean(np.square(low_patch - high_patch))))
            still_model_losses.append(float(np.mean(np.square(prediction - high_patch))))
            if continuation_active:
                still_continuation_losses.append(float(np.mean(np.square(continued_prediction - high_patch))))
        for index in range(1, len(rendered)):
            previous_item, previous_low, previous_high, previous_prediction, previous_continued = continued_rendered[index - 1]
            current_item, current_low, current_high, current_prediction, current_continued = continued_rendered[index]
            target_delta = current_high - previous_high
            baseline_delta = current_low - previous_low
            model_delta = current_prediction - previous_prediction
            continuation_delta = current_continued - previous_continued
            baseline_loss = float(np.mean(np.square(baseline_delta - target_delta)))
            model_loss = float(np.mean(np.square(model_delta - target_delta)))
            baseline_losses.append(baseline_loss)
            model_losses.append(model_loss)
            baseline_energy = float(np.mean(np.abs(baseline_delta)))
            model_energy = float(np.mean(np.abs(model_delta)))
            flicker_ratio = model_energy / max(baseline_energy, 1e-8)
            flicker_ratios.append(flicker_ratio)
            pair_entry = {
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
            }
            if continuation_active:
                continuation_loss = float(np.mean(np.square(continuation_delta - target_delta)))
                continuation_losses.append(continuation_loss)
                continuation_energy = float(np.mean(np.abs(continuation_delta)))
                continuation_flicker_ratio = continuation_energy / max(baseline_energy, 1e-8)
                continuation_flicker_ratios.append(continuation_flicker_ratio)
                pair_entry.update({
                    "continuationDeltaMse": continuation_loss,
                    "continuationTemporalDeltaPsnr": psnr_from_mse(continuation_loss) - psnr_from_mse(baseline_loss),
                    "continuationFlickerAmplification": continuation_flicker_ratio,
                })
            temporal_pairs.append(pair_entry)
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
            if continuation_active and not continuation_preview_written:
                continuation_delta_diff = np.clip(np.abs(continuation_delta - target_delta) * 4.0, 0.0, 1.0)
                continuation_strip = np.concatenate([
                    previous_low,
                    current_low,
                    previous_prediction,
                    current_prediction,
                    previous_continued,
                    current_continued,
                    previous_high,
                    current_high,
                    continuation_delta_diff,
                ], axis=1)
                Image.fromarray(np.clip(continuation_strip * 255.0, 0, 255).astype(np.uint8), "RGB").save(continuation_preview_path)
                continuation_preview_written = True
    baseline_mse = float(np.mean(baseline_losses))
    model_mse = float(np.mean(model_losses))
    metrics = {
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
        "temporalSequencePreview": str(temporal_sequence_preview_path) if temporal_sequence_preview_written else None,
        "temporalSequenceFrames": temporal_sequence_frames,
        "residualContinuationMode": residualContinuationMode,
        "residualContinuationEffectiveMode": continuation_effective_mode,
        "residualContinuationAlpha": residualContinuationAlpha,
        "residualContinuationAuthority": "offline-temporal-residual-ema-v0" if continuation_active else None,
        "continuationStillBaselinePsnr": None,
        "continuationStillRawModelPsnr": None,
        "continuationStillModelPsnr": None,
        "continuationStillDeltaPsnr": None,
        "continuationStillVsRawDeltaPsnr": None,
        "continuationTemporalModelDeltaPsnr": None,
        "continuationTemporalDeltaPsnr": None,
        "continuationFlickerAmplification": None,
        "continuationPreview": None,
    }
    if continuation_active:
        still_baseline_mse = float(np.mean(still_baseline_losses))
        still_model_mse = float(np.mean(still_model_losses))
        still_continuation_mse = float(np.mean(still_continuation_losses))
        continuation_mse = float(np.mean(continuation_losses))
        metrics.update({
            "continuationStillBaselineMse": still_baseline_mse,
            "continuationStillRawModelMse": still_model_mse,
            "continuationStillModelMse": still_continuation_mse,
            "continuationStillBaselinePsnr": psnr_from_mse(still_baseline_mse),
            "continuationStillRawModelPsnr": psnr_from_mse(still_model_mse),
            "continuationStillModelPsnr": psnr_from_mse(still_continuation_mse),
            "continuationStillDeltaPsnr": psnr_from_mse(still_continuation_mse) - psnr_from_mse(still_baseline_mse),
            "continuationStillVsRawDeltaPsnr": psnr_from_mse(still_continuation_mse) - psnr_from_mse(still_model_mse),
            "continuationTemporalModelDeltaMse": continuation_mse,
            "continuationTemporalModelDeltaPsnr": psnr_from_mse(continuation_mse),
            "continuationTemporalDeltaPsnr": psnr_from_mse(continuation_mse) - psnr_from_mse(baseline_mse),
            "continuationFlickerAmplification": float(np.mean(continuation_flicker_ratios)),
            "continuationPreview": str(continuation_preview_path) if continuation_preview_written else None,
        })
    return metrics


def evaluate_model(model, items, rng, batch_size, patch_size, eval_patches, foregroundProbability, edgeSamplingProbability, conditionRenderScale, featureInputMode, foregroundThreshold, foregroundLossWeight, differenceLossWeight, residualApplicationMaskMode, residualMaskFeatherRadius):
    baseline_losses = []
    model_losses = []
    weighted_baseline_losses = []
    weighted_model_losses = []
    edge_baseline_losses = []
    edge_model_losses = []
    target_edge_baseline_losses = []
    target_edge_model_losses = []
    outside_edge_residual_losses = []
    edge_mask_coverages = []
    target_edge_mask_coverages = []
    improved_patches = 0
    compared_patches = 0
    batches = max(1, math.ceil(eval_patches / batch_size))
    for _ in range(batches):
        low_batch, high_batch, edge_mask_batch, target_edge_mask_batch = sample_patch_batch(items, rng, batch_size, patch_size, foregroundProbability, edgeSamplingProbability, conditionRenderScale, featureInputMode)
        low_rgb = rgb_channels(low_batch)
        prediction = model(low_batch, residual_application_mask(edge_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius))
        baseline_loss = mse_value(low_rgb, high_batch)
        model_loss = mse_value(prediction, high_batch)
        weighted_baseline_loss = weighted_mse_value(low_rgb, high_batch, low_batch, foregroundThreshold, foregroundLossWeight, differenceLossWeight)
        weighted_model_loss = weighted_mse_value(prediction, high_batch, low_batch, foregroundThreshold, foregroundLossWeight, differenceLossWeight)
        edge_baseline_loss = masked_mse_value(low_rgb, high_batch, edge_mask_batch)
        edge_model_loss = masked_mse_value(prediction, high_batch, edge_mask_batch)
        target_edge_baseline_loss = masked_mse_value(low_rgb, high_batch, target_edge_mask_batch)
        target_edge_model_loss = masked_mse_value(prediction, high_batch, target_edge_mask_batch)
        outside_edge_residual_loss = masked_mse_value(prediction - low_rgb, mx.zeros_like(prediction), 1.0 - mx.clip(edge_mask_batch, 0.0, 1.0))
        edge_mask_coverage = mx.mean(edge_mask_batch)
        target_edge_mask_coverage = mx.mean(target_edge_mask_batch)
        baseline_sample_mse = per_sample_mse(low_rgb, high_batch)
        model_sample_mse = per_sample_mse(prediction, high_batch)
        mx.eval(
            baseline_loss,
            model_loss,
            weighted_baseline_loss,
            weighted_model_loss,
            edge_baseline_loss,
            edge_model_loss,
            target_edge_baseline_loss,
            target_edge_model_loss,
            outside_edge_residual_loss,
            edge_mask_coverage,
            target_edge_mask_coverage,
            baseline_sample_mse,
            model_sample_mse,
        )
        baseline_losses.append(float(baseline_loss))
        model_losses.append(float(model_loss))
        weighted_baseline_losses.append(float(weighted_baseline_loss))
        weighted_model_losses.append(float(weighted_model_loss))
        edge_baseline_losses.append(float(edge_baseline_loss))
        edge_model_losses.append(float(edge_model_loss))
        target_edge_baseline_losses.append(float(target_edge_baseline_loss))
        target_edge_model_losses.append(float(target_edge_model_loss))
        outside_edge_residual_losses.append(float(outside_edge_residual_loss))
        edge_mask_coverages.append(float(edge_mask_coverage))
        target_edge_mask_coverages.append(float(target_edge_mask_coverage))
        improved_patches += int(np.sum(np.array(model_sample_mse) < np.array(baseline_sample_mse)))
        compared_patches += int(np.array(model_sample_mse).shape[0])
    baseline_mse = float(np.mean(baseline_losses))
    model_mse = float(np.mean(model_losses))
    weighted_baseline_mse = float(np.mean(weighted_baseline_losses))
    weighted_model_mse = float(np.mean(weighted_model_losses))
    edge_baseline_mse = float(np.mean(edge_baseline_losses))
    edge_model_mse = float(np.mean(edge_model_losses))
    target_edge_baseline_mse = float(np.mean(target_edge_baseline_losses))
    target_edge_model_mse = float(np.mean(target_edge_model_losses))
    outside_edge_residual_mse = float(np.mean(outside_edge_residual_losses))
    edge_band_coverage = float(np.mean(edge_mask_coverages))
    target_edge_band_coverage = float(np.mean(target_edge_mask_coverages))
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
        "edgeBandBaselineMse": edge_baseline_mse,
        "edgeBandModelMse": edge_model_mse,
        "edgeBandBaselinePsnr": psnr_from_mse(edge_baseline_mse),
        "edgeBandModelPsnr": psnr_from_mse(edge_model_mse),
        "edgeBandDeltaPsnr": psnr_from_mse(edge_model_mse) - psnr_from_mse(edge_baseline_mse),
        "edgeBandEvalCoverage": edge_band_coverage,
        "targetEdgeBandBaselineMse": target_edge_baseline_mse,
        "targetEdgeBandModelMse": target_edge_model_mse,
        "targetEdgeBandBaselinePsnr": psnr_from_mse(target_edge_baseline_mse),
        "targetEdgeBandModelPsnr": psnr_from_mse(target_edge_model_mse),
        "targetEdgeBandDeltaPsnr": psnr_from_mse(target_edge_model_mse) - psnr_from_mse(target_edge_baseline_mse),
        "targetEdgeBandEvalCoverage": target_edge_band_coverage,
        "outsideEdgeResidualMse": outside_edge_residual_mse,
        "improvedPatchFraction": improved_patches / max(1, compared_patches),
    }


def make_preview(model, eval_item, out_path, diagnostic_out_path, preview_size, previewMode, conditionRenderScale, featureInputMode, residualApplicationMaskMode, residualMaskFeatherRadius):
    low = eval_item["low"]
    high = eval_item["high"]
    top, left, crop_height, crop_width, previewFocus = crop_region(eval_item, preview_size, previewMode)
    low_patch = low[top:top + crop_height, left:left + crop_width, :]
    high_patch = high[top:top + crop_height, left:left + crop_width, :]
    feature_patch = eval_item["feature"][top:top + crop_height, left:left + crop_width, :] if uses_feature_image(featureInputMode) else None
    model_input = model_input_from_rgb(low_patch, eval_item["lowRenderScale"], conditionRenderScale, feature_patch, featureInputMode)
    edge_mask = eval_item.get("edgeBandMask", np.zeros((*low.shape[:2], 1), dtype=np.float32))[top:top + crop_height, left:left + crop_width, :]
    pred_patch = predict_patch(model, model_input, edge_mask, residualApplicationMaskMode, residualMaskFeatherRadius)
    diff_patch = np.clip(np.abs(pred_patch - high_patch) * 4.0, 0.0, 1.0)
    strip = np.concatenate([low_patch, pred_patch, high_patch, diff_patch], axis=1)
    Image.fromarray(np.clip(strip * 255.0, 0, 255).astype(np.uint8), "RGB").save(out_path)
    target_residual = np.clip(np.abs(high_patch - low_patch) * 4.0, 0.0, 1.0)
    model_residual = np.clip(np.abs(pred_patch - low_patch) * 4.0, 0.0, 1.0)
    remaining_error = np.clip(np.abs(high_patch - pred_patch) * 4.0, 0.0, 1.0)
    mask_rgb = np.repeat(np.clip(edge_mask, 0.0, 1.0), 3, axis=2)
    diagnostic_strip = np.concatenate([low_patch, pred_patch, high_patch, target_residual, model_residual, remaining_error, mask_rgb], axis=1)
    Image.fromarray(np.clip(diagnostic_strip * 255.0, 0, 255).astype(np.uint8), "RGB").save(diagnostic_out_path)
    return previewFocus


def make_preview_frames(model, eval_items, out_dir, preview_size, previewMode, conditionRenderScale, featureInputMode, residualApplicationMaskMode, residualMaskFeatherRadius, previewFrameCount, primary_preview_path, primary_diagnostic_preview_path, primary_preview_focus):
    frame_count = min(max(1, int(previewFrameCount)), len(eval_items))
    frames = [{
        "index": 0,
        "item": eval_items[0]["id"],
        "preview": str(primary_preview_path),
        "diagnosticPreview": str(primary_diagnostic_preview_path),
        "previewFocus": primary_preview_focus,
    }]
    for index in range(1, frame_count):
        preview_path = out_dir / f"residual-preview-frame-{index:03d}-low-model-target-diff.png"
        diagnostic_preview_path = out_dir / f"residual-preview-frame-{index:03d}-low-model-target-targetres-modelres-error-mask.png"
        focus = make_preview(
            model,
            eval_items[index],
            preview_path,
            diagnostic_preview_path,
            preview_size,
            previewMode,
            conditionRenderScale,
            featureInputMode,
            residualApplicationMaskMode,
            residualMaskFeatherRadius,
        )
        frames.append({
            "index": index,
            "item": eval_items[index]["id"],
            "preview": str(preview_path),
            "diagnosticPreview": str(diagnostic_preview_path),
            "previewFocus": focus,
        })
    return frames


def save_temporal_sequence_preview(rendered, focus, out_path):
    rows = []
    frames = []
    for item, low_patch, high_patch, prediction in rendered:
        remaining_error = np.clip(np.abs(high_patch - prediction) * 4.0, 0.0, 1.0)
        edge_mask = item.get("edgeBandMask", np.zeros((*item["low"].shape[:2], 1), dtype=np.float32))
        top = focus["top"]
        left = focus["left"]
        crop_height = focus["height"]
        crop_width = focus["width"]
        mask_patch = edge_mask[top:top + crop_height, left:left + crop_width, :]
        mask_rgb = np.repeat(np.clip(mask_patch, 0.0, 1.0), 3, axis=2)
        rows.append(np.concatenate([
            low_patch,
            prediction,
            high_patch,
            remaining_error,
            mask_rgb,
        ], axis=1))
        frames.append({
            "item": item["id"],
            "temporalSequenceId": item.get("temporalSequenceId"),
            "temporalFrameIndex": item.get("temporalFrameIndex"),
            "lowRenderScale": item["lowRenderScale"],
        })
    sheet = np.concatenate(rows, axis=0)
    Image.fromarray(np.clip(sheet * 255.0, 0, 255).astype(np.uint8), "RGB").save(out_path)
    return frames


def main():
    args = parse_args()
    if args.temporalLossWeight < 0:
        raise ValueError("--temporal-loss-weight must be non-negative")
    if args.residualTemporalLossWeight < 0:
        raise ValueError("--residual-temporal-loss-weight must be non-negative")
    if args.detailResidualGate < 0:
        raise ValueError("--detail-residual-gate must be non-negative")
    if args.edgeBandThreshold < 0:
        raise ValueError("--edge-band-threshold must be non-negative")
    if args.edgeBandDilate < 0:
        raise ValueError("--edge-band-dilate must be non-negative")
    if args.residualMaskFeatherRadius < 0:
        raise ValueError("--residual-mask-feather-radius must be non-negative")
    if args.previewFrameCount < 1:
        raise ValueError("--preview-frame-count must be at least 1")
    if args.chromaResidualScale < 0:
        raise ValueError("--chroma-residual-scale must be non-negative")
    for label, value in [
        ("--edge-sampling-probability", args.edgeSamplingProbability),
        ("--edge-loss-weight", args.edgeLossWeight),
        ("--edge-gradient-loss-weight", args.edgeGradientLossWeight),
        ("--outside-edge-residual-weight", args.outsideEdgeResidualWeight),
        ("--residual-output-limit", args.residualOutputLimit),
        ("--residual-smoothness-loss-weight", args.residualSmoothnessLossWeight),
        ("--chroma-residual-loss-weight", args.chromaResidualLossWeight),
    ]:
        if value < 0:
            raise ValueError(f"{label} must be non-negative")
    if args.edgeSamplingProbability > 1:
        raise ValueError("--edge-sampling-probability must be between 0 and 1")
    if args.residualContinuationAlpha < 0 or args.residualContinuationAlpha > 1:
        raise ValueError("--residual-continuation-alpha must be between 0 and 1")
    if args.evalOnly and not args.loadModelDir:
        raise ValueError("--eval-only requires --load-model-dir")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    corpus, pairs = load_pairs(args.corpus_manifest, args.low_render_scale)
    loaded = load_pair_arrays(pairs, args.foregroundThreshold, args.edgeBandMode, args.edgeBandThreshold, args.edgeBandDilate, args.featureInputMode)
    train_items, eval_items = split_pairs(loaded)
    rng = np.random.default_rng(args.seed)
    mx.random.seed(args.seed)

    loadedModelArtifact = None
    loadedModelArtifactReport = None
    if args.loadModelDir:
        loadedModelArtifact = load_model_artifact(args.loadModelDir)
        loadedModelArtifactReport = {
            key: value
            for key, value in loadedModelArtifact.items()
            if key != "raw"
        }
        loaded_config = loadedModelArtifact["model"]
        modelArch = loaded_config["modelArch"]
        hiddenChannels = int(loaded_config["hiddenChannels"])
        input_channels = int(loaded_config["inputChannels"])
        conditionRenderScale = bool(loaded_config["conditionRenderScale"])
        featureInputMode = loaded_config.get("featureInputMode", args.featureInputMode)
        scaleChannel = loaded_config.get("scaleChannel")
        loaded_detail_gate = loaded_config.get("detailGate")
        detailGate = float(loaded_detail_gate) if loaded_detail_gate is not None else args.detailResidualGate
        residualOutputLimit = float(loaded_config.get("residualOutputLimit", args.residualOutputLimit))
        residualColorMode = loaded_config.get("residualColorMode", args.residualColorMode)
        chromaResidualScale = float(loaded_config.get("chromaResidualScale", args.chromaResidualScale))
        residualApplicationMaskMode = loaded_config.get("residualApplicationMaskMode", args.residualApplicationMaskMode)
        residualMaskFeatherRadius = int(loaded_config.get("residualMaskFeatherRadius", args.residualMaskFeatherRadius))
        modelConfigSource = "loadedModelArtifact"
    else:
        modelArch = args.modelArch
        hiddenChannels = args.hidden_channels
        conditionRenderScale = args.conditionRenderScale
        featureInputMode = args.featureInputMode
        input_channels = 3 + feature_input_channels(featureInputMode) + (1 if conditionRenderScale else 0)
        scaleChannel = "lowRenderScale" if conditionRenderScale else None
        detailGate = args.detailResidualGate
        residualOutputLimit = args.residualOutputLimit
        residualColorMode = args.residualColorMode
        chromaResidualScale = args.chromaResidualScale
        residualApplicationMaskMode = args.residualApplicationMaskMode
        residualMaskFeatherRadius = args.residualMaskFeatherRadius
        modelConfigSource = "cli"

    model = make_model(modelArch, hiddenChannels, input_channels, detailGate, residualOutputLimit, residualColorMode, chromaResidualScale)
    if loadedModelArtifact:
        model.load_weights(loadedModelArtifact["weightsPath"])
        mx.eval(model.parameters())
    effectiveModelConfig = model_config(
        modelArch,
        hiddenChannels,
        input_channels,
        conditionRenderScale,
        scaleChannel,
        featureInputMode,
        detailGate,
        residualOutputLimit,
        residualApplicationMaskMode,
        residualMaskFeatherRadius,
        residualColorMode,
        chromaResidualScale,
    )
    effectiveMaxSteps = 0 if args.evalOnly else args.maxSteps
    optimizer = optim.Adam(learning_rate=args.learning_rate)
    temporalTrainPairCount = len(temporal_pair_candidates(train_items))
    temporalEvalPairCount = len(temporal_pair_candidates(eval_items))
    temporalSelectedPairCount = len(temporal_pair_candidates(loaded))
    temporal_loss_pairs = temporal_pair_candidates(train_items)
    temporalLossFallback = None
    wantsTemporalPairLoss = args.temporalLossWeight > 0 or args.residualTemporalLossWeight > 0
    if wantsTemporalPairLoss and not temporal_loss_pairs:
        temporal_loss_pairs = temporal_pair_candidates(loaded)
        temporalLossFallback = "selected-pairs-no-train-adjacent" if temporal_loss_pairs else "no-adjacent-same-scale-pairs"
    temporalLossPairCount = len(temporal_loss_pairs)
    activeTemporalLossWeight = args.temporalLossWeight if temporalLossPairCount else 0.0
    activeResidualTemporalLossWeight = args.residualTemporalLossWeight if temporalLossPairCount else 0.0

    def loss_fn(model_instance, low_batch, high_batch, edge_mask_batch, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch, previous_mask_batch, current_mask_batch):
        prediction = model_instance(low_batch, residual_application_mask(edge_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius))
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
        total_loss = still_loss
        total_loss = total_loss + edge_band_loss_value(
            prediction,
            high_batch,
            low_batch,
            edge_mask_batch,
            args.edgeLossWeight,
            args.edgeGradientLossWeight,
            args.outsideEdgeResidualWeight,
        )
        if args.residualSmoothnessLossWeight > 0:
            total_loss = total_loss + float(args.residualSmoothnessLossWeight) * residual_smoothness_loss_value(
                prediction,
                low_batch,
                edge_mask_batch,
            )
        if args.chromaResidualLossWeight > 0:
            total_loss = total_loss + float(args.chromaResidualLossWeight) * chroma_residual_loss_value(
                prediction,
                low_batch,
                edge_mask_batch,
            )
        if activeTemporalLossWeight > 0:
            total_loss = total_loss + activeTemporalLossWeight * temporal_loss_value(
                model_instance,
                previous_low_batch,
                current_low_batch,
                previous_high_batch,
                current_high_batch,
                previous_mask_batch,
                current_mask_batch,
                residualApplicationMaskMode,
                residualMaskFeatherRadius,
            )
        if activeResidualTemporalLossWeight > 0:
            total_loss = total_loss + activeResidualTemporalLossWeight * residual_temporal_loss_value(
                model_instance,
                previous_low_batch,
                current_low_batch,
                previous_mask_batch,
                current_mask_batch,
                residualApplicationMaskMode,
                residualMaskFeatherRadius,
            )
        return total_loss

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    training_losses = []
    temporalTrainingLosses = []
    residualTemporalTrainingLosses = []
    started = time.time()
    for step in range(max(0, effectiveMaxSteps)):
        low_batch, high_batch, edge_mask_batch, _target_edge_mask_batch = sample_patch_batch(
            train_items,
            rng,
            args.batch_size,
            args.patch_size,
            args.foregroundProbability,
            args.edgeSamplingProbability,
            conditionRenderScale,
            featureInputMode,
        )
        if activeTemporalLossWeight > 0 or activeResidualTemporalLossWeight > 0:
            previous_low_batch, current_low_batch, previous_high_batch, current_high_batch, previous_mask_batch, current_mask_batch = sample_temporal_pair_batch(
                temporal_loss_pairs,
                rng,
                args.batch_size,
                args.patch_size,
                args.foregroundProbability,
                conditionRenderScale,
                featureInputMode,
            )
        else:
            previous_low_batch = low_batch
            current_low_batch = low_batch
            previous_high_batch = high_batch
            current_high_batch = high_batch
            previous_mask_batch = edge_mask_batch
            current_mask_batch = edge_mask_batch
        loss, grads = loss_and_grad(model, low_batch, high_batch, edge_mask_batch, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch, previous_mask_batch, current_mask_batch)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), optimizer.state, loss)
        loss_float = float(loss)
        if step == 0 or step == effectiveMaxSteps - 1 or (step + 1) % max(1, effectiveMaxSteps // 10) == 0:
            entry = {"step": step + 1, "loss": loss_float}
            if activeTemporalLossWeight > 0:
                temporal_loss = temporal_loss_value(model, previous_low_batch, current_low_batch, previous_high_batch, current_high_batch, previous_mask_batch, current_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius)
                mx.eval(temporal_loss)
                temporal_loss_float = float(temporal_loss)
                entry["temporalLoss"] = temporal_loss_float
                temporalTrainingLosses.append({"step": step + 1, "temporalLoss": temporal_loss_float})
            if activeResidualTemporalLossWeight > 0:
                residual_temporal_loss = residual_temporal_loss_value(model, previous_low_batch, current_low_batch, previous_mask_batch, current_mask_batch, residualApplicationMaskMode, residualMaskFeatherRadius)
                mx.eval(residual_temporal_loss)
                residual_temporal_loss_float = float(residual_temporal_loss)
                entry["residualTemporalLoss"] = residual_temporal_loss_float
                residualTemporalTrainingLosses.append({"step": step + 1, "residualTemporalLoss": residual_temporal_loss_float})
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
        args.edgeSamplingProbability,
        conditionRenderScale,
        featureInputMode,
        args.foregroundThreshold,
        args.foregroundLossWeight,
        args.differenceLossWeight,
        residualApplicationMaskMode,
        residualMaskFeatherRadius,
    )
    preview_path = out_dir / "residual-preview-low-model-target-diff.png"
    diagnostic_preview_path = out_dir / "residual-preview-low-model-target-targetres-modelres-error-mask.png"
    previewFocus = make_preview(model, eval_items[0], preview_path, diagnostic_preview_path, args.preview_size, args.preview_mode, conditionRenderScale, featureInputMode, residualApplicationMaskMode, residualMaskFeatherRadius)
    previewFrames = make_preview_frames(
        model,
        eval_items,
        out_dir,
        args.preview_size,
        args.preview_mode,
        conditionRenderScale,
        featureInputMode,
        residualApplicationMaskMode,
        residualMaskFeatherRadius,
        args.previewFrameCount,
        preview_path,
        diagnostic_preview_path,
        previewFocus,
    )
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
            conditionRenderScale,
            featureInputMode,
            args.temporalEvalScope,
            args.residualContinuationMode,
            args.residualContinuationAlpha,
            residualApplicationMaskMode,
            residualMaskFeatherRadius,
        )
    residualContinuationEffectiveMode = temporalMetrics.get(
        "residualContinuationEffectiveMode",
        "none" if args.residualContinuationMode == "none" else "not-evaluated",
    )
    savedModelArtifact = None
    if args.saveModelDir:
        savedModelArtifact = save_model_artifact(
            model,
            args.saveModelDir,
            effectiveModelConfig,
            args,
            corpus,
            metrics,
            effectiveMaxSteps,
            modelConfigSource,
        )
    report = {
        "schema": SCHEMA,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "corpusManifest": str(Path(args.corpus_manifest).resolve()),
        "corpusSchema": corpus.get("schema"),
        "pairAuthority": corpus.get("pairAuthority"),
        "imageAuthority": corpus.get("imageAuthority"),
        "lowRenderScale": args.low_render_scale,
        "requestedModelArch": args.modelArch,
        "modelArch": modelArch,
        "modelConfigSource": modelConfigSource,
        "modelArtifactSchema": MODEL_ARTIFACT_SCHEMA,
        "modelArtifactAuthority": MODEL_ARTIFACT_AUTHORITY,
        "requestedSaveModelDir": str(Path(args.saveModelDir).resolve()) if args.saveModelDir else None,
        "requestedLoadModelDir": str(Path(args.loadModelDir).resolve()) if args.loadModelDir else None,
        "savedModelArtifact": savedModelArtifact,
        "loadedModelArtifact": loadedModelArtifactReport,
        "evalOnly": args.evalOnly,
        "trainingSkipped": args.evalOnly,
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
        "effectiveMaxSteps": effectiveMaxSteps,
        "sleepMs": args.sleepMs,
        "lossMode": args.loss_mode,
        "foregroundThreshold": args.foregroundThreshold,
        "foregroundProbability": args.foregroundProbability,
        "foregroundLossWeight": args.foregroundLossWeight,
        "differenceLossWeight": args.differenceLossWeight,
        "edgeBandMode": args.edgeBandMode,
        "edgeBandAuthority": edge_band_authority(args.edgeBandMode),
        "edgeBandThreshold": args.edgeBandThreshold,
        "edgeBandDilate": args.edgeBandDilate,
        "edgeSamplingProbability": args.edgeSamplingProbability,
        "edgeLossWeight": args.edgeLossWeight,
        "edgeGradientLossWeight": args.edgeGradientLossWeight,
        "outsideEdgeResidualWeight": args.outsideEdgeResidualWeight,
        "residualOutputLimit": residualOutputLimit,
        "residualColorMode": residualColorMode,
        "chromaResidualScale": chromaResidualScale,
        "chromaResidualLossWeight": args.chromaResidualLossWeight,
        "residualApplicationMaskMode": residualApplicationMaskMode,
        "residualMaskFeatherRadius": residualMaskFeatherRadius,
        "residualApplicationMaskAuthority": residual_application_mask_authority(residualApplicationMaskMode, args.edgeBandMode),
        "residualSmoothnessLossWeight": args.residualSmoothnessLossWeight,
        "conditionRenderScale": conditionRenderScale,
        "featureInputMode": featureInputMode,
        "featureInputAuthority": feature_input_authority(featureInputMode),
        "featureInputChannels": feature_input_channels(featureInputMode),
        "featurePaths": {
            item["id"]: item.get("featurePath")
            for item in loaded
        },
        "temporalLossWeight": args.temporalLossWeight,
        "activeTemporalLossWeight": activeTemporalLossWeight,
        "residualTemporalLossWeight": args.residualTemporalLossWeight,
        "activeResidualTemporalLossWeight": activeResidualTemporalLossWeight,
        "residualContinuationMode": args.residualContinuationMode,
        "residualContinuationEffectiveMode": residualContinuationEffectiveMode,
        "residualContinuationAlpha": args.residualContinuationAlpha,
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
        "previewFrameCount": args.previewFrameCount,
        "fullFramePreview": args.preview_mode == "full-frame",
        "previewFocus": previewFocus,
        "temporalEval": args.temporalEval,
        "temporalEvalScope": args.temporalEvalScope,
        "inputChannels": input_channels,
        "scaleChannel": scaleChannel,
        "featureInputMode": featureInputMode,
        "featureInputAuthority": feature_input_authority(featureInputMode),
        "featureInputChannels": feature_input_channels(featureInputMode),
        "foregroundPixels": {
            item["id"]: item["foregroundPixels"]
            for item in loaded
        },
        "edgeBandPixels": {
            item["id"]: item["edgeBandPixels"]
            for item in loaded
        },
        "edgeBandCoverage": {
            item["id"]: item["edgeBandCoverage"]
            for item in loaded
        },
        "edgeBandSignalMax": {
            item["id"]: item["edgeBandSignalMax"]
            for item in loaded
        },
        "targetEdgeBandPixels": {
            item["id"]: item["targetEdgeBandPixels"]
            for item in loaded
        },
        "targetEdgeBandCoverage": {
            item["id"]: item["targetEdgeBandCoverage"]
            for item in loaded
        },
        "targetEdgeBandSignalMax": {
            item["id"]: item["targetEdgeBandSignalMax"]
            for item in loaded
        },
        "batchSize": args.batch_size,
        "patchSize": args.patch_size,
        "hiddenChannels": hiddenChannels,
        "detailGate": detailGate if modelArch == "gated-detail-residual" else None,
        "residualOutputLimit": residualOutputLimit,
        "residualColorMode": residualColorMode,
        "chromaResidualScale": chromaResidualScale,
        "chromaResidualLossWeight": args.chromaResidualLossWeight,
        "residualApplicationMaskMode": residualApplicationMaskMode,
        "residualMaskFeatherRadius": residualMaskFeatherRadius,
        "residualApplicationMaskAuthority": residual_application_mask_authority(residualApplicationMaskMode, args.edgeBandMode),
        "residualSmoothnessLossWeight": args.residualSmoothnessLossWeight,
        "learningRate": args.learning_rate,
        "evalPatches": args.eval_patches,
        "durationSeconds": duration_seconds,
        "device": str(mx.default_device()),
        "trainingLosses": training_losses,
        "temporalTrainingLosses": temporalTrainingLosses,
        "residualTemporalTrainingLosses": residualTemporalTrainingLosses,
        **metrics,
        **temporalMetrics,
        "preview": str(preview_path),
        "diagnosticPreview": str(diagnostic_preview_path),
        "previewFrames": previewFrames,
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
