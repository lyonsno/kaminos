"""Topology metrics for the Trellis fur-signal atlas."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np


def verify_source(path, expected_sha256):
    path = Path(path)
    observed = hashlib.sha256(path.read_bytes()).hexdigest()
    if observed != expected_sha256:
        raise RuntimeError(
            f"source hash mismatch for {path}: expected {expected_sha256}, observed {observed}"
        )
    return observed


class _DisjointSet:
    def __init__(self, size):
        self.parent = np.arange(size, dtype=np.int64)
        self.rank = np.zeros(size, dtype=np.uint8)

    def find(self, item):
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[item] != item:
            parent = self.parent[item]
            self.parent[item] = root
            item = parent
        return int(root)

    def union(self, first, second):
        first_root = self.find(first)
        second_root = self.find(second)
        if first_root == second_root:
            return
        if self.rank[first_root] < self.rank[second_root]:
            first_root, second_root = second_root, first_root
        self.parent[second_root] = first_root
        if self.rank[first_root] == self.rank[second_root]:
            self.rank[first_root] += 1


def _validate_mesh(vertices, triangles):
    vertices = np.asarray(vertices, dtype=np.float64)
    triangles = np.asarray(triangles, dtype=np.int64)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or len(vertices) == 0:
        raise ValueError("vertices must be a nonempty Nx3 array")
    if triangles.ndim != 2 or triangles.shape[1] != 3 or len(triangles) == 0:
        raise ValueError("triangles must be a nonempty Mx3 array")
    if triangles.min() < 0 or triangles.max() >= len(vertices):
        raise ValueError("triangle index lies outside the vertex array")
    return vertices, triangles


def analyze_topology(vertices, triangles):
    vertices, triangles = _validate_mesh(vertices, triangles)
    points = vertices[triangles]
    edge_vectors = np.stack(
        (points[:, 1] - points[:, 0], points[:, 2] - points[:, 1], points[:, 0] - points[:, 2]),
        axis=1,
    )
    edge_lengths = np.linalg.norm(edge_vectors, axis=2)
    cross = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
    double_area = np.linalg.norm(cross, axis=1)
    area = 0.5 * double_area
    diagonal = float(np.linalg.norm(np.ptp(vertices, axis=0)))
    scale_epsilon = max(diagonal, 1.0) * 1e-12
    area_epsilon = scale_epsilon * scale_epsilon
    normals = cross / np.maximum(double_area[:, None], area_epsilon)
    relative_area = area / max(diagonal * diagonal, area_epsilon)
    longest_edge = edge_lengths.max(axis=1)
    minimum_altitude = double_area / np.maximum(longest_edge, scale_epsilon)
    aspect_ratio = longest_edge / np.maximum(minimum_altitude, scale_epsilon)

    edge_faces = {}
    vertex_first_face = {}
    components = _DisjointSet(len(triangles))
    for face_index, triangle in enumerate(triangles):
        for vertex_index in triangle:
            vertex_index = int(vertex_index)
            if vertex_index in vertex_first_face:
                components.union(face_index, vertex_first_face[vertex_index])
            else:
                vertex_first_face[vertex_index] = face_index
        for first, second in ((triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0])):
            edge = tuple(sorted((int(first), int(second))))
            edge_faces.setdefault(edge, []).append(face_index)

    boundary_edges = np.zeros(len(triangles), dtype=np.float64)
    normal_disorder_sum = np.zeros(len(triangles), dtype=np.float64)
    normal_disorder_count = np.zeros(len(triangles), dtype=np.int64)
    for faces in edge_faces.values():
        if len(faces) == 1:
            boundary_edges[faces[0]] += 1.0
            continue
        for offset, first in enumerate(faces):
            for second in faces[offset + 1 :]:
                disagreement = 1.0 - float(np.clip(abs(np.dot(normals[first], normals[second])), 0.0, 1.0))
                normal_disorder_sum[first] += disagreement
                normal_disorder_sum[second] += disagreement
                normal_disorder_count[first] += 1
                normal_disorder_count[second] += 1
    normal_disorder = normal_disorder_sum / np.maximum(normal_disorder_count, 1)

    roots = np.fromiter((components.find(index) for index in range(len(triangles))), dtype=np.int64)
    unique_roots, component_ids = np.unique(roots, return_inverse=True)
    component_face_counts = np.bincount(component_ids)
    face_component_count = component_face_counts[component_ids]
    component_sheetness = np.zeros(len(unique_roots), dtype=np.float64)
    for component_id in range(len(unique_roots)):
        face_indices = np.flatnonzero(component_ids == component_id)
        component_vertices = np.unique(triangles[face_indices].reshape(-1))
        cloud = vertices[component_vertices]
        if len(cloud) < 3:
            component_sheetness[component_id] = 1.0
            continue
        centered = cloud - cloud.mean(axis=0)
        covariance = centered.T @ centered / len(cloud)
        eigenvalues = np.maximum(np.linalg.eigvalsh(covariance), 0.0)
        component_sheetness[component_id] = 1.0 - np.sqrt(
            (eigenvalues[0] + area_epsilon) / (eigenvalues[1] + area_epsilon)
        )

    max_component_faces = int(component_face_counts.max())
    small_component = 1.0 - np.log1p(face_component_count) / np.log1p(max_component_faces)
    result = {
        "component_count": int(len(unique_roots)),
        "component_face_count": face_component_count,
        "component_sheetness": component_sheetness[component_ids],
        "small_component": small_component,
        "relative_area": relative_area,
        "aspect_ratio": aspect_ratio,
        "boundary_fraction": boundary_edges / 3.0,
        "normal_disorder": normal_disorder,
    }
    for name, values in result.items():
        if name == "component_count":
            continue
        if not np.all(np.isfinite(values)):
            raise RuntimeError(f"metric channel {name} contains non-finite values")
    return result


def normalize_channel(values, *, lower_quantile=0.02, upper_quantile=0.98):
    values = np.asarray(values, dtype=np.float64)
    finite = values[np.isfinite(values)]
    if len(finite) == 0:
        raise ValueError("metric channel has no finite values")
    lower = float(np.quantile(finite, lower_quantile))
    upper = float(np.quantile(finite, upper_quantile))
    if not upper > lower:
        raise ValueError("metric channel must be nonconstant")
    normalized = np.clip((values - lower) / (upper - lower), 0.0, 1.0)
    if not np.all(np.isfinite(normalized)):
        raise ValueError("metric channel normalization produced non-finite values")
    return normalized


def _safe_normalize(values):
    try:
        return normalize_channel(values)
    except ValueError:
        return np.zeros_like(np.asarray(values, dtype=np.float64))


def candidate_signal(metrics):
    channels = (
        ("small_component", 0.30, False),
        ("component_sheetness", 0.25, False),
        ("boundary_fraction", 0.20, False),
        ("normal_disorder", 0.15, False),
        ("aspect_ratio", 0.10, True),
    )
    signal = None
    for name, weight, logarithmic in channels:
        values = np.asarray(metrics[name], dtype=np.float64)
        if logarithmic:
            values = np.log1p(np.maximum(values, 0.0))
        normalized = _safe_normalize(values)
        signal = normalized * weight if signal is None else signal + normalized * weight
    return np.clip(signal, 0.0, 1.0)


def channel_discrimination(fur_by_seed, skin_by_seed, *, control_quantile=0.99):
    if set(fur_by_seed) != set(skin_by_seed) or not fur_by_seed:
        raise ValueError("fur and skin controls must have the same nonempty seed set")
    fur = {seed: np.asarray(values, dtype=np.float64) for seed, values in fur_by_seed.items()}
    skin = {seed: np.asarray(values, dtype=np.float64) for seed, values in skin_by_seed.items()}
    for family, channels in (("fur", fur), ("skin", skin)):
        for seed, values in channels.items():
            if len(values) == 0 or not np.all(np.isfinite(values)):
                raise ValueError(f"{family} seed {seed} must contain finite observations")
    pooled_skin = np.concatenate(list(skin.values()))
    threshold = float(np.quantile(pooled_skin, control_quantile))
    fur_coverage_by_seed = {
        seed: float(np.mean(values > threshold)) for seed, values in fur.items()
    }
    skin_coverage_by_seed = {
        seed: float(np.mean(values > threshold)) for seed, values in skin.items()
    }
    fur_coverage = float(np.mean(list(fur_coverage_by_seed.values())))
    skin_coverage = float(np.mean(list(skin_coverage_by_seed.values())))
    return {
        "controlQuantile": control_quantile,
        "threshold": threshold,
        "furCoverage": fur_coverage,
        "skinCoverage": skin_coverage,
        "furCoverageBySeed": fur_coverage_by_seed,
        "skinCoverageBySeed": skin_coverage_by_seed,
        "separation": fur_coverage - skin_coverage,
    }


def write_failure_report(path, *, phase, error, last_trustworthy_evidence):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "kaminos.fur-signal-metric-atlas-failure.v0",
        "phase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": last_trustworthy_evidence,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")
