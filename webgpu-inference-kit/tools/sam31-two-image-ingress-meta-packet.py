#!/usr/bin/env python3
import argparse
import hashlib
import importlib
import json
import subprocess
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F


SCHEMA = "kaminos.sam31-two-image-ingress-meta-packet.v0"
RECEIPT_SCHEMA = "kaminos.sam31-two-image-ingress-meta-reference-receipt.v0"
BOUNDARY = "sam31-two-distinct-raw-images-to-interactive-propagation-backbone-features"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
DEFAULT_SOURCE_ROOT = Path.home() / "dev/sam3"
ROUTE_IDS = [
    "sam3.image-preprocess.phase-program.webgpu-local.v0",
    "sam3.image-patch-embed.phase-program.webgpu-local.v0",
    "sam3.image-vit-prefix.phase-program.webgpu-local.v0",
    "sam3.image-vit-block-stack.phase-program.webgpu-local.v0",
    "sam3.1.interactive-neck.phase-program.webgpu-local.v0",
    "sam3.1.image-propagation-neck.phase-program.webgpu-local.v0",
    "sam3.1.decoder-high-resolution-projection.phase-program.webgpu-local.v0",
]
FAILURE_PHASE = "argument-resolution"


def parse_args():
    parser = argparse.ArgumentParser(description="Export pinned Meta SAM3.1 two-image backbone, tri-neck, and decoder high-resolution reference tensors.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--source-root", default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--frame-0", default=str(DEFAULT_SOURCE_ROOT / "assets/videos/0001/0.jpg"))
    parser.add_argument("--frame-1", default=str(DEFAULT_SOURCE_ROOT / "assets/videos/0001/1.jpg"))
    parser.add_argument("--resolution", type=int, default=28)
    parser.add_argument("--diagnostic-vit-layers", default="")
    parser.add_argument("--diagnostic-vit-phase-layer", type=int)
    return parser.parse_args()


def parse_diagnostic_vit_layers(value: str) -> list[int]:
    if not value.strip():
        return []
    layers = []
    for token in value.split(","):
        token = token.strip()
        if not token:
            raise ValueError("diagnostic ViT layer list contains an empty entry")
        layer_index = int(token)
        if layer_index < 0 or layer_index >= 32:
            raise ValueError(f"diagnostic ViT layer {layer_index} is outside the executed range 0..31")
        if layer_index in layers:
            raise ValueError(f"diagnostic ViT layer {layer_index} is duplicated")
        layers.append(layer_index)
    return layers


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def write_array(path: Path, value, dtype=np.float32) -> dict:
    if isinstance(value, torch.Tensor):
        value = value.detach().cpu().float().numpy()
    array = np.ascontiguousarray(value, dtype=dtype)
    data = array.tobytes(order="C")
    path.write_bytes(data)
    return {
        "file": path.name,
        "sha256": sha256_bytes(data),
        "byteLength": len(data),
        "dtype": "uint8" if array.dtype == np.uint8 else "float32",
        "shape": list(array.shape),
    }


def source_revision(source_root: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()


def require_clean_source_tree(source_root: Path) -> None:
    paths = [
        "sam3/model/vitdet.py",
        "sam3/model/necks.py",
        "sam3/model/position_encoding.py",
        "sam3/model/multiplex_mask_decoder.py",
        "sam3/sam/transformer.py",
    ]
    status = subprocess.run(["git", "status", "--porcelain", "--", *paths], cwd=source_root, text=True, capture_output=True, check=True).stdout.strip()
    if status:
        raise RuntimeError(f"source working tree is dirty under load-bearing image ingress paths: {status}")


def install_source_packages(source_root: Path):
    sam3_root = source_root / "sam3"
    for name, path in (("sam3", sam3_root), ("sam3.model", sam3_root / "model"), ("sam3.sam", sam3_root / "sam")):
        package = types.ModuleType(name)
        package.__path__ = [str(path)]
        sys.modules[name] = package
    vitdet = importlib.import_module("sam3.model.vitdet")
    necks = importlib.import_module("sam3.model.necks")
    position = importlib.import_module("sam3.model.position_encoding")
    transformer = importlib.import_module("sam3.sam.transformer")
    decoder = importlib.import_module("sam3.model.multiplex_mask_decoder")
    return vitdet, necks, position, transformer, decoder


def build_trunk(vitdet, state: dict, resolution: int):
    # Meta's fused helper always casts the first MLP projection to BF16 and then
    # fails on CPU at the following FP32 projection. Preserve its mathematical
    # operation while keeping this reference packet CPU-runnable.
    vitdet.addmm_act = lambda activation, linear, value: F.gelu(linear(value), approximate="none")
    trunk = vitdet.ViT(
        img_size=resolution,
        pretrain_img_size=336,
        patch_size=14,
        embed_dim=1024,
        depth=32,
        num_heads=16,
        mlp_ratio=4.625,
        norm_layer="LayerNorm",
        drop_path_rate=0.1,
        qkv_bias=True,
        use_abs_pos=True,
        tile_abs_pos=True,
        global_att_blocks=(7, 15, 23, 31),
        rel_pos_blocks=(),
        use_rope=True,
        use_interp_rope=True,
        window_size=24,
        pretrain_use_cls_token=True,
        retain_cls_token=False,
        ln_pre=True,
        ln_post=False,
        return_interm_layers=False,
        bias_patch_embed=False,
        compile_mode=None,
        use_fa3=False,
        use_rope_real=False,
    )
    prefix = "detector.backbone.vision_backbone.trunk."
    trunk_state = {key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix) and not key.endswith("attn.freqs_cis")}
    incompatible = trunk.load_state_dict(trunk_state, strict=False)
    if incompatible.unexpected_keys or len(incompatible.missing_keys) != 32 or not all(key.endswith("attn.freqs_cis") for key in incompatible.missing_keys):
        raise RuntimeError(f"unexpected reduced-geometry trunk load result: {incompatible}")
    trunk.eval()
    return trunk, incompatible.missing_keys


def build_neck(necks, position, trunk, state: dict):
    position_encoding = position.PositionEmbeddingSine(num_pos_feats=256, temperature=10000, normalize=True, scale=None, precompute_resolution=None)
    neck = necks.Sam3TriViTDetNeck(trunk=trunk, position_encoding=position_encoding, d_model=256, scale_factors=(4.0, 2.0, 1.0))
    for branch in ("interactive", "propagation"):
        prefix = f"detector.backbone.vision_backbone.{branch}_convs."
        branch_state = {key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix)}
        getattr(neck, f"{branch}_convs").load_state_dict(branch_state, strict=True)
    neck.eval()
    return neck


def build_decoder(transformer_module, decoder_module, state: dict):
    transformer = transformer_module.TwoWayTransformer(depth=2, embedding_dim=256, mlp_dim=2048, num_heads=8, attention_downsample_rate=2)
    decoder = decoder_module.MultiplexMaskDecoder(
        transformer_dim=256,
        transformer=transformer,
        multiplex_count=16,
        num_multimask_outputs=3,
        use_high_res_features=True,
        pred_obj_scores=True,
        pred_obj_scores_mlp=True,
        use_multimask_token_for_obj_ptr=True,
        decode_mask_with_shared_tokens=False,
        decode_mask_attribute_with_shared_tokens=False,
        multimask_outputs_only=True,
    )
    prefix = "tracker.model.sam_mask_decoder."
    decoder.load_state_dict({key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix)}, strict=True)
    decoder.eval()
    return decoder


def add_tensor(entries: list, out_dir: Path, role: str, value, layout: str, dtype=np.float32):
    written = write_array(out_dir / f"{role}.{'u8' if dtype == np.uint8 else 'f32'}.bin", value, dtype=dtype)
    entries.append({"role": role, "layout": layout, **written})


def transform_weight(value: torch.Tensor, transform: str) -> np.ndarray:
    array = value.detach().cpu().float().numpy()
    if transform == "conv":
        return np.ascontiguousarray(array.transpose(0, 2, 3, 1))
    if transform == "conv-transpose":
        return np.ascontiguousarray(array.transpose(1, 2, 3, 0))
    if transform == "identity":
        return np.ascontiguousarray(array)
    raise ValueError(f"unsupported weight transform {transform}")


def add_weight(entries: list, out_dir: Path, state: dict, role: str, official_key: str, transform="identity", layout="out,in", slice_index=None):
    if official_key not in state:
        raise KeyError(f"official checkpoint is missing {official_key}")
    value = state[official_key]
    if slice_index is not None:
        value = value.reshape(3, value.shape[0] // 3, *value.shape[1:])[slice_index]
    array = transform_weight(value, transform)
    written = write_array(out_dir / f"{role}.f32.bin", array)
    entries.append({"role": role, "officialKey": official_key, "transform": transform, "layout": layout, **written})


def export_trunk_weights(entries: list, out_dir: Path, state: dict):
    prefix = "detector.backbone.vision_backbone.trunk"
    add_weight(entries, out_dir, state, "patch-embed-projection-weight", f"{prefix}.patch_embed.proj.weight", "conv", "out,kH,kW,in")
    add_weight(entries, out_dir, state, "vit-position-embeddings", f"{prefix}.pos_embed", "identity", "1,N,C")
    add_weight(entries, out_dir, state, "vit-backbone-layernorm-weight", f"{prefix}.ln_pre.weight", "identity", "channels")
    add_weight(entries, out_dir, state, "vit-backbone-layernorm-bias", f"{prefix}.ln_pre.bias", "identity", "channels")
    for layer in range(32):
        base = f"{prefix}.blocks.{layer}"
        role = f"vit-block-stack-layer{layer}"
        add_weight(entries, out_dir, state, f"{role}-layernorm1-weight", f"{base}.norm1.weight", layout="channels")
        add_weight(entries, out_dir, state, f"{role}-layernorm1-bias", f"{base}.norm1.bias", layout="channels")
        for index, name in enumerate(("q", "k", "v")):
            add_weight(entries, out_dir, state, f"{role}-{name}-proj-weight", f"{base}.attn.qkv.weight", layout="out,in", slice_index=index)
            add_weight(entries, out_dir, state, f"{role}-{name}-proj-bias", f"{base}.attn.qkv.bias", layout="out", slice_index=index)
        add_weight(entries, out_dir, state, f"{role}-o-proj-weight", f"{base}.attn.proj.weight", layout="out,in")
        add_weight(entries, out_dir, state, f"{role}-o-proj-bias", f"{base}.attn.proj.bias", layout="out")
        add_weight(entries, out_dir, state, f"{role}-layernorm2-weight", f"{base}.norm2.weight", layout="channels")
        add_weight(entries, out_dir, state, f"{role}-layernorm2-bias", f"{base}.norm2.bias", layout="channels")
        add_weight(entries, out_dir, state, f"{role}-mlp-fc1-weight", f"{base}.mlp.fc1.weight", layout="out,in")
        add_weight(entries, out_dir, state, f"{role}-mlp-fc1-bias", f"{base}.mlp.fc1.bias", layout="out")
        add_weight(entries, out_dir, state, f"{role}-mlp-fc2-weight", f"{base}.mlp.fc2.weight", layout="out,in")
        add_weight(entries, out_dir, state, f"{role}-mlp-fc2-bias", f"{base}.mlp.fc2.bias", layout="out")


def export_neck_weights(entries: list, out_dir: Path, state: dict, branch: str):
    prefix = f"detector.backbone.vision_backbone.{branch}_convs"
    scales = {
        0: [("scale-0", "dconv_2x2_0"), ("scale-1", "dconv_2x2_1")],
        1: [("scale-0", "dconv_2x2")],
        2: [],
    }
    for level in range(3):
        for role_suffix, source_suffix in scales[level]:
            add_weight(entries, out_dir, state, f"{branch}-level-{level}-{role_suffix}-weight", f"{prefix}.{level}.{source_suffix}.weight", "conv-transpose", "out,kH,kW,in")
            add_weight(entries, out_dir, state, f"{branch}-level-{level}-{role_suffix}-bias", f"{prefix}.{level}.{source_suffix}.bias", layout="out")
        for projection, source_name in (("proj1", "conv_1x1"), ("proj2", "conv_3x3")):
            add_weight(entries, out_dir, state, f"{branch}-level-{level}-{projection}-weight", f"{prefix}.{level}.{source_name}.weight", "conv", "out,kH,kW,in")
            add_weight(entries, out_dir, state, f"{branch}-level-{level}-{projection}-bias", f"{prefix}.{level}.{source_name}.bias", layout="out")


def export_projection_weights(entries: list, out_dir: Path, state: dict):
    prefix = "tracker.model.sam_mask_decoder"
    for name in ("s0", "s1"):
        add_weight(entries, out_dir, state, f"decoder-high-resolution-{name}-weight", f"{prefix}.conv_{name}.weight", "identity", "out,in,1,1")
        add_weight(entries, out_dir, state, f"decoder-high-resolution-{name}-bias", f"{prefix}.conv_{name}.bias", layout="out")


def invalidate_primary_outputs(out_dir: Path):
    (out_dir / "tensor-manifest.json").unlink(missing_ok=True)
    for path in out_dir.glob("*.bin"):
        path.unlink()


def write_failure_receipt(args, error: Exception):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)
    receipt = {
        "ok": False,
        "schema": RECEIPT_SCHEMA,
        "boundary": BOUNDARY,
        "failurePhase": FAILURE_PHASE,
        "error": f"{type(error).__name__}: {error}",
        "requested": {
            "checkpoint": str(Path(args.checkpoint).resolve()),
            "sourceRoot": str(Path(args.source_root).resolve()),
            "frames": [str(Path(args.frame_0).resolve()), str(Path(args.frame_1).resolve())],
            "resolution": args.resolution,
            "diagnosticVitLayers": args.diagnostic_vit_layers,
            "diagnosticVitPhaseLayer": args.diagnostic_vit_phase_layer,
        },
        "expected": {"modelRevision": HF_REVISION, "checkpointSha256": CHECKPOINT_SHA256, "sourceCommit": SOURCE_COMMIT},
        "primaryOutputWritten": False,
        "lastTrustworthyEvidence": "No primary two-image ingress packet was published.",
    }
    (out_dir / "reference-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")


def main():
    global FAILURE_PHASE
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    checkpoint = Path(args.checkpoint).resolve()
    source_root = Path(args.source_root).resolve()
    frame_paths = [Path(args.frame_0).resolve(), Path(args.frame_1).resolve()]
    diagnostic_vit_layers = parse_diagnostic_vit_layers(args.diagnostic_vit_layers)
    diagnostic_vit_phase_layer = args.diagnostic_vit_phase_layer
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)

    FAILURE_PHASE = "identity-validation"
    if args.resolution <= 0 or args.resolution % 14:
        raise ValueError("resolution must be a positive multiple of the SAM3.1 patch size 14")
    if diagnostic_vit_phase_layer is not None and diagnostic_vit_phase_layer not in diagnostic_vit_layers:
        raise ValueError("diagnostic ViT phase layer must also appear in --diagnostic-vit-layers")
    if not checkpoint.is_file():
        raise FileNotFoundError(f"official checkpoint not found: {checkpoint}")
    for frame in frame_paths:
        if not frame.is_file():
            raise FileNotFoundError(f"source frame not found: {frame}")
    checkpoint_sha = sha256_file(checkpoint)
    if checkpoint_sha != CHECKPOINT_SHA256:
        raise ValueError(f"checkpoint digest mismatch: expected {CHECKPOINT_SHA256}, got {checkpoint_sha}")
    commit = source_revision(source_root)
    if commit != SOURCE_COMMIT:
        raise ValueError(f"source commit mismatch: expected {SOURCE_COMMIT}, got {commit}")
    require_clean_source_tree(source_root)

    FAILURE_PHASE = "source-import"
    vitdet, necks, position, transformer_module, decoder_module = install_source_packages(source_root)
    FAILURE_PHASE = "checkpoint-load"
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if not isinstance(state, dict):
        raise TypeError("official checkpoint must be a flat state dictionary")
    trunk, generated_rope_keys = build_trunk(vitdet, state, args.resolution)
    neck = build_neck(necks, position, trunk, state)
    decoder = build_decoder(transformer_module, decoder_module, state)

    FAILURE_PHASE = "source-image-decode"
    source_images = []
    frame_tensors = []
    for frame_index, frame_path in enumerate(frame_paths):
        image = Image.open(frame_path).convert("RGB").resize((args.resolution, args.resolution))
        source_file = out_dir / f"frame-{frame_index}-source.png"
        image.save(source_file)
        rgb = np.asarray(image, dtype=np.uint8)
        rgba = np.concatenate([rgb, np.full((*rgb.shape[:2], 1), 255, dtype=np.uint8)], axis=2)
        pixel_values = rgb.astype(np.float32) / 127.5 - 1.0
        frame_tensors.append({
            "rgba": rgba,
            "pixel_values": pixel_values,
            "torch": torch.from_numpy(pixel_values).permute(2, 0, 1).unsqueeze(0).contiguous(),
        })
        source_images.append({
            "frameIndex": frame_index,
            "originalPath": str(frame_path),
            "originalSha256": sha256_file(frame_path),
            "resizedFile": source_file.name,
            "resizedSha256": sha256_file(source_file),
            "rgbaSha256": sha256_bytes(rgba.tobytes(order="C")),
            "resolution": [args.resolution, args.resolution],
            "resize": "Pillow RGB.resize default (Resampling.BICUBIC in Pillow 12.2.0)",
        })
    if source_images[0]["originalSha256"] == source_images[1]["originalSha256"] or source_images[0]["rgbaSha256"] == source_images[1]["rgbaSha256"]:
        raise RuntimeError("two-image fixture collapsed to identical source content")

    captures = {}
    def capture_vit_layer(layer_index):
        return lambda _module, _inputs, output: captures.__setitem__(f"vit-layer-{layer_index}", output.detach().clone())

    hooks = [
        trunk.patch_embed.register_forward_hook(lambda _module, _inputs, output: captures.__setitem__("patch", output.detach().clone())),
        trunk.ln_pre.register_forward_hook(lambda _module, _inputs, output: captures.__setitem__("prefix", output.detach().clone())),
        trunk.register_forward_hook(lambda _module, _inputs, output: captures.__setitem__("backbone", output[-1].detach().clone())),
    ]
    for layer_index in diagnostic_vit_layers:
        hooks.append(trunk.blocks[layer_index].register_forward_hook(capture_vit_layer(layer_index)))
    if diagnostic_vit_phase_layer is not None:
        block = trunk.blocks[diagnostic_vit_phase_layer]
        def capture_vit_phase(phase):
            return lambda _module, _inputs, output: captures.__setitem__(f"vit-phase-{phase}", output.detach().clone())
        def diagnostic_addmm_act(_activation, linear, value):
            output = F.gelu(linear(value), approximate="none")
            if linear is block.mlp.fc1:
                captures.__setitem__("vit-phase-mlpFc1", output.detach().clone())
            return output
        vitdet.addmm_act = diagnostic_addmm_act
        hooks.extend([
            block.norm1.register_forward_hook(capture_vit_phase("layerNorm1")),
            block.attn.proj.register_forward_hook(capture_vit_phase("outputProjection")),
            block.norm2.register_forward_hook(capture_vit_phase("layerNorm2")),
            block.mlp.fc2.register_forward_hook(capture_vit_phase("mlpFc2")),
        ])
    outputs = []
    FAILURE_PHASE = "official-two-image-execution"
    torch.set_num_threads(min(8, max(1, torch.get_num_threads())))
    with torch.inference_mode():
        for frame_index, frame in enumerate(frame_tensors):
            captures.clear()
            result = neck(
                frame["torch"],
                need_sam3_out=False,
                need_interactive_out=frame_index == 0,
                need_propagation_out=True,
            )
            _, _, interactive, interactive_pos, propagation, propagation_pos = result
            outputs.append({
                "patch": captures["patch"],
                "prefix": captures["prefix"],
                "backbone": captures["backbone"],
                "diagnostic_layers": {layer_index: captures[f"vit-layer-{layer_index}"] for layer_index in diagnostic_vit_layers},
                "diagnostic_phases": {phase: captures[f"vit-phase-{phase}"] for phase in ("layerNorm1", "outputProjection", "layerNorm2", "mlpFc1", "mlpFc2")} if diagnostic_vit_phase_layer is not None else {},
                "interactive": [item.tensors for item in interactive],
                "interactive_pos": interactive_pos,
                "propagation": [item.tensors for item in propagation],
                "propagation_pos": propagation_pos,
            })
        outputs[0]["interactive_high_s0"] = decoder.conv_s0(outputs[0]["interactive"][0])
        outputs[0]["interactive_high_s1"] = decoder.conv_s1(outputs[0]["interactive"][1])
        outputs[1]["high_s0"] = decoder.conv_s0(outputs[1]["propagation"][0])
        outputs[1]["high_s1"] = decoder.conv_s1(outputs[1]["propagation"][1])
    for hook in hooks:
        hook.remove()

    FAILURE_PHASE = "artifact-write"
    tensors = []
    for frame_index, frame in enumerate(frame_tensors):
        output = outputs[frame_index]
        add_tensor(tensors, out_dir, f"frame-{frame_index}-rgba", frame["rgba"], "H,W,RGBA", dtype=np.uint8)
        add_tensor(tensors, out_dir, f"frame-{frame_index}-pixel-values", frame["pixel_values"], "H,W,C")
        add_tensor(tensors, out_dir, f"frame-{frame_index}-patch-embeddings", output["patch"].reshape(1, -1, 1024), "B,N,C")
        add_tensor(tensors, out_dir, f"frame-{frame_index}-vit-prefix-hidden-states", output["prefix"], "B,H,W,C")
        add_tensor(tensors, out_dir, f"frame-{frame_index}-vit-backbone-hidden-states", output["backbone"].permute(0, 2, 3, 1), "B,H,W,C")
        for layer_index in diagnostic_vit_layers:
            add_tensor(tensors, out_dir, f"frame-{frame_index}-vit-layer-{layer_index}-hidden-states", output["diagnostic_layers"][layer_index], "B,H,W,C")
        for phase, value in output["diagnostic_phases"].items():
            add_tensor(tensors, out_dir, f"frame-{frame_index}-vit-layer-{diagnostic_vit_phase_layer}-phase-{phase}", value, "B,H,W,C")
        if frame_index == 0:
            for level, value in enumerate(output["interactive"]):
                add_tensor(tensors, out_dir, f"frame-0-interactive-feature-{level}", value.permute(0, 2, 3, 1), "B,H,W,C")
            add_tensor(tensors, out_dir, "frame-0-interactive-position-2", output["interactive_pos"][2].permute(0, 2, 3, 1), "B,H,W,C")
            add_tensor(tensors, out_dir, "frame-0-interactive-high-resolution-s0", output["interactive_high_s0"], "B,C,H,W")
            add_tensor(tensors, out_dir, "frame-0-interactive-high-resolution-s1", output["interactive_high_s1"], "B,C,H,W")
        for level, value in enumerate(output["propagation"]):
            add_tensor(tensors, out_dir, f"frame-{frame_index}-propagation-feature-{level}", value.permute(0, 2, 3, 1), "B,H,W,C")
        add_tensor(tensors, out_dir, f"frame-{frame_index}-propagation-position-2", output["propagation_pos"][2].permute(0, 2, 3, 1), "B,H,W,C")
    add_tensor(tensors, out_dir, "frame-1-high-resolution-s0", outputs[1]["high_s0"], "B,C,H,W")
    add_tensor(tensors, out_dir, "frame-1-high-resolution-s1", outputs[1]["high_s1"], "B,C,H,W")

    weights = []
    export_trunk_weights(weights, out_dir, state)
    export_neck_weights(weights, out_dir, state, "interactive")
    export_neck_weights(weights, out_dir, state, "propagation")
    export_projection_weights(weights, out_dir, state)
    if len(weights) != 556 or len({entry["role"] for entry in weights}) != 556:
        raise RuntimeError(f"browser weight role audit failed: {len(weights)} entries")

    patch_grid = args.resolution // 14
    shape = {
        "batch": 1,
        "imageHeight": args.resolution,
        "imageWidth": args.resolution,
        "imageChannels": 3,
        "patchSize": 14,
        "patchHeight": patch_grid,
        "patchWidth": patch_grid,
        "patchTokens": patch_grid * patch_grid,
        "visionHiddenSize": 1024,
        "visionHeads": 16,
        "visionHeadDim": 64,
        "visionMlpHidden": 4736,
        "visionWindowSize": 24,
        "fpnHiddenSize": 256,
        "fpnLevels": [
            {"level": 0, "scaleFactor": 4, "height": patch_grid * 4, "width": patch_grid * 4},
            {"level": 1, "scaleFactor": 2, "height": patch_grid * 2, "width": patch_grid * 2},
            {"level": 2, "scaleFactor": 1, "height": patch_grid, "width": patch_grid},
        ],
        "decoderHighResolutionS0Channels": 32,
        "decoderHighResolutionS1Channels": 64,
    }
    checkpoint_audit = {
        "officialStateTensorCount": len(state),
        "officialTrunkTensorCount": len([key for key in state if key.startswith("detector.backbone.vision_backbone.trunk.")]),
        "generatedRopeBufferCount": len(generated_rope_keys),
        "interactiveNeckTensorCount": len([key for key in state if key.startswith("detector.backbone.vision_backbone.interactive_convs.")]),
        "propagationNeckTensorCount": len([key for key in state if key.startswith("detector.backbone.vision_backbone.propagation_convs.")]),
        "highResolutionProjectionTensorCount": 4,
        "browserWeightRoleCount": len(weights),
        "allMappedOfficialKeysPresent": True,
        "allOfficialModuleLoadsAccepted": True,
    }
    manifest = {
        "schema": SCHEMA,
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": {
            "model": {"id": "facebook/sam3.1", "revision": HF_REVISION},
            "source": {"root": str(source_root), "commit": commit, "clean": True},
            "checkpoint": {"file": checkpoint.name, "path": str(checkpoint), "sha256": checkpoint_sha},
        },
        "sourceImages": source_images,
        "diagnosticVitLayers": diagnostic_vit_layers,
        "diagnosticVitPhaseLayer": diagnostic_vit_phase_layer,
        "shape": shape,
        "routeIds": ROUTE_IDS,
        "execution": {
            "officialCalls": [
                "ViT.forward(frame-0)",
                "Sam3TriViTDetNeck.forward(frame-0, need_interactive_out=True, need_propagation_out=True)",
                "MultiplexMaskDecoder.conv_s0(frame-0-interactive-level-0)",
                "MultiplexMaskDecoder.conv_s1(frame-0-interactive-level-1)",
                "ViT.forward(frame-1)",
                "Sam3TriViTDetNeck.forward(frame-1, need_interactive_out=False, need_propagation_out=True)",
                "MultiplexMaskDecoder.conv_s0(frame-1-propagation-level-0)",
                "MultiplexMaskDecoder.conv_s1(frame-1-propagation-level-1)",
            ],
            "cpuCompatibilitySubstitution": {
                "kind": "meta-fused-addmm-bfloat16-to-linear-exact-gelu",
                "sourceHelper": "sam3.perflib.fused.addmm_act",
                "replacement": "torch.nn.Linear then torch.nn.functional.gelu(approximate='none')",
                "semanticOperationPreserved": True,
                "reason": "Meta fused helper unconditionally emits BF16 before an FP32 CPU projection",
            },
        },
        "claims": {
            "twoDistinctSourceImages": True,
            "officialMetaViTExecuted": True,
            "officialMetaTriNeckExecuted": True,
            "officialMetaHighResolutionProjectionExecuted": True,
            "fullProductionResolutionExecuted": False,
            "packetOwnsImageEmbeddingsAtBrowserRuntime": False,
        },
        "checkpointAudit": checkpoint_audit,
        "tolerances": {
            "pixelValuesMaxAbsDiff": 0.000001,
            "patchEmbeddingsMaxAbsDiff": 0.0005,
            "vitPrefixMaxAbsDiff": 0.006,
            "vitBackboneMaxAbsDiff": 0.02,
            "neckMaxAbsDiff": 0.02,
            "positionMaxAbsDiff": 0.00001,
            "highResolutionMaxAbsDiff": 0.02,
        },
        "tensors": tensors,
        "weights": weights,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
    manifest_path.write_bytes(manifest_bytes)
    receipt = {
        "ok": True,
        "schema": RECEIPT_SCHEMA,
        "boundary": BOUNDARY,
        "reference": manifest["reference"],
        "shape": shape,
        "routeIds": ROUTE_IDS,
        "checkpointAudit": checkpoint_audit,
        "diagnosticVitLayers": diagnostic_vit_layers,
        "diagnosticVitPhaseLayer": diagnostic_vit_phase_layer,
        "primaryOutputWritten": True,
        "outputs": {
            "tensorManifest": str(manifest_path),
            "tensorManifestSha256": sha256_bytes(manifest_bytes),
            "referenceReceipt": str(receipt_path),
        },
    }
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    FAILURE_PHASE = "complete"
    print(json.dumps({"ok": True, "manifest": str(manifest_path), "receipt": str(receipt_path), "tensorCount": len(tensors), "weightCount": len(weights)}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        write_failure_receipt(parse_args(), error)
        raise
