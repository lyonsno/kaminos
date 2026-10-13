"""Record torchdiffeq dopri5 on a small float32 ODE as a JS solver fixture.

The ODE is dy/dt = a * y + (b * t) * t + c, elementwise with fixed float32
coefficients. It uses only multiplies and adds, which are correctly rounded in
both torch and JS float32 emulation, so the drift itself is bit-identical and any
disagreement belongs to the solver. It is integrated over a 50-point float32 linspace from 0 to 1 with
the sampler's tolerances (rtol 1e-3, atol 1e-6). Two drift shapes are recorded,
one whose step size grows and one whose stiffness forces rejected steps.
Output: JSON with inputs, every drift evaluation time, every attempted step
and the solution at all output times.
"""

import json
import sys

import numpy as np
import torch
from torchdiffeq import odeint
from torchdiffeq._impl import rk_common as RK


def record(name, a_scale, n=257, seed=3):
    g = torch.Generator().manual_seed(seed)
    y0 = torch.randn(n, generator=g).float()
    a = (-torch.rand(n, generator=g) * a_scale).float()
    b = (torch.randn(n, generator=g) * 4).float()
    c = torch.randn(n, generator=g).float()
    evals, steps = [], []

    def f(t, y):
        evals.append({"t": float(t), "t_dtype": str(t.dtype)})
        return a * y + b * t * t + c

    orig = RK.RKAdaptiveStepsizeODESolver._adaptive_step

    def traced(self, st):
        new = orig(self, st)
        steps.append({"t0": float(st.t1), "dt": float(st.dt), "accepted": bool(new.t1 != st.t1), "dt_next": float(new.dt)})
        return new

    RK.RKAdaptiveStepsizeODESolver._adaptive_step = traced
    try:
        ts = torch.linspace(0, 1, 50)
        sol = odeint(f, y0, ts, method="dopri5", atol=[1e-6], rtol=[1e-3])
    finally:
        RK.RKAdaptiveStepsizeODESolver._adaptive_step = orig
    return {
        "name": name, "y0": y0.tolist(), "a": a.tolist(), "b": b.tolist(), "c": c.tolist(),
        "ts": ts.tolist(), "solution": sol.tolist(), "evals": evals, "steps": steps,
        "rejected": sum(not s["accepted"] for s in steps),
    }


cases = [record("mild", 2.0), record("stiff", 80.0)]
json.dump({"schema": "kaminos.unimate.dopri5-fixture.v0", "torch": torch.__version__, "cases": cases},
          open(sys.argv[1], "w"))
print({c["name"]: {"evals": len(c["evals"]), "steps": len(c["steps"]), "rejected": c["rejected"]} for c in cases})
