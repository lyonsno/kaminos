#!/usr/bin/env python3
"""Pack the frozen exact-basin support classifier and carrier heads for WebGPU."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.selective-head-live-model.v0"
PAIR_AUTHORITY = "downsampled-same-high-history-input-to-exact-high-target"
TRAINING_INPUT_AUTHORITY = "phase-aligned-high-filtered-to-low-grid-v0"
CHANNELS = ["supportProbability", "fuel", "fireLick", "visibleFireCarrier", "frontTopology"]
HEAD_KEYS = {
    "supportProbability": "",
    "fuel": "fuel.",
    "fireLick": "fireLick.",
    "visibleFireCarrier": "visibleFireCarrier.",
    "frontTopology": "frontTopology.",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def model_identity(high_grid: int, low_grid: int) -> str:
    return f"exact-basin-selective-carrier-heads-{high_grid}-to-{low_grid}-v0"


def model_arrays(archive: Any, prefix: str) -> list[np.ndarray]:
    arrays = [
        np.asarray(archive[f"{prefix}w1"], dtype="<f4"),
        np.asarray(archive[f"{prefix}b1"], dtype="<f4"),
        np.asarray(archive[f"{prefix}w2"], dtype="<f4"),
        np.asarray(archive[f"{prefix}b2"], dtype="<f4"),
        np.asarray(archive[f"{prefix}targetMean"], dtype="<f4").reshape(1),
        np.asarray(archive[f"{prefix}targetStd"], dtype="<f4").reshape(1),
    ]
    require(arrays[0].shape == (185, 48), f"{prefix or 'classifier'} w1 shape mismatch")
    require(arrays[1].size == 48 and arrays[2].size == 48 and arrays[3].size == 1, f"{prefix or 'classifier'} output shape mismatch")
    return arrays


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--support-threshold", type=float, default=0.98)
    parser.add_argument("--expected-low-grid", type=int)
    parser.add_argument("--expected-high-grid", type=int)
    parser.add_argument("--model-identity")
    parser.add_argument("--training-basin-identity")
    parser.add_argument("--training-source-capture-sha256")
    args = parser.parse_args()
    probe_path = Path(args.probe_manifest).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    probe = json.loads(probe_path.read_text(encoding="utf-8"))
    require(probe.get("schema") == "kaminos.volume.exact-basin-support-probe.v0", "probe schema mismatch")
    require(probe.get("status") == "captured" and probe.get("failurePhase") is None, "probe is not captured")
    require(probe.get("features", {}).get("featureCount") == 185, "probe feature count mismatch")
    inputs = probe.get("inputs", {})
    low_grid = int(inputs.get("lowGrid") or 0)
    high_grid = int(inputs.get("highGrid") or 0)
    require(low_grid >= 2 and high_grid > low_grid, "probe grid pair mismatch")
    if args.expected_low_grid is not None:
        require(low_grid == args.expected_low_grid, "probe low grid differs from caller expectation")
    if args.expected_high_grid is not None:
        require(high_grid == args.expected_high_grid, "probe high grid differs from caller expectation")
    package_identity = args.model_identity or model_identity(high_grid, low_grid)
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", package_identity) is not None, "model identity must be a stable lowercase slug")
    has_basin_identity = args.training_basin_identity is not None
    has_source_hash = args.training_source_capture_sha256 is not None
    require(has_basin_identity == has_source_hash, "training basin identity and source-capture hash must be supplied together")
    if has_basin_identity:
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.training_basin_identity) is not None, "training basin identity must be a stable lowercase slug")
        require(re.fullmatch(r"[0-9a-f]{64}", args.training_source_capture_sha256) is not None, "training source-capture hash must be lowercase sha256")
    require(inputs.get("pairAuthority") == PAIR_AUTHORITY, "probe pair authority mismatch")
    require(inputs.get("trainingInputAuthority") == TRAINING_INPUT_AUTHORITY, "probe training input authority mismatch")
    require(inputs.get("trainingInputSyntheticDownsample") is True, "probe must record synthetic training downsample")
    require(inputs.get("nativeDeploymentInputSeenDuringTraining") is False, "probe must deny native deployment training input")
    classifier_path = Path(probe["classifier"]["artifact"]["path"]).resolve()
    heads_path = Path(probe["channelHeadArtifact"]["path"]).resolve()
    require(sha256(classifier_path) == probe["classifier"]["artifact"]["sha256"], "classifier checksum mismatch")
    require(sha256(heads_path) == probe["channelHeadArtifact"]["sha256"], "head checksum mismatch")
    packed: list[np.ndarray] = []
    outputs: list[dict[str, Any]] = []
    offset = 0
    with np.load(classifier_path, allow_pickle=False) as classifier, np.load(heads_path, allow_pickle=False) as heads:
        mean = np.asarray(classifier["featureMean"], dtype="<f4").reshape(-1)
        std = np.asarray(classifier["featureStd"], dtype="<f4").reshape(-1)
        require(mean.size == 185 and std.size == 185, "feature normalization shape mismatch")
        for name, values in (("featureMean", mean), ("featureStd", std)):
            packed.append(values)
            outputs.append({"channel": name, "offset": offset, "floatCount": int(values.size), "kind": "normalization"})
            offset += int(values.size)
        for channel in CHANNELS:
            source = classifier if channel == "supportProbability" else heads
            arrays = model_arrays(source, HEAD_KEYS[channel])
            layer_offsets: dict[str, int] = {}
            for name, values in zip(("w1", "b1", "w2", "b2", "targetMean", "targetStd"), arrays):
                contiguous = np.ascontiguousarray(values.reshape(-1), dtype="<f4")
                layer_offsets[name] = offset
                packed.append(contiguous)
                offset += int(contiguous.size)
            outputs.append({
                "channel": channel,
                "kind": "classifier" if channel == "supportProbability" else "residual-head",
                "offsets": layer_offsets,
                "policy": (
                    "probability-threshold-v0" if channel == "supportProbability"
                    else "dense-ungated-residual-v0" if channel == "frontTopology"
                    else "sparse-hard-support-gated-residual-v0"
                ),
            })
    values = np.concatenate(packed).astype("<f4", copy=False)
    data_path = out_dir / "model.f32"
    values.tofile(data_path)
    model = {
        "schema": SCHEMA,
        "identity": package_identity,
        "status": "captured",
        "failurePhase": None,
        "source": {
            "probeManifestPath": str(probe_path),
            "probeManifestSha256": sha256(probe_path),
            "classifierSha256": sha256(classifier_path),
            "channelHeadsSha256": sha256(heads_path),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "pairAuthority": inputs["pairAuthority"],
            "trainingInputAuthority": inputs["trainingInputAuthority"],
            "trainingInputSyntheticDownsample": inputs["trainingInputSyntheticDownsample"],
            "nativeDeploymentInputSeenDuringTraining": inputs["nativeDeploymentInputSeenDuringTraining"],
            **({
                "trainingBasinIdentity": args.training_basin_identity,
                "trainingSourceCaptureSha256": args.training_source_capture_sha256,
            } if has_basin_identity else {}),
        },
        "features": {
            "identity": "full-low-field-plus-spatial-rbf-features-v0",
            "featureCount": 185,
            "lowFieldCount": 17,
            "squaredLowFieldCount": 17,
            "positionCount": 5,
            "fourierCount": 18,
            "rbfCount": 128,
        },
        "architecture": {"identity": "dense-tanh-dense-v0", "activation": "tanh", "hiddenWidth": 48},
        "composition": {
            "supportThreshold": float(args.support_threshold),
            "supportThresholdAuthority": "operator-selected-motion-witness-v0",
            "fuel": "sparse-hard-support-gated-residual-v0",
            "fireLick": "sparse-hard-support-gated-residual-v0",
            "visibleFireCarrier": "sparse-hard-support-gated-residual-v0",
            "frontTopology": "dense-ungated-residual-v0",
        },
        "outputs": [output for output in outputs if output["kind"] != "normalization"],
        "normalization": {output["channel"]: output for output in outputs if output["kind"] == "normalization"},
        "packed": {
            "path": "model.f32",
            "dtype": "float32-le",
            "floatCount": int(values.size),
            "byteLength": int(data_path.stat().st_size),
            "sha256": sha256(data_path),
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    module_path = out_dir / "model.generated.js"
    module_path.write_text(
        "// Generated by volume-selective-head-live-model-export.py.\n"
        f"export const SELECTIVE_HEAD_LIVE_MODEL = Object.freeze({json.dumps(model, separators=(',', ':'))});\n"
        "export const SELECTIVE_HEAD_LIVE_MODEL_URL = new URL('./model.f32', import.meta.url).href;\n",
        encoding="ascii",
    )
    print(json.dumps({"ok": True, "manifest": str(manifest_path), "model": str(data_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
