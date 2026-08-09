"""Derive the M31 Blender-world to authored-skeleton similarity receipt."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np


SOURCE_SHA256 = "a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3"
SUPPORT_NAMES = ("Cube.002", "Cube.003")


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-probe", required=True)
    parser.add_argument("--authored-probe", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _point_sets(probe: dict, expected_schema: str) -> dict[str, np.ndarray]:
    if probe.get("schema") != expected_schema:
        raise RuntimeError(f"probe schema mismatch: {probe.get('schema')} != {expected_schema}")
    records = {entry["name"]: entry for entry in probe.get("supports", [])}
    if set(records) != set(SUPPORT_NAMES):
        raise RuntimeError(f"probe support identity mismatch: {sorted(records)}")
    result = {}
    for name in SUPPORT_NAMES:
        points = np.asarray(records[name]["positionsWorld"], dtype=np.float64).reshape(-1, 3)
        if not np.isfinite(points).all() or len(points) < 4:
            raise RuntimeError(f"probe support {name} has invalid geometry")
        result[name] = np.unique(np.round(points, 9), axis=0)
    return result


def _nearest(points: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    squared = np.square(points[:, None, :] - target[None, :, :]).sum(axis=2)
    indices = squared.argmin(axis=1)
    return target[indices], np.sqrt(squared[np.arange(len(points)), indices])


def _fit_similarity(source: np.ndarray, target: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    source_center = source.mean(axis=0)
    target_center = target.mean(axis=0)
    source_zero = source - source_center
    target_zero = target - target_center
    u, singular, vt = np.linalg.svd(source_zero.T @ target_zero)
    rotation = vt.T @ u.T
    if np.linalg.det(rotation) < 0:
        vt[-1] *= -1
        rotation = vt.T @ u.T
    scale = float(singular.sum() / np.square(source_zero).sum())
    translation = target_center - scale * (rotation @ source_center)
    return scale, rotation, translation


def _derive(source: dict[str, np.ndarray], target: dict[str, np.ndarray]) -> dict:
    source_all = np.concatenate([source[name] for name in SUPPORT_NAMES])
    target_all = np.concatenate([target[name] for name in SUPPORT_NAMES])
    source_center = source_all.mean(axis=0)
    target_center = target_all.mean(axis=0)
    _, source_axes = np.linalg.eigh(np.cov((source_all - source_center).T))
    _, target_axes = np.linalg.eigh(np.cov((target_all - target_center).T))
    source_axes = source_axes[:, ::-1]
    target_axes = target_axes[:, ::-1]
    initial_scale = float(
        np.sqrt(np.square(target_all - target_center).sum() / np.square(source_all - source_center).sum())
    )
    candidates = []
    for signs in itertools.product((-1.0, 1.0), repeat=3):
        rotation = target_axes @ np.diag(signs) @ source_axes.T
        translation = target_center - initial_scale * (rotation @ source_center)
        scale = initial_scale
        for _ in range(64):
            source_pairs, target_pairs = [], []
            for name in SUPPORT_NAMES:
                posed = scale * (source[name] @ rotation.T) + translation
                neighbors, _ = _nearest(posed, target[name])
                source_pairs.append(source[name])
                target_pairs.append(neighbors)
            next_scale, next_rotation, next_translation = _fit_similarity(
                np.concatenate(source_pairs), np.concatenate(target_pairs)
            )
            delta = (
                abs(next_scale - scale)
                + np.linalg.norm(next_rotation - rotation)
                + np.linalg.norm(next_translation - translation)
            )
            scale, rotation, translation = next_scale, next_rotation, next_translation
            if delta < 1e-12:
                break
        residuals = {}
        all_distances = []
        for name in SUPPORT_NAMES:
            posed = scale * (source[name] @ rotation.T) + translation
            _, distances = _nearest(posed, target[name])
            all_distances.extend(distances.tolist())
            residuals[name] = {
                "rms": float(np.sqrt(np.square(distances).mean())),
                "max": float(distances.max()),
                "sourceVertices": int(len(source[name])),
                "targetVertices": int(len(target[name])),
            }
        candidates.append(
            (
                float(np.sqrt(np.square(all_distances).mean())),
                float(max(all_distances)),
                scale,
                rotation,
                translation,
                residuals,
            )
        )
    rms, maximum, scale, rotation, translation, residuals = min(candidates, key=lambda item: item[0])
    if rms > 0.5 or maximum > 1.0:
        raise RuntimeError(f"M31 support registration residual exceeded gate: rms={rms}, max={maximum}")
    return {
        "transform": {
            "scale": scale,
            "rotation": rotation.tolist(),
            "translation": translation.tolist(),
        },
        "residual": {"rms": rms, "max": maximum, "supports": residuals},
    }


def main() -> int:
    args = _arguments()
    source_path = Path(args.source_probe)
    authored_path = Path(args.authored_probe)
    source_probe = json.loads(source_path.read_text(encoding="utf-8"))
    authored_probe = json.loads(authored_path.read_text(encoding="utf-8"))
    if source_probe.get("sourceSha256") != SOURCE_SHA256:
        raise RuntimeError("M31 source probe does not name the authenticated blend")
    source = _point_sets(source_probe, "kaminos.m31-support-registration-probe.v0")
    target = _point_sets(authored_probe, "kaminos.m31-authored-support-probe.v0")
    derived = _derive(source, target)
    content = {
        "schema": "kaminos.m31-source-registration-receipt.v0",
        "inputs": {
            "sourceProbe": str(source_path),
            "sourceProbeSha256": _digest(source_path),
            "sourceBlendSha256": SOURCE_SHA256,
            "authoredProbe": str(authored_path),
            "authoredProbeSha256": _digest(authored_path),
            "authoredSkeletonSha256": authored_probe["sourceSha256"],
            "supports": list(SUPPORT_NAMES),
        },
        "algorithm": "labeled-two-support-pca-seeded-similarity-icp-v0",
        "claimCeiling": "cross-frame registration for the authenticated M31 assay overlay only",
        **derived,
    }
    receipt = {
        **content,
        "receiptSha256": f"sha256:{hashlib.sha256(_canonical(content)).hexdigest()}",
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"status": "written", "output": str(output), **derived["residual"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
