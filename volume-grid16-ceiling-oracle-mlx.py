#!/usr/bin/env python3
"""Differentiable representational-ceiling oracle for the restricted Grid16 flame.

Fits N fully free anisotropic Gaussian modes (center, covariance, RGB emission,
extinction) directly against the frozen sigma=0.6 Gaussian-basis target contract
by gradient descent through per-ray emission-absorption transport. This is an
exact-teacher oracle in the standing idiom: target-conditioned, no production
authority, no deployability claim. Its sole question is capacity: can N free
modes carry the coarse flame organization at all?

Contract choices that keep the comparison lawful:
- The loss marches the Gaussian mixture per ray with the same segment law used
  by the target march. No rasterizer appears anywhere in the loss.
- The target lattice identity is SHA-bound before and after fitting.
- Coefficients are nonnegative by construction (softplus); covariances are SPD
  by construction (Cholesky factors with positive diagonals).
- Multi-camera orbit supervision prevents single-view occlusion cheating.
- Final evaluation renders through the standing nondifferentiable marcher at
  full contract resolution, never through the fitting-resolution loss path.
"""

from __future__ import annotations

import argparse
from functools import partial
import hashlib
import importlib.util
import json
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent

ORACLE_IDENTITY = "grid16-differentiable-ceiling-oracle-v0"
FIT_MARCH_IDENTITY = "differentiable-mixture-native-step-raymarch-v0"


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


TARGET = load_module("target_contract_oracle", "volume-grid16-reconstruction-target-contract.py")
FITTER = TARGET.FITTER
require = FITTER.require


def lattice_digest(lattice: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(lattice, dtype=np.float64).tobytes()).hexdigest()


def require_lattice_identity(lattice: np.ndarray, expected: str) -> None:
    require(lattice_digest(lattice) == expected, "target lattice identity drifted during fitting")


def orbit_cameras(
    camera: dict[str, Any],
    *,
    count: int | None = None,
    pivot: np.ndarray | None = None,
    angles_degrees: list[float] | None = None,
) -> list[dict[str, Any]]:
    pose = camera["cameraPose"]
    position = np.asarray(pose["position"], dtype=np.float64)
    target = np.asarray(pose["target"], dtype=np.float64)
    # Review finding F1: the orbit must pivot about the volume center, not the
    # operator's arbitrary look-at framing point; the two only coincide by luck.
    pivot_point = target if pivot is None else np.asarray(pivot, dtype=np.float64)
    if angles_degrees is None:
        require(count is not None and count >= 1, "camera count must be positive")
        angles = [2.0 * np.pi * index / count for index in range(count)]
    else:
        require(len(angles_degrees) >= 1, "camera angle list must not be empty")
        angles = [np.deg2rad(value) for value in angles_degrees]
    cameras = []
    for angle in angles:
        cos, sin = np.cos(angle), np.sin(angle)
        offset = position - pivot_point
        rotated = np.asarray(
            (
                cos * offset[0] + sin * offset[2],
                offset[1],
                -sin * offset[0] + cos * offset[2],
            )
        )
        target_offset = target - pivot_point
        rotated_target = np.asarray(
            (
                cos * target_offset[0] + sin * target_offset[2],
                target_offset[1],
                -sin * target_offset[0] + cos * target_offset[2],
            )
        )
        cameras.append(
            {
                **camera,
                "cameraPose": {
                    **pose,
                    "position": (pivot_point + rotated).tolist(),
                    "target": (pivot_point + rotated_target).tolist(),
                },
            }
        )
    return cameras


def require_cameras_see_medium(cameras: list[dict[str, Any]], medium: Any) -> None:
    lower = medium.origin
    upper = medium.origin + medium.source_spacing * medium.source_grid
    for index, camera in enumerate(cameras):
        pose = camera["cameraPose"]
        origin = np.asarray(pose["position"], dtype=np.float64)[None, :]
        direction = np.asarray(pose["target"], dtype=np.float64)[None, :] - origin
        norm = np.linalg.norm(direction)
        require(norm > 1e-9, f"camera {index} has a degenerate view direction")
        near, far = FITTER.ray_box_intersection(origin, direction / norm, lower, upper)
        require(bool(far[0] > near[0]), f"camera {index} central ray misses the medium bounds")


def camera_rays(medium: Any, camera: dict[str, Any], *, width: int) -> dict[str, np.ndarray]:
    resized, position, forward, right, up = FITTER.camera_basis(camera, width)
    height = int(resized["height"])
    projection = np.asarray(camera["cameraPose"]["projectionMatrix"], dtype=np.float64).reshape(4, 4, order="F")
    pixel_x = (np.arange(width, dtype=np.float64) + 0.5) / width * 2.0 - 1.0
    pixel_y = 1.0 - (np.arange(height, dtype=np.float64) + 0.5) / height * 2.0
    ndc_x, ndc_y = np.meshgrid(pixel_x, pixel_y)
    directions = (
        forward[None, None, :]
        + right[None, None, :] * (ndc_x[..., None] / float(projection[0, 0]))
        + up[None, None, :] * (ndc_y[..., None] / float(projection[1, 1]))
    )
    directions /= np.linalg.norm(directions, axis=2, keepdims=True)
    flat_directions = directions.reshape((-1, 3))
    flat_origins = np.repeat(position[None, :], flat_directions.shape[0], axis=0)
    lower = medium.origin
    upper = medium.origin + medium.source_spacing * medium.source_grid
    near, far = FITTER.ray_box_intersection(flat_origins, flat_directions, lower, upper)
    return {
        "origins": flat_origins,
        "directions": flat_directions,
        "near": near,
        "far": np.maximum(far, near),
        "width": width,
        "height": height,
    }


def analytical_seed_state(medium: Any, *, mode_count: int, seed: int) -> dict[str, np.ndarray]:
    weights = FITTER.optical_weight(medium.coefficients)
    order = FITTER.deterministic_seeds(medium.positions, weights, mode_count)
    centers = medium.positions[order].copy()
    spacing = float(np.mean(medium.spacing))
    covariances = np.repeat(np.eye(3)[None, :, :] * (0.75 * spacing) ** 2, mode_count, axis=0)
    assignment = np.argmin(
        np.sum(np.square(medium.positions[:, None, :] - centers[None, :, :]), axis=2),
        axis=1,
    )
    emission = np.zeros((mode_count, 3), dtype=np.float64)
    extinction = np.zeros(mode_count, dtype=np.float64)
    for mode in range(mode_count):
        rows = assignment == mode
        if np.any(rows):
            emission[mode] = np.sum(medium.coefficients[rows, :3], axis=0)
            extinction[mode] = np.sum(medium.coefficients[rows, 3], axis=0)
    return {"centers": centers, "covariances": covariances, "emission": emission, "extinction": extinction}


def random_seed_state(medium: Any, *, mode_count: int, seed: int) -> dict[str, np.ndarray]:
    generator = np.random.default_rng(seed)
    weights = FITTER.optical_weight(medium.coefficients)
    probability = weights / np.sum(weights)
    picks = generator.choice(medium.positions.shape[0], size=mode_count, replace=False, p=probability)
    spacing = float(np.mean(medium.spacing))
    jitter = generator.normal(scale=0.35 * spacing, size=(mode_count, 3))
    centers = medium.positions[picks] + jitter
    covariances = np.repeat(np.eye(3)[None, :, :] * (0.9 * spacing) ** 2, mode_count, axis=0)
    total_emission = np.sum(medium.coefficients[:, :3], axis=0)
    total_extinction = float(np.sum(medium.coefficients[:, 3]))
    emission = np.repeat(total_emission[None, :] / mode_count, mode_count, axis=0)
    extinction = np.full(mode_count, total_extinction / mode_count)
    return {"centers": centers, "covariances": covariances, "emission": emission, "extinction": extinction}


def softplus_inverse(value: np.ndarray) -> np.ndarray:
    clipped = np.maximum(value, 1e-10)
    return clipped + np.log1p(-np.exp(-clipped))


def state_to_raw(state: dict[str, np.ndarray], medium: Any) -> dict[str, np.ndarray]:
    covariances = np.asarray(state["covariances"], dtype=np.float64)
    cholesky = np.linalg.cholesky(covariances)
    diag_indices = np.arange(3)
    raw_chol = cholesky.copy()
    raw_chol[:, diag_indices, diag_indices] = softplus_inverse(cholesky[:, diag_indices, diag_indices])
    return {
        "centers": np.asarray(state["centers"], dtype=np.float64),
        "rawCholesky": raw_chol,
        "rawEmission": softplus_inverse(np.asarray(state["emission"], dtype=np.float64)),
        "rawExtinction": softplus_inverse(np.asarray(state["extinction"], dtype=np.float64)),
    }


def raw_to_state(raw: dict[str, np.ndarray], medium: Any) -> dict[str, np.ndarray]:
    raw_chol = np.asarray(raw["rawCholesky"], dtype=np.float64)
    diag_indices = np.arange(3)
    cholesky = np.tril(raw_chol)
    cholesky[:, diag_indices, diag_indices] = np.logaddexp(0.0, raw_chol[:, diag_indices, diag_indices])
    # Bandlimit floor: the sigma=0.6 target contract contains nothing sharper
    # than ~0.3 level-cells, so narrower kernels only alias and overflow.
    floor = (0.3 * float(np.mean(medium.spacing))) ** 2
    covariances = cholesky @ np.transpose(cholesky, (0, 2, 1)) + floor * np.eye(3)[None, :, :]
    return {
        "centers": np.asarray(raw["centers"], dtype=np.float64),
        "covariances": covariances,
        "emission": np.logaddexp(0.0, np.asarray(raw["rawEmission"], dtype=np.float64)),
        "extinction": np.logaddexp(0.0, np.asarray(raw["rawExtinction"], dtype=np.float64)),
    }


def fit_modes(
    medium: Any,
    target_lattice: np.ndarray,
    cameras: list[dict[str, Any]],
    *,
    mode_count: int,
    iterations: int,
    fit_width: int,
    fit_samples_per_cell: int,
    seed: int,
    init: str,
    learning_rate: float,
    ray_chunk: int = 4096,
    initial_state: dict[str, np.ndarray] | None = None,
    anchor_weight: float = 0.0,
    background_state: dict[str, np.ndarray] | None = None,
    confine_to_medium: bool = True,
    high_frequency_weight: float = 0.0,
) -> dict[str, Any]:
    import mlx.core as mx
    import mlx.nn as mlx_nn
    import mlx.optimizers as optim

    require(init in ("analytical", "random", "warm"), f"unknown init arm: {init}")
    require(init != "warm" or initial_state is not None, "warm init requires an explicit initial state")
    require(iterations > 0 and mode_count > 0, "iterations and mode count must be positive")
    digest = lattice_digest(target_lattice)

    if init == "warm":
        require(int(initial_state["centers"].shape[0]) == mode_count, "warm state mode count mismatch")
        seed_state = initial_state
    else:
        seed_state = (
            analytical_seed_state(medium, mode_count=mode_count, seed=seed)
            if init == "analytical"
            else random_seed_state(medium, mode_count=mode_count, seed=seed)
        )
    raw = state_to_raw(seed_state, medium)

    sample_count = medium.grid * fit_samples_per_cell
    # Bound the per-chunk kernel tensor (~100MB float32) as mode count and
    # sample depth grow with denser restriction rungs.
    ray_chunk = max(256, min(ray_chunk, int(2.4e7 / max(sample_count * mode_count, 1))))
    fine_step_world = float(np.mean(medium.source_spacing))
    source_cell_volume = float(np.prod(medium.source_spacing))
    fractions = (np.arange(sample_count, dtype=np.float64) + 0.5) / sample_count

    camera_batches = []
    target_images = []
    for camera in cameras:
        rays = camera_rays(medium, camera, width=fit_width)
        target_linear, _t, _receipt = TARGET.march_density_lattice(
            target_lattice,
            medium,
            camera,
            width=fit_width,
            samples_per_cell=fit_samples_per_cell,
        )
        hit = rays["far"] > rays["near"]
        distances = rays["near"][:, None] + (rays["far"] - rays["near"])[:, None] * fractions[None, :]
        points = rays["origins"][:, None, :] + rays["directions"][:, None, :] * distances[..., None]
        segment = np.where(hit, (rays["far"] - rays["near"]) / sample_count / fine_step_world, 0.0)
        camera_batches.append(
            {
                "height": rays["height"],
                "width": rays["width"],
                "points": mx.array(points.astype(np.float32)),
                "segment": mx.array(segment.astype(np.float32)),
                "target": mx.array(
                    target_linear.reshape((-1, 3)).astype(np.float32)
                ),
                "rayCount": points.shape[0],
            }
        )
        target_images.append(target_linear)

    image_dims = {(batch["height"], batch["width"]) for batch in camera_batches}
    require(len(image_dims) == 1, "fit cameras disagree on image dimensions")
    (image_height, image_width) = next(iter(image_dims))
    parameters = {
        "centers": mx.array(raw["centers"].astype(np.float32)),
        "rawCholesky": mx.array(raw["rawCholesky"].astype(np.float32)),
        "rawEmission": mx.array(raw["rawEmission"].astype(np.float32)),
        "rawExtinction": mx.array(raw["rawExtinction"].astype(np.float32)),
    }
    covariance_floor = (0.3 * float(np.mean(medium.spacing))) ** 2
    tril_mask = mx.array(np.tril(np.ones((3, 3), dtype=np.float32)))
    eye3 = mx.array(np.eye(3, dtype=np.float32))
    anchor_reference = {key: mx.array(np.asarray(value)) for key, value in parameters.items()}
    box_lower = medium.origin
    box_upper = medium.origin + medium.source_spacing * medium.source_grid
    box_mid = mx.array(((box_lower + box_upper) / 2.0).astype(np.float32))
    box_half = mx.array(((box_upper - box_lower) / 2.0).astype(np.float32))
    confinement_scale = float(np.mean(medium.spacing))
    width_cap = float(3.0 * (8.0 * np.mean(medium.spacing)) ** 2)

    # Frozen background mixture (hierarchical residual fitting): densities are
    # additive before transport, so a coarser level's solution enters the
    # forward march as constant emission/extinction fields with no gradients.
    background = None
    if background_state is not None:
        bg_covariances = np.asarray(background_state["covariances"], dtype=np.float64)
        bg_precision = np.linalg.inv(bg_covariances)
        bg_norm = (2.0 * np.pi) ** -1.5 / np.sqrt(
            np.maximum(np.linalg.det(bg_covariances), 1e-20)
        )
        background = {
            "centers": mx.array(np.asarray(background_state["centers"], dtype=np.float32)),
            "precision": mx.array(bg_precision.astype(np.float32)),
            "norm": mx.array(bg_norm.astype(np.float32)),
            "emission": mx.array(np.asarray(background_state["emission"], dtype=np.float32)),
            "extinction": mx.array(np.asarray(background_state["extinction"], dtype=np.float32)),
        }

    def decode(params: dict[str, Any]) -> tuple[Any, Any, Any, Any]:
        raw_chol = params["rawCholesky"] * tril_mask[None, :, :]
        diagonal = mlx_nn.softplus(mx.diagonal(params["rawCholesky"], axis1=1, axis2=2))
        cholesky = raw_chol - raw_chol * eye3[None, :, :] + diagonal[:, :, None] * eye3[None, :, :]
        covariance = cholesky @ mx.transpose(cholesky, (0, 2, 1)) + covariance_floor * eye3[None, :, :]
        # Closed-form symmetric 3x3 inverse: MLX has no VJP for linalg.inv, and
        # the adjugate-over-determinant form is elementwise-differentiable.
        a = covariance[:, 0, 0]
        b = covariance[:, 0, 1]
        c = covariance[:, 0, 2]
        d = covariance[:, 1, 1]
        e = covariance[:, 1, 2]
        f = covariance[:, 2, 2]
        determinant = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c)
        inverse_det = 1.0 / mx.maximum(determinant, 1e-20)
        p00 = (d * f - e * e) * inverse_det
        p01 = (c * e - b * f) * inverse_det
        p02 = (b * e - c * d) * inverse_det
        p11 = (a * f - c * c) * inverse_det
        p12 = (b * c - a * e) * inverse_det
        p22 = (a * d - b * b) * inverse_det
        precision = mx.stack(
            (
                mx.stack((p00, p01, p02), axis=1),
                mx.stack((p01, p11, p12), axis=1),
                mx.stack((p02, p12, p22), axis=1),
            ),
            axis=1,
        )
        norm = (2.0 * np.pi) ** -1.5 * mx.rsqrt(mx.maximum(determinant, 1e-20))
        emission = mlx_nn.softplus(params["rawEmission"])
        extinction = mlx_nn.softplus(params["rawExtinction"])
        trace = a + d + f
        return params["centers"], precision, norm, (emission, extinction), trace

    def render_chunk(points, segment, centers, precision, norm, emission, extinction):
        delta = points[:, :, None, :] - centers[None, None, :, :]
        mahalanobis = mx.einsum("rsmi,mij,rsmj->rsm", delta, precision, delta)
        kernel = norm[None, None, :] * mx.exp(-0.5 * mahalanobis) * source_cell_volume
        emission_field = kernel @ emission
        extinction_field = kernel @ extinction
        if background is not None:
            bg_delta = points[:, :, None, :] - background["centers"][None, None, :, :]
            bg_mahalanobis = mx.einsum("rsmi,mij,rsmj->rsm", bg_delta, background["precision"], bg_delta)
            bg_kernel = background["norm"][None, None, :] * mx.exp(-0.5 * bg_mahalanobis) * source_cell_volume
            emission_field = emission_field + bg_kernel @ background["emission"]
            extinction_field = extinction_field + bg_kernel @ background["extinction"]
        optical_depth = extinction_field * segment[:, None]
        cumulative = mx.cumsum(optical_depth, axis=1)
        transmittance = mx.exp(-(cumulative - optical_depth))
        alpha = 1.0 - mx.exp(-optical_depth)
        source_scale = mx.where(optical_depth > 1e-8, alpha / mx.maximum(optical_depth, 1e-12), mx.ones_like(optical_depth))
        weighted = transmittance * source_scale * segment[:, None]
        return mx.sum(weighted[:, :, None] * emission_field, axis=1)

    def loss_fn(params, points, segment, target):
        centers, precision, norm, (emission, extinction), trace = decode(params)
        predictions = []
        ray_count = points.shape[0]
        for start in range(0, ray_count, ray_chunk):
            stop = min(start + ray_chunk, ray_count)
            predictions.append(
                render_chunk(
                    points[start:stop],
                    segment[start:stop],
                    centers,
                    precision,
                    norm,
                    emission,
                    extinction,
                )
            )
        predicted = mx.concatenate(predictions, axis=0)
        data_loss = mx.mean(mx.abs(predicted - target)) + 0.25 * mx.mean(
            mx.square(predicted - target)
        )
        if high_frequency_weight > 0.0:
            # Gradient-domain supervision: finite differences over the image
            # plane give fine structure a gradient voice that mean-L1 over a
            # mostly-empty frame denies it.
            pred_img = predicted.reshape((image_height, image_width, 3))
            targ_img = target.reshape((image_height, image_width, 3))
            dx = mx.abs(
                (pred_img[:, 1:, :] - pred_img[:, :-1, :])
                - (targ_img[:, 1:, :] - targ_img[:, :-1, :])
            )
            dy = mx.abs(
                (pred_img[1:, :, :] - pred_img[:-1, :, :])
                - (targ_img[1:, :, :] - targ_img[:-1, :, :])
            )
            data_loss = data_loss + high_frequency_weight * (mx.mean(dx) + mx.mean(dy))
        if anchor_weight > 0.0:
            # Temporal anchor: penalize raw-parameter departure from the warm
            # seat so a short cadence budget cannot shatter the solution.
            anchor = sum(
                mx.mean(mx.square(params[key] - anchor_reference[key])) for key in anchor_reference
            )
            data_loss = data_loss + anchor_weight * anchor
        if confine_to_medium:
            # Physical bounds: a mode whose center leaves the medium box or
            # whose footprint exceeds the domain scale is not a representation
            # candidate — it is an off-domain haze reservoir the optimizer
            # discovered as a loss-dumping cheat (140/152 modes fled the box in
            # the first hierarchical run). Confinement is contract, not tuning.
            escape = mx.maximum(mx.abs(centers - box_mid[None, :]) - box_half[None, :], 0.0)
            confinement = mx.mean(mx.sum(mx.square(escape / confinement_scale), axis=1))
            width_excess = mx.maximum(trace - width_cap, 0.0)
            data_loss = data_loss + 10.0 * confinement + 1.0 * mx.mean(width_excess / width_cap)
        return data_loss

    loss_and_grad = mx.value_and_grad(loss_fn)
    optimizer = optim.Adam(learning_rate=learning_rate)
    compile_state = [parameters, optimizer.state]

    # Compile the whole train step so the chunked autograd graph is built once
    # per batch shape and replayed, instead of rebuilt in Python every step.
    @partial(mx.compile, inputs=compile_state, outputs=compile_state)
    def train_step(points, segment, target):
        loss, gradients = loss_and_grad(parameters, points, segment, target)
        optimizer.update(parameters, gradients)
        return loss

    history: list[float] = []
    initial_loss = None
    arm_label = f"n{mode_count}-{init}-s{seed}"
    log_every = max(1, iterations // 15)
    for step in range(iterations):
        batch = camera_batches[step % len(camera_batches)]
        loss = train_step(batch["points"], batch["segment"], batch["target"])
        mx.eval(compile_state)
        value = float(loss)
        require(np.isfinite(value), f"loss became nonfinite at step {step}")
        history.append(value)
        if initial_loss is None:
            initial_loss = value
        if step % log_every == 0 or step == iterations - 1:
            print(
                f"[fit {arm_label}] step {step + 1}/{iterations} loss {value:.6f}",
                flush=True,
            )

    require_lattice_identity(target_lattice, digest)
    fitted_raw = {
        "centers": np.asarray(parameters["centers"], dtype=np.float64),
        "rawCholesky": np.asarray(parameters["rawCholesky"], dtype=np.float64),
        "rawEmission": np.asarray(parameters["rawEmission"], dtype=np.float64),
        "rawExtinction": np.asarray(parameters["rawExtinction"], dtype=np.float64),
    }
    fitted = raw_to_state(fitted_raw, medium)
    return {
        "identity": FIT_MARCH_IDENTITY,
        "init": init,
        "seed": seed,
        "modeCount": mode_count,
        "iterations": iterations,
        "fitWidth": fit_width,
        "fitSamplesPerCell": fit_samples_per_cell,
        "learningRate": learning_rate,
        "anchorWeight": float(anchor_weight),
        "backgroundModeCount": 0 if background_state is None else int(background_state["centers"].shape[0]),
        "confinedToMedium": bool(confine_to_medium),
        "highFrequencyWeight": float(high_frequency_weight),
        "cameraCount": len(cameras),
        "targetLatticeSha256": digest,
        "initialLoss": float(initial_loss),
        "finalLoss": float(history[-1]),
        "lossHistory": history,
        "state": fitted,
    }


def mixture_density_lattice(state: dict[str, np.ndarray], medium: Any, *, fine_grid: int) -> np.ndarray:
    extent = medium.source_spacing * medium.source_grid
    fine_spacing = extent / fine_grid
    axes = [medium.origin[a] + (np.arange(fine_grid, dtype=np.float64) + 0.5) * fine_spacing[a] for a in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1).reshape((-1, 3))
    source_cell_volume = float(np.prod(medium.source_spacing))
    lattice = np.zeros((grid.shape[0], 8), dtype=np.float64)
    for mode in range(state["centers"].shape[0]):
        covariance = state["covariances"][mode]
        precision = np.linalg.inv(covariance)
        delta = grid - state["centers"][mode][None, :]
        mahalanobis = np.einsum("ri,ij,rj->r", delta, precision, delta)
        norm = (2.0 * np.pi) ** -1.5 / np.sqrt(max(np.linalg.det(covariance), 1e-20))
        kernel = norm * np.exp(-0.5 * mahalanobis) * source_cell_volume
        lattice[:, :3] += kernel[:, None] * state["emission"][mode][None, :]
        lattice[:, 3] += kernel * state["extinction"][mode]
    return lattice.reshape((fine_grid, fine_grid, fine_grid, 8))


def evaluate_arm(
    arm: dict[str, Any],
    medium: Any,
    target_lattice: np.ndarray,
    cameras: list[dict[str, Any]],
    mode_module: Any,
    output_dir: Path,
    *,
    fine_grid: int,
    render_width: int,
    samples_per_cell: int,
) -> dict[str, Any]:
    label = f"n{arm['modeCount']}-{arm['init']}-s{arm['seed']}"
    reconstruction = mixture_density_lattice(arm["state"], medium, fine_grid=fine_grid)
    # Review finding F3: fitted-mixture coefficients are not exact conserved
    # mass (analytic kernels lose tail mass to fine-grid truncation); record the
    # world-integral ratio so nobody reads them as mass without seeing this.
    source_cell_volume = float(np.prod(medium.source_spacing))
    fine_cell_volume = float(np.prod((medium.source_spacing * medium.source_grid) / fine_grid))
    lattice_mass = np.sum(reconstruction, axis=(0, 1, 2)) * (fine_cell_volume / source_cell_volume)
    state = arm["state"]
    nominal_emission = np.sum(state["emission"], axis=0)
    nominal_extinction = float(np.sum(state["extinction"]))
    mass_receipt = {
        "nominalEmission": nominal_emission.tolist(),
        "nominalExtinction": nominal_extinction,
        "latticeEmission": lattice_mass[:3].tolist(),
        "latticeExtinction": float(lattice_mass[3]),
        "emissionRetention": float(
            np.sum(lattice_mass[:3]) / max(float(np.sum(nominal_emission)), 1e-12)
        ),
        "extinctionRetention": float(lattice_mass[3] / max(nominal_extinction, 1e-12)),
    }
    evaluations = []
    for index, camera in enumerate(cameras):
        target_linear, _tt, _tr = TARGET.march_density_lattice(
            target_lattice, medium, camera, width=render_width, samples_per_cell=samples_per_cell
        )
        fitted_linear, _ft, _fr = TARGET.march_density_lattice(
            reconstruction, medium, camera, width=render_width, samples_per_cell=samples_per_cell
        )
        metrics = FITTER.image_metrics(fitted_linear, target_linear)
        entry: dict[str, Any] = {"cameraIndex": index, "seenDuringFit": index == 0, **metrics}
        if index == 0:
            fit_png = output_dir / f"oracle-{label}.png"
            entry["artifact"] = FITTER.visual_artifact(fit_png, fitted_linear, mode_module)
            target_png = output_dir / "oracle-target-camera0.png"
            if not target_png.exists():
                FITTER.visual_artifact(target_png, target_linear, mode_module)
        evaluations.append(entry)
    unseen = [entry for entry in evaluations if not entry["seenDuringFit"]]
    require(len(unseen) > 0, "held evaluation has no unseen cameras")
    mean_mae = float(np.mean([entry["linearMae"] for entry in unseen]))
    mean_target_luma = float(np.mean([entry["targetMeanLuma"] for entry in unseen]))
    state_path = output_dir / f"oracle-{label}-state.json"
    FITTER.write_json(
        state_path,
        {
            "modeCount": arm["modeCount"],
            "centers": state["centers"],
            "covariances": state["covariances"],
            "emission": state["emission"],
            "extinction": state["extinction"],
        },
    )
    return {
        "label": label,
        "init": arm["init"],
        "seed": arm["seed"],
        "modeCount": arm["modeCount"],
        "initialLoss": arm["initialLoss"],
        "finalLoss": arm["finalLoss"],
        "meanHeldLinearMae": mean_mae,
        "meanHeldTargetLuma": mean_target_luma,
        "massReceipt": mass_receipt,
        "perCamera": evaluations,
        "statePath": str(state_path),
    }


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    spec = importlib.util.spec_from_file_location("optical_modes_oracle", mode_path)
    mode_module = importlib.util.module_from_spec(spec)
    sys.modules["optical_modes_oracle"] = mode_module
    spec.loader.exec_module(mode_module)
    mode_counts = [int(v) for v in str(args.mode_counts).split(",") if v.strip()]
    require(len(mode_counts) > 0, "mode-count ladder is empty")

    report["failurePhase"] = "source-load"
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, args.state_id)
    held_camera = state.get("target") or {}
    require(held_camera.get("cameraPose") and int(held_camera.get("width", 0)) > 0, "held camera is missing")
    source_grid = int((state.get("replay") or {}).get("grid", 0))

    report["failurePhase"] = "restriction"
    medium = FITTER.restrict_selected_optical_medium(
        native_ids, positions, coefficients, source_grid=source_grid, target_grid=args.target_grid, population=args.population
    )

    report["failurePhase"] = "target-contract"
    target_lattice, target_receipt = TARGET.build_gaussian_density_lattice(
        medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
    )
    digest = lattice_digest(target_lattice)
    report["source"] = {
        "manifestPath": str(manifest_path),
        "manifestSha256": FITTER.sha256_file(manifest_path),
        "stateId": args.state_id,
        "occupiedCells": int(medium.positions.shape[0]),
        "targetContract": target_receipt,
        "targetLatticeSha256": digest,
    }

    world_center = medium.origin + medium.source_spacing * medium.source_grid * 0.5
    fit_cameras = orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)
    # Review finding F2: evaluation angles are disjoint from every fit-orbit
    # angle; the operator's held camera is retained but labeled as seen and
    # excluded from the held mean.
    unseen_eval_cameras = orbit_cameras(held_camera, angles_degrees=[30.0, 90.0, 150.0], pivot=world_center)
    held_eval_cameras = [held_camera] + unseen_eval_cameras
    require_cameras_see_medium(fit_cameras + held_eval_cameras, medium)
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    report["failurePhase"] = "fitting"
    arms: list[dict[str, Any]] = []
    for mode_count in mode_counts:
        arm_specs = [("analytical", args.seed)] + [("random", args.seed + 1 + r) for r in range(args.random_restarts)]
        for init, seed in arm_specs:
            print(f"[arm] starting n{mode_count}-{init}-s{seed} ({args.iterations} iterations)", flush=True)
            result = fit_modes(
                medium,
                target_lattice,
                fit_cameras,
                mode_count=mode_count,
                iterations=args.iterations,
                fit_width=args.fit_width,
                fit_samples_per_cell=args.fit_samples_per_cell,
                seed=seed,
                init=init,
                learning_rate=args.learning_rate,
            )
            require_lattice_identity(target_lattice, digest)
            report["failurePhase"] = "evaluation"
            evaluation = evaluate_arm(
                result,
                medium,
                target_lattice,
                held_eval_cameras,
                mode_module,
                output_dir,
                fine_grid=args.fine_grid,
                render_width=args.render_width,
                samples_per_cell=args.samples_per_cell,
            )
            arms.append(evaluation)
            report["arms"] = arms
            FITTER.write_json(output_dir / "report.json", {**report, "status": "running"})
            report["failurePhase"] = "fitting"

    report["failurePhase"] = "capacity-curve"
    curve = {}
    for mode_count in mode_counts:
        candidates = [arm for arm in arms if arm["modeCount"] == mode_count]
        best = min(candidates, key=lambda arm: arm["meanHeldLinearMae"])
        curve[str(mode_count)] = {
            "best": best["label"],
            "meanHeldLinearMae": best["meanHeldLinearMae"],
            "meanHeldTargetLuma": best["meanHeldTargetLuma"],
            "maeFractionOfTargetLuma": best["meanHeldLinearMae"] / max(best["meanHeldTargetLuma"], 1e-12),
        }
    report["arms"] = arms
    report["capacityCurve"] = curve
    report["failurePhase"] = None
    report["status"] = "complete"
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--state-id", default="coefficient-state-120")
    parser.add_argument("--mode-module", type=Path, default=ROOT / "volume-grid96-off-lattice-optical-modes.py")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--target-grid", type=int, default=16)
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--mode-counts", default="48")
    parser.add_argument("--iterations", type=int, default=1500)
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=4)
    parser.add_argument("--fit-cameras", type=int, default=6)
    parser.add_argument("--random-restarts", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260724)
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {"schema": ORACLE_IDENTITY, "status": "running", "failurePhase": "inputs"}
    try:
        run(args, report)
        FITTER.write_json(output_dir / "report.json", report)
        return 0
    except Exception as failure:  # noqa: BLE001 — durable failure report is the contract
        report["status"] = "failed"
        report["failureMessage"] = str(failure)
        report["failureTraceback"] = traceback.format_exc()
        try:
            FITTER.write_json(output_dir / "report.json", report)
        except Exception:
            pass
        print(f"ceiling-oracle failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(execute())
