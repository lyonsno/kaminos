#!/usr/bin/env python3
"""Moment-tracking audit: does the local field centroid shift predict the
oracle's per-hop splat motion?

Successor to the advection audit (decisive negative: simulator velocity has
zero correlation with fitted-splat motion — render-loss refits re-explain the
field, they do not ride parcels). The next analytical candidate treats each
Gaussian as the local moments of the density lobe it explains: per frame,
recompute the density-weighted centroid of the LIVE field under the splat's
own kernel, and move the splat by the centroid shift. No gradients, no
rendering, local reductions only — live-budget shaped if it works.

Prediction per splat i between fitted states A -> B:
  centroid_S(field) = sum_x N(x; c_i, S_i) * rho_S(x) * x / (same weights)
  D_pred_i = centroid_B - centroid_A         (bias-corrected: both under the
                                              kernel anchored at c_i(A))
Compared against oracle motion D_i = c_i(B_fit) - c_i(A_fit) with the same
metrics as the advection audit: motion-weighted signed alignment, magnitude
ratio (raw — units are world, so ~1.0 means the mechanism is quantitatively
right), and relative residual vs the frozen (zero-motion) control.

Density scalar: ridge extinction (coefficient column 3) from the per-state
coefficients.f32 exports; ridge is the chain's fitted population.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

MANIFEST_ROOT = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-grid96-exact-motion-62-120-r41"
)
CHECKPOINTS = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-sjb-grid48-curriculum-r1/checkpoints"
)
GRID = 96
ORIGIN = np.array([-1.0, -1.0, -1.0])
SPACING = 0.020833334
RIDGE_EXTINCTION_COL = 3
MAX_RADIUS_CELLS = 8
MAHALANOBIS_CUT = 3.0


_PIPE = None
CACHE = Path("/private/tmp/claude-501/-Users-noahlyons-dev-kaminos/9e2df045-e7eb-43a9-adf9-9a4b2c68ee63/scratchpad/moment-audit-lattices")
CHAIN_RUNG = 48
SIGMA_CELLS = 0.6
FINE_GRID = 96


def _pipe():
    global _PIPE
    if _PIPE is None:
        import importlib.util, sys
        spec = importlib.util.spec_from_file_location(
            "pipe", Path(__file__).resolve().parent / "volume-longmotion-yielding-pipeline-mlx.py"
        )
        _PIPE = importlib.util.module_from_spec(spec)
        sys.modules["pipe"] = _PIPE
        spec.loader.exec_module(_PIPE)
    return _PIPE


def load_density(state_id: str) -> np.ndarray:
    """The EXACT lattice the chain fit optimized against: rung-48 restricted
    medium, Gaussian-splatted onto the fine 96 grid with sigma_cells=0.6."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{state_id}-rung{CHAIN_RUNG}-fine{FINE_GRID}.npy"
    if cached.is_file():
        return np.load(cached)
    pipe = _pipe()
    medium, _camera = pipe.PROBE.restricted_medium_for_state(
        MANIFEST_ROOT / "motion-manifest.json", state_id, CHAIN_RUNG, "ridge"
    )
    lattice, _r = pipe.TARGET.build_gaussian_density_lattice(
        medium, sigma_cells=SIGMA_CELLS, fine_grid=FINE_GRID
    )
    rho = np.maximum(np.asarray(lattice, dtype=np.float64), 0.0)
    if rho.ndim == 4:
        rho = rho.sum(axis=-1)
    np.save(cached, rho)
    return rho


def local_centroid(rho: np.ndarray, center_g: np.ndarray, cov_g: np.ndarray) -> np.ndarray | None:
    """Density-weighted centroid (grid coords) under a Gaussian kernel."""
    evals, _ = np.linalg.eigh(cov_g)
    radius = min(MAX_RADIUS_CELLS, max(2.0, MAHALANOBIS_CUT * float(np.sqrt(evals.max()))))
    lo = np.maximum(np.floor(center_g - radius).astype(int), 0)
    hi = np.minimum(np.ceil(center_g + radius).astype(int) + 1, GRID)
    if np.any(hi <= lo):
        return None
    xs, ys, zs = np.meshgrid(
        np.arange(lo[0], hi[0]), np.arange(lo[1], hi[1]), np.arange(lo[2], hi[2]),
        indexing="ij",
    )
    pts = np.stack([xs, ys, zs], axis=-1).reshape(-1, 3) + 0.5
    d = pts - center_g
    try:
        prec = np.linalg.inv(cov_g)
    except np.linalg.LinAlgError:
        return None
    m2 = np.einsum("ni,ij,nj->n", d, prec, d)
    kern = np.exp(-0.5 * np.clip(m2, 0.0, 40.0))
    kern[m2 > MAHALANOBIS_CUT**2] = 0.0
    w = kern * rho[xs.ravel(), ys.ravel(), zs.ravel()]
    total = w.sum()
    if total <= 1e-12:
        return None
    return (w[:, None] * pts).sum(axis=0) / total


def main() -> int:
    hop_files = sorted(CHECKPOINTS.glob("hop-*-state-*.json"))
    states = []
    for f in hop_files:
        payload = json.loads(f.read_text())
        sid = "coefficient-state-" + f.stem.split("-state-")[1]
        states.append((sid, {k: np.asarray(v) for k, v in payload.items()}))
    print(f"[moment-audit] {len(states)} fitted chain states loaded")

    all_pred, all_true = [], []
    per_hop = []
    skipped = 0
    for (sid_a, a), (sid_b, b) in zip(states[:-1], states[1:]):
        rho_a = load_density(sid_a)
        rho_b = load_density(sid_b)
        centers_g = (a["centers"] - ORIGIN) / SPACING
        covs_g = a["covariances"] / (SPACING * SPACING)
        true_d = (b["centers"] - a["centers"]) / SPACING  # cells
        pred_d = np.full_like(true_d, np.nan)
        for i in range(centers_g.shape[0]):
            ca = local_centroid(rho_a, centers_g[i], covs_g[i])
            cb = local_centroid(rho_b, centers_g[i], covs_g[i])
            if ca is None or cb is None:
                skipped += 1
                continue
            pred_d[i] = cb - ca
        ok = ~np.isnan(pred_d[:, 0])
        per_hop.append((sid_a, sid_b, pred_d[ok], true_d[ok]))
        all_pred.append(pred_d[ok])
        all_true.append(true_d[ok])
    P = np.concatenate(all_pred)
    D = np.concatenate(all_true)
    print(f"[moment-audit] {P.shape[0]} splat-hops scored, {skipped} skipped (empty footprint)")

    def summarize(P: np.ndarray, D: np.ndarray, label: str) -> None:
        dn = np.linalg.norm(D, axis=1)
        pn = np.linalg.norm(P, axis=1)
        moved = dn > np.quantile(dn, 0.25)
        cos = (P * D).sum(1) / np.maximum(pn * dn, 1e-12)
        w = dn[moved]
        align = float((cos[moved] * w).sum() / w.sum())
        mag = float(pn[moved].mean() / dn[moved].mean())
        resid = float(np.linalg.norm(P - D, axis=1)[moved].mean() / dn[moved].mean())
        print(f"[moment-audit] {label}: signed alignment={align:+.3f}  magnitude ratio={mag:.3f}  "
              f"relative residual={resid:.3f}  (advection baseline: align 0.015; frozen residual: 1.000)")

    summarize(P, D, "ALL HOPS, motion-weighted")
    for sid_a, sid_b, p, d in per_hop:
        dn = np.linalg.norm(d, axis=1); pn = np.linalg.norm(p, axis=1)
        moved = dn > np.quantile(dn, 0.25)
        cos = (p * d).sum(1) / np.maximum(pn * dn, 1e-12)
        w = dn[moved]
        print(f"  {sid_a}->{sid_b}: align={float((cos[moved]*w).sum()/w.sum()):+.3f} "
              f"mag={float(pn[moved].mean()/dn[moved].mean()):.3f}")
    for ax, axn in enumerate("xyz"):
        print(f"[moment-audit] per-axis corr {axn}: {np.corrcoef(P[:, ax], D[:, ax])[0, 1]:+.3f}")
    dn = np.linalg.norm(D, axis=1)
    pn = np.linalg.norm(P, axis=1)
    print(f"[moment-audit] corr(|P|,|D|): {np.corrcoef(pn, dn)[0, 1]:+.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
