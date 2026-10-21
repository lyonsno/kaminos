"""Pack FLUX.3 Klein transformer weights (text-to-image) into per-block bundles for WebGPU.

Writes the bundles flux3-transformer.js reads, in FLUX.2 Klein's bundle format (pack-transformer.py's
quantizers, alignment and manifest), leaving out what text-to-image never runs: the reference-image
mode blocks, its embedder and its modulations. Every block (text and image per-mode blocks, joint
single blocks) is LayerNorm -> parallel attention + SwiGLU feed-forward, so each is fused into the
single-stream layout: qkv_mlp = [to_q; to_k; to_v; ff.linear_in] along the output dimension
[3D + 2F, D], to_out = [attn.to_out.0 | ff.linear_out] along the input dimension [D, D + F]. Groups
never straddle a fused boundary (D and F are multiples of the group), so quantizing the fused tensor
equals quantizing each part.

  python pack-flux3-transformer.py --model-dir <hf snapshot> --out <dir> [--format i4] [--globals-format i8]
      [--lora <file.safetensors> [--lora-strength 1]] [--shift 6.93] [--steps 16]

The distilled checkpoint (flow_map) embeds each step's target timestep; the base checkpoint does not,
and is packed with a step-distill LoRA merged in (--lora, see flux3_lora.py) before quantization.
--shift and --steps record the sampling recipe the weights were made for in the manifest
("sampling"), which Flux3Pipeline uses by default.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch
from safetensors import safe_open

_spec = importlib.util.spec_from_file_location("klein_pack", Path(__file__).resolve().parent.parent / "flux2-klein" / "pack-transformer.py")
klein_pack = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(klein_pack)
quantize, source_identity, ALIGN = klein_pack.quantize, klein_pack.source_identity, klein_pack.ALIGN
F16_MAX, F16_MIN_NORMAL = klein_pack.F16_MAX, klein_pack.F16_MIN_NORMAL

GLOBALS = [  # (bundle name, diffusers parameter)
    ("x_embedder", "x_embedders.image.weight"),
    ("context_embedder", "context_embedder.weight"),
    ("time_linear_1", "timestep_embedder.linear_1.weight"),
    ("time_linear_2", "timestep_embedder.linear_2.weight"),
    ("target_linear_1", "target_timestep_embedder.linear_1.weight"),
    ("target_linear_2", "target_timestep_embedder.linear_2.weight"),
    ("mod_early_img", "early_stream_modulations.image.linear.weight"),
    ("mod_early_txt", "early_stream_modulations.txt.linear.weight"),
    ("mod_single_img", "single_stream_modulations.image.linear.weight"),
    ("mod_single_txt", "single_stream_modulations.txt.linear.weight"),
    ("norm_out", "norm_out.linear.weight"),
    ("proj_out", "proj_out.weight"),
]
FUSED_IN = ["attn.to_q.weight", "attn.to_k.weight", "attn.to_v.weight", "ff.linear_in.weight"]
FUSED_OUT = ["attn.to_out.0.weight", "ff.linear_out.weight"]


def block_prefixes(config):
    for i in range(config["num_layers"]):
        yield f"txt{i:02d}", f"txt_mode_blocks.{i}."
    for i in range(config["num_layers"]):
        yield f"img{i:02d}", f"mode_blocks.image.{i}."
    for i in range(config["num_single_layers"]):
        yield f"single{i:02d}", f"single_transformer_blocks.{i}."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--format", default="i4", choices=["f16", "i8", "i4", "i3", "i2"])
    ap.add_argument("--globals-format", default="i8", choices=["f16", "i8", "i4", "i3", "i2"])
    ap.add_argument("--group", type=int, default=64)
    ap.add_argument("--lora")
    ap.add_argument("--lora-strength", type=float, default=1.0)
    ap.add_argument("--shift", type=float, default=None)
    ap.add_argument("--steps", type=int, default=None)
    args = ap.parse_args()
    src = Path(args.model_dir) / "transformer"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((src / "config.json").read_text())
    flow_map = bool(config.get("flow_map"))
    if not flow_map and not args.lora:
        raise SystemExit("the base checkpoint needs a step-distill LoRA (--lora); without one it wants 50 CFG steps")
    deltas = {}
    if args.lora:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from flux3_lora import lora_deltas
        deltas = lora_deltas(args.lora, args.lora_strength)
    used = set()
    weight_map = json.loads((src / "diffusion_pytorch_model.safetensors.index.json").read_text())["weight_map"]
    handles = {}

    def t(name):
        fname = weight_map[name]
        if fname not in handles:
            handles[fname] = safe_open(str(src / fname), "pt")
        w = handles[fname].get_tensor(name)
        if name in deltas:
            used.add(name)
            w = w.to(torch.float32) + deltas[name]  # merged in f32, then quantized like every weight
        return w

    D = config["num_attention_heads"] * config["attention_head_dim"]
    bundles = {"globals": [(n, t(p)) for n, p in GLOBALS if flow_map or not n.startswith("target_")]}
    for bname, p in block_prefixes(config):
        ins = [t(p + n) for n in FUSED_IN]
        outs = [t(p + n) for n in FUSED_OUT]
        assert D % args.group == 0, "a quantization group would straddle the to_out fusion boundary"
        bundles[bname] = [("qkv_mlp", torch.cat(ins, 0)), ("to_out", torch.cat(outs, 1)),
                          ("norm_q", t(p + "attn.norm_q.weight")), ("norm_k", t(p + "attn.norm_k.weight"))]

    manifest = {"schema": "kaminos.flux3-klein.transformer-weights.v1", "format": args.format,
                "globals_format": args.globals_format, "group": args.group, "globals_group": args.group,
                "layout": "row-major [out, in]", "mode": "text-to-image", "source": source_identity(src),
                "config": config, "bundles": {}, "conversion": {},
                "sampling": {"shift": args.shift if args.shift is not None else (6.93 if flow_map else 3.0),
                             "steps": args.steps if args.steps is not None else (16 if flow_map else 4)}}
    if args.lora:
        manifest["lora"] = {"file": Path(args.lora).name, "sha256": hashlib.sha256(Path(args.lora).read_bytes()).hexdigest(),
                            "strength": args.lora_strength, "merged": len(deltas)}
    total_overflow = total_subnormal = 0
    for bname, tensors in bundles.items():
        fmt_for = args.globals_format if bname == "globals" else args.format
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
            fmt = fmt_for if (w32.ndim == 2 and w32.shape[1] % args.group == 0) else "f16"
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
                qdata, sdata, deq = quantize(w32, fmt, args.group)
                err = float(np.linalg.norm(deq - w32) / max(np.linalg.norm(w32), 1e-30))
                entries.append({"name": name, "format": fmt, "group": args.group, "shape": list(w32.shape), "offset": put(qdata),
                                "bytes": len(qdata), "scale_offset": put(sdata), "scale_bytes": len(sdata), "weight_rel_l2": err})
        blob = b"".join(parts)
        (out / f"{bname}.bin").write_bytes(blob)
        manifest["bundles"][bname] = {"file": f"{bname}.bin", "bytes": len(blob),
                                      "sha256": hashlib.sha256(blob).hexdigest(), "tensors": entries}
        print(bname, len(blob), flush=True)
    if set(deltas) - used:
        raise SystemExit(f"LoRA targets never packed: {sorted(set(deltas) - used)[:5]}")
    manifest["conversion"] = {"overflow_values": total_overflow, "subnormal_values": total_subnormal}
    manifest["total_bytes"] = sum(b["bytes"] for b in manifest["bundles"].values())
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    if total_overflow:
        raise SystemExit(f"{total_overflow} weights overflow f16")


if __name__ == "__main__":
    main()
