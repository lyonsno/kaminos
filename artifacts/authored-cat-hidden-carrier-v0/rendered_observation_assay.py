"""Durable correspondence-free rendered-observation carrier assay."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from export_hidden_carrier_surfaces import _source_topology
from hidden_carrier_fixture import (
    SOURCE_SHA256,
    _sha256,
    coat_depths,
    load_glb_surface,
    synthesize_observation,
)
from rendered_observation_volume import (
    BACKEND,
    ROUTE,
    SCHEMA,
    VIEW_IDS,
    build_recovery_bundle,
    recover_volume_candidates,
    render_orthographic_views,
    score_volume_candidates,
)


REPORT_NAME = "report.json"
STATE_NAME = "run-state.json"
OBSERVATION_NAME = "rendered-observation.npz"
RECOVERY_NAME = "recovered-volumes.npz"
KNOWN_OUTPUTS = (OBSERVATION_NAME, RECOVERY_NAME)
PROFILE = "short-with-bounded-dorsal-ap-support-v0"
FIXTURE_PROFILE = "short-with-medium-scapular-v0"
RECOVERY_ARM = "uniform-and-provisional-spatial-volume-erosion-v0"


class RenderedObservationAssayFailure(RuntimeError):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_npz(path, **arrays):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w+b", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            np.savez_compressed(handle, **arrays)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _locator(path, repo_root):
    path = Path(path).resolve()
    try:
        return path.relative_to(Path(repo_root).resolve()).as_posix() or "."
    except ValueError:
        digest = hashlib.sha256(str(path).encode()).hexdigest()[:16]
        return f"external-path:{path.name}:{digest}"


def _implementation_identity(repo_root):
    repo_root = Path(repo_root).resolve()
    result = {}
    for role, path in (
        ("runner", Path(__file__).resolve()),
        ("volume", Path(__file__).resolve().with_name("rendered_observation_volume.py")),
        ("fixture", Path(__file__).resolve().with_name("hidden_carrier_fixture.py")),
    ):
        try:
            locator = path.relative_to(repo_root).as_posix()
        except ValueError as error:
            raise RenderedObservationAssayFailure(
                f"{role} implementation is outside the explicit repo root"
            ) from error
        result[role] = {"path": locator, "sha256": _sha256(path)}
    return result


def _observation_arrays(rendered):
    arrays = {
        "bounds": np.asarray(rendered["bounds"], dtype=np.float64),
        "rasterSize": np.asarray([rendered["rasterSize"]], dtype=np.int64),
    }
    for view_id in VIEW_IDS:
        token = view_id.replace("+", "p").replace("-", "m")
        arrays[f"depth_{token}"] = np.asarray(rendered["views"][view_id]["depth"], dtype=np.float32)
        arrays[f"mask_{token}"] = np.asarray(rendered["views"][view_id]["mask"], dtype=np.uint8)
    return arrays


def _load_observation(path):
    allowed = {"bounds", "rasterSize"}
    for view_id in VIEW_IDS:
        token = view_id.replace("+", "p").replace("-", "m")
        allowed.update((f"depth_{token}", f"mask_{token}"))
    try:
        with np.load(path, allow_pickle=False) as archive:
            if set(archive.files) != allowed:
                raise RenderedObservationAssayFailure(
                    f"observation artifact fields violate information firewall: {sorted(archive.files)}"
                )
            bounds = np.asarray(archive["bounds"], dtype=np.float64)
            raster_size_array = np.asarray(archive["rasterSize"])
            if bounds.shape != (2, 3) or raster_size_array.shape != (1,):
                raise RenderedObservationAssayFailure("observation metadata shape mismatch")
            raster_size = int(raster_size_array[0])
            views = {}
            for view_id in VIEW_IDS:
                token = view_id.replace("+", "p").replace("-", "m")
                axis = "XYZ".index(view_id[-1])
                u_axis, v_axis = ({0: (1, 2), 1: (2, 0), 2: (1, 0)})[axis]
                views[view_id] = {
                    "axis": axis,
                    "sign": 1 if view_id[0] == "+" else -1,
                    "uAxis": u_axis,
                    "vAxis": v_axis,
                    "depthConvention": "world-axis-first-surface-coordinate",
                    "depth": np.asarray(archive[f"depth_{token}"], dtype=np.float64),
                    "mask": np.asarray(archive[f"mask_{token}"], dtype=bool),
                }
    except RenderedObservationAssayFailure:
        raise
    except Exception as error:
        raise RenderedObservationAssayFailure(f"observation artifact is unreadable: {error}") from error
    return {
        "schema": SCHEMA,
        "route": ROUTE,
        "backend": BACKEND,
        "observationClass": "six-view-orthographic-depth-and-silhouette",
        "bounds": bounds,
        "rasterSize": raster_size,
        "views": views,
    }


def _artifact(path, *, arrays):
    path = Path(path)
    if not path.is_file() or path.stat().st_size <= 0:
        raise RenderedObservationAssayFailure(f"primary artifact is missing or blank: {path.name}")
    with np.load(path, allow_pickle=False) as archive:
        if set(archive.files) != set(arrays):
            raise RenderedObservationAssayFailure(
                f"{path.name} fields differ from contract: {sorted(archive.files)}"
            )
        descriptors = {}
        for name in arrays:
            value = np.asarray(archive[name])
            if not np.issubdtype(value.dtype, np.number) or not np.isfinite(value).all():
                raise RenderedObservationAssayFailure(f"{path.name}:{name} is not finite numeric data")
            descriptors[name] = {"shape": list(value.shape), "dtype": str(value.dtype)}
    return {
        "path": path.name,
        "sha256": _sha256(path),
        "byteLength": path.stat().st_size,
        "arrays": descriptors,
    }


def _base_report(*, execution_id, requested, prior_report_sha256):
    return {
        "schema": SCHEMA,
        "executionId": execution_id,
        "status": "running",
        "terminal": False,
        "startedAt": _now(),
        "finishedAt": None,
        "failurePhase": None,
        "reason": None,
        "requestedConfig": requested,
        "effectiveConfig": None,
        "source": None,
        "informationFirewall": {
            "recoveryInputs": "rendered-depth-silhouette-camera-bounds-and-declared-prior-only",
            "forbidden": [
                "source-positions",
                "source-triangles",
                "source-vertex-ids",
                "authored-carrier-normals",
                "authored-coat-depths",
                "authored-procedural-support",
                "pre-recovery-source-correspondence",
            ],
            "truthAccessPhase": "post-recovery-scoring-only",
        },
        "artifacts": {},
        "score": None,
        "implementation": None,
        "priorTerminalReportSha256": prior_report_sha256,
        "lastTrustworthyEvidence": {},
    }


def run_assay(
    *,
    repo_root,
    source_path,
    output_dir,
    route=ROUTE,
    raster_size=160,
    grid_size=129,
    uniform_depth=0.94,
    spatial_base_depth=0.94,
    spatial_amplitude=1.0,
    spatial_dorsal_start=0.40,
    spatial_ap_center=0.65,
    spatial_ap_width=0.24,
):
    repo_root = Path(repo_root).resolve()
    source_path = Path(source_path).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / REPORT_NAME
    prior_report_sha256 = _sha256(report_path) if report_path.is_file() else None
    for name in (*KNOWN_OUTPUTS, REPORT_NAME, STATE_NAME):
        (output_dir / name).unlink(missing_ok=True)

    execution_id = str(uuid.uuid4())
    requested = {
        "repoRoot": ".",
        "sourcePath": _locator(source_path, repo_root),
        "outputDir": _locator(output_dir, repo_root),
        "route": route,
        "backend": BACKEND,
        "profile": PROFILE,
        "recoveryArm": RECOVERY_ARM,
        "rasterSize": raster_size,
        "gridSize": grid_size,
        "uniformDepth": uniform_depth,
        "spatialPrior": {
            "baseDepth": spatial_base_depth,
            "amplitude": spatial_amplitude,
            "dorsalStart": spatial_dorsal_start,
            "apCenter": spatial_ap_center,
            "apWidth": spatial_ap_width,
            "authority": "agent-authored-provisional-pre-implementation",
        },
    }
    report = _base_report(
        execution_id=execution_id,
        requested=requested,
        prior_report_sha256=prior_report_sha256,
    )
    _write_json(output_dir / STATE_NAME, report)
    phase = "input-validation"
    try:
        if route != ROUTE:
            raise RenderedObservationAssayFailure(f"unsupported route with no fallback: {route}")
        if _sha256(source_path) != SOURCE_SHA256:
            raise RenderedObservationAssayFailure("authenticated source digest mismatch")
        implementation = _implementation_identity(repo_root)
        surface = load_glb_surface(source_path)
        triangles = _source_topology(source_path, expected_vertex_count=len(surface["positions"]))
        depths = coat_depths(surface["positions"], FIXTURE_PROFILE)
        outer_positions = synthesize_observation(surface["positions"], surface["normals"], depths)
        bounds = None
        phase = "truth-side-observation-render"
        rendered = render_orthographic_views(
            outer_positions, triangles, raster_size=raster_size, bounds=bounds
        )
        observation_path = output_dir / OBSERVATION_NAME
        observation_arrays = _observation_arrays(rendered)
        _write_npz(observation_path, **observation_arrays)
        observation_artifact = _artifact(observation_path, arrays=observation_arrays)
        report["lastTrustworthyEvidence"] = {"observation": observation_artifact}
        _write_json(output_dir / STATE_NAME, report)

        phase = "recovery-input-firewall"
        recovery_rendered = _load_observation(observation_path)
        bundle = build_recovery_bundle(
            recovery_rendered,
            grid_size=grid_size,
            uniform_depth=uniform_depth,
            spatial_prior={
                "baseDepth": spatial_base_depth,
                "amplitude": spatial_amplitude,
                "dorsalStart": spatial_dorsal_start,
                "apCenter": spatial_ap_center,
                "apWidth": spatial_ap_width,
            },
        )
        phase = "rendered-observation-volume-recovery"
        recovery = recover_volume_candidates(bundle)
        recovery_arrays = {
            "bounds": np.asarray(recovery["bounds"], dtype=np.float64),
            "outerOccupancy": np.asarray(recovery["outerOccupancy"], dtype=np.uint8),
            "uniformOccupancy": np.asarray(recovery["uniformOccupancy"], dtype=np.uint8),
            "spatialOccupancy": np.asarray(recovery["spatialOccupancy"], dtype=np.uint8),
            "inwardDistance": np.asarray(recovery["inwardDistance"], dtype=np.float32),
            "spatialDepthPrior": np.asarray(recovery["spatialDepthPrior"], dtype=np.float32),
        }
        recovery_path = output_dir / RECOVERY_NAME
        _write_npz(recovery_path, **recovery_arrays)
        recovery_artifact = _artifact(recovery_path, arrays=recovery_arrays)
        report["lastTrustworthyEvidence"]["recovery"] = recovery_artifact
        _write_json(output_dir / STATE_NAME, report)

        phase = "held-out-truth-scoring"
        truth_rendered = render_orthographic_views(
            surface["positions"], triangles, raster_size=raster_size, bounds=rendered["bounds"]
        )
        score = score_volume_candidates(
            recovery,
            truth_rendered,
            support_spec={
                "id": "bounded-dorsal-ap-procedural-support-v0",
                "dorsalStart": 0.45,
                "apMin": 0.45,
                "apMax": 0.85,
            },
        )
        report.update(
            {
                "status": "captured",
                "terminal": True,
                "finishedAt": _now(),
                "effectiveConfig": requested | {"route": ROUTE, "backend": BACKEND},
                "source": {
                    "path": _locator(source_path, repo_root),
                    "sha256": SOURCE_SHA256,
                    "contentClass": "operator-authored-carrier-export-held-out-scoring-truth",
                },
                "artifacts": {
                    "renderedObservation": observation_artifact,
                    "recoveredVolumes": recovery_artifact,
                },
                "score": score,
                "implementation": implementation,
                "lastTrustworthyEvidence": {
                    "observation": observation_artifact,
                    "recovery": recovery_artifact,
                    "heldOutScoreClassification": score["classification"],
                },
                "claimCeiling": (
                    "Source-specific correspondence-free six-view volumetric recovery comparison under "
                    "one agent-authored provisional spatial prior; not arbitrary-source coat estimation, "
                    "anatomy, coherent production topology, grooming, or deformation evidence."
                ),
                "safetyCharacterization": (
                    "Deterministic isolated authored-cat depth, silhouette, and binary-volume evidence; "
                    "no generator output or hostile biological imagery."
                ),
                "operatorVisualAdmission": "not-requested",
            }
        )
        _write_json(report_path, report)
        _write_json(output_dir / STATE_NAME, report)
        return report
    except Exception as error:
        for name in KNOWN_OUTPUTS:
            if name not in {
                evidence.get("path")
                for evidence in report.get("lastTrustworthyEvidence", {}).values()
                if isinstance(evidence, dict)
            }:
                (output_dir / name).unlink(missing_ok=True)
        report.update(
            {
                "status": "failed",
                "terminal": True,
                "finishedAt": _now(),
                "failurePhase": phase,
                "reason": str(error),
            }
        )
        _write_json(report_path, report)
        _write_json(output_dir / STATE_NAME, report)
        return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--route", default=ROUTE)
    parser.add_argument("--raster-size", type=int, default=160)
    parser.add_argument("--grid-size", type=int, default=129)
    parser.add_argument("--uniform-depth", type=float, default=0.94)
    parser.add_argument("--spatial-base-depth", type=float, default=0.94)
    parser.add_argument("--spatial-amplitude", type=float, default=1.0)
    parser.add_argument("--spatial-dorsal-start", type=float, default=0.40)
    parser.add_argument("--spatial-ap-center", type=float, default=0.65)
    parser.add_argument("--spatial-ap-width", type=float, default=0.24)
    args = parser.parse_args(argv)
    report = run_assay(
        repo_root=args.repo_root,
        source_path=args.source,
        output_dir=args.output_dir,
        route=args.route,
        raster_size=args.raster_size,
        grid_size=args.grid_size,
        uniform_depth=args.uniform_depth,
        spatial_base_depth=args.spatial_base_depth,
        spatial_amplitude=args.spatial_amplitude,
        spatial_dorsal_start=args.spatial_dorsal_start,
        spatial_ap_center=args.spatial_ap_center,
        spatial_ap_width=args.spatial_ap_width,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "captured" else 1


if __name__ == "__main__":
    raise SystemExit(main())
