#!/usr/bin/env python3
"""Project selected heads from a checksum-bound packed selective-head model."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


SCHEMA = "kaminos.volume.selective-head-live-model.v0"
DERIVATION_IDENTITY = "bit-exact-selected-head-projection-v0"
HEAD_KEYS = ("w1", "b1", "w2", "b2", "targetMean", "targetStd")


class ProjectionFailure(Exception):
    def __init__(self, phase: str, message: str) -> None:
        super().__init__(message)
        self.phase = phase


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, phase: str, message: str) -> None:
    if not condition:
        raise ProjectionFailure(phase, message)


def atomic_write(path: Path, data: bytes) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def output_span(output: dict[str, Any], feature_count: int, hidden_width: int) -> tuple[int, int]:
    phase = "source-model-validation"
    offsets = output.get("offsets")
    require(isinstance(offsets, dict), phase, f"{output.get('channel')} offsets missing")
    require(all(isinstance(offsets.get(key), int) for key in HEAD_KEYS), phase, f"{output.get('channel')} offsets invalid")
    expected = {
        "w1": offsets["w1"],
        "b1": offsets["w1"] + feature_count * hidden_width,
        "w2": offsets["w1"] + feature_count * hidden_width + hidden_width,
        "b2": offsets["w1"] + feature_count * hidden_width + hidden_width * 2,
        "targetMean": offsets["w1"] + feature_count * hidden_width + hidden_width * 2 + 1,
        "targetStd": offsets["w1"] + feature_count * hidden_width + hidden_width * 2 + 2,
    }
    require(offsets == expected, phase, f"{output.get('channel')} tensor offsets are not contiguous dense-tanh-dense-v0")
    return offsets["w1"], offsets["targetStd"] + 1


def projected_output(output: dict[str, Any], offset: int, feature_count: int, hidden_width: int) -> dict[str, Any]:
    offsets = {
        "w1": offset,
        "b1": offset + feature_count * hidden_width,
        "w2": offset + feature_count * hidden_width + hidden_width,
        "b2": offset + feature_count * hidden_width + hidden_width * 2,
        "targetMean": offset + feature_count * hidden_width + hidden_width * 2 + 1,
        "targetStd": offset + feature_count * hidden_width + hidden_width * 2 + 2,
    }
    return {
        "channel": output["channel"],
        "kind": output["kind"],
        "offsets": offsets,
        "policy": output["policy"],
    }


def failed_manifest(
    identity: str,
    source_manifest_path: Path,
    phase: str,
    reason: str,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "identity": identity,
        "status": "failed",
        "failurePhase": phase,
        "reason": reason,
        "sourceManifestPath": str(source_manifest_path),
        "lastTrustworthyEvidence": evidence,
        "derivation": {
            "identity": DERIVATION_IDENTITY,
            "runtimeTruthAvailable": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--model-identity", required=True)
    parser.add_argument("--channels", required=True, help="comma-separated output channels to retain")
    args = parser.parse_args()

    source_manifest_path = Path(args.source_manifest).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    model_path = out_dir / "model.f32"
    module_path = out_dir / "model.generated.js"
    for stale_path in (model_path, module_path):
        stale_path.unlink(missing_ok=True)

    evidence: dict[str, Any] = {}
    phase = "source-manifest-validation"
    try:
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.model_identity) is not None, phase, "model identity must be a stable lowercase slug")
        source_manifest_bytes = source_manifest_path.read_bytes()
        source_manifest_sha256 = sha256_bytes(source_manifest_bytes)
        evidence.update({
            "sourceManifestPath": str(source_manifest_path),
            "sourceManifestSha256": source_manifest_sha256,
        })
        source_manifest = json.loads(source_manifest_bytes)
        require(source_manifest.get("schema") == SCHEMA, phase, "source manifest schema mismatch")
        require(source_manifest.get("status") == "captured" and source_manifest.get("failurePhase") is None, phase, "source model is not captured")

        phase = "source-model-validation"
        features = source_manifest.get("features") or {}
        architecture = source_manifest.get("architecture") or {}
        feature_count = int(features.get("featureCount") or 0)
        hidden_width = int(architecture.get("hiddenWidth") or 0)
        require(feature_count == 185, phase, "source feature count must preserve the full 185-feature contract")
        require(architecture.get("identity") == "dense-tanh-dense-v0", phase, "source architecture identity mismatch")
        require(architecture.get("activation") == "tanh" and hidden_width > 0, phase, "source architecture shape mismatch")

        packed = source_manifest.get("packed") or {}
        require(packed.get("dtype") == "float32-le", phase, "source packed dtype mismatch")
        packed_path_value = packed.get("path")
        require(isinstance(packed_path_value, str) and packed_path_value, phase, "source packed path missing")
        packed_path = Path(packed_path_value).expanduser()
        if not packed_path.is_absolute():
            packed_path = source_manifest_path.parent / packed_path
        packed_path = packed_path.resolve()
        packed_bytes = packed_path.read_bytes()
        packed_sha256 = sha256_bytes(packed_bytes)
        evidence.update({
            "sourcePackedPath": str(packed_path),
            "sourcePackedSha256": packed_sha256,
        })
        require(re.fullmatch(r"[0-9a-f]{64}", str(packed.get("sha256") or "")) is not None, phase, "source packed SHA-256 missing")
        require(packed_sha256 == packed["sha256"], phase, "source packed SHA-256 mismatch")
        require(len(packed_bytes) == int(packed.get("byteLength") or -1), phase, "source packed byte length mismatch")
        require(len(packed_bytes) % 4 == 0, phase, "source packed bytes are not float32 aligned")
        source_float_count = len(packed_bytes) // 4
        require(source_float_count == int(packed.get("floatCount") or -1), phase, "source packed float count mismatch")

        normalization = source_manifest.get("normalization") or {}
        feature_mean = normalization.get("featureMean") or {}
        feature_std = normalization.get("featureStd") or {}
        require(feature_mean.get("offset") == 0 and feature_mean.get("floatCount") == feature_count, phase, "featureMean descriptor mismatch")
        require(feature_std.get("offset") == feature_count and feature_std.get("floatCount") == feature_count, phase, "featureStd descriptor mismatch")
        normalization_float_count = feature_count * 2

        source_outputs = source_manifest.get("outputs")
        require(isinstance(source_outputs, list) and source_outputs, phase, "source outputs missing")
        outputs_by_channel: dict[str, dict[str, Any]] = {}
        source_spans: dict[str, tuple[int, int]] = {}
        for output in source_outputs:
            channel = output.get("channel")
            require(isinstance(channel, str) and channel not in outputs_by_channel, phase, "source output channels must be named and unique")
            require(output.get("kind") in ("classifier", "residual-head"), phase, f"{channel} output kind mismatch")
            require(isinstance(output.get("policy"), str), phase, f"{channel} policy missing")
            span = output_span(output, feature_count, hidden_width)
            require(span[0] >= normalization_float_count and span[1] <= source_float_count, phase, f"{channel} tensor span is outside packed model")
            outputs_by_channel[channel] = output
            source_spans[channel] = span

        phase = "selection-validation"
        selected_channels = [channel.strip() for channel in args.channels.split(",") if channel.strip()]
        require(bool(selected_channels), phase, "at least one output channel must be selected")
        require(len(selected_channels) == len(set(selected_channels)), phase, "selected output channels must be unique")
        for channel in selected_channels:
            require(channel in outputs_by_channel, phase, f"unknown output channel: {channel}")

        projected_parts = [packed_bytes[: normalization_float_count * 4]]
        projected_outputs: list[dict[str, Any]] = []
        offset = normalization_float_count
        for channel in selected_channels:
            source_output = outputs_by_channel[channel]
            start, end = source_spans[channel]
            projected_parts.append(packed_bytes[start * 4 : end * 4])
            output = projected_output(source_output, offset, feature_count, hidden_width)
            projected_outputs.append(output)
            offset = output["offsets"]["targetStd"] + 1
        projected_bytes = b"".join(projected_parts)
        require(len(projected_bytes) == offset * 4, "projection-write", "projected byte length disagrees with rebuilt offsets")

        source_composition = source_manifest.get("composition") or {}
        composition: dict[str, Any] = {}
        if "supportProbability" in selected_channels:
            require("supportThreshold" in source_composition, phase, "selected support classifier lacks threshold identity")
            composition["supportThreshold"] = source_composition["supportThreshold"]
            composition["supportThresholdAuthority"] = source_composition.get("supportThresholdAuthority")
        for output in projected_outputs:
            if output["kind"] == "residual-head":
                composition[output["channel"]] = source_composition.get(output["channel"], output["policy"])

        phase = "projection-write"
        projected_sha256 = sha256_bytes(projected_bytes)
        result = {
            "schema": SCHEMA,
            "identity": args.model_identity,
            "status": "captured",
            "failurePhase": None,
            "source": source_manifest.get("source"),
            "features": features,
            "architecture": architecture,
            "composition": composition,
            "packagedResidualChannels": [
                output["channel"] for output in projected_outputs if output["kind"] == "residual-head"
            ],
            "outputs": projected_outputs,
            "normalization": {
                "featureMean": {"channel": "featureMean", "offset": 0, "floatCount": feature_count, "kind": "normalization"},
                "featureStd": {"channel": "featureStd", "offset": feature_count, "floatCount": feature_count, "kind": "normalization"},
            },
            "packed": {
                "path": "model.f32",
                "dtype": "float32-le",
                "floatCount": offset,
                "byteLength": len(projected_bytes),
                "sha256": projected_sha256,
            },
            "derivation": {
                "identity": DERIVATION_IDENTITY,
                "sourceManifestPath": str(source_manifest_path),
                "sourceManifestSha256": source_manifest_sha256,
                "sourceModelIdentity": source_manifest.get("identity"),
                "sourcePackedSha256": packed_sha256,
                "selectedChannels": selected_channels,
                "normalizationBitExact": True,
                "headTensorsBitExact": True,
                "supportClassifierPackaged": "supportProbability" in selected_channels,
                "runtimeTruthAvailable": False,
            },
        }
        manifest_bytes = (json.dumps(result, indent=2) + "\n").encode("utf-8")
        module_bytes = (
            "// Generated by volume-selective-head-live-model-project.py.\n"
            f"export const SELECTIVE_HEAD_LIVE_MODEL = Object.freeze({json.dumps(result, separators=(',', ':'))});\n"
            "export const SELECTIVE_HEAD_LIVE_MODEL_URL = new URL('./model.f32', import.meta.url).href;\n"
        ).encode("ascii")
        atomic_write(model_path, projected_bytes)
        atomic_write(manifest_path, manifest_bytes)
        atomic_write(module_path, module_bytes)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_path),
            "model": str(model_path),
            "selectedChannels": selected_channels,
            "floatCount": offset,
            "byteLength": len(projected_bytes),
            "sha256": projected_sha256,
        }, indent=2))
        return 0
    except Exception as error:
        failure_phase = error.phase if isinstance(error, ProjectionFailure) else phase
        for stale_path in (model_path, module_path):
            stale_path.unlink(missing_ok=True)
        failure = failed_manifest(
            args.model_identity,
            source_manifest_path,
            failure_phase,
            str(error),
            evidence,
        )
        atomic_write(manifest_path, (json.dumps(failure, indent=2) + "\n").encode("utf-8"))
        print(json.dumps({"ok": False, "manifest": str(manifest_path), "failurePhase": failure_phase, "reason": str(error)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
