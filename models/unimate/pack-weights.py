"""Pack the UniMate denoiser weights (EMA applied) for the WebGPU port.

Writes ``<out>/unimate-denoiser-fp32.bin`` (little-endian float32 tensors,
each starting on a 256-byte boundary) and ``<out>/manifest.json`` (per-tensor
name, shape, offset and length; model hyperparameters; source identities and
the binary's SHA-256).

The weights come from upstream's own ``_load_checkpoint``, which copies the
EMA shadow into the parameters, so the packed values are exactly what the
reference sampler runs. With ``--verify-capture`` the packed file is loaded
back into a fresh model, which must reproduce a forward-mode capture's
outputs bit for bit; otherwise the script exits non-zero.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
import torch

ALIGN = 256


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--unimate-root", required=True)
    ap.add_argument("--exp-dir", required=True)
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--verify-capture", help="forward-mode capture directory to reproduce from the packed file")
    args = ap.parse_args()

    from unimate.configs.schema import MainConfig
    from unimate.inference.sample import _load_checkpoint
    from unimate.models.factory import create_model

    config = MainConfig.from_json(os.path.join(args.exp_dir, "config.json"))
    model = create_model(dataset_config=config.dataset, model_config=config.model)
    _load_checkpoint(model, args.model_path, config)
    model.eval()
    state = model.state_dict()

    os.makedirs(args.out, exist_ok=True)
    bin_path = os.path.join(args.out, "unimate-denoiser-fp32.bin")
    tensors = []
    offset = 0
    with open(bin_path, "wb") as f:
        for name, value in state.items():
            if not torch.is_floating_point(value):
                raise TypeError(f"{name} is {value.dtype}; the packer expects floating tensors only")
            arr = value.detach().to(torch.float32).contiguous().numpy()
            pad = (-offset) % ALIGN
            f.write(b"\0" * pad)
            offset += pad
            data = arr.astype("<f4").tobytes()
            f.write(data)
            tensors.append({"name": name, "shape": list(arr.shape), "dtype": "float32",
                            "offset": offset, "byteLength": len(data)})
            offset += len(data)

    rev = subprocess.check_output(["git", "-C", args.unimate_root, "rev-parse", "HEAD"], text=True).strip()
    manifest = {
        "schema": "kaminos.unimate.denoiser-weights.v0",
        "file": os.path.basename(bin_path),
        "byteLength": offset,
        "sha256": _sha256(bin_path),
        "alignment": ALIGN,
        "parameterCount": int(sum(int(np.prod(t["shape"])) for t in tensors)),
        "source": {
            "unimate_rev": rev,
            "checkpoint": os.path.abspath(args.model_path),
            "checkpoint_sha256": _sha256(args.model_path),
            "config_sha256": _sha256(os.path.join(args.exp_dir, "config.json")),
            "ema_applied_by": "unimate.inference.sample._load_checkpoint",
            "weights_license": "CC-BY-NC-4.0 (released UniMate weights); keep private unless separately cleared",
        },
        "model": config.model.__dict__ if hasattr(config.model, "__dict__") else str(config.model),
        "dataset": {"max_joints": config.dataset.max_joints, "max_motion_length": config.dataset.max_motion_length,
                    "feature_len": config.dataset.feature_len, "max_depth": config.dataset.max_depth},
        "tensors": tensors,
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    print(f"packed {len(tensors)} tensors, {manifest['parameterCount']} parameters, {offset} bytes")

    if args.verify_capture:
        raw = np.fromfile(bin_path, dtype="<f4")
        loaded = {t["name"]: torch.from_numpy(
            raw[t["offset"] // 4: (t["offset"] + t["byteLength"]) // 4].reshape(t["shape"]).copy())
            for t in tensors}
        fresh = create_model(dataset_config=config.dataset, model_config=config.model)
        fresh.load_state_dict(loaded, strict=True)
        fresh.eval()
        cond_np = np.load(os.path.join(args.verify_capture, "cond.npz"))
        cond = {k: torch.from_numpy(cond_np[k]) for k in cond_np.files}
        fwd = np.load(os.path.join(args.verify_capture, "forward.npz"))
        with torch.no_grad():
            out_c = fresh(torch.from_numpy(fwd["noise"]), torch.from_numpy(fwd["t"]), cond).numpy()
            out_u = fresh(torch.from_numpy(fwd["noise"]), torch.from_numpy(fwd["t"]), cond, force_mask=True).numpy()
        ok = np.array_equal(out_c, fwd["out_cond"]) and np.array_equal(out_u, fwd["out_uncond"])
        verdict = {"capture": os.path.abspath(args.verify_capture), "bitwise_equal": bool(ok),
                   "cond_max_abs_diff": float(np.abs(out_c - fwd["out_cond"]).max()),
                   "uncond_max_abs_diff": float(np.abs(out_u - fwd["out_uncond"]).max())}
        manifest["verification"] = verdict
        with open(os.path.join(args.out, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=2, default=str)
        print(json.dumps(verdict, indent=2))
        if not ok:
            sys.exit(1)


if __name__ == "__main__":
    main()
