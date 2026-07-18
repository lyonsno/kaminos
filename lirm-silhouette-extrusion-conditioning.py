#!/usr/bin/env python3

import argparse
import binascii
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import numpy as np


SCHEMA = "kaminos.lirm-silhouette-extrusion-conditioning-witness.v0"
PACKET_SCHEMA = "kaminos.lirm-silhouette-extrusion-conditioning-packet.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-extrusion-conditioning-v0"
EFFECTIVE_ROUTE = "cpu-sdf-raymarch-rounded-extrusion-v0"
EXPECTED_SOURCE_ROUTE = "numpy-local-sdf-pca-topology-neighborhood-v0"
LATENT_SAMPLE_SOURCE_ROUTE = "mlx-sdf-vae-prior-sample-v0"
BASIN_LATENT_SOURCE_ROUTE = "mlx-sdf-vae-posterior-basin-perturbation-v0"


def read_pgm(path: Path) -> np.ndarray:
    with path.open("rb") as handle:
        if handle.readline().strip() != b"P5":
            raise ValueError(f"{path} is not a P5 PGM")
        dimensions = handle.readline().strip().split()
        while dimensions and dimensions[0].startswith(b"#"):
            dimensions = handle.readline().strip().split()
        width, height = map(int, dimensions)
        if int(handle.readline().strip()) != 255:
            raise ValueError(f"{path} does not use max value 255")
        pixels = np.frombuffer(handle.read(), dtype=np.uint8)
    if pixels.size != width * height:
        raise ValueError(f"{path} contains {pixels.size} of {width * height} pixels")
    return (pixels.reshape((height, width)) >= 128).astype(np.uint8)


def read_sdf(path: Path, width: int, height: int) -> np.ndarray:
    values = np.fromfile(path, dtype="<f4")
    if values.size != width * height:
        raise ValueError(f"{path} contains {values.size} of {width * height} float32 values")
    return values.reshape((height, width)).astype(np.float64)


def chamfer_distance_to(features: np.ndarray) -> np.ndarray:
    features = np.asarray(features, dtype=bool)
    if not features.any():
        raise ValueError("distance transform requires at least one feature pixel")
    height, width = features.shape
    distance = np.where(features, 0.0, np.inf)
    diagonal = math.sqrt(2.0)
    for y in range(height):
        for x in range(width):
            best = distance[y, x]
            if x > 0:
                best = min(best, distance[y, x - 1] + 1.0)
            if y > 0:
                best = min(best, distance[y - 1, x] + 1.0)
                if x > 0:
                    best = min(best, distance[y - 1, x - 1] + diagonal)
                if x + 1 < width:
                    best = min(best, distance[y - 1, x + 1] + diagonal)
            distance[y, x] = best
    for y in range(height - 1, -1, -1):
        for x in range(width - 1, -1, -1):
            best = distance[y, x]
            if x + 1 < width:
                best = min(best, distance[y, x + 1] + 1.0)
            if y + 1 < height:
                best = min(best, distance[y + 1, x] + 1.0)
                if x > 0:
                    best = min(best, distance[y + 1, x - 1] + diagonal)
                if x + 1 < width:
                    best = min(best, distance[y + 1, x + 1] + diagonal)
            distance[y, x] = best
    return distance


def metric_signed_distance(mask: np.ndarray) -> np.ndarray:
    foreground = np.asarray(mask, dtype=bool)
    if not foreground.any() or foreground.all():
        raise ValueError("metric silhouette distance requires nonempty foreground and background")
    return chamfer_distance_to(~foreground) - chamfer_distance_to(foreground)


def normalize(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    return vector / length if length > 1e-12 else vector


class RoundedSilhouetteExtrusion:
    def __init__(self, source_sdf: np.ndarray, thickness: float, roundness: float):
        self.source_sdf = source_sdf
        self.height, self.width = source_sdf.shape
        self.thickness = thickness
        self.roundness = roundness
        self.pixel_scale = 2.0 / max(1, max(self.width, self.height) - 12)

    def sample_2d(self, x: float, y: float) -> float:
        clamped_x = max(-1.0, min(1.0, x))
        clamped_y = max(-1.0, min(1.0, y))
        px = (clamped_x * 0.5 + 0.5) * (self.width - 1)
        py = (0.5 - clamped_y * 0.5) * (self.height - 1)
        x0 = int(math.floor(px))
        y0 = int(math.floor(py))
        x1 = min(self.width - 1, x0 + 1)
        y1 = min(self.height - 1, y0 + 1)
        tx = px - x0
        ty = py - y0
        value = (
            self.source_sdf[y0, x0] * (1 - tx) * (1 - ty)
            + self.source_sdf[y0, x1] * tx * (1 - ty)
            + self.source_sdf[y1, x0] * (1 - tx) * ty
            + self.source_sdf[y1, x1] * tx * ty
        )
        outside_x = max(abs(x) - 1.0, 0.0)
        outside_y = max(abs(y) - 1.0, 0.0)
        return -float(value) * self.pixel_scale + math.hypot(outside_x, outside_y)

    def distance(self, point: np.ndarray) -> float:
        planar = self.sample_2d(float(point[0]), float(point[1]))
        slab = abs(float(point[2])) - self.thickness
        outside = math.hypot(max(planar, 0.0), max(slab, 0.0))
        inside = min(max(planar, slab), 0.0)
        return outside + inside - self.roundness

    def normal(self, point: np.ndarray) -> np.ndarray:
        epsilon = 0.004
        gradient = np.array([
            self.distance(point + np.array([epsilon, 0.0, 0.0])) - self.distance(point - np.array([epsilon, 0.0, 0.0])),
            self.distance(point + np.array([0.0, epsilon, 0.0])) - self.distance(point - np.array([0.0, epsilon, 0.0])),
            self.distance(point + np.array([0.0, 0.0, epsilon])) - self.distance(point - np.array([0.0, 0.0, epsilon])),
        ])
        return normalize(gradient)


def raymarch(volume: RoundedSilhouetteExtrusion, origin: np.ndarray, direction: np.ndarray):
    travel = 0.0
    for _step in range(160):
        point = origin + direction * travel
        distance = volume.distance(point)
        if distance < 0.0035:
            return point, volume.normal(point), travel
        travel += max(0.0025, min(0.08, distance * 0.72))
        if travel > 5.0:
            break
    return None


def rgb8(values) -> np.ndarray:
    return np.clip(np.rint(values), 0, 255).astype(np.uint8)


def render_volume(volume: RoundedSilhouetteExtrusion, resolution: int) -> tuple[dict[str, np.ndarray], dict]:
    forward = normalize(np.array([-0.48, 0.20, -1.0], dtype=np.float64))
    right = normalize(np.cross(forward, np.array([0.0, 1.0, 0.0])))
    up = normalize(np.cross(right, forward))
    camera_center = -forward * 2.35
    extent = 1.34
    clay = np.zeros((resolution, resolution, 3), dtype=np.uint8)
    clay[:] = np.array([246, 244, 238], dtype=np.uint8)
    depth = np.zeros((resolution, resolution, 3), dtype=np.uint8)
    depth[:] = 12
    normal_map = np.zeros((resolution, resolution, 3), dtype=np.uint8)
    normal_map[:] = np.array([128, 128, 255], dtype=np.uint8)
    mask = np.zeros((resolution, resolution, 3), dtype=np.uint8)
    alpha_clay = np.zeros((resolution, resolution, 4), dtype=np.uint8)
    hit_depths = []
    hits = []
    light = normalize(np.array([-0.45, 0.72, 0.55]))
    rim_light = normalize(np.array([0.65, 0.1, 0.35]))

    for py in range(resolution):
        sy = (0.5 - (py + 0.5) / resolution) * 2.0 * extent
        for px in range(resolution):
            sx = ((px + 0.5) / resolution - 0.5) * 2.0 * extent
            origin = camera_center + right * sx + up * sy
            hit = raymarch(volume, origin, forward)
            if hit is None:
                continue
            point, surface_normal, travel = hit
            hit_depths.append(travel)
            hits.append((px, py, point, surface_normal, travel))

    if not hits:
        raise ValueError("rounded silhouette extrusion rendered no surface hits")
    min_depth = min(hit_depths)
    max_depth = max(hit_depths)
    depth_span = max(max_depth - min_depth, 1e-6)
    for px, py, point, surface_normal, travel in hits:
        diffuse = max(0.0, float(np.dot(surface_normal, light)))
        rim = max(0.0, float(np.dot(surface_normal, rim_light))) ** 2.2
        side_warmth = 0.5 + 0.5 * max(-1.0, min(1.0, float(surface_normal[0])))
        base = np.array([127 + 28 * side_warmth, 108 + 16 * side_warmth, 83 + 8 * side_warmth])
        shade = 0.42 + diffuse * 0.53 + rim * 0.22
        color = rgb8(base * shade)
        clay[py, px] = color
        alpha_clay[py, px, :3] = color
        alpha_clay[py, px, 3] = 255
        depth_level = 242 - ((travel - min_depth) / depth_span) * 214
        depth[py, px] = rgb8(np.array([depth_level] * 3))
        normal_color = rgb8((surface_normal * 0.5 + 0.5) * 255)
        normal_map[py, px] = normal_color
        mask[py, px] = 255

    depth_values = np.unique(depth[np.any(mask > 0, axis=2), 0])
    normal_values = np.unique(normal_map[np.any(mask > 0, axis=2)].reshape((-1, 3)), axis=0)
    return {
        "clay": clay,
        "clayTransparent": alpha_clay,
        "depth": depth,
        "normal": normal_map,
        "mask": mask,
    }, {
        "hitPixelCount": len(hits),
        "hitPixelFraction": round(len(hits) / (resolution * resolution), 6),
        "distinctDepthLevels": int(len(depth_values)),
        "distinctNormalColors": int(len(normal_values)),
        "depthRange": [round(min_depth, 6), round(max_depth, 6)],
    }


def write_png(path: Path, image: np.ndarray) -> None:
    height, width, channels = image.shape
    if channels not in (3, 4):
        raise ValueError(f"PNG writer supports RGB/RGBA, got {channels} channels")

    def chunk(kind: bytes, payload: bytes) -> bytes:
        checksum = binascii.crc32(kind + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)

    scanlines = b"".join(b"\x00" + image[row].tobytes() for row in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6 if channels == 4 else 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(scanlines, level=6))
        + chunk(b"IEND", b"")
    )


def compose_contact_sheet(images: list[np.ndarray], columns: int = 4) -> tuple[np.ndarray, int, int]:
    if not images:
        raise ValueError("contact sheet requires at least one image")
    height, width, channels = images[0].shape
    if any(image.shape != (height, width, channels) for image in images):
        raise ValueError("contact sheet images must share dimensions and channels")
    column_count = min(columns, len(images))
    row_count = math.ceil(len(images) / column_count)
    sheet = np.empty((row_count * height, column_count * width, channels), dtype=np.uint8)
    sheet[:] = images[0][0, 0]
    for index, image in enumerate(images):
        row = index // column_count
        column = index % column_count
        sheet[row * height:(row + 1) * height, column * width:(column + 1) * width] = image
    return sheet, column_count, row_count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render actual 3D rounded silhouette extrusion conditioning maps.")
    parser.add_argument("--shape-space-dir", type=Path)
    parser.add_argument("--generation-ids")
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--verify-output-dir", type=Path)
    parser.add_argument("--resolution", type=int, default=256)
    parser.add_argument("--thickness", type=float, default=0.28)
    parser.add_argument("--roundness", type=float, default=0.05)
    return parser.parse_args()


def file_contract(path: Path) -> dict:
    payload = path.read_bytes()
    return {
        "hash": f"sha256:{hashlib.sha256(payload).hexdigest()}",
        "byteSize": len(payload),
    }


def resolve_output_path(root: Path, relative_path: str) -> Path:
    root = root.resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"conditioning output escapes witness root: {relative_path}")
    return path


def verify_output_inventory(out_dir: Path) -> dict:
    report_path = out_dir / "verification-report.json"
    report = {
        "schema": "kaminos.lirm-silhouette-extrusion-output-verification.v0",
        "status": "running",
        "phase": "output_inventory_verification",
        "lastTrustworthyEvidence": "verification_initialized",
        "witnessPath": str(out_dir),
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    try:
        receipt = json.loads((out_dir / "receipt.json").read_text())
        if receipt.get("schema") != SCHEMA or receipt.get("status") != "complete":
            raise ValueError("conditioning receipt is not a complete extrusion witness")
        bodies = receipt.get("bodies")
        if not isinstance(bodies, list) or receipt.get("generatedBodyCount") != len(bodies):
            raise ValueError("conditioning body inventory does not reconcile")
        verified_output_count = 0
        for body in bodies:
            generation_id = body.get("generationId")
            packet_path = resolve_output_path(out_dir, f"{generation_id}/conditioning-packet.json")
            if json.loads(packet_path.read_text()) != body:
                raise ValueError(f"{generation_id} conditioning packet does not match receipt body")
            outputs = body.get("outputs")
            if not isinstance(outputs, dict) or not outputs:
                raise ValueError(f"{generation_id} has no conditioning outputs")
            for kind, output in outputs.items():
                path = resolve_output_path(out_dir, output.get("path", ""))
                if not path.is_file():
                    raise ValueError(f"{generation_id} {kind} output is missing")
                actual = file_contract(path)
                if output.get("byteSize") != actual["byteSize"]:
                    raise ValueError(f"{generation_id} {kind} byte size mismatch")
                if output.get("hash") != actual["hash"]:
                    raise ValueError(f"{generation_id} {kind} hash mismatch")
                verified_output_count += 1
        report.update({
            "status": "complete",
            "phase": "output_inventory_verified",
            "lastTrustworthyEvidence": "all_packet_outputs_hash_verified",
            "verifiedBodyCount": len(bodies),
            "verifiedOutputCount": verified_output_count,
        })
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        return report
    except Exception as error:
        report.update({
            "status": "failed",
            "failurePhase": "output_inventory_verification",
            "error": str(error),
        })
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        raise


def validate_basin_source_row(row: dict) -> None:
    generation_id = row.get("generationId", "<unknown>")
    required_scalars = {
        "generationId": str,
        "sourceBasinIndex": int,
        "strength": (int, float),
        "targetBasinRetained": bool,
        "maskHash": str,
        "signedDistanceHash": str,
        "maskPath": str,
        "signedDistancePath": str,
    }
    for field, expected_type in required_scalars.items():
        value = row.get(field)
        if isinstance(value, bool) and expected_type is not bool:
            value = None
        if not isinstance(value, expected_type) or (isinstance(value, str) and not value):
            raise ValueError(f"{generation_id} basin field {field} is missing or invalid")
    if not row["maskHash"].startswith("sha256:"):
        raise ValueError(f"{generation_id} basin field maskHash is missing or invalid")
    if not row["signedDistanceHash"].startswith("sha256:"):
        raise ValueError(f"{generation_id} basin field signedDistanceHash is missing or invalid")
    usability = row.get("usabilityAssay")
    if not isinstance(usability, dict):
        raise ValueError(f"{generation_id} basin field usabilityAssay is missing or invalid")
    if usability.get("usable") is not True:
        raise ValueError(f"{generation_id} basin field usabilityAssay.usable must be true")
    nearest_training = row.get("sourceEscapeAssay", {}).get("nearestTraining", {})
    if not isinstance(nearest_training.get("copied"), bool):
        raise ValueError(
            f"{generation_id} basin field sourceEscapeAssay.nearestTraining.copied is missing or invalid"
        )
    if nearest_training["copied"]:
        raise ValueError(f"{generation_id} basin field sourceEscapeAssay.nearestTraining.copied must be false")


def accepted_source_rows(source_dir: Path, source_receipt: dict) -> tuple[dict[str, dict], str]:
    effective_route = source_receipt.get("routeIdentity", {}).get("effectiveRoute")
    if source_receipt.get("status") != "complete":
        raise ValueError("silhouette source is not complete")
    if effective_route == EXPECTED_SOURCE_ROUTE:
        rows = [
            json.loads(line)
            for line in (source_dir / "accepted-generation-index.jsonl").read_text().splitlines()
            if line.strip()
        ]
        accepted = {
            row["generationId"]: row
            for row in rows
            if not row.get("noveltyAssay", {}).get("copied", True)
        }
        return accepted, effective_route
    if effective_route in (LATENT_SAMPLE_SOURCE_ROUTE, BASIN_LATENT_SOURCE_ROUTE):
        if source_receipt.get("phase") != "witness_written":
            raise ValueError("latent silhouette source is not complete at witness_written")
        rows = source_receipt.get("generations", [])
        generated_count = int(source_receipt.get("generatedSampleCount", -1))
        accepted_count = int(source_receipt.get("acceptedSampleCount", -1))
        if generated_count != len(rows):
            raise ValueError(f"latent source claims {generated_count} samples but contains {len(rows)} generations")
        if accepted_count != sum(bool(row.get("acceptedForDownstream")) for row in rows):
            raise ValueError("latent source accepted sample count does not reconcile")
        accepted = {}
        for row in rows:
            if effective_route == BASIN_LATENT_SOURCE_ROUTE and row.get("acceptedForDownstream"):
                validate_basin_source_row(row)
            novelty_assay = row.get("noveltyAssay")
            if novelty_assay is None and effective_route == BASIN_LATENT_SOURCE_ROUTE:
                novelty_assay = {
                    "copied": row.get("sourceEscapeAssay", {}).get("nearestTraining", {}).get("copied", True),
                }
                row = {**row, "noveltyAssay": novelty_assay}
            if row.get("acceptedForDownstream") and not novelty_assay.get("copied", True):
                accepted[row["generationId"]] = row
        return accepted, effective_route
    raise ValueError(f"unsupported silhouette source route {effective_route!r}")


def main() -> int:
    args = parse_args()
    if args.verify_output_dir is not None:
        try:
            report = verify_output_inventory(args.verify_output_dir)
            print(json.dumps(report))
            return 0
        except Exception as error:
            print(str(error), file=sys.stderr)
            return 1
    if args.shape_space_dir is None or args.generation_ids is None or args.out_dir is None:
        print("generation requires --shape-space-dir, --generation-ids, and --out-dir", file=sys.stderr)
        return 2
    args.out_dir.mkdir(parents=True, exist_ok=True)
    initialized = {
        "schema": SCHEMA,
        "status": "running",
        "phase": "writer_initialized",
        "lastTrustworthyEvidence": "writer_initialized",
        "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
    }
    receipt_path = args.out_dir / "receipt.json"
    receipt_path.write_text(json.dumps(initialized, indent=2) + "\n")
    try:
        source_receipt_path = args.shape_space_dir / "receipt.json"
        source_receipt = json.loads(source_receipt_path.read_text())
        accepted, effective_source_route = accepted_source_rows(args.shape_space_dir, source_receipt)
        source_receipt_hash = f"sha256:{hashlib.sha256(source_receipt_path.read_bytes()).hexdigest()}"
        requested_ids = [value.strip() for value in args.generation_ids.split(",") if value.strip()]
        if not requested_ids:
            raise ValueError("generation-ids must name at least one silhouette")
        missing = [generation_id for generation_id in requested_ids if generation_id not in accepted]
        if missing:
            raise ValueError(f"generation(s) not accepted for downstream conditioning: {', '.join(missing)}")
        if args.resolution < 64:
            raise ValueError("resolution must be at least 64")
        bodies = []
        contact_sheet_images = {kind: [] for kind in ("clay", "depth", "normal")}
        for generation_id in requested_ids:
            row = accepted[generation_id]
            mask_path = args.shape_space_dir / row["maskPath"]
            mask_file_hash = file_contract(mask_path)["hash"]
            mask = read_pgm(mask_path)
            mask_array_hash = f"sha256:{hashlib.sha256(np.ascontiguousarray(mask, dtype=np.uint8).tobytes()).hexdigest()}"
            source_receipt_mask_hash = row.get("maskHash")
            if source_receipt_mask_hash is not None and source_receipt_mask_hash != mask_array_hash:
                raise ValueError(f"{generation_id} source receipt mask hash does not match decoded mask")
            signed_distance_path = None
            signed_distance_file_hash = None
            source_receipt_signed_distance_hash = row.get("signedDistanceHash")
            if effective_source_route != LATENT_SAMPLE_SOURCE_ROUTE:
                signed_distance_path = args.shape_space_dir / row["signedDistancePath"]
                signed_distance_file_hash = file_contract(signed_distance_path)["hash"]
                if (
                    source_receipt_signed_distance_hash is not None
                    and source_receipt_signed_distance_hash != signed_distance_file_hash
                ):
                    raise ValueError(f"{generation_id} source receipt signed-distance hash does not match file")
            if effective_source_route in (LATENT_SAMPLE_SOURCE_ROUTE, BASIN_LATENT_SOURCE_ROUTE):
                source_sdf = metric_signed_distance(mask)
                source_distance_kind = "mask-derived-chamfer-signed-distance"
            else:
                assert signed_distance_path is not None
                source_sdf = read_sdf(
                    signed_distance_path,
                    mask.shape[1],
                    mask.shape[0],
                )
                source_distance_kind = "source-signed-distance"
            volume = RoundedSilhouetteExtrusion(source_sdf, args.thickness, args.roundness)
            images, render_stats = render_volume(volume, args.resolution)
            body_dir = args.out_dir / generation_id
            body_dir.mkdir(exist_ok=True)
            output_paths = {
                "clay": "clay.png",
                "clayTransparent": "clay-transparent.png",
                "depth": "depth.png",
                "normal": "normal.png",
                "mask": "mask.png",
            }
            for kind, filename in output_paths.items():
                write_png(body_dir / filename, images[kind])
            for kind in contact_sheet_images:
                contact_sheet_images[kind].append(images[kind])
            outputs = {
                kind: {
                    "path": f"{generation_id}/{filename}",
                    **file_contract(body_dir / filename),
                    "width": args.resolution,
                    "height": args.resolution,
                    "role": "clay-source" if kind.startswith("clay") else f"{kind}-control",
                }
                for kind, filename in output_paths.items()
            }
            packet = {
                "schema": PACKET_SCHEMA,
                "route": REQUESTED_ROUTE,
                "generationId": generation_id,
                "source": {
                    "shapeSpaceRoute": effective_source_route,
                    "receiptHash": source_receipt_hash,
                    "sourceReceiptMaskHash": source_receipt_mask_hash,
                    "maskArrayHash": mask_array_hash,
                    "maskFileHash": mask_file_hash,
                    "sourceReceiptSignedDistanceHash": source_receipt_signed_distance_hash,
                    "signedDistanceFileHash": signed_distance_file_hash,
                    "parentShapeIds": row.get("parentShapeIds", []),
                    "noveltyAssay": row["noveltyAssay"],
                    "usabilityAssay": row.get("usabilityAssay"),
                    "sourceBasinIndex": row.get("sourceBasinIndex"),
                    "posteriorStrength": row.get("strength"),
                    "targetBasinRetained": row.get("targetBasinRetained"),
                },
                "volume": {
                    "kind": "rounded_silhouette_extrusion_sdf",
                    "actual3dStructure": True,
                    "sourceDistanceKind": source_distance_kind,
                    "thickness": args.thickness,
                    "roundness": args.roundness,
                    "camera": "orthographic-three-quarter-v0",
                },
                "renderStats": render_stats,
                "outputs": outputs,
                "routeCandidates": [{
                    "route": "imagegen_img2img_depth_normal",
                    "inputs": ["clay", "depth", "normal", "mask"],
                    "purpose": "test whether imagegen elaborates harvested silhouette gestalt from an actual 3D conditioning volume",
                }],
            }
            (body_dir / "conditioning-packet.json").write_text(json.dumps(packet, indent=2) + "\n")
            bodies.append(packet)
        contact_sheets = {}
        for kind, images in contact_sheet_images.items():
            sheet, column_count, row_count = compose_contact_sheet(images)
            filename = f"{kind}-contact-sheet.png"
            path = args.out_dir / filename
            write_png(path, sheet)
            contact_sheets[kind] = {
                "path": filename,
                "hash": f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}",
                "width": int(sheet.shape[1]),
                "height": int(sheet.shape[0]),
                "columns": column_count,
                "rows": row_count,
                "bodyCount": len(images),
            }
        receipt = {
            "schema": SCHEMA,
            "status": "complete",
            "phase": "witness_written",
            "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
            "sourceRouteIdentity": source_receipt["routeIdentity"],
            "sourceReceiptHash": source_receipt_hash,
            "sourceShapeSpace": str(args.shape_space_dir),
            "requestedGenerationIds": requested_ids,
            "generatedBodyCount": len(bodies),
            "resolution": args.resolution,
            "bodies": bodies,
            "outputInventory": {"contactSheets": contact_sheets},
            "falseClosureGuards": {
                "flatMaskRelabeledAsDepth": "rejected",
                "copiedSilhouetteAccepted": "false",
                "missingOrBlankOutput": "rejected",
                "actual3dSurfaceEvidence": "depth_and_field_gradient_normal_variation",
            },
        }
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps({"status": "complete", "generatedBodyCount": len(bodies), "output": str(args.out_dir)}))
        return 0
    except Exception as error:
        failed = {
            **initialized,
            "status": "failed",
            "failurePhase": "validate_or_render_extrusion",
            "error": str(error),
        }
        receipt_path.write_text(json.dumps(failed, indent=2) + "\n")
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
