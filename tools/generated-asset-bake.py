#!/usr/bin/env python3
"""Bake generated source GLB material values onto a target GLB's existing UV0.

V0 is intentionally narrow and honest:

- source and target must already have UV0
- no unwrap/xatlas path exists here
- projection is nearest-source-vertex
- only baseColor and metallicRoughness are emitted
- normals, AO, emissive extraction, height, and parallax remain unimplemented
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import time
from pathlib import Path
from typing import Any


JSON_CHUNK = 0x4E4F534A
TRIANGLES = 4
BAKE_SCHEMA = "kaminos.generated-asset-bake.v0"


class BakeFailure(Exception):
    def __init__(self, phase: str, code: str, message: str):
        super().__init__(message)
        self.phase = phase
        self.code = code
        self.message = message


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
            "route": "nearest-source-vertex",
            "status": "pending",
            "description": "Target UV pixels reconstruct target surface positions, then sample nearest source vertex material UV.",
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


def bake(source_path: Path, target_path: Path, out_dir: Path, texture_size: int) -> dict[str, Any]:
    import numpy as np
    from PIL import Image
    from scipy.spatial import cKDTree
    from trimesh.visual.material import PBRMaterial
    from trimesh.visual.texture import TextureVisuals

    source_mesh = load_single_mesh(source_path, "source")
    target_mesh = load_single_mesh(target_path, "target")

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
    target_vertices = np.asarray(target_mesh.vertices, dtype=np.float32)
    target_uv = np.asarray(target_mesh.visual.uv, dtype=np.float32)
    target_faces = np.asarray(target_mesh.faces, dtype=np.int64)

    base_img = image_array(source_base, "RGBA")
    mr_img = image_array(source_mr, "RGB")
    tree = cKDTree(source_vertices)

    out_base = np.zeros((size, size, 4), dtype=np.float32)
    out_mr = np.zeros((size, size, 3), dtype=np.float32)
    distance = np.full((size, size), np.nan, dtype=np.float32)
    covered = np.zeros((size, size), dtype=bool)

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
        dists, source_indices = tree.query(positions, k=1)
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

    out_base[unresolved] = np.array([0, 0, 0, 0], dtype=np.float32)
    out_mr[unresolved] = np.array([0, 255, 255], dtype=np.float32)

    base_path = textures_dir / "baseColor.png"
    mr_path = textures_dir / "metallicRoughness.png"
    distance_path = debug_dir / "projectionDistance.png"
    route_path = debug_dir / "projectionRoute.png"
    unresolved_path = debug_dir / "unresolvedMask.png"

    Image.fromarray(np.clip(out_base, 0, 255).astype(np.uint8), mode="RGBA").save(base_path)
    Image.fromarray(np.clip(out_mr, 0, 255).astype(np.uint8), mode="RGB").save(mr_path)
    Image.fromarray(distance_vis, mode="L").save(distance_path)
    Image.fromarray((covered.astype(np.uint8) * 255), mode="L").save(route_path)
    Image.fromarray((unresolved.astype(np.uint8) * 255), mode="L").save(unresolved_path)

    baked_glb = out_dir / "asset-baked.glb"
    baked_mesh = target_mesh.copy()
    baked_base_img = Image.open(base_path)
    baked_mr_img = Image.open(mr_path)
    baked_mesh.visual = TextureVisuals(
        uv=target_uv,
        material=PBRMaterial(
            name="kaminos-baked-pbr-v0",
            baseColorTexture=baked_base_img,
            metallicRoughnessTexture=baked_mr_img,
            metallicFactor=1.0,
            roughnessFactor=1.0,
        ),
    )
    baked_mesh.export(baked_glb)

    total_pixels = size * size
    covered_pixels = int(np.count_nonzero(covered))
    return {
        "textureSize": size,
        "coveredPixels": covered_pixels,
        "totalPixels": total_pixels,
        "atlasCoverageRatio": float(covered_pixels / total_pixels),
        "atlasUncoveredRatio": float((total_pixels - covered_pixels) / total_pixels),
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
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="High/detail source GLB with existing UV0 and PBR textures")
    parser.add_argument("--target", required=True, help="Target GLB whose existing UV0 receives baked textures")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    parser.add_argument("--name", default=None, help="Stable asset name")
    parser.add_argument("--texture-size", type=int, default=1024, help="Square bake texture size")
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
        manifest = manifest_base(source_path, target_path, out_dir, asset_name, source_assay, target_assay)
        preflight(manifest)
        if args.assay_only:
            manifest["status"] = "assay-only"
        else:
            started = time.time()
            stats = bake(source_path, target_path, out_dir, args.texture_size)
            manifest["status"] = "emitted"
            manifest["projection"]["status"] = "emitted"
            manifest["projection"]["durationMs"] = int((time.time() - started) * 1000)
            manifest["projection"]["textureSize"] = stats["textureSize"]
            manifest["projection"]["coveredPixels"] = stats["coveredPixels"]
            manifest["projection"]["totalPixels"] = stats["totalPixels"]
            manifest["projection"]["atlasCoverageRatio"] = stats["atlasCoverageRatio"]
            manifest["projection"]["atlasUncoveredRatio"] = stats["atlasUncoveredRatio"]
            manifest["projection"]["distance"] = stats["distance"]
            manifest["products"]["baseColor"].update({"status": "emitted", "path": stats["paths"]["baseColor"]})
            manifest["products"]["metallicRoughness"].update({"status": "emitted", "path": stats["paths"]["metallicRoughness"]})
            manifest["products"]["glb"] = {"status": "emitted", "path": stats["paths"]["bakedGlb"]}
            manifest["diagnostics"]["distance"].update({"status": "emitted", "path": stats["paths"]["projectionDistance"]})
            manifest["diagnostics"]["route"].update({"status": "emitted", "path": stats["paths"]["projectionRoute"]})
            manifest["diagnostics"]["unresolvedMask"].update({"status": "emitted", "path": stats["paths"]["unresolvedMask"]})
        manifest_path = write_manifest(out_dir, manifest)
        print(json.dumps({"manifest": str(manifest_path), "status": manifest["status"]}, indent=2))
        return 0
    except BakeFailure as exc:
        manifest = manifest_base(source_path, target_path, out_dir, asset_name, source_assay, target_assay)
        manifest["status"] = "failed"
        manifest["failure"] = {"phase": exc.phase, "code": exc.code, "message": exc.message}
        manifest_path = write_manifest(out_dir, manifest)
        print(json.dumps({"manifest": str(manifest_path), "status": "failed", "failure": manifest["failure"]}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        manifest = manifest_base(source_path, target_path, out_dir, asset_name, source_assay, target_assay)
        manifest["status"] = "failed"
        manifest["failure"] = {"phase": "unexpected", "code": exc.__class__.__name__, "message": str(exc)}
        manifest_path = write_manifest(out_dir, manifest)
        print(json.dumps({"manifest": str(manifest_path), "status": "failed", "failure": manifest["failure"]}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
