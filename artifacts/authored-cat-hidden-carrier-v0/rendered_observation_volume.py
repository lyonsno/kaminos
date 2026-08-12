"""Dependency-light rendered-observation hidden-carrier volume contracts.

Truth-side code may render an authored synthetic fixture. Recovery receives
only calibrated depth/silhouette arrays and derives a visual-hull volume. The
source carrier, source correspondence, authored normals, authored coat depths,
and authored support mask are deliberately absent from its API.
"""

from __future__ import annotations

import math

import numpy as np


SCHEMA = "kaminos.rendered-observation-hidden-carrier-volume.v0"
ROUTE = "cpu-numpy-rendered-observation-volume-v0"
BACKEND = "python-numpy-cpu"
VIEW_IDS = ("+X", "-X", "+Y", "-Y", "+Z", "-Z")

_AXIS_VIEW = {
    "+X": (0, 1, 2, 1),
    "-X": (0, 1, 2, -1),
    "+Y": (1, 2, 0, 1),
    "-Y": (1, 2, 0, -1),
    "+Z": (2, 1, 0, 1),
    "-Z": (2, 1, 0, -1),
}
_RENDERED_KEYS = {
    "schema",
    "route",
    "backend",
    "observationClass",
    "bounds",
    "rasterSize",
    "views",
}
_VIEW_KEYS = {"axis", "sign", "uAxis", "vAxis", "depthConvention", "depth", "mask"}
_SPATIAL_PRIOR_KEYS = {"baseDepth", "amplitude", "dorsalStart", "apCenter", "apWidth"}


def _points(name, value):
    result = np.asarray(value, dtype=np.float64)
    if result.ndim != 2 or result.shape[1] != 3 or len(result) == 0:
        raise ValueError(f"{name} must have shape (n, 3) with n > 0")
    if not np.isfinite(result).all():
        raise ValueError(f"{name} must be finite")
    return result


def _triangles(value, *, vertex_count):
    result = np.asarray(value)
    if result.ndim != 2 or result.shape[1] != 3 or len(result) == 0:
        raise ValueError("triangles must have shape (m, 3) with m > 0")
    if not np.issubdtype(result.dtype, np.integer):
        raise ValueError("triangles must contain integer indices")
    result = result.astype(np.int64, copy=False)
    if result.min() < 0 or result.max() >= vertex_count:
        raise ValueError("triangle index is outside the position array")
    return result


def _bounds(points, supplied):
    if supplied is None:
        minimum = points.min(axis=0)
        maximum = points.max(axis=0)
        center = (minimum + maximum) * 0.5
        side = float(np.max(maximum - minimum))
        if not np.isfinite(side) or side <= 1e-12:
            raise ValueError("positions must have nonzero extent")
        side *= 1.06
        return np.stack((center - side * 0.5, center + side * 0.5))
    result = np.asarray(supplied, dtype=np.float64)
    if result.shape != (2, 3) or not np.isfinite(result).all():
        raise ValueError("bounds must be a finite (2, 3) array")
    if np.any(result[1] <= result[0]):
        raise ValueError("bounds maximum must exceed minimum on every axis")
    if np.any(points < result[0] - 1e-9) or np.any(points > result[1] + 1e-9):
        raise ValueError("positions extend beyond supplied observation bounds")
    return result.copy()


def _rasterize_view(points, triangles, bounds, *, raster_size, axis, u_axis, v_axis, sign):
    size = int(raster_size)
    u = (points[:, u_axis] - bounds[0, u_axis]) / (bounds[1, u_axis] - bounds[0, u_axis])
    v = (points[:, v_axis] - bounds[0, v_axis]) / (bounds[1, v_axis] - bounds[0, v_axis])
    px = u * (size - 1)
    py = v * (size - 1)
    depth = np.full((size, size), -np.inf if sign > 0 else np.inf, dtype=np.float64)
    mask = np.zeros((size, size), dtype=bool)

    for triangle in triangles:
        ax, bx, cx = px[triangle]
        ay, by, cy = py[triangle]
        denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(float(denominator)) <= 1e-12:
            continue
        left = max(0, int(math.floor(min(ax, bx, cx))))
        right = min(size - 1, int(math.ceil(max(ax, bx, cx))))
        bottom = max(0, int(math.floor(min(ay, by, cy))))
        top = min(size - 1, int(math.ceil(max(ay, by, cy))))
        if right < left or top < bottom:
            continue
        x_grid, y_grid = np.meshgrid(
            np.arange(left, right + 1, dtype=np.float64),
            np.arange(bottom, top + 1, dtype=np.float64),
        )
        weight_a = ((by - cy) * (x_grid - cx) + (cx - bx) * (y_grid - cy)) / denominator
        weight_b = ((cy - ay) * (x_grid - cx) + (ax - cx) * (y_grid - cy)) / denominator
        weight_c = 1.0 - weight_a - weight_b
        inside = (weight_a >= -1e-9) & (weight_b >= -1e-9) & (weight_c >= -1e-9)
        if not np.any(inside):
            continue
        triangle_depth = (
            weight_a * points[triangle[0], axis]
            + weight_b * points[triangle[1], axis]
            + weight_c * points[triangle[2], axis]
        )
        rows = slice(bottom, top + 1)
        columns = slice(left, right + 1)
        target = depth[rows, columns]
        if sign > 0:
            target[inside] = np.maximum(target[inside], triangle_depth[inside])
        else:
            target[inside] = np.minimum(target[inside], triangle_depth[inside])
        mask[rows, columns] |= inside

    depth[~mask] = 0.0
    return depth, mask


def render_orthographic_views(positions, triangles, *, raster_size=96, bounds=None):
    """Render six axis-aligned first-surface depth maps without identity output."""

    points = _points("positions", positions)
    faces = _triangles(triangles, vertex_count=len(points))
    size = int(raster_size)
    if size < 3 or size != raster_size:
        raise ValueError("raster_size must be an integer of at least 3")
    observation_bounds = _bounds(points, bounds)
    views = {}
    for view_id in VIEW_IDS:
        axis, u_axis, v_axis, sign = _AXIS_VIEW[view_id]
        depth, mask = _rasterize_view(
            points,
            faces,
            observation_bounds,
            raster_size=size,
            axis=axis,
            u_axis=u_axis,
            v_axis=v_axis,
            sign=sign,
        )
        if not np.any(mask):
            raise ValueError(f"orthographic view {view_id} is blank")
        views[view_id] = {
            "axis": axis,
            "sign": sign,
            "uAxis": u_axis,
            "vAxis": v_axis,
            "depthConvention": "world-axis-first-surface-coordinate",
            "depth": depth,
            "mask": mask,
        }
    return {
        "schema": SCHEMA,
        "route": ROUTE,
        "backend": BACKEND,
        "observationClass": "six-view-orthographic-depth-and-silhouette",
        "bounds": observation_bounds,
        "rasterSize": size,
        "views": views,
    }


def _finite_nonnegative(name, value):
    result = float(value)
    if not np.isfinite(result) or result < 0.0:
        raise ValueError(f"{name} must be finite and nonnegative")
    return result


def build_recovery_bundle(rendered, *, grid_size, uniform_depth, spatial_prior):
    """Validate and copy the exact recovery-side observation schema."""

    if not isinstance(rendered, dict):
        raise ValueError("rendered observation must be a mapping")
    unknown = set(rendered) - _RENDERED_KEYS
    missing = _RENDERED_KEYS - set(rendered)
    if unknown:
        raise ValueError(f"unknown or forbidden rendered fields: {sorted(unknown)}")
    if missing:
        raise ValueError(f"missing rendered fields: {sorted(missing)}")
    if rendered["schema"] != SCHEMA or rendered["route"] != ROUTE:
        raise ValueError("rendered observation schema or route mismatch")
    if rendered["backend"] != BACKEND:
        raise ValueError("rendered observation backend mismatch")
    size = int(rendered["rasterSize"])
    if size < 3 or size != rendered["rasterSize"]:
        raise ValueError("rendered raster size is invalid")
    bounds = np.asarray(rendered["bounds"], dtype=np.float64)
    if bounds.shape != (2, 3) or not np.isfinite(bounds).all() or np.any(bounds[1] <= bounds[0]):
        raise ValueError("rendered bounds are invalid")
    if tuple(rendered["views"]) != VIEW_IDS:
        raise ValueError("rendered observation must contain the canonical six ordered views")

    views = {}
    for view_id in VIEW_IDS:
        view = rendered["views"][view_id]
        if not isinstance(view, dict):
            raise ValueError(f"view {view_id} must be a mapping")
        unknown_view = set(view) - _VIEW_KEYS
        missing_view = _VIEW_KEYS - set(view)
        if unknown_view:
            raise ValueError(f"unknown or forbidden fields in view {view_id}: {sorted(unknown_view)}")
        if missing_view:
            raise ValueError(f"missing fields in view {view_id}: {sorted(missing_view)}")
        axis, u_axis, v_axis, sign = _AXIS_VIEW[view_id]
        if (view["axis"], view["uAxis"], view["vAxis"], view["sign"]) != (
            axis,
            u_axis,
            v_axis,
            sign,
        ):
            raise ValueError(f"view {view_id} camera identity mismatch")
        if view["depthConvention"] != "world-axis-first-surface-coordinate":
            raise ValueError(f"view {view_id} depth convention mismatch")
        depth = np.asarray(view["depth"], dtype=np.float64)
        mask = np.asarray(view["mask"], dtype=bool)
        if depth.shape != (size, size) or mask.shape != (size, size):
            raise ValueError(f"view {view_id} raster shape mismatch")
        if not np.any(mask) or not np.isfinite(depth[mask]).all():
            raise ValueError(f"view {view_id} has blank or nonfinite primary depth")
        if np.any(depth[~mask] != 0.0):
            raise ValueError(f"view {view_id} invalid pixels must carry zero depth")
        views[view_id] = {
            "axis": axis,
            "sign": sign,
            "uAxis": u_axis,
            "vAxis": v_axis,
            "depthConvention": view["depthConvention"],
            "depth": depth.copy(),
            "mask": mask.copy(),
        }

    grid = int(grid_size)
    if grid < 3 or grid != grid_size:
        raise ValueError("grid_size must be an integer of at least 3")
    if not isinstance(spatial_prior, dict):
        raise ValueError("spatial_prior must be a mapping")
    unknown_prior = set(spatial_prior) - _SPATIAL_PRIOR_KEYS
    if unknown_prior:
        raise ValueError(f"unknown spatial-prior fields: {sorted(unknown_prior)}")
    prior = {
        "baseDepth": _finite_nonnegative(
            "spatial prior baseDepth", spatial_prior.get("baseDepth", uniform_depth)
        ),
        "amplitude": _finite_nonnegative(
            "spatial prior amplitude", spatial_prior.get("amplitude", 0.0)
        ),
        "dorsalStart": float(spatial_prior.get("dorsalStart", 0.40)),
        "apCenter": float(spatial_prior.get("apCenter", 0.65)),
        "apWidth": float(spatial_prior.get("apWidth", 0.24)),
    }
    if not all(np.isfinite(value) for value in prior.values()):
        raise ValueError("spatial-prior values must be finite")
    if not 0.0 <= prior["dorsalStart"] < 1.0:
        raise ValueError("dorsalStart must lie in [0, 1)")
    if not 0.0 <= prior["apCenter"] <= 1.0 or prior["apWidth"] <= 0.0:
        raise ValueError("AP prior center/width are invalid")
    return {
        "schema": SCHEMA,
        "route": {"requested": ROUTE, "effective": ROUTE, "backend": BACKEND},
        "observationClass": rendered["observationClass"],
        "bounds": bounds.copy(),
        "rasterSize": size,
        "views": views,
        "config": {
            "gridSize": grid,
            "uniformDepth": _finite_nonnegative("uniform_depth", uniform_depth),
            "spatialPrior": prior,
        },
    }


def _fuse_visual_hull(bundle):
    bounds = bundle["bounds"]
    grid_size = bundle["config"]["gridSize"]
    raster_size = bundle["rasterSize"]
    coordinates = [
        np.linspace(bounds[0, axis], bounds[1, axis], grid_size, dtype=np.float64)
        for axis in range(3)
    ]
    grid_indices = np.indices((grid_size, grid_size, grid_size), sparse=True)
    pixel_indices = []
    for axis in range(3):
        unit = (coordinates[axis] - bounds[0, axis]) / (bounds[1, axis] - bounds[0, axis])
        pixel_indices.append(np.clip(np.rint(unit * (raster_size - 1)).astype(np.int64), 0, raster_size - 1))

    occupancy = np.ones((grid_size, grid_size, grid_size), dtype=bool)
    tolerance = float(np.max(bounds[1] - bounds[0])) * 1e-9
    for axis, (positive_id, negative_id) in enumerate((("+X", "-X"), ("+Y", "-Y"), ("+Z", "-Z"))):
        positive = bundle["views"][positive_id]
        negative = bundle["views"][negative_id]
        u_axis = positive["uAxis"]
        v_axis = positive["vAxis"]
        u_index = pixel_indices[u_axis][grid_indices[u_axis]]
        v_index = pixel_indices[v_axis][grid_indices[v_axis]]
        positive_depth = positive["depth"][v_index, u_index]
        negative_depth = negative["depth"][v_index, u_index]
        valid = positive["mask"][v_index, u_index] & negative["mask"][v_index, u_index]
        coordinate = coordinates[axis][grid_indices[axis]]
        occupancy &= valid
        occupancy &= coordinate <= positive_depth + tolerance
        occupancy &= coordinate >= negative_depth - tolerance
    if not np.any(occupancy):
        raise ValueError("rendered observations fuse to a blank outer volume")
    return occupancy, coordinates


def _erode_once(mask):
    result = np.zeros_like(mask, dtype=bool)
    if min(mask.shape) < 3:
        return result
    result[1:-1, 1:-1, 1:-1] = (
        mask[1:-1, 1:-1, 1:-1]
        & mask[:-2, 1:-1, 1:-1]
        & mask[2:, 1:-1, 1:-1]
        & mask[1:-1, :-2, 1:-1]
        & mask[1:-1, 2:, 1:-1]
        & mask[1:-1, 1:-1, :-2]
        & mask[1:-1, 1:-1, 2:]
    )
    return result


def _inward_layers(occupancy):
    distance = np.zeros(occupancy.shape, dtype=np.int16)
    remaining = occupancy.copy()
    layer = 0
    while np.any(remaining):
        layer += 1
        eroded = _erode_once(remaining)
        distance[remaining & ~eroded] = layer
        remaining = eroded
        if layer > max(occupancy.shape):
            raise ValueError("volumetric erosion failed to terminate")
    return distance


def _spatial_depth(coordinates, prior):
    unit_y = (coordinates[1] - coordinates[1][0]) / (coordinates[1][-1] - coordinates[1][0])
    unit_z = (coordinates[2] - coordinates[2][0]) / (coordinates[2][-1] - coordinates[2][0])
    dorsal = 1.0 - unit_y
    t = np.clip(
        (dorsal - prior["dorsalStart"]) / (1.0 - prior["dorsalStart"]), 0.0, 1.0
    )
    dorsal_gate = t * t * (3.0 - 2.0 * t)
    ap_gate = np.exp(-0.5 * ((unit_z - prior["apCenter"]) / prior["apWidth"]) ** 2)
    return (
        prior["baseDepth"]
        + prior["amplitude"] * dorsal_gate[None, :, None] * ap_gate[None, None, :]
    )


def recover_volume_candidates(bundle):
    """Fuse observations and apply uniform and spatial volumetric erosions."""

    if not isinstance(bundle, dict) or bundle.get("schema") != SCHEMA:
        raise ValueError("recovery bundle schema mismatch")
    if set(bundle) != {
        "schema",
        "route",
        "observationClass",
        "bounds",
        "rasterSize",
        "views",
        "config",
    }:
        raise ValueError("recovery bundle contains unknown or forbidden fields")
    if bundle["route"] != {"requested": ROUTE, "effective": ROUTE, "backend": BACKEND}:
        raise ValueError("recovery route identity mismatch")
    outer, coordinates = _fuse_visual_hull(bundle)
    layers = _inward_layers(outer)
    voxel_size = float((bundle["bounds"][1, 0] - bundle["bounds"][0, 0]) / (len(coordinates[0]) - 1))
    inward_distance = layers.astype(np.float64) * voxel_size
    uniform_depth = bundle["config"]["uniformDepth"]
    spatial_depth = _spatial_depth(coordinates, bundle["config"]["spatialPrior"])
    uniform = outer & (inward_distance > uniform_depth)
    spatial = outer & (inward_distance > spatial_depth)
    if not np.any(uniform):
        raise ValueError("uniform volumetric erosion produced a blank candidate")
    if not np.any(spatial):
        raise ValueError("spatial volumetric erosion produced a blank candidate")
    return {
        "schema": SCHEMA,
        "route": bundle["route"].copy(),
        "informationBoundary": "rendered-depth-silhouette-only",
        "bounds": bundle["bounds"].copy(),
        "gridSize": bundle["config"]["gridSize"],
        "voxelSize": voxel_size,
        "outerOccupancy": outer,
        "uniformOccupancy": uniform,
        "spatialOccupancy": spatial,
        "inwardDistance": inward_distance,
        "spatialDepthPrior": spatial_depth,
    }


def _boundary(mask):
    return mask & ~_erode_once(mask)


def _dilate_once(mask):
    result = mask.copy()
    result[1:, :, :] |= mask[:-1, :, :]
    result[:-1, :, :] |= mask[1:, :, :]
    result[:, 1:, :] |= mask[:, :-1, :]
    result[:, :-1, :] |= mask[:, 1:, :]
    result[:, :, 1:] |= mask[:, :, :-1]
    result[:, :, :-1] |= mask[:, :, 1:]
    return result


def _distance_layers_to(mask):
    if not np.any(mask):
        raise ValueError("distance target is blank")
    distance = np.full(mask.shape, -1, dtype=np.int16)
    reached = mask.copy()
    distance[mask] = 0
    layer = 0
    while np.any(distance < 0):
        layer += 1
        expanded = _dilate_once(reached)
        new = expanded & (distance < 0)
        distance[new] = layer
        reached = expanded
        if layer > sum(mask.shape):
            raise ValueError("distance expansion failed to cover the volume")
    return distance


def _silhouette_iou(candidate, truth):
    values = []
    for axis in range(3):
        candidate_silhouette = np.any(candidate, axis=axis)
        truth_silhouette = np.any(truth, axis=axis)
        union = np.count_nonzero(candidate_silhouette | truth_silhouette)
        intersection = np.count_nonzero(candidate_silhouette & truth_silhouette)
        value = float(intersection / union) if union else 1.0
        values.extend((value, value))
    return float(np.mean(values)), values


def _arm_metrics(candidate, truth, *, support, voxel_size, diagonal, truth_distance=None):
    intersection = np.count_nonzero(candidate & truth)
    union = np.count_nonzero(candidate | truth)
    candidate_count = np.count_nonzero(candidate)
    truth_count = np.count_nonzero(truth)
    candidate_boundary = _boundary(candidate)
    truth_boundary = _boundary(truth)
    distance_to_truth = truth_distance if truth_distance is not None else _distance_layers_to(truth_boundary)
    distance_to_candidate = _distance_layers_to(candidate_boundary)
    forward = float(np.mean(distance_to_truth[candidate_boundary]))
    reverse = float(np.mean(distance_to_candidate[truth_boundary]))
    boundary_error = 0.5 * (forward + reverse) * voxel_size
    support_truth_boundary = truth_boundary & support
    complement_truth_boundary = truth_boundary & ~support
    support_error = (
        float(np.mean(distance_to_candidate[support_truth_boundary])) * voxel_size
        if np.any(support_truth_boundary)
        else 0.0
    )
    complement_error = (
        float(np.mean(distance_to_candidate[complement_truth_boundary])) * voxel_size
        if np.any(complement_truth_boundary)
        else 0.0
    )
    mean_silhouette, per_view_silhouette = _silhouette_iou(candidate, truth)
    return {
        "occupancyIou": float(intersection / union) if union else 1.0,
        "relativeVolumeError": float((candidate_count - truth_count) / truth_count),
        "sourceNormalizedBoundaryError": float(boundary_error / diagonal),
        "sourceNormalizedSupportBoundaryError": float(support_error / diagonal),
        "sourceNormalizedComplementBoundaryError": float(complement_error / diagonal),
        "meanSixViewSilhouetteIou": mean_silhouette,
        "sixViewSilhouetteIou": per_view_silhouette,
        "voxelCount": int(candidate_count),
    }


def _relative_improvement(baseline, candidate):
    if baseline <= 1e-15:
        return 0.0 if candidate <= 1e-15 else -math.inf
    return float((baseline - candidate) / baseline)


def score_volume_candidates(recovery, truth_rendered, *, support_spec):
    """Open held-out truth after recovery artifacts exist and score both arms."""

    if recovery.get("schema") != SCHEMA or recovery.get("informationBoundary") != "rendered-depth-silhouette-only":
        raise ValueError("recovery artifact does not prove the rendered-observation boundary")
    truth_bundle = build_recovery_bundle(
        truth_rendered,
        grid_size=recovery["gridSize"],
        uniform_depth=0.0,
        spatial_prior={"baseDepth": 0.0, "amplitude": 0.0},
    )
    truth, coordinates = _fuse_visual_hull(truth_bundle)
    if not np.array_equal(truth_bundle["bounds"], recovery["bounds"]):
        raise ValueError("truth and recovery scoring bounds differ")
    required_support = {"id", "dorsalStart", "apMin", "apMax"}
    if not isinstance(support_spec, dict) or set(support_spec) != required_support:
        raise ValueError("support_spec must contain only the scoring support contract")
    if support_spec["id"] != "bounded-dorsal-ap-procedural-support-v0":
        raise ValueError("support scoring identity mismatch")
    dorsal_start = float(support_spec["dorsalStart"])
    ap_min = float(support_spec["apMin"])
    ap_max = float(support_spec["apMax"])
    if not 0.0 <= dorsal_start <= 1.0 or not 0.0 <= ap_min <= ap_max <= 1.0:
        raise ValueError("support scoring bounds are invalid")
    unit_y = (coordinates[1] - coordinates[1][0]) / (coordinates[1][-1] - coordinates[1][0])
    unit_z = (coordinates[2] - coordinates[2][0]) / (coordinates[2][-1] - coordinates[2][0])
    support = (
        (1.0 - unit_y[None, :, None] >= dorsal_start)
        & (unit_z[None, None, :] >= ap_min)
        & (unit_z[None, None, :] <= ap_max)
    )
    support = np.broadcast_to(support, truth.shape)
    diagonal = float(np.linalg.norm(recovery["bounds"][1] - recovery["bounds"][0]))
    truth_distance = _distance_layers_to(_boundary(truth))
    arms = {
        "uniform": _arm_metrics(
            recovery["uniformOccupancy"],
            truth,
            support=support,
            voxel_size=recovery["voxelSize"],
            diagonal=diagonal,
            truth_distance=truth_distance,
        ),
        "spatial": _arm_metrics(
            recovery["spatialOccupancy"],
            truth,
            support=support,
            voxel_size=recovery["voxelSize"],
            diagonal=diagonal,
            truth_distance=truth_distance,
        ),
    }
    uniform = arms["uniform"]
    spatial = arms["spatial"]
    improvements = {
        "globalBoundary": _relative_improvement(
            uniform["sourceNormalizedBoundaryError"], spatial["sourceNormalizedBoundaryError"]
        ),
        "supportBoundary": _relative_improvement(
            uniform["sourceNormalizedSupportBoundaryError"],
            spatial["sourceNormalizedSupportBoundaryError"],
        ),
        "complementBoundary": _relative_improvement(
            uniform["sourceNormalizedComplementBoundaryError"],
            spatial["sourceNormalizedComplementBoundaryError"],
        ),
        "silhouetteDelta": float(
            spatial["meanSixViewSilhouetteIou"] - uniform["meanSixViewSilhouetteIou"]
        ),
    }
    advances = (
        improvements["globalBoundary"] >= 0.05
        and improvements["supportBoundary"] >= 0.15
        and improvements["complementBoundary"] >= -0.05
        and improvements["silhouetteDelta"] >= -0.005
    )
    return {
        "schema": SCHEMA,
        "truthAccessPhase": "post-recovery-scoring-only",
        "truthRole": "authenticated-carrier-rendered-visual-hull-scoring-proxy",
        "supportRole": "held-out-procedural-support-scoring-only",
        "arms": arms,
        "improvements": improvements,
        "classification": "ADVANCE_SPATIAL_PRIOR" if advances else "UNIFORM_CONTROL_HOLDS",
        "thresholds": {
            "globalBoundaryImprovement": 0.05,
            "supportBoundaryImprovement": 0.15,
            "maximumComplementBoundaryWorsening": 0.05,
            "maximumSilhouetteIouLoss": 0.005,
        },
    }
