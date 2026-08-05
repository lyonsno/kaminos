#!/usr/bin/env python3
"""Extract the frozen M31 transfer fixture from the authenticated Blender source."""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector


EXPECTED_SOURCE_SHA256 = (
    "a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3"
)
EXPECTED_SOURCE_BYTES = 549819
ROUTING_FIXTURE_SHA256 = (
    "ed0b95da9cdb7560e877869ab7d1f92423f8ec343712dbf40986ed63e5b48075"
)
C_P0_ARTIFACT_SHA256 = (
    "4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005"
)
SOURCE_FIXTURE_CONTRACT_SCHEMA = "m31_m47_source_fixture_station_binding.v1"
SOURCE_GRAPH_IDENTITY = (
    "f11075a8f7afcb913c23190cfa78dd9b73401b840b0a2df8fc96bfaacbcdbcb0"
)
SOURCE_GRAPH_FILE_SHA256 = (
    "8fe8eb8c65118102243b75c324638155a814f3c70095af5f8462326f2b4d68f6"
)
ROUTE = "m31-generated-relation-positive-volume-c-p0-transfer"
SURFACE_GEOMETRY_SHA256 = (
    "06ae6eeeb0115fd6e908998439edaed1e7ba5298f0a7a2aceef2c7c2fecf3e9a"
)
PATH_GEOMETRY_SHA256 = (
    "8952f1c78620090fc3738d7da0667fc889a01dab578d47803c91e8d3937a93c8"
)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def vector_list(value: Vector) -> list[float]:
    return [float(value[0]), float(value[1]), float(value[2])]


def mean_point(points: list[Vector]) -> Vector:
    return sum(points, Vector((0.0, 0.0, 0.0))) / len(points)


def exact_object(name: str, object_type: str) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != object_type:
        raise ValueError(f"required {object_type} object is missing: {name}")
    return obj


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        raise ValueError("expected authenticated source route and output fixture path")
    requested_source = Path(argv[0]).expanduser().resolve()
    if requested_source.suffix == ".json":
        route_descriptor = json.loads(requested_source.read_text(encoding="utf-8"))
        if route_descriptor.get("schema") != "kaminos.m31-blender-source-route.v0":
            raise ValueError("source route descriptor schema mismatch")
        source_path = Path(route_descriptor["sourcePath"]).expanduser().resolve()
    else:
        route_descriptor = None
        source_path = requested_source
    output_path = Path(argv[1]).expanduser().resolve()
    failure_path = output_path.with_suffix(output_path.suffix + ".failure.json")
    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    from tools.m31_m47_articulation import route_eligibility

    failure: dict[str, object] = {
        "schema": "kaminos.m31-generated-relation-source-failure.v0",
        "status": "started",
        "requestedRoute": ROUTE,
        "effectiveRoute": None,
        "fallbackUsed": False,
        "failurePhase": "source-authentication",
        "lastTrustworthyEvidence": "output path parsed; source not authenticated",
        "sourceRequested": str(requested_source),
        "sourceDescriptor": str(requested_source) if route_descriptor else None,
        "primaryOutput": None,
    }
    write_json(failure_path, failure)

    if not source_path.is_file():
        raise ValueError(f"authenticated source is missing: {source_path}")
    source_bytes = source_path.stat().st_size
    source_sha256 = sha256_file(source_path)
    if source_bytes != EXPECTED_SOURCE_BYTES or source_sha256 != EXPECTED_SOURCE_SHA256:
        raise ValueError(
            f"source identity mismatch: bytes={source_bytes} sha256={source_sha256}"
        )
    failure.update(
        failurePhase="source-open",
        lastTrustworthyEvidence="source byte length and SHA-256 authenticated",
        sourceEffective=str(source_path),
        sourceByteLength=source_bytes,
        sourceSha256=source_sha256,
    )
    write_json(failure_path, failure)

    bpy.ops.wm.open_mainfile(filepath=str(source_path))
    failure.update(
        failurePhase="selection-validation",
        lastTrustworthyEvidence="authenticated source opened in Blender",
        blenderVersion=bpy.app.version_string,
    )
    write_json(failure_path, failure)

    fixture_path = repo_root / "fixtures" / "track-m-routing" / "m31-m47-routing-fixture.json"
    if sha256_file(fixture_path) != ROUTING_FIXTURE_SHA256:
        raise ValueError("routing fixture byte identity mismatch")
    routing_fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    eligibility = route_eligibility(routing_fixture, ("muscle-31",))
    selection_observed_at = datetime.now(timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    route = next(
        record
        for record in routing_fixture["conditions"]["correct"]["routes"]
        if record["constructionId"] == "muscle-31"
    )
    if route["components"]["surfaceGeometrySha256"] != SURFACE_GEOMETRY_SHA256:
        raise ValueError("M31 surface geometry identity mismatch")
    if route["components"]["pathGeometrySha256"] != PATH_GEOMETRY_SHA256:
        raise ValueError("M31 path geometry identity mismatch")

    surface = exact_object("Muscle 31 | Surface", "MESH")
    fixed_support = exact_object("Cube.002", "MESH")
    moving_support = exact_object("Cube.003", "MESH")
    mesh = surface.data
    profile_side_count = int(route["settings"]["profile_sides"])
    if len(mesh.vertices) != route["components"]["surfaceVertexCount"]:
        raise ValueError("M31 source vertex count mismatches routing fixture")
    if len(mesh.polygons) != route["components"]["surfacePolygonCount"]:
        raise ValueError("M31 source polygon count mismatches routing fixture")
    if len(mesh.vertices) % profile_side_count != 0:
        raise ValueError("M31 source vertices do not partition into profile rings")

    native_groups = [
        list(range(start, start + profile_side_count))
        for start in range(0, len(mesh.vertices), profile_side_count)
    ]
    origin = Vector(route["origin"]["point"])
    insertion = Vector(route["insertion"]["point"])

    def group_center(group: list[int]) -> Vector:
        return mean_point([surface.matrix_world @ mesh.vertices[index].co for index in group])

    first_center = group_center(native_groups[0])
    last_center = group_center(native_groups[-1])
    forward_residual = (first_center - origin).length + (last_center - insertion).length
    reverse_residual = (first_center - insertion).length + (last_center - origin).length
    groups = list(reversed(native_groups)) if reverse_residual < forward_residual else native_groups
    origin_residual = (group_center(groups[0]) - origin).length
    insertion_residual = (group_center(groups[-1]) - insertion).length
    if max(origin_residual, insertion_residual) > 0.08:
        raise ValueError(
            f"M31 endpoint ring residual exceeds 0.08: "
            f"origin={origin_residual:.9f} insertion={insertion_residual:.9f}"
        )

    section_by_vertex = {
        vertex_index: (section_index, profile_index)
        for section_index, group in enumerate(groups)
        for profile_index, vertex_index in enumerate(group)
    }
    vertices = []
    for vertex in mesh.vertices:
        section_index, profile_index = section_by_vertex[vertex.index]
        vertices.append(
            {
                "id": f"muscle-31:vertex:{vertex.index}",
                "index": vertex.index,
                "sectionIndex": section_index,
                "profileIndex": profile_index,
                "rest": vector_list(surface.matrix_world @ vertex.co),
            }
        )
    sections = [
        {
            "index": section_index,
            "nativeRingIndex": native_groups.index(group),
            "vertexIds": [f"muscle-31:vertex:{index}" for index in group],
        }
        for section_index, group in enumerate(groups)
    ]
    mesh.calc_loop_triangles()
    triangles = []
    for triangle in mesh.loop_triangles:
        indices = [int(index) for index in triangle.vertices]
        triangles.append(
            {
                "id": f"muscle-31:triangle:{triangle.index}",
                "index": triangle.index,
                "sourcePolygonIndex": int(triangle.polygon_index),
                "vertexIndices": indices,
                "vertexIds": [f"muscle-31:vertex:{index}" for index in indices],
            }
        )

    moving_matrix = moving_support.matrix_world.copy()
    pivot = moving_matrix.translation.copy()
    axis = (moving_matrix.to_3x3() @ Vector((1.0, 0.0, 0.0))).normalized()
    source_fixture = {
        "schema": "kaminos.m31-generated-relation-source-fixture.v0",
        "requestedRoute": ROUTE,
        "effectiveRoute": ROUTE,
        "fallbackUsed": False,
        "source": {
            "assetSha256": source_sha256,
            "byteLength": source_bytes,
            "requestedBlendPath": str(requested_source),
            "effectiveBlendPath": str(source_path),
            "routingFixtureSha256": ROUTING_FIXTURE_SHA256,
            "cP0ArtifactSha256": C_P0_ARTIFACT_SHA256,
            "fixtureContractSchema": SOURCE_FIXTURE_CONTRACT_SCHEMA,
            "graphIdentity": SOURCE_GRAPH_IDENTITY,
            "graphFileSha256": SOURCE_GRAPH_FILE_SHA256,
            "surfaceGeometrySha256": SURFACE_GEOMETRY_SHA256,
            "pathGeometrySha256": PATH_GEOMETRY_SHA256,
            "blenderVersion": bpy.app.version_string,
        },
        "selection": {
            "constructionId": "muscle-31",
            "frozenBeforeOutput": True,
            "eligibilityStatus": eligibility["status"],
            "supportFamily": eligibility["supportFamily"],
            "authority": eligibility["authority"],
            "observedAt": selection_observed_at,
        },
        "identities": {
            "path": "Muscle 31 | Path",
            "surface": surface.name,
            "originHandle": "Muscle 31 | Origin",
            "insertionHandle": "Muscle 31 | Insertion",
            "fixedSupport": fixed_support.name,
            "movingSupport": moving_support.name,
        },
        "componentInstanceIds": {
            "path": route["components"]["pathInstanceId"],
            "surface": route["components"]["surfaceInstanceId"],
            "originHandle": route["components"]["originInstanceId"],
            "insertionHandle": route["components"]["insertionInstanceId"],
        },
        "hinge": {
            "pivotWorld": vector_list(pivot),
            "axisWorld": vector_list(axis),
            "pivotStrategy": "moving-support-object-origin",
            "axisStrategy": "moving-support-local-x",
        },
        "profileSideCount": profile_side_count,
        "sections": sections,
        "vertices": vertices,
        "triangles": triangles,
        "sourceGeometry": {
            "vertexCount": len(vertices),
            "polygonCount": len(mesh.polygons),
            "triangleCount": len(triangles),
            "edgeCount": len(mesh.edges),
            "reversedSourceRingOrder": groups is not native_groups,
            "originRingResidual": origin_residual,
            "insertionRingResidual": insertion_residual,
        },
    }
    write_json(output_path, source_fixture)
    failure.update(
        status="complete",
        effectiveRoute=ROUTE,
        failurePhase=None,
        lastTrustworthyEvidence=(
            "authenticated M31 selection, ordered source mesh, supports, and hinge serialized"
        ),
        primaryOutput=str(output_path),
        selectedConstructionId="muscle-31",
        surfaceVertexCount=len(vertices),
        surfaceTriangleCount=len(triangles),
    )
    write_json(failure_path, failure)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"M31 source extraction failed: {error}", file=sys.stderr)
        raise
