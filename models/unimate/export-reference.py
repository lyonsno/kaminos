"""Capture PyTorch reference fixtures for the UniMate WebGPU port.

Runs the upstream ``unimate.inference.sample`` entry point unchanged and
observes it from outside, so the captured conditioning, noise, model outputs
and solver trace are the ones the upstream route actually used:

- ``--mode forward``: stop at the first drift evaluation. Save the effective
  conditioning dict, the initial noise, the conditional, unconditional and
  CFG-combined model outputs at (x = noise, t = t0), and per-module
  activations of both denoiser passes. Takes seconds to a minute.
- ``--mode trace``: run the whole dopri5 solve. Save every drift evaluation
  (t, x, output), every attempted step (t0, dt, error ratio, accepted, next
  dt), the initial step, the solver settings and the final samples. Upstream
  then writes its usual motions and renders into ``--out``/upstream.

Run with the UniMate reference interpreter and ``PYTHONPATH`` set to the
UniMate checkout. Every run writes ``report.json``, including on failure,
naming the phase reached and the effective route.
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import traceback

import numpy as np


class _StopAfterForward(Exception):
    pass


def _sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _git_rev(root):
    try:
        rev = subprocess.check_output(["git", "-C", root, "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.check_output(["git", "-C", root, "status", "--porcelain", "--untracked-files=no"],
                                        text=True).strip()
        return {"rev": rev, "tracked_changes": bool(dirty)}
    except Exception as exc:  # noqa: BLE001 - report, don't hide
        return {"error": repr(exc)}


def _np(t):
    return t.detach().cpu().numpy()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["forward", "trace"], required=True)
    ap.add_argument("--unimate-root", required=True, help="UniMate source checkout (also on PYTHONPATH)")
    ap.add_argument("--exp-dir", required=True, help="experiment dir holding config.json and dataset_stats.npy")
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--asset", required=True, help="asset directory, or a skeleton name resolved through --cond-path")
    ap.add_argument("--cond-path", action="append", default=[], help="conditioning file for named assets (repeatable)")
    ap.add_argument("--prompt", nargs="+", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out", required=True, help="fresh output directory")
    ap.add_argument("--compare-motions", nargs="*", default=[],
                    help="trace mode: reference .npy motions to compare with the upstream outputs, "
                         "in prompt order")
    args = ap.parse_args()

    if os.path.exists(args.out) and os.listdir(args.out):
        sys.exit(f"--out {args.out} exists and is not empty; use a fresh directory")
    os.makedirs(args.out, exist_ok=True)

    report = {
        "schema": "kaminos.unimate.reference-capture.v0",
        "mode": args.mode,
        "phase": "start",
        "argv": sys.argv,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python": sys.version,
        "platform": platform.platform(),
        "unimate_source": _git_rev(args.unimate_root),
        "inputs": {"model_path": os.path.abspath(args.model_path), "asset": os.path.abspath(args.asset) if os.path.isdir(args.asset) else args.asset,
                   "cond_path": [os.path.abspath(p) for p in args.cond_path],
                   "exp_dir": os.path.abspath(args.exp_dir), "prompts": args.prompt, "seed": args.seed},
        "artifacts": {},
    }
    report_path = os.path.join(args.out, "report.json")

    def write_report():
        report["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)

    write_report()
    try:
        report["phase"] = "hash-inputs"
        report["inputs"]["model_sha256"] = _sha256(args.model_path)
        report["inputs"]["config_sha256"] = _sha256(os.path.join(args.exp_dir, "config.json"))
        report["inputs"]["stats_sha256"] = _sha256(os.path.join(args.exp_dir, "dataset_stats.npy"))
        asset_cond = os.path.join(args.asset, "cond.npy") if os.path.isdir(args.asset) else None
        for path in ([asset_cond] if asset_cond else []) + args.cond_path:
            report["inputs"].setdefault("cond_sha256", {})[os.path.abspath(path)] = _sha256(path)
        write_report()

        report["phase"] = "import"
        import torch
        import torchdiffeq
        import unimate
        import unimate.inference.generate as G
        import unimate.inference.sample as S
        from torchdiffeq._impl import rk_common as RK

        if not os.path.abspath(unimate.__file__).startswith(os.path.abspath(args.unimate_root)):
            raise RuntimeError(f"unimate imported from {unimate.__file__}, not --unimate-root {args.unimate_root}")
        report["effective_route"] = {
            "unimate_module": unimate.__file__,
            "torch": torch.__version__,
            "torchdiffeq": getattr(torchdiffeq, "__version__", "unknown"),
            "torch_num_threads": torch.get_num_threads(),
            "device": "cpu",
        }
        write_report()

        captured = {"generate_calls": 0}
        evals = []        # (t, x, out) per CFG-combined drift evaluation
        steps = []        # one row per attempted adaptive step
        ratios = []       # error ratios in call order
        solver_meta = {}

        # ---- drift evaluations: the CFG wrapper is called once per evaluation
        orig_cfg_forward = G.ClassifierFreeSampleModel.forward

        def cfg_forward(self, x, timesteps, cond=None):
            out = orig_cfg_forward(self, x, timesteps, cond)
            if args.mode == "trace":
                evals.append((float(timesteps.reshape(-1)[0]), _np(x).astype(np.float32),
                              _np(out).astype(np.float32)))
            return out

        G.ClassifierFreeSampleModel.forward = cfg_forward

        # ---- solver controller
        orig_ratio = RK._compute_error_ratio

        def traced_ratio(*a, **k):
            r = orig_ratio(*a, **k)
            ratios.append(float(r))
            return r

        RK._compute_error_ratio = traced_ratio

        orig_first = RK._select_initial_step

        def traced_first(*a, **k):
            r = orig_first(*a, **k)
            solver_meta["first_step"] = float(r)
            solver_meta["first_step_dtype"] = str(r.dtype)
            return r

        RK._select_initial_step = traced_first

        orig_adaptive = RK.RKAdaptiveStepsizeODESolver._adaptive_step

        def traced_adaptive(self, rk_state):
            n_eval_before, n_ratio_before = len(evals), len(ratios)
            new_state = orig_adaptive(self, rk_state)
            steps.append({
                "t0": float(rk_state.t1), "dt": float(rk_state.dt),
                "accepted": bool(new_state.t1 != rk_state.t1),
                "t1_after": float(new_state.t1), "dt_next": float(new_state.dt),
                "error_ratio": ratios[-1] if len(ratios) > n_ratio_before else None,
                "evals": [n_eval_before, len(evals)],
            })
            if "rtol" not in solver_meta:
                solver_meta.update({
                    "solver": type(self).__name__, "rtol": float(self.rtol), "atol": float(self.atol),
                    "time_dtype": str(self.dtype), "state_dtype": str(self.y0.dtype),
                    "safety": float(self.safety), "ifactor": float(self.ifactor), "dfactor": float(self.dfactor),
                    "min_step": float(self.min_step), "max_step": float(self.max_step), "order": int(self.order),
                })
            return new_state

        RK.RKAdaptiveStepsizeODESolver._adaptive_step = traced_adaptive

        # ---- the generate call: capture conditioning and noise, optionally stop
        orig_generate = S.generate_samples
        orig_randn = torch.randn

        def generate_wrapper(**kw):
            captured["generate_calls"] += 1
            if captured["generate_calls"] > 1:
                raise RuntimeError("more than one generate_samples call; capture expects one chunk")
            cond, shape = kw["cond"], kw["motion_shape"]
            report["phase"] = "capture-conditioning"
            tensors = {k: _np(v) for k, v in cond.items() if torch.is_tensor(v)}
            others = {k: v for k, v in cond.items() if not torch.is_tensor(v)}
            np.savez(os.path.join(args.out, "cond.npz"), **tensors)
            with open(os.path.join(args.out, "cond-nontensor.json"), "w") as f:
                json.dump(others, f, indent=2, default=repr)
            report["conditioning"] = {
                "motion_shape": list(shape), "cfg_scale": kw["cfg_scale"], "diff_model": kw["diff_model"],
                "tensors": {k: {"shape": list(v.shape), "dtype": str(v.dtype)} for k, v in tensors.items()},
                "nontensor_keys": sorted(others),
            }
            report["artifacts"]["cond"] = "cond.npz"
            write_report()

            noise_box = {}

            def randn_capture(*a, **k):
                t = orig_randn(*a, **k)
                if "noise" not in noise_box and tuple(t.shape) == tuple(shape):
                    noise_box["noise"] = t.clone()
                return t

            if args.mode == "forward":
                report["phase"] = "forward"
                model = kw["model"]
                torch.randn = randn_capture
                try:
                    noise = torch.randn(shape, device="cpu")
                finally:
                    torch.randn = orig_randn
                acts = {}
                hooks = []
                n_valid = int(cond["n_joints"].max())

                def keep(name):
                    def hook(_m, _inp, out):
                        outs = out if isinstance(out, tuple) else (out,)
                        for i, o in enumerate(outs):
                            if torch.is_tensor(o):
                                a = _np(o).astype(np.float32)
                                # Slice the padded joint axis (max_joints) to valid joints.
                                for ax, n in enumerate(a.shape):
                                    if n == shape[1] and ax > 0:
                                        a = np.take(a, np.arange(n_valid), axis=ax)
                                        break
                                acts[f"{pass_name[0]}/{name}/{i}"] = a
                    return hook

                pass_name = ["cond"]
                for name in ["time_embedder", "cond_embedder", "input_layer", "tpos_pool",
                             "joint_name_embedder", "depth_embedding", "final_layer"]:
                    m = getattr(model, name, None)
                    if m is not None:
                        hooks.append(m.register_forward_hook(keep(name)))
                for i, blk in enumerate(model.transformer_blocks):
                    hooks.append(blk.register_forward_hook(keep(f"block{i:02d}")))
                t0 = torch.zeros(shape[0])
                with torch.no_grad():
                    out_c = model(noise, t0, cond)
                    pass_name[0] = "uncond"
                    out_u = model(noise, t0, cond, force_mask=True)
                for h in hooks:
                    h.remove()
                out_cfg = out_u + kw["cfg_scale"] * (out_c - out_u)
                np.savez(os.path.join(args.out, "forward.npz"), noise=_np(noise), t=_np(t0),
                         out_cond=_np(out_c), out_uncond=_np(out_u), out_cfg=_np(out_cfg))
                np.savez(os.path.join(args.out, "activations.npz"), **acts)
                report["forward"] = {
                    "t": 0.0, "n_valid_joints": n_valid,
                    "out_cond_absmax": float(out_c.abs().max()),
                    "out_cfg_absmax": float(out_cfg.abs().max()),
                    "padded_out_cfg_absmax": float(out_cfg[:, n_valid:].abs().max()) if shape[1] > n_valid else None,
                    "activation_keys": sorted(acts),
                }
                report["artifacts"].update({"forward": "forward.npz", "activations": "activations.npz"})
                write_report()
                raise _StopAfterForward()

            report["phase"] = "solve"
            write_report()
            torch.randn = randn_capture
            t_solve = time.perf_counter()
            try:
                samples = orig_generate(**kw)
            finally:
                torch.randn = orig_randn
            solve_s = time.perf_counter() - t_solve
            if "noise" not in noise_box:
                raise RuntimeError("initial noise of the motion shape was not observed")
            n_acc = sum(s["accepted"] for s in steps)
            ts = np.array([e[0] for e in evals], dtype=np.float64)
            np.savez(os.path.join(args.out, "trace.npz"), noise=_np(noise_box["noise"]),
                     eval_t=ts, eval_x=np.stack([e[1] for e in evals]), eval_out=np.stack([e[2] for e in evals]),
                     samples=_np(samples))
            with open(os.path.join(args.out, "steps.json"), "w") as f:
                json.dump({"solver": solver_meta, "steps": steps}, f, indent=2)
            report["trace"] = {
                "solve_seconds": solve_s, "drift_evaluations": len(evals), "model_forwards": 2 * len(evals),
                "attempted_steps": len(steps), "accepted_steps": n_acc, "rejected_steps": len(steps) - n_acc,
                "solver": solver_meta,
            }
            report["artifacts"].update({"trace": "trace.npz", "steps": "steps.json"})
            report["phase"] = "upstream-postprocess"
            write_report()
            return samples

        S.generate_samples = generate_wrapper

        report["phase"] = "upstream-main"
        write_report()
        inf_args = S.InferenceArgs(
            exp_dir=args.exp_dir, model_path=args.model_path, seed=args.seed,
            output_dir=os.path.join(args.out, "upstream"), asset=(args.asset,), prompt=tuple(args.prompt),
        cond_path=tuple(args.cond_path),
        )
        try:
            S.main(inf_args)
        except _StopAfterForward:
            report["phase"] = "done"
            report["result"] = "ok"
            write_report()
            return

        if args.compare_motions:
            report["phase"] = "compare"
            motion_dir = os.path.join(args.out, "upstream", "motions")
            produced = sorted(os.listdir(motion_dir))
            comparisons = []
            for ref in args.compare_motions:
                match = [p for p in produced if p == os.path.basename(ref)]
                if not match:
                    comparisons.append({"reference": ref, "error": "no output with the same file name"})
                    continue
                a, b = np.load(ref), np.load(os.path.join(motion_dir, match[0]))
                comparisons.append({
                    "reference": ref, "reference_sha256": _sha256(ref),
                    "ours": os.path.join(motion_dir, match[0]),
                    "ours_sha256": _sha256(os.path.join(motion_dir, match[0])),
                    "shape_equal": a.shape == b.shape,
                    "bitwise_equal": bool(a.shape == b.shape and np.array_equal(a, b)),
                    "max_abs_diff": float(np.abs(a - b).max()) if a.shape == b.shape else None,
                })
            report["comparison"] = comparisons
        report["phase"] = "done"
        report["result"] = "ok"
        write_report()
    except BaseException as exc:  # noqa: BLE001 - every failure gets a report
        report["result"] = "failed"
        report["error"] = {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}
        write_report()
        raise


if __name__ == "__main__":
    main()
