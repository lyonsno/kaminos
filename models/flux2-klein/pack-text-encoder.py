"""Pack the FLUX.2 Klein Qwen3 text encoder for WebGPU.

Flux2KleinPipeline reads Qwen3 hidden states 9, 18 and 27, so only decoder
layers 0..26 are packed; layers 27..35 and the final norm never affect the
output. Each layer is one f16 bundle (256-byte aligned) with q/k/v fused to
[q | k | v] and gate/up fused to [gate | up]. The token-embedding table is a
separate row-major f16 file so the browser can fetch only the rows a prompt
uses with HTTP range requests. tokenizer.json is copied beside the manifest.

--format i8|i4 quantizes the 2-D linears exactly as pack-transformer.py does
(group 64; norms stay f16). The embedding table stays f16 because only the
prompt's rows are ever fetched.

  python pack-text-encoder.py --model-dir <hf snapshot> --out <dir> [--format f16|i8|i4]

Other Qwen3-family encoders reuse it through the layout options: FLUX.3 Klein's Qwen3-VL text model is
--layer-prefix model.language_model.layers. --embed-name model.language_model.embed_tokens.weight
--config-key text_config --taps 4,8,12,16,20,24,28,32 --tokenizer text_encoder/tokenizer.json.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import torch
from safetensors import safe_open

from importlib import import_module
_packer = import_module('pack-transformer')
quantize, source_identity = _packer.quantize, _packer.source_identity
GROUP = 64
ALIGN = 256
TAPS = (9, 18, 27)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--format", default="f16", choices=["f16", "i8", "i4"])
    ap.add_argument("--group", type=int, default=GROUP, help="quantization group (multiple of 8)")
    ap.add_argument("--taps", default=",".join(map(str, TAPS)), help="hidden states the pipeline reads")
    ap.add_argument("--layer-prefix", default="model.layers.")
    ap.add_argument("--embed-name", default="model.embed_tokens.weight")
    ap.add_argument("--config-key", default=None, help="sub-config holding the text model (e.g. text_config)")
    ap.add_argument("--tokenizer", default="tokenizer/tokenizer.json", help="tokenizer.json relative to --model-dir")
    ap.add_argument("--schema", default="kaminos.flux2-klein.text-encoder-weights.v1")
    args = ap.parse_args()
    taps = tuple(int(x) for x in args.taps.split(","))
    src = Path(args.model_dir) / "text_encoder"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((src / "config.json").read_text())
    if args.config_key:
        config = config[args.config_key]
    index = json.loads((src / "model.safetensors.index.json").read_text())["weight_map"]
    handles = {}

    def t(name):
        fname = index[name]
        if fname not in handles:
            handles[fname] = safe_open(str(src / fname), "pt")
        return handles[fname].get_tensor(name).to(torch.float32)

    layers_needed = max(taps)
    manifest = {"schema": args.schema, "source": source_identity(src), "config": config,
                "taps": list(taps), "layers": layers_needed, "format": args.format, "group": args.group, "bundles": {}}

    for i in range(layers_needed):
        p = f"{args.layer_prefix}{i}."
        tensors = [
            ("input_layernorm", t(p + "input_layernorm.weight")),
            ("qkv", torch.cat([t(p + "self_attn.q_proj.weight"), t(p + "self_attn.k_proj.weight"),
                               t(p + "self_attn.v_proj.weight")])),
            ("q_norm", t(p + "self_attn.q_norm.weight")), ("k_norm", t(p + "self_attn.k_norm.weight")),
            ("o_proj", t(p + "self_attn.o_proj.weight")),
            ("post_attention_layernorm", t(p + "post_attention_layernorm.weight")),
            ("gate_up", torch.cat([t(p + "mlp.gate_proj.weight"), t(p + "mlp.up_proj.weight")])),
            ("down", t(p + "mlp.down_proj.weight")),
        ]
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
            w32 = w.numpy()
            fmt = args.format if (w32.ndim == 2 and w32.shape[1] % args.group == 0) else "f16"
            if fmt == "f16":
                a = w32.astype(np.float16)
                if not np.all(np.isfinite(a)):
                    raise SystemExit(f"layer {i} {name} overflows f16")
                data = a.tobytes()
                entries.append({"name": name, "format": "f16", "shape": list(a.shape), "offset": put(data), "bytes": len(data)})
            else:
                qdata, sdata, deq = quantize(w32, fmt, args.group)
                err = float(np.linalg.norm(deq - w32) / max(np.linalg.norm(w32), 1e-30))
                entries.append({"name": name, "format": fmt, "group": args.group, "shape": list(w32.shape), "offset": put(qdata),
                                "bytes": len(qdata), "scale_offset": put(sdata), "scale_bytes": len(sdata), "weight_rel_l2": err})
        blob = b"".join(parts)
        bname = f"layer{i:02d}"
        (out / f"te-{bname}.bin").write_bytes(blob)
        manifest["bundles"][bname] = {"file": f"te-{bname}.bin", "bytes": len(blob),
                                      "sha256": hashlib.sha256(blob).hexdigest(), "tensors": entries}
        print(bname, len(blob), flush=True)

    emb = t(args.embed_name).numpy().astype(np.float16)
    (out / "te-embed.bin").write_bytes(emb.tobytes())
    manifest["embedding"] = {"file": "te-embed.bin", "shape": list(emb.shape), "row_bytes": emb.shape[1] * 2,
                             "sha256": hashlib.sha256(emb.tobytes()).hexdigest()}
    tok_src = Path(args.model_dir) / args.tokenizer
    shutil.copyfile(tok_src, out / "tokenizer.json")
    manifest["tokenizer"] = {"file": "tokenizer.json", "sha256": hashlib.sha256((out / "tokenizer.json").read_bytes()).hexdigest()}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
