"""Package cached complete Pixal3D safetensors checkpoints and prepared image inputs. No MLX/PyTorch execution."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import numpy as np


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def decode_tensor(raw, dtype, shape):
    types = {"F32": "<f4", "F16": "<f2", "BF16": "<u2", "C64": "<c8"}
    if dtype not in types:
        raise ValueError("unsupported checkpoint precision " + str(dtype))
    expected_bytes = int(np.prod(shape)) * np.dtype(types[dtype]).itemsize
    if len(raw) != expected_bytes:
        raise ValueError("complete checkpoint tensor required")
    values = np.frombuffer(raw, dtype=types[dtype])
    if dtype == "BF16":
        values = (values.astype("<u4") << 16).view("<f4")
        return values.astype("<f4", copy=False).reshape(shape)
    if dtype == "C64":
        return values.view("<f4").reshape((*shape, 2)).astype("<f4", copy=False)
    return values.astype("<f4", copy=False).reshape(shape)


def compute_dinov3_rope(num_h=32, num_w=32, head_dim=64, rope_theta=100.0):
    inv_freq = 1.0 / (rope_theta ** np.arange(0, 1, 4 / head_dim, dtype=np.float32))
    coords_h = (np.arange(0.5, num_h) / num_h) * 2.0 - 1.0
    coords_w = (np.arange(0.5, num_w) / num_w) * 2.0 - 1.0
    grid_h, grid_w = np.meshgrid(coords_h, coords_w, indexing="ij")
    coords = np.stack([grid_h.ravel(), grid_w.ravel()], axis=-1)
    angles = 2.0 * math.pi * coords[:, :, None] * inv_freq[None, None, :]
    angles = angles.reshape(coords.shape[0], -1)
    angles = np.tile(angles, 2)
    return np.cos(angles).astype("<f4"), np.sin(angles).astype("<f4")


def build_bf16_gelu_table(gelu_npy_path=None):
    if gelu_npy_path is not None and Path(gelu_npy_path).is_file():
        table = np.load(gelu_npy_path, allow_pickle=False)
        if table.shape != (65536,) or table.dtype != np.uint16:
            raise ValueError("source BF16 GELU table shape/dtype changed")
        return (table.astype("<u4") << 16).view("<f4")
    u16 = np.arange(65536, dtype=np.uint16)
    x = (u16.astype("<u4") << 16).view("<f4")
    with np.errstate(all="ignore"):
        k0 = np.float32(math.sqrt(2.0 / math.pi))
        k1 = np.float32(0.044715)
        inner = k0 * (x + k1 * x * x * x)
        y = np.float32(0.5) * x * (np.float32(1.0) + np.tanh(inner))
        bf16_bits = (y.view("<u4") >> 16).astype("<u4") << 16
        out = bf16_bits.view("<f4")
    return out.astype("<f4", copy=False)


def build_f16_silu_table():
    u16 = np.arange(65536, dtype=np.uint16)
    x = u16.view("<f2").astype(np.float32)
    with np.errstate(all="ignore"):
        y = (x / (1.0 + np.exp(-x))).astype("<f2").astype("<f4")
    return y


def naf_weight_shapes(dim=256, heads_rope=4, img_layers=2):
    c = dim // 2
    head_dim_rope = dim // heads_rope
    shapes = {
        "image_encoder.encoder.0.weight": [c, 3, 1, 1],
        "image_encoder.encoder.0.bias": [c],
        "image_encoder.sem_encoder.0.weight": [c, 3, 3, 3],
        "image_encoder.sem_encoder.0.bias": [c],
        "image_encoder.rope.periods": [head_dim_rope // 4],
    }
    for i in range(1, img_layers + 1):
        for prefix, ks in [("image_encoder.encoder", 1), ("image_encoder.sem_encoder", 3)]:
            shapes[f"{prefix}.{i}.norm1.weight"] = [c]
            shapes[f"{prefix}.{i}.norm1.bias"] = [c]
            shapes[f"{prefix}.{i}.conv1.weight"] = [c, c, ks, ks]
            shapes[f"{prefix}.{i}.conv1.bias"] = [c]
            shapes[f"{prefix}.{i}.norm2.weight"] = [c]
            shapes[f"{prefix}.{i}.norm2.bias"] = [c]
            shapes[f"{prefix}.{i}.conv2.weight"] = [c, c, ks, ks]
            shapes[f"{prefix}.{i}.conv2.bias"] = [c]
    return shapes


PIXAL3D_FLOW_PREFIX_KEYS = {
    "input.weight": "input_layer.weight",
    "input.bias": "input_layer.bias",
    "time0.weight": "t_embedder.mlp.0.weight",
    "time0.bias": "t_embedder.mlp.0.bias",
    "time2.weight": "t_embedder.mlp.2.weight",
    "time2.bias": "t_embedder.mlp.2.bias",
    "mod.weight": "adaLN_modulation.1.weight",
    "mod.bias": "adaLN_modulation.1.bias",
}

PIXAL3D_FLOW_BLOCK_KEYS = {
    "modulation": "modulation",
    "norm2.weight": "norm2.weight",
    "norm2.bias": "norm2.bias",
    "self.qkv.weight": "self_attn.to_qkv.weight",
    "self.qkv.bias": "self_attn.to_qkv.bias",
    "self.out.weight": "self_attn.to_out.weight",
    "self.out.bias": "self_attn.to_out.bias",
    "self.q.gamma": "self_attn.q_rms_norm.gamma",
    "self.k.gamma": "self_attn.k_rms_norm.gamma",
    "cross.q.weight": "cross_attn.cross_attn_block.to_q.weight",
    "cross.q.bias": "cross_attn.cross_attn_block.to_q.bias",
    "cross.kv.weight": "cross_attn.cross_attn_block.to_kv.weight",
    "cross.kv.bias": "cross_attn.cross_attn_block.to_kv.bias",
    "cross.out.weight": "cross_attn.cross_attn_block.to_out.weight",
    "cross.out.bias": "cross_attn.cross_attn_block.to_out.bias",
    "cross.q.gamma": "cross_attn.cross_attn_block.q_rms_norm.gamma",
    "cross.k.gamma": "cross_attn.cross_attn_block.k_rms_norm.gamma",
    "cross.proj.weight": "cross_attn.proj_linear.weight",
    "cross.proj.bias": "cross_attn.proj_linear.bias",
    "mlp.in.weight": "mlp.mlp.0.weight",
    "mlp.in.bias": "mlp.mlp.0.bias",
    "mlp.out.weight": "mlp.mlp.2.weight",
    "mlp.out.bias": "mlp.mlp.2.bias",
}


def flow_checkpoint_specs(
    channels=1536,
    heads=12,
    context_channels=1024,
    proj_in_channels=1024,
    hidden=8192,
    frequency_dim=256,
    num_blocks=30,
    in_channels=8,
    out_channels=8,
):
    head_dim = channels // heads
    specs = [
        ("prefix.input.weight", "input_layer.weight", [channels, in_channels]),
        ("prefix.input.bias", "input_layer.bias", [channels]),
        ("prefix.time0.weight", "t_embedder.mlp.0.weight", [channels, frequency_dim]),
        ("prefix.time0.bias", "t_embedder.mlp.0.bias", [channels]),
        ("prefix.time2.weight", "t_embedder.mlp.2.weight", [channels, channels]),
        ("prefix.time2.bias", "t_embedder.mlp.2.bias", [channels]),
        ("prefix.mod.weight", "adaLN_modulation.1.weight", [6 * channels, channels]),
        ("prefix.mod.bias", "adaLN_modulation.1.bias", [6 * channels]),
        ("terminal.weight", "out_layer.weight", [out_channels, channels]),
        ("terminal.bias", "out_layer.bias", [out_channels]),
    ]
    block_shapes = {
        "modulation": [6 * channels],
        "norm2.weight": [channels],
        "norm2.bias": [channels],
        "self.qkv.weight": [3 * channels, channels],
        "self.qkv.bias": [3 * channels],
        "self.out.weight": [channels, channels],
        "self.out.bias": [channels],
        "self.q.gamma": [heads, head_dim],
        "self.k.gamma": [heads, head_dim],
        "cross.q.weight": [channels, channels],
        "cross.q.bias": [channels],
        "cross.kv.weight": [2 * channels, context_channels],
        "cross.kv.bias": [2 * channels],
        "cross.out.weight": [channels, channels],
        "cross.out.bias": [channels],
        "cross.q.gamma": [heads, head_dim],
        "cross.k.gamma": [heads, head_dim],
        "cross.proj.weight": [channels, proj_in_channels],
        "cross.proj.bias": [channels],
        "mlp.in.weight": [hidden, channels],
        "mlp.in.bias": [hidden],
        "mlp.out.weight": [channels, hidden],
        "mlp.out.bias": [channels],
    }
    for i in range(num_blocks):
        for k, ckpt_suffix in PIXAL3D_FLOW_BLOCK_KEYS.items():
            specs.append((f"block{i}.{k}", f"blocks.{i}.{ckpt_suffix}", block_shapes[k]))
    return specs


def occupancy_decoder_shapes(
    latent_channels=8,
    out_channels=1,
    channels=(512, 128, 32),
    num_res_blocks=2,
    num_res_blocks_middle=2,
):
    shapes = {
        "input_layer.weight": [channels[0], latent_channels, 3, 3, 3],
        "input_layer.bias": [channels[0]],
    }
    for i in range(num_res_blocks_middle):
        c = channels[0]
        for s in ["norm1.weight", "norm1.bias", "conv1.bias", "norm2.weight", "norm2.bias", "conv2.bias"]:
            shapes[f"middle_block.{i}.{s}"] = [c]
        shapes[f"middle_block.{i}.conv1.weight"] = [c, c, 3, 3, 3]
        shapes[f"middle_block.{i}.conv2.weight"] = [c, c, 3, 3, 3]
    idx = 0
    for level, c in enumerate(channels):
        for _ in range(num_res_blocks):
            for s in ["norm1.weight", "norm1.bias", "conv1.bias", "norm2.weight", "norm2.bias", "conv2.bias"]:
                shapes[f"blocks.{idx}.{s}"] = [c]
            shapes[f"blocks.{idx}.conv1.weight"] = [c, c, 3, 3, 3]
            shapes[f"blocks.{idx}.conv2.weight"] = [c, c, 3, 3, 3]
            idx += 1
        if level + 1 < len(channels):
            next_c = channels[level + 1]
            shapes[f"blocks.{idx}.conv.weight"] = [next_c * 8, c, 3, 3, 3]
            shapes[f"blocks.{idx}.conv.bias"] = [next_c * 8]
            idx += 1
    shapes["out_layer.0.weight"] = [channels[-1]]
    shapes["out_layer.0.bias"] = [channels[-1]]
    shapes["out_layer.2.weight"] = [out_channels, channels[-1], 3, 3, 3]
    shapes["out_layer.2.bias"] = [out_channels]
    return shapes


def slat_decoder_checkpoint_shapes(
    latent_channels=32,
    channels=(1024, 512, 256, 128, 64),
    num_blocks=(4, 16, 8, 4, 0),
    out_channels=7,
):
    shapes = {
        "from_latent.weight": [channels[0], latent_channels],
        "from_latent.bias": [channels[0]],
        "output_layer.weight": [out_channels, channels[-1]],
        "output_layer.bias": [out_channels],
    }
    for i, c in enumerate(channels):
        for j in range(num_blocks[i]):
            p = f"blocks.{i}.{j}"
            shapes[f"{p}.conv.weight"] = [c, 3, 3, 3, c]
            shapes[f"{p}.conv.bias"] = [c]
            shapes[f"{p}.norm.weight"] = [c]
            shapes[f"{p}.norm.bias"] = [c]
            shapes[f"{p}.mlp.0.weight"] = [c * 4, c]
            shapes[f"{p}.mlp.0.bias"] = [c * 4]
            shapes[f"{p}.mlp.2.weight"] = [c, c * 4]
            shapes[f"{p}.mlp.2.bias"] = [c]
        if i + 1 < len(channels):
            u = f"blocks.{i}.{num_blocks[i]}"
            co = channels[i + 1]
            if out_channels == 7:
                shapes[f"{u}.to_subdiv.weight"] = [8, c]
                shapes[f"{u}.to_subdiv.bias"] = [8]
            shapes[f"{u}.norm1.weight"] = [c]
            shapes[f"{u}.norm1.bias"] = [c]
            shapes[f"{u}.conv1.weight"] = [co * 8, 3, 3, 3, c]
            shapes[f"{u}.conv1.bias"] = [co * 8]
            shapes[f"{u}.conv2.weight"] = [co, 3, 3, 3, co]
            shapes[f"{u}.conv2.bias"] = [co]
    return shapes


def compute_distance_from_fov(camera_angle_x, mesh_scale=1.0, image_resolution=512, extend_pixel=0):
    rotation = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
    grid_point = (np.array([-1.0, 0.0, 0.0]) @ rotation.T) / mesh_scale / 2.0
    focal_length = 16.0 / math.tan(camera_angle_x / 2.0)
    f_pixels = focal_length * image_resolution / 32.0
    x_ndc = (0 - extend_pixel) - image_resolution / 2.0
    return float(f_pixels * grid_point[0] / x_ndc - grid_point[1])


def load_resized_rgb_f32(image_path, size):
    path = Path(image_path)
    try:
        from PIL import Image
        with Image.open(path) as img:
            rgb = img.convert("RGB")
            resized = rgb.resize((size, size), Image.Resampling.LANCZOS)
            pixels = np.asarray(resized, dtype=np.float32) / np.float32(255.0)
    except ImportError:
        raw = path.read_bytes()
        if not raw.startswith(b"P6"):
            raise RuntimeError("Pillow is required for non-PPM image decoding")
        parts = raw.split(maxsplit=3)
        w, h, maxval = int(parts[1]), int(parts[2]), int(parts[3].split()[0])
        header_end = raw.find(str(maxval).encode(), raw.find(parts[2])) + len(str(maxval)) + 1
        arr = np.frombuffer(raw[header_end : header_end + w * h * 3], dtype=np.uint8).reshape(h, w, 3)
        ys = np.linspace(0, h - 1, size).astype(np.int32)
        xs = np.linspace(0, w - 1, size).astype(np.int32)
        pixels = arr[ys][:, xs].astype(np.float32) / np.float32(255.0)
    mean = np.asarray([0.485, 0.456, 0.406], dtype=np.float64)
    std = np.asarray([0.229, 0.224, 0.225], dtype=np.float64)
    dino = np.ascontiguousarray(((pixels - mean) / std)[None], dtype="<f4")
    raw_nhwc = np.ascontiguousarray(pixels[None], dtype="<f4")
    return dino, raw_nhwc


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ["repo-root", "pixal-ckpts", "naf-weights", "dino-weights", "image", "out"]:
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--expected-commit", required=True)
    p.add_argument("--pipeline-type", choices=["512", "1024_cascade"], default="1024_cascade")
    p.add_argument("--conditioning-mode", choices=["source-512", "stage-specific-1024", "shared-512-preview"])
    p.add_argument("--steps", type=int, default=12)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--camera-angle-x", type=float, default=0.8575560450553894)
    p.add_argument("--mesh-scale", type=float, default=1.0)
    p.add_argument("--gelu-table", type=Path)
    p.add_argument("--flow-blocks", type=int, default=30)
    p.add_argument("--occ-res-blocks", type=int, default=2)
    p.add_argument("--occ-mid-blocks", type=int, default=2)
    p.add_argument("--slat-dec-blocks", default="4,16,8,4,0")
    p.add_argument("--naf-output-size", type=int, default=512)
    p.add_argument("--skip-clean-check", action="store_true")
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    cond_mode = a.conditioning_mode or ("stage-specific-1024" if a.pipeline_type == "1024_cascade" else "source-512")
    m = {
        "schema": "pixal3d.generation-inputs.v0",
        "status": "failed",
        "phase": "source-identity",
        "modelCalls": 0,
        "pipelineType": a.pipeline_type,
        "conditioningMode": cond_mode,
        "meshResolution": 512 if a.pipeline_type == "512" else 1024,
        "samplingSteps": a.steps,
        "seed": a.seed,
        "camera": {
            "cameraAngleX": a.camera_angle_x,
            "meshScale": a.mesh_scale,
            "distance": compute_distance_from_fov(a.camera_angle_x, a.mesh_scale, 512),
        },
        "producer": {},
        "tensors": {},
        "models": {},
        "dino": {},
        "image": {},
    }
    try:
        git = lambda *args: subprocess.check_output(["git", "-C", str(a.repo_root), *args], text=True).strip()
        m["producer"] = {
            "root": str(a.repo_root.resolve()),
            "commit": git("rev-parse", "HEAD"),
            "dirty": git("status", "--porcelain"),
            "scriptSha256": digest(__file__),
        }
        if m["producer"]["commit"] != a.expected_commit or (not a.skip_clean_check and m["producer"]["dirty"]):
            raise ValueError("clean exact producer source required")

        def save(name, values, allow_nonfinite=False, **extra):
            values = np.ascontiguousarray(values, dtype="<f4")
            if not allow_nonfinite and not np.isfinite(values).all():
                raise ValueError("nonfinite checkpoint tensor " + name)
            safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
            f = a.out / f"{safe_name}.f32"
            values.tofile(f)
            m["tensors"][name] = {
                "file": f.name,
                "shape": list(values.shape),
                "dtype": "float32",
                "byteLength": values.nbytes,
                "sha256": digest(f),
                **extra,
            }
            return name

        def read_safetensors(file, mapping, transform=lambda k, v: v, allow_extra=False):
            if not file.is_file():
                raise FileNotFoundError(f"missing safetensors checkpoint: {file}")
            identity = {
                "path": str(file),
                "resolvedPath": str(file.resolve()),
                "sha256": digest(file),
                "format": "safetensors",
            }
            rows = {}
            with file.open("rb") as f:
                length = struct.unpack("<Q", f.read(8))[0]
                header = json.loads(f.read(length))
                keys = set(header) - {"__metadata__"}
                expected_keys = set(mapping.values())
                if not allow_extra and expected_keys != keys:
                    raise ValueError(f"complete exact checkpoint parameter coverage required {file}")
                if allow_extra and not expected_keys.issubset(keys):
                    raise ValueError(f"missing required checkpoint parameters in {file}")
                for name, key in mapping.items():
                    row = header[key]
                    start, end = row["data_offsets"]
                    f.seek(8 + length + start)
                    raw = f.read(end - start)
                    values = transform(key, decode_tensor(raw, row["dtype"], row["shape"]))
                    rows[name] = save(
                        name,
                        values,
                        checkpointKey=key,
                        checkpointDtype=row["dtype"],
                        checkpointTensorSha256=hashlib.sha256(raw).hexdigest(),
                    )
            return rows, identity, header

        m["phase"] = "image-preparation"
        if not a.image.is_file():
            raise FileNotFoundError(f"missing input image: {a.image}")
        dino512, raw512 = load_resized_rgb_f32(a.image, 512)
        m["image"] = {
            "sourcePath": str(a.image.resolve()),
            "sourceSha256": digest(a.image),
            "dinoPixelTensor": save("image.dino512", dino512),
            "rawImageTensor": save("image.raw512", raw512),
        }
        if a.pipeline_type == "1024_cascade" and cond_mode == "stage-specific-1024":
            dino1024, raw1024 = load_resized_rgb_f32(a.image, 1024)
            m["image"]["highResolutionDinoPixelTensor"] = save("image.dino1024", dino1024)
            m["image"]["highResolutionRawImageTensor"] = save("image.raw1024", raw1024)

        m["phase"] = "dino-checkpoint-expansion"
        dino_mapping = {
            "dino.prefix.classToken": "embeddings.cls_token",
            "dino.prefix.registerTokens": "embeddings.register_tokens",
            "dino.prefix.patchProjection": "embeddings.patch_embeddings.weight",
            "dino.prefix.patchBias": "embeddings.patch_embeddings.bias",
        }
        layer_map = {
            "norm1Weight": "norm1.weight",
            "norm1Bias": "norm1.bias",
            "qWeight": "attention.q_proj.weight",
            "qBias": "attention.q_proj.bias",
            "kWeight": "attention.k_proj.weight",
            "vWeight": "attention.v_proj.weight",
            "vBias": "attention.v_proj.bias",
            "oWeight": "attention.o_proj.weight",
            "oBias": "attention.o_proj.bias",
            "layerScale1": "layer_scale1.lambda1",
            "norm2Weight": "norm2.weight",
            "norm2Bias": "norm2.bias",
            "mlpUpWeight": "mlp.up_proj.weight",
            "mlpUpBias": "mlp.up_proj.bias",
            "mlpDownWeight": "mlp.down_proj.weight",
            "mlpDownBias": "mlp.down_proj.bias",
            "layerScale2": "layer_scale2.lambda1",
        }
        for i in range(24):
            for k, v in layer_map.items():
                dino_mapping[f"dino.l{i}.{k}"] = f"layer.{i}.{v}"

        def dino_transform(key, val):
            if key == "embeddings.patch_embeddings.weight" and val.shape == (1024, 3, 16, 16):
                return np.transpose(val, (0, 2, 3, 1))
            return val

        dino_rows, dino_id, _ = read_safetensors(a.dino_weights, dino_mapping, dino_transform, allow_extra=True)
        rope_cos, rope_sin = compute_dinov3_rope(32, 32, 64, 100.0)
        m["dino"] = {
            "identity": {"files": {"model.safetensors": {"sha256": dino_id["sha256"]}}},
            "prefix": {
                "patchProjection": dino_rows["dino.prefix.patchProjection"],
                "patchBias": dino_rows["dino.prefix.patchBias"],
                "classToken": dino_rows["dino.prefix.classToken"],
                "registerTokens": dino_rows["dino.prefix.registerTokens"],
                "ropeCos": save("dino.prefix.ropeCos", rope_cos),
                "ropeSin": save("dino.prefix.ropeSin", rope_sin),
            },
            "layers": [
                {k: dino_rows[f"dino.l{i}.{k}"] for k in layer_map}
                for i in range(24)
            ],
        }

        m["phase"] = "naf-checkpoint-expansion"
        naf_keys = naf_weight_shapes(dim=256, heads_rope=4, img_layers=2)
        naf_rows, naf_id, _ = read_safetensors(
            a.naf_weights,
            {f"naf.{k}": k for k in naf_keys},
        )
        naf_base_cfg = {
            "dim": 256,
            "headsAttn": 4,
            "headsRope": 4,
            "imgLayers": 2,
            "numGroups": 8,
            "kernelSize": 9,
            "imageHeight": 512,
            "imageWidth": 512,
            "featureHeight": 32,
            "featureWidth": 32,
            "featureChannels": 1024,
            "prefixTokens": 5,
            "outputHeight": a.naf_output_size,
            "outputWidth": a.naf_output_size,
        }
        naf_hr_cfg = {**naf_base_cfg, "imageHeight": 1024, "imageWidth": 1024, "featureHeight": 64, "featureWidth": 64}
        m["models"]["naf"] = {
            "config": naf_base_cfg,
            "highResolutionConfig": naf_hr_cfg,
            "textureConfig": naf_hr_cfg,
            "identity": naf_id,
            "tensors": {k: naf_rows[f"naf.{k}"] for k in naf_keys},
        }

        m["phase"] = "activation-tables"
        gelu_name = save("shared.gelu", build_bf16_gelu_table(a.gelu_table), allow_nonfinite=True)
        silu_name = save("shared.silu", build_f16_silu_table(), allow_nonfinite=True)

        m["phase"] = "flow-checkpoint-expansion"
        flow_roles = [
            ("sparseFlow", "ss_flow_img_dit_1_3B_64_bf16", 8, 8, 1024, 7.5, 0.7, [0.6, 1.0], 5.0, True),
            ("lowResolutionShape", "slat_flow_img2shape_dit_1_3B_512_bf16", 32, 32, 2048, 7.5, 0.5, [0.6, 1.0], 3.0, False),
            ("textureFlow", "slat_flow_imgshape2tex_dit_1_3B_1024_bf16", 64, 32, 2048, 1.0, 0.0, [0.6, 0.9], 3.0, False),
        ]
        if a.pipeline_type == "1024_cascade":
            flow_roles.insert(
                2,
                ("highResolutionShape", "slat_flow_img2shape_dit_1_3B_1024_bf16", 32, 32, 2048, 7.5, 0.5, [0.6, 1.0], 3.0, False),
            )
        for role, stem, ci, co, proj_in, gs, gr, gi, rt, has_phases in flow_roles:
            f_path = a.pixal_ckpts / f"{stem}.safetensors"
            specs = flow_checkpoint_specs(
                channels=1536,
                heads=12,
                context_channels=1024,
                proj_in_channels=proj_in,
                hidden=8192,
                frequency_dim=256,
                num_blocks=a.flow_blocks,
                in_channels=ci,
                out_channels=co,
            )
            mapping = {f"{role}.{k}": ckpt_k for k, ckpt_k, _ in specs}
            if has_phases:
                mapping["sparse.phases"] = "rope_phases"
            rows, identity, _ = read_safetensors(f_path, mapping)
            tensors = {k: rows[f"{role}.{k}"] for k, _, _ in specs}
            tensors["gelu"] = gelu_name
            model_entry = {
                "config": {
                    "channels": 1536,
                    "heads": 12,
                    "contextChannels": 1024,
                    "contextRows": 5,
                    "projInChannels": proj_in,
                    "hidden": 8192,
                    "frequencyDim": 256,
                    "numBlocks": a.flow_blocks,
                    "steps": a.steps,
                    "guidanceStrength": gs,
                    "guidanceRescale": gr,
                    "guidanceInterval": gi,
                    "rescaleT": rt,
                    "sigmaMin": 1e-5,
                },
                "identity": identity,
                "tensors": tensors,
            }
            if has_phases:
                model_entry["phases"] = rows["sparse.phases"]
            m["models"][role] = model_entry

        m["phase"] = "decoder-checkpoint-expansion"
        occ_path = a.pixal_ckpts / "ss_dec_conv3d_16l8_fp16.safetensors"
        occ_keys = occupancy_decoder_shapes(
            channels=[512, 128, 32],
            num_res_blocks=a.occ_res_blocks,
            num_res_blocks_middle=a.occ_mid_blocks,
        )
        occ_rows, occ_id, _ = read_safetensors(occ_path, {f"occupancyDecoder.{k}": k for k in occ_keys})
        m["models"]["occupancyDecoder"] = {
            "config": {
                "resolution": 16,
                "latentChannels": 8,
                "outChannels": 1,
                "channels": [512, 128, 32],
                "numResBlocks": a.occ_res_blocks,
                "numResBlocksMiddle": a.occ_mid_blocks,
            },
            "identity": occ_id,
            "tensors": {k: occ_rows[f"occupancyDecoder.{k}"] for k in occ_keys},
        }

        slat_blocks = [int(x) for x in a.slat_dec_blocks.split(",")]
        def remap_slat(k):
            return re.sub(r"(blocks\.\d+\.\d+\.mlp)\.([02])", r"\1_\2", k)

        def slat_conv_layout(k, v):
            if v.ndim == 5 and v.shape[2] == v.shape[3] == v.shape[4] and v.shape[2] <= 7 and v.shape[1] != v.shape[2]:
                v = np.transpose(v, (0, 2, 3, 4, 1))
            if k.startswith("blocks."):
                v = v.astype("<f2").astype("<f4")
            return v

        for role, stem, out_c, mode in [
            ("shapeDecoder", "shape_dec_next_dc_f16c32_fp16", 7, "shape"),
            ("textureDecoder", "tex_dec_next_dc_f16c32_fp16", 6, "texture"),
        ]:
            d_path = a.pixal_ckpts / f"{stem}.safetensors"
            dec_ckpt_keys = slat_decoder_checkpoint_shapes(
                channels=[1024, 512, 256, 128, 64],
                num_blocks=slat_blocks,
                out_channels=out_c,
            )
            d_rows, d_id, _ = read_safetensors(
                d_path,
                {f"{role}.{remap_slat(k)}": k for k in dec_ckpt_keys},
                slat_conv_layout,
            )
            m["models"][role] = {
                "config": {
                    "latentChannels": 32,
                    "channels": [1024, 512, 256, 128, 64],
                    "numBlocks": slat_blocks,
                    **({"mode": "texture"} if mode == "texture" else {}),
                    **({"resolution": 32} if a.pipeline_type == "512" else {}),
                },
                "identity": d_id,
                "siluTable": silu_name,
                "tensors": {remap_slat(k): d_rows[f"{role}.{remap_slat(k)}"] for k in dec_ckpt_keys},
            }

        m["status"] = "succeeded"
        m["phase"] = None
    except Exception as e:
        m["error"] = {"message": str(e), "class": type(e).__name__}
        print(str(e), file=sys.stderr)
    finally:
        (a.out / "manifest.json").write_text(json.dumps(m, indent=2) + "\n")
    if m["status"] != "succeeded":
        raise SystemExit(1)
    print(json.dumps({"status": m["status"], "modelCalls": 0, "tensorCount": len(m["tensors"]), "manifest": str(a.out / "manifest.json")}))


if __name__ == "__main__":
    main()
