"""Forward-mode capture at a state taken from a trace, for localizing drift error.

Rebuilds the denoiser exactly as upstream loads it, takes evaluation ``--eval``
of a trace-mode capture (its input x and time t), and writes a capture
directory in the forward-mode layout (cond.npz, forward.npz, activations.npz,
report.json) that export-browser-fixture.py and the forward witness consume.
Checks that the recomputed CFG output equals the traced one bit for bit.
"""

import argparse
import json
import os
import sys

import numpy as np
import torch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", required=True)
    ap.add_argument("--eval", type=int, required=True)
    ap.add_argument("--exp-dir", required=True)
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--float64-reference", action="store_true",
                    help="also run the model in float64 and save its outputs, to judge FP32 error against truth")
    args = ap.parse_args()

    from unimate.configs.schema import MainConfig
    from unimate.inference.sample import _load_checkpoint
    from unimate.models.factory import create_model

    config = MainConfig.from_json(os.path.join(args.exp_dir, "config.json"))
    model = create_model(dataset_config=config.dataset, model_config=config.model)
    _load_checkpoint(model, args.model_path, config)
    model.eval()

    cond_np = np.load(os.path.join(args.trace, "cond.npz"))
    cond = {k: torch.from_numpy(cond_np[k]) for k in cond_np.files}
    tr = np.load(os.path.join(args.trace, "trace.npz"))
    x = torch.from_numpy(tr["eval_x"][args.eval])
    t_val = float(tr["eval_t"][args.eval])
    t = torch.ones(x.shape[0]) * torch.tensor(t_val, dtype=torch.float32)
    n_valid = int(cond["n_joints"].max())
    cfg_scale = 3.0

    acts, hooks, pass_name = {}, [], ["cond"]

    def keep(name):
        def hook(_m, _inp, out):
            for i, o in enumerate(out if isinstance(out, tuple) else (out,)):
                if torch.is_tensor(o):
                    a = o.detach().numpy().astype(np.float32)
                    for ax, n in enumerate(a.shape):
                        if n == x.shape[1] and ax > 0:
                            a = np.take(a, np.arange(n_valid), axis=ax)
                            break
                    acts[f"{pass_name[0]}/{name}/{i}"] = a
        return hook

    for name in ["time_embedder", "cond_embedder", "input_layer", "tpos_pool", "joint_name_embedder", "depth_embedding",
                 "final_layer"]:
        m = getattr(model, name, None)
        if m is not None:
            hooks.append(m.register_forward_hook(keep(name)))
    for i, blk in enumerate(model.transformer_blocks):
        hooks.append(blk.register_forward_hook(keep(f"block{i:02d}")))
    with torch.no_grad():
        out_c = model(x, t, cond)
        pass_name[0] = "uncond"
        out_u = model(x, t, cond, force_mask=True)
    for h in hooks:
        h.remove()
    out_cfg = out_u + (cfg_scale * (out_c - out_u))
    matches = bool(np.array_equal(out_cfg.numpy(), tr["eval_out"][args.eval]))

    extra, f64_report = {}, None
    if args.float64_reference:
        import copy
        m64 = copy.deepcopy(model).double()
        c64 = {k: (v.double() if torch.is_floating_point(v) else v) for k, v in cond.items()}
        with torch.no_grad():
            c = m64(x.double(), t.double(), c64)
            u = m64(x.double(), t.double(), c64, force_mask=True)
        v = u + cfg_scale * (c - u)
        extra = {"out_cond_f64": c.numpy(), "out_uncond_f64": u.numpy(), "out_cfg_f64": v.numpy()}

        def rel(a, b):
            a, b = a[:, :n_valid].astype(np.float64), b[:, :n_valid]
            return float(np.linalg.norm(a - b) / np.linalg.norm(b))
        f64_report = {"torch_f32_vs_f64_relativeL2": {"out_cond": rel(out_c.numpy(), c.numpy()),
                                                      "out_uncond": rel(out_u.numpy(), u.numpy()),
                                                      "out_cfg": rel(out_cfg.numpy(), v.numpy())}}
    os.makedirs(args.out, exist_ok=True)
    np.savez(os.path.join(args.out, "cond.npz"), **{k: cond_np[k] for k in cond_np.files})
    np.savez(os.path.join(args.out, "forward.npz"), noise=x.numpy(), t=t.numpy(), out_cond=out_c.numpy(),
             out_uncond=out_u.numpy(), out_cfg=out_cfg.numpy(), **extra)
    np.savez(os.path.join(args.out, "activations.npz"), **acts)
    report = {"schema": "kaminos.unimate.reference-capture.v0", "mode": "forward-at-trace-eval",
              "trace": os.path.abspath(args.trace), "eval": args.eval, "t": t_val,
              "cfg_matches_trace_bitwise": matches,
              "inputs": json.load(open(os.path.join(args.trace, "report.json"))).get("inputs"),
              "effective_route": {"torch": torch.__version__, "torch_num_threads": torch.get_num_threads()},
              "magnitudes": {"out_cond_absmax": float(out_c.abs().max()), "out_uncond_absmax": float(out_u.abs().max()),
                             "out_cfg_absmax": float(out_cfg.abs().max()),
                             "out_cfg_l2_over_out_cond_l2": float(out_cfg[:, :n_valid].norm() / out_c[:, :n_valid].norm())},
              "float64": f64_report,
              "result": "ok" if matches else "failed"}
    json.dump(report, open(os.path.join(args.out, "report.json"), "w"), indent=2)
    print(json.dumps(report, indent=2))
    if not matches:
        sys.exit(1)


if __name__ == "__main__":
    main()
