#!/usr/bin/env python3
import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from safetensors import safe_open


PROPAGATION_ROUTE_ID = "sam3.1.propagation-neck.phase-program.webgpu-local.v0"
MEMORY_ROUTE_ID = "sam3.1.memory-encoder.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam31-propagation-memory-meta-packet.v0"
BOUNDARY = "sam31-official-tri-neck-to-multiplex-memory-encoder"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
DEFAULT_CONVERTED = Path.home() / ".cache/huggingface/hub/models--mlx-community--sam3.1-bf16/snapshots/a992e302ea9b0f03f41dfd93414a4fd0e818f65b/model.safetensors"


def parse_args():
    parser = argparse.ArgumentParser(description="Export an official Meta SAM3.1 propagation-neck to multiplex-memory reference packet.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--converted-weights", default=str(DEFAULT_CONVERTED))
    parser.add_argument("--source-root", default=str(Path.home() / "dev/sam3"))
    parser.add_argument("--seed", type=int, default=3101)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def write_array(path: Path, array: np.ndarray) -> dict:
    contiguous = np.ascontiguousarray(array)
    data = contiguous.tobytes(order="C")
    path.write_bytes(data)
    return {
        "file": path.name,
        "sha256": sha256_bytes(data),
        "byteLength": len(data),
        "shape": list(contiguous.shape),
    }


def source_revision(source_root: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()


def transform_tensor(tensor: torch.Tensor, transform: str) -> np.ndarray:
    array = tensor.detach().cpu().float().numpy()
    if transform == "conv":
        return np.ascontiguousarray(array.transpose(0, 2, 3, 1))
    if transform == "conv-transpose":
        return np.ascontiguousarray(array.transpose(1, 2, 3, 0))
    if transform == "depthwise":
        return np.ascontiguousarray(array.transpose(0, 2, 3, 1)[..., 0])
    if transform == "identity":
        return np.ascontiguousarray(array)
    raise ValueError(f"unsupported transform {transform}")


def browser_weight_specs():
    propagation_prefix = "detector.backbone.vision_backbone.propagation_convs"
    converted_propagation_prefix = "detector_model.vision_encoder.neck.propagation_convs"
    specs = [
        ("propagation-level-0-scale-0-weight", f"{propagation_prefix}.0.dconv_2x2_0.weight", f"{converted_propagation_prefix}.0.scale_layers.0.weight", "conv-transpose", "out,kH,kW,in"),
        ("propagation-level-0-scale-0-bias", f"{propagation_prefix}.0.dconv_2x2_0.bias", f"{converted_propagation_prefix}.0.scale_layers.0.bias", "identity", "out"),
        ("propagation-level-0-scale-1-weight", f"{propagation_prefix}.0.dconv_2x2_1.weight", f"{converted_propagation_prefix}.0.scale_layers.2.weight", "conv-transpose", "out,kH,kW,in"),
        ("propagation-level-0-scale-1-bias", f"{propagation_prefix}.0.dconv_2x2_1.bias", f"{converted_propagation_prefix}.0.scale_layers.2.bias", "identity", "out"),
        ("propagation-level-1-scale-0-weight", f"{propagation_prefix}.1.dconv_2x2.weight", f"{converted_propagation_prefix}.1.scale_layers.0.weight", "conv-transpose", "out,kH,kW,in"),
        ("propagation-level-1-scale-0-bias", f"{propagation_prefix}.1.dconv_2x2.bias", f"{converted_propagation_prefix}.1.scale_layers.0.bias", "identity", "out"),
    ]
    for level in range(3):
        for projection, official_name, converted_name in (
            ("proj1", "conv_1x1", "proj1"),
            ("proj2", "conv_3x3", "proj2"),
        ):
            specs.extend([
                (f"propagation-level-{level}-{projection}-weight", f"{propagation_prefix}.{level}.{official_name}.weight", f"{converted_propagation_prefix}.{level}.{converted_name}.weight", "conv", "out,kH,kW,in"),
                (f"propagation-level-{level}-{projection}-bias", f"{propagation_prefix}.{level}.{official_name}.bias", f"{converted_propagation_prefix}.{level}.{converted_name}.bias", "identity", "out"),
            ])

    memory_prefix = "tracker.model.maskmem_backbone"
    converted_memory_prefix = "tracker_model.memory_encoder"
    encoder_conv_indices = [0, 3, 6, 9]
    encoder_norm_indices = [1, 4, 7, 10]
    for level, (conv_index, norm_index) in enumerate(zip(encoder_conv_indices, encoder_norm_indices)):
        specs.extend([
            (f"memory-downsample-{level}-conv-weight", f"{memory_prefix}.mask_downsampler.encoder.{conv_index}.weight", f"{converted_memory_prefix}.mask_downsampler.layers.{level}.conv.weight", "conv", "out,kH,kW,in"),
            (f"memory-downsample-{level}-conv-bias", f"{memory_prefix}.mask_downsampler.encoder.{conv_index}.bias", f"{converted_memory_prefix}.mask_downsampler.layers.{level}.conv.bias", "identity", "out"),
            (f"memory-downsample-{level}-norm-weight", f"{memory_prefix}.mask_downsampler.encoder.{norm_index}.weight", f"{converted_memory_prefix}.mask_downsampler.layers.{level}.layer_norm.weight", "identity", "channels"),
            (f"memory-downsample-{level}-norm-bias", f"{memory_prefix}.mask_downsampler.encoder.{norm_index}.bias", f"{converted_memory_prefix}.mask_downsampler.layers.{level}.layer_norm.bias", "identity", "channels"),
        ])
    specs.extend([
        ("memory-mask-final-weight", f"{memory_prefix}.mask_downsampler.encoder.12.weight", f"{converted_memory_prefix}.mask_downsampler.final_conv.weight", "conv", "out,kH,kW,in"),
        ("memory-mask-final-bias", f"{memory_prefix}.mask_downsampler.encoder.12.bias", f"{converted_memory_prefix}.mask_downsampler.final_conv.bias", "identity", "out"),
        ("memory-feature-projection-weight", f"{memory_prefix}.pix_feat_proj.weight", f"{converted_memory_prefix}.feature_projection.weight", "conv", "out,kH,kW,in"),
        ("memory-feature-projection-bias", f"{memory_prefix}.pix_feat_proj.bias", f"{converted_memory_prefix}.feature_projection.bias", "identity", "out"),
    ])
    for level in range(2):
        official = f"{memory_prefix}.fuser.layers.{level}"
        converted = f"{converted_memory_prefix}.memory_fuser.layers.{level}"
        specs.extend([
            (f"memory-fuser-{level}-depthwise-weight", f"{official}.dwconv.weight", f"{converted}.depthwise_conv.weight", "depthwise", "out,kH,kW"),
            (f"memory-fuser-{level}-depthwise-bias", f"{official}.dwconv.bias", f"{converted}.depthwise_conv.bias", "identity", "out"),
            (f"memory-fuser-{level}-norm-weight", f"{official}.norm.weight", f"{converted}.layer_norm.weight", "identity", "channels"),
            (f"memory-fuser-{level}-norm-bias", f"{official}.norm.bias", f"{converted}.layer_norm.bias", "identity", "channels"),
            (f"memory-fuser-{level}-pointwise-1-weight", f"{official}.pwconv1.weight", f"{converted}.pointwise_conv1.weight", "identity", "out,in"),
            (f"memory-fuser-{level}-pointwise-1-bias", f"{official}.pwconv1.bias", f"{converted}.pointwise_conv1.bias", "identity", "out"),
            (f"memory-fuser-{level}-pointwise-2-weight", f"{official}.pwconv2.weight", f"{converted}.pointwise_conv2.weight", "identity", "out,in"),
            (f"memory-fuser-{level}-pointwise-2-bias", f"{official}.pwconv2.bias", f"{converted}.pointwise_conv2.bias", "identity", "out"),
            (f"memory-fuser-{level}-scale", f"{official}.gamma", f"{converted}.scale", "identity", "channels"),
        ])
    return specs


def layer_norm_2d(value: torch.Tensor, weight: torch.Tensor, bias: torch.Tensor, epsilon: float = 1e-6) -> torch.Tensor:
    mean = value.mean(1, keepdim=True)
    variance = (value - mean).pow(2).mean(1, keepdim=True)
    return (value - mean) / torch.sqrt(variance + epsilon) * weight[:, None, None] + bias[:, None, None]


def position_embedding_sine(value: torch.Tensor, temperature: float = 10000.0) -> torch.Tensor:
    batch, channels, height, width = value.shape
    num_pos_feats = channels // 2
    scale = 2 * torch.pi
    y_embed = torch.arange(1, height + 1, dtype=torch.float32).view(1, height, 1).repeat(batch, 1, width)
    x_embed = torch.arange(1, width + 1, dtype=torch.float32).view(1, 1, width).repeat(batch, height, 1)
    y_embed = y_embed / (y_embed[:, -1:, :] + 1e-6) * scale
    x_embed = x_embed / (x_embed[:, :, -1:] + 1e-6) * scale
    dim_t = torch.arange(num_pos_feats, dtype=torch.float32)
    dim_t = temperature ** (2 * torch.div(dim_t, 2, rounding_mode="floor") / num_pos_feats)
    pos_x = x_embed[:, :, :, None] / dim_t
    pos_y = y_embed[:, :, :, None] / dim_t
    pos_x = torch.stack((pos_x[:, :, :, 0::2].sin(), pos_x[:, :, :, 1::2].cos()), dim=4).flatten(3)
    pos_y = torch.stack((pos_y[:, :, :, 0::2].sin(), pos_y[:, :, :, 1::2].cos()), dim=4).flatten(3)
    return torch.cat((pos_y, pos_x), dim=3).permute(0, 3, 1, 2)


def run_propagation_reference(state: dict, backbone: torch.Tensor):
    prefix = "detector.backbone.vision_backbone.propagation_convs"
    outputs = []
    for level in range(3):
        value = backbone
        if level == 0:
            value = F.conv_transpose2d(value, state[f"{prefix}.0.dconv_2x2_0.weight"], state[f"{prefix}.0.dconv_2x2_0.bias"], stride=2)
            value = F.gelu(value, approximate="none")
            value = F.conv_transpose2d(value, state[f"{prefix}.0.dconv_2x2_1.weight"], state[f"{prefix}.0.dconv_2x2_1.bias"], stride=2)
        elif level == 1:
            value = F.conv_transpose2d(value, state[f"{prefix}.1.dconv_2x2.weight"], state[f"{prefix}.1.dconv_2x2.bias"], stride=2)
        value = F.conv2d(value, state[f"{prefix}.{level}.conv_1x1.weight"], state[f"{prefix}.{level}.conv_1x1.bias"])
        value = F.conv2d(value, state[f"{prefix}.{level}.conv_3x3.weight"], state[f"{prefix}.{level}.conv_3x3.bias"], padding=1)
        outputs.append(value)
    return outputs


def run_memory_reference(state: dict, propagation_feature: torch.Tensor, mask_logits: torch.Tensor, conditioning: torch.Tensor):
    prefix = "tracker.model.maskmem_backbone"
    mask = torch.sigmoid(mask_logits) * 2.0 - 1.0
    condition_planes = conditioning[:, :, None, None].expand_as(mask)
    mask = torch.cat([mask, condition_planes], dim=1)
    mask = F.interpolate(mask.float(), size=(32, 32), align_corners=False, mode="bilinear", antialias=True)
    for conv_index, norm_index in zip([0, 3, 6, 9], [1, 4, 7, 10]):
        mask = F.conv2d(mask, state[f"{prefix}.mask_downsampler.encoder.{conv_index}.weight"], state[f"{prefix}.mask_downsampler.encoder.{conv_index}.bias"], stride=2, padding=1)
        mask = layer_norm_2d(mask, state[f"{prefix}.mask_downsampler.encoder.{norm_index}.weight"], state[f"{prefix}.mask_downsampler.encoder.{norm_index}.bias"])
        mask = F.gelu(mask, approximate="none")
    mask = F.conv2d(mask, state[f"{prefix}.mask_downsampler.encoder.12.weight"], state[f"{prefix}.mask_downsampler.encoder.12.bias"])
    feature = F.conv2d(propagation_feature, state[f"{prefix}.pix_feat_proj.weight"], state[f"{prefix}.pix_feat_proj.bias"])
    feature = feature + mask
    for level in range(2):
        layer = f"{prefix}.fuser.layers.{level}"
        residual = feature
        feature = F.conv2d(feature, state[f"{layer}.dwconv.weight"], state[f"{layer}.dwconv.bias"], padding=3, groups=256)
        feature = layer_norm_2d(feature, state[f"{layer}.norm.weight"], state[f"{layer}.norm.bias"])
        feature = feature.permute(0, 2, 3, 1)
        feature = F.linear(feature, state[f"{layer}.pwconv1.weight"], state[f"{layer}.pwconv1.bias"])
        feature = F.gelu(feature, approximate="none")
        feature = F.linear(feature, state[f"{layer}.pwconv2.weight"], state[f"{layer}.pwconv2.bias"])
        feature = feature * state[f"{layer}.gamma"]
        feature = feature.permute(0, 3, 1, 2)
        feature = residual + feature
    return feature, position_embedding_sine(feature)


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = Path(args.checkpoint).resolve()
    converted_path = Path(args.converted_weights).resolve()
    source_root = Path(args.source_root).resolve()
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"official checkpoint not found: {checkpoint_path}")
    if not converted_path.is_file():
        raise FileNotFoundError(f"converted checkpoint not found: {converted_path}")
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if not isinstance(state, dict):
        raise TypeError("official checkpoint must be a state dictionary")

    specs = browser_weight_specs()
    weight_entries = []
    converted_matches = 0
    converted_max_abs_diff = 0.0
    with safe_open(converted_path, framework="pt", device="cpu") as converted:
        converted_keys = set(converted.keys())
        for role, official_key, converted_key, transform, layout in specs:
            if official_key not in state:
                raise KeyError(f"official checkpoint is missing {official_key}")
            if converted_key not in converted_keys:
                raise KeyError(f"converted checkpoint is missing {converted_key}")
            browser_array = transform_tensor(state[official_key], transform)
            converted_array = converted.get_tensor(converted_key).float().numpy()
            if transform == "depthwise":
                converted_array = converted_array[..., 0]
            if browser_array.shape != converted_array.shape:
                raise ValueError(f"converted shape mismatch for {role}: {browser_array.shape} != {converted_array.shape}")
            max_abs_diff = float(np.max(np.abs(browser_array - converted_array))) if browser_array.size else 0.0
            converted_max_abs_diff = max(converted_max_abs_diff, max_abs_diff)
            if not np.array_equal(browser_array, converted_array):
                raise ValueError(f"converted value mismatch for {role}: max abs diff {max_abs_diff}")
            converted_matches += 1
            file_name = f"{role}.f32.bin"
            written = write_array(out_dir / file_name, browser_array.astype(np.float32, copy=False))
            weight_entries.append({
                "role": role,
                "file": file_name,
                "sha256": written["sha256"],
                "byteLength": written["byteLength"],
                "dtype": "float32",
                "shape": written["shape"],
                "layout": layout,
                "officialKey": official_key,
                "convertedKey": converted_key,
                "transform": transform,
            })

    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    backbone = torch.randn((1, 1024, 2, 2), generator=generator, dtype=torch.float32) * 0.05
    mask_logits = torch.randn((1, 16, 8, 8), generator=generator, dtype=torch.float32)
    conditioning = torch.tensor([[1.0 if index % 3 == 0 else 0.0 for index in range(16)]], dtype=torch.float32)
    with torch.inference_mode():
        propagation = run_propagation_reference(state, backbone)
        memory_features, memory_position = run_memory_reference(state, propagation[2], mask_logits, conditioning)

    tensor_specs = [
        ("vit-backbone-hidden-states", "vit-backbone-hidden-states.f32.bin", backbone.permute(0, 2, 3, 1), "B,H,W,C"),
        ("multiplex-mask-logits", "multiplex-mask-logits.f32.bin", mask_logits, "B,M,H,W"),
        ("multiplex-conditioning", "multiplex-conditioning.f32.bin", conditioning, "B,M"),
        ("expected-propagation-feature-0", "expected-propagation-feature-0.f32.bin", propagation[0].permute(0, 2, 3, 1), "B,H,W,C"),
        ("expected-propagation-feature-1", "expected-propagation-feature-1.f32.bin", propagation[1].permute(0, 2, 3, 1), "B,H,W,C"),
        ("expected-propagation-feature-2", "expected-propagation-feature-2.f32.bin", propagation[2].permute(0, 2, 3, 1), "B,H,W,C"),
        ("expected-memory-features", "expected-memory-features.f32.bin", memory_features.permute(0, 2, 3, 1), "B,H,W,C"),
        ("expected-memory-position-encoding", "expected-memory-position-encoding.f32.bin", memory_position.permute(0, 2, 3, 1), "B,H,W,C"),
    ]
    tensor_entries = []
    for role, file_name, tensor, layout in tensor_specs:
        array = tensor.detach().cpu().float().contiguous().numpy()
        written = write_array(out_dir / file_name, array)
        tensor_entries.append({
            "role": role,
            "file": file_name,
            "sha256": written["sha256"],
            "byteLength": written["byteLength"],
            "dtype": "float32",
            "shape": written["shape"],
            "layout": layout,
        })

    checkpoint_sha = sha256_file(checkpoint_path)
    converted_sha = sha256_file(converted_path)
    source_commit = source_revision(source_root)
    shape = {
        "batch": 1,
        "backboneHeight": 2,
        "backboneWidth": 2,
        "backboneChannels": 1024,
        "fpnHiddenSize": 256,
        "levels": [
            {"level": 0, "scaleFactor": 4, "height": 8, "width": 8},
            {"level": 1, "scaleFactor": 2, "height": 4, "width": 4},
            {"level": 2, "scaleFactor": 1, "height": 2, "width": 2},
        ],
        "memory": {
            "featureHeight": 2,
            "featureWidth": 2,
            "featureChannels": 256,
            "maskHeight": 8,
            "maskWidth": 8,
            "resampledMaskHeight": 32,
            "resampledMaskWidth": 32,
            "multiplexCount": 16,
            "conditionChannels": True,
        },
    }
    reference = {
        "model": {"id": "facebook/sam3.1", "revision": HF_REVISION, "checkpointFile": checkpoint_path.name, "sha256": checkpoint_sha},
        "source": {"repository": "facebookresearch/sam3", "root": str(source_root), "commit": source_commit},
        "converted": {"model": "mlx-community/sam3.1-bf16", "weightsPath": str(converted_path), "sha256": converted_sha},
        "framework": {"name": "torch", "version": torch.__version__, "device": "cpu", "execution": "functional official-source boundary"},
    }
    manifest = {
        "schema": SCHEMA,
        "routeIds": [PROPAGATION_ROUTE_ID, MEMORY_ROUTE_ID],
        "mode": "official-meta-checkpoint-export",
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "fixture": {"seed": args.seed, "kind": "deterministic-composed-component", "sourceImage": False},
        "shape": shape,
        "config": {"sigmoidScale": 2.0, "sigmoidBias": -1.0, "positionTemperature": 10000.0, "conditioningForeground": 1.0, "conditioningBackground": 0.0},
        "claims": {
            "fullSam31BrowserExecution": False,
            "officialSourceExecutedStages": ["propagation-neck", "multiplex-mask-preprocess", "memory-mask-downsampler", "memory-feature-projection", "memory-fuser", "memory-position-encoding"],
            "browserTargetStages": ["propagation-neck", "memory-encoder"],
            "composition": "official propagation feature 2 is the memory encoder pixel-feature input",
        },
        "checkpointAudit": {
            "officialStateTensorCount": len(state),
            "mappedTensorCount": len(specs),
            "convertedValueMatches": converted_matches,
            "convertedMaxAbsDiff": converted_max_abs_diff,
            "allMappedOfficialKeysPresent": True,
            "allMappedConvertedKeysPresent": True,
        },
        "tolerances": {
            "propagationCpuOracleMaxAbsDiff": 0.00008,
            "memoryCpuOracleMaxAbsDiff": 0.00008,
            "positionCpuOracleMaxAbsDiff": 0.000002,
            "webGpuPropagationMaxAbsDiff": 0.0005,
            "webGpuMemoryMaxAbsDiff": 0.0008,
            "webGpuPositionMaxAbsDiff": 0.000002,
        },
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    receipt = {
        "ok": True,
        "schema": "kaminos.sam31-propagation-memory-meta-reference-receipt.v0",
        "routeIds": manifest["routeIds"],
        "mode": manifest["mode"],
        "boundary": BOUNDARY,
        "reference": reference,
        "checkpointAudit": manifest["checkpointAudit"],
        "shape": shape,
        "outputs": {"tensorManifest": str(manifest_path), "referenceReceipt": str(receipt_path)},
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
