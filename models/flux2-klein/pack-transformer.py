"""Pack FLUX.2 Klein transformer weights into per-block f16 bundles for WebGPU.

Each bundle is one little-endian f16 file holding that block's tensors back to
back (256-byte aligned); manifest.json records names, shapes, byte offsets and
sha256 digests. Projections that feed the same input are fused along the output
dimension so the browser runs one GEMM where the source runs several:
double-block to_q/to_k/to_v -> qkv and add_q/add_k/add_v -> added_qkv.

Source tensors are bf16. Every bf16 value inside f16's normal range converts
exactly; the manifest counts values that overflow or fall into f16 subnormals
so a lossy conversion cannot pass silently.

  python pack-transformer.py --model-dir <hf snapshot> --out <dir>
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from safetensors import safe_open

ALIGN = 256
F16_MAX = 65504.0
F16_MIN_NORMAL = 6.103515625e-05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    src = Path(args.model_dir) / "transformer"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((src / "config.json").read_text())
    f = safe_open(str(src / "diffusion_pytorch_model.safetensors"), "pt")

    def t(name):
        return f.get_tensor(name)

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

    manifest = {"schema": "kaminos.flux2-klein.transformer-weights.v0", "dtype": "f16", "layout": "row-major [out, in]",
                "source": str(src.resolve()), "config": config, "bundles": {}, "conversion": {}}
    total_overflow = total_subnormal = 0
    for bname, tensors in bundles.items():
        parts, entries, offset = [], [], 0
        for name, w in tensors:
            w32 = w.to(torch.float32)
            a = w32.numpy().astype(np.float16)
            overflow = int(np.count_nonzero(np.abs(w32.numpy()) > F16_MAX))
            nz = w32.numpy() != 0
            subnormal = int(np.count_nonzero(nz & (np.abs(w32.numpy()) < F16_MIN_NORMAL)))
            exact = bool(np.array_equal(a.astype(np.float32), w32.numpy()))
            total_overflow += overflow
            total_subnormal += subnormal
            data = a.tobytes()
            pad = (-offset) % ALIGN
            if pad:
                parts.append(b"\0" * pad)
                offset += pad
            entries.append({"name": name, "shape": list(a.shape), "offset": offset, "bytes": len(data),
                            "exact_from_bf16": exact, "overflow": overflow, "subnormal": subnormal})
            parts.append(data)
            offset += len(data)
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
