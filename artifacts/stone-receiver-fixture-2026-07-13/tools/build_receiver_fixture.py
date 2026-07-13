#!/usr/bin/env python3
import base64
import hashlib
import json
import math
import struct
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VISUAL_GLB = ROOT / "visual" / "matte-stone-corner-receiver.glb"
PROXY_GLB = ROOT / "proxy" / "matte-stone-corner-receiver-proxy.glb"
DESCRIPTOR = ROOT / "receiver-descriptor.json"
MANIFEST = ROOT / "manifest.json"
RECEIPT = ROOT / "receipt.json"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def pad4(data, pad=b" "):
    return data + pad * ((4 - len(data) % 4) % 4)


def cuboid(name, bounds, material_index):
    xmin, ymin, zmin = bounds["min"]
    xmax, ymax, zmax = bounds["max"]
    vertices = [
        # +Z
        (xmin, ymin, zmax), (xmax, ymin, zmax), (xmax, ymax, zmax), (xmin, ymax, zmax),
        # -Z
        (xmax, ymin, zmin), (xmin, ymin, zmin), (xmin, ymax, zmin), (xmax, ymax, zmin),
        # +X
        (xmax, ymin, zmax), (xmax, ymin, zmin), (xmax, ymax, zmin), (xmax, ymax, zmax),
        # -X
        (xmin, ymin, zmin), (xmin, ymin, zmax), (xmin, ymax, zmax), (xmin, ymax, zmin),
        # +Y
        (xmin, ymax, zmax), (xmax, ymax, zmax), (xmax, ymax, zmin), (xmin, ymax, zmin),
        # -Y
        (xmin, ymin, zmin), (xmax, ymin, zmin), (xmax, ymin, zmax), (xmin, ymin, zmax),
    ]
    normals = (
        [(0, 0, 1)] * 4
        + [(0, 0, -1)] * 4
        + [(1, 0, 0)] * 4
        + [(-1, 0, 0)] * 4
        + [(0, 1, 0)] * 4
        + [(0, -1, 0)] * 4
    )
    indices = []
    for base in range(0, 24, 4):
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return {
        "name": name,
        "positions": vertices,
        "normals": normals,
        "indices": indices,
        "material": material_index,
        "bounds": bounds,
        "triangles": len(indices) // 3,
    }


def plane(name, corners, normal, material_index):
    return {
        "name": name,
        "positions": corners,
        "normals": [normal] * 4,
        "indices": [0, 1, 2, 0, 2, 3],
        "material": material_index,
        "bounds": {
            "min": [min(p[i] for p in corners) for i in range(3)],
            "max": [max(p[i] for p in corners) for i in range(3)],
        },
        "triangles": 2,
    }


def material(name, color, roughness=0.94, double_sided=False, emissive=None):
    item = {
        "name": name,
        "pbrMetallicRoughness": {
            "baseColorFactor": color,
            "metallicFactor": 0,
            "roughnessFactor": roughness,
        },
        "doubleSided": double_sided,
    }
    if emissive:
        item["emissiveFactor"] = emissive
    return item


def build_glb(path, nodes, materials, extras=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    binary = bytearray()
    buffer_views = []
    accessors = []
    meshes = []
    gltf_nodes = []

    def add_blob(blob, target=None):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(blob)
        index = len(buffer_views)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob)}
        if target:
            view["target"] = target
        buffer_views.append(view)
        return index

    for node in nodes:
        pos = node["positions"]
        nor = node["normals"]
        idx = node["indices"]

        pos_blob = b"".join(struct.pack("<3f", *p) for p in pos)
        nor_blob = b"".join(struct.pack("<3f", *n) for n in nor)
        idx_blob = b"".join(struct.pack("<H", i) for i in idx)

        pos_view = add_blob(pos_blob, 34962)
        nor_view = add_blob(nor_blob, 34962)
        idx_view = add_blob(idx_blob, 34963)

        pos_accessor = len(accessors)
        accessors.append({
            "bufferView": pos_view,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(pos),
            "type": "VEC3",
            "min": [min(p[i] for p in pos) for i in range(3)],
            "max": [max(p[i] for p in pos) for i in range(3)],
        })
        nor_accessor = len(accessors)
        accessors.append({
            "bufferView": nor_view,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(nor),
            "type": "VEC3",
        })
        idx_accessor = len(accessors)
        accessors.append({
            "bufferView": idx_view,
            "byteOffset": 0,
            "componentType": 5123,
            "count": len(idx),
            "type": "SCALAR",
            "min": [min(idx)],
            "max": [max(idx)],
        })

        mesh_index = len(meshes)
        meshes.append({
            "name": node["name"],
            "primitives": [{
                "attributes": {"POSITION": pos_accessor, "NORMAL": nor_accessor},
                "indices": idx_accessor,
                "material": node["material"],
                "mode": 4,
            }],
        })
        gltf_nodes.append({
            "name": node["name"],
            "mesh": mesh_index,
            "extras": {
                "boundsLocal": node["bounds"],
                "triangles": node["triangles"],
            },
        })

    gltf = {
        "asset": {"version": "2.0", "generator": "Handy Candyman receiver fixture builder"},
        "scene": 0,
        "scenes": [{"name": "matte-stone-corner-receiver-scene", "nodes": list(range(len(gltf_nodes)))}],
        "nodes": gltf_nodes,
        "meshes": meshes,
        "materials": materials,
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "extras": extras or {},
    }

    json_chunk = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    bin_chunk = pad4(bytes(binary), b"\x00")
    total_length = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    glb = bytearray()
    glb.extend(b"glTF")
    glb.extend(struct.pack("<II", 2, total_length))
    glb.extend(struct.pack("<I4s", len(json_chunk), b"JSON"))
    glb.extend(json_chunk)
    glb.extend(struct.pack("<I4s", len(bin_chunk), b"BIN\x00"))
    glb.extend(bin_chunk)
    path.write_bytes(glb)


def descriptor_node(node_id, role, mask_source, bounds, direct_mask_safety, receiver=True, proxy_id=None):
    item = {
        "nodeId": node_id,
        "role": role,
        "receiver": receiver,
        "maskSource": mask_source,
        "localToAsset": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        "boundsLocal": bounds,
        "groundContact": "floor_contact" if role == "floor" else "wall_mounted",
        "directMaskSafety": direct_mask_safety,
        "materialResponse": {
            "albedoHint": [0.50, 0.47, 0.42],
            "roughnessClass": "matte_stone",
            "emissiveExclusion": True,
        },
        "viewBoundary": {
            "geometryCompleteness": "complete_enough_for_receiver_mask",
            "validViewCone": "free_orbit",
            "knownMissingSides": [],
        },
    }
    if proxy_id:
        item["proxyId"] = proxy_id
    return item


def main():
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    mats = [
        material("matte warm limestone", [0.53, 0.50, 0.45, 1]),
        material("matte cool seam stone", [0.38, 0.38, 0.36, 1]),
        material("dark non receiver rubble", [0.23, 0.22, 0.20, 1]),
    ]
    proxy_mats = [
        material("two sided receiver proxy witness warm mask", [1.0, 0.86, 0.46, 1], double_sided=True, emissive=[1.0, 0.72, 0.28]),
    ]

    floor_bounds = {"min": [-1.8, -0.08, -1.15], "max": [1.8, 0.0, 1.55]}
    back_wall_bounds = {"min": [-1.8, 0.0, 1.47], "max": [1.8, 1.85, 1.57]}
    side_wall_bounds = {"min": [-1.8, 0.0, -1.15], "max": [-1.70, 1.45, 1.55]}
    visual_nodes = [
        cuboid("receiver_floor", floor_bounds, 0),
        cuboid("receiver_back_wall", back_wall_bounds, 0),
        cuboid("receiver_side_wall", side_wall_bounds, 0),
        cuboid("stone_seam_floor_left", {"min": [-1.75, 0.002, -0.95], "max": [-0.05, 0.018, -0.91]}, 1),
        cuboid("stone_seam_floor_right", {"min": [0.15, 0.002, 0.28], "max": [1.65, 0.018, 0.33]}, 1),
        cuboid("stone_seam_back_mid", {"min": [-0.18, 0.36, 1.568], "max": [-0.12, 1.55, 1.585]}, 1),
        cuboid("non_receiver_rubble_block_a", {"min": [1.02, 0.0, -0.72], "max": [1.33, 0.22, -0.42]}, 2),
        cuboid("non_receiver_rubble_block_b", {"min": [1.36, 0.0, -0.58], "max": [1.60, 0.16, -0.34]}, 2),
    ]
    proxy_nodes = [
        plane("proxy_receiver_floor", [(-1.8, 0.01, -1.15), (1.8, 0.01, -1.15), (1.8, 0.01, 1.55), (-1.8, 0.01, 1.55)], (0, 1, 0), 0),
        plane("proxy_receiver_back_wall", [(-1.8, 0, 1.46), (1.8, 0, 1.46), (1.8, 1.85, 1.46), (-1.8, 1.85, 1.46)], (0, 0, -1), 0),
        plane("proxy_receiver_side_wall", [(-1.69, 0, -1.15), (-1.69, 0, 1.55), (-1.69, 1.45, 1.55), (-1.69, 1.45, -1.15)], (1, 0, 0), 0),
    ]

    common_extras = {
        "schema": "kaminos.receiver-fixture.glb.v0",
        "createdAt": created_at,
        "worldUp": [0, 1, 0],
        "truthBoundary": "Procedural matte stone receiver fixture. Geometry is intentionally simple and boring for receiver-buffer anchoring; not a photoreal set dressing asset.",
    }
    build_glb(VISUAL_GLB, visual_nodes, mats, {**common_extras, "kind": "visual"})
    build_glb(PROXY_GLB, proxy_nodes, proxy_mats, {**common_extras, "kind": "receiver_proxy", "proxyMaterial": "two_sided_emissive_for_viewer_witness"})

    descriptor = {
        "schema": "kaminos.receiver-descriptor.v0",
        "assetId": "matte-stone-corner-receiver-2026-07-13",
        "assetSource": "artifacts/stone-receiver-fixture-2026-07-13/visual/matte-stone-corner-receiver.glb",
        "worldUp": [0, 1, 0],
        "defaultReceiverPolicy": "non_receiver",
        "nodes": [
            descriptor_node("receiver_floor", "floor", "proxy", floor_bounds, "safe", True, "stone-corner-low-poly-proxy"),
            descriptor_node("receiver_back_wall", "kiln_wall", "proxy", back_wall_bounds, "safe", True, "stone-corner-low-poly-proxy"),
            descriptor_node("receiver_side_wall", "kiln_wall", "proxy", side_wall_bounds, "safe", True, "stone-corner-low-poly-proxy"),
            {
                "nodeId": "non_receiver_rubble_block_a",
                "role": "prop",
                "receiver": False,
                "maskSource": "disabled",
                "directMaskSafety": "disabled_non_receiver",
                "boundsLocal": {"min": [1.02, 0.0, -0.72], "max": [1.33, 0.22, -0.42]},
                "viewBoundary": {
                    "geometryCompleteness": "decorative_rejection_witness_only",
                    "validViewCone": "free_orbit",
                    "knownMissingSides": [],
                },
            },
            {
                "nodeId": "non_receiver_rubble_block_b",
                "role": "prop",
                "receiver": False,
                "maskSource": "disabled",
                "directMaskSafety": "disabled_non_receiver",
                "boundsLocal": {"min": [1.36, 0.0, -0.58], "max": [1.60, 0.16, -0.34]},
                "viewBoundary": {
                    "geometryCompleteness": "decorative_rejection_witness_only",
                    "validViewCone": "free_orbit",
                    "knownMissingSides": [],
                },
            },
        ],
        "proxies": [
            {
                "proxyId": "stone-corner-low-poly-proxy",
                "source": "artifacts/stone-receiver-fixture-2026-07-13/proxy/matte-stone-corner-receiver-proxy.glb",
                "replacesNodeIds": ["receiver_floor", "receiver_back_wall", "receiver_side_wall"],
                "localToAsset": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                "boundsLocal": {"min": [-1.8, -0.08, -1.15], "max": [1.8, 1.85, 1.57]},
                "triangleCount": sum(node["triangles"] for node in proxy_nodes),
                "truthBoundary": "Low-poly receiver mask proxy only. It is the preferred mask source for Beaming's receiver buffer, while the visual GLB remains the operator-facing fixture.",
            }
        ],
        "materialResponse": {
            "defaultAlbedoHint": [0.50, 0.47, 0.42],
            "roughnessClass": "matte_stone",
            "emissiveExclusion": True,
        },
        "failureRules": [
            "Missing descriptor, proxy, bounds, or node transforms must fail loud instead of falling back to hardcoded planes.",
            "Only receiver=true nodes or their proxy should enter the receiver mask.",
            "non_receiver_rubble_block_* must remain mask-disabled in Beaming receiver-only witness.",
        ],
    }
    DESCRIPTOR.write_text(json.dumps(descriptor, indent=2) + "\n")

    receipt = {
        "schema": "kaminos.receiver-fixture-build-receipt.v0",
        "created_at": created_at,
        "builder": str(Path(__file__).relative_to(ROOT.parents[1])),
        "outputs": {
            "visual_glb": {
                "path": str(VISUAL_GLB.relative_to(ROOT.parents[1])),
                "sha256": sha256(VISUAL_GLB),
                "nodes": [node["name"] for node in visual_nodes],
                "triangles": sum(node["triangles"] for node in visual_nodes),
            },
            "proxy_glb": {
                "path": str(PROXY_GLB.relative_to(ROOT.parents[1])),
                "sha256": sha256(PROXY_GLB),
                "nodes": [node["name"] for node in proxy_nodes],
                "triangles": sum(node["triangles"] for node in proxy_nodes),
            },
            "receiver_descriptor": {
                "path": str(DESCRIPTOR.relative_to(ROOT.parents[1])),
                "sha256": sha256(DESCRIPTOR),
            },
        },
        "truth_boundary": "Procedural fixture for receiver-buffer anchoring. Not a photoreal stone asset; it is meant to give Beaming stable opted-in receiver surfaces, proxy identity, bounds, and material hints.",
    }
    RECEIPT.write_text(json.dumps(receipt, indent=2) + "\n")
    manifest = {
        "schema": "kaminos.stone-receiver-fixture-manifest.v0",
        "created_at": created_at,
        "purpose": "Positive receiver fixture for replacing hardcoded wall/floor receiver planes with asset-authored receiver geometry.",
        "helps_lane": "beaming-frustum-fluffer",
        "scoreboard_point": 2,
        "receipt": str(RECEIPT.relative_to(ROOT.parents[1])),
        "receiver_descriptor": str(DESCRIPTOR.relative_to(ROOT.parents[1])),
        "visual_glb": str(VISUAL_GLB.relative_to(ROOT.parents[1])),
        "proxy_glb": str(PROXY_GLB.relative_to(ROOT.parents[1])),
        "promotion_status": "needs Kaminos viewer witness and Beaming receiver-buffer consumption before promoted beyond fixture.",
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
