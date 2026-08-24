#!/usr/bin/env python3
"""Export the operator-authored packing fixture family into a deterministic sweep manifest."""

import argparse
import bmesh
import bpy
import hashlib
import json
import math
import os
import sys
import tempfile
import traceback
from mathutils import Vector
from mathutils.bvhtree import BVHTree


SCHEMA = "kaminos.authored-packing-sweep-manifest.v0"
IDENTITY_QUANTIZATION = 1_000_000_000
MEMBERS = ["muscle_1", "muscle_2", "tendon_1", "muscle_3", "muscle_4", "tendon_2"]
MEMBER_IDS = ["muscle-1", "muscle-2", "tendon-1", "muscle-3", "muscle-4", "tendon-2"]
VARIANTS = {
    "clean": {
        "id": "packing-fixture-v001-clean",
        "role": "clean-reference",
        "collection": "noninterpenetrating_packing_fixture",
        "suffix": "",
    },
    "mild": {
        "id": "packing-fixture-v001-mild",
        "role": "mild-interpenetration",
        "collection": "easy_interpenetrating_packing_fixture",
        "suffix": ".002",
    },
    "severe": {
        "id": "packing-fixture-v001-severe",
        "role": "severe-interpenetration",
        "collection": "hard_interpenetrating_packing_fixture",
        "suffix": ".001",
    },
}


def parse_args():
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(arguments)


def rounded(value, digits=12):
    result = round(float(value), digits)
    if result == 0:
        return 0
    if result.is_integer():
        return int(result)
    return result


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [canonical(row) for row in value]
    if isinstance(value, float):
        return rounded(value)
    return value


def hash_json(value):
    def identity_basis(row):
        if isinstance(row, bool) or row is None or isinstance(row, str):
            return row
        if isinstance(row, (int, float)):
            if not math.isfinite(row):
                raise ValueError("identity basis cannot contain a non-finite number")
            quantized = int(math.copysign(math.floor(abs(row) * IDENTITY_QUANTIZATION + 0.5), row))
            if abs(quantized) > 9_007_199_254_740_991:
                raise ValueError(f"identity basis number exceeds safe quantization range: {row}")
            return ["$number-q9", str(quantized)]
        if isinstance(row, dict):
            return {key: identity_basis(row[key]) for key in sorted(row)}
        if isinstance(row, (list, tuple)):
            return [identity_basis(item) for item in row]
        raise TypeError(f"unsupported identity basis value: {type(row).__name__}")

    payload = json.dumps(identity_basis(canonical(value)), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def hash_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path, value):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".authored-packing-", suffix=".json", dir=directory)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(canonical(value), handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        os.replace(temporary, path)
    except Exception:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def mesh_volume_world(obj):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    try:
        return abs(mesh.calc_volume(signed=True) * obj.matrix_world.to_3x3().determinant())
    finally:
        mesh.free()


def ordered_ring_indices(obj):
    polygons = [list(polygon.vertices) for polygon in obj.data.polygons]
    caps = [polygon for polygon in polygons if len(polygon) == 8]
    if len(caps) != 2:
        raise RuntimeError(f"{obj.name} requires exactly two eight-vertex caps")
    world = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    cap_centers = [sum((world[index] for index in cap), Vector()) / len(cap) for cap in caps]
    start_index = max(
        range(2),
        key=lambda index: (cap_centers[index].z, -cap_centers[index].x, -cap_centers[index].y),
    )
    current = set(caps[start_index])
    previous = set()
    target = set(caps[1 - start_index])
    rings = [current]
    while current != target:
        next_vertices = set()
        for polygon in polygons:
            if len(polygon) != 4:
                continue
            shared = current.intersection(polygon)
            outside = set(polygon).difference(current).difference(previous)
            if len(shared) == 2 and len(outside) == 2:
                next_vertices.update(outside)
        if len(next_vertices) != 8 or next_vertices in rings:
            raise RuntimeError(f"{obj.name} ring traversal failed at layer {len(rings)}")
        rings.append(next_vertices)
        previous = current
        current = next_vertices
        if len(rings) > 32:
            raise RuntimeError(f"{obj.name} ring traversal exceeded expected depth")
    return rings


def cycle_indices(obj, ring):
    neighbors = {index: [] for index in ring}
    for edge in obj.data.edges:
        first, second = edge.vertices
        if first in ring and second in ring:
            neighbors[first].append(second)
            neighbors[second].append(first)
    if any(len(values) != 2 for values in neighbors.values()):
        raise RuntimeError(f"{obj.name} ring is not a simple cycle")
    start = min(ring)
    order = [start]
    previous = None
    current = start
    while True:
        candidates = sorted(index for index in neighbors[current] if index != previous)
        next_index = candidates[0]
        if next_index == start:
            break
        order.append(next_index)
        previous, current = current, next_index
        if len(order) > len(ring):
            raise RuntimeError(f"{obj.name} ring cycle did not close")
    if len(order) != len(ring):
        raise RuntimeError(f"{obj.name} ring cycle omitted vertices")
    return order


def variant_frame(bone):
    rings = ordered_ring_indices(bone)
    world = [bone.matrix_world @ vertex.co for vertex in bone.data.vertices]
    centers = [sum((world[index] for index in ring), Vector()) / len(ring) for ring in rings]
    origin = sum(centers, Vector()) / len(centers)
    return origin


def transform_point(point, origin):
    relative = point - origin
    return Vector((relative.x, -relative.z, relative.y))


def section_area(points, tangent):
    cross_sum = Vector()
    for index, point in enumerate(points):
        cross_sum += point.cross(points[(index + 1) % len(points)])
    return abs(cross_sum.dot(tangent.normalized())) * 0.5


def extract_carrier(obj, origin, role, member_id=None):
    world = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    vertices = [transform_point(point, origin) for point in world]
    rings = ordered_ring_indices(obj)
    centers = [sum((vertices[index] for index in ring), Vector()) / len(ring) for ring in rings]
    centerline = []
    ring_rows = []
    for ring_index, ring in enumerate(rings):
        if ring_index == 0:
            tangent = centers[1] - centers[0]
        elif ring_index == len(rings) - 1:
            tangent = centers[-1] - centers[-2]
        else:
            tangent = centers[ring_index + 1] - centers[ring_index - 1]
        order = cycle_indices(obj, ring)
        points = [vertices[index] for index in order]
        centerline.append({
            "position": list(centers[ring_index]),
            "tangent": list(tangent.normalized()),
        })
        ring_rows.append({
            "vertexIndices": order,
            "area": section_area(points, tangent),
        })
    mesh = {
        "vertices": [list(point) for point in vertices],
        "polygons": [list(polygon.vertices) for polygon in obj.data.polygons],
    }
    carrier = {
        "id": member_id or "central-bone",
        "role": role,
        **({"memberId": member_id} if member_id else {}),
        "objectName": obj.name,
        "meshGeometrySha256": hash_json(mesh),
        "meshVolume": mesh_volume_world(obj),
        "centerline": centerline,
        "rings": ring_rows,
        "mesh": mesh,
    }
    return canonical(carrier)


def world_tree(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        vertices = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        polygons = [list(polygon.vertices) for polygon in mesh.polygons]
        return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)
    finally:
        evaluated.to_mesh_clear()


def collection_names(collection):
    return sorted(obj.name for obj in collection.all_objects if obj.type == "MESH")


def extract_variant(spec, depsgraph):
    suffix = spec["suffix"]
    names = ["central_bone", *MEMBERS]
    objects = {name: bpy.data.objects.get(name + suffix) for name in names}
    missing = [name + suffix for name, obj in objects.items() if obj is None]
    if missing:
        raise RuntimeError(f"variant {spec['id']} is missing objects: {missing}")
    collection = bpy.data.collections.get(spec["collection"])
    if collection is None:
        raise RuntimeError(f"variant {spec['id']} is missing collection {spec['collection']}")
    expected_names = sorted(name + suffix for name in names)
    if collection_names(collection) != expected_names:
        raise RuntimeError(
            f"variant {spec['id']} collection membership mismatch: "
            f"expected {expected_names}, effective {collection_names(collection)}"
        )
    origin = variant_frame(objects["central_bone"])
    bone = extract_carrier(objects["central_bone"], origin, "bone")
    members = [
        extract_carrier(objects[name], origin, "packable-body", MEMBER_IDS[index])
        for index, name in enumerate(MEMBERS)
    ]
    trees = {name: world_tree(obj, depsgraph) for name, obj in objects.items()}
    contact_ids = {"central_bone": "central-bone", **dict(zip(MEMBERS, MEMBER_IDS))}
    surface_overlap_rows = []
    for left_index, left in enumerate(names):
        for right in names[left_index + 1 :]:
            triangle_pair_count = len(trees[left].overlap(trees[right]))
            if triangle_pair_count:
                surface_overlap_rows.append({
                    "leftMemberId": contact_ids[left],
                    "rightMemberId": contact_ids[right],
                    "trianglePairCount": triangle_pair_count,
                })
    core = {
        "id": spec["id"],
        "role": spec["role"],
        "collectionName": spec["collection"],
        "sourceObjectSuffix": suffix,
        "normalization": {
            "originWorld": list(origin),
            "axisMap": {
                "carrierX": "blenderX",
                "carrierY": "negativeBlenderZ",
                "carrierZ": "blenderY",
            },
        },
        "bone": bone,
        "members": members,
        "meshContactTruth": {
            "method": "Blender-BVHTree-evaluated-world-mesh-surface-overlap",
            "surfaceOverlapRows": surface_overlap_rows,
        },
    }
    return canonical({**core, "identity": {"sha256": hash_json(core)}})


def main(args):
    requested_source = os.path.abspath(args.source)
    effective_source = os.path.abspath(bpy.data.filepath)
    if requested_source != effective_source:
        raise RuntimeError(
            f"requested Blender source {requested_source} does not match effective open file {effective_source}"
        )
    source_sha256 = hash_file(effective_source)
    source_identity = {
        "kind": "operator-authored-blender-fixture",
        "id": os.path.basename(effective_source),
        "sha256": source_sha256,
    }
    depsgraph = bpy.context.evaluated_depsgraph_get()
    core = {
        "schema": SCHEMA,
        "id": "operator-authored-packing-fixture-v001",
        "source": {
            "input": {
                "requested": source_identity,
                "effective": source_identity,
            },
            "locator": effective_source,
            "blenderVersion": bpy.app.version_string,
        },
        "coordinateSpace": {
            "kind": "variant-bone-centered-cartesian",
            "dimension": 3,
            "unit": "blender-scene-unit",
            "longitudinalAxis": "carrierY",
        },
        "memberOrder": MEMBER_IDS,
        "variants": {
            name: extract_variant(spec, depsgraph)
            for name, spec in VARIANTS.items()
        },
    }
    manifest = canonical({**core, "identity": {"sha256": hash_json(core)}})
    write_json_atomic(args.output, manifest)
    report = {
        "schema": "kaminos.authored-packing-sweep-export-report.v0",
        "status": "succeeded",
        "phase": "complete",
        "source": manifest["source"],
        "output": {
            "path": os.path.abspath(args.output),
            "fileSha256": hash_file(args.output),
            "manifestSha256": manifest["identity"]["sha256"],
        },
    }
    write_json_atomic(args.report, report)
    print("AUTHORED_PACKING_SWEEP_EXPORT " + json.dumps(canonical(report), separators=(",", ":")))


if __name__ == "__main__":
    parsed = parse_args()
    try:
        main(parsed)
    except Exception as error:
        failure = {
            "schema": "kaminos.authored-packing-sweep-export-report.v0",
            "status": "failed",
            "phase": "fixture-extraction",
            "source": {
                "requestedPath": os.path.abspath(parsed.source),
                "effectivePath": os.path.abspath(bpy.data.filepath) if bpy.data.filepath else None,
            },
            "failure": {
                "kind": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(),
            },
        }
        write_json_atomic(parsed.report, failure)
        print("AUTHORED_PACKING_SWEEP_EXPORT_FAILED " + json.dumps(canonical(failure), separators=(",", ":")))
        raise
