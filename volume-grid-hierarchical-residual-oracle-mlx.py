#!/usr/bin/env python3
"""Hierarchical residual oracle: frozen level-16 solution + free level-32 modes.

The production hierarchy never asks a level to solo the whole field: each level
owes only its band above the coarser levels' contribution. Because emission and
extinction densities are additive BEFORE transport, residual fitting is exact
with no signed-image algebra: the composed forward march renders
(frozen level-16 mixture + free level-32 modes) through one transport law,
loss against the frozen sigma=0.6 Grid32 target.

Head-to-head question: does 48 frozen + M free modes beat the solo N=(48+M)
fit at equal total budget? Arms: residual-aware analytical seed (farthest-point
over the POSITIVE residual density, since level 16 already owns the
low-frequency mass) versus random control.

Also measured: the level-16 overshoot fraction — the share of coarse-level
density that exceeds the Grid32 target and that nonnegative free modes cannot
subtract. That is the nonnegativity tax the production architecture carries.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent

HIERARCHY_IDENTITY = "grid-hierarchical-residual-oracle-v0"


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ORACLE = load_module("ceiling_oracle_hierarchy", "volume-grid16-ceiling-oracle-mlx.py")
TARGET = ORACLE.TARGET
FITTER = ORACLE.FITTER
require = FITTER.require


def load_state_json(path: Path) -> dict[str, np.ndarray]:
    require(path.is_file(), f"coarse solution state is missing: {path}")
    stored = json.loads(path.read_text())
    state = {
        "centers": np.asarray(stored["centers"], dtype=np.float64),
        "covariances": np.asarray(stored["covariances"], dtype=np.float64),
        "emission": np.asarray(stored["emission"], dtype=np.float64),
        "extinction": np.asarray(stored["extinction"], dtype=np.float64),
    }
    for key, value in state.items():
        require(np.all(np.isfinite(value)), f"coarse solution {key} contains nonfinite values")
    return state


def residual_field(
    target_lattice: np.ndarray,
    coarse_state: dict[str, np.ndarray],
    medium: Any,
    *,
    fine_grid: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    coarse_lattice = ORACLE.mixture_density_lattice(coarse_state, medium, fine_grid=fine_grid)
    residual = target_lattice - coarse_lattice
    positive = np.maximum(residual, 0.0)
    negative = np.maximum(-residual, 0.0)
    target_mass = np.sum(target_lattice, axis=(0, 1, 2))
    scale = np.maximum(target_mass, 1e-12)
    receipt = {
        "identity": "level-composition-residual-v0",
        "positiveResidualFraction": (np.sum(positive, axis=(0, 1, 2)) / scale).tolist(),
        "overshootFraction": (np.sum(negative, axis=(0, 1, 2)) / scale).tolist(),
        "targetChannelMass": target_mass.tolist(),
    }
    require(float(np.max(positive)) > 0.0, "positive residual is blank; nothing left for the fine level to fit")
    return positive, receipt


def residual_seed_state(
    positive_residual: np.ndarray,
    medium: Any,
    *,
    mode_count: int,
    fine_grid: int,
) -> dict[str, np.ndarray]:
    extent = medium.source_spacing * medium.source_grid
    fine_spacing = extent / fine_grid
    weights_field = (
        positive_residual[..., :3] @ FITTER.LUMA + positive_residual[..., 3]
    )
    flat = weights_field.reshape(-1)
    active = np.flatnonzero(flat > 1e-9)
    require(active.size >= mode_count, "positive residual support is smaller than the requested mode count")
    axes = [medium.origin[a] + (np.arange(fine_grid, dtype=np.float64) + 0.5) * fine_spacing[a] for a in range(3)]
    grid_points = np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1).reshape((-1, 3))
    positions = grid_points[active]
    weights = flat[active]
    order = FITTER.deterministic_seeds(positions, weights, mode_count)
    centers = positions[order].copy()
    assignment = np.argmin(
        np.sum(np.square(positions[:, None, :] - centers[None, :, :]), axis=2),
        axis=1,
    )
    residual_rows = positive_residual.reshape((-1, 8))[active]
    fine_cell_volume = float(np.prod(fine_spacing))
    source_cell_volume = float(np.prod(medium.source_spacing))
    mass_scale = fine_cell_volume / source_cell_volume
    emission = np.zeros((mode_count, 3), dtype=np.float64)
    extinction = np.zeros(mode_count, dtype=np.float64)
    for mode in range(mode_count):
        rows = assignment == mode
        if np.any(rows):
            emission[mode] = np.sum(residual_rows[rows, :3], axis=0) * mass_scale
            extinction[mode] = float(np.sum(residual_rows[rows, 3])) * mass_scale
    emission = np.maximum(emission, 1e-6)
    extinction = np.maximum(extinction, 1e-6)
    spacing = float(np.mean(medium.spacing))
    covariances = np.repeat(np.eye(3)[None, :, :] * (0.75 * spacing) ** 2, mode_count, axis=0)
    return {"centers": centers, "covariances": covariances, "emission": emission, "extinction": extinction}


def compose_states(coarse: dict[str, np.ndarray], fine: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    return {
        "centers": np.concatenate((coarse["centers"], fine["centers"]), axis=0),
        "covariances": np.concatenate((coarse["covariances"], fine["covariances"]), axis=0),
        "emission": np.concatenate((coarse["emission"], fine["emission"]), axis=0),
        "extinction": np.concatenate((coarse["extinction"], fine["extinction"]), axis=0),
    }


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    spec = importlib.util.spec_from_file_location("optical_modes_hierarchy", mode_path)
    mode_module = importlib.util.module_from_spec(spec)
    sys.modules["optical_modes_hierarchy"] = mode_module
    spec.loader.exec_module(mode_module)
    coarse_state = load_state_json(args.coarse_solution.expanduser().resolve())
    coarse_count = int(coarse_state["centers"].shape[0])

    report["failurePhase"] = "source-load"
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, args.state_id)
    held_camera = state.get("target") or {}
    require(held_camera.get("cameraPose") and int(held_camera.get("width", 0)) > 0, "held camera is missing")
    source_grid = int((state.get("replay") or {}).get("grid", 0))

    report["failurePhase"] = "restriction"
    fine_medium = FITTER.restrict_selected_optical_medium(
        native_ids, positions, coefficients, source_grid=source_grid, target_grid=args.fine_level_grid, population=args.population
    )

    report["failurePhase"] = "target-contract"
    fine_target, fine_receipt = TARGET.build_gaussian_density_lattice(
        fine_medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
    )
    fine_digest = ORACLE.lattice_digest(fine_target)

    report["failurePhase"] = "residual"
    positive_residual, residual_receipt = residual_field(
        fine_target, coarse_state, fine_medium, fine_grid=args.fine_grid
    )
    report["source"] = {
        "manifestPath": str(manifest_path),
        "manifestSha256": FITTER.sha256_file(manifest_path),
        "stateId": args.state_id,
        "fineLevelGrid": args.fine_level_grid,
        "coarseSolutionPath": str(args.coarse_solution),
        "coarseModeCount": coarse_count,
        "freeModeCount": args.free_modes,
        "totalModeCount": coarse_count + args.free_modes,
        "fineTargetSha256": fine_digest,
        "fineTargetContract": fine_receipt,
        "residual": residual_receipt,
    }

    world_center = fine_medium.origin + fine_medium.source_spacing * fine_medium.source_grid * 0.5
    fit_cameras = ORACLE.orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)
    eval_cameras = [held_camera] + ORACLE.orbit_cameras(
        held_camera, angles_degrees=[30.0, 90.0, 150.0], pivot=world_center
    )
    ORACLE.require_cameras_see_medium(fit_cameras + eval_cameras, fine_medium)
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    arms: list[dict[str, Any]] = []
    arm_specs = [("residual-analytical", args.seed)] + [
        ("random", args.seed + 1 + index) for index in range(args.random_restarts)
    ]
    for init_kind, seed in arm_specs:
        report["failurePhase"] = f"fit-{init_kind}-s{seed}"
        if init_kind == "residual-analytical":
            seed_state = residual_seed_state(
                positive_residual, fine_medium, mode_count=args.free_modes, fine_grid=args.fine_grid
            )
        else:
            seed_state = ORACLE.random_seed_state(fine_medium, mode_count=args.free_modes, seed=seed)
        result = ORACLE.fit_modes(
            fine_medium,
            fine_target,
            fit_cameras,
            mode_count=args.free_modes,
            iterations=args.iterations,
            fit_width=args.fit_width,
            fit_samples_per_cell=args.fit_samples_per_cell,
            seed=seed,
            init="warm",
            learning_rate=args.learning_rate,
            initial_state=seed_state,
            background_state=coarse_state,
        )
        ORACLE.require_lattice_identity(fine_target, fine_digest)
        report["failurePhase"] = f"evaluate-{init_kind}-s{seed}"
        composed = compose_states(coarse_state, result["state"])
        evaluation = ORACLE.evaluate_arm(
            {
                "state": composed,
                "modeCount": coarse_count + args.free_modes,
                "init": f"hier-{init_kind}",
                "seed": seed,
                "initialLoss": result["initialLoss"],
                "finalLoss": result["finalLoss"],
            },
            fine_medium,
            fine_target,
            eval_cameras,
            mode_module,
            output_dir,
            fine_grid=args.fine_grid,
            render_width=args.render_width,
            samples_per_cell=args.samples_per_cell,
        )
        evaluation["freeModeCount"] = args.free_modes
        evaluation["coarseModeCount"] = coarse_count
        arms.append(evaluation)
        report["arms"] = arms
        FITTER.write_json(output_dir / "report.json", {**report, "status": "running"})

    report["failurePhase"] = "summary"
    best = min(arms, key=lambda arm: arm["meanHeldLinearMae"])
    report["arms"] = arms
    report["summary"] = {
        "best": best["label"],
        "meanHeldLinearMae": best["meanHeldLinearMae"],
        "maeFractionOfTargetLuma": best["meanHeldLinearMae"] / max(best["meanHeldTargetLuma"], 1e-12),
        "soloComparisonNote": (
            "compare against the solo N=(coarse+free) rung at the same fine-level target contract"
        ),
    }
    report["failurePhase"] = None
    report["status"] = "complete"
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--state-id", default="coefficient-state-120")
    parser.add_argument("--mode-module", type=Path, default=ROOT / "volume-grid96-off-lattice-optical-modes.py")
    parser.add_argument("--coarse-solution", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--fine-level-grid", type=int, default=32)
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--free-modes", type=int, default=152)
    parser.add_argument("--iterations", type=int, default=1000)
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=3)
    parser.add_argument("--fit-cameras", type=int, default=6)
    parser.add_argument("--random-restarts", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260725)
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {"schema": HIERARCHY_IDENTITY, "status": "running", "failurePhase": "inputs"}
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
        print(f"hierarchical-oracle failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(execute())
