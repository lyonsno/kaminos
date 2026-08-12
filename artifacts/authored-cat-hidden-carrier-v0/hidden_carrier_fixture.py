"""CPU contracts for the authored-cat hidden-carrier truth fixture.

The uniform inset is a deliberately weak negative control. It must not be
confused with the later volumetric/SDF recovery arm.
"""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import numpy as np


SCHEMA = "kaminos.authored-cat-hidden-carrier-fixture.v0"
SOURCE_SHA256 = "cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e"
SOURCE_CLASS = "operator-authored-carrier-export"
PROFILES = ("short-v0", "short-with-medium-scapular-v0")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _as_points(name: str, value) -> np.ndarray:
    points = np.asarray(value, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 3 or not len(points):
        raise ValueError(f"{name} must have shape (n, 3) with n > 0")
    if not np.isfinite(points).all():
        raise ValueError(f"{name} must be finite")
    return points


def _unit_normals(normals, *, count: int) -> np.ndarray:
    vectors = _as_points("normals", normals)
    if len(vectors) != count:
        raise ValueError("normal and point cardinalities differ")
    lengths = np.linalg.norm(vectors, axis=1)
    if np.any(lengths <= 1e-12):
        raise ValueError("normals must be nonzero")
    return vectors / lengths[:, None]


def build_fixture_contract(source_path, *, repo_root):
    source_path = Path(source_path)
    repo_root = Path(repo_root)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    observed = _sha256(source_path)
    if observed != SOURCE_SHA256:
        raise ValueError(
            f"source digest mismatch: expected {SOURCE_SHA256}, observed {observed}"
        )
    try:
        locator = source_path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError as error:
        raise ValueError("authenticated source must live under the explicit repo root") from error
    return {
        "schema": SCHEMA,
        "source": {
            "path": locator,
            "sha256": observed,
            "contentClass": SOURCE_CLASS,
        },
        "frame": {"ML": "X", "AP": "Z", "DV": "Y", "dorsalDirection": "-Y"},
        "coatProfiles": [
            {
                "id": "short-v0",
                "authority": "deterministic-authored-fixture",
                "description": "spatially varying short coat with low-frequency directionality",
            },
            {
                "id": "short-with-medium-scapular-v0",
                "authority": "deterministic-authored-fixture",
                "description": "short coat plus one bounded dorsal/scapular medium-depth region",
            },
        ],
        "recoveryArms": ["uniform-inset-negative-control-v0"],
        "claimCeiling": (
            "Authored-fixture evidence for deterministic coat synthesis, truth-isolated "
            "baseline recovery, and residual measurement; not arbitrary-source fur recovery."
        ),
    }


def _glb_chunks(path: Path):
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise ValueError("GLB is truncated")
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2 or declared_length != len(data):
        raise ValueError("source is not a complete GLB v2 payload")
    chunks = {}
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("GLB chunk header is truncated")
        length, chunk_type = struct.unpack_from("<II", data, offset)
        start = offset + 8
        end = start + length
        if end > len(data):
            raise ValueError("GLB chunk payload is truncated")
        chunks[chunk_type] = data[start:end]
        offset = end
    if 0x4E4F534A not in chunks or 0x004E4942 not in chunks:
        raise ValueError("GLB must contain JSON and BIN chunks")
    document = json.loads(chunks[0x4E4F534A].rstrip(b" \t\r\n\0"))
    return document, chunks[0x004E4942]


def _accessor_array(document: dict, binary: bytes, accessor_index: int) -> np.ndarray:
    accessor = document["accessors"][accessor_index]
    if "sparse" in accessor:
        raise ValueError("sparse GLB accessors are not supported by this fixture")
    view = document["bufferViews"][accessor["bufferView"]]
    components = {
        "SCALAR": 1,
        "VEC2": 2,
        "VEC3": 3,
        "VEC4": 4,
        "MAT4": 16,
    }[accessor["type"]]
    dtype = {
        5120: np.dtype("i1"),
        5121: np.dtype("u1"),
        5122: np.dtype("<i2"),
        5123: np.dtype("<u2"),
        5125: np.dtype("<u4"),
        5126: np.dtype("<f4"),
    }[accessor["componentType"]]
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    packed_stride = dtype.itemsize * components
    stride = int(view.get("byteStride", packed_stride))
    last_byte = start + (int(accessor["count"]) - 1) * stride + packed_stride
    if last_byte > len(binary):
        raise ValueError("GLB accessor extends beyond BIN chunk")
    array = np.ndarray(
        shape=(int(accessor["count"]), components),
        dtype=dtype,
        buffer=binary,
        offset=start,
        strides=(stride, dtype.itemsize),
    )
    return np.asarray(array, dtype=np.float64).copy()


def _local_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T
    translation = np.asarray(node.get("translation", [0.0, 0.0, 0.0]), dtype=np.float64)
    scale = np.asarray(node.get("scale", [1.0, 1.0, 1.0]), dtype=np.float64)
    x, y, z, w = np.asarray(node.get("rotation", [0.0, 0.0, 0.0, 1.0]), dtype=np.float64)
    rotation = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation @ np.diag(scale)
    matrix[:3, 3] = translation
    return matrix


def load_glb_surface(source_path):
    document, binary = _glb_chunks(Path(source_path))
    parents = {}
    for parent_index, node in enumerate(document.get("nodes", [])):
        for child_index in node.get("children", []):
            parents[int(child_index)] = parent_index
    world_cache = {}

    def world_matrix(node_index: int) -> np.ndarray:
        if node_index in world_cache:
            return world_cache[node_index]
        matrix = _local_matrix(document["nodes"][node_index])
        if node_index in parents:
            matrix = world_matrix(parents[node_index]) @ matrix
        world_cache[node_index] = matrix
        return matrix

    positions = []
    normals = []
    for node_index, node in enumerate(document.get("nodes", [])):
        if "mesh" not in node:
            continue
        world = world_matrix(node_index)
        linear = world[:3, :3]
        normal_matrix = np.linalg.inv(linear).T
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            attributes = primitive.get("attributes", {})
            if "POSITION" not in attributes or "NORMAL" not in attributes:
                raise ValueError("every carrier primitive must provide POSITION and NORMAL")
            local_positions = _accessor_array(document, binary, attributes["POSITION"])
            local_normals = _accessor_array(document, binary, attributes["NORMAL"])
            if local_positions.shape != local_normals.shape or local_positions.shape[1] != 3:
                raise ValueError("carrier POSITION and NORMAL accessors must agree")
            positions.append((linear @ local_positions.T).T + world[:3, 3])
            transformed_normals = (normal_matrix @ local_normals.T).T
            normals.append(_unit_normals(transformed_normals, count=len(transformed_normals)))
    if not positions:
        raise ValueError("carrier GLB contains no mesh-bearing nodes")
    return {
        "positions": np.concatenate(positions, axis=0),
        "normals": np.concatenate(normals, axis=0),
    }


def coat_depths(positions, profile):
    points = _as_points("positions", positions)
    if profile not in PROFILES:
        raise ValueError(f"unknown coat profile: {profile}")
    minimum = points.min(axis=0)
    span = points.max(axis=0) - minimum
    safe_span = np.where(span > 1e-12, span, 1.0)
    unit = (points - minimum) / safe_span
    diagonal = float(np.linalg.norm(span))
    if diagonal <= 1e-12:
        raise ValueError("carrier positions must have nonzero extent")
    phase = 2.0 * np.pi * (0.35 * unit[:, 0] + 0.65 * unit[:, 2])
    short = diagonal * (0.010 + 0.002 * (0.5 + 0.5 * np.sin(phase)))
    if profile == "short-v0":
        return short
    z = unit[:, 2]
    dorsal = 1.0 - unit[:, 1]
    support = (z >= 0.45) & (z <= 0.85) & (dorsal >= 0.45)
    bump = np.zeros(len(points), dtype=np.float64)
    local_z = np.clip((z[support] - 0.45) / 0.40, 0.0, 1.0)
    local_dorsal = np.clip((dorsal[support] - 0.45) / 0.55, 0.0, 1.0)
    bump[support] = diagonal * 0.025 * np.sin(np.pi * local_z) ** 2 * local_dorsal
    return short + bump


def synthesize_observation(truth, normals, depths):
    carrier = _as_points("truth", truth)
    unit_normals = _unit_normals(normals, count=len(carrier))
    depth_values = np.asarray(depths, dtype=np.float64)
    if depth_values.shape != (len(carrier),) or not np.isfinite(depth_values).all():
        raise ValueError("depths must be a finite vector matching the carrier")
    if np.any(depth_values < 0.0):
        raise ValueError("coat depths must be nonnegative")
    return carrier + unit_normals * depth_values[:, None]


def recover_uniform_inset(observed, normals, inset):
    coat = _as_points("observed", observed)
    unit_normals = _unit_normals(normals, count=len(coat))
    inset = float(inset)
    if not np.isfinite(inset) or inset < 0.0:
        raise ValueError("uniform inset must be finite and nonnegative")
    return coat - unit_normals * inset


def recovery_metrics(truth, recovered, region_ids):
    carrier = _as_points("truth", truth)
    candidate = _as_points("recovered", recovered)
    if carrier.shape != candidate.shape:
        raise ValueError("truth and recovered carrier shapes differ")
    regions = np.asarray(region_ids)
    if regions.shape != (len(carrier),):
        raise ValueError("region_ids must match carrier cardinality")
    errors = np.linalg.norm(candidate - carrier, axis=1)
    regional = {}
    for region in sorted({str(value) for value in regions.tolist()}):
        selected = np.asarray([str(value) == region for value in regions], dtype=bool)
        regional[region] = float(np.sqrt(np.mean(errors[selected] ** 2)))
    return {
        "rmse": float(np.sqrt(np.mean(errors**2))),
        "meanError": float(np.mean(errors)),
        "maxError": float(np.max(errors)),
        "regionalRmse": regional,
    }
