"""Export exact-topology GLB witnesses for the authored-cat carrier assay.

These exports preserve the source primitive's triangle connectivity. They are
surface witnesses, not a remesh, manifold reconstruction, or volumetric solve.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from hidden_carrier_fixture import (
    SOURCE_SHA256,
    _accessor_array,
    _glb_chunks,
    _sha256,
    load_glb_surface,
)


SCHEMA = "kaminos.authored-cat-hidden-carrier-surface-export.v0"
ROUTE = "fixed-source-topology-glb-surface-witness-v0"
BACKEND = "python-numpy-cpu"
OUTPUT_NAMES = (
    "authored-carrier-surface.glb",
    "synthetic-coat-surface.glb",
    "uniform-recovery-surface.glb",
    "carrier-coat-recovery-comparison.glb",
)
REPORT_NAME = "surface-export-report.json"

SURFACES = (
    (
        "authoredCarrier",
        "AUTHORED HIDDEN CARRIER",
        "authored-carrier-surface.glb",
        (0.38, 0.62, 0.72, 1.0),
    ),
    (
        "syntheticCoat",
        "SYNTHETIC OBSERVED COAT",
        "synthetic-coat-surface.glb",
        (0.96, 0.48, 0.12, 1.0),
    ),
    (
        "uniformRecovery",
        "UNIFORM-INSET RECOVERY",
        "uniform-recovery-surface.glb",
        (0.59, 0.22, 0.82, 1.0),
    ),
)


class SurfaceExportFailure(RuntimeError):
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


def _public_locator(path, repo_root):
    path = Path(path).resolve()
    try:
        return path.relative_to(Path(repo_root).resolve()).as_posix()
    except ValueError:
        digest = hashlib.sha256(str(path).encode()).hexdigest()[:16]
        return f"external-path:{path.name}:{digest}"


def _read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SurfaceExportFailure(f"could not read JSON {Path(path).name}: {error}") from error


def _validate_array(name, value, *, count):
    array = np.asarray(value, dtype=np.float64)
    if array.shape != (count, 3):
        raise SurfaceExportFailure(f"{name} must have shape ({count}, 3)")
    if not np.isfinite(array).all():
        raise SurfaceExportFailure(f"{name} contains non-finite values")
    return array


def _load_npz_array(path, name, *, count):
    try:
        with np.load(path) as payload:
            if name not in payload.files:
                raise SurfaceExportFailure(f"{Path(path).name} is missing array {name}")
            return _validate_array(name, payload[name], count=count)
    except SurfaceExportFailure:
        raise
    except Exception as error:
        raise SurfaceExportFailure(f"could not read {Path(path).name}: {error}") from error


def _source_topology(source_path, *, expected_vertex_count):
    document, binary = _glb_chunks(Path(source_path))
    mesh_nodes = [
        (index, node) for index, node in enumerate(document.get("nodes", [])) if "mesh" in node
    ]
    if len(mesh_nodes) != 1:
        raise SurfaceExportFailure("surface export requires exactly one mesh-bearing source node")
    _, node = mesh_nodes[0]
    primitives = document["meshes"][node["mesh"]].get("primitives", [])
    if len(primitives) != 1:
        raise SurfaceExportFailure("surface export requires exactly one source primitive")
    primitive = primitives[0]
    if int(primitive.get("mode", 4)) != 4 or "indices" not in primitive:
        raise SurfaceExportFailure("source primitive must be indexed triangles")
    raw = _accessor_array(document, binary, primitive["indices"]).reshape(-1)
    if raw.size % 3:
        raise SurfaceExportFailure("source index count is not divisible by three")
    indices = raw.astype(np.int64).reshape(-1, 3)
    if len(indices) == 0 or indices.min() < 0 or indices.max() >= expected_vertex_count:
        raise SurfaceExportFailure("source indices are empty or outside the vertex range")
    return indices


def _oriented_indices(indices, positions, reference_normals):
    triangles = np.asarray(indices, dtype=np.int64).copy()
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    reference = reference_normals[triangles].mean(axis=1)
    dots = np.einsum("ij,ij->i", face, reference)
    usable = np.linalg.norm(face, axis=1) > 1e-12
    if not np.any(usable):
        raise SurfaceExportFailure("source topology contains no nondegenerate triangles")
    winding_flipped = float(np.median(dots[usable])) < 0.0
    if winding_flipped:
        triangles[:, [1, 2]] = triangles[:, [2, 1]]
    return triangles, winding_flipped


def _vertex_normals(positions, triangles, fallback):
    result = np.zeros_like(positions, dtype=np.float64)
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    for corner in range(3):
        np.add.at(result, triangles[:, corner], face)
    lengths = np.linalg.norm(result, axis=1)
    valid = lengths > 1e-12
    result[valid] /= lengths[valid, None]
    result[~valid] = fallback[~valid]
    return result


def _topology_diagnostics(triangles, positions):
    vertex_count = len(positions)
    parent = np.arange(vertex_count, dtype=np.int64)

    def find(item):
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = int(parent[item])
        return item

    def union(left, right):
        left_root, right_root = find(int(left)), find(int(right))
        if left_root != right_root:
            parent[right_root] = left_root

    edge_counts = {}
    for triangle in triangles:
        union(triangle[0], triangle[1])
        union(triangle[1], triangle[2])
        for left, right in (
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ):
            edge = tuple(sorted((int(left), int(right))))
            edge_counts[edge] = edge_counts.get(edge, 0) + 1

    a, b, c = (positions[triangles[:, i]] for i in range(3))
    double_areas = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    referenced = np.unique(triangles.reshape(-1))
    components = {find(int(vertex)) for vertex in referenced}
    bounds_min = positions.min(axis=0)
    bounds_max = positions.max(axis=0)
    boundary = sum(count == 1 for count in edge_counts.values())
    non_manifold = sum(count > 2 for count in edge_counts.values())
    return {
        "surfaceClass": "open-disconnected-triangle-surface",
        "vertexCount": int(vertex_count),
        "referencedVertexCount": int(len(referenced)),
        "triangleCount": int(len(triangles)),
        "componentCount": int(len(components)),
        "boundaryEdgeCount": int(boundary),
        "interiorEdgeCount": int(sum(count == 2 for count in edge_counts.values())),
        "nonManifoldEdgeCount": int(non_manifold),
        "degenerateTriangleCount": int(np.count_nonzero(double_areas <= 1e-12)),
        "boundsMin": [float(value) for value in bounds_min],
        "boundsMax": [float(value) for value in bounds_max],
        "boundsDiagonal": float(np.linalg.norm(bounds_max - bounds_min)),
    }


def _append_blob(binary, data):
    while len(binary) % 4:
        binary.extend(b"\0")
    offset = len(binary)
    binary.extend(data)
    return offset, len(data)


def _material(name, color):
    return {
        "name": name,
        "doubleSided": True,
        "pbrMetallicRoughness": {
            "baseColorFactor": list(color),
            "metallicFactor": 0.03,
            "roughnessFactor": 0.74,
        },
    }


def _write_glb(path, surfaces, triangles, *, topology, comparison):
    binary = bytearray()
    buffer_views = []
    accessors = []
    meshes = []
    nodes = []
    materials = []

    index_dtype = np.dtype("<u2") if topology["vertexCount"] <= 65535 else np.dtype("<u4")
    component_type = 5123 if index_dtype.itemsize == 2 else 5125
    indices = np.asarray(triangles.reshape(-1), dtype=index_dtype)
    index_offset, index_length = _append_blob(binary, indices.tobytes(order="C"))
    buffer_views.append(
        {"buffer": 0, "byteOffset": index_offset, "byteLength": index_length, "target": 34963}
    )
    accessors.append(
        {
            "bufferView": 0,
            "componentType": component_type,
            "count": int(indices.size),
            "type": "SCALAR",
            "min": [int(indices.min())],
            "max": [int(indices.max())],
        }
    )
    index_accessor = 0

    spacing = topology["boundsMax"][0] - topology["boundsMin"][0] + topology["boundsDiagonal"] * 0.10
    comparison_offsets = (-spacing, 0.0, spacing)
    for surface_index, surface in enumerate(surfaces):
        positions = np.asarray(surface["positions"], dtype="<f4")
        normals = np.asarray(surface["normals"], dtype="<f4")
        position_offset, position_length = _append_blob(binary, positions.tobytes(order="C"))
        position_view = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": position_offset,
                "byteLength": position_length,
                "target": 34962,
            }
        )
        position_accessor = len(accessors)
        accessors.append(
            {
                "bufferView": position_view,
                "componentType": 5126,
                "count": int(len(positions)),
                "type": "VEC3",
                "min": [float(value) for value in positions.min(axis=0)],
                "max": [float(value) for value in positions.max(axis=0)],
            }
        )
        normal_offset, normal_length = _append_blob(binary, normals.tobytes(order="C"))
        normal_view = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": normal_offset,
                "byteLength": normal_length,
                "target": 34962,
            }
        )
        normal_accessor = len(accessors)
        accessors.append(
            {
                "bufferView": normal_view,
                "componentType": 5126,
                "count": int(len(normals)),
                "type": "VEC3",
            }
        )
        materials.append(_material(surface["label"], surface["color"]))
        meshes.append(
            {
                "name": surface["label"],
                "primitives": [
                    {
                        "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
                        "indices": index_accessor,
                        "material": surface_index,
                        "mode": 4,
                    }
                ],
            }
        )
        node = {"name": surface["label"], "mesh": surface_index}
        if comparison:
            node["translation"] = [float(comparison_offsets[surface_index]), 0.0, 0.0]
        nodes.append(node)

    document = {
        "asset": {
            "version": "2.0",
            "generator": "Kaminos exact-topology hidden-carrier surface exporter",
            "extras": {
                "schema": SCHEMA,
                "route": ROUTE,
                "surfaceContract": "source triangle topology with displaced vertex positions",
                "surfaceClass": topology["surfaceClass"],
            },
        },
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(binary)}],
    }
    json_bytes = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary.extend(b"\0" * ((-len(binary)) % 4))
    header = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(json_bytes) + 8 + len(binary))
    payload = (
        header
        + struct.pack("<II", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<II", len(binary), 0x004E4942)
        + bytes(binary)
    )
    path = Path(path)
    handle = tempfile.NamedTemporaryFile(mode="w+b", dir=path.parent, prefix=f".{path.name}.", delete=False)
    temporary = Path(handle.name)
    try:
        with handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _failure_receipt(*, repo_root, source_path, assay_dir, output_dir, expected_report_sha256, reason):
    return {
        "schema": SCHEMA,
        "status": "failed",
        "terminal": True,
        "failurePhase": "input-validation",
        "reason": str(reason),
        "route": {"requested": ROUTE, "effective": None, "backend": BACKEND},
        "requestedInputs": {
            "repoRoot": ".",
            "sourcePath": _public_locator(source_path, repo_root),
            "assayDir": _public_locator(assay_dir, repo_root),
            "outputDir": _public_locator(output_dir, repo_root),
            "expectedReportSha256": expected_report_sha256,
        },
        "visualArtifactsValidated": False,
        "operatorVisualAdmission": "not-requested",
        "completedAt": _now(),
    }


def export_surfaces(*, repo_root, source_path, assay_dir, output_dir, expected_report_sha256):
    repo_root = Path(repo_root).resolve()
    source_path = Path(source_path).resolve()
    assay_dir = Path(assay_dir).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in (*OUTPUT_NAMES, REPORT_NAME, "README.md"):
        (output_dir / name).unlink(missing_ok=True)

    try:
        report_path = assay_dir / "report.json"
        observed_report_sha256 = _sha256(report_path)
        if observed_report_sha256 != expected_report_sha256:
            raise SurfaceExportFailure(
                f"report digest mismatch: expected {expected_report_sha256}, observed {observed_report_sha256}"
            )
        report = _read_json(report_path)
        if report.get("status") != "captured":
            raise SurfaceExportFailure("assay report is not terminal captured evidence")
        if _sha256(source_path) != SOURCE_SHA256:
            raise SurfaceExportFailure("authenticated source digest mismatch")
        if report.get("source", {}).get("sha256") != SOURCE_SHA256:
            raise SurfaceExportFailure("assay report source digest does not match authenticated source")

        observation_path = assay_dir / report["artifacts"]["observation"]["path"]
        recovery_path = assay_dir / report["artifacts"]["recoveredCarrier"]["path"]
        if _sha256(observation_path) != report["artifacts"]["observation"]["sha256"]:
            raise SurfaceExportFailure("observation digest mismatch")
        if _sha256(recovery_path) != report["artifacts"]["recoveredCarrier"]["sha256"]:
            raise SurfaceExportFailure("recovered carrier digest mismatch")

        source = load_glb_surface(source_path)
        vertex_count = len(source["positions"])
        observed = _load_npz_array(observation_path, "observedPositions", count=vertex_count)
        recovered = _load_npz_array(recovery_path, "positions", count=vertex_count)
        triangles = _source_topology(source_path, expected_vertex_count=vertex_count)
        triangles, winding_flipped = _oriented_indices(
            triangles, source["positions"], source["normals"]
        )
        topology = _topology_diagnostics(triangles, source["positions"])
        if topology["degenerateTriangleCount"]:
            raise SurfaceExportFailure("source topology contains degenerate triangles")

        surface_arrays = []
        for (key, label, filename, color), positions in zip(
            SURFACES, (source["positions"], observed, recovered), strict=True
        ):
            surface_arrays.append(
                {
                    "key": key,
                    "label": label,
                    "filename": filename,
                    "color": color,
                    "positions": positions,
                    "normals": _vertex_normals(positions, triangles, source["normals"]),
                }
            )

        for surface in surface_arrays:
            _write_glb(
                output_dir / surface["filename"],
                [surface],
                triangles,
                topology=topology,
                comparison=False,
            )
        comparison_name = "carrier-coat-recovery-comparison.glb"
        _write_glb(
            output_dir / comparison_name,
            surface_arrays,
            triangles,
            topology=topology,
            comparison=True,
        )

        artifacts = {}
        for key, _, filename, _ in SURFACES:
            path = output_dir / filename
            document, _ = _glb_chunks(path)
            if len(document.get("meshes", [])) != 1 or path.stat().st_size <= 10_000:
                raise SurfaceExportFailure(f"export validation failed for {filename}")
            artifacts[key] = {
                "path": filename,
                "sha256": _sha256(path),
                "byteLength": path.stat().st_size,
            }
        comparison_path = output_dir / comparison_name
        comparison_document, _ = _glb_chunks(comparison_path)
        if len(comparison_document.get("meshes", [])) != 3 or comparison_path.stat().st_size <= 10_000:
            raise SurfaceExportFailure("comparison export validation failed")
        artifacts["comparison"] = {
            "path": comparison_name,
            "sha256": _sha256(comparison_path),
            "byteLength": comparison_path.stat().st_size,
        }

        receipt = {
            "schema": SCHEMA,
            "status": "captured",
            "terminal": True,
            "route": {"requested": ROUTE, "effective": ROUTE, "backend": BACKEND},
            "inputs": {
                "repoRoot": ".",
                "sourcePath": _public_locator(source_path, repo_root),
                "sourceSha256": SOURCE_SHA256,
                "assayDir": _public_locator(assay_dir, repo_root),
                "reportSha256": observed_report_sha256,
                "observationSha256": _sha256(observation_path),
                "recoveredCarrierSha256": _sha256(recovery_path),
            },
            "topology": topology | {"windingFlippedOnWorldSpaceExport": winding_flipped},
            "artifacts": artifacts,
            "visualArtifactsValidated": True,
            "operatorVisualAdmission": "not-requested",
            "claimCeiling": (
                "Exact source-topology visualization of the authored carrier, synthetic coat, "
                "and uniform-inset recovery. The source is an open disconnected triangle surface; "
                "these GLBs do not establish a watertight hidden carrier, volumetric recovery, or production geometry."
            ),
            "safetyCharacterization": (
                "Deterministic isolated cat-envelope triangle surfaces with no generator output, "
                "biological corruption, infestation, repeated-orifice, or misplaced-growth imagery."
            ),
            "completedAt": _now(),
        }
        _write_json(output_dir / REPORT_NAME, receipt)
        (output_dir / "README.md").write_text(
            "# Hidden-carrier exact-topology surface witness\n\n"
            "These GLBs preserve the authenticated source primitive's triangle connectivity while "
            "substituting the authored carrier, synthetic observed-coat, and uniform-inset recovered "
            "vertex positions. They are the actual fixed-topology geometry behind the earlier point plate.\n\n"
            f"Topology: {topology['vertexCount']} vertices, {topology['triangleCount']} triangles, "
            f"{topology['componentCount']} connected components, {topology['boundaryEdgeCount']} boundary edges, "
            f"{topology['nonManifoldEdgeCount']} non-manifold edges, and "
            f"{topology['degenerateTriangleCount']} degenerate triangles.\n\n"
            "The source is therefore an open, disconnected triangle surface—not a watertight carrier. "
            "The exports can verify what the offset does to this surface but cannot prove a closed hidden skin.\n"
        )
        return receipt
    except Exception as error:
        for name in (*OUTPUT_NAMES, "README.md"):
            (output_dir / name).unlink(missing_ok=True)
        receipt = _failure_receipt(
            repo_root=repo_root,
            source_path=source_path,
            assay_dir=assay_dir,
            output_dir=output_dir,
            expected_report_sha256=expected_report_sha256,
            reason=error,
        )
        _write_json(output_dir / REPORT_NAME, receipt)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--assay-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--expected-report-sha256", required=True)
    args = parser.parse_args(argv)
    receipt = export_surfaces(
        repo_root=args.repo_root,
        source_path=args.source,
        assay_dir=args.assay_dir,
        output_dir=args.output_dir,
        expected_report_sha256=args.expected_report_sha256,
    )
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["status"] == "captured" else 1


if __name__ == "__main__":
    raise SystemExit(main())
