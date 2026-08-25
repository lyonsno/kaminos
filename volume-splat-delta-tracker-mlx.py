#!/usr/bin/env python3
"""Render-loss delta tracker (v1): a small shared-weight MLP that updates a
fitted splat population toward the next frame's field, trained ONLY through
rendered image loss.

Why this exists (campaign evidence, 2026-08-23): per-splat oracle motion is
gauge-dominated — advection predicts none of it (align 0.015), local moment
shifts predict a sliver (align 0.146, magnitudes 9x small), and even in render
space the analytical moment update recovers only ~15% of the frozen->oracle
gap. The lawful objective is render fidelity, so the network trains through
the renderer: MLP weights are the optimized leaves, splat parameters are an
intermediate activation. Per-splat delta supervision would learn gauge noise
and is deliberately absent.

Model: per-splat features (local stencils of the next field and the field
delta + the splat's own raw parameters) -> deltas on RAW fit parameters
(centers, rawCholesky, rawEmission, rawExtinction). The final layer is
zero-initialized: an untrained tracker is exactly the frozen arm, so training
can only improve on the measured floor.

The render graph (decode / chunked forward march) mirrors the oracle fitter's
graph without the anchor/background/confinement arms the tracker does not
need; evaluation comparability lives in the shared render-space audit, not in
loss-term parity.
"""
from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent

STENCIL_OFFSETS = np.array(
    [(dx, dy, dz) for dx in (-2, 0, 2) for dy in (-2, 0, 2) for dz in (-2, 0, 2)],
    dtype=np.float64,
)
FEATURE_DIM = 27 + 27 + 12
OUTPUT_DIM = 3 + 6 + 3 + 1
HIDDEN = 128
CENTER_DELTA_SCALE_CELLS = 2.0   # max useful center move per frame, in cells
RAW_DELTA_SCALE = 0.1            # scale for raw cholesky/emission/extinction deltas
TRIL_INDICES = np.tril_indices(3)


def _load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_ORACLE = None


def _oracle() -> Any:
    global _ORACLE
    if _ORACLE is None:
        _ORACLE = _load_module("delta_tracker_oracle", "volume-grid16-ceiling-oracle-mlx.py")
    return _ORACLE


def state_to_raw_np(state: dict[str, np.ndarray], medium: Any) -> dict[str, np.ndarray]:
    return _oracle().state_to_raw(state, medium)


def raw_to_state_np(raw: dict[str, np.ndarray], medium: Any) -> dict[str, np.ndarray]:
    return _oracle().raw_to_state(raw, medium)


@dataclass
class TrainingPair:
    id_a: str
    id_b: str
    state_a: dict[str, np.ndarray]
    lattice_a: np.ndarray
    lattice_b: np.ndarray
    medium: Any


def _lattice_lookup(lattice: np.ndarray, cells: np.ndarray) -> np.ndarray:
    grid = lattice.shape[0]
    idx = np.clip(np.round(cells).astype(int), 0, grid - 1)
    return lattice[idx[:, 0], idx[:, 1], idx[:, 2]]


def splat_features(
    state_a: dict[str, np.ndarray],
    lattice_a: np.ndarray,
    lattice_b: np.ndarray,
    medium: Any,
) -> np.ndarray:
    """Per-splat feature rows: next-field stencil, field-delta stencil, raw params."""
    def scalar(lat: np.ndarray) -> np.ndarray:
        lat = np.asarray(lat, dtype=np.float64)
        return lat.sum(axis=-1) if lat.ndim == 4 else lat

    lattice_a = scalar(lattice_a)
    lattice_b = scalar(lattice_b)
    fine = lattice_b.shape[0]
    origin = np.asarray(medium.origin, dtype=np.float64)
    extent = np.asarray(medium.source_spacing, dtype=np.float64) * medium.source_grid
    cell = extent / fine
    centers = np.asarray(state_a["centers"], dtype=np.float64)
    grid_pos = (centers - origin) / cell - 0.5
    n = centers.shape[0]
    stencil = grid_pos[:, None, :] + STENCIL_OFFSETS[None, :, :]
    flat = stencil.reshape(-1, 3)
    rho_b = _lattice_lookup(lattice_b, flat).reshape(n, -1)
    rho_a = _lattice_lookup(lattice_a, flat).reshape(n, -1)
    scale = max(float(np.abs(lattice_b).max()), 1e-9)
    raw = state_to_raw_np(state_a, medium)
    frac = grid_pos - np.floor(grid_pos)
    diag = raw["rawCholesky"][:, np.arange(3), np.arange(3)]
    parts = [
        rho_b / scale,
        (rho_b - rho_a) / scale,
        frac,
        diag,
        raw["rawEmission"],
        raw["rawExtinction"][:, None],
        _lattice_lookup(lattice_a, grid_pos)[:, None] / scale,
        _lattice_lookup(lattice_b, grid_pos)[:, None] / scale,
    ]
    features = np.concatenate(parts, axis=1)
    assert features.shape == (n, FEATURE_DIM), features.shape
    return features


class DeltaTracker:
    """Two-hidden-layer MLP with a zero-initialized output layer."""

    def __init__(self, feature_dim: int, seed: int, weights: dict | None = None):
        import mlx.core as mx

        if weights is not None:
            self.weights = weights
            return
        rng = np.random.default_rng(seed)

        def dense(n_in, n_out, zero=False):
            if zero:
                w = np.zeros((n_in, n_out))
            else:
                w = rng.normal(0.0, np.sqrt(2.0 / n_in), size=(n_in, n_out))
            return mx.array(w.astype(np.float32)), mx.array(np.zeros(n_out, dtype=np.float32))

        w1, b1 = dense(feature_dim, HIDDEN)
        w2, b2 = dense(HIDDEN, HIDDEN)
        w3, b3 = dense(HIDDEN, OUTPUT_DIM, zero=True)
        self.weights = {"w1": w1, "b1": b1, "w2": w2, "b2": b2, "w3": w3, "b3": b3}

    @staticmethod
    def forward(weights: dict, x):
        import mlx.core as mx
        import mlx.nn as mlx_nn

        h = mlx_nn.silu(x @ weights["w1"] + weights["b1"])
        h = mlx_nn.silu(h @ weights["w2"] + weights["b2"])
        return h @ weights["w3"] + weights["b3"]


def _apply_deltas_mx(raw_params: dict, deltas, cell_world: float):
    """Split MLP outputs into scaled raw-parameter updates (MLX graph)."""
    import mlx.core as mx

    d_center = deltas[:, 0:3] * (CENTER_DELTA_SCALE_CELLS * cell_world)
    d_chol_flat = deltas[:, 3:9] * RAW_DELTA_SCALE
    d_emission = deltas[:, 9:12] * RAW_DELTA_SCALE
    d_extinction = deltas[:, 12] * RAW_DELTA_SCALE
    n = d_center.shape[0]
    chol_delta = mx.zeros((n, 3, 3))
    rows, cols = TRIL_INDICES
    for k, (r, c) in enumerate(zip(rows.tolist(), cols.tolist())):
        basis = np.zeros((3, 3), dtype=np.float32)
        basis[r, c] = 1.0
        chol_delta = chol_delta + d_chol_flat[:, k][:, None, None] * mx.array(basis)[None, :, :]
    return {
        "centers": raw_params["centers"] + d_center,
        "rawCholesky": raw_params["rawCholesky"] + chol_delta,
        "rawEmission": raw_params["rawEmission"] + d_emission,
        "rawExtinction": raw_params["rawExtinction"] + d_extinction,
    }


def apply_tracker_np(model: DeltaTracker, features: np.ndarray, raw: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    import mlx.core as mx

    raw_mx = {k: mx.array(np.asarray(v, dtype=np.float32)) for k, v in raw.items()}
    deltas = DeltaTracker.forward(model.weights, mx.array(features.astype(np.float32)))
    updated = _apply_deltas_mx(raw_mx, deltas, cell_world=1.0)
    return {k: np.asarray(updated[k], dtype=np.float64) for k in updated}


def _build_pair_render(pair: TrainingPair, cameras: list[dict], fit_width: int, fit_samples_per_cell: int):
    """Precompute rays and target renders for one pair (numpy, once)."""
    import mlx.core as mx

    oracle = _oracle()
    medium = pair.medium
    sample_count = medium.grid * fit_samples_per_cell
    fine_step_world = float(np.mean(medium.source_spacing))
    fractions = (np.arange(sample_count, dtype=np.float64) + 0.5) / sample_count
    batches = []
    for camera in cameras:
        rays = oracle.camera_rays(medium, camera, width=fit_width)
        target_linear, _t, _r = oracle.TARGET.march_density_lattice(
            pair.lattice_b, medium, camera,
            width=fit_width, samples_per_cell=fit_samples_per_cell,
        )
        hit = rays["far"] > rays["near"]
        distances = rays["near"][:, None] + (rays["far"] - rays["near"])[:, None] * fractions[None, :]
        points = rays["origins"][:, None, :] + rays["directions"][:, None, :] * distances[..., None]
        segment = np.where(hit, (rays["far"] - rays["near"]) / sample_count / fine_step_world, 0.0)
        batches.append({
            "points": mx.array(points.astype(np.float32)),
            "segment": mx.array(segment.astype(np.float32)),
            "target": mx.array(target_linear.reshape((-1, 3)).astype(np.float32)),
            "height": rays["height"],
            "width": rays["width"],
        })
    return batches


def _decode_mx(params: dict, covariance_floor: float):
    import mlx.core as mx
    import mlx.nn as mlx_nn

    tril_mask = mx.array(np.tril(np.ones((3, 3), dtype=np.float32)))
    eye3 = mx.array(np.eye(3, dtype=np.float32))
    raw_chol = params["rawCholesky"] * tril_mask[None, :, :]
    diagonal = mlx_nn.softplus(mx.diagonal(params["rawCholesky"], axis1=1, axis2=2))
    cholesky = raw_chol - raw_chol * eye3[None, :, :] + diagonal[:, :, None] * eye3[None, :, :]
    covariance = cholesky @ mx.transpose(cholesky, (0, 2, 1)) + covariance_floor * eye3[None, :, :]
    a = covariance[:, 0, 0]; b = covariance[:, 0, 1]; c = covariance[:, 0, 2]
    d = covariance[:, 1, 1]; e = covariance[:, 1, 2]; f = covariance[:, 2, 2]
    determinant = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c)
    inverse_det = 1.0 / mx.maximum(determinant, 1e-20)
    p00 = (d * f - e * e) * inverse_det
    p01 = (c * e - b * f) * inverse_det
    p02 = (b * e - c * d) * inverse_det
    p11 = (a * f - c * c) * inverse_det
    p12 = (b * c - a * e) * inverse_det
    p22 = (a * d - b * b) * inverse_det
    precision = mx.stack(
        (mx.stack((p00, p01, p02), axis=1),
         mx.stack((p01, p11, p12), axis=1),
         mx.stack((p02, p12, p22), axis=1)),
        axis=1,
    )
    norm = (2.0 * np.pi) ** -1.5 * mx.rsqrt(mx.maximum(determinant, 1e-20))
    emission = mlx_nn.softplus(params["rawEmission"])
    extinction = mlx_nn.softplus(params["rawExtinction"])
    return params["centers"], precision, norm, emission, extinction


def _render_mx(points, segment, centers, precision, norm, emission, extinction, source_cell_volume, ray_chunk):
    import mlx.core as mx

    outputs = []
    ray_count = points.shape[0]
    for start in range(0, ray_count, ray_chunk):
        stop = min(start + ray_chunk, ray_count)
        p = points[start:stop]
        s = segment[start:stop]
        delta = p[:, :, None, :] - centers[None, None, :, :]
        mahalanobis = mx.einsum("rsmi,mij,rsmj->rsm", delta, precision, delta)
        kernel = norm[None, None, :] * mx.exp(-0.5 * mahalanobis) * source_cell_volume
        emission_field = kernel @ emission
        extinction_field = kernel @ extinction
        optical_depth = extinction_field * s[:, None]
        cumulative = mx.cumsum(optical_depth, axis=1)
        transmittance = mx.exp(-(cumulative - optical_depth))
        alpha = 1.0 - mx.exp(-optical_depth)
        source_scale = mx.where(
            optical_depth > 1e-8, alpha / mx.maximum(optical_depth, 1e-12), mx.ones_like(optical_depth)
        )
        weighted = transmittance * source_scale * s[:, None]
        outputs.append(mx.sum(weighted[:, :, None] * emission_field, axis=1))
    return mx.concatenate(outputs, axis=0)


def train(
    *,
    pairs: list[TrainingPair],
    cameras: list[dict],
    fit_width: int,
    fit_samples_per_cell: int,
    iterations: int,
    learning_rate: float,
    seed: int,
    checkpoint_path: Path,
    high_frequency_weight: float = 4.0,
    ray_chunk: int = 4096,
    yield_pending_dir: Path | None = None,
    yield_min_seconds: float = 120.0,
    on_yield=None,
    log_every: int = 10,
) -> dict[str, Any]:
    import mlx.core as mx
    import mlx.optimizers as optim

    model = DeltaTracker(FEATURE_DIM, seed)
    start_step = 0
    loaded_opt = None
    checkpoint_path = Path(checkpoint_path)
    if checkpoint_path.is_file():
        archive = np.load(checkpoint_path)
        start_step = int(archive["__step__"])
        model.weights = {
            k[len("weight."):]: mx.array(archive[k]) for k in archive.files if k.startswith("weight.")
        }
        loaded_opt = {k[len("opt."):]: archive[k] for k in archive.files if k.startswith("opt.")}

    prepared = []
    for pair in pairs:
        raw = state_to_raw_np(pair.state_a, pair.medium)
        features = splat_features(pair.state_a, pair.lattice_a, pair.lattice_b, pair.medium)
        batches = _build_pair_render(pair, cameras, fit_width, fit_samples_per_cell)
        n_modes = raw["centers"].shape[0]
        sample_count = pair.medium.grid * fit_samples_per_cell
        chunk = max(256, min(ray_chunk, int(2.4e7 / max(sample_count * n_modes, 1))))
        prepared.append({
            "raw": {k: mx.array(np.asarray(v, dtype=np.float32)) for k, v in raw.items()},
            "features": mx.array(features.astype(np.float32)),
            "batches": batches,
            "floor": (0.3 * float(np.mean(pair.medium.spacing))) ** 2,
            "cell": float(np.mean(np.asarray(pair.medium.source_spacing) * pair.medium.source_grid)) / pair.lattice_b.shape[0],
            "volume": float(np.prod(pair.medium.source_spacing)),
            "chunk": chunk,
        })

    # All pairs in a run share medium geometry and camera dims; the compiled
    # step relies on that so ONE traced graph serves every (pair, camera).
    floors = {prep["floor"] for prep in prepared}
    cells = {prep["cell"] for prep in prepared}
    volumes = {prep["volume"] for prep in prepared}
    chunks = {prep["chunk"] for prep in prepared}
    dims = {(b["height"], b["width"]) for prep in prepared for b in prep["batches"]}
    assert len(floors) == len(cells) == len(volumes) == len(chunks) == len(dims) == 1,         "pairs disagree on medium/camera constants; compiled step requires uniformity"
    floor_c = floors.pop(); cell_c = cells.pop(); volume_c = volumes.pop(); chunk_c = chunks.pop()
    (img_h, img_w) = dims.pop()

    def loss_fn(weights, features, raw_centers, raw_chol, raw_emission, raw_extinction,
                points, segment, target):
        deltas = DeltaTracker.forward(weights, features)
        raw = {"centers": raw_centers, "rawCholesky": raw_chol,
               "rawEmission": raw_emission, "rawExtinction": raw_extinction}
        params = _apply_deltas_mx(raw, deltas, cell_world=cell_c)
        centers, precision, norm, emission, extinction = _decode_mx(params, floor_c)
        predicted = _render_mx(
            points, segment, centers, precision, norm,
            emission, extinction, volume_c, chunk_c,
        )
        loss = mx.mean(mx.abs(predicted - target)) + 0.25 * mx.mean(mx.square(predicted - target))
        if high_frequency_weight > 0.0:
            pred_img = predicted.reshape((img_h, img_w, 3))
            targ_img = target.reshape((img_h, img_w, 3))
            dx = mx.abs((pred_img[:, 1:] - pred_img[:, :-1]) - (targ_img[:, 1:] - targ_img[:, :-1]))
            dy = mx.abs((pred_img[1:] - pred_img[:-1]) - (targ_img[1:] - targ_img[:-1]))
            loss = loss + high_frequency_weight * (mx.mean(dx) + mx.mean(dy))
        return loss

    loss_and_grad = mx.value_and_grad(loss_fn)
    optimizer = optim.Adam(learning_rate=learning_rate)
    optimizer.init(model.weights)
    if loaded_opt is not None:
        flat = optimizer.state
        for key, value in loaded_opt.items():
            node = flat
            parts = key.split("/")
            for part in parts[:-1]:
                node = node[part]
            node[parts[-1]] = mx.array(value)

    def save(step: int) -> None:
        payload = {"__step__": np.asarray(step)}
        for k, v in model.weights.items():
            payload[f"weight.{k}"] = np.asarray(v)

        def walk(node, prefix):
            if isinstance(node, dict):
                for k, v in node.items():
                    walk(v, f"{prefix}/{k}" if prefix else str(k))
            else:
                try:
                    payload[f"opt.{prefix}"] = np.asarray(node)
                except Exception:
                    pass

        walk(optimizer.state, "")
        tmp = checkpoint_path.with_suffix(".tmp.npz")
        np.savez(tmp, **payload)
        tmp.replace(checkpoint_path)

    from functools import partial

    compile_state = [model.weights, optimizer.state]

    @partial(mx.compile, inputs=compile_state, outputs=compile_state)
    def train_step(features, raw_centers, raw_chol, raw_emission, raw_extinction,
                   points, segment, target):
        loss, gradients = loss_and_grad(
            model.weights, features, raw_centers, raw_chol, raw_emission,
            raw_extinction, points, segment, target,
        )
        optimizer.update(model.weights, gradients)
        return loss

    import time as _time
    residency_start = _time.monotonic()
    losses: list[float] = []
    finished = True
    for step in range(start_step, iterations):
        prep = prepared[step % len(prepared)]
        batch = prep["batches"][(step // len(prepared)) % len(prep["batches"])]
        raw = prep["raw"]
        loss = train_step(
            prep["features"], raw["centers"], raw["rawCholesky"],
            raw["rawEmission"], raw["rawExtinction"],
            batch["points"], batch["segment"], batch["target"],
        )
        mx.eval(compile_state)
        losses.append(float(loss))
        if (step + 1) % log_every == 0 or step == start_step:
            print(f"[tracker] step {step + 1}/{iterations} loss {losses[-1]:.6f}", flush=True)
        if (
            yield_pending_dir is not None
            and step + 1 > start_step
            and (_time.monotonic() - residency_start) >= yield_min_seconds
            and any(Path(yield_pending_dir).iterdir())
        ):
            save(step + 1)
            print(f"[tracker] YIELDING at step {step + 1}/{iterations}", flush=True)
            finished = False
            if on_yield is not None:
                on_yield()
            break
    else:
        save(iterations)

    return {
        "finished": finished,
        "losses": losses,
        "startStep": start_step,
        "completedSteps": start_step + len(losses),
        "weights": {k: np.asarray(v) for k, v in model.weights.items()},
    }
