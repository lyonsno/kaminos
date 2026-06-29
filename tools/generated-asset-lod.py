#!/usr/bin/env python3
"""Assay generated GLBs and emit honest material-preserving reduction manifests.

This tool is intentionally narrow. It can preserve existing glTF PBR texture
graphs through glTF Transform simplification/texture resize, and it refuses to
claim high-to-low normal/AO/emissive/height bakes until those products exist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import subprocess
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
    if tex_index is None or tex_index < 0 or tex_index >= len(textures):
        return None
    source = textures[tex_index].get("source")
    if source is None or source < 0 or source >= len(images):
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
        "schema": "kaminos.generated-asset-assay.v1",
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
            "description": "No AO/occlusion map is emitted until high-to-low or object-space bake exists.",
        },
        "curvature": {
            "status": "pending",
            "description": "Curvature/cavity masks are planned for generated-asset material triage.",
        },
        "emissiveMask": {
            "status": "pending",
            "description": "Orange/emissive mask extraction is planned but not fabricated in this route.",
        },
        "height": {
            "status": "deferred",
            "description": "Parallax/height is deferred until planar/inset regions are identified.",
        },
    }


def run_command(command: list[str]) -> dict[str, Any]:
    started = time.time()
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return {
        "argv": command,
        "returncode": result.returncode,
        "durationMs": int((time.time() - started) * 1000),
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }


def write_post_assay(path: Path, lod_dir: Path) -> dict[str, Any]:
    post_assay_path = lod_dir / "generated-asset-assay.json"
    try:
        post_assay = assay_glb(path)
        post_assay_path.write_text(json.dumps(post_assay, indent=2) + "\n")
        return {
            "assayPath": str(post_assay_path),
            "triangleCount": post_assay["mesh"]["triangleCount"],
            "vertexCount": post_assay["mesh"]["vertexCount"],
            "hasVertexNormals": post_assay["geometry"]["hasVertexNormals"],
            "hasUv0": post_assay["geometry"]["hasUv0"],
            "hasBaseColorTexture": post_assay["materials"]["hasBaseColorTexture"],
            "hasMetallicRoughnessTexture": post_assay["materials"]["hasMetallicRoughnessTexture"],
            "hasNormalTexture": post_assay["materials"]["hasNormalTexture"],
            "truthWarnings": post_assay["truthWarnings"],
        }
    except Exception as exc:
        return {"assayPath": None, "error": str(exc)}


def gltf_transform_reduce(
    input_path: Path,
    output_path: Path,
    target: int,
    source_triangles: int,
    texture_size: int,
    simplify_error: float,
    lock_border: bool,
) -> tuple[str, int | None, list[dict[str, Any]]]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    commands = []
    temp_path = output_path.with_name("asset.simplified.glb") if texture_size > 0 else output_path

    if source_triangles <= target:
        shutil.copy2(input_path, temp_path)
        status = "copied-source-under-target"
    else:
        ratio = max(0.001, min(1.0, target / source_triangles))
        command = [
            "npx",
            "--yes",
            "@gltf-transform/cli",
            "simplify",
            str(input_path),
            str(temp_path),
            "--ratio",
            f"{ratio:.8f}",
            "--error",
            str(simplify_error),
            "--lock-border",
            "true" if lock_border else "false",
        ]
        command_result = run_command(command)
        commands.append(command_result)
        if command_result["returncode"] != 0:
            return "failed", None, commands
        status = "emitted"

    if texture_size > 0:
        command = [
            "npx",
            "--yes",
            "@gltf-transform/cli",
            "resize",
            str(temp_path),
            str(output_path),
            "--width",
            str(texture_size),
            "--height",
            str(texture_size),
        ]
        command_result = run_command(command)
        commands.append(command_result)
        if command_result["returncode"] != 0:
            return "failed", None, commands
        if temp_path != output_path and temp_path.exists():
            temp_path.unlink()

    try:
        actual_faces = assay_glb(output_path)["mesh"]["triangleCount"]
    except Exception:
        actual_faces = None
    if actual_faces is not None and actual_faces > max(target + 1, int(target * 1.1)):
        status = "emitted-above-target"
    return status, actual_faces, commands


def write_reduced_lods(
    input_path: Path,
    out_dir: Path,
    targets: list[int],
    source_triangles: int,
    texture_size: int,
    simplify_error: float,
    lock_border: bool,
) -> list[dict[str, Any]]:
    lods: list[dict[str, Any]] = [{
        "level": 0,
        "status": "source",
        "path": str(input_path),
        "targetFaces": source_triangles,
        "actualFaces": source_triangles,
        "source": "input-glb",
    }]

    for level, target in enumerate(targets, start=1):
        lod_dir = out_dir / f"lod{level:02d}-{target}faces"
        output_path = lod_dir / "asset.glb"
        started = time.time()
        status, actual_faces, commands = gltf_transform_reduce(
            input_path,
            output_path,
            target,
            source_triangles,
            texture_size,
            simplify_error,
            lock_border,
        )
        post_export = write_post_assay(output_path, lod_dir) if output_path.exists() else None
        lod_record = {
            "level": level,
            "status": status,
            "backend": "gltf-transform",
            "path": str(output_path) if output_path.exists() else None,
            "targetFaces": target,
            "actualFaces": actual_faces,
            "durationMs": int((time.time() - started) * 1000),
            "materialPolicy": "preserve-source-pbr-textures",
            "textureResize": {"maxSize": texture_size, "status": "enabled" if texture_size > 0 else "disabled"},
            "commands": commands,
            "postExportAssay": post_export,
        }
        if status == "failed":
            lod_record["error"] = "gltf-transform command failed"
        lods.append(lod_record)
    return lods


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
    parser.add_argument("--lod-faces", default="100000,40000,15000", help="Comma-separated target face counts")
    parser.add_argument("--assay-only", action="store_true", help="Only write assay/manifest; mark LODs pending")
    parser.add_argument("--texture-size", type=int, default=2048, help="Resize source textures to this max square size; 0 disables")
    parser.add_argument("--simplify-error", type=float, default=1.0, help="glTF Transform simplification error budget")
    parser.add_argument("--lock-border", action="store_true", help="Lock mesh borders during simplification")
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
    else:
        lods = write_reduced_lods(
            input_path,
            out_dir,
            targets,
            source_triangles,
            max(0, args.texture_size),
            args.simplify_error,
            args.lock_border,
        )

    manifest = {
        "schema": "kaminos.generated-asset-lod.v1",
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
        "reduction": {
            "defaultBackend": "gltf-transform",
            "materialPolicy": "preserve-source-pbr-textures",
            "textureResize": {
                "status": "disabled" if args.assay_only or args.texture_size <= 0 else "enabled",
                "maxSize": max(0, args.texture_size),
            },
            "simplifyError": args.simplify_error,
            "lockBorder": bool(args.lock_border),
        },
        "lods": lods,
        "bakeProducts": bake_product_manifest(),
        "notes": [
            "LOD GLBs preserve source glTF material texture references when glTF Transform can preserve them.",
            "This route does not bake tangent-space normals, AO, emissive masks, height, or parallax.",
            "Use postExportAssay to distinguish requested face targets from actual emitted topology.",
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
