"""Read-only Blender scene extractor for the Track M authored source graph."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import bpy


SCHEMA = "kaminos.track-m-blender-extraction.v0"
FAILURE_SCHEMA = "kaminos.track-m-blender-extraction-failure.v0"
EXTRACTOR_ID = "blender-track-m-source-extract-v0"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--failure", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(argv)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("custom property contains a non-finite float")
        return 0.0 if value == 0 else value
    if hasattr(value, "to_list"):
        return _json_value(value.to_list())
    if hasattr(value, "items"):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)) or hasattr(value, "__iter__"):
        return [_json_value(item) for item in value]
    raise TypeError(f"unsupported Blender property value {type(value).__name__}")


def _properties(owner: Any) -> dict[str, Any]:
    return {
        key: _json_value(owner[key])
        for key in sorted(owner.keys())
        if key != "_RNA_UI"
    }


def _rounded(value: float) -> float:
    result = round(float(value), 9)
    return 0.0 if result == 0 else result


def _vec(values: Any) -> list[float]:
    return [_rounded(value) for value in values]


def _matrix_world(obj: bpy.types.Object) -> list[float]:
    return [_rounded(obj.matrix_world[row][column]) for row in range(4) for column in range(4)]


def _mesh_geometry(mesh: bpy.types.Mesh) -> dict[str, Any]:
    content = {
        "vertices": [_vec(vertex.co) for vertex in mesh.vertices],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
        "shapeKeys": sorted(block.name for block in mesh.shape_keys.key_blocks) if mesh.shape_keys else [],
    }
    return {
        "kind": "mesh",
        "contentSha256": _sha256_bytes(_canonical_bytes(content)),
        "vertexCount": len(mesh.vertices),
        "edgeCount": len(mesh.edges),
        "polygonCount": len(mesh.polygons),
        "shapeKeyCount": len(content["shapeKeys"]),
    }


def _curve_geometry(curve: bpy.types.Curve) -> dict[str, Any]:
    splines: list[dict[str, Any]] = []
    point_count = 0
    for spline in curve.splines:
        if spline.type == "BEZIER":
            points = [
                {
                    "co": _vec(point.co),
                    "handleLeft": _vec(point.handle_left),
                    "handleRight": _vec(point.handle_right),
                    "handleLeftType": point.handle_left_type,
                    "handleRightType": point.handle_right_type,
                }
                for point in spline.bezier_points
            ]
        else:
            points = [{"co": _vec(point.co)} for point in spline.points]
        point_count += len(points)
        splines.append({"type": spline.type, "cyclic": bool(spline.use_cyclic_u), "points": points})
    content = {
        "dimensions": curve.dimensions,
        "resolutionU": curve.resolution_u,
        "bevelDepth": _rounded(curve.bevel_depth),
        "bevelResolution": curve.bevel_resolution,
        "splines": splines,
    }
    return {
        "kind": "curve",
        "contentSha256": _sha256_bytes(_canonical_bytes(content)),
        "splineCount": len(splines),
        "pointCount": point_count,
    }


def _collection_paths(scene: bpy.types.Scene) -> dict[bpy.types.Collection, str]:
    paths: dict[bpy.types.Collection, str] = {}

    def visit(collection: bpy.types.Collection, prefix: tuple[str, ...]) -> None:
        current = (*prefix, collection.name)
        paths[collection] = "/".join(current)
        for child in collection.children:
            visit(child, current)

    for child in scene.collection.children:
        visit(child, ())
    return paths


def _object_record(obj: bpy.types.Object, collection_paths: dict[bpy.types.Collection, str]) -> dict[str, Any]:
    geometry = None
    if obj.type == "MESH":
        geometry = _mesh_geometry(obj.data)
    elif obj.type == "CURVE":
        geometry = _curve_geometry(obj.data)
    modifiers: list[dict[str, Any]] = []
    for modifier in obj.modifiers:
        record: dict[str, Any] = {
            "name": modifier.name,
            "type": modifier.type,
            "showViewport": bool(modifier.show_viewport),
            "showRender": bool(modifier.show_render),
        }
        if modifier.type == "MIRROR":
            record.update(
                {
                    "useAxis": [bool(value) for value in modifier.use_axis],
                    "useClip": bool(modifier.use_clip),
                    "useMirrorMerge": bool(modifier.use_mirror_merge),
                    "mergeThreshold": _rounded(modifier.merge_threshold),
                    "useBisectAxis": [bool(value) for value in modifier.use_bisect_axis],
                    "useBisectFlipAxis": [bool(value) for value in modifier.use_bisect_flip_axis],
                    "mirrorObject": modifier.mirror_object.name if modifier.mirror_object else None,
                }
            )
        modifiers.append(record)
    return {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "collections": sorted(collection_paths.get(collection, collection.name) for collection in obj.users_collection),
        "matrixWorld": _matrix_world(obj),
        "customProperties": _properties(obj),
        "geometry": geometry,
        "modifiers": modifiers,
    }


def main() -> int:
    args = _arguments()
    requested_source = str(Path(args.source).expanduser())
    effective_source = str(Path(bpy.data.filepath).resolve())
    source_bytes = Path(effective_source).read_bytes()
    source_sha256 = _sha256_bytes(source_bytes)
    if str(Path(requested_source).resolve()) != effective_source:
        raise ValueError(f"requested source {requested_source} does not match open Blender file {effective_source}")
    if source_sha256 != args.expected_source_sha256:
        raise ValueError("source SHA-256 mismatch")
    scene = bpy.context.scene
    collection_paths = _collection_paths(scene)
    extraction = {
        "schema": SCHEMA,
        "extractorId": EXTRACTOR_ID,
        "status": "completed",
        "source": {
            "requestedPath": requested_source,
            "effectivePath": effective_source,
            "sha256": source_sha256,
            "byteLength": len(source_bytes),
        },
        "blender": {"version": bpy.app.version_string},
        "scene": {
            "name": scene.name,
            "frame": scene.frame_current,
            "unitSettings": {
                "system": scene.unit_settings.system,
                "lengthUnit": scene.unit_settings.length_unit or "NONE",
                "scaleLength": _rounded(scene.unit_settings.scale_length),
            },
        },
        "objects": [
            _object_record(obj, collection_paths)
            for obj in sorted(scene.objects, key=lambda item: item.name)
        ],
    }
    _write_json(args.out, extraction)
    print(json.dumps({"status": "completed", "outputPath": str(Path(args.out).resolve()), "sourceSha256": source_sha256}))
    return 0


if __name__ == "__main__":
    args_for_failure: argparse.Namespace | None = None
    try:
        args_for_failure = _arguments()
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        failure_path = args_for_failure.failure if args_for_failure else os.environ.get("KAMINOS_TRACK_M_EXTRACTION_FAILURE")
        report = {
            "schema": FAILURE_SCHEMA,
            "extractorId": EXTRACTOR_ID,
            "status": "failed",
            "failurePhase": "source-extraction",
            "error": str(error),
            "lastTrustworthyEvidence": "Blender process opened the requested scene; no extraction graph was admitted",
        }
        if failure_path:
            _write_json(failure_path, report)
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
