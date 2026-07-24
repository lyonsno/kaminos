#!/usr/bin/env python3
"""Render the mass-conserving reconstruction target contract for the restricted Grid16 medium.

The 16^3 field has no appearance until a reconstruction kernel is chosen. The
nearest-cell voxel raymarch manufactures voxel faces and is demoted to a
restriction diagnostic. This assay renders the same restricted medium under
smooth mass-conserving kernels so the operator can pick one frozen target
contract for the ceiling oracle:

- Gaussian-basis reconstruction: one mass-normalized Gaussian per occupied
  coarse cell across a sigma ladder (the fitting family's own dense limit).
- Tricubic B-spline reconstruction: an independent classical smooth kernel,
  rendered as a cross-check that the target is not rigged toward Gaussians.

Every arm shares one fine-lattice trilinear raymarch with the exact segment
law, camera, and tone map used by the standing restricted-medium witnesses.
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

GAUSSIAN_RECONSTRUCTION_IDENTITY = "gaussian-basis-mass-conserving-reconstruction-v0"
BSPLINE_RECONSTRUCTION_IDENTITY = "tricubic-bspline-mass-conserving-reconstruction-v0"
MARCH_IDENTITY = "fine-lattice-trilinear-native-step-raymarch-v0"
CONTRACT_IDENTITY = "grid16-reconstruction-target-contract-v0"
MASS_TOLERANCE = 1e-3
REQUIRED_TRUNCATION_SIGMAS = 4.0


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


FITTER = load_module("multiscale_fitter_target", "volume-multiscale-fitting-sequence.py")
require = FITTER.require


def build_gaussian_density_lattice(
    medium: Any,
    *,
    sigma_cells: float,
    fine_grid: int,
    truncation_sigmas: float = REQUIRED_TRUNCATION_SIGMAS,
) -> tuple[np.ndarray, dict[str, Any]]:
    require(sigma_cells > 0.0, "sigma must be positive")
    require(fine_grid >= medium.grid, "fine lattice must be at least the restricted grid")
    require(
        truncation_sigmas >= REQUIRED_TRUNCATION_SIGMAS,
        "kernel truncation window below required support would silently lose mass",
    )
    extent = medium.source_spacing * medium.source_grid
    fine_spacing = extent / fine_grid
    source_cell_volume = float(np.prod(medium.source_spacing))
    fine_cell_volume = float(np.prod(fine_spacing))
    sigma_world = float(sigma_cells) * float(np.mean(medium.spacing))
    lattice = np.zeros((fine_grid, fine_grid, fine_grid, 8), dtype=np.float64)
    axes = [medium.origin[a] + (np.arange(fine_grid, dtype=np.float64) + 0.5) * fine_spacing[a] for a in range(3)]
    radius = truncation_sigmas * sigma_world
    for center, mass in zip(medium.positions, medium.coefficients):
        windows = []
        for axis in range(3):
            low = int(np.searchsorted(axes[axis], center[axis] - radius, side="left"))
            high = int(np.searchsorted(axes[axis], center[axis] + radius, side="right"))
            require(high > low, "kernel window is empty; fine lattice does not cover the medium")
            windows.append((low, high, axes[axis][low:high] - center[axis]))
        gx = np.exp(-0.5 * np.square(windows[0][2] / sigma_world))
        gy = np.exp(-0.5 * np.square(windows[1][2] / sigma_world))
        gz = np.exp(-0.5 * np.square(windows[2][2] / sigma_world))
        kernel = gx[:, None, None] * gy[None, :, None] * gz[None, None, :]
        kernel_integral = float(np.sum(kernel)) * fine_cell_volume
        require(kernel_integral > 0.0, "kernel evaluates to zero mass inside the lattice")
        # Discrete per-kernel normalization: each cell's truncated in-domain kernel
        # carries exactly the cell's coefficient mass, including at the box edge.
        kernel /= kernel_integral
        block = kernel[..., None] * (mass[None, None, None, :] * source_cell_volume)
        lattice[windows[0][0] : windows[0][1], windows[1][0] : windows[1][1], windows[2][0] : windows[2][1]] += block
    total_mass = np.sum(lattice, axis=(0, 1, 2)) * (fine_cell_volume / source_cell_volume)
    expected = np.sum(medium.coefficients, axis=0)
    scale = np.maximum(np.abs(expected), 1e-12)
    relative = np.abs(total_mass - expected) / scale
    active = expected > 0.0
    conserved = bool(np.all(relative[active] <= MASS_TOLERANCE))
    receipt = {
        "identity": GAUSSIAN_RECONSTRUCTION_IDENTITY,
        "sigmaCells": float(sigma_cells),
        "sigmaWorld": sigma_world,
        "truncationSigmas": float(truncation_sigmas),
        "fineGrid": fine_grid,
        "occupiedCells": int(medium.positions.shape[0]),
        "expectedChannelMass": expected.tolist(),
        "latticeChannelMass": total_mass.tolist(),
        "relativeMassError": relative.tolist(),
        "massTolerance": MASS_TOLERANCE,
        "conserved": conserved,
    }
    require(conserved, "gaussian-basis reconstruction lost coefficient mass beyond tolerance")
    return lattice, receipt


def cubic_bspline_weights(fraction: np.ndarray) -> np.ndarray:
    t = fraction
    w0 = ((1.0 - t) ** 3) / 6.0
    w1 = (3.0 * t**3 - 6.0 * t**2 + 4.0) / 6.0
    w2 = (-3.0 * t**3 + 3.0 * t**2 + 3.0 * t + 1.0) / 6.0
    w3 = (t**3) / 6.0
    return np.stack((w0, w1, w2, w3), axis=0)


def build_bspline_density_lattice(medium: Any, *, fine_grid: int) -> tuple[np.ndarray, dict[str, Any]]:
    require(fine_grid >= medium.grid, "fine lattice must be at least the restricted grid")
    dense = FITTER.dense_restricted_grid(medium)
    extent = medium.source_spacing * medium.source_grid
    fine_spacing = extent / fine_grid
    coordinates = (np.arange(fine_grid, dtype=np.float64) + 0.5) * (medium.grid / fine_grid) - 0.5
    base = np.floor(coordinates).astype(np.int64)
    weights = cubic_bspline_weights(coordinates - base)
    operator = np.zeros((fine_grid, medium.grid), dtype=np.float64)
    rows = np.arange(fine_grid)
    for tap in range(4):
        indices = base - 1 + tap
        valid = (indices >= 0) & (indices < medium.grid)
        operator[rows[valid], indices[valid]] += weights[tap][valid]
    # Per-cell discrete normalization, same semantics as the Gaussian arm: each
    # coarse cell's truncated in-box basis carries exactly its coefficient mass.
    column_mass = operator.sum(axis=0)
    fine_cell_volume = float(np.prod(fine_spacing))
    target_cell_volume = float(np.prod(medium.spacing))
    in_box = (
        column_mass[:, None, None]
        * column_mass[None, :, None]
        * column_mass[None, None, :]
        * fine_cell_volume
    )
    require(bool(np.all(in_box > 0.0)), "a coarse cell's basis has no support inside the lattice")
    density = np.asarray(dense, dtype=np.float64) * (target_cell_volume / in_box)[..., None]
    lattice = np.einsum("if,jg,kh,fghc->ijkc", operator, operator, operator, density, optimize=True)
    require(lattice.shape == (fine_grid, fine_grid, fine_grid, 8), "bspline lattice shape drifted")
    source_cell_volume = float(np.prod(medium.source_spacing))
    fine_cell_volume = float(np.prod(fine_spacing))
    total_mass = np.sum(lattice, axis=(0, 1, 2)) * (fine_cell_volume / source_cell_volume)
    expected = np.sum(medium.coefficients, axis=0)
    scale = np.maximum(np.abs(expected), 1e-12)
    relative = np.abs(total_mass - expected) / scale
    active = expected > 0.0
    conserved = bool(np.all(relative[active] <= MASS_TOLERANCE))
    receipt = {
        "identity": BSPLINE_RECONSTRUCTION_IDENTITY,
        "fineGrid": fine_grid,
        "expectedChannelMass": expected.tolist(),
        "latticeChannelMass": total_mass.tolist(),
        "relativeMassError": relative.tolist(),
        "massTolerance": MASS_TOLERANCE,
        "conserved": conserved,
    }
    require(conserved, "tricubic reconstruction lost coefficient mass beyond tolerance")
    return lattice, receipt


def march_density_lattice(
    lattice: np.ndarray,
    medium: Any,
    camera: dict[str, Any],
    *,
    width: int,
    samples_per_cell: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    require(lattice.ndim == 4 and lattice.shape[3] == 8, "density lattice shape is invalid")
    require(np.any(lattice > 0.0), "density lattice is blank; refusing to march an empty medium")
    require(samples_per_cell > 0, "samples_per_cell must be positive")
    fine_grid = lattice.shape[0]
    resized, position, forward, right, up = FITTER.camera_basis(camera, width)
    height = int(resized["height"])
    projection = np.asarray(camera["cameraPose"]["projectionMatrix"], dtype=np.float64).reshape(4, 4, order="F")
    focal_x = float(projection[0, 0])
    focal_y = float(projection[1, 1])
    pixel_x = (np.arange(width, dtype=np.float64) + 0.5) / width * 2.0 - 1.0
    pixel_y = 1.0 - (np.arange(height, dtype=np.float64) + 0.5) / height * 2.0
    ndc_x, ndc_y = np.meshgrid(pixel_x, pixel_y)
    directions = (
        forward[None, None, :]
        + right[None, None, :] * (ndc_x[..., None] / focal_x)
        + up[None, None, :] * (ndc_y[..., None] / focal_y)
    )
    directions /= np.linalg.norm(directions, axis=2, keepdims=True)
    flat_directions = directions.reshape((-1, 3))
    flat_origins = np.repeat(position[None, :], flat_directions.shape[0], axis=0)
    lower = medium.origin
    extent = medium.source_spacing * medium.source_grid
    upper = medium.origin + extent
    fine_spacing = extent / fine_grid
    near, far = FITTER.ray_box_intersection(flat_origins, flat_directions, lower, upper)
    hit = far > near
    sample_count = medium.grid * samples_per_cell
    fractions = (np.arange(sample_count, dtype=np.float64) + 0.5) / sample_count
    color = np.zeros((flat_directions.shape[0], 3), dtype=np.float64)
    transmittance = np.ones(flat_directions.shape[0], dtype=np.float64)
    path_length = np.maximum(far - near, 0.0)
    fine_step_world = float(np.mean(medium.source_spacing))
    for fraction in fractions:
        distance = near + path_length * fraction
        points = flat_origins + flat_directions * distance[:, None]
        continuous = (points - lower) / fine_spacing - 0.5
        base = np.floor(continuous).astype(np.int64)
        blend = continuous - base
        valid = hit
        values = np.zeros((flat_directions.shape[0], 8), dtype=np.float64)
        for corner in range(8):
            offset = np.asarray(((corner >> 0) & 1, (corner >> 1) & 1, (corner >> 2) & 1), dtype=np.int64)
            cell = base + offset[None, :]
            inside = valid & np.all((cell >= 0) & (cell < fine_grid), axis=1)
            if not np.any(inside):
                continue
            weight = np.prod(
                np.where(offset[None, :] == 1, blend[inside], 1.0 - blend[inside]),
                axis=1,
            )
            gathered = lattice[cell[inside, 0], cell[inside, 1], cell[inside, 2]]
            values[inside] += weight[:, None] * gathered
        segment_scale = np.where(hit, path_length / sample_count / fine_step_world, 0.0)
        emission = (values[:, :3] + values[:, 4:7]) * segment_scale[:, None]
        optical_depth = (values[:, 3] + values[:, 7]) * segment_scale
        alpha = -np.expm1(-optical_depth)
        source_scale = np.divide(alpha, optical_depth, out=np.ones_like(alpha), where=optical_depth > 1e-8)
        color += transmittance[:, None] * emission * source_scale[:, None]
        transmittance *= np.exp(-optical_depth)
    require(float(np.max(color)) > 0.0, "march produced a blank image from a nonblank medium")
    return color.reshape((height, width, 3)), transmittance.reshape((height, width)), {
        "identity": MARCH_IDENTITY,
        "width": width,
        "height": height,
        "fineGrid": fine_grid,
        "samplesPerCell": samples_per_cell,
        "sampleCount": sample_count,
        "integrationScaleIdentity": "world-distance-in-source-cell-widths-v0",
        "hitPixelCount": int(np.count_nonzero(hit)),
    }


def contact_sheet_html(panels: list[dict[str, Any]], metrics: dict[str, Any]) -> str:
    figures = "".join(
        f'<figure><figcaption>{panel["label"]}</figcaption><img src="{Path(panel["path"]).name}"></figure>'
        for panel in panels
    )
    table_rows = "".join(
        f"<tr><td>{row['arm']}</td><td>{row['meanLuma']:.6f}</td>"
        f"<td>{row['maeVersusTricubic']:.6f}</td><td>{row['maeVersusNearest']:.6f}</td></tr>"
        for row in metrics["arms"]
    )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Grid16 reconstruction target contract</title>
<style>
body{{margin:0;background:#0a0c0e;color:#dfe7ee;font:13px system-ui,sans-serif}}
header{{padding:12px 16px;background:#12181d;border-bottom:1px solid #26313a}}
main{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px}}
figure{{margin:0;background:#000;border:1px solid #26313a}}
figure img{{width:100%;display:block}}
figcaption{{padding:5px 8px;background:#10161b}}
table{{margin:0 16px 18px;border-collapse:collapse;font:12px ui-monospace,monospace}}
td,th{{border:1px solid #2a353f;padding:4px 9px;text-align:right}}
th:first-child,td:first-child{{text-align:left}}
</style></head><body>
<header><strong>Grid16 reconstruction target contract</strong>
<p>Same restricted medium, same camera, same transport. Only the reconstruction kernel changes.
Pick the frozen target contract; the nearest-cell panel is a restriction diagnostic, not a candidate.</p></header>
<main>{figures}</main>
<table><tr><th>arm</th><th>mean luma</th><th>MAE vs tricubic</th><th>MAE vs nearest</th></tr>{table_rows}</table>
</body></html>"""


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    mode_module = load_module("optical_modes_target", mode_path.name) if mode_path.parent == ROOT else None
    if mode_module is None:
        spec = importlib.util.spec_from_file_location("optical_modes_target", mode_path)
        mode_module = importlib.util.module_from_spec(spec)
        sys.modules["optical_modes_target"] = mode_module
        spec.loader.exec_module(mode_module)
    sigma_ladder = [float(value) for value in str(args.sigma_ladder).split(",") if value.strip()]
    require(len(sigma_ladder) > 0, "sigma ladder is empty")

    report["failurePhase"] = "source-load"
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, args.state_id)
    camera = state.get("target") or {}
    require(camera.get("cameraPose") and int(camera.get("width", 0)) > 0, "held camera is missing from source state")
    replay = state.get("replay") or {}
    source_grid = int(replay.get("grid", 0))

    report["failurePhase"] = "restriction"
    medium = FITTER.restrict_selected_optical_medium(
        native_ids,
        positions,
        coefficients,
        source_grid=source_grid,
        target_grid=args.target_grid,
        population=args.population,
    )

    report["source"] = {
        "manifestPath": str(manifest_path),
        "manifestSha256": FITTER.sha256_file(manifest_path),
        "stateId": args.state_id,
        "sourceGrid": source_grid,
        "restrictedGrid": args.target_grid,
        "population": args.population,
        "occupiedCells": int(medium.positions.shape[0]),
        "conservation": medium.conservation,
    }

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    panels: list[dict[str, Any]] = []
    arm_metrics: list[dict[str, Any]] = []
    renders: dict[str, np.ndarray] = {}

    report["failurePhase"] = "nearest-cell-reference"
    nearest_linear, _nearest_t, nearest_receipt = FITTER.render_restricted_medium(
        medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )
    renders["nearest"] = nearest_linear
    nearest_png = output_dir / "restriction-diagnostic-nearest-cell.png"
    nearest_artifact = FITTER.visual_artifact(nearest_png, nearest_linear, mode_module)
    panels.append({"label": "nearest-cell voxel raymarch (restriction diagnostic)", **nearest_artifact})
    report["nearestCellReference"] = {"receipt": nearest_receipt, "artifact": nearest_artifact}

    report["failurePhase"] = "tricubic-cross-check"
    bspline_lattice, bspline_receipt = build_bspline_density_lattice(medium, fine_grid=args.fine_grid)
    bspline_linear, _bspline_t, bspline_march = march_density_lattice(
        bspline_lattice,
        medium,
        camera,
        width=args.render_width,
        samples_per_cell=args.samples_per_cell,
    )
    renders["tricubic"] = bspline_linear
    bspline_png = output_dir / "target-candidate-tricubic-bspline.png"
    bspline_artifact = FITTER.visual_artifact(bspline_png, bspline_linear, mode_module)
    panels.append({"label": "tricubic B-spline reconstruction (cross-check)", **bspline_artifact})
    report["tricubicCrossCheck"] = {
        "reconstruction": bspline_receipt,
        "march": bspline_march,
        "artifact": bspline_artifact,
    }

    report["failurePhase"] = "gaussian-sigma-ladder"
    ladder_reports = []
    for sigma in sigma_ladder:
        lattice, gaussian_receipt = build_gaussian_density_lattice(
            medium,
            sigma_cells=sigma,
            fine_grid=args.fine_grid,
        )
        linear, _t, march_receipt = march_density_lattice(
            lattice,
            medium,
            camera,
            width=args.render_width,
            samples_per_cell=args.samples_per_cell,
        )
        renders[f"gaussian-{sigma:g}"] = linear
        png = output_dir / f"target-candidate-gaussian-sigma-{sigma:g}.png"
        art = FITTER.visual_artifact(png, linear, mode_module)
        panels.append({"label": f"Gaussian basis σ={sigma:g} cells", **art})
        ladder_reports.append({"reconstruction": gaussian_receipt, "march": march_receipt, "artifact": art})
    report["gaussianSigmaLadder"] = ladder_reports

    report["failurePhase"] = "metrics"
    for name, image in renders.items():
        arm_metrics.append(
            {
                "arm": name,
                "meanLuma": float(np.mean(image @ FITTER.LUMA)),
                "maeVersusTricubic": float(np.mean(np.abs(image - renders["tricubic"]))),
                "maeVersusNearest": float(np.mean(np.abs(image - renders["nearest"]))),
            }
        )
    metrics = {"arms": arm_metrics}
    report["metrics"] = metrics

    report["failurePhase"] = "contact-sheet"
    sheet_path = output_dir / "index.html"
    sheet_path.write_text(contact_sheet_html(panels, metrics), encoding="utf-8")
    report["contactSheet"] = {"path": str(sheet_path), "bytes": sheet_path.stat().st_size}
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
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--sigma-ladder", default="0.35,0.5,0.7,0.9")
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {
        "schema": CONTRACT_IDENTITY,
        "status": "running",
        "failurePhase": "inputs",
    }
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
        print(f"target-contract failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(execute())
