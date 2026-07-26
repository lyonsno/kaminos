#!/usr/bin/env python3
"""Adjacent-state warm-start probe for the Grid16 ceiling oracle.

Question: when the flame advances one exact adjacent simulator state, does a
warm-started gradient fit track the target's motion coherently, and is the
residual gestalt CONSISTENT across states (stable bias, visually calm) or
INCONSISTENT (per-state basin wander, visible pumping)?

Arms, all against the frozen sigma=0.6 target contract for the adjacent state
under one fixed camera family:
- frozen:    the source-state solution evaluated unchanged (do-nothing control)
- warm-N:    source-state solution refined for a small cadence-realistic budget
- warm-long: source-state solution refined at the full oracle budget
- cold:      independent analytical-init fit at the full oracle budget

Reported per arm: unseen-camera MAE against the adjacent target, temporal
tracking of the target's own state-to-state image delta (relative magnitude and
signed alignment), parameter drift (center movement in target-cell units), and
cross-state residual-pattern consistency (Pearson correlation between the
source-state fit residual and the adjacent-state arm residual under the fixed
held camera). High positive residual correlation = stable gestalt bias.
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

PROBE_IDENTITY = "grid16-temporal-warmstart-probe-v0"


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ORACLE = load_module("ceiling_oracle_probe", "volume-grid16-ceiling-oracle-mlx.py")
TARGET = ORACLE.TARGET
FITTER = ORACLE.FITTER
require = FITTER.require


def load_state_json(path: Path, expected_modes: int) -> dict[str, np.ndarray]:
    require(path.is_file(), f"source solution state is missing: {path}")
    stored = json.loads(path.read_text())
    state = {
        "centers": np.asarray(stored["centers"], dtype=np.float64),
        "covariances": np.asarray(stored["covariances"], dtype=np.float64),
        "emission": np.asarray(stored["emission"], dtype=np.float64),
        "extinction": np.asarray(stored["extinction"], dtype=np.float64),
    }
    require(state["centers"].shape == (expected_modes, 3), "source solution mode count drifted")
    require(np.all(np.isfinite(state["centers"])), "source solution centers are nonfinite")
    return state


def restricted_medium_for_state(manifest_path: Path, state_id: str, target_grid: int, population: str):
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, state_id)
    camera = state.get("target") or {}
    require(camera.get("cameraPose") and int(camera.get("width", 0)) > 0, f"held camera missing for {state_id}")
    source_grid = int((state.get("replay") or {}).get("grid", 0))
    medium = FITTER.restrict_selected_optical_medium(
        native_ids, positions, coefficients, source_grid=source_grid, target_grid=target_grid, population=population
    )
    return medium, camera


def residual_correlation(residual_a: np.ndarray, residual_b: np.ndarray) -> float:
    flat_a = residual_a.reshape(-1)
    flat_b = residual_b.reshape(-1)
    center_a = flat_a - np.mean(flat_a)
    center_b = flat_b - np.mean(flat_b)
    denominator = float(np.linalg.norm(center_a) * np.linalg.norm(center_b))
    require(denominator > 0.0, "residual correlation is undefined for a zero residual field")
    return float(np.dot(center_a, center_b) / denominator)


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    spec = importlib.util.spec_from_file_location("optical_modes_probe", mode_path)
    mode_module = importlib.util.module_from_spec(spec)
    sys.modules["optical_modes_probe"] = mode_module
    spec.loader.exec_module(mode_module)
    source_state_path = args.source_solution.expanduser().resolve()
    source_solution = load_state_json(source_state_path, args.mode_count)

    report["failurePhase"] = "source-load"
    source_medium, held_camera = restricted_medium_for_state(
        manifest_path, args.source_state_id, args.target_grid, args.population
    )
    adjacent_medium, _adjacent_camera = restricted_medium_for_state(
        manifest_path, args.adjacent_state_id, args.target_grid, args.population
    )

    report["failurePhase"] = "target-contract"
    source_lattice, source_receipt = TARGET.build_gaussian_density_lattice(
        source_medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
    )
    adjacent_lattice, adjacent_receipt = TARGET.build_gaussian_density_lattice(
        adjacent_medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
    )
    source_digest = ORACLE.lattice_digest(source_lattice)
    adjacent_digest = ORACLE.lattice_digest(adjacent_lattice)
    require(source_digest != adjacent_digest, "adjacent target is identical to source target; no motion to probe")

    world_center = source_medium.origin + source_medium.source_spacing * source_medium.source_grid * 0.5
    fit_cameras = ORACLE.orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)
    unseen_cameras = ORACLE.orbit_cameras(held_camera, angles_degrees=[30.0, 90.0, 150.0], pivot=world_center)
    eval_cameras = [held_camera] + unseen_cameras
    ORACLE.require_cameras_see_medium(fit_cameras + eval_cameras, adjacent_medium)

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report["source"] = {
        "manifestPath": str(manifest_path),
        "manifestSha256": FITTER.sha256_file(manifest_path),
        "sourceStateId": args.source_state_id,
        "adjacentStateId": args.adjacent_state_id,
        "sourceSolutionPath": str(source_state_path),
        "sourceTargetSha256": source_digest,
        "adjacentTargetSha256": adjacent_digest,
        "sourceContract": source_receipt,
        "adjacentContract": adjacent_receipt,
    }

    report["failurePhase"] = "reference-renders"
    render_kwargs = {"width": args.render_width, "samples_per_cell": args.samples_per_cell}
    source_target_held, _st, _sr = TARGET.march_density_lattice(source_lattice, source_medium, held_camera, **render_kwargs)
    adjacent_target_held, _at, _ar = TARGET.march_density_lattice(adjacent_lattice, adjacent_medium, held_camera, **render_kwargs)
    target_delta = adjacent_target_held - source_target_held
    target_delta_magnitude = float(np.mean(np.abs(target_delta)))
    require(target_delta_magnitude > 1e-6, "held-camera target motion delta is blank")
    source_fit_lattice = ORACLE.mixture_density_lattice(source_solution, source_medium, fine_grid=args.fine_grid)
    source_fit_held, _ft, _fr = TARGET.march_density_lattice(source_fit_lattice, source_medium, held_camera, **render_kwargs)
    source_residual_held = source_fit_held - source_target_held
    FITTER.visual_artifact(output_dir / "probe-source-target-held.png", source_target_held, mode_module)
    FITTER.visual_artifact(output_dir / "probe-adjacent-target-held.png", adjacent_target_held, mode_module)
    report["heldTargetMotion"] = {"linearMae": target_delta_magnitude}

    arm_specs = [
        {"name": "frozen", "iterations": 0},
        {
            "name": f"warm-{args.warm_iterations}",
            "iterations": args.warm_iterations,
            "init": "warm",
            "learningRate": args.learning_rate,
        },
        {
            "name": f"warm-damped-{args.warm_iterations}",
            "iterations": args.warm_iterations,
            "init": "warm",
            "learningRate": args.warm_learning_rate,
        },
        {
            "name": f"warm-anchored-{args.warm_iterations}",
            "iterations": args.warm_iterations,
            "init": "warm",
            "learningRate": args.warm_learning_rate,
            "anchorWeight": args.anchor_weight,
        },
        {"name": f"warm-{args.iterations}", "iterations": args.iterations, "init": "warm", "learningRate": args.learning_rate},
        {"name": "cold", "iterations": args.iterations, "init": "analytical", "learningRate": args.learning_rate},
    ]
    arms: list[dict[str, Any]] = []
    for spec_entry in arm_specs:
        report["failurePhase"] = f"arm-{spec_entry['name']}"
        if spec_entry["iterations"] == 0:
            fitted_state = source_solution
            fit_receipt = {"init": "frozen", "iterations": 0, "initialLoss": None, "finalLoss": None}
        else:
            result = ORACLE.fit_modes(
                adjacent_medium,
                adjacent_lattice,
                fit_cameras,
                mode_count=args.mode_count,
                iterations=spec_entry["iterations"],
                fit_width=args.fit_width,
                fit_samples_per_cell=args.fit_samples_per_cell,
                seed=args.seed,
                init=spec_entry["init"],
                learning_rate=spec_entry.get("learningRate", args.learning_rate),
                initial_state=source_solution if spec_entry["init"] == "warm" else None,
                anchor_weight=spec_entry.get("anchorWeight", 0.0),
            )
            fitted_state = result["state"]
            fit_receipt = {
                "init": result["init"],
                "iterations": result["iterations"],
                "initialLoss": result["initialLoss"],
                "finalLoss": result["finalLoss"],
            }
        fitted_lattice = ORACLE.mixture_density_lattice(fitted_state, adjacent_medium, fine_grid=args.fine_grid)
        per_camera = []
        for index, camera in enumerate(eval_cameras):
            camera_target, _t1, _r1 = TARGET.march_density_lattice(adjacent_lattice, adjacent_medium, camera, **render_kwargs)
            camera_fit, _t2, _r2 = TARGET.march_density_lattice(fitted_lattice, adjacent_medium, camera, **render_kwargs)
            metrics = FITTER.image_metrics(camera_fit, camera_target)
            per_camera.append({"cameraIndex": index, "seenDuringFit": index == 0, **metrics})
            if index == 0:
                held_fit = camera_fit
        unseen = [entry for entry in per_camera if not entry["seenDuringFit"]]
        arm_residual_held = held_fit - adjacent_target_held
        fit_delta = held_fit - source_fit_held
        fit_delta_magnitude = float(np.mean(np.abs(fit_delta)))
        alignment_denominator = float(np.linalg.norm(target_delta) * np.linalg.norm(fit_delta))
        signed_alignment = (
            float(np.dot(target_delta.reshape(-1), fit_delta.reshape(-1)) / alignment_denominator)
            if alignment_denominator > 0.0
            else 0.0
        )
        drift = np.linalg.norm(fitted_state["centers"] - source_solution["centers"], axis=1)
        cell = float(np.mean(adjacent_medium.spacing))
        artifact = FITTER.visual_artifact(output_dir / f"probe-{spec_entry['name']}-held.png", held_fit, mode_module)
        arms.append(
            {
                "name": spec_entry["name"],
                **fit_receipt,
                "meanUnseenLinearMae": float(np.mean([entry["linearMae"] for entry in unseen])),
                "heldLinearMae": float(np.mean(np.abs(arm_residual_held))),
                "temporalRelativeMagnitude": fit_delta_magnitude / target_delta_magnitude,
                "temporalSignedAlignment": signed_alignment,
                "residualGestaltCorrelation": residual_correlation(source_residual_held, arm_residual_held),
                "meanCenterDriftCells": float(np.mean(drift) / cell),
                "maxCenterDriftCells": float(np.max(drift) / cell),
                "perCamera": per_camera,
                "artifact": artifact,
            }
        )
        report["arms"] = arms
        FITTER.write_json(output_dir / "report.json", {**report, "status": "running"})

    ORACLE.require_lattice_identity(adjacent_lattice, adjacent_digest)
    ORACLE.require_lattice_identity(source_lattice, source_digest)
    report["arms"] = arms
    report["failurePhase"] = None
    report["status"] = "complete"
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--source-state-id", default="coefficient-state-120")
    parser.add_argument("--adjacent-state-id", default="coefficient-state-118")
    parser.add_argument("--source-solution", required=True, type=Path)
    parser.add_argument("--mode-module", type=Path, default=ROOT / "volume-grid96-off-lattice-optical-modes.py")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--target-grid", type=int, default=16)
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--mode-count", type=int, default=48)
    parser.add_argument("--iterations", type=int, default=1500)
    parser.add_argument("--warm-iterations", type=int, default=150)
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=4)
    parser.add_argument("--fit-cameras", type=int, default=6)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--warm-learning-rate", type=float, default=0.002)
    parser.add_argument("--anchor-weight", type=float, default=0.05)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260724)
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {"schema": PROBE_IDENTITY, "status": "running", "failurePhase": "inputs"}
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
        print(f"warmstart-probe failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(execute())
