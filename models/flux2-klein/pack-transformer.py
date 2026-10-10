"""Pack FLUX.2 Klein transformer weights into per-block f16 bundles for WebGPU.

Each bundle is one little-endian f16 file holding that block's tensors back to
back (256-byte aligned); manifest.json records names, shapes, byte offsets and
sha256 digests. Projections that feed the same input are fused along the output
dimension so the browser runs one GEMM where the source runs several:
double-block to_q/to_k/to_v -> qkv and add_q/add_k/add_v -> added_qkv.

Source tensors are bf16. Every bf16 value inside f16's normal range converts
exactly; the manifest counts values that overflow or fall into f16 subnormals
so a lossy conversion cannot pass silently.

Weight-only quantization (--format i8 or i4) stores each 2-D linear in K
groups of 64: i8 is symmetric (q in [-127, 127], one f16 scale per group,
packed four per u32); i4 is affine like MLX (q in [0, 15], f16 scale and
bias per group, packed eight per u32, low nibble first). --globals-format
sets the embedders, modulation and output projections separately because
they condition every block. Norm weights stay f16.

  python pack-transformer.py --model-dir <hf snapshot> --out <dir> [--format f16|i8|i4] [--globals-format f16|i8|i4]
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from safetensors import safe_open


def source_identity(path):
    """Hugging Face repo identity for a cached snapshot path, else the path's basename only."""
    parts = Path(path).resolve().parts
    for i, part in enumerate(parts):
        if part.startswith("models--") and i + 2 < len(parts) and parts[i + 1] == "snapshots":
            repo = part[len("models--"):].replace("--", "/")
            return {"repo": repo, "revision": parts[i + 2], "subfolder": "/".join(parts[i + 3:])}
    return {"path": Path(path).name}

ALIGN = 256
GROUP = 64


def quantize(w, fmt, group=None):
    """Return (data bytes, scales bytes, dequantized f32) for a 2-D weight [N, K]."""
    group = group or GROUP
    N, K = w.shape
    g = w.reshape(N, K // group, group).astype(np.float32)
    if fmt == "i8":
        scale = np.abs(g).max(axis=2, keepdims=True) / 127.0
        scale = scale.astype(np.float16).astype(np.float32)
        safe = np.where(scale == 0, 1, scale)
        q = np.clip(np.rint(g / safe), -127, 127).astype(np.int8)
        deq = q.astype(np.float32) * scale
        return q.reshape(N, K).tobytes(), scale.astype(np.float16).reshape(N, K // group).tobytes(), deq.reshape(N, K)
    if fmt == "i4":
        lo, hi = g.min(axis=2, keepdims=True), g.max(axis=2, keepdims=True)
        scale = ((hi - lo) / 15.0).astype(np.float16).astype(np.float32)
        bias = lo.astype(np.float16).astype(np.float32)
        safe = np.where(scale == 0, 1, scale)
        q = np.clip(np.rint((g - bias) / safe), 0, 15).astype(np.uint32)
        deq = q.astype(np.float32) * scale + bias
        q = q.reshape(N, K // 8, 8)
        packed = np.zeros((N, K // 8), dtype=np.uint32)
        for c in range(8):
            packed |= q[:, :, c] << np.uint32(4 * c)
        sb = np.concatenate([scale, bias], axis=2).astype(np.float16).reshape(N, K // group * 2)
        return packed.tobytes(), sb.tobytes(), deq.reshape(N, K)
    if fmt in ("i3", "i2"):
        bits = int(fmt[1])
        scale, bias = mse_range(g, bits)
        safe = np.where(scale == 0, 1, scale)
        q = np.clip(np.rint((g - bias) / safe), 0, 2 ** bits - 1).astype(np.uint32)
        deq = q.astype(np.float32) * scale + bias
        sb = np.concatenate([scale, bias], axis=2).astype(np.float16).reshape(N, K // group * 2)
        return pack_bits(q.reshape(N, K), bits).tobytes(), sb.tobytes(), deq.reshape(N, K)
    raise ValueError(fmt)


def mse_range(g, bits, candidates=np.linspace(0.4, 1.0, 10)):
    """Per-group affine range for low-bit weights: shrink the min/max range by the candidate factor
    that minimizes the group's squared error after f16 rounding of scale and bias (as quant-assay.py's
    "mse" scheme). g is [N, groups, group] f32; returns f16-representable f32 (scale, bias)."""
    t = torch.from_numpy(g)
    levels = 2 ** bits - 1
    lo, hi = t.amin(dim=2, keepdim=True), t.amax(dim=2, keepdim=True)
    best_scale = best_bias = best_err = None
    for r in candidates.tolist():
        scale, bias = ((hi - lo) * r / levels).half().float(), (lo * r).half().float()
        safe = torch.where(scale == 0, torch.ones_like(scale), scale)
        err = ((torch.clamp(torch.round((t - bias) / safe), 0, levels) * scale + bias - t) ** 2).sum(dim=2, keepdim=True)
        if best_err is None:
            best_scale, best_bias, best_err = scale, bias, err
        else:
            better = err < best_err
            best_scale, best_bias = torch.where(better, scale, best_scale), torch.where(better, bias, best_bias)
            best_err = torch.minimum(err, best_err)
    return best_scale.numpy(), best_bias.numpy()


def pack_bits(q, bits):
    """Pack unsigned codes q [N, K] row-major into u32 words. 2-bit: 16 codes per word, code c at bit
    2c. 3-bit: 32 codes per 3 words, code j at bit 3j of the 96-bit little-endian triple (codes 10
    and 21 straddle words), so a 32-wide K tile is exactly 3 words."""
    N, K = q.shape
    q = q.astype(np.uint64)
    if bits == 2:
        q = q.reshape(N, K // 16, 16)
        packed = np.zeros((N, K // 16), dtype=np.uint64)
        for c in range(16):
            packed |= q[:, :, c] << np.uint64(2 * c)
        return packed.astype(np.uint32)
    if bits == 3:
        assert K % 32 == 0, "3-bit packing needs K divisible by 32"
        q = q.reshape(N, K // 32, 32)
        words = np.zeros((N, K // 32, 3), dtype=np.uint64)
        for j in range(32):
            w, sh = divmod(3 * j, 32)
            words[:, :, w] |= (q[:, :, j] << np.uint64(sh)) & np.uint64(0xFFFFFFFF)
            if sh > 29:
                words[:, :, w + 1] |= q[:, :, j] >> np.uint64(32 - sh)
        return words.astype(np.uint32).reshape(N, K // 32 * 3)
    raise ValueError(bits)
F16_MAX = 65504.0
F16_MIN_NORMAL = 6.103515625e-05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--format", default="f16", choices=["f16", "i8", "i4", "i3", "i2"])
    ap.add_argument("--globals-format", default=None, choices=["f16", "i8", "i4", "i3", "i2"])
    ap.add_argument("--group", type=int, default=GROUP, help="quantization group for block weights (multiple of 8)")
    ap.add_argument("--globals-group", type=int, default=None, help="quantization group for globals (default: --group)")
    args = ap.parse_args()
    globals_format = args.globals_format or args.format
    globals_group = args.globals_group or args.group
    src = Path(args.model_dir) / "transformer"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((src / "config.json").read_text())
    index_path = src / "diffusion_pytorch_model.safetensors.index.json"
    weight_map = json.loads(index_path.read_text())["weight_map"] if index_path.exists() else None
    handles = {}

    def t(name):
        fname = weight_map[name] if weight_map else "diffusion_pytorch_model.safetensors"
        if fname not in handles:
            handles[fname] = safe_open(str(src / fname), "pt")
        return handles[fname].get_tensor(name)

    bundles = {"globals": [("x_embedder", t("x_embedder.weight")),
                           ("context_embedder", t("context_embedder.weight")),
                           ("time_linear_1", t("time_guidance_embed.timestep_embedder.linear_1.weight")),
                           ("time_linear_2", t("time_guidance_embed.timestep_embedder.linear_2.weight")),
                           ("mod_double_img", t("double_stream_modulation_img.linear.weight")),
                           ("mod_double_txt", t("double_stream_modulation_txt.linear.weight")),
                           ("mod_single", t("single_stream_modulation.linear.weight")),
                           ("norm_out", t("norm_out.linear.weight")),
                           ("proj_out", t("proj_out.weight"))]}
    for i in range(config["num_layers"]):
        p = f"transformer_blocks.{i}."
        bundles[f"double{i:02d}"] = [
            ("qkv", torch.cat([t(p + "attn.to_q.weight"), t(p + "attn.to_k.weight"), t(p + "attn.to_v.weight")])),
            ("added_qkv", torch.cat([t(p + "attn.add_q_proj.weight"), t(p + "attn.add_k_proj.weight"),
                                     t(p + "attn.add_v_proj.weight")])),
            ("norm_q", t(p + "attn.norm_q.weight")), ("norm_k", t(p + "attn.norm_k.weight")),
            ("norm_added_q", t(p + "attn.norm_added_q.weight")), ("norm_added_k", t(p + "attn.norm_added_k.weight")),
            ("to_out", t(p + "attn.to_out.0.weight")), ("to_add_out", t(p + "attn.to_add_out.weight")),
            ("ff_in", t(p + "ff.linear_in.weight")), ("ff_out", t(p + "ff.linear_out.weight")),
            ("ff_context_in", t(p + "ff_context.linear_in.weight")),
            ("ff_context_out", t(p + "ff_context.linear_out.weight")),
        ]
    for i in range(config["num_single_layers"]):
        p = f"single_transformer_blocks.{i}."
        bundles[f"single{i:02d}"] = [
            ("qkv_mlp", t(p + "attn.to_qkv_mlp_proj.weight")), ("to_out", t(p + "attn.to_out.weight")),
            ("norm_q", t(p + "attn.norm_q.weight")), ("norm_k", t(p + "attn.norm_k.weight")),
        ]

    manifest = {"schema": "kaminos.flux2-klein.transformer-weights.v1", "format": args.format,
                "globals_format": globals_format, "group": args.group, "globals_group": globals_group, "layout": "row-major [out, in]",
                "source": source_identity(src), "config": config, "bundles": {}, "conversion": {}}
    total_overflow = total_subnormal = 0
    for bname, tensors in bundles.items():
        fmt_for = globals_format if bname == "globals" else args.format
        group_for = globals_group if bname == "globals" else args.group
        parts, entries, offset = [], [], 0

        def put(data):
            nonlocal offset
            pad = (-offset) % ALIGN
            if pad:
                parts.append(b"\0" * pad)
                offset += pad
            at = offset
            parts.append(data)
            offset += len(data)
            return at

        for name, w in tensors:
            w32 = w.to(torch.float32).numpy()
            fmt = fmt_for if (w32.ndim == 2 and w32.shape[1] % group_for == 0) else "f16"
            if fmt == "f16":
                a = w32.astype(np.float16)
                overflow = int(np.count_nonzero(np.abs(w32) > F16_MAX))
                subnormal = int(np.count_nonzero((w32 != 0) & (np.abs(w32) < F16_MIN_NORMAL)))
                total_overflow += overflow
                total_subnormal += subnormal
                data = a.tobytes()
                entries.append({"name": name, "format": "f16", "shape": list(a.shape), "offset": put(data), "bytes": len(data),
                                "overflow": overflow, "subnormal": subnormal})
            else:
                qdata, sdata, deq = quantize(w32, fmt, group_for)
                err = float(np.linalg.norm(deq - w32) / max(np.linalg.norm(w32), 1e-30))
                entries.append({"name": name, "format": fmt, "group": group_for, "shape": list(w32.shape), "offset": put(qdata),
                                "bytes": len(qdata), "scale_offset": put(sdata), "scale_bytes": len(sdata), "weight_rel_l2": err})
        blob = b"".join(parts)
        (out / f"{bname}.bin").write_bytes(blob)
        manifest["bundles"][bname] = {"file": f"{bname}.bin", "bytes": len(blob),
                                      "sha256": hashlib.sha256(blob).hexdigest(), "tensors": entries}
        print(bname, len(blob), flush=True)
    manifest["conversion"] = {"overflow_values": total_overflow, "subnormal_values": total_subnormal}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    if total_overflow:
        raise SystemExit(f"{total_overflow} weights overflow f16")


if __name__ == "__main__":
    main()
