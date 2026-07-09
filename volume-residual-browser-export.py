#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

import mlx.core as mx


SCHEMA = "kaminos.volume.browser-residual-model.v0"
AUTHORITY = "browser-webgpu-direct-residual-v0"
FEATURE_INPUT_AUTHORITY = "shader-material-authority-residual-feature-v0"


def sha256_path(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def as_float_list(value):
    return [float(item) for item in mx.array(value).reshape(-1).tolist()]


def first_present_float(default, *values):
    for value in values:
        if value is not None:
            return float(value)
    return float(default)


def parse_args():
    parser = argparse.ArgumentParser(description="Export Kaminos direct-residual MLX weights for the browser WebGPU one-pass route.")
    parser.add_argument("--model-artifact", required=True, help="Path to model/model-artifact.json from volume-residual-upscale-mlx.py.")
    parser.add_argument("--out", required=True, help="Output browser JSON model path.")
    return parser.parse_args()


def main():
    args = parse_args()
    artifact_path = Path(args.model_artifact).resolve()
    artifact = json.loads(artifact_path.read_text())
    model = artifact.get("model") or {}
    source = artifact.get("source") or {}
    training = artifact.get("training") or {}
    if model.get("modelArch") != "direct-residual":
        raise SystemExit(f"browser one-pass residual export only accepts direct-residual artifacts, got {model.get('modelArch')!r}")
    input_channels = int(model.get("inputChannels") or 0)
    feature_input_mode = model.get("featureInputMode") or training.get("featureInputMode") or "rgb"
    if input_channels not in (3, 7):
        raise SystemExit(f"browser one-pass residual export requires 3 RGB channels or 7 RGB+feature-rgba channels, got {model.get('inputChannels')!r}")
    if feature_input_mode == "feature-rgba" and input_channels != 7:
        raise SystemExit(f"feature-rgba browser residual export requires 7 input channels, got {input_channels!r}")
    if feature_input_mode != "feature-rgba" and input_channels != 3:
        raise SystemExit(f"RGB browser residual export requires 3 input channels, got {input_channels!r}")
    weights_meta = artifact.get("weights") or {}
    weights_path = Path(weights_meta.get("path") or artifact_path.with_name("weights.safetensors")).resolve()
    weights = mx.load(str(weights_path))
    required = ["output.weight", "output.bias"]
    missing = [name for name in required if name not in weights]
    if missing:
        raise SystemExit(f"missing direct-residual weights: {', '.join(missing)}")
    kernel = weights["output.weight"]
    bias = weights["output.bias"]
    if tuple(kernel.shape) != (3, 3, 3, input_channels):
        raise SystemExit(f"expected output.weight shape (3, 3, 3, {input_channels}), got {tuple(kernel.shape)!r}")
    if tuple(bias.shape) != (3,):
        raise SystemExit(f"expected output.bias shape (3,), got {tuple(bias.shape)!r}")
    exported = {
        "schema": SCHEMA,
        "authority": AUTHORITY,
        "sourceModelArtifact": str(artifact_path),
        "sourceModelArtifactSha256": sha256_path(artifact_path),
        "sourceWeights": str(weights_path),
        "sourceWeightsSha256": sha256_path(weights_path),
        "modelArch": "direct-residual",
        "inputChannels": input_channels,
        "featureInputMode": feature_input_mode,
        "featureInputAuthority": model.get("featureInputAuthority") or training.get("featureInputAuthority") or (FEATURE_INPUT_AUTHORITY if feature_input_mode == "feature-rgba" else "off"),
        "featureInputChannels": int(model.get("featureInputChannels") or training.get("featureInputChannels") or max(0, input_channels - 3)),
        "outputChannels": 3,
        "kernelSize": 3,
        "weightLayout": "mlx-conv2d-out-y-x-in",
        "lowRenderScale": source.get("lowRenderScale"),
        "residualOutputLimit": first_present_float(0.0, model.get("residualOutputLimit"), training.get("residualOutputLimit")),
        "residualApplyScale": first_present_float(0.25, model.get("residualApplyScale"), training.get("residualApplyScale")),
        "residualApplicationMaskMode": model.get("residualApplicationMaskMode"),
        "residualMaskFeatherRadius": int(model.get("residualMaskFeatherRadius") or training.get("residualMaskFeatherRadius") or 0),
        "residualApplicationMaskAuthority": training.get("residualApplicationMaskAuthority"),
        "edgeBandMode": training.get("edgeBandMode"),
        "edgeBandAuthority": training.get("edgeBandAuthority"),
        "edgeBandThreshold": float(training.get("edgeBandThreshold") or 0.0),
        "edgeBandDilate": int(training.get("edgeBandDilate") or 0),
        "metricsAtSave": artifact.get("metricsAtSave") or {},
        "weights": {
            "output.weight": {
                "shape": list(kernel.shape),
                "data": as_float_list(kernel),
            },
            "output.bias": {
                "shape": list(bias.shape),
                "data": as_float_list(bias),
            },
        },
    }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(exported, indent=2) + "\n")
    print(json.dumps({
        "schema": SCHEMA,
        "authority": AUTHORITY,
        "out": str(out_path),
        "sourceModelArtifact": str(artifact_path),
        "modelArch": exported["modelArch"],
        "lowRenderScale": exported["lowRenderScale"],
    }))


if __name__ == "__main__":
    main()
