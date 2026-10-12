"""Pack the FLUX.2 VAE decoder for WebGPU.

One f16 bundle holds every decoder-side tensor (256-byte aligned) plus the
latent batch-norm statistics the pipeline applies before decoding. 3x3 conv
weights are reordered from [Cout, Cin, ky, kx] to [Cout, ky, kx, Cin] so the
implicit-GEMM conv reads contiguous channels from channels-last activations;
1x1 convs become [Cout, Cin]. Batch-norm statistics are stored f32 because the
pipeline adds batch_norm_eps to running_var before the square root.

  python pack-vae.py --model-dir <hf snapshot> --out <dir>
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from importlib import import_module
from safetensors import safe_open

source_identity = import_module('pack-transformer').source_identity
ALIGN = 256


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    src = Path(args.model_dir) / "vae"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((src / "config.json").read_text())
    f = safe_open(str(src / "diffusion_pytorch_model.safetensors"), "pt")

    parts, entries, offset = [], [], 0

    def add(name, arr, dtype):
        nonlocal offset
        a = np.ascontiguousarray(arr.astype(dtype))
        pad = (-offset) % ALIGN
        if pad:
            parts.append(b"\0" * pad)
            offset += pad
        data = a.tobytes()
        entries.append({"name": name, "shape": list(a.shape), "dtype": str(a.dtype), "offset": offset, "bytes": len(data)})
        parts.append(data)
        offset += len(data)

    for key in f.keys():
        if key.startswith("encoder.") or key.startswith("quant_conv") or key == "bn.num_batches_tracked":
            continue
        w = f.get_tensor(key).to(torch.float32)
        if key.startswith("bn."):
            add(key, w.numpy(), np.float32)
            continue
        if w.ndim == 4 and w.shape[2] == 3:
            w = w.permute(0, 2, 3, 1).reshape(w.shape[0], -1)
        elif w.ndim == 4:
            w = w.reshape(w.shape[0], w.shape[1])
        add(key, w.numpy(), np.float16)

    blob = b"".join(parts)
    (out / "vae-decoder.bin").write_bytes(blob)
    manifest = {"schema": "kaminos.flux2-klein.vae-decoder-weights.v0", "source": source_identity(src), "config": config,
                "conv3x3_layout": "[Cout, ky, kx, Cin]", "bundle": {"file": "vae-decoder.bin", "bytes": len(blob),
                "sha256": hashlib.sha256(blob).hexdigest(), "tensors": entries}}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(len(entries), "tensors", len(blob), "bytes")


if __name__ == "__main__":
    main()
