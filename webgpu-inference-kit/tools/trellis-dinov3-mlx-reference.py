#!/usr/bin/env python3
"""Export a pinned f32 DINOv3 patch/prefix/block-0 reference packet.

Run with the trellis2mlx environment and its source checkout on PYTHONPATH.
The script intentionally stops before TRELLIS' final no-affine LayerNorm.
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

SCHEMA = "kaminos.trellis-dinov3-mlx-prefix-block-reference.v0"
MODEL_ID = "facebook/dinov3-vitl16-pretrain-lvd1689m"
REVISION = "ea8dc2863c51be0a264bab82070e3e8836b02d51"
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


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    return np.ascontiguousarray(np.asarray(mx.eval(value), dtype=np.float32))


def execute(args) -> dict:
    # Import MLX only inside the guarded execution so a missing runtime still
    # leaves the caller a durable failure manifest.
    import mlx.core as mx

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
    mx.eval(patch_embeddings, prefix_hidden_states, block0_hidden_states)

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = {}
    arrays = {
        "pixel_values": (pixels_np, "normalized-input-pixels"),
        "patch_embeddings": (np_f32(mx, patch_embeddings), "mlmodel-patch-embedding-output"),
        "prefix_hidden_states": (np_f32(mx, prefix_hidden_states), "mlmodel-dinov3-prefix-output"),
        "block0_hidden_states": (np_f32(mx, block0_hidden_states), "mlmodel-dinov3-block0-output"),
        "patch_projection": (np_f32(mx, model.patch_embed.weight), "checkpoint-patch-projection-out-kh-kw-in"),
        "patch_bias": (np_f32(mx, model.patch_embed.bias), "checkpoint-patch-projection-bias"),
        "class_token": (np_f32(mx, model.cls_token), "checkpoint-class-token"),
        "register_tokens": (np_f32(mx, model.register_tokens), "checkpoint-register-tokens"),
        "rope_cos": (np_f32(mx, cos), "dinov3-block0-2d-rope-cos-f32"),
        "rope_sin": (np_f32(mx, sin), "dinov3-block0-2d-rope-sin-f32"),
    }
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
    for name, (value, role) in arrays.items():
        if np.asarray(value).dtype != np.float32:
            raise ValueError(f"export tensor {name} is not f32: {np.asarray(value).dtype}")
        outputs[name] = record_array(out_dir, name, value, role)
    output_manifest = {
        "schema": SCHEMA, "ok": True,
        "reference": {"implementation": "trellmlx.models.dinov3.DINOv3ViT", "sourceRoot": str(trellis_root), "sourceRevision": trellis_revision, "sourceFile": str(dinov3_source), "sourceFileSha256": file_sha256(dinov3_source), "device": str(mx.default_device()), "mlxVersion": getattr(mx, "__version__", "unreported"), "loadedTensorCount": loaded_count},
        "model": {"id": MODEL_ID, "revision": REVISION, "files": files, "config": config, "dtype": "float32", "checkpointTensorDtypes": ["F32"]},
        "preprocessing": preprocessing,
        "computation": {"precision": "float32", "framework": "MLX", "prefixTokens": ["class", "register0", "register1", "register2", "register3"], "patchTokens": 1024, "patchGrid": [32, 32], "sequenceLength": 1029, "hiddenSize": 1024, "ropeTheta": config["rope_theta"], "layerNormEps": config["layer_norm_eps"], "attention": "global-scaled-dot-product", "ropeAppliedTo": "patch q/k tokens only", "layerScale": "learned layer0 layer_scale1/layer_scale2", "blockCount": 1, "finalNoAffineLayerNormApplied": False, "outputBoundary": "after complete layer.0, before final model LayerNorm"},
        "outputs": outputs,
    }
    report_path = out_dir / "reference-manifest.json"
    report_path.write_text(json.dumps(output_manifest, indent=2) + "\n")
    return output_manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--source-image", required=True)
    parser.add_argument("--trellis-root", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    report_path = Path(args.out_dir).resolve() / "reference-manifest.json"
    try:
        result = execute(args)
        print(json.dumps({"ok": True, "manifest": str(report_path), "reference": result["reference"], "preprocessing": result["preprocessing"], "computation": result["computation"]}, indent=2))
        return 0
    except Exception as error:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        failure = {"schema": SCHEMA, "ok": False, "failure_phase": "mlx-reference-export", "error": str(error), "traceback": traceback.format_exc(), "modelDir": str(Path(args.model_dir).resolve()), "sourceImage": str(Path(args.source_image).resolve()), "trellisRoot": str(Path(args.trellis_root).resolve())}
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps({"ok": False, "manifest": str(report_path), "error": str(error)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
