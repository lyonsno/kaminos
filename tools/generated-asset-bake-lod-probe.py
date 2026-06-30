#!/usr/bin/env python3
"""Probe whether generated-asset baking can support lower-topology targets.

The probe is a coordinator: it assays target GLBs, skips targets that violate
the current existing-UV0 contract, runs generated-asset-bake.py for bakeable
targets when requested, and writes one comparison manifest with direct Kaminos
inspection links.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote


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


def texture_name(doc: dict[str, Any], texture_info: dict[str, Any] | None) -> str | None:
    if not texture_info:
        return None
    textures = doc.get("textures") or []
    images = doc.get("images") or []
    texture_index = texture_info.get("index")
    if texture_index is None or texture_index < 0 or texture_index >= len(textures):
        return None
    source = textures[texture_index].get("source")
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
    has_tangents = False

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
            has_tangents = has_tangents or "TANGENT" in attrs

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
        })

    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "assetGenerator": (doc.get("asset") or {}).get("generator"),
        "mesh": {
            "primitiveCount": primitive_count,
            "vertexCount": vertex_count,
            "triangleCount": triangle_count,
        },
        "geometry": {
            "hasUv0": has_uv0,
            "hasVertexNormals": has_normals,
            "hasTangents": has_tangents,
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


def slugify(label: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", label.strip()).strip("-")
    return slug or "target"


def parse_target(value: str) -> tuple[str, Path]:
    if "=" not in value:
        path = Path(value).expanduser().resolve()
        return path.stem, path
    label, path = value.split("=", 1)
    return label.strip(), Path(path).expanduser().resolve()


def kaminos_url(base_url: str, glb_path: Path, label: str) -> str:
    base = base_url.rstrip("/")
    return f"{base}/?glb_path={quote(str(glb_path), safe='')}&glb_label={quote(label, safe='')}"


def run_bake(
    source: Path,
    target: Path,
    out_dir: Path,
    name: str,
    texture_size: int,
    projection_route: str,
    source_triangle_candidates: int,
    normal_min_dot: float,
    padding_pixels: int,
) -> dict[str, Any]:
    command = [
        sys.executable,
        str(Path(__file__).with_name("generated-asset-bake.py")),
        "--source", str(source),
        "--target", str(target),
        "--out-dir", str(out_dir),
        "--name", name,
        "--texture-size", str(texture_size),
        "--projection-route", projection_route,
        "--source-triangle-candidates", str(source_triangle_candidates),
        "--normal-min-dot", str(normal_min_dot),
        "--padding-pixels", str(padding_pixels),
    ]
    started = time.time()
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return {
        "argv": command,
        "returncode": result.returncode,
        "durationMs": int((time.time() - started) * 1000),
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }


def load_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def target_record(
    label: str,
    target_path: Path,
    source_path: Path,
    out_dir: Path,
    asset_name: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    target_dir = out_dir / slugify(label)
    assay = assay_glb(target_path)
    record: dict[str, Any] = {
        "label": label,
        "path": str(target_path),
        "status": "pending",
        "assay": assay,
        "bake": {
            "outputDirectory": str(target_dir),
        },
        "kaminosUrl": None,
    }

    if not assay["geometry"]["hasUv0"]:
        record["status"] = "skipped"
        record["reason"] = "target-missing-uv0"
        return record

    if args.require_normals and not assay["geometry"]["hasVertexNormals"]:
        record["status"] = "skipped"
        record["reason"] = "target-missing-normals"
        return record

    if args.assay_only:
        record["status"] = "pending"
        record["reason"] = "assay-only"
        return record

    target_dir.mkdir(parents=True, exist_ok=True)
    bake_result = run_bake(
        source_path,
        target_path,
        target_dir,
        f"{asset_name}-{slugify(label)}",
        args.texture_size,
        args.projection_route,
        args.source_triangle_candidates,
        args.normal_min_dot,
        args.padding_pixels,
    )
    record["bake"]["command"] = bake_result
    bake_manifest_path = target_dir / "generated-asset-bake-manifest.json"
    bake_manifest = load_json_if_exists(bake_manifest_path)
    record["bake"]["manifestPath"] = str(bake_manifest_path) if bake_manifest_path.exists() else None
    record["bake"]["manifest"] = bake_manifest

    if bake_result["returncode"] != 0 or not bake_manifest or bake_manifest.get("status") != "emitted":
        record["status"] = "failed"
        record["reason"] = "bake-failed"
        return record

    baked_glb = Path(bake_manifest["products"]["glb"]["path"])
    record["status"] = "emitted"
    record["bake"]["bakedGlb"] = str(baked_glb)
    record["bake"]["bytes"] = baked_glb.stat().st_size if baked_glb.exists() else None
    record["kaminosUrl"] = kaminos_url(args.kaminos_base_url, baked_glb, f"{asset_name}-{label}")
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="High/detail source GLB")
    parser.add_argument("--target", action="append", required=True, help="Target GLB as label=/path/to.glb; repeatable")
    parser.add_argument("--out-dir", required=True, help="Probe output directory")
    parser.add_argument("--name", default=None, help="Stable asset/probe name")
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument(
        "--projection-route",
        choices=["nearest-source-surface-normal-aware", "nearest-source-surface", "nearest-source-vertex"],
        default="nearest-source-surface-normal-aware",
    )
    parser.add_argument("--source-triangle-candidates", type=int, default=12)
    parser.add_argument("--normal-min-dot", type=float, default=0.25)
    parser.add_argument("--padding-pixels", type=int, default=12)
    parser.add_argument("--kaminos-base-url", default="http://localhost:18138")
    parser.add_argument("--require-normals", action="store_true", help="Skip targets without NORMAL")
    parser.add_argument("--assay-only", action="store_true")
    args = parser.parse_args(argv)

    source_path = Path(args.source).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    asset_name = args.name or source_path.stem
    source_assay = assay_glb(source_path)

    records = []
    for target_arg in args.target:
        label, target_path = parse_target(target_arg)
        records.append(target_record(label, target_path, source_path, out_dir, asset_name, args))

    emitted = [record for record in records if record["status"] == "emitted"]
    skipped = [record for record in records if record["status"] == "skipped"]
    failed = [record for record in records if record["status"] == "failed"]

    manifest = {
        "schema": "kaminos.generated-asset-bake-lod-probe.v0",
        "createdAt": utc_now(),
        "assetName": asset_name,
        "source": source_assay,
        "uvPolicy": "required-existing-uv0",
        "bakeDefaults": {
            "textureSize": args.texture_size,
            "projectionRoute": args.projection_route,
            "sourceTriangleCandidates": args.source_triangle_candidates,
            "normalMinDot": args.normal_min_dot,
            "paddingPixels": args.padding_pixels,
            "requireNormals": bool(args.require_normals),
            "assayOnly": bool(args.assay_only),
        },
        "summary": {
            "targetCount": len(records),
            "emittedCount": len(emitted),
            "skippedCount": len(skipped),
            "failedCount": len(failed),
            "minActualTriangles": min((record["assay"]["mesh"]["triangleCount"] for record in records), default=None),
            "distinctActualTriangles": sorted({record["assay"]["mesh"]["triangleCount"] for record in records}),
        },
        "targets": records,
    }
    manifest_path = out_dir / "generated-asset-bake-lod-probe-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({
        "manifest": str(manifest_path),
        "emitted": len(emitted),
        "skipped": len(skipped),
        "failed": len(failed),
    }, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
