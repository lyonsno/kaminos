"""Generate a static groom only after explicit visual carrier selection."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

from carrier_shell_recovery import (  # noqa: E402
    resolve_visual_selection,
    verify_source,
    write_failure_report,
)
from run_carrier_recovery_blender import (  # noqa: E402
    bounds,
    create_static_groom,
    export_glb,
    imported_target,
    make_material,
    render_beauty,
)


LAST_EVIDENCE = {"phase": "not-started"}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    global LAST_EVIDENCE
    output_root = args.output_root.resolve()
    failure_path = output_root / "finalize-failure.json"
    failure_path.unlink(missing_ok=True)
    campaign = json.loads((output_root / "campaign.json").read_text())
    sweep = json.loads((output_root / "result.json").read_text())
    selection = json.loads((output_root / "carrier-selection.json").read_text())
    observed_sweep_sha = sha256(output_root / "result.json")
    if observed_sweep_sha != selection["sweepResultSha256"]:
        raise ValueError("carrier selection does not bind the current sweep result")
    chosen = resolve_visual_selection(sweep["candidates"], selection)
    mesh_path = output_root / chosen["meshPath"]
    verify_source(mesh_path, selection["chosenMeshSha256"])
    for view in selection["inspectedViews"]:
        verify_source(output_root / view["path"], view["sha256"])
    LAST_EVIDENCE = {
        "phase": "visual-selection-authenticated",
        "sweepResultSha256": observed_sweep_sha,
        "chosenCandidate": chosen["name"],
        "chosenMeshSha256": selection["chosenMeshSha256"],
    }

    shell = imported_target(mesh_path)
    shell.name = "visually-selected-carrier"
    minimum, maximum, extents = bounds(shell)
    center = (minimum + maximum) * 0.5
    span = float(extents.max())
    flat_view = output_root / "views" / "selected-carrier-flat.png"
    render_beauty(
        [shell],
        flat_view,
        center,
        span,
        [make_material("selected-carrier-flat", (0.58, 0.55, 0.48, 1.0))],
    )
    for polygon in shell.data.polygons:
        polygon.use_smooth = True
    smooth_view = output_root / "views" / "selected-carrier-smooth.png"
    render_beauty(
        [shell],
        smooth_view,
        center,
        span,
        [make_material("selected-carrier-smooth", (0.32, 0.29, 0.24, 1.0))],
    )
    groom = create_static_groom(shell, campaign["staticGroom"])
    groom_view = output_root / "views" / "selected-carrier-with-static-groom.png"
    render_beauty(
        [shell, groom],
        groom_view,
        center,
        span,
        [
            make_material("groom-carrier", (0.19, 0.17, 0.13, 1.0)),
            make_material("replacement-fur", (0.66, 0.38, 0.11, 1.0)),
        ],
    )
    output_mesh = output_root / "meshes" / "selected-carrier-with-static-groom.glb"
    export_glb([shell, groom], output_mesh)
    result = {
        "schema": "kaminos.mlx-malformed-coat-carrier-recovery-final-result.v0",
        "runId": args.run_id,
        "sweepResultSha256": observed_sweep_sha,
        "carrierSelectionSha256": sha256(output_root / "carrier-selection.json"),
        "chosenCandidate": chosen,
        "staticGroom": {
            **campaign["staticGroom"],
            "implementation": "deterministic crossed-ribbon strands from selected carrier surface normals",
        },
        "outputs": {
            "carrierFlatView": {"path": str(flat_view.relative_to(output_root)), "sha256": sha256(flat_view)},
            "carrierSmoothView": {"path": str(smooth_view.relative_to(output_root)), "sha256": sha256(smooth_view)},
            "carrierWithGroomView": {"path": str(groom_view.relative_to(output_root)), "sha256": sha256(groom_view)},
            "carrierWithGroomMesh": {"path": str(output_mesh.relative_to(output_root)), "sha256": sha256(output_mesh)},
        },
        "visualAdmission": "pending-agent-inspection",
        "claimCeiling": campaign["claimCeiling"],
    }
    (output_root / "final-result.json").write_text(json.dumps(result, indent=2) + "\n")
    LAST_EVIDENCE = {**LAST_EVIDENCE, "phase": "final-result-written"}


def main():
    args = parse_args()
    try:
        run(args)
    except Exception as error:
        write_failure_report(
            args.output_root.resolve() / "finalize-failure.json",
            phase=LAST_EVIDENCE.get("phase", "unknown"),
            error=f"{type(error).__name__}: {error}",
            last_trustworthy_evidence=LAST_EVIDENCE,
        )
        raise


if __name__ == "__main__":
    main()
