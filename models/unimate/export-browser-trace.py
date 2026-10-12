"""Convert a trace-mode reference capture into a browser solver fixture.

Slices the padded (B, 71, 12, 60) solver state to valid joints (padding
independence: probe-conditioning.py) and writes ``<out>/trace.bin`` plus
``<out>/trace.json``: initial noise, every drift evaluation's time, input and
CFG-combined output, the final samples, the attempted-step list, the selected
first step and the solver settings.
"""

import argparse
import hashlib
import json
import os

import math

import numpy as np


def _strict(v):
    """Non-finite floats as strings, so browsers can JSON.parse the index."""
    if isinstance(v, float) and not math.isfinite(v):
        return str(v)
    if isinstance(v, dict):
        return {k: _strict(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_strict(x) for x in v]
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", required=True, help="trace-mode capture directory")
    ap.add_argument("--exp-dir", required=True, help="experiment dir with the sampler's config.json")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    # The sampler's output-time grid, rebuilt with upstream code: the integration
    # interval from Transport.check_interval and the float32 linspace ode() uses.
    import torch
    from unimate.configs.schema import MainConfig
    from unimate.models.factory import create_transport
    config = MainConfig.from_json(os.path.join(args.exp_dir, "config.json"))
    transport = create_transport(training_config=config.training)
    t0, t1 = transport.check_interval(transport.train_eps, transport.sample_eps, sde=False, eval=True,
                                      reverse=False, last_step_size=0.0)
    output_times = torch.linspace(t0, t1, 50).tolist()

    tr = np.load(os.path.join(args.trace, "trace.npz"))
    steps = json.load(open(os.path.join(args.trace, "steps.json")))
    cond = np.load(os.path.join(args.trace, "cond.npz"))
    report = json.load(open(os.path.join(args.trace, "report.json")))
    n = cond["n_joints"]
    if not (n == n[0]).all():
        raise ValueError(f"expects one skeleton per batch, got {n.tolist()}")
    J = int(n[0])

    arrays = {
        "noise": tr["noise"][:, :J],
        "eval_t": tr["eval_t"].astype(np.float32),
        "eval_x": tr["eval_x"][:, :, :J],
        "eval_out": tr["eval_out"][:, :, :J],
        "samples": tr["samples"][:, :J],
        "padded_samples_absmax": np.array([np.abs(tr["samples"][:, J:]).max() if tr["samples"].shape[1] > J else 0.0],
                                          dtype=np.float32),
    }
    os.makedirs(args.out, exist_ok=True)
    entries, offset = [], 0
    with open(os.path.join(args.out, "trace.bin"), "wb") as f:
        for name, a in arrays.items():
            a = np.ascontiguousarray(a.astype("<f4"))
            pad = (-offset) % 256
            f.write(b"\0" * pad)
            offset += pad
            data = a.tobytes()
            f.write(data)
            entries.append({"name": name, "shape": list(a.shape), "dtype": "float32", "offset": offset, "byteLength": len(data)})
            offset += len(data)
    index = {
        "schema": "kaminos.unimate.browser-trace.v0",
        "trace": os.path.abspath(args.trace),
        "capture_inputs": report.get("inputs"),
        "capture_route": report.get("effective_route"),
        "trace_summary": report.get("trace"),
        "n_joints": J,
        "eval_t_float64": tr["eval_t"].tolist(),
        "interval": [float(t0), float(t1)],
        "output_times": output_times,
        "solver": steps["solver"],
        "steps": steps["steps"],
        "sha256": hashlib.sha256(open(os.path.join(args.out, "trace.bin"), "rb").read()).hexdigest(),
        "arrays": entries,
    }
    with open(os.path.join(args.out, "trace.json"), "w") as f:
        json.dump(_strict(index), f, indent=2, allow_nan=False)
    print(f"{len(steps['steps'])} steps, {tr['eval_t'].shape[0]} evaluations, valid joints {J}, {offset} bytes")


if __name__ == "__main__":
    main()
