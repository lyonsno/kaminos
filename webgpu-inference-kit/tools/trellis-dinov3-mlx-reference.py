#!/usr/bin/env python3
"""Export pinned F32 DINOv3 conditioning or mode-selected stage packets.

Stage-local packets include the attention-only boundary and complete MLP residuals,
and stop before TRELLIS' final no-affine LayerNorm.
full-conditioning exports every transformer block's F32 weights and the
actual final, normalized DINO feature tensor consumed by TRELLIS.

Run with the trellis2mlx environment and its source checkout on PYTHONPATH.
Stage-local modes stop before TRELLIS' final no-affine LayerNorm; full-conditioning
includes it and emits the final `[1,1029,1024]` feature tensor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

import numpy as np
from PIL import Image
from safetensors import safe_open

SCHEMA = "kaminos.trellis-dinov3-mlx-prefix-block-reference.v1"
MODEL_ID = "facebook/dinov3-vitl16-pretrain-lvd1689m"
REVISION = "ea8dc2863c51be0a264bab82070e3e8836b02d51"
EXPECTED_TRELLIS_REFERENCE_REVISION = "cddaf3cb8a9f28956114956ebe754d6661a3f695"
EXPECTED_TRELLIS_DINOV3_SOURCE_SHA256 = "5e56c76b947bbd59e9353c06470101ac28b6462649161cc8dd3740b2cf66403c"
EXPECTED_SOURCE_SHA256 = "abf395cc52d81c26dadae9f024072d6c7301679be4e8fc08d572723d7ae32a21"
MODEL_FILES = {
    "model.safetensors": "dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179",
    "config.json": "135ecd23e34a70b6fbed8b083fdecb319b7e3a54e3d849258bbe4ddcf1783bb5",
    "preprocessor_config.json": "960c41d1f3a7778b936365769a2d90550b318a6c0a53a0296957adacfe5e0dd7",
}
EXPECTED_CONFIG = {
    "model_type": "dinov3_vit", "hidden_size": 1024, "num_attention_heads": 16,
    "num_hidden_layers": 24, "patch_size": 16, "num_register_tokens": 4,
    "intermediate_size": 4096, "rope_theta": 100.0, "layer_norm_eps": 1e-5,
}
MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
SUPPORTED_MODES = (
    "block0-parity", "resident-handoff", "resident-block1",
    "resident-block2-norm1", "resident-block2-attention", "resident-block2-mlp",
    "full-conditioning",
)


def validate_full_conditioning_features(value: np.ndarray) -> np.ndarray:
    """Validate the TRELLIS DINO ABI without silently recasting or truncating."""
    array = np.asarray(value)
    if array.dtype != np.float32:
        raise ValueError(f"full conditioning features must be float32, got {array.dtype}")
    if array.shape != (1, 1029, 1024):
        raise ValueError(f"full conditioning features have unexpected shape {array.shape}; expected (1, 1029, 1024)")
    if not np.isfinite(array).all():
        raise ValueError("full conditioning features contain non-finite values")
    return np.ascontiguousarray(array)


def layer_weight_tensors(model) -> dict[str, object]:
    """Return the complete, untruncated checkpoint tensor inventory by block."""
    if len(model.layers) != EXPECTED_CONFIG["num_hidden_layers"]:
        raise ValueError(
            f"full conditioning requires all {EXPECTED_CONFIG['num_hidden_layers']} DINO layers, got {len(model.layers)}"
        )
    tensors = {}
    for index, layer in enumerate(model.layers):
        prefix = f"layer{index}_"
        for name, value in (
            ("norm1_weight", layer.norm1.weight), ("norm1_bias", layer.norm1.bias),
            ("q_weight", layer.attention.q_proj.weight), ("q_bias", layer.attention.q_proj.bias),
            ("k_weight", layer.attention.k_proj.weight),
            ("v_weight", layer.attention.v_proj.weight), ("v_bias", layer.attention.v_proj.bias),
            ("o_weight", layer.attention.o_proj.weight), ("o_bias", layer.attention.o_proj.bias),
            ("layer_scale1", layer.layer_scale1),
            ("norm2_weight", layer.norm2.weight), ("norm2_bias", layer.norm2.bias),
            ("mlp_up_weight", layer.mlp.up_proj.weight), ("mlp_up_bias", layer.mlp.up_proj.bias),
            ("mlp_down_weight", layer.mlp.down_proj.weight), ("mlp_down_bias", layer.mlp.down_proj.bias),
            ("layer_scale2", layer.layer_scale2),
        ):
            tensors[prefix + name] = value
    return tensors


def require_mx_f32(mx, value, name: str) -> np.ndarray:
    if getattr(value, "dtype", None) != mx.float32:
        raise ValueError(f"full-conditioning tensor {name} is not MLX float32: {getattr(value, 'dtype', None)}")
    return np_f32(mx, value)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_pinned_full_conditioning_source(revision: str, source_sha256: str) -> None:
    """Admit only the reviewed native TRELLIS implementation for full export."""
    if revision != EXPECTED_TRELLIS_REFERENCE_REVISION:
        raise ValueError(
            "full-conditioning TRELLIS source revision mismatch: "
            f"{revision} != {EXPECTED_TRELLIS_REFERENCE_REVISION}"
        )
    if source_sha256 != EXPECTED_TRELLIS_DINOV3_SOURCE_SHA256:
        raise ValueError(
            "full-conditioning DINOv3 source digest mismatch: "
            f"{source_sha256} != {EXPECTED_TRELLIS_DINOV3_SOURCE_SHA256}"
        )


def record_array(out_dir: Path, name: str, value: np.ndarray, role: str) -> dict:
    array = np.ascontiguousarray(value, dtype=np.float32)
    payload = array.tobytes(order="C")
    filename = f"{name}.f32"
    (out_dir / filename).write_bytes(payload)
    return {
        "role": role, "file": filename, "dtype": "float32", "shape": list(array.shape),
        "byteLength": len(payload), "sha256": sha256_bytes(payload),
    }


def require_model_snapshot(model_dir: Path) -> tuple[dict, dict]:
    model_dir = model_dir.resolve()
    if model_dir.name != REVISION:
        raise ValueError(f"model snapshot must be the pinned revision directory {REVISION}, got {model_dir.name}")
    files = {}
    for filename, expected in MODEL_FILES.items():
        path = model_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f"pinned model file missing: {path}")
        actual = file_sha256(path)
        if actual != expected:
            raise ValueError(f"pinned model digest mismatch for {filename}: {actual} != {expected}")
        files[filename] = {"path": str(path), "sha256": actual, "byteLength": path.stat().st_size}
    config = json.loads((model_dir / "config.json").read_text())
    mismatches = {key: (config.get(key), expected) for key, expected in EXPECTED_CONFIG.items() if config.get(key) != expected}
    if mismatches:
        raise ValueError(f"DINOv3 config does not match the native TRELLIS architecture: {mismatches}")
    preprocessor = json.loads((model_dir / "preprocessor_config.json").read_text())
    if preprocessor.get("image_mean") != [0.485, 0.456, 0.406] or preprocessor.get("image_std") != [0.229, 0.224, 0.225]:
        raise ValueError("preprocessor ImageNet mean/std differs from the native DINOv3 route")
    return files, {**config, "preprocessor": preprocessor}


def preprocess_source(source: Path) -> tuple[np.ndarray, dict]:
    original_bytes = source.read_bytes()
    source_sha256 = sha256_bytes(original_bytes)
    if source_sha256 != EXPECTED_SOURCE_SHA256:
        raise ValueError(f"source image digest mismatch: {source_sha256} != {EXPECTED_SOURCE_SHA256}")
    with Image.open(source) as opened:
        rgb = opened.convert("RGB")
    original_size = list(rgb.size)
    # Match trellmlx.models.dinov3.extract_features exactly, including the
    # 512x512 PIL Lanczos operation even when its input size already matches.
    resized = rgb.resize((512, 512), Image.LANCZOS)
    pixels = np.asarray(resized, dtype=np.float32) / np.float32(255.0)
    normalized = np.ascontiguousarray((pixels - MEAN) / STD, dtype=np.float32)[None, ...]
    pixel_bytes = normalized.tobytes(order="C")
    return normalized, {
        "sourcePath": str(source.resolve()), "sourceFileSha256": source_sha256,
        "sourceByteLength": len(original_bytes), "sourceRgbSize": original_size,
        "resize": {"size": [512, 512], "filter": "PIL.Image.LANCZOS", "operationApplied": True},
        "scale": "float32(pixel)/255.0", "mean": MEAN.tolist(), "std": STD.tolist(),
        "layout": "NHWC", "dtype": "float32", "pixelValuesShape": [1, 512, 512, 3],
        "pixelValuesSha256": sha256_bytes(pixel_bytes), "pixelValuesByteLength": len(pixel_bytes),
    }


def np_f32(mx, value) -> np.ndarray:
    mx.eval(value)
    return np.ascontiguousarray(np.asarray(value, dtype=np.float32))


def execute(args) -> dict:
    # Import MLX only inside the guarded execution so a missing runtime still
    # leaves the caller a durable failure manifest.
    import mlx.core as mx
    import mlx.nn as nn

    model_dir = Path(args.model_dir).resolve()
    files, config = require_model_snapshot(model_dir)
    source = Path(args.source_image).resolve()
    pixels_np, preprocessing = preprocess_source(source)

    # Import from the explicitly supplied TRELLIS.2MLX checkout. The native
    # class defines exact RoPE, attention, LayerScale, LayerNorm and GELU law.
    sys.path.insert(0, str(Path(args.trellis_root).resolve()))
    from trellmlx.models.dinov3 import DINOv3ViT, load_dinov3_weights
    trellis_root = Path(args.trellis_root).resolve()
    dinov3_source = trellis_root / "trellmlx/models/dinov3.py"
    trellis_revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=trellis_root, text=True).strip()
    dinov3_source_sha256 = file_sha256(dinov3_source)
    if args.mode == "full-conditioning":
        require_pinned_full_conditioning_source(trellis_revision, dinov3_source_sha256)

    model = DINOv3ViT(
        hidden_size=config["hidden_size"], num_heads=config["num_attention_heads"],
        num_layers=config["num_hidden_layers"], patch_size=config["patch_size"],
        num_register_tokens=config["num_register_tokens"], intermediate_size=config["intermediate_size"],
        rope_theta=config["rope_theta"], layer_norm_eps=config["layer_norm_eps"],
    )
    with safe_open(str(model_dir / "model.safetensors"), framework="numpy") as handle:
        tensor_dtypes = {handle.get_slice(name).get_dtype() for name in handle.keys()}
        if tensor_dtypes != {"F32"}:
            raise ValueError(f"checkpoint tensor precision is not uniformly F32: {sorted(tensor_dtypes)}")
    loaded_count = load_dinov3_weights(model, str(model_dir))

    pixel_values = mx.array(pixels_np, dtype=mx.float32)
    patch_map = model.patch_embed(pixel_values)
    batch, grid_height, grid_width, hidden_size = patch_map.shape
    if (batch, grid_height, grid_width, hidden_size) != (1, 32, 32, 1024):
        raise ValueError(f"unexpected patch embedding geometry {patch_map.shape}")
    patch_embeddings = patch_map.reshape(batch, grid_height * grid_width, hidden_size)
    class_token = mx.broadcast_to(model.cls_token, (batch, 1, hidden_size))
    register_tokens = mx.broadcast_to(model.register_tokens, (batch, config["num_register_tokens"], hidden_size))
    prefix_hidden_states = mx.concatenate([class_token, register_tokens, patch_embeddings], axis=1)
    cos, sin = model._compute_rope(grid_height, grid_width)
    block0_hidden_states = model.layers[0](prefix_hidden_states, cos, sin, model.num_prefix_tokens)
    block1 = model.layers[1]
    block1_norm1_hidden_states = block1.norm1(block0_hidden_states)
    block1_attention_output = block1.attention(block1_norm1_hidden_states, cos, sin, model.num_prefix_tokens)
    block1_after_attention_hidden_states = block0_hidden_states + block1_attention_output * block1.layer_scale1
    block1_norm2_hidden_states = block1.norm2(block1_after_attention_hidden_states)
    block1_mlp_hidden_states = nn.gelu(block1.mlp.up_proj(block1_norm2_hidden_states))
    block1_mlp_output = block1.mlp.down_proj(block1_mlp_hidden_states)
    block1_after_mlp_hidden_states = block1_after_attention_hidden_states + block1_mlp_output * block1.layer_scale2
    block2 = model.layers[2]
    block2_norm1_hidden_states = block2.norm1(block1_after_mlp_hidden_states)
    block2_attention_output = block2.attention(block2_norm1_hidden_states, cos, sin, model.num_prefix_tokens)
    block2_after_attention_hidden_states = block1_after_mlp_hidden_states + block2_attention_output * block2.layer_scale1
    evaluated_states = [
        patch_embeddings, prefix_hidden_states, block0_hidden_states,
        block1_norm1_hidden_states, block1_after_attention_hidden_states,
        block1_norm2_hidden_states, block1_mlp_hidden_states, block1_mlp_output,
        block1_after_mlp_hidden_states, block2_norm1_hidden_states, block2_after_attention_hidden_states,
    ]
    if args.mode == "resident-block2-mlp":
        block2_norm2_hidden_states = block2.norm2(block2_after_attention_hidden_states)
        block2_mlp_hidden_states = nn.gelu(block2.mlp.up_proj(block2_norm2_hidden_states))
        block2_mlp_output = block2.mlp.down_proj(block2_mlp_hidden_states)
        block2_after_mlp_hidden_states = block2_after_attention_hidden_states + block2_mlp_output * block2.layer_scale2
        evaluated_states.extend([
            block2_norm2_hidden_states, block2_mlp_hidden_states, block2_mlp_output, block2_after_mlp_hidden_states,
        ])
    full_conditioning_features = None
    if args.mode == "full-conditioning":
        # Use the model's actual complete call, including all 24 blocks and the
        # final no-affine LayerNorm TRELLIS expects. This is the native consumer
        # tensor, not a hand-selected intermediate block boundary.
        full_conditioning_features = model(pixel_values)
        if full_conditioning_features.dtype != mx.float32:
            raise ValueError(f"full DINO output is not MLX float32: {full_conditioning_features.dtype}")
        mx.eval(full_conditioning_features)
        evaluated_states.append(full_conditioning_features)
    mx.eval(*evaluated_states)

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = {}
    arrays = {
        "pixel_values": (pixels_np, "normalized-input-pixels"),
        "patch_embeddings": (np_f32(mx, patch_embeddings), "mlmodel-patch-embedding-output"),
        "prefix_hidden_states": (np_f32(mx, prefix_hidden_states), "mlmodel-dinov3-prefix-output"),
        "block0_hidden_states": (np_f32(mx, block0_hidden_states), "mlmodel-dinov3-block0-output"),
        "block1_norm1_hidden_states": (np_f32(mx, block1_norm1_hidden_states), "mlmodel-dinov3-block1-norm1-output"),
        "block1_after_attention_hidden_states": (np_f32(mx, block1_after_attention_hidden_states), "mlmodel-dinov3-block1-attention-residual-output"),
        "block1_norm2_hidden_states": (np_f32(mx, block1_norm2_hidden_states), "mlmodel-dinov3-block1-norm2-output"),
        "block1_mlp_hidden_states": (np_f32(mx, block1_mlp_hidden_states), "mlmodel-dinov3-block1-mlp-gelu-output"),
        "block1_mlp_output": (np_f32(mx, block1_mlp_output), "mlmodel-dinov3-block1-mlp-projection-output"),
        "block1_after_mlp_hidden_states": (np_f32(mx, block1_after_mlp_hidden_states), "mlmodel-dinov3-block1-output-before-final-no-affine-norm"),
        "block2_norm1_hidden_states": (np_f32(mx, block2_norm1_hidden_states), "mlmodel-dinov3-block2-norm1-output-before-attention"),
        "block2_after_attention_hidden_states": (np_f32(mx, block2_after_attention_hidden_states), "mlmodel-dinov3-block2-attention-residual-output-before-norm2"),
        "patch_projection": (np_f32(mx, model.patch_embed.weight), "checkpoint-patch-projection-out-kh-kw-in"),
        "patch_bias": (np_f32(mx, model.patch_embed.bias), "checkpoint-patch-projection-bias"),
        "class_token": (np_f32(mx, model.cls_token), "checkpoint-class-token"),
        "register_tokens": (np_f32(mx, model.register_tokens), "checkpoint-register-tokens"),
        "rope_cos": (np_f32(mx, cos), "dinov3-block0-2d-rope-cos-f32"),
        "rope_sin": (np_f32(mx, sin), "dinov3-block0-2d-rope-sin-f32"),
    }
    if args.mode == "resident-block2-mlp":
        arrays.update({
            "block2_norm2_hidden_states": (np_f32(mx, block2_norm2_hidden_states), "mlmodel-dinov3-block2-norm2-output-before-mlp"),
            "block2_mlp_hidden_states": (np_f32(mx, block2_mlp_hidden_states), "mlmodel-dinov3-block2-mlp-gelu-output"),
            "block2_mlp_output": (np_f32(mx, block2_mlp_output), "mlmodel-dinov3-block2-mlp-projection-output"),
            "block2_after_mlp_hidden_states": (np_f32(mx, block2_after_mlp_hidden_states), "mlmodel-dinov3-block2-output-before-final-no-affine-norm"),
        })
    if args.mode == "full-conditioning":
        arrays["conditioning_features"] = (
            validate_full_conditioning_features(np.asarray(full_conditioning_features)),
            "trellis-dinov3-final-no-affine-layernorm-conditioning-features",
        )
        for name, value in layer_weight_tensors(model).items():
            role = "checkpoint-" + name.replace("_", "-")
            arrays[name] = (require_mx_f32(mx, value, name), role)
    layer = model.layers[0]
    for name, value, role in [
        ("layer0_norm1_weight", layer.norm1.weight, "checkpoint-layer0-norm1-weight"),
        ("layer0_norm1_bias", layer.norm1.bias, "checkpoint-layer0-norm1-bias"),
        ("layer0_q_weight", layer.attention.q_proj.weight, "checkpoint-layer0-q-weight-out-in"),
        ("layer0_q_bias", layer.attention.q_proj.bias, "checkpoint-layer0-q-bias"),
        ("layer0_k_weight", layer.attention.k_proj.weight, "checkpoint-layer0-k-weight-out-in"),
        ("layer0_v_weight", layer.attention.v_proj.weight, "checkpoint-layer0-v-weight-out-in"),
        ("layer0_v_bias", layer.attention.v_proj.bias, "checkpoint-layer0-v-bias"),
        ("layer0_o_weight", layer.attention.o_proj.weight, "checkpoint-layer0-o-weight-out-in"),
        ("layer0_o_bias", layer.attention.o_proj.bias, "checkpoint-layer0-o-bias"),
        ("layer0_layer_scale1", layer.layer_scale1, "checkpoint-layer0-attention-layer-scale"),
        ("layer0_norm2_weight", layer.norm2.weight, "checkpoint-layer0-norm2-weight"),
        ("layer0_norm2_bias", layer.norm2.bias, "checkpoint-layer0-norm2-bias"),
        ("layer0_mlp_up_weight", layer.mlp.up_proj.weight, "checkpoint-layer0-mlp-up-weight-out-in"),
        ("layer0_mlp_up_bias", layer.mlp.up_proj.bias, "checkpoint-layer0-mlp-up-bias"),
        ("layer0_mlp_down_weight", layer.mlp.down_proj.weight, "checkpoint-layer0-mlp-down-weight-out-in"),
        ("layer0_mlp_down_bias", layer.mlp.down_proj.bias, "checkpoint-layer0-mlp-down-bias"),
        ("layer0_layer_scale2", layer.layer_scale2, "checkpoint-layer0-mlp-layer-scale"),
    ]:
        arrays[name] = (np_f32(mx, value), role)
    arrays["layer2_norm1_weight"] = (np_f32(mx, block2.norm1.weight), "checkpoint-layer2-norm1-weight")
    arrays["layer2_norm1_bias"] = (np_f32(mx, block2.norm1.bias), "checkpoint-layer2-norm1-bias")
    for name, value, role in [
        ("layer2_q_weight", block2.attention.q_proj.weight, "checkpoint-layer2-q-weight-out-in"),
        ("layer2_q_bias", block2.attention.q_proj.bias, "checkpoint-layer2-q-bias"),
        ("layer2_k_weight", block2.attention.k_proj.weight, "checkpoint-layer2-k-weight-out-in"),
        ("layer2_v_weight", block2.attention.v_proj.weight, "checkpoint-layer2-v-weight-out-in"),
        ("layer2_v_bias", block2.attention.v_proj.bias, "checkpoint-layer2-v-bias"),
        ("layer2_o_weight", block2.attention.o_proj.weight, "checkpoint-layer2-o-weight-out-in"),
        ("layer2_o_bias", block2.attention.o_proj.bias, "checkpoint-layer2-o-bias"),
        ("layer2_layer_scale1", block2.layer_scale1, "checkpoint-layer2-attention-layer-scale"),
        ("layer2_norm2_weight", block2.norm2.weight, "checkpoint-layer2-norm2-weight"),
        ("layer2_norm2_bias", block2.norm2.bias, "checkpoint-layer2-norm2-bias"),
        ("layer2_mlp_up_weight", block2.mlp.up_proj.weight, "checkpoint-layer2-mlp-up-weight-out-in"),
        ("layer2_mlp_up_bias", block2.mlp.up_proj.bias, "checkpoint-layer2-mlp-up-bias"),
        ("layer2_mlp_down_weight", block2.mlp.down_proj.weight, "checkpoint-layer2-mlp-down-weight-out-in"),
        ("layer2_mlp_down_bias", block2.mlp.down_proj.bias, "checkpoint-layer2-mlp-down-bias"),
        ("layer2_layer_scale2", block2.layer_scale2, "checkpoint-layer2-mlp-layer-scale"),
    ]:
        arrays[name] = (np_f32(mx, value), role)
    block1 = model.layers[1]
    arrays["layer1_norm2_weight"] = (np_f32(mx, block1.norm2.weight), "checkpoint-layer1-norm2-weight")
    arrays["layer1_norm2_bias"] = (np_f32(mx, block1.norm2.bias), "checkpoint-layer1-norm2-bias")
    for name, value, role in [
        ("layer1_mlp_up_weight", block1.mlp.up_proj.weight, "checkpoint-layer1-mlp-up-weight-out-in"),
        ("layer1_mlp_up_bias", block1.mlp.up_proj.bias, "checkpoint-layer1-mlp-up-bias"),
        ("layer1_mlp_down_weight", block1.mlp.down_proj.weight, "checkpoint-layer1-mlp-down-weight-out-in"),
        ("layer1_mlp_down_bias", block1.mlp.down_proj.bias, "checkpoint-layer1-mlp-down-bias"),
        ("layer1_layer_scale2", block1.layer_scale2, "checkpoint-layer1-mlp-layer-scale"),
    ]:
        arrays[name] = (np_f32(mx, value), role)
    arrays["layer1_norm1_weight"] = (np_f32(mx, block1.norm1.weight), "checkpoint-layer1-norm1-weight")
    arrays["layer1_norm1_bias"] = (np_f32(mx, block1.norm1.bias), "checkpoint-layer1-norm1-bias")
    for name, value, role in [
        ("layer1_q_weight", block1.attention.q_proj.weight, "checkpoint-layer1-q-weight-out-in"),
        ("layer1_q_bias", block1.attention.q_proj.bias, "checkpoint-layer1-q-bias"),
        ("layer1_k_weight", block1.attention.k_proj.weight, "checkpoint-layer1-k-weight-out-in"),
        ("layer1_v_weight", block1.attention.v_proj.weight, "checkpoint-layer1-v-weight-out-in"),
        ("layer1_v_bias", block1.attention.v_proj.bias, "checkpoint-layer1-v-bias"),
        ("layer1_o_weight", block1.attention.o_proj.weight, "checkpoint-layer1-o-weight-out-in"),
        ("layer1_o_bias", block1.attention.o_proj.bias, "checkpoint-layer1-o-bias"),
        ("layer1_layer_scale1", block1.layer_scale1, "checkpoint-layer1-attention-layer-scale"),
    ]:
        arrays[name] = (np_f32(mx, value), role)
    for name, (value, role) in arrays.items():
        if np.asarray(value).dtype != np.float32:
            raise ValueError(f"export tensor {name} is not f32: {np.asarray(value).dtype}")
        outputs[name] = record_array(out_dir, name, value, role)
    output_manifest = {
        "schema": SCHEMA, "ok": True,
        "reference": {"implementation": "trellmlx.models.dinov3.DINOv3ViT", "sourceRoot": str(trellis_root), "sourceRevision": trellis_revision, "sourceFile": str(dinov3_source), "sourceFileSha256": dinov3_source_sha256, "device": str(mx.default_device()), "mlxVersion": getattr(mx, "__version__", "unreported"), "loadedTensorCount": loaded_count},
        "model": {"id": MODEL_ID, "revision": REVISION, "files": files, "config": config, "dtype": "float32", "checkpointTensorDtypes": ["F32"]},
        "preprocessing": preprocessing,
        "computation": {"mode": args.mode, "precision": "float32", "framework": "MLX", "prefixTokens": ["class", "register0", "register1", "register2", "register3"], "patchTokens": 1024, "patchGrid": [32, 32], "sequenceLength": 1029, "hiddenSize": 1024, "ropeTheta": config["rope_theta"], "layerNormEps": config["layer_norm_eps"], "attention": "global-scaled-dot-product", "ropeAppliedTo": "patch q/k tokens only", "layerScale": "learned layer0/block1/block2 layer_scale1 and layer0/block1 layer_scale2", "residentProbeCompleteTransformerBlockCount": 1, "residentProbe": "layer1.attention(block1_norm1_hidden_states); block0_hidden_states + attention_output * layer1.layer_scale1", "residentProbeOutputBoundary": "after complete layer.0 and block1 attention residual; before block1 norm2 and final model LayerNorm", "residentBlock1CompleteTransformerBlockCount": 2, "residentBlock1Probe": "layer1.norm2(block1_after_attention_hidden_states); layer1.mlp(block1_norm2_hidden_states); block1_after_attention_hidden_states + mlp_output * layer1.layer_scale2", "residentBlock2Norm1Probe": "layer2.norm1(block1_after_mlp_hidden_states)", "residentBlock2Norm1OutputBoundary": "after two complete transformer blocks and block 2 norm1; before block 2 attention and final model LayerNorm", "residentBlock2AttentionProbe": "layer2.attention(block2_norm1_hidden_states); block1_after_mlp_hidden_states + attention_output * layer2.layer_scale1", "residentBlock2AttentionOutputBoundary": "after two complete transformer blocks and block 2 attention residual; before block 2 norm2 and final model LayerNorm", "finalNoAffineLayerNormApplied": False, "residentBlock1OutputBoundary": "after complete layer.0 and complete layer.1; before final model LayerNorm"},
        "outputs": outputs,
    }
    if args.mode == "resident-block2-mlp":
        output_manifest["computation"].update({
            "layerScale": "learned layer0/block1/block2 layer_scale1 and layer0/block1/block2 layer_scale2",
            "residentBlock2MlpProbe": "layer2.norm2(block2_after_attention_hidden_states); layer2.mlp(block2_norm2_hidden_states); block2_after_attention_hidden_states + mlp_output * layer2.layer_scale2",
            "residentBlock2MlpOutputBoundary": "after three complete transformer blocks and block 2 MLP residual; before final model LayerNorm",
            "residentBlock2CompleteTransformerBlockCount": 3,
        })
    if args.mode == "full-conditioning":
        output_manifest["computation"].update({
            "completeTransformerBlockCount": len(model.layers),
            "finalNoAffineLayerNormApplied": True,
            "conditioningOutput": "conditioning_features",
            "conditioningShape": [1, 1029, 1024],
            "conditioningDtype": "float32",
            "outputBoundary": "after all 24 transformer blocks and final no-affine LayerNorm",
            "layerWeightTensorCount": len(layer_weight_tensors(model)),
            "layerScale": "learned layer_scale1 and layer_scale2 for every checkpointed transformer block",
        })
    report_path = out_dir / "reference-manifest.json"
    report_path.write_text(json.dumps(output_manifest, indent=2) + "\n")
    return output_manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--source-image", required=True)
    parser.add_argument("--trellis-root", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--mode", choices=SUPPORTED_MODES, default="block0-parity")
    args = parser.parse_args()
    report_path = Path(args.out_dir).resolve() / "reference-manifest.json"
    try:
        result = execute(args)
        print(json.dumps({"ok": True, "manifest": str(report_path), "reference": result["reference"], "preprocessing": result["preprocessing"], "computation": result["computation"]}, indent=2))
        return 0
    except Exception as error:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        failure = {"schema": SCHEMA, "ok": False, "mode": args.mode, "failure_phase": "mlx-reference-export", "error": str(error), "traceback": traceback.format_exc(), "modelDir": str(Path(args.model_dir).resolve()), "sourceImage": str(Path(args.source_image).resolve()), "trellisRoot": str(Path(args.trellis_root).resolve())}
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps({"ok": False, "manifest": str(report_path), "error": str(error)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
