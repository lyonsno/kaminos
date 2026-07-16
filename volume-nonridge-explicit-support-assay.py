#!/usr/bin/env python3
"""Search a small explicit Non-Ridge support rule over checksum-bound full grids."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Iterable

import numpy as np


SCHEMA = "kaminos.volume.nonridge-explicit-support-assay.v0"
IDENTITY = "deterministic-source-field-nonridge-selector-search-v0"
CORPUS_SCHEMA = "kaminos.volume.nonridge-source-basis-corpus.v0"
TARGET_ORDER = [
    "candidate.nonRidgeMembership",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
]
RIDGE_INPUTS = [
    "sidecar.ridge",
    "sidecar.coverage",
    "fire.energy",
    "fire.emission",
    "fire.detail",
    "micro.z",
    "material.heat",
]
OPTICAL_EPSILON = 1e-6
RIDGE_THRESHOLD = 0.11
HISTOGRAM_BINS = 256


class AssayError(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


@dataclass
class VerifiedArtifact:
    path: Path
    handle: BinaryIO
    expected_sha256: str
    shape: tuple[int, int]
    initial_stat: os.stat_result
    semantic_role: str
    array: np.memmap

    def close(self) -> None:
        mmap = getattr(self.array, "_mmap", None)
        if mmap is not None:
            mmap.close()
        self.handle.close()


@dataclass
class OpenSetting:
    manifest: dict[str, Any]
    source_complete: VerifiedArtifact
    targets: VerifiedArtifact

    @property
    def source(self) -> np.memmap:
        return self.source_complete.array

    @property
    def target(self) -> np.memmap:
        return self.targets.array

    def close(self) -> None:
        self.source_complete.close()
        self.targets.close()


@dataclass(frozen=True)
class CandidateDefinition:
    name: str
    expression: str
    inputs: tuple[str, ...]
    controls: tuple[str, ...] = ()


AUTHORED_BOUNDARY_CONTROLS = (
    "support.thermal", "support.reaction", "support.front", "support.interface",
    "boundary.gradientGain", "boundary.cut", "boundary.softness",
    "boundary.coreRejection", "topology.gain", "curl.gain", "divergence.gain",
)


CANDIDATES = [
    CandidateDefinition(
        "authored.gradient-gated-fire.signal",
        "step(1e-6,boundary.gradientGain)*fire.signal",
        ("fire.energy", "fire.emission", "fire.detail", "micro.z", "material.heat"),
        ("boundary.gradientGain",),
    ),
    CandidateDefinition(
        "authored.boundary.raw",
        "boundarySupport*gradientGate*coreGate*topology",
        (
            "material.density", "material.heat", "material.fuel", "material.detail",
            "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
            "micro.x", "micro.y", "micro.z", "micro.w", "front.topology",
            "velocity.x", "velocity.y", "velocity.z", "flow.curlMagnitude", "flow.divergence",
        ),
        AUTHORED_BOUNDARY_CONTROLS,
    ),
    CandidateDefinition("material.heat", "clamp(material.heat,0,1)", ("material.heat",)),
    CandidateDefinition("fire.energy", "clamp(fire.energy,0,1)", ("fire.energy",)),
    CandidateDefinition("fire.emission", "clamp(fire.emission,0,1)", ("fire.emission",)),
    CandidateDefinition("fire.detail", "clamp(fire.detail,0,1)", ("fire.detail",)),
    CandidateDefinition("micro.z", "clamp(micro.z,0,1)", ("micro.z",)),
    CandidateDefinition("front.topology", "clamp(front.topology,0,1)", ("front.topology",)),
    CandidateDefinition("support.reaction", "clamp(support.reaction,0,1)", ("support.reaction",)),
    CandidateDefinition(
        "support.interface.inverse",
        "1-clamp(support.interface,0,1)",
        ("support.interface",),
    ),
    CandidateDefinition(
        "flow.curlMagnitude",
        "clamp(flow.curlMagnitude,0,1)",
        ("flow.curlMagnitude",),
    ),
    CandidateDefinition(
        "flow.divergence.abs",
        "clamp(abs(flow.divergence)/0.5,0,1)",
        ("flow.divergence",),
    ),
    CandidateDefinition(
        "velocity.magnitude",
        "clamp(length(velocity.xyz)/0.6,0,1)",
        ("velocity.x", "velocity.y", "velocity.z"),
    ),
    CandidateDefinition(
        "fire.signal",
        "clamp((1.25*fire.energy+0.52*fire.emission+0.86*fire.detail+0.72*micro.z+0.24*material.heat)/1.5,0,1)",
        ("fire.energy", "fire.emission", "fire.detail", "micro.z", "material.heat"),
    ),
    CandidateDefinition(
        "reaction-front.max",
        "max(clamp(support.reaction,0,1),clamp(front.topology,0,1))",
        ("support.reaction", "front.topology"),
    ),
    CandidateDefinition(
        "reaction-front-flow.max",
        "max(reaction,front,curl,abs(divergence)/0.5)",
        ("support.reaction", "front.topology", "flow.curlMagnitude", "flow.divergence"),
    ),
    CandidateDefinition(
        "body-reaction-front-flow.max",
        "max(fire.signal,reaction,front,curl,abs(divergence)/0.5)",
        (
            "fire.energy", "fire.emission", "fire.detail", "micro.z", "material.heat",
            "support.reaction", "front.topology", "flow.curlMagnitude", "flow.divergence",
        ),
    ),
    CandidateDefinition(
        "reaction-front-neighbor.max",
        "max(center_and_6_neighbors(support.reaction),center_and_6_neighbors(front.topology))",
        ("support.reaction", "front.topology"),
    ),
    CandidateDefinition(
        "reaction-front-neighbor-gradient.max",
        "clamp(2*max(central_gradient(support.reaction),central_gradient(front.topology)),0,1)",
        ("support.reaction", "front.topology"),
    ),
]


class AssayArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise AssayError("arguments", message)


def parse_args(arguments: list[str]) -> argparse.Namespace:
    parser = AssayArgumentParser(description=__doc__)
    parser.add_argument("--corpus-manifest", required=True)
    parser.add_argument("--corpus-manifest-sha256", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--calibration-setting")
    return parser.parse_args(arguments)


def output_dir_hint(arguments: list[str]) -> Path | None:
    for index, argument in enumerate(arguments):
        if argument.startswith("--out-dir="):
            value = argument.partition("=")[2]
            return Path(value).resolve() if value else None
        if argument == "--out-dir" and index + 1 < len(arguments) and not arguments[index + 1].startswith("--"):
            return Path(arguments[index + 1]).resolve()
    return None


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def prepare_output(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in ("assay-manifest.json", "selector-recipe.json", "failure-report.json"):
        path = out_dir / name
        if path.exists():
            path.unlink()


def fail(out_dir: Path | None, error: Exception, corpus_path: Path | None = None) -> None:
    if out_dir is None:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in ("assay-manifest.json", "selector-recipe.json"):
        stale = out_dir / name
        if stale.exists():
            stale.unlink()
    if isinstance(error, AssayError):
        phase = error.phase
        evidence = error.evidence
    else:
        phase = "unhandled-exception"
        evidence = {}
    write_json(out_dir / "failure-report.json", {
        "schema": "kaminos.volume.nonridge-explicit-support-assay-failure.v0",
        "status": "failed",
        "failurePhase": phase,
        "message": str(error),
        "corpusManifest": str(corpus_path) if corpus_path else None,
        "lastTrustworthyEvidence": evidence,
    })


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_handle(handle: BinaryIO) -> str:
    offset = handle.tell()
    handle.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
        digest.update(chunk)
    handle.seek(offset)
    return digest.hexdigest()


def open_verified_artifact(
    descriptor: dict[str, Any], expected_shape: tuple[int, int], role: str,
) -> VerifiedArtifact:
    phase = "artifact-contract"
    if descriptor.get("dtype") != "float32-le":
        raise AssayError(phase, f"{role} must be float32-le")
    if tuple(descriptor.get("shape", [])) != expected_shape:
        raise AssayError(phase, f"{role} shape mismatch", {
            "expected": list(expected_shape), "actual": descriptor.get("shape"),
        })
    expected_bytes = math.prod(expected_shape) * 4
    if descriptor.get("bytes") != expected_bytes:
        raise AssayError(phase, f"{role} byte count mismatch")
    expected_sha = descriptor.get("sha256")
    if not isinstance(expected_sha, str) or len(expected_sha) != 64:
        raise AssayError(phase, f"{role} lacks a SHA-256 identity")
    path = Path(descriptor.get("path", "")).resolve()
    if not path.is_file():
        raise AssayError(phase, f"{role} artifact is missing", {"path": str(path)})
    try:
        handle = path.open("rb", buffering=0)
    except OSError as error:
        raise AssayError(phase, f"cannot open {role}: {error}", {"path": str(path)}) from error
    try:
        initial_stat = os.fstat(handle.fileno())
        if initial_stat.st_size != expected_bytes:
            raise AssayError(phase, f"{role} file size mismatch")
        actual_sha = sha256_handle(handle)
        if actual_sha != expected_sha:
            raise AssayError("artifact-checksum", f"{role} checksum mismatch", {
                "path": str(path), "expectedSha256": expected_sha, "actualSha256": actual_sha,
            })
        array = np.memmap(handle, dtype="<f4", mode="r", shape=expected_shape)
        return VerifiedArtifact(
            path=path, handle=handle, expected_sha256=expected_sha, shape=expected_shape,
            initial_stat=initial_stat, semantic_role=str(descriptor.get("semanticRole") or ""), array=array,
        )
    except Exception:
        handle.close()
        raise


def verify_artifact_post_consumption(artifact: VerifiedArtifact, role: str) -> None:
    final_stat = os.fstat(artifact.handle.fileno())
    actual_sha = sha256_handle(artifact.handle)
    changed = any((
        final_stat.st_dev != artifact.initial_stat.st_dev,
        final_stat.st_ino != artifact.initial_stat.st_ino,
        final_stat.st_size != artifact.initial_stat.st_size,
        final_stat.st_mtime_ns != artifact.initial_stat.st_mtime_ns,
        final_stat.st_ctime_ns != artifact.initial_stat.st_ctime_ns,
    ))
    if changed or actual_sha != artifact.expected_sha256:
        raise AssayError("artifact-post-consumption", f"{role} changed during consumption", {
            "path": str(artifact.path), "expectedSha256": artifact.expected_sha256,
            "actualSha256": actual_sha, "expectedBytes": artifact.initial_stat.st_size,
            "actualBytes": final_stat.st_size,
        })


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def split_ids(value: Any, label: str) -> list[str]:
    if isinstance(value, list):
        ids = value
    elif isinstance(value, dict):
        ids = value.get("settingIds")
    else:
        ids = None
    if not isinstance(ids, list) or not ids or not all(isinstance(item, str) and item for item in ids):
        raise AssayError("split-contract", f"{label} must name one or more settings")
    if len(ids) != len(set(ids)):
        raise AssayError("split-contract", f"{label} contains duplicate settings")
    return ids


def resolve_splits(
    corpus: dict[str, Any], settings_by_id: dict[str, dict[str, Any]], calibration_setting: str | None,
) -> dict[str, list[str]]:
    splits = corpus.get("splits")
    if not isinstance(splits, dict):
        raise AssayError("split-contract", "corpus splits are missing")
    if splits.get("identity") != "whole-effective-control-setting-holdout-v0":
        raise AssayError("split-contract", "production whole-effective-control split identity is required")
    train = split_ids(splits.get("train"), "train")
    held = split_ids(splits.get("heldOut"), "heldOut")
    if set(train) & set(held) or set(train + held) != set(settings_by_id):
        raise AssayError("split-contract", "train and heldOut must partition every setting exactly once")
    effective_identities = [str(setting.get("effectiveControlIdentity") or "") for setting in settings_by_id.values()]
    if any(not value for value in effective_identities) or len(effective_identities) != len(set(effective_identities)):
        raise AssayError("split-contract", "effective-control identities must be nonempty and globally unique")
    for role, role_ids in (("train", train), ("heldOut", held)):
        split_value = splits.get(role) or {}
        declared = list(split_value.get("effectiveControlIdentities") or [])
        expected = [str(settings_by_id[setting_id]["effectiveControlIdentity"]) for setting_id in role_ids]
        if len(declared) != len(set(declared)) or set(declared) != set(expected):
            raise AssayError("split-contract", "split effective-control identities do not match settings", {
                "role": role, "declared": declared, "expected": expected,
            })
        contradictory = [
            setting_id for setting_id in role_ids
            if settings_by_id[setting_id].get("splitRole") != role
        ]
        if contradictory:
            raise AssayError("split-contract", "setting-local splitRole contradicts split cohort", {
                "role": role, "settingIds": contradictory,
            })
    eligible = sorted(
        setting_id for setting_id in train
        if not bool((settings_by_id[setting_id].get("targetSummary") or {}).get("allTargetsZero"))
    )
    if not eligible:
        raise AssayError("calibration-selection", "train split has no nonblack calibration setting")
    selected_calibration = eligible[-1]
    if calibration_setting != selected_calibration:
        raise AssayError("calibration-selection", "caller calibration assertion disagrees with deterministic corpus rule", {
            "asserted": calibration_setting, "selected": selected_calibration,
            "selection": "lexical-last-nonblack-train-setting-v0",
        })
    calibration = [selected_calibration]
    fit = [setting_id for setting_id in train if setting_id != selected_calibration]
    if not fit:
        raise AssayError("split-contract", "calibration removal leaves no fit settings")
    roles = {"fit": fit, "calibration": calibration, "heldOut": held}
    flattened = [setting_id for ids in roles.values() for setting_id in ids]
    if len(flattened) != len(set(flattened)):
        raise AssayError("split-contract", "effective split roles overlap")
    return roles


def validate_and_open(corpus: dict[str, Any], calibration_setting: str | None) -> tuple[dict[str, OpenSetting], list[str], dict[str, list[str]]]:
    if corpus.get("schema") != CORPUS_SCHEMA:
        raise AssayError("corpus-contract", "unsupported corpus schema")
    if corpus.get("status") != "complete" or corpus.get("failurePhase") is not None:
        raise AssayError("corpus-status", "corpus is not complete and failure-free", {
            "status": corpus.get("status"), "failurePhase": corpus.get("failurePhase"),
        })
    cohort = corpus.get("cohort")
    if not isinstance(cohort, dict) or (
        cohort.get("retentionPolicy") != "retain-all-admitted-settings-and-rows-uncapped-v0"
        or cohort.get("sampleCap") is not None or cohort.get("droppedRowCount") != 0
    ):
        raise AssayError("corpus-retention", "selector assay requires an uncapped zero-drop full-grid corpus")
    feature_views = corpus.get("featureViews")
    if not isinstance(feature_views, dict) or not isinstance(feature_views.get("sourceComplete"), dict):
        raise AssayError("corpus-contract", "sourceComplete feature view is missing")
    feature_order = feature_views["sourceComplete"].get("order")
    if not isinstance(feature_order, list) or len(feature_order) != len(set(feature_order)):
        raise AssayError("corpus-contract", "sourceComplete feature order is invalid")
    current_view = feature_views.get("current16") or {}
    complete_view = feature_views["sourceComplete"]
    if (
        current_view.get("identity") != "live-boundary-candidate-current16-v0"
        or complete_view.get("identity") != "current16-plus-independent-source-evidence-v0"
        or current_view.get("includesTargets") is not False
        or current_view.get("includesControls") is not False
        or complete_view.get("includesTargets") is not False
        or complete_view.get("includesControls") is not False
        or feature_order[: len(current_view.get("order") or [])] != (current_view.get("order") or [])
    ):
        raise AssayError("feature-view-contract", "production source-complete feature identity and leakage boundaries are required")
    required = set(RIDGE_INPUTS)
    for definition in CANDIDATES:
        required.update(definition.inputs)
    missing = sorted(required - set(feature_order))
    if missing:
        raise AssayError("source-basis-contract", "sourceComplete view lacks required selector fields", {"missing": missing})
    targets = corpus.get("targets")
    if not isinstance(targets, dict) or targets.get("order") != TARGET_ORDER or targets.get("semanticRole") != "supervision-only":
        raise AssayError("target-contract", "target order does not preserve membership and optical coefficients")
    if targets.get("membershipTeacherLeakageIntoFeatures") is not False:
        raise AssayError("target-contract", "corpus does not explicitly reject membership teacher leakage")
    settings_value = corpus.get("settings")
    if not isinstance(settings_value, list) or not settings_value:
        raise AssayError("corpus-contract", "corpus settings are missing")
    settings_by_id: dict[str, dict[str, Any]] = {}
    for setting in settings_value:
        setting_id = setting.get("id") if isinstance(setting, dict) else None
        if not isinstance(setting_id, str) or not setting_id or setting_id in settings_by_id:
            raise AssayError("corpus-contract", "setting ids must be unique nonempty strings")
        settings_by_id[setting_id] = setting
    if cohort.get("retainedSettingCount") != len(settings_by_id):
        raise AssayError("corpus-retention", "retained setting count does not match settings")
    declared_rows = sum(int((setting.get("rows") or {}).get("count", -1)) for setting in settings_by_id.values())
    if cohort.get("totalRows") != declared_rows:
        raise AssayError("corpus-retention", "declared total rows do not match settings")
    roles = resolve_splits(corpus, settings_by_id, calibration_setting)
    effective_ids = {setting_id for ids in roles.values() for setting_id in ids}
    if effective_ids != set(settings_by_id):
        raise AssayError("split-contract", "effective split settings do not exactly cover the corpus", {
            "missing": sorted(set(settings_by_id) - effective_ids),
            "unexpected": sorted(effective_ids - set(settings_by_id)),
        })
    opened: dict[str, OpenSetting] = {}
    try:
        for setting_id, setting in settings_by_id.items():
            source = setting.get("source")
            rows = setting.get("rows")
            if not isinstance(source, dict) or not isinstance(rows, dict):
                raise AssayError("corpus-contract", f"{setting_id} lacks source or rows")
            effective_controls = setting.get("effectiveControls")
            if not isinstance(effective_controls, dict):
                raise AssayError("control-identity", f"{setting_id} lacks canonical effective controls")
            missing_controls = sorted(set(AUTHORED_BOUNDARY_CONTROLS) - set(effective_controls))
            if missing_controls:
                raise AssayError("control-identity", f"{setting_id} lacks authored boundary controls", {
                    "missing": missing_controls,
                })
            controls_hash = sha256_bytes(canonical_json(effective_controls))
            if source.get("controlsHash") != controls_hash or setting.get("effectiveControlIdentity") != f"sha256:{controls_hash}":
                raise AssayError("control-identity", f"{setting_id} effective controls do not match identity")
            shape = source.get("gridShape")
            if not isinstance(shape, list) or len(shape) != 3 or not all(isinstance(v, int) and v > 0 for v in shape):
                raise AssayError("spatial-contract", f"{setting_id} gridShape is invalid")
            spacing = source.get("gridSpacing")
            if (
                not isinstance(spacing, list) or len(spacing) != 3
                or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in spacing)
            ):
                raise AssayError("spatial-contract", f"{setting_id} gridSpacing is invalid")
            if source.get("gridAxisOrder") != "x-fastest-y-then-z-v0":
                raise AssayError("spatial-contract", f"{setting_id} axis order is not x-fastest")
            row_count = rows.get("count")
            if row_count != math.prod(shape):
                raise AssayError("spatial-contract", f"{setting_id} row count does not match gridShape")
            source_descriptor = rows.get("sourceComplete", {})
            target_descriptor = rows.get("targets", {})
            if source_descriptor.get("semanticRole") != "candidate-features-source-complete":
                raise AssayError("artifact-contract", f"{setting_id}.sourceComplete semantic role is invalid")
            if target_descriptor.get("semanticRole") != "supervision-targets-positive-nonridge":
                raise AssayError("artifact-contract", f"{setting_id}.targets semantic role is invalid")
            source_artifact = open_verified_artifact(
                source_descriptor, (row_count, len(feature_order)), f"{setting_id}.sourceComplete",
            )
            try:
                target_artifact = open_verified_artifact(
                    target_descriptor, (row_count, len(TARGET_ORDER)), f"{setting_id}.targets",
                )
            except Exception:
                source_artifact.close()
                raise
            opened[setting_id] = OpenSetting(setting, source_artifact, target_artifact)
            source_values = np.asarray(source_artifact.array)
            target_values = np.asarray(target_artifact.array)
            if not np.all(np.isfinite(source_values)) or not np.all(np.isfinite(target_values)):
                raise AssayError("artifact-finite", f"{setting_id} contains nonfinite values")
            membership = target_values[:, 0]
            optical = target_values[:, 1:5]
            if np.any(membership < 0) or np.any(membership > 1) or np.any(optical < 0):
                raise AssayError("target-domain", f"{setting_id} target values are outside their domain")
            actual_summary = {
                "positiveMembershipRows": int(np.count_nonzero(membership > 0)),
                "negativeMembershipRows": int(np.count_nonzero(membership <= 0)),
                "positiveOpticalRows": int(np.count_nonzero(np.any(optical > 0, axis=1))),
                "allTargetsZero": bool(np.count_nonzero(target_values) == 0),
            }
            declared_summary = setting.get("targetSummary") or {}
            if any(declared_summary.get(key) != value for key, value in actual_summary.items()):
                raise AssayError("target-summary", f"{setting_id} target summary does not match authenticated bytes", {
                    "declared": declared_summary, "actual": actual_summary,
                })
            is_negative = setting.get("negativeControl") is True
            expected_predicate = "all-targets-zero-v0" if is_negative else None
            if setting.get("negativeControlPredicate") != expected_predicate or is_negative != actual_summary["allTargetsZero"]:
                raise AssayError("negative-control", f"{setting_id} negative-control identity contradicts target bytes")
        negative_count = sum(setting.get("negativeControl") is True for setting in settings_by_id.values())
        if cohort.get("negativeControlSettingCount") != negative_count:
            raise AssayError("negative-control", "cohort negative-control count does not match settings")
        actual_by_id = {
            setting_id: setting.manifest["targetSummary"] for setting_id, setting in opened.items()
        }
        splits = corpus["splits"]
        for role in ("train", "heldOut"):
            role_ids = split_ids(splits.get(role), role)
            actual = {
                key: sum(int(actual_by_id[setting_id][key]) for setting_id in role_ids)
                for key in ("positiveMembershipRows", "negativeMembershipRows", "positiveOpticalRows")
            }
            declared = (splits.get("targetCoverage") or {}).get(role)
            if not isinstance(declared, dict) or any(declared.get(key) != value for key, value in actual.items()):
                raise AssayError("target-summary", f"{role} target coverage does not match authenticated bytes", {
                    "declared": declared, "actual": actual,
                })
        return opened, feature_order, roles
    except Exception:
        for setting in opened.values():
            setting.close()
        raise


def smoothstep(lo: float, hi: float, values: np.ndarray) -> np.ndarray:
    t = np.clip((values - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def ridge_structural_signal(source: np.ndarray, indices: dict[str, int]) -> np.ndarray:
    fire_signal = (
        source[:, indices["fire.energy"]] * 1.25
        + source[:, indices["fire.emission"]] * 0.52
        + source[:, indices["fire.detail"]] * 0.86
        + source[:, indices["micro.z"]] * 0.72
        + source[:, indices["material.heat"]] * 0.24
    )
    return (
        source[:, indices["sidecar.ridge"]]
        * smoothstep(0.055, 0.32, source[:, indices["sidecar.coverage"]])
        * smoothstep(0.018, 0.16, fire_signal)
    )


def neighbor_max(values: np.ndarray, shape_xyz: list[int]) -> np.ndarray:
    x_size, y_size, z_size = shape_xyz
    grid = np.asarray(values, dtype=np.float32).reshape((z_size, y_size, x_size))
    padded = np.pad(grid, 1, mode="edge")
    result = padded[1:-1, 1:-1, 1:-1].copy()
    for shifted in (
        padded[1:-1, 1:-1, 2:], padded[1:-1, 1:-1, :-2],
        padded[1:-1, 2:, 1:-1], padded[1:-1, :-2, 1:-1],
        padded[2:, 1:-1, 1:-1], padded[:-2, 1:-1, 1:-1],
    ):
        np.maximum(result, shifted, out=result)
    return result.reshape(-1)


def central_gradient(values: np.ndarray, shape_xyz: list[int]) -> np.ndarray:
    x_size, y_size, z_size = shape_xyz
    grid = np.asarray(values, dtype=np.float32).reshape((z_size, y_size, x_size))
    padded = np.pad(grid, 1, mode="edge")
    dx = (padded[1:-1, 1:-1, 2:] - padded[1:-1, 1:-1, :-2]) * 0.5
    dy = (padded[1:-1, 2:, 1:-1] - padded[1:-1, :-2, 1:-1]) * 0.5
    dz = (padded[2:, 1:-1, 1:-1] - padded[:-2, 1:-1, 1:-1]) * 0.5
    return np.sqrt(dx * dx + dy * dy + dz * dz).reshape(-1)


def world_central_gradient(
    values: np.ndarray, shape_xyz: list[int], spacing_xyz: list[float],
) -> np.ndarray:
    x_size, y_size, z_size = shape_xyz
    if len(spacing_xyz) != 3 or any(not math.isfinite(value) or value <= 0 for value in spacing_xyz):
        raise AssayError("spatial-contract", "grid spacing must contain three positive finite values")
    grid = np.asarray(values, dtype=np.float32).reshape((z_size, y_size, x_size))
    padded = np.pad(grid, 1, mode="edge")
    dx = (padded[1:-1, 1:-1, 2:] - padded[1:-1, 1:-1, :-2]) * (0.5 / spacing_xyz[0])
    dy = (padded[1:-1, 2:, 1:-1] - padded[1:-1, :-2, 1:-1]) * (0.5 / spacing_xyz[1])
    dz = (padded[2:, 1:-1, 1:-1] - padded[:-2, 1:-1, 1:-1]) * (0.5 / spacing_xyz[2])
    return np.sqrt(dx * dx + dy * dy + dz * dz).reshape(-1)


def authored_boundary_raw(
    source: np.ndarray,
    indices: dict[str, int],
    shape_xyz: list[int],
    spacing_xyz: list[float],
    controls: dict[str, float],
) -> np.ndarray:
    """CPU mirror of the live boundary carrier before display shaping and erosion."""
    column = lambda feature: np.asarray(source[:, indices[feature]], dtype=np.float32)
    velocity_magnitude = np.sqrt(
        column("velocity.x") ** 2 + column("velocity.y") ** 2 + column("velocity.z") ** 2
    )
    heat = column("material.heat")
    fuel = column("material.fuel")
    flame = column("fire.energy")
    ember = column("fire.temperature")
    flame_detail = column("fire.emission")
    combustion_front = column("fire.detail")
    micro_smoke = column("micro.x")
    interface_shred = column("micro.y")
    fire_lick = column("micro.z")
    material_detail = column("micro.w")
    raw_temperature = np.clip(
        flame * 1.22 + ember * 0.46 + flame_detail * 0.40 + fire_lick * 1.18
        + material_detail * 0.48 + heat * 0.20 + velocity_magnitude * 0.30,
        0.0, 2.4,
    )
    thermal = smoothstep(0.018, 0.62, raw_temperature + flame * 0.16 + heat * 0.24 + ember * 0.12)
    reaction = smoothstep(
        0.004, 0.30,
        flame_detail * 0.72 + fire_lick * 0.44 + combustion_front * 0.34 + fuel * heat * 0.28,
    )
    front = smoothstep(
        0.001, 0.088,
        column("front.topology") * 1.08 + combustion_front * 0.54 + fire_lick * 0.12,
    )
    interface = smoothstep(
        0.004, 0.24,
        interface_shred * 0.58 + micro_smoke * 0.18
        + column("material.density") * 0.08 + column("material.detail") * 0.06,
    )
    weights = np.asarray([
        controls["support.thermal"], controls["support.reaction"],
        controls["support.front"], controls["support.interface"],
    ], dtype=np.float32)
    support = np.clip(
        (thermal * weights[0] + reaction * weights[1] + front * weights[2] + interface * weights[3])
        / max(0.001, float(np.sum(weights))),
        0.0, 1.35,
    )
    gradient = world_central_gradient(support, shape_xyz, spacing_xyz)
    gradient_gate = smoothstep(
        float(controls["boundary.cut"]),
        float(controls["boundary.cut"] + controls["boundary.softness"]),
        gradient * float(controls["boundary.gradientGain"]),
    )
    curl_activity = smoothstep(0.006, 0.16, np.clip(column("flow.curlMagnitude"), 0.0, None))
    edge = smoothstep(
        0.004, 0.24,
        interface_shred * 0.58 + micro_smoke * 0.18
        + column("material.density") * 0.08 + curl_activity * 0.42,
    )
    div_support = smoothstep(0.010, 0.18, np.abs(column("flow.divergence"))) * smoothstep(
        0.010, 0.46, raw_temperature + heat * 0.18 + flame_detail * 0.32,
    )
    shell_core_body = smoothstep(
        0.26, 1.18,
        raw_temperature * 0.54 + flame_detail * 0.44 + heat * 0.12 + ember * 0.12,
    ) * (1.0 - np.clip(front * 0.54 + edge * 0.30 + curl_activity * 0.12, 0.0, 0.86))
    core_gate = np.clip(
        1.0 - shell_core_body * float(controls["boundary.coreRejection"]), 0.0, 1.0,
    )
    topology = np.clip(
        1.0
        + float(controls["topology.gain"]) * (edge * 0.50 + front * 0.24)
        + float(controls["curl.gain"]) * curl_activity
        + float(controls["divergence.gain"]) * div_support,
        0.0, 3.5,
    )
    return np.clip(support * gradient_gate * core_gate * topology, 0.0, 2.0)


def candidate_values(setting: OpenSetting, definition: CandidateDefinition, indices: dict[str, int]) -> np.ndarray:
    source = setting.source
    name = definition.name
    column = lambda feature: np.asarray(source[:, indices[feature]], dtype=np.float32)
    if name == "authored.boundary.raw":
        return authored_boundary_raw(
            source,
            indices,
            setting.manifest["source"]["gridShape"],
            setting.manifest["source"]["gridSpacing"],
            setting.manifest["effectiveControls"],
        )
    if name in {"material.heat", "fire.energy", "fire.emission", "fire.detail", "micro.z", "front.topology", "support.reaction", "flow.curlMagnitude"}:
        return np.clip(column(name), 0.0, 1.0)
    if name == "support.interface.inverse":
        return 1.0 - np.clip(column("support.interface"), 0.0, 1.0)
    if name == "flow.divergence.abs":
        return np.clip(np.abs(column("flow.divergence")) / 0.5, 0.0, 1.0)
    if name == "velocity.magnitude":
        magnitude = np.sqrt(column("velocity.x") ** 2 + column("velocity.y") ** 2 + column("velocity.z") ** 2)
        return np.clip(magnitude / 0.6, 0.0, 1.0)
    fire_signal = np.clip((
        column("fire.energy") * 1.25
        + column("fire.emission") * 0.52
        + column("fire.detail") * 0.86
        + column("micro.z") * 0.72
        + column("material.heat") * 0.24
    ) / 1.5, 0.0, 1.0)
    if name == "authored.gradient-gated-fire.signal":
        enabled = float(setting.manifest["effectiveControls"]["boundary.gradientGain"]) >= 1e-6
        return fire_signal if enabled else np.zeros_like(fire_signal)
    reaction = np.clip(column("support.reaction"), 0.0, 1.0)
    front = np.clip(column("front.topology"), 0.0, 1.0)
    if name == "fire.signal":
        return fire_signal
    if name == "reaction-front.max":
        return np.maximum(reaction, front)
    flow = np.maximum(
        np.clip(column("flow.curlMagnitude"), 0.0, 1.0),
        np.clip(np.abs(column("flow.divergence")) / 0.5, 0.0, 1.0),
    )
    if name == "reaction-front-flow.max":
        return np.maximum(np.maximum(reaction, front), flow)
    if name == "body-reaction-front-flow.max":
        return np.maximum(np.maximum(np.maximum(reaction, front), flow), fire_signal)
    shape = setting.manifest["source"]["gridShape"]
    if name == "reaction-front-neighbor.max":
        return np.maximum(neighbor_max(reaction, shape), neighbor_max(front, shape))
    if name == "reaction-front-neighbor-gradient.max":
        return np.clip(2.0 * np.maximum(central_gradient(reaction, shape), central_gradient(front, shape)), 0.0, 1.0)
    raise AssayError("candidate-evaluation", f"unknown candidate formula {name}")


def truth_masks(setting: OpenSetting, indices: dict[str, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    target = np.asarray(setting.target)
    membership = target[:, 0] > 0.0
    optical = np.max(target[:, 1:5], axis=1) > OPTICAL_EPSILON
    ridge_signal = ridge_structural_signal(setting.source, indices)
    ridge_admitted = ridge_signal >= RIDGE_THRESHOLD
    hard_positive = optical & ~ridge_admitted
    return membership, optical, ridge_admitted, hard_positive


def empty_counts() -> dict[str, int]:
    return {
        "rows": 0, "positive": 0, "negative": 0, "selected": 0,
        "truePositive": 0, "falsePositive": 0, "falseNegative": 0, "trueNegative": 0,
        "hardPositive": 0, "hardSelected": 0, "fullFlamePositive": 0, "ridgeAdmitted": 0,
    }


def add_counts(total: dict[str, int], update: dict[str, int]) -> None:
    for key in total:
        total[key] += update[key]


def setting_counts(setting: OpenSetting, values: np.ndarray, threshold: float, indices: dict[str, int]) -> dict[str, int]:
    membership, optical, ridge_admitted, hard = truth_masks(setting, indices)
    selected = values >= threshold
    return {
        "rows": int(values.size),
        "positive": int(np.count_nonzero(membership)),
        "negative": int(np.count_nonzero(~membership)),
        "selected": int(np.count_nonzero(selected)),
        "truePositive": int(np.count_nonzero(selected & membership)),
        "falsePositive": int(np.count_nonzero(selected & ~membership)),
        "falseNegative": int(np.count_nonzero(~selected & membership)),
        "trueNegative": int(np.count_nonzero(~selected & ~membership)),
        "hardPositive": int(np.count_nonzero(hard)),
        "hardSelected": int(np.count_nonzero(selected & hard)),
        "fullFlamePositive": int(np.count_nonzero(optical)),
        "ridgeAdmitted": int(np.count_nonzero(ridge_admitted)),
    }


def source_populated_rows(setting: OpenSetting, indices: dict[str, int]) -> int:
    source = setting.source
    fire_signal = (
        source[:, indices["fire.energy"]] * 1.25
        + source[:, indices["fire.emission"]] * 0.52
        + source[:, indices["fire.detail"]] * 0.86
        + source[:, indices["micro.z"]] * 0.72
        + source[:, indices["material.heat"]] * 0.24
    )
    return int(np.count_nonzero(fire_signal >= 0.018))


def ratio(numerator: int, denominator: int) -> float:
    return float(numerator / denominator) if denominator else 0.0


def public_metrics(counts: dict[str, int]) -> dict[str, Any]:
    precision = ratio(counts["truePositive"], counts["truePositive"] + counts["falsePositive"])
    recall = ratio(counts["truePositive"], counts["positive"])
    f1 = ratio(2.0 * precision * recall, precision + recall)
    fpr = ratio(counts["falsePositive"], counts["negative"])
    hard_recall = ratio(counts["hardSelected"], counts["hardPositive"])
    return {
        "rowsEvaluated": counts["rows"],
        "rowsDropped": 0,
        "wholeGrid": {
            "positiveRows": counts["positive"],
            "negativeRows": counts["negative"],
            "admittedRows": counts["selected"],
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "falsePositiveRate": fpr,
        },
        "hardPositive": {
            "identity": "positive-full-flame-optical-and-production-ridge-rejected-v0",
            "rows": counts["hardPositive"],
            "admittedRows": counts["hardSelected"],
            "recall": hard_recall,
        },
        "fullFlamePositiveRows": counts["fullFlamePositive"],
        "ridgeAdmittedRows": counts["ridgeAdmitted"],
    }


def objective(counts: dict[str, int]) -> float:
    metrics = public_metrics(counts)
    whole = metrics["wholeGrid"]
    hard = metrics["hardPositive"]
    specificity = 1.0 - whole["falsePositiveRate"]
    return (
        hard["recall"] * 0.45
        + whole["recall"] * 0.25
        + whole["precision"] * 0.25
        + specificity * 0.05
    )


def histogram_counts(
    settings: Iterable[OpenSetting],
    definition: CandidateDefinition,
    indices: dict[str, int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, int]]:
    positive_hist = np.zeros(HISTOGRAM_BINS, dtype=np.int64)
    negative_hist = np.zeros(HISTOGRAM_BINS, dtype=np.int64)
    hard_hist = np.zeros(HISTOGRAM_BINS, dtype=np.int64)
    full_hist = np.zeros(HISTOGRAM_BINS, dtype=np.int64)
    totals = empty_counts()
    for setting in settings:
        values = candidate_values(setting, definition, indices)
        membership, optical, ridge_admitted, hard = truth_masks(setting, indices)
        bins = np.minimum((values * (HISTOGRAM_BINS - 1)).astype(np.int32), HISTOGRAM_BINS - 1)
        positive_hist += np.bincount(bins[membership], minlength=HISTOGRAM_BINS)
        negative_hist += np.bincount(bins[~membership], minlength=HISTOGRAM_BINS)
        hard_hist += np.bincount(bins[hard], minlength=HISTOGRAM_BINS)
        full_hist += np.bincount(bins[optical], minlength=HISTOGRAM_BINS)
        totals["rows"] += values.size
        totals["positive"] += int(np.count_nonzero(membership))
        totals["negative"] += int(np.count_nonzero(~membership))
        totals["hardPositive"] += int(np.count_nonzero(hard))
        totals["fullFlamePositive"] += int(np.count_nonzero(optical))
        totals["ridgeAdmitted"] += int(np.count_nonzero(ridge_admitted))
    return positive_hist, negative_hist, hard_hist, full_hist, totals


def best_fit_threshold(
    settings: Iterable[OpenSetting],
    definition: CandidateDefinition,
    indices: dict[str, int],
) -> tuple[float, dict[str, int], float]:
    positive_hist, negative_hist, hard_hist, _, totals = histogram_counts(settings, definition, indices)
    positive_selected = np.cumsum(positive_hist[::-1])[::-1]
    negative_selected = np.cumsum(negative_hist[::-1])[::-1]
    hard_selected = np.cumsum(hard_hist[::-1])[::-1]
    best: tuple[float, float, dict[str, int]] | None = None
    for threshold_bin in range(1, HISTOGRAM_BINS - 1):
        counts = dict(totals)
        counts["truePositive"] = int(positive_selected[threshold_bin])
        counts["falsePositive"] = int(negative_selected[threshold_bin])
        counts["selected"] = counts["truePositive"] + counts["falsePositive"]
        counts["falseNegative"] = counts["positive"] - counts["truePositive"]
        counts["trueNegative"] = counts["negative"] - counts["falsePositive"]
        counts["hardSelected"] = int(hard_selected[threshold_bin])
        score = objective(counts)
        threshold = threshold_bin / (HISTOGRAM_BINS - 1)
        candidate = (score, threshold, counts)
        if best is None or candidate[0] > best[0] + 1e-12 or (
            abs(candidate[0] - best[0]) <= 1e-12 and candidate[1] > best[1]
        ):
            best = candidate
    assert best is not None
    return best[1], best[2], best[0]


def evaluate_settings(
    settings: Iterable[OpenSetting],
    definition: CandidateDefinition,
    threshold: float,
    indices: dict[str, int],
) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
    total = empty_counts()
    per_setting: dict[str, dict[str, int]] = {}
    for setting in settings:
        values = candidate_values(setting, definition, indices)
        counts = setting_counts(setting, values, threshold, indices)
        add_counts(total, counts)
        per_setting[setting.manifest["id"]] = counts
    return total, per_setting


def verify_post_consumption(opened: dict[str, OpenSetting]) -> None:
    for setting_id, setting in opened.items():
        for role, artifact in (("sourceComplete", setting.source_complete), ("targets", setting.targets)):
            verify_artifact_post_consumption(artifact, f"{setting_id}.{role}")


def implementation_provenance() -> dict[str, Any]:
    script = Path(__file__).resolve()
    root = script.parent
    result = subprocess.run(
        ["git", "status", "--porcelain", "--", script.name],
        cwd=root, check=False, capture_output=True, text=True,
    )
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, check=False, capture_output=True, text=True,
    )
    return {
        "script": script.name,
        "scriptLocator": "repository-relative-v0",
        "scriptSha256": sha256_file(script),
        "gitCommit": commit.stdout.strip() if commit.returncode == 0 else None,
        "scriptDirty": bool(result.stdout.strip()) if result.returncode == 0 else None,
    }


def main() -> int:
    arguments = sys.argv[1:]
    out_dir = output_dir_hint(arguments)
    corpus_path: Path | None = None
    opened: dict[str, OpenSetting] = {}
    started = time.monotonic()
    try:
        args = parse_args(arguments)
        out_dir = Path(args.out_dir).resolve()
        corpus_path = Path(args.corpus_manifest).resolve()
        prepare_output(out_dir)
        manifest_bytes = corpus_path.read_bytes()
        actual_manifest_sha = sha256_bytes(manifest_bytes)
        if actual_manifest_sha != args.corpus_manifest_sha256:
            raise AssayError("corpus-manifest-checksum", "corpus manifest checksum mismatch", {
                "path": str(corpus_path),
                "expectedSha256": args.corpus_manifest_sha256,
                "actualSha256": actual_manifest_sha,
            })
        try:
            corpus = json.loads(manifest_bytes)
        except json.JSONDecodeError as error:
            raise AssayError("corpus-manifest-parse", str(error), {
                "actualSha256": actual_manifest_sha,
            }) from error
        opened, feature_order, roles = validate_and_open(corpus, args.calibration_setting)
        indices = {feature: index for index, feature in enumerate(feature_order)}
        fit_settings = [opened[setting_id] for setting_id in roles["fit"]]
        calibration_settings = [opened[setting_id] for setting_id in roles["calibration"]]
        held_settings = [opened[setting_id] for setting_id in roles["heldOut"]]
        negative_control_settings = [
            setting for setting in opened.values()
            if setting.manifest.get("negativeControl") is True
        ]

        candidates: list[dict[str, Any]] = []
        for definition in CANDIDATES:
            threshold, fit_counts, fit_score = best_fit_threshold(fit_settings, definition, indices)
            calibration_counts, _ = evaluate_settings(calibration_settings, definition, threshold, indices)
            negative_control_counts, _ = evaluate_settings(
                negative_control_settings, definition, threshold, indices,
            )
            candidates.append({
                "definition": definition,
                "threshold": threshold,
                "fitCounts": fit_counts,
                "fitScore": fit_score,
                "calibrationCounts": calibration_counts,
                "calibrationScore": objective(calibration_counts),
                "negativeControlCounts": negative_control_counts,
            })
        candidates.sort(key=lambda item: (
            item["negativeControlCounts"]["selected"] != 0,
            ratio(item["negativeControlCounts"]["selected"], item["negativeControlCounts"]["rows"]),
            -item["calibrationScore"],
            -item["fitScore"],
            item["definition"].name,
        ))
        selected = candidates[0]
        definition: CandidateDefinition = selected["definition"]
        threshold = selected["threshold"]
        fit_counts, fit_per_setting = evaluate_settings(fit_settings, definition, threshold, indices)
        calibration_counts, calibration_per_setting = evaluate_settings(calibration_settings, definition, threshold, indices)
        held_counts, held_per_setting = evaluate_settings(held_settings, definition, threshold, indices)
        verify_post_consumption(opened)

        half_width = 1.0 / (HISTOGRAM_BINS - 1)
        low = max(0.0, threshold - half_width)
        high = min(1.0, threshold + half_width)
        selector = {
            "authority": "explicit-source-field-operator-v0",
            "kind": "bounded-monotone-rule-v0",
            "scoreExpression": "max(weight_i*smoothstep(low_i,high_i,term_i))",
            "admissionThreshold": 0.5,
            "terms": [{
                "feature": definition.name,
                "expression": definition.expression,
                "inputs": list(definition.inputs),
                "controls": list(definition.controls),
                "low": low,
                "high": high,
                "weight": 1.0,
                "direction": "increasing",
            }],
            "nonRidgeLayerIdentity": "authored-nonridge-support-coefficient-layer-v0",
            "ridgeLayerIdentity": "authored-ridge-support-coefficient-layer-v0",
            "compositionIdentity": "separate-ridge-nonridge-shared-total-extinction-v0",
            "compositionLaw": "sigma_total=sigma_ridge+sigma_nonridge",
            "ownershipSeparation": {
                "ridge": "sigma_ridge=sigma_complete*ridgeOwnershipWeight",
                "nonRidge": "sigma_nonridge=sigma_complete*(1-ridgeOwnershipWeight)",
                "sharedTransport": "sigma_total=sigma_ridge+sigma_nonridge",
            },
        }
        recipe_path = out_dir / "selector-recipe.json"
        write_json(recipe_path, selector)
        negative_controls = {
            setting_id: {
                "rows": counts["rows"],
                "admittedRows": counts["selected"],
                "admittedFraction": ratio(counts["selected"], counts["rows"]),
                "sourcePopulatedRows": source_populated_rows(opened[setting_id], indices),
            }
            for per_role in (fit_per_setting, calibration_per_setting, held_per_setting)
            for setting_id, counts in per_role.items()
            if opened[setting_id].manifest.get("negativeControl") is True
        }
        rows_evaluated = sum(setting.source_complete.shape[0] for setting in opened.values())
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "complete",
            "authority": "deterministic-selector-source-closure-assay-only-v0",
            "source": {
                "corpusManifest": corpus_path.name,
                "corpusManifestLocator": "external-basename-plus-sha256-v0",
                "corpusManifestSha256": actual_manifest_sha,
                "corpusIdentity": corpus.get("identity"),
                "sampleCap": corpus["cohort"]["sampleCap"],
                "rowsEvaluated": rows_evaluated,
                "rowsDropped": 0,
                "effectiveSplits": roles,
                "featureOrder": feature_order,
                "artifactsPostConsumptionVerified": True,
            },
            "ridgeAdmission": {
                "identity": "production-direct-flame-candidate-structural-signal-v0",
                "inputs": RIDGE_INPUTS,
                "expression": "sidecar.ridge*smoothstep(0.055,0.32,sidecar.coverage)*smoothstep(0.018,0.16,fireSignal)",
                "fireSignal": "1.25*fire.energy+0.52*fire.emission+0.86*fire.detail+0.72*micro.z+0.24*material.heat",
                "threshold": RIDGE_THRESHOLD,
            },
            "hardPositive": {
                "identity": "positive-full-flame-optical-and-production-ridge-rejected-v0",
                "opticalEpsilon": OPTICAL_EPSILON,
                "predicate": "max(nonRidge.emission.rgb,nonRidge.extinction)>epsilon && ridgeStructuralSignal<0.11",
                "note": "When Ridge rejects, the positive Non-Ridge optical remainder equals Complete Flame optical support.",
            },
            "authoredControlLaw": {
                "identity": "reaction-boundary-live-controls-v0",
                "sourceFunction": "boundarySupportFromSlots/liveBoundarySupportAt",
                "gradientSpace": "world-grid-spacing-scaled-central-difference-v0",
                "controls": list(AUTHORED_BOUNDARY_CONTROLS),
                "preDisplayExpression": "boundarySupport*gradientGate*coreGate*topology",
            },
            "candidateBasis": [definition.name for definition in CANDIDATES],
            "candidateBasisDefinitions": [
                {
                    "name": item.name, "expression": item.expression,
                    "inputs": list(item.inputs), "controls": list(item.controls),
                }
                for item in CANDIDATES
            ],
            "search": {
                "identity": "black-control-veto-then-fixed-256-bin-formula-threshold-search-v0",
                "histogramBins": HISTOGRAM_BINS,
                "formulaCount": len(CANDIDATES),
                "discoveryRole": "fit",
                "selectionRole": "calibration",
                "selectionCriteria": [
                    "zero-negative-control-admissions-first",
                    "minimum-negative-control-admitted-fraction",
                    "maximum-calibration-objective",
                    "maximum-fit-objective",
                    "lexical-formula-name-tiebreak",
                ],
                "ranking": [{
                    "feature": item["definition"].name,
                    "threshold": item["threshold"],
                    "fitObjective": item["fitScore"],
                    "calibrationObjective": item["calibrationScore"],
                    "negativeControl": public_metrics(item["negativeControlCounts"]),
                    "fit": public_metrics(item["fitCounts"]),
                    "calibration": public_metrics(item["calibrationCounts"]),
                } for item in candidates],
            },
            "selector": selector,
            "selectorRecipe": {
                "path": recipe_path.name,
                "sha256": sha256_file(recipe_path),
            },
            "metrics": {
                "fit": public_metrics(fit_counts),
                "calibration": public_metrics(calibration_counts),
                "heldOut": public_metrics(held_counts),
                "negativeControls": negative_controls,
                "perSetting": {
                    "fit": {key: public_metrics(value) for key, value in fit_per_setting.items()},
                    "calibration": {key: public_metrics(value) for key, value in calibration_per_setting.items()},
                    "heldOut": {key: public_metrics(value) for key, value in held_per_setting.items()},
                },
            },
            "implementation": implementation_provenance(),
            "runtimeSeconds": time.monotonic() - started,
            "failurePhase": None,
        }
        write_json(out_dir / "assay-manifest.json", report)
        print(json.dumps({
            "status": "complete",
            "assayManifest": str(out_dir / "assay-manifest.json"),
            "selector": definition.name,
            "threshold": threshold,
            "heldHardPositiveRecall": report["metrics"]["heldOut"]["hardPositive"]["recall"],
            "heldPrecision": report["metrics"]["heldOut"]["wholeGrid"]["precision"],
        }, sort_keys=True))
        return 0
    except Exception as error:
        fail(out_dir, error, corpus_path)
        print(f"error: {error}", file=sys.stderr)
        return 1
    finally:
        for setting in opened.values():
            setting.close()


if __name__ == "__main__":
    sys.exit(main())
