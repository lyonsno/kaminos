"""Check two properties of a forward-mode reference capture.

1. Sufficiency: the denoiser rebuilt from ``config.json`` plus the checkpoint,
   fed only the saved ``cond.npz`` tensors and ``forward.npz`` noise,
   reproduces the captured conditional and unconditional outputs. If it does,
   the browser route can consume exported conditioning without the Python
   importer or text encoder.
2. Padding independence: replacing the padded joints' noise changes no output
   on the valid joints. If it holds, a replay of the reference step sequence
   can run on valid joints only.

Writes ``probe.json`` beside the capture and exits non-zero if either fails.
"""

import argparse
import json
import os
import sys

import numpy as np
import torch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture", required=True, help="forward-mode capture directory")
    ap.add_argument("--exp-dir", required=True)
    ap.add_argument("--model-path", required=True)
    args = ap.parse_args()

    from unimate.configs.schema import MainConfig
    from unimate.inference.sample import _load_checkpoint
    from unimate.models.factory import create_model

    config = MainConfig.from_json(os.path.join(args.exp_dir, "config.json"))
    model = create_model(dataset_config=config.dataset, model_config=config.model)
    _load_checkpoint(model, args.model_path, config)
    model.eval()

    cond_np = np.load(os.path.join(args.capture, "cond.npz"))
    cond = {k: torch.from_numpy(cond_np[k]) for k in cond_np.files}
    fwd = np.load(os.path.join(args.capture, "forward.npz"))
    noise = torch.from_numpy(fwd["noise"])
    t = torch.from_numpy(fwd["t"])
    n_valid = int(cond["n_joints"].max())

    result = {"n_valid_joints": n_valid, "cond_keys": sorted(cond)}
    with torch.no_grad():
        out_c = model(noise, t, cond).numpy()
        out_u = model(noise, t, cond, force_mask=True).numpy()
        result["sufficiency"] = {
            "cond_max_abs_diff": float(np.abs(out_c - fwd["out_cond"]).max()),
            "uncond_max_abs_diff": float(np.abs(out_u - fwd["out_uncond"]).max()),
            "cond_bitwise": bool(np.array_equal(out_c, fwd["out_cond"])),
            "uncond_bitwise": bool(np.array_equal(out_u, fwd["out_uncond"])),
        }

        gen = torch.Generator().manual_seed(1234)
        perturbed = noise.clone()
        perturbed[:, n_valid:] = torch.randn(perturbed[:, n_valid:].shape, generator=gen) * 3.0
        out_cp = model(perturbed, t, cond).numpy()
        out_up = model(perturbed, t, cond, force_mask=True).numpy()
        result["padding_independence"] = {
            "cond_valid_max_abs_diff": float(np.abs(out_cp[:, :n_valid] - out_c[:, :n_valid]).max()),
            "uncond_valid_max_abs_diff": float(np.abs(out_up[:, :n_valid] - out_u[:, :n_valid]).max()),
            "padded_output_changed": bool(not np.array_equal(out_cp[:, n_valid:], out_c[:, n_valid:])),
        }

    suff = result["sufficiency"]
    pad = result["padding_independence"]
    result["sufficiency_holds"] = suff["cond_max_abs_diff"] == 0.0 and suff["uncond_max_abs_diff"] == 0.0
    result["padding_independence_holds"] = (pad["cond_valid_max_abs_diff"] <= 1e-5
                                            and pad["uncond_valid_max_abs_diff"] <= 1e-5)
    with open(os.path.join(args.capture, "probe.json"), "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    if not (result["sufficiency_holds"] and result["padding_independence_holds"]):
        sys.exit(1)


if __name__ == "__main__":
    main()
