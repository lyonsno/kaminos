"""Export admitted anatomical surfaces from a Blender source as a triangle mesh.

Emits real evaluated surface geometry, not bounding boxes or hulls. Proportional
relation measurement over bounding boxes systematically overestimates thin
diagonal structures such as long limb bones, so any measurement that depends on
mass distribution needs true surfaces.

Never mutates, saves, exports over, or relinks the operator's source. The source
is opened read-only by Blender and its SHA-256 is verified against the caller's
expectation before any geometry is read.

Writes a durable failure record naming the phase if it fails before emitting its
primary artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import bpy

SCHEMA = "kaminos.admitted-surface-export.v0"
FAILURE_SCHEMA = "kaminos.admitted-surface-export-failure.v0"
EXPORTER_ID = "blender-admitted-surface-triangles-v0"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--classification", required=False)
    parser.add_argument(
        "--classify-in-place",
        action="store_true",
        help=(
            "Derive admission from live scene state instead of a prior classification. "
            "Applies the same rules as the campaign classifier -- mesh, visible in every "
            "sense, not construction paint, not a semantic-control surface -- but without "
            "its hardcoded source SHA and per-object rescue list, so it runs on any "
            "source revision."
        ),
    )
    parser.add_argument("--out", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _admit(obj: Any) -> dict[str, Any]:
    """Admission rules mirroring the campaign classifier, minus its source pinning.

    Mesh, visible in viewport / render / view layer, not construction paint, not a
    semantic-control surface. Muscle surfaces are admitted on their CMK role or
    ` | Surface` suffix; anything in the authoring collection is admitted.
    """
    if obj.type != "MESH":
        return {"admitted": False, "reason": "non_mesh_object"}
    if obj.name.endswith(" | Origin Paint") or obj.name.endswith(" | Insertion Paint"):
        return {"admitted": False, "reason": "construction_paint_surface"}
    if obj.hide_viewport or obj.hide_render or not obj.visible_get():
        return {"admitted": False, "reason": "hidden_source_surface"}

    collections = [c.name for c in obj.users_collection]
    full = []
    for c in obj.users_collection:
        parts, node = [c.name], c
        while True:
            parents = [p for p in bpy.data.collections if node.name in [x.name for x in p.children]]
            if not parents:
                break
            node = parents[0]
            parts.insert(0, node.name)
        full.append("/".join(parts))

    if any(p.startswith("Constructional Model/90 Semantics") for p in full):
        return {"admitted": False, "reason": "semantic_control_surface"}
    if "Collection" in collections:
        return {"admitted": True, "role": "authored_mesh", "basis": "authoring_collection"}
    if any(p.startswith("Constructional Model/20 Muscle") for p in full):
        if obj.get("cmk_role") == "muscle_surface_provisional" or obj.name.endswith(" | Surface"):
            return {"admitted": True, "role": "muscle_surface", "basis": "cmk_muscle_surface"}
        return {"admitted": False, "reason": "muscle_control_object"}
    if any(p.startswith("Constructional Model/10 Structure") for p in full):
        return {"admitted": True, "role": "authored_mesh", "basis": "structure_collection"}
    return {"admitted": True, "role": "authored_mesh", "basis": "visible_mesh"}


def main() -> int:
    args = _arguments()
    Path(args.failure).unlink(missing_ok=True)

    source = Path(bpy.data.filepath).resolve()
    requested = Path(args.source).expanduser().resolve()
    if source != requested:
        raise ValueError(f"requested source {requested} does not match open Blender file {source}")
    source_sha256 = _sha256(source)
    if source_sha256 != args.expected_source_sha256:
        raise ValueError("source SHA-256 mismatch; refusing to export from an unexpected source")

    if args.classify_in_place:
        admitted = []
        rejected = []
        for obj in bpy.context.scene.objects:
            verdict = _admit(obj)
            if verdict["admitted"]:
                admitted.append({"name": obj.name, "role": verdict["role"],
                                 "admissionBasis": verdict["basis"],
                                 "collections": [c.name for c in obj.users_collection]})
            else:
                rejected.append({"name": obj.name, "reason": verdict["reason"]})
        if not admitted:
            raise ValueError("in-place classification admitted no surfaces")
        classification = {
            "status": "completed",
            "schema": "kaminos.in-place-source-classification.v0",
            "source": {"sha256": source_sha256},
            "admittedObjects": admitted,
            "rejectedObjects": rejected,
        }
        classification_path = None
    else:
        if not args.classification:
            raise ValueError("--classification is required unless --classify-in-place is set")
        classification_path = Path(args.classification).resolve()
        classification = json.loads(classification_path.read_text(encoding="utf-8"))
    if classification.get("status") != "completed":
        raise ValueError("classification is not completed")
    if classification.get("source", {}).get("sha256") != source_sha256:
        raise ValueError(
            "classification source SHA-256 does not match the open source; "
            "refusing to pair a classification with a different revision"
        )
    admitted = classification.get("admittedObjects")
    if not isinstance(admitted, list) or not admitted:
        raise ValueError("classification contains no admitted source objects")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    positions: list[list[float]] = []
    triangles: list[list[int]] = []
    records: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for record in sorted(admitted, key=lambda item: item["name"]):
        name = record["name"]
        source_object = bpy.data.objects.get(name)
        if source_object is None:
            raise ValueError(f"classified source object is missing from the scene: {name}")
        evaluated = source_object.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            if len(mesh.vertices) == 0 or len(mesh.polygons) == 0:
                skipped.append({"sourceObjectName": name, "reason": "no_evaluated_geometry"})
                continue
            matrix = evaluated.matrix_world
            base = len(positions)
            for vertex in mesh.vertices:
                world = matrix @ vertex.co
                positions.append([world.x, world.y, world.z])
            mesh.calc_loop_triangles()
            triangle_count = 0
            for triangle in mesh.loop_triangles:
                triangles.append([base + index for index in triangle.vertices])
                triangle_count += 1
            records.append({
                "sourceObjectName": name,
                "sourceRole": record.get("role"),
                "admissionBasis": record.get("admissionBasis"),
                "collections": record.get("collections", []),
                "vertexCount": len(mesh.vertices),
                "triangleCount": triangle_count,
                "vertexOffset": base,
            })
        finally:
            evaluated.to_mesh_clear()

    if not triangles:
        raise ValueError("no admitted surface triangles were exported")

    payload = {
        "schema": SCHEMA,
        "exporterId": EXPORTER_ID,
        "source": {"path": str(source), "sha256": source_sha256},
        "positions": positions,
        "triangles": triangles,
        "objects": records,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    if not out_path.is_file() or out_path.stat().st_size < 1024:
        raise ValueError("exported surface payload is missing or implausibly small")

    _write_json(args.manifest, {
        "schema": SCHEMA,
        "exporterId": EXPORTER_ID,
        "status": "completed",
        "authority": "evaluated source surfaces; no source mutation",
        "source": {
            "requestedPath": str(requested),
            "effectivePath": str(source),
            "sha256": source_sha256,
        },
        "classification": {
            "path": str(classification_path) if classification_path else "in-place",
            "sha256": _sha256(classification_path) if classification_path else None,
            "mode": "in-place" if args.classify_in_place else "prior-classification",
            "admittedObjectCount": len(admitted),
        },
        "exportedObjectCount": len(records),
        "skippedSourceObjects": skipped,
        "vertexCount": len(positions),
        "triangleCount": len(triangles),
        "effectiveRoute": {
            "blenderVersion": bpy.app.version_string,
            "exporterId": EXPORTER_ID,
        },
        "output": {
            "path": str(out_path),
            "byteLength": out_path.stat().st_size,
            "sha256": _sha256(out_path),
        },
    })
    print(json.dumps({
        "status": "completed",
        "vertexCount": len(positions),
        "triangleCount": len(triangles),
        "exportedObjectCount": len(records),
    }))
    return 0


if __name__ == "__main__":
    arguments: argparse.Namespace | None = None
    try:
        arguments = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = arguments.failure if arguments else os.environ.get("KAMINOS_SURFACE_EXPORT_FAILURE")
        if failure_path:
            _write_json(failure_path, {
                "schema": FAILURE_SCHEMA,
                "exporterId": EXPORTER_ID,
                "status": "failed",
                "failurePhase": "admitted-surface-export",
                "error": str(error),
                "lastTrustworthyEvidence": "source opened; no surface payload was emitted",
            })
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
