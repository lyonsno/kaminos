#!/usr/bin/env python3
"""Bake generated source GLB material values onto a target GLB's existing UV0.

V0 is intentionally narrow and honest:

- source and target must already have UV0
- no unwrap/xatlas path exists here
- default projection is nearest-source-surface-normal-aware
- only baseColor and metallicRoughness are emitted
- normals, AO, emissive extraction, height, and parallax remain unimplemented
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
import json
import math
import struct
import sys
import time
from pathlib import Path
from typing import Any


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
TRIANGLES = 4
BAKE_SCHEMA = "kaminos.generated-asset-bake.v0"
COMPONENT_DTYPES = {
    5120: "i1",
    5121: "u1",
    5122: "<i2",
    5123: "<u2",
    5125: "<u4",
    5126: "<f4",
}
ACCESSOR_WIDTHS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
}


class BakeFailure(Exception):
    def __init__(self, phase: str, code: str, message: str):
        super().__init__(message)
        self.phase = phase
        self.code = code
        self.message = message


class TargetGeometry:
    def __init__(self, vertices, faces, uv, winding_stats: dict[str, Any] | None = None):
        self.vertices = vertices
        self.faces = faces
        self.uv = uv
        self.winding_stats = winding_stats or {}
        self._face_normals = None
        self._vertex_normals = None

    @property
    def face_normals(self):
        import numpy as np

        if self._face_normals is None:
            tri = self.vertices[self.faces]
            normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            lengths = np.linalg.norm(normals, axis=1)
            valid = lengths > 1e-12
            normals[valid] /= lengths[valid, None]
            normals[~valid] = 0
            self._face_normals = normals.astype(np.float32)
        return self._face_normals

    @property
    def vertex_normals(self):
        import numpy as np

        if self._vertex_normals is None:
            normals = np.zeros_like(self.vertices, dtype=np.float32)
            face_normals = self.face_normals
            for corner in range(3):
                np.add.at(normals, self.faces[:, corner], face_normals)
            lengths = np.linalg.norm(normals, axis=1)
            valid = lengths > 1e-12
            normals[valid] /= lengths[valid, None]
            normals[~valid] = 0
            self._vertex_normals = normals
        return self._vertex_normals


def consistent_winding_faces(faces):
    import numpy as np

    faces = np.asarray(faces, dtype=np.int64)
    repaired = faces.copy()
    face_count = int(len(repaired))
    stats = {
        "faceCount": face_count,
        "flippedFaces": 0,
        "flippedRatio": 0.0,
        "components": 0,
        "edgeCount": 0,
        "boundaryEdges": 0,
        "manifoldEdges": 0,
        "nonManifoldEdges": 0,
        "conflictEdges": 0,
    }
    if face_count == 0:
        return repaired, stats

    edges_by_key = defaultdict(list)
    for face_index, (a, b, c) in enumerate(repaired):
        for start, end in ((a, b), (b, c), (c, a)):
            if int(start) == int(end):
                continue
            key = (int(start), int(end)) if int(start) < int(end) else (int(end), int(start))
            direction = 1 if (int(start), int(end)) == key else -1
            edges_by_key[key].append((face_index, direction))

    adjacency = [[] for _ in range(face_count)]
    stats["edgeCount"] = len(edges_by_key)
    for entries in edges_by_key.values():
        if len(entries) == 1:
            stats["boundaryEdges"] += 1
            continue
        if len(entries) == 2:
            stats["manifoldEdges"] += 1
        else:
            stats["nonManifoldEdges"] += 1
        base_face, base_direction = entries[0]
        for other_face, other_direction in entries[1:]:
            needs_opposite_flip = base_direction == other_direction
            adjacency[base_face].append((other_face, needs_opposite_flip))
            adjacency[other_face].append((base_face, needs_opposite_flip))

    flips = [None] * face_count
    for seed in range(face_count):
        if flips[seed] is not None:
            continue
        stats["components"] += 1
        flips[seed] = False
        queue = deque([seed])
        while queue:
            face_index = queue.popleft()
            for neighbor, needs_opposite_flip in adjacency[face_index]:
                expected = bool(flips[face_index]) ^ bool(needs_opposite_flip)
                if flips[neighbor] is None:
                    flips[neighbor] = expected
                    queue.append(neighbor)
                elif flips[neighbor] != expected:
                    stats["conflictEdges"] += 1

    flip_mask = np.asarray(flips, dtype=bool)
    if np.any(flip_mask):
        repaired[flip_mask] = repaired[flip_mask][:, [0, 2, 1]]
    stats["flippedFaces"] = int(np.count_nonzero(flip_mask))
    stats["flippedRatio"] = float(stats["flippedFaces"] / face_count)
    return repaired, stats


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_glb_json(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError(f"{path} is too small to be a GLB")
    magic, version, total_length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path} does not start with GLB magic")
    if version != 2:
        raise ValueError(f"{path} is GLB version {version}, expected 2")
    if total_length != len(data):
        raise ValueError(f"{path} length header {total_length} does not match file size {len(data)}")

    offset = 12
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset: offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            return json.loads(chunk.rstrip(b" \t\r\n\0").decode("utf-8"))
    raise ValueError(f"{path} has no JSON chunk")


def read_glb(path: Path) -> tuple[dict[str, Any], bytes]:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError(f"{path} is too small to be a GLB")
    magic, version, total_length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path} does not start with GLB magic")
    if version != 2:
        raise ValueError(f"{path} is GLB version {version}, expected 2")
    if total_length != len(data):
        raise ValueError(f"{path} length header {total_length} does not match file size {len(data)}")

    doc = None
    bin_chunk = b""
    offset = 12
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset: offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            doc = json.loads(chunk.rstrip(b" \t\r\n\0").decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            bin_chunk = chunk
    if doc is None:
        raise ValueError(f"{path} has no JSON chunk")
    return doc, bin_chunk


def pad4(data: bytes, pad_byte: bytes) -> bytes:
    pad = (4 - (len(data) % 4)) % 4
    return data + pad_byte * pad


def write_glb(path: Path, doc: dict[str, Any], bin_chunk: bytes) -> None:
    json_chunk = pad4(json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = pad4(bin_chunk, b"\0")
    total_length = 12 + 8 + len(json_chunk)
    if bin_chunk:
        total_length += 8 + len(bin_chunk)
    header = struct.pack("<III", 0x46546C67, 2, total_length)
    chunks = [header, struct.pack("<II", len(json_chunk), JSON_CHUNK), json_chunk]
    if bin_chunk:
        chunks.extend([struct.pack("<II", len(bin_chunk), BIN_CHUNK), bin_chunk])
    path.write_bytes(b"".join(chunks))


def accessor_array(doc: dict[str, Any], bin_chunk: bytes, accessor_index: int, role: str):
    import numpy as np

    accessors = doc.get("accessors") or []
    buffer_views = doc.get("bufferViews") or []
    if accessor_index < 0 or accessor_index >= len(accessors):
        raise BakeFailure("load", f"{role}-bad-accessor", f"{role} accessor index {accessor_index} is invalid")
    accessor = accessors[accessor_index]
    buffer_view_index = accessor.get("bufferView")
    if buffer_view_index is None or buffer_view_index < 0 or buffer_view_index >= len(buffer_views):
        raise BakeFailure("load", f"{role}-bad-buffer-view", f"{role} accessor has no valid bufferView")
    buffer_view = buffer_views[buffer_view_index]
    if buffer_view.get("buffer", 0) != 0:
        raise BakeFailure("load", f"{role}-external-buffer", f"{role} accessor uses a nonzero/external buffer")

    component_type = accessor.get("componentType")
    accessor_type = accessor.get("type")
    dtype = COMPONENT_DTYPES.get(component_type)
    width = ACCESSOR_WIDTHS.get(accessor_type)
    if dtype is None or width is None:
        raise BakeFailure("load", f"{role}-unsupported-accessor-type", f"{role} accessor type is unsupported")

    count = int(accessor.get("count") or 0)
    if count <= 0:
        raise BakeFailure("load", f"{role}-empty-accessor", f"{role} accessor is empty")
    np_dtype = np.dtype(dtype)
    byte_offset = int(buffer_view.get("byteOffset") or 0) + int(accessor.get("byteOffset") or 0)
    byte_stride = int(buffer_view.get("byteStride") or (np_dtype.itemsize * width))
    packed_stride = np_dtype.itemsize * width
    if byte_stride == packed_stride:
        array = np.frombuffer(bin_chunk, dtype=np_dtype, count=count * width, offset=byte_offset).reshape((count, width)).copy()
    else:
        array = np.empty((count, width), dtype=np_dtype)
        for index in range(count):
            array[index] = np.frombuffer(
                bin_chunk,
                dtype=np_dtype,
                count=width,
                offset=byte_offset + index * byte_stride,
            )
    if width == 1:
        return array[:, 0]
    return array


def write_accessor_array(doc: dict[str, Any], bin_chunk: bytes, accessor_index: int, values, role: str) -> bytes:
    import numpy as np

    accessors = doc.get("accessors") or []
    buffer_views = doc.get("bufferViews") or []
    if accessor_index < 0 or accessor_index >= len(accessors):
        raise BakeFailure("export", f"{role}-bad-accessor", f"{role} accessor index {accessor_index} is invalid")
    accessor = accessors[accessor_index]
    buffer_view_index = accessor.get("bufferView")
    if buffer_view_index is None or buffer_view_index < 0 or buffer_view_index >= len(buffer_views):
        raise BakeFailure("export", f"{role}-bad-buffer-view", f"{role} accessor has no valid bufferView")
    buffer_view = buffer_views[buffer_view_index]
    if buffer_view.get("buffer", 0) != 0:
        raise BakeFailure("export", f"{role}-external-buffer", f"{role} accessor uses a nonzero/external buffer")

    component_type = accessor.get("componentType")
    accessor_type = accessor.get("type")
    dtype = COMPONENT_DTYPES.get(component_type)
    width = ACCESSOR_WIDTHS.get(accessor_type)
    if dtype is None or width is None:
        raise BakeFailure("export", f"{role}-unsupported-accessor-type", f"{role} accessor type is unsupported")

    count = int(accessor.get("count") or 0)
    np_dtype = np.dtype(dtype)
    values = np.asarray(values, dtype=np_dtype)
    if width == 1:
        values = values.reshape((count,))
    else:
        values = values.reshape((count, width))
    byte_offset = int(buffer_view.get("byteOffset") or 0) + int(accessor.get("byteOffset") or 0)
    byte_stride = int(buffer_view.get("byteStride") or (np_dtype.itemsize * width))
    packed_stride = np_dtype.itemsize * width
    mutable = bytearray(bin_chunk)
    if byte_stride == packed_stride:
        payload = values.astype(np_dtype, copy=False).tobytes()
        mutable[byte_offset: byte_offset + len(payload)] = payload
    else:
        rows = values.reshape((count, width))
        for index, row in enumerate(rows):
            payload = np.asarray(row, dtype=np_dtype).tobytes()
            start = byte_offset + index * byte_stride
            mutable[start: start + packed_stride] = payload

    if count:
        flat = values.reshape((count, width)) if width > 1 else values.reshape((count, 1))
        accessor["min"] = [int(v) if np.issubdtype(np_dtype, np.integer) else float(v) for v in np.min(flat, axis=0)]
        accessor["max"] = [int(v) if np.issubdtype(np_dtype, np.integer) else float(v) for v in np.max(flat, axis=0)]
    return bytes(mutable)


def append_bin_payload(doc: dict[str, Any], bin_chunk: bytes, payload: bytes) -> tuple[bytes, int]:
    aligned_bin = pad4(bin_chunk, b"\0")
    byte_offset = len(aligned_bin)
    payload = pad4(payload, b"\0")
    buffer_views = doc.setdefault("bufferViews", [])
    buffer_view_index = len(buffer_views)
    buffer_views.append({
        "buffer": 0,
        "byteOffset": byte_offset,
        "byteLength": len(payload),
    })
    buffers = doc.setdefault("buffers", [{"byteLength": 0}])
    buffers[0]["byteLength"] = byte_offset + len(payload)
    return aligned_bin + payload, buffer_view_index


def texture_image_index(doc: dict[str, Any], texture_info: dict[str, Any] | None) -> int | None:
    if not texture_info:
        return None
    texture_index = texture_info.get("index")
    textures = doc.get("textures") or []
    if texture_index is None or texture_index < 0 or texture_index >= len(textures):
        return None
    return textures[texture_index].get("source")


def replace_or_create_pbr_image(
    doc: dict[str, Any],
    bin_chunk: bytes,
    texture_slot: str,
    image_path: Path,
    image_name: str,
) -> bytes:
    materials = doc.setdefault("materials", [{}])
    material = materials[0]
    material.setdefault("name", "kaminos-baked-pbr")
    material.setdefault("doubleSided", True)
    pbr = material.setdefault("pbrMetallicRoughness", {})
    texture_info = pbr.get(texture_slot)
    image_index = texture_image_index(doc, texture_info)
    if image_index is None:
        images = doc.setdefault("images", [])
        textures = doc.setdefault("textures", [])
        image_index = len(images)
        texture_index = len(textures)
        images.append({})
        textures.append({"source": image_index})
        pbr[texture_slot] = {"index": texture_index}

    payload = image_path.read_bytes()
    bin_chunk, buffer_view_index = append_bin_payload(doc, bin_chunk, payload)
    images = doc.setdefault("images", [])
    images[image_index] = {
        "bufferView": buffer_view_index,
        "mimeType": "image/png",
        "name": image_name,
    }
    return bin_chunk


def bind_missing_primitive_materials(doc: dict[str, Any], material_index: int = 0) -> None:
    materials = doc.setdefault("materials", [{}])
    if not materials:
        materials.append({})
    for mesh in doc.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            if "material" not in primitive:
                primitive["material"] = material_index


def ensure_vertex_normals(doc: dict[str, Any], bin_chunk: bytes) -> bytes:
    import numpy as np

    for mesh in doc.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            if int(primitive.get("mode", TRIANGLES)) != TRIANGLES:
                continue
            attrs = primitive.setdefault("attributes", {})
            if "NORMAL" in attrs:
                continue
            position_index = attrs.get("POSITION")
            if position_index is None:
                continue
            vertices = accessor_array(doc, bin_chunk, int(position_index), "target-normal-position").astype(np.float32)
            if vertices.ndim != 2 or vertices.shape[1] != 3:
                continue
            index_accessor = primitive.get("indices")
            if index_accessor is None:
                if len(vertices) % 3 != 0:
                    continue
                faces = np.arange(len(vertices), dtype=np.int64).reshape((-1, 3))
            else:
                indices = accessor_array(doc, bin_chunk, int(index_accessor), "target-normal-index").astype(np.int64)
                if len(indices) % 3 != 0:
                    continue
                faces = indices.reshape((-1, 3))

            tri = vertices[faces]
            face_normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            normals = np.zeros_like(vertices, dtype=np.float32)
            for corner in range(3):
                np.add.at(normals, faces[:, corner], face_normals)
            lengths = np.linalg.norm(normals, axis=1)
            valid = lengths > 1e-12
            normals[valid] /= lengths[valid, None]
            normals[~valid] = np.array([0.0, 0.0, 1.0], dtype=np.float32)
            payload = normals.astype("<f4", copy=False).tobytes()
            bin_chunk, buffer_view_index = append_bin_payload(doc, bin_chunk, payload)
            accessors = doc.setdefault("accessors", [])
            accessor_index = len(accessors)
            accessors.append({
                "bufferView": buffer_view_index,
                "componentType": 5126,
                "count": int(len(normals)),
                "type": "VEC3",
                "min": [float(v) for v in np.min(normals, axis=0)],
                "max": [float(v) for v in np.max(normals, axis=0)],
            })
            attrs["NORMAL"] = accessor_index
    return bin_chunk


def repair_target_winding(doc: dict[str, Any], bin_chunk: bytes) -> tuple[bytes, dict[str, Any]]:
    stats = {
        "status": "emitted",
        "policy": "consistent-indexed-triangle-edge-orientation",
        "primitiveCount": 0,
        "repairedPrimitives": 0,
        "skippedUnindexedPrimitives": 0,
        "faceCount": 0,
        "flippedFaces": 0,
        "flippedRatio": 0.0,
        "components": 0,
        "edgeCount": 0,
        "boundaryEdges": 0,
        "manifoldEdges": 0,
        "nonManifoldEdges": 0,
        "conflictEdges": 0,
    }
    for mesh in doc.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            if int(primitive.get("mode", TRIANGLES)) != TRIANGLES:
                continue
            stats["primitiveCount"] += 1
            index_accessor = primitive.get("indices")
            if index_accessor is None:
                stats["skippedUnindexedPrimitives"] += 1
                continue
            indices = accessor_array(doc, bin_chunk, int(index_accessor), "target-winding-index")
            if len(indices) % 3 != 0:
                raise BakeFailure("export", "target-winding-index-count", "target index count is not divisible by 3")
            faces = indices.astype("int64", copy=False).reshape((-1, 3))
            repaired, primitive_stats = consistent_winding_faces(faces)
            if primitive_stats["flippedFaces"]:
                bin_chunk = write_accessor_array(
                    doc,
                    bin_chunk,
                    int(index_accessor),
                    repaired.reshape((-1,)).astype(indices.dtype, copy=False),
                    "target-winding-index",
                )
                stats["repairedPrimitives"] += 1
            for key in (
                "faceCount",
                "flippedFaces",
                "components",
                "edgeCount",
                "boundaryEdges",
                "manifoldEdges",
                "nonManifoldEdges",
                "conflictEdges",
            ):
                stats[key] += primitive_stats[key]
    if stats["faceCount"]:
        stats["flippedRatio"] = float(stats["flippedFaces"] / stats["faceCount"])
    return bin_chunk, stats


def write_baked_glb_from_target(target_path: Path, output_path: Path, base_path: Path, mr_path: Path) -> dict[str, Any]:
    doc, bin_chunk = read_glb(target_path)
    asset = doc.setdefault("asset", {"version": "2.0"})
    previous_generator = asset.get("generator")
    asset["generator"] = "kaminos generated-asset-bake.py texture-injection"
    if previous_generator:
        asset["extras"] = {**(asset.get("extras") or {}), "sourceGenerator": previous_generator}
    bin_chunk, winding_stats = repair_target_winding(doc, bin_chunk)
    bin_chunk = replace_or_create_pbr_image(doc, bin_chunk, "baseColorTexture", base_path, "kaminos-baked-baseColor")
    bin_chunk = replace_or_create_pbr_image(doc, bin_chunk, "metallicRoughnessTexture", mr_path, "kaminos-baked-metallicRoughness")
    bind_missing_primitive_materials(doc, 0)
    bin_chunk = ensure_vertex_normals(doc, bin_chunk)
    write_glb(output_path, doc, bin_chunk)
    return winding_stats


def accessor_count(doc: dict[str, Any], accessor_index: int | None) -> int:
    if accessor_index is None:
        return 0
    accessors = doc.get("accessors") or []
    if accessor_index < 0 or accessor_index >= len(accessors):
        return 0
    return int(accessors[accessor_index].get("count") or 0)


def texture_name(doc: dict[str, Any], texture_info: dict[str, Any] | None) -> str | None:
    if not texture_info:
        return None
    textures = doc.get("textures") or []
    images = doc.get("images") or []
    tex_index = texture_info.get("index")
    if tex_index is None or tex_index < 0 or tex_index >= len(textures):
        return None
    source = textures[tex_index].get("source")
    if source is None or source < 0 or source >= len(images):
        return None
    image = images[source]
    return image.get("name") or image.get("uri") or f"image-{source}"


def assay_glb(path: Path) -> dict[str, Any]:
    doc = read_glb_json(path)
    primitive_count = 0
    vertex_count = 0
    triangle_count = 0
    has_uv0 = False
    has_normals = False

    for mesh in doc.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            primitive_count += 1
            attrs = primitive.get("attributes") or {}
            position = attrs.get("POSITION")
            indices = primitive.get("indices")
            mode = int(primitive.get("mode", TRIANGLES))
            p_vertices = accessor_count(doc, position)
            p_indices = accessor_count(doc, indices)
            p_triangles = p_indices // 3 if mode == TRIANGLES and p_indices else 0
            if not p_triangles and mode == TRIANGLES:
                p_triangles = p_vertices // 3
            vertex_count += p_vertices
            triangle_count += p_triangles
            has_uv0 = has_uv0 or "TEXCOORD_0" in attrs
            has_normals = has_normals or "NORMAL" in attrs

    material_records = []
    has_base = False
    has_mr = False
    for material_index, material in enumerate(doc.get("materials") or []):
        pbr = material.get("pbrMetallicRoughness") or {}
        base_name = texture_name(doc, pbr.get("baseColorTexture"))
        mr_name = texture_name(doc, pbr.get("metallicRoughnessTexture"))
        has_base = has_base or bool(base_name)
        has_mr = has_mr or bool(mr_name)
        material_records.append({
            "index": material_index,
            "name": material.get("name"),
            "doubleSided": material.get("doubleSided"),
            "baseColorTexture": base_name,
            "metallicRoughnessTexture": mr_name,
            "metallicFactor": pbr.get("metallicFactor"),
            "roughnessFactor": pbr.get("roughnessFactor"),
        })

    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "assetGenerator": (doc.get("asset") or {}).get("generator"),
        "assetVersion": (doc.get("asset") or {}).get("version"),
        "mesh": {
            "primitiveCount": primitive_count,
            "vertexCount": vertex_count,
            "triangleCount": triangle_count,
        },
        "geometry": {
            "hasUv0": has_uv0,
            "hasVertexNormals": has_normals,
        },
        "materials": {
            "materialCount": len(doc.get("materials") or []),
            "textureCount": len(doc.get("textures") or []),
            "imageCount": len(doc.get("images") or []),
            "hasBaseColorTexture": has_base,
            "hasMetallicRoughnessTexture": has_mr,
            "records": material_records,
        },
    }


def pending_products() -> dict[str, Any]:
    return {
        "baseColor": {"status": "pending", "description": "Projected source baseColor values onto target UV0."},
        "metallicRoughness": {"status": "pending", "description": "Projected source metallicRoughness values onto target UV0."},
        "normal": {"status": "not-implemented", "description": "No tangent-space normal bake exists in V0."},
        "ambientOcclusion": {"status": "not-implemented", "description": "No AO/cavity bake exists in V0."},
        "emissive": {"status": "not-implemented", "description": "No emissive mask extraction exists in V0."},
        "height": {"status": "deferred", "description": "No height/parallax map is emitted in V0."},
    }


def pending_diagnostics() -> dict[str, Any]:
    return {
        "distance": {"status": "pending", "description": "Projection distance heatmap."},
        "route": {"status": "pending", "description": "Projection route/coverage mask."},
        "unresolvedMask": {"status": "pending", "description": "Texture-atlas pixels not covered by target UV islands."},
    }


def manifest_base(
    source_path: Path,
    target_path: Path,
    out_dir: Path,
    asset_name: str,
    source_assay: dict[str, Any] | None,
    target_assay: dict[str, Any] | None,
    projection_route: str,
    source_triangle_candidates: int,
    padding_pixels: int,
    normal_min_dot: float,
) -> dict[str, Any]:
    return {
        "schema": BAKE_SCHEMA,
        "createdAt": utc_now(),
        "assetName": asset_name,
        "status": "pending",
        "source": source_assay or {"path": str(source_path)},
        "target": target_assay or {"path": str(target_path)},
        "uvPolicy": "required-existing-uv0",
        "projection": {
            "route": projection_route,
            "sourceTriangleCandidates": source_triangle_candidates if projection_route.startswith("nearest-source-surface") else None,
            "normalMinDot": normal_min_dot if projection_route == "nearest-source-surface-normal-aware" else None,
            "status": "pending",
            "description": "Target UV pixels reconstruct target surface positions, then sample source material UV through the recorded projection route.",
        },
        "padding": {
            "status": "pending",
            "pixels": padding_pixels,
            "mode": "nearest-covered-atlas-pixel",
            "description": "Dilate covered target UV island pixels into nearby uncovered atlas pixels to reduce bilinear/mip seam pull.",
        },
        "targetWinding": {
            "status": "pending",
            "policy": "consistent-indexed-triangle-edge-orientation",
            "description": "Indexed target triangles are rewound to consistent shared-edge orientation before generated normals and material injection.",
        },
        "products": pending_products(),
        "diagnostics": pending_diagnostics(),
        "outputDirectory": str(out_dir),
    }


def write_manifest(out_dir: Path, manifest: dict[str, Any]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "generated-asset-bake-manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    return path


def preflight(manifest: dict[str, Any]) -> None:
    if not manifest["source"]["geometry"]["hasUv0"]:
        raise BakeFailure("preflight", "source-missing-uv0", "source GLB has no TEXCOORD_0; Bake V0 requires existing UV0")
    if not manifest["target"]["geometry"]["hasUv0"]:
        raise BakeFailure("preflight", "target-missing-uv0", "target GLB has no TEXCOORD_0; Bake V0 requires existing UV0")
    if not manifest["source"]["materials"]["hasBaseColorTexture"]:
        raise BakeFailure("preflight", "source-missing-basecolor", "source GLB has no baseColor texture to transfer")
    if not manifest["source"]["materials"]["hasMetallicRoughnessTexture"]:
        raise BakeFailure("preflight", "source-missing-metallicroughness", "source GLB has no metallicRoughness texture to transfer")
    if manifest["projection"]["route"] not in {"nearest-source-vertex", "nearest-source-surface", "nearest-source-surface-normal-aware"}:
        raise BakeFailure("preflight", "unsupported-projection-route", f"unsupported projection route {manifest['projection']['route']}")
    if manifest["projection"]["route"].startswith("nearest-source-surface") and int(manifest["projection"]["sourceTriangleCandidates"]) <= 0:
        raise BakeFailure("preflight", "invalid-source-triangle-candidates", "nearest-source-surface requires at least one triangle candidate")
    normal_min_dot = manifest["projection"]["normalMinDot"]
    if normal_min_dot is not None and not (-1.0 <= float(normal_min_dot) <= 1.0):
        raise BakeFailure("preflight", "invalid-normal-min-dot", "normalMinDot must be between -1 and 1")
    if int(manifest["padding"]["pixels"]) < 0:
        raise BakeFailure("preflight", "invalid-padding-pixels", "padding pixels must be non-negative")


def load_single_mesh(path: Path, role: str):
    import trimesh

    scene = trimesh.load(path, force="scene")
    if len(scene.geometry) != 1:
        raise BakeFailure("load", f"{role}-unsupported-geometry-count", f"{role} GLB has {len(scene.geometry)} geometries; V0 expects one")
    mesh = next(iter(scene.geometry.values())).copy()
    uv = getattr(mesh.visual, "uv", None)
    if uv is None:
        raise BakeFailure("load", f"{role}-missing-visual-uv0", f"{role} mesh visual has no UV array")
    material = getattr(mesh.visual, "material", None)
    if material is None:
        raise BakeFailure("load", f"{role}-missing-material", f"{role} mesh has no material")
    return mesh


def load_target_geometry(path: Path, role: str) -> TargetGeometry:
    import numpy as np

    doc, bin_chunk = read_glb(path)
    primitive = None
    for mesh in doc.get("meshes") or []:
        for candidate in mesh.get("primitives") or []:
            if int(candidate.get("mode", TRIANGLES)) == TRIANGLES:
                primitive = candidate
                break
        if primitive is not None:
            break
    if primitive is None:
        raise BakeFailure("load", f"{role}-missing-triangle-primitive", f"{role} GLB has no TRIANGLES primitive")
    attrs = primitive.get("attributes") or {}
    position_index = attrs.get("POSITION")
    uv_index = attrs.get("TEXCOORD_0")
    if position_index is None:
        raise BakeFailure("load", f"{role}-missing-position", f"{role} GLB has no POSITION attribute")
    if uv_index is None:
        raise BakeFailure("load", f"{role}-missing-uv0", f"{role} GLB has no TEXCOORD_0 attribute")

    vertices = accessor_array(doc, bin_chunk, int(position_index), role).astype(np.float32)
    uv = accessor_array(doc, bin_chunk, int(uv_index), role).astype(np.float32)
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise BakeFailure("load", f"{role}-bad-position-shape", f"{role} POSITION is not VEC3")
    if uv.ndim != 2 or uv.shape[1] != 2:
        raise BakeFailure("load", f"{role}-bad-uv-shape", f"{role} TEXCOORD_0 is not VEC2")
    if len(vertices) != len(uv):
        raise BakeFailure("load", f"{role}-position-uv-count-mismatch", f"{role} POSITION and TEXCOORD_0 counts differ")

    index_accessor = primitive.get("indices")
    if index_accessor is None:
        if len(vertices) % 3 != 0:
            raise BakeFailure("load", f"{role}-unindexed-triangle-count", f"{role} unindexed vertex count is not divisible by 3")
        faces = np.arange(len(vertices), dtype=np.int64).reshape((-1, 3))
    else:
        indices = accessor_array(doc, bin_chunk, int(index_accessor), role).astype(np.int64)
        if len(indices) % 3 != 0:
            raise BakeFailure("load", f"{role}-index-count", f"{role} index count is not divisible by 3")
        faces = indices.reshape((-1, 3))
    repaired_faces, winding_stats = consistent_winding_faces(faces)
    return TargetGeometry(vertices, repaired_faces, uv, winding_stats)


def image_array(image, mode: str):
    import numpy as np

    return np.asarray(image.convert(mode), dtype=np.float32)


def bilinear_sample(image, uv):
    import numpy as np

    h, w, channels = image.shape
    u = np.clip(uv[:, 0], 0.0, 1.0)
    v = np.clip(uv[:, 1], 0.0, 1.0)
    x = u * (w - 1)
    y = (1.0 - v) * (h - 1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    wx = (x - x0)[:, None]
    wy = (y - y0)[:, None]
    top = image[y0, x0] * (1.0 - wx) + image[y0, x1] * wx
    bottom = image[y1, x0] * (1.0 - wx) + image[y1, x1] * wx
    return top * (1.0 - wy) + bottom * wy


def barycentric_grid(points, a, b, c):
    import numpy as np

    v0 = b - a
    v1 = c - a
    v2 = points - a
    d00 = float(np.dot(v0, v0))
    d01 = float(np.dot(v0, v1))
    d11 = float(np.dot(v1, v1))
    d20 = v2 @ v0
    d21 = v2 @ v1
    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-12:
        return None
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    u = 1.0 - v - w
    return u, v, w


def closest_points_on_segments(points, a, b):
    import numpy as np

    ab = b - a
    denom = np.sum(ab * ab, axis=1)
    safe = denom > 1e-12
    t = np.zeros(len(points), dtype=np.float32)
    t[safe] = np.sum((points[safe] - a[safe]) * ab[safe], axis=1) / denom[safe]
    t = np.clip(t, 0.0, 1.0)
    closest = a + t[:, None] * ab
    dist2 = np.sum((points - closest) ** 2, axis=1)
    return closest, dist2, t


def closest_points_on_triangles(points, a, b, c):
    import numpy as np

    n = len(points)
    v0 = b - a
    v1 = c - a
    v2 = points - a
    d00 = np.sum(v0 * v0, axis=1)
    d01 = np.sum(v0 * v1, axis=1)
    d11 = np.sum(v1 * v1, axis=1)
    d20 = np.sum(v2 * v0, axis=1)
    d21 = np.sum(v2 * v1, axis=1)
    denom = d00 * d11 - d01 * d01
    safe = np.abs(denom) > 1e-12

    plane_bary = np.zeros((n, 3), dtype=np.float32)
    plane_bary[safe, 1] = (d11[safe] * d20[safe] - d01[safe] * d21[safe]) / denom[safe]
    plane_bary[safe, 2] = (d00[safe] * d21[safe] - d01[safe] * d20[safe]) / denom[safe]
    plane_bary[safe, 0] = 1.0 - plane_bary[safe, 1] - plane_bary[safe, 2]
    plane_point = (
        plane_bary[:, 0:1] * a
        + plane_bary[:, 1:2] * b
        + plane_bary[:, 2:3] * c
    )
    plane_dist2 = np.sum((points - plane_point) ** 2, axis=1)
    inside = safe & np.all(plane_bary >= -1e-5, axis=1)

    best_point = plane_point.copy()
    best_bary = plane_bary.copy()
    best_dist2 = plane_dist2.copy()
    best_dist2[~inside] = np.inf

    edge_ab, dist_ab, t_ab = closest_points_on_segments(points, a, b)
    edge_bc, dist_bc, t_bc = closest_points_on_segments(points, b, c)
    edge_ca, dist_ca, t_ca = closest_points_on_segments(points, c, a)

    improve = dist_ab < best_dist2
    best_point[improve] = edge_ab[improve]
    best_dist2[improve] = dist_ab[improve]
    best_bary[improve] = np.stack([1.0 - t_ab[improve], t_ab[improve], np.zeros(np.count_nonzero(improve))], axis=1)

    improve = dist_bc < best_dist2
    best_point[improve] = edge_bc[improve]
    best_dist2[improve] = dist_bc[improve]
    best_bary[improve] = np.stack([np.zeros(np.count_nonzero(improve)), 1.0 - t_bc[improve], t_bc[improve]], axis=1)

    improve = dist_ca < best_dist2
    best_point[improve] = edge_ca[improve]
    best_dist2[improve] = dist_ca[improve]
    best_bary[improve] = np.stack([t_ca[improve], np.zeros(np.count_nonzero(improve)), 1.0 - t_ca[improve]], axis=1)

    return best_point, best_bary, best_dist2


def nearest_source_surface_uvs(
    positions,
    source_vertices,
    source_faces,
    source_uv,
    centroid_tree,
    candidate_count,
    source_face_normals=None,
    target_normals=None,
    normal_min_dot=None,
):
    import numpy as np

    k = min(max(1, int(candidate_count)), len(source_faces))
    _, candidate_triangles = centroid_tree.query(positions, k=k)
    if k == 1:
        candidate_triangles = candidate_triangles[:, None]

    best_dist2 = np.full(len(positions), np.inf, dtype=np.float32)
    best_uv = np.zeros((len(positions), 2), dtype=np.float32)
    fallback_dist2 = np.full(len(positions), np.inf, dtype=np.float32)
    fallback_uv = np.zeros((len(positions), 2), dtype=np.float32)
    normal_rejected = 0
    normal_aware = source_face_normals is not None and target_normals is not None and normal_min_dot is not None
    for candidate_slot in range(candidate_triangles.shape[1]):
        tri_indices = candidate_triangles[:, candidate_slot]
        faces = source_faces[tri_indices]
        a = source_vertices[faces[:, 0]]
        b = source_vertices[faces[:, 1]]
        c = source_vertices[faces[:, 2]]
        _, bary, dist2 = closest_points_on_triangles(positions, a, b, c)
        fallback_improve = dist2 < fallback_dist2
        if np.any(fallback_improve):
            fallback_uv_tri = source_uv[faces[fallback_improve]]
            fallback_uv[fallback_improve] = (
                bary[fallback_improve, 0:1] * fallback_uv_tri[:, 0]
                + bary[fallback_improve, 1:2] * fallback_uv_tri[:, 1]
                + bary[fallback_improve, 2:3] * fallback_uv_tri[:, 2]
            )
            fallback_dist2[fallback_improve] = dist2[fallback_improve]

        valid = np.ones(len(positions), dtype=bool)
        if normal_aware:
            dots = np.sum(source_face_normals[tri_indices] * target_normals, axis=1)
            valid = dots >= float(normal_min_dot)
            normal_rejected += int(np.count_nonzero(~valid))

        improve = valid & (dist2 < best_dist2)
        if not np.any(improve):
            continue
        uv_tri = source_uv[faces[improve]]
        best_uv[improve] = (
            bary[improve, 0:1] * uv_tri[:, 0]
            + bary[improve, 1:2] * uv_tri[:, 1]
            + bary[improve, 2:3] * uv_tri[:, 2]
        )
        best_dist2[improve] = dist2[improve]

    missing = ~np.isfinite(best_dist2)
    if np.any(missing):
        best_dist2[missing] = fallback_dist2[missing]
        best_uv[missing] = fallback_uv[missing]

    return np.sqrt(best_dist2), best_uv, normal_rejected


def dilate_atlas_pixels(out_base, out_mr, covered, padding_pixels):
    import numpy as np
    from scipy import ndimage

    padding_pixels = int(padding_pixels)
    padding_mask = np.zeros_like(covered, dtype=bool)
    if padding_pixels <= 0 or not np.any(covered):
        return padding_mask

    uncovered = ~covered
    distances, indices = ndimage.distance_transform_edt(uncovered, return_indices=True)
    padding_mask = uncovered & (distances <= padding_pixels)
    if not np.any(padding_mask):
        return padding_mask

    source_y = indices[0][padding_mask]
    source_x = indices[1][padding_mask]
    out_base[padding_mask] = out_base[source_y, source_x]
    out_mr[padding_mask] = out_mr[source_y, source_x]
    return padding_mask


def bake(
    source_path: Path,
    target_path: Path,
    out_dir: Path,
    texture_size: int,
    projection_route: str,
    source_triangle_candidates: int,
    padding_pixels: int,
    normal_min_dot: float,
) -> dict[str, Any]:
    import numpy as np
    from PIL import Image
    from scipy.spatial import cKDTree

    source_mesh = load_single_mesh(source_path, "source")
    target_mesh = load_target_geometry(target_path, "target")

    source_material = source_mesh.visual.material
    source_base = getattr(source_material, "baseColorTexture", None)
    source_mr = getattr(source_material, "metallicRoughnessTexture", None)
    if source_base is None:
        raise BakeFailure("load", "source-missing-basecolor-image", "source material has no baseColorTexture image")
    if source_mr is None:
        raise BakeFailure("load", "source-missing-metallicroughness-image", "source material has no metallicRoughnessTexture image")

    size = int(texture_size)
    if size <= 0:
        raise BakeFailure("preflight", "invalid-texture-size", "texture size must be positive")

    textures_dir = out_dir / "textures"
    debug_dir = out_dir / "debug"
    textures_dir.mkdir(parents=True, exist_ok=True)
    debug_dir.mkdir(parents=True, exist_ok=True)

    source_vertices = np.asarray(source_mesh.vertices, dtype=np.float32)
    source_uv = np.asarray(source_mesh.visual.uv, dtype=np.float32)
    source_faces = np.asarray(source_mesh.faces, dtype=np.int64)
    target_vertices = np.asarray(target_mesh.vertices, dtype=np.float32)
    target_uv = np.asarray(target_mesh.uv, dtype=np.float32)
    target_faces = np.asarray(target_mesh.faces, dtype=np.int64)

    base_img = image_array(source_base, "RGBA")
    mr_img = image_array(source_mr, "RGB")
    vertex_tree = cKDTree(source_vertices) if projection_route == "nearest-source-vertex" else None
    if projection_route.startswith("nearest-source-surface"):
        source_triangles = source_vertices[source_faces]
        centroid_tree = cKDTree(np.mean(source_triangles, axis=1))
        source_face_normals = np.asarray(source_mesh.face_normals, dtype=np.float32)
    else:
        centroid_tree = None
        source_face_normals = None
    if projection_route == "nearest-source-surface-normal-aware":
        target_vertex_normals = np.asarray(target_mesh.vertex_normals, dtype=np.float32)
    else:
        target_vertex_normals = None

    out_base = np.zeros((size, size, 4), dtype=np.float32)
    out_mr = np.zeros((size, size, 3), dtype=np.float32)
    distance = np.full((size, size), np.nan, dtype=np.float32)
    covered = np.zeros((size, size), dtype=bool)
    normal_rejected_total = 0

    uv_px = np.empty_like(target_uv)
    uv_px[:, 0] = target_uv[:, 0] * (size - 1)
    uv_px[:, 1] = (1.0 - target_uv[:, 1]) * (size - 1)

    for face in target_faces:
        tri_uv = uv_px[face]
        min_x = max(0, int(math.floor(float(np.min(tri_uv[:, 0])))))
        max_x = min(size - 1, int(math.ceil(float(np.max(tri_uv[:, 0])))))
        min_y = max(0, int(math.floor(float(np.min(tri_uv[:, 1])))))
        max_y = min(size - 1, int(math.ceil(float(np.max(tri_uv[:, 1])))))
        if min_x > max_x or min_y > max_y:
            continue

        xs = np.arange(min_x, max_x + 1, dtype=np.float32) + 0.5
        ys = np.arange(min_y, max_y + 1, dtype=np.float32) + 0.5
        grid_x, grid_y = np.meshgrid(xs, ys)
        pixels = np.stack([grid_x.ravel(), grid_y.ravel()], axis=1)
        bary = barycentric_grid(pixels, tri_uv[0], tri_uv[1], tri_uv[2])
        if bary is None:
            continue
        b0, b1, b2 = bary
        mask = (b0 >= -1e-4) & (b1 >= -1e-4) & (b2 >= -1e-4)
        if not np.any(mask):
            continue

        rows, cols = np.divmod(np.nonzero(mask)[0], max_x - min_x + 1)
        py = rows + min_y
        px = cols + min_x
        weights = np.stack([b0[mask], b1[mask], b2[mask]], axis=1).astype(np.float32)
        tri_pos = target_vertices[face]
        positions = weights @ tri_pos
        if projection_route.startswith("nearest-source-surface"):
            if projection_route == "nearest-source-surface-normal-aware":
                target_tri_normals = target_vertex_normals[face]
                target_normals = weights @ target_tri_normals
                normal_lengths = np.linalg.norm(target_normals, axis=1)
                valid_normals = normal_lengths > 1e-9
                target_normals[valid_normals] /= normal_lengths[valid_normals, None]
            else:
                target_normals = None
            dists, sample_uv, normal_rejected = nearest_source_surface_uvs(
                positions,
                source_vertices,
                source_faces,
                source_uv,
                centroid_tree,
                source_triangle_candidates,
                source_face_normals=source_face_normals,
                target_normals=target_normals,
                normal_min_dot=normal_min_dot if projection_route == "nearest-source-surface-normal-aware" else None,
            )
            normal_rejected_total += normal_rejected
        else:
            dists, source_indices = vertex_tree.query(positions, k=1)
            sample_uv = source_uv[source_indices]

        out_base[py, px] = bilinear_sample(base_img, sample_uv)
        out_mr[py, px] = bilinear_sample(mr_img, sample_uv)
        distance[py, px] = dists.astype(np.float32)
        covered[py, px] = True

    unresolved = ~covered
    if np.any(covered):
        distance_values = distance[covered]
        p95 = float(np.percentile(distance_values, 95))
        max_dist = float(np.max(distance_values))
        mean_dist = float(np.mean(distance_values))
        min_dist = float(np.min(distance_values))
        norm_max = max(p95, 1e-6)
        distance_vis = np.zeros((size, size), dtype=np.uint8)
        distance_vis[covered] = np.clip((distance[covered] / norm_max) * 255.0, 0, 255).astype(np.uint8)
    else:
        p95 = max_dist = mean_dist = min_dist = None
        distance_vis = np.zeros((size, size), dtype=np.uint8)

    padding_mask = dilate_atlas_pixels(out_base, out_mr, covered, padding_pixels)
    remaining_unresolved = ~(covered | padding_mask)
    out_base[remaining_unresolved] = np.array([0, 0, 0, 0], dtype=np.float32)
    out_mr[remaining_unresolved] = np.array([0, 255, 255], dtype=np.float32)

    base_path = textures_dir / "baseColor.png"
    mr_path = textures_dir / "metallicRoughness.png"
    distance_path = debug_dir / "projectionDistance.png"
    route_path = debug_dir / "projectionRoute.png"
    unresolved_path = debug_dir / "unresolvedMask.png"
    padding_path = debug_dir / "paddingMask.png"

    Image.fromarray(np.clip(out_base, 0, 255).astype(np.uint8), mode="RGBA").save(base_path)
    Image.fromarray(np.clip(out_mr, 0, 255).astype(np.uint8), mode="RGB").save(mr_path)
    Image.fromarray(distance_vis, mode="L").save(distance_path)
    Image.fromarray((covered.astype(np.uint8) * 255), mode="L").save(route_path)
    Image.fromarray((unresolved.astype(np.uint8) * 255), mode="L").save(unresolved_path)
    Image.fromarray((padding_mask.astype(np.uint8) * 255), mode="L").save(padding_path)

    baked_glb = out_dir / "asset-baked.glb"
    target_winding = write_baked_glb_from_target(target_path, baked_glb, base_path, mr_path)
    post_export_assay = assay_glb(baked_glb)

    total_pixels = size * size
    covered_pixels = int(np.count_nonzero(covered))
    return {
        "textureSize": size,
        "coveredPixels": covered_pixels,
        "totalPixels": total_pixels,
        "atlasCoverageRatio": float(covered_pixels / total_pixels),
        "atlasUncoveredRatio": float((total_pixels - covered_pixels) / total_pixels),
        "paddingPixels": int(padding_pixels),
        "paddedPixels": int(np.count_nonzero(padding_mask)),
        "atlasPaddedRatio": float(np.count_nonzero(padding_mask) / total_pixels),
        "remainingUncoveredRatio": float(np.count_nonzero(remaining_unresolved) / total_pixels),
        "normalMinDot": float(normal_min_dot) if projection_route == "nearest-source-surface-normal-aware" else None,
        "normalRejectedCandidates": int(normal_rejected_total),
        "targetWinding": target_winding,
        "distance": {
            "min": min_dist,
            "mean": mean_dist,
            "p95": p95,
            "max": max_dist,
        },
        "paths": {
            "bakedGlb": str(baked_glb),
            "baseColor": str(base_path),
            "metallicRoughness": str(mr_path),
            "projectionDistance": str(distance_path),
            "projectionRoute": str(route_path),
            "unresolvedMask": str(unresolved_path),
            "paddingMask": str(padding_path),
        },
        "postExportAssay": {
            "hasVertexNormals": post_export_assay["geometry"]["hasVertexNormals"],
            "hasUv0": post_export_assay["geometry"]["hasUv0"],
            "triangleCount": post_export_assay["mesh"]["triangleCount"],
            "vertexCount": post_export_assay["mesh"]["vertexCount"],
            "materialRecords": post_export_assay["materials"]["records"],
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="High/detail source GLB with existing UV0 and PBR textures")
    parser.add_argument("--target", required=True, help="Target GLB whose existing UV0 receives baked textures")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    parser.add_argument("--name", default=None, help="Stable asset name")
    parser.add_argument("--texture-size", type=int, default=1024, help="Square bake texture size")
    parser.add_argument(
        "--projection-route",
        choices=["nearest-source-surface-normal-aware", "nearest-source-surface", "nearest-source-vertex"],
        default="nearest-source-surface-normal-aware",
        help="Source material lookup route",
    )
    parser.add_argument("--source-triangle-candidates", type=int, default=12, help="Triangle candidates for nearest-source-surface")
    parser.add_argument("--normal-min-dot", type=float, default=0.25, help="Minimum source/target normal dot for normal-aware surface projection")
    parser.add_argument("--padding-pixels", type=int, default=12, help="UV island dilation radius in atlas pixels")
    parser.add_argument("--assay-only", action="store_true", help="Only write assay/manifest; do not project")
    args = parser.parse_args(argv)

    source_path = Path(args.source).expanduser().resolve()
    target_path = Path(args.target).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    asset_name = args.name or target_path.stem
    source_assay: dict[str, Any] | None = None
    target_assay: dict[str, Any] | None = None

    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        source_assay = assay_glb(source_path)
        target_assay = assay_glb(target_path)
        manifest = manifest_base(
            source_path,
            target_path,
            out_dir,
            asset_name,
            source_assay,
            target_assay,
            args.projection_route,
            args.source_triangle_candidates,
            args.padding_pixels,
            args.normal_min_dot,
        )
        preflight(manifest)
        if args.assay_only:
            manifest["status"] = "assay-only"
        else:
            started = time.time()
            stats = bake(
                source_path,
                target_path,
                out_dir,
                args.texture_size,
                args.projection_route,
                args.source_triangle_candidates,
                args.padding_pixels,
                args.normal_min_dot,
            )
            manifest["status"] = "emitted"
            manifest["projection"]["status"] = "emitted"
            manifest["projection"]["durationMs"] = int((time.time() - started) * 1000)
            manifest["projection"]["textureSize"] = stats["textureSize"]
            manifest["projection"]["coveredPixels"] = stats["coveredPixels"]
            manifest["projection"]["totalPixels"] = stats["totalPixels"]
            manifest["projection"]["atlasCoverageRatio"] = stats["atlasCoverageRatio"]
            manifest["projection"]["atlasUncoveredRatio"] = stats["atlasUncoveredRatio"]
            manifest["projection"]["distance"] = stats["distance"]
            if stats["normalMinDot"] is not None:
                manifest["projection"]["normalMinDot"] = stats["normalMinDot"]
                manifest["projection"]["normalRejectedCandidates"] = stats["normalRejectedCandidates"]
            manifest["targetWinding"].update(stats["targetWinding"])
            manifest["padding"].update({
                "status": "emitted",
                "paddedPixels": stats["paddedPixels"],
                "atlasPaddedRatio": stats["atlasPaddedRatio"],
                "remainingUncoveredRatio": stats["remainingUncoveredRatio"],
            })
            manifest["products"]["baseColor"].update({"status": "emitted", "path": stats["paths"]["baseColor"]})
            manifest["products"]["metallicRoughness"].update({"status": "emitted", "path": stats["paths"]["metallicRoughness"]})
            manifest["products"]["glb"] = {"status": "emitted", "path": stats["paths"]["bakedGlb"]}
            manifest["postExportAssay"] = stats["postExportAssay"]
            manifest["diagnostics"]["distance"].update({"status": "emitted", "path": stats["paths"]["projectionDistance"]})
            manifest["diagnostics"]["route"].update({"status": "emitted", "path": stats["paths"]["projectionRoute"]})
            manifest["diagnostics"]["unresolvedMask"].update({"status": "emitted", "path": stats["paths"]["unresolvedMask"]})
            manifest["diagnostics"]["paddingMask"] = {"status": "emitted", "path": stats["paths"]["paddingMask"]}
        manifest_path = write_manifest(out_dir, manifest)
        print(json.dumps({"manifest": str(manifest_path), "status": manifest["status"]}, indent=2))
        return 0
    except BakeFailure as exc:
        manifest = manifest_base(
            source_path,
            target_path,
            out_dir,
            asset_name,
            source_assay,
            target_assay,
            args.projection_route,
            args.source_triangle_candidates,
            args.padding_pixels,
            args.normal_min_dot,
        )
        manifest["status"] = "failed"
        manifest["failure"] = {"phase": exc.phase, "code": exc.code, "message": exc.message}
        manifest_path = write_manifest(out_dir, manifest)
        print(json.dumps({"manifest": str(manifest_path), "status": "failed", "failure": manifest["failure"]}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        manifest = manifest_base(
            source_path,
            target_path,
            out_dir,
            asset_name,
            source_assay,
            target_assay,
            args.projection_route,
            args.source_triangle_candidates,
            args.padding_pixels,
            args.normal_min_dot,
        )
        manifest["status"] = "failed"
        manifest["failure"] = {"phase": "unexpected", "code": exc.__class__.__name__, "message": str(exc)}
        manifest_path = write_manifest(out_dir, manifest)
        print(json.dumps({"manifest": str(manifest_path), "status": "failed", "failure": manifest["failure"]}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
