#!/usr/bin/env python3
"""Assay generated GLBs and build an honest first LOD/bake manifest.

This tool is intentionally conservative. It records what a GLB actually
contains, optionally emits reduced geometry GLBs when trimesh/fast-simplification
are available, and marks bake products pending until a real high-to-low bake path
exists.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
import time
from pathlib import Path
from typing import Any


JSON_CHUNK = 0x4E4F534A
TRIANGLES = 4


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


def accessor_count(doc: dict[str, Any], accessor_index: int | None) -> int:
    if accessor_index is None:
        return 0
    accessors = doc.get("accessors") or []
    if accessor_index < 0 or accessor_index >= len(accessors):
        return 0
    return int(accessors[accessor_index].get("count") or 0)


def accessor_bounds(doc: dict[str, Any], accessor_index: int | None) -> dict[str, Any] | None:
    if accessor_index is None:
        return None
    accessors = doc.get("accessors") or []
    if accessor_index < 0 or accessor_index >= len(accessors):
        return None
    accessor = accessors[accessor_index]
    if "min" not in accessor or "max" not in accessor:
        return None
    return {"min": accessor["min"], "max": accessor["max"]}


def texture_name(doc: dict[str, Any], texture_info: dict[str, Any] | None) -> str | None:
    if not texture_info:
        return None
    textures = doc.get("textures") or []
    images = doc.get("images") or []
    tex_index = texture_info.get("index")
    if tex_index is None or tex_index >= len(textures):
        return None
    source = textures[tex_index].get("source")
    if source is None or source >= len(images):
        return None
    image = images[source]
    return image.get("name") or image.get("uri") or f"image-{source}"


def assay_glb(path: Path) -> dict[str, Any]:
    doc = read_glb_json(path)
    primitives = []
    vertex_count = 0
    triangle_count = 0
    has_normals = False
    has_tangents = False
    has_uv0 = False
    bounds = None

    for mesh_index, mesh in enumerate(doc.get("meshes") or []):
        for primitive_index, primitive in enumerate(mesh.get("primitives") or []):
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
            has_normals = has_normals or "NORMAL" in attrs
            has_tangents = has_tangents or "TANGENT" in attrs
            has_uv0 = has_uv0 or "TEXCOORD_0" in attrs
            if bounds is None:
                bounds = accessor_bounds(doc, position)
            primitives.append({
                "meshIndex": mesh_index,
                "primitiveIndex": primitive_index,
                "mode": mode,
                "material": primitive.get("material"),
                "vertexCount": p_vertices,
                "indexCount": p_indices,
                "triangleCount": p_triangles,
                "attributes": sorted(attrs.keys()),
            })

    material_records = []
    has_base = False
    has_mr = False
    has_normal = False
    has_occlusion = False
    has_emissive = False
    for material_index, material in enumerate(doc.get("materials") or []):
        pbr = material.get("pbrMetallicRoughness") or {}
        base_name = texture_name(doc, pbr.get("baseColorTexture"))
        mr_name = texture_name(doc, pbr.get("metallicRoughnessTexture"))
        normal_name = texture_name(doc, material.get("normalTexture"))
        occlusion_name = texture_name(doc, material.get("occlusionTexture"))
        emissive_name = texture_name(doc, material.get("emissiveTexture"))
        has_base = has_base or bool(base_name)
        has_mr = has_mr or bool(mr_name)
        has_normal = has_normal or bool(normal_name)
        has_occlusion = has_occlusion or bool(occlusion_name)
        has_emissive = has_emissive or bool(emissive_name)
        material_records.append({
            "index": material_index,
            "name": material.get("name"),
            "baseColorTexture": base_name,
            "metallicRoughnessTexture": mr_name,
            "normalTexture": normal_name,
            "occlusionTexture": occlusion_name,
            "emissiveTexture": emissive_name,
            "metallicFactor": pbr.get("metallicFactor"),
            "roughnessFactor": pbr.get("roughnessFactor"),
        })

    warnings = []
    if not has_normal:
        warnings.append("no-tangent-space-normal-map")
    if not has_occlusion:
        warnings.append("no-occlusion-map")
    if not has_emissive:
        warnings.append("no-emissive-map")
    if not has_tangents:
        warnings.append("no-tangent-attribute")

    return {
        "schema": "kaminos.generated-asset-assay.v0",
        "createdAt": utc_now(),
        "source": {
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "assetGenerator": (doc.get("asset") or {}).get("generator"),
            "assetVersion": (doc.get("asset") or {}).get("version"),
        },
        "mesh": {
            "meshCount": len(doc.get("meshes") or []),
            "primitiveCount": len(primitives),
            "vertexCount": vertex_count,
            "triangleCount": triangle_count,
            "bounds": bounds,
            "primitives": primitives,
        },
        "geometry": {
            "hasVertexNormals": has_normals,
            "hasTangents": has_tangents,
            "hasUv0": has_uv0,
        },
        "materials": {
            "materialCount": len(doc.get("materials") or []),
            "textureCount": len(doc.get("textures") or []),
            "imageCount": len(doc.get("images") or []),
            "hasBaseColorTexture": has_base,
            "hasMetallicRoughnessTexture": has_mr,
            "hasNormalTexture": has_normal,
            "hasOcclusionTexture": has_occlusion,
            "hasEmissiveTexture": has_emissive,
            "records": material_records,
        },
        "truthWarnings": warnings,
    }


def bake_product_manifest() -> dict[str, Any]:
    return {
        "baseColor": {
            "status": "source-or-pending",
            "description": "Use source baseColorTexture when present; high-to-low rebake is a follow-up.",
        },
        "metallicRoughness": {
            "status": "source-or-pending",
            "description": "Use source metallicRoughnessTexture when present; high-to-low rebake is a follow-up.",
        },
        "normal": {
            "status": "pending",
            "description": "No tangent-space normal map is emitted until high-to-low projection exists.",
        },
        "ambientOcclusion": {
            "status": "pending",
            "description": "No AO/occlusion map is emitted until high-to-low or screen/object-space bake exists.",
        },
        "curvature": {
            "status": "pending",
            "description": "Curvature/cavity masks are planned for generated-asset material triage.",
        },
        "emissiveMask": {
            "status": "pending",
            "description": "Orange/emissive mask extraction is planned but not fabricated in v0.",
        },
        "height": {
            "status": "deferred",
            "description": "Parallax/height is deferred until planar/inset regions are identified.",
        },
    }


def load_trimesh_scene(path: Path):
    try:
        import trimesh  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"missing optional dependency trimesh: {exc}") from exc
    loaded = trimesh.load(path, force="scene", process=False)
    if hasattr(loaded, "to_geometry"):
        geometry = loaded.to_geometry()
        if geometry is not None:
            return geometry
    if hasattr(loaded, "dump"):
        dumped = loaded.dump(concatenate=True)
        if dumped is not None:
            return dumped
    if getattr(loaded, "geometry", None):
        geometries = list(loaded.geometry.values())
        if len(geometries) == 1:
            return geometries[0]
        return trimesh.util.concatenate(geometries)
    if getattr(loaded, "faces", None) is not None:
        return loaded
    raise RuntimeError("trimesh could not load a mesh from the GLB")


def write_reduced_lods(input_path: Path, out_dir: Path, targets: list[int], source_triangles: int) -> tuple[list[dict[str, Any]], list[str]]:
    lods: list[dict[str, Any]] = [{
        "level": 0,
        "status": "source",
        "path": str(input_path),
        "targetFaces": source_triangles,
        "actualFaces": source_triangles,
        "source": "input-glb",
    }]
    dependency_warnings: list[str] = []
    try:
        mesh = load_trimesh_scene(input_path)
    except Exception as exc:
        dependency_warnings.append(str(exc))
        for level, target in enumerate(targets, start=1):
            lods.append({
                "level": level,
                "status": "pending",
                "targetFaces": target,
                "reason": "simplification-dependency-unavailable",
                "error": str(exc),
            })
        return lods, dependency_warnings

    for level, target in enumerate(targets, start=1):
        lod_dir = out_dir / f"lod{level:02d}-{target}faces"
        lod_dir.mkdir(parents=True, exist_ok=True)
        output_path = lod_dir / "asset.glb"
        started = time.time()
        try:
            if len(mesh.faces) <= target:
                shutil.copy2(input_path, output_path)
                actual_faces = int(len(mesh.faces))
                status = "copied-source-under-target"
                material_policy = "source-copy"
            else:
                reduced = mesh.simplify_quadric_decimation(face_count=target)
                reduced.export(output_path)
                actual_faces = int(len(reduced.faces))
                status = "emitted"
                if actual_faces > max(target + 1, int(target * 1.1)):
                    status = "emitted-above-target"
                material_policy = "trimesh-export; inspect assay before assuming texture preservation"
            post_assay_path = lod_dir / "generated-asset-assay.json"
            try:
                post_assay = assay_glb(output_path)
                post_assay_path.write_text(json.dumps(post_assay, indent=2) + "\n")
                post_export = {
                    "assayPath": str(post_assay_path),
                    "triangleCount": post_assay["mesh"]["triangleCount"],
                    "hasBaseColorTexture": post_assay["materials"]["hasBaseColorTexture"],
                    "hasMetallicRoughnessTexture": post_assay["materials"]["hasMetallicRoughnessTexture"],
                    "hasNormalTexture": post_assay["materials"]["hasNormalTexture"],
                    "truthWarnings": post_assay["truthWarnings"],
                }
            except Exception as exc:
                post_export = {
                    "assayPath": None,
                    "error": str(exc),
                }
            lods.append({
                "level": level,
                "status": status,
                "path": str(output_path),
                "targetFaces": target,
                "actualFaces": actual_faces,
                "durationMs": int((time.time() - started) * 1000),
                "materialPolicy": material_policy,
                "postExportAssay": post_export,
            })
        except Exception as exc:
            lods.append({
                "level": level,
                "status": "failed",
                "targetFaces": target,
                "durationMs": int((time.time() - started) * 1000),
                "error": str(exc),
            })
    return lods, dependency_warnings


def parse_lod_faces(value: str) -> list[int]:
    faces = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        parsed = int(item)
        if parsed <= 0:
            raise argparse.ArgumentTypeError("LOD face targets must be positive")
        faces.append(parsed)
    return faces


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Source GLB")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    parser.add_argument("--name", default=None, help="Stable asset name")
    parser.add_argument("--lod-faces", default="60000,15000,5000", help="Comma-separated target face counts")
    parser.add_argument("--assay-only", action="store_true", help="Only write assay/manifest; mark LODs pending")
    args = parser.parse_args(argv)

    input_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    targets = parse_lod_faces(args.lod_faces)

    assay = assay_glb(input_path)
    assay_path = out_dir / "generated-asset-assay.json"
    assay_path.write_text(json.dumps(assay, indent=2) + "\n")

    source_triangles = int(assay["mesh"]["triangleCount"])
    if args.assay_only:
        lods = [{
            "level": 0,
            "status": "source",
            "path": str(input_path),
            "targetFaces": source_triangles,
            "actualFaces": source_triangles,
            "source": "input-glb",
        }]
        lods.extend({
            "level": level,
            "status": "pending",
            "targetFaces": target,
            "reason": "assay-only",
        } for level, target in enumerate(targets, start=1))
        dependency_warnings: list[str] = []
    else:
        lods, dependency_warnings = write_reduced_lods(input_path, out_dir, targets, source_triangles)

    manifest = {
        "schema": "kaminos.generated-asset-lod.v0",
        "createdAt": utc_now(),
        "assetName": args.name or input_path.stem,
        "source": {
            "path": str(input_path),
            "sha256": assay["source"]["sha256"],
            "bytes": assay["source"]["bytes"],
        },
        "assay": {
            "path": str(assay_path),
            "truthWarnings": assay["truthWarnings"],
        },
        "requestedLodFaces": targets,
        "lods": lods,
        "bakeProducts": bake_product_manifest(),
        "dependencyWarnings": dependency_warnings,
        "notes": [
            "LOD GLBs, when emitted, are geometry reduction products only.",
            "Do not assume tangent normal, AO, emissive, height, or parallax maps unless bakeProducts marks them emitted.",
        ],
    }
    manifest_path = out_dir / "generated-asset-lod-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({
        "manifest": str(manifest_path),
        "assay": str(assay_path),
        "lodStatuses": [lod["status"] for lod in lods],
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"generated-asset-lod failed: {exc}", file=sys.stderr)
        raise
