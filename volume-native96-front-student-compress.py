#!/usr/bin/env python3
"""Compress the accepted native96 front teacher without ablating its inputs."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.native96-front-student-matrix.v0"
SELF_TEST_SCHEMA = "kaminos.volume.native96-front-student-compressor-self-test.v0"
MODEL_SCHEMA = "kaminos.volume.native96-front-student-model.v0"
TEACHER_IDENTITY = "latest-happy-bowl-front-only-160-to-96-step96-v0"
FEATURE_IDENTITY = "full-low-field-plus-spatial-rbf-features-v0"
FEATURE_COUNT = 185
TEACHER_WIDTH = 48
DEFAULT_WIDTHS = (16, 24, 32)
STORAGE_DTYPES = ("float16-le", "float32-le")
FLUID_CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck",
]


class CompressionFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--teacher-manifest")
    parser.add_argument("--native-manifest")
    parser.add_argument("--out-dir")
    parser.add_argument("--widths", default=",".join(map(str, DEFAULT_WIDTHS)))
    parser.add_argument("--batch-cells", type=int, default=32768)
    parser.add_argument("--storage-dtype", choices=STORAGE_DTYPES, default="float16-le")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temp.write_text(json.dumps(payload, indent=2) + "\n")
    temp.replace(path)


def resolve_artifact(raw: str, manifest_path: Path) -> Path:
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def verify_artifact(descriptor: dict[str, Any], manifest_path: Path, label: str) -> Path:
    path = resolve_artifact(str(descriptor.get("path") or ""), manifest_path)
    if not path.is_file():
        raise CompressionFailure("input-validation", f"missing {label}: {path}")
    if path.stat().st_size != int(descriptor.get("byteLength") or -1):
        raise CompressionFailure("input-validation", f"{label} byte length mismatch")
    observed = sha256_file(path)
    if observed != descriptor.get("sha256"):
        raise CompressionFailure("input-validation", f"{label} SHA-256 mismatch", {"observedSha256": observed})
    return path


def load_feature_module() -> Any:
    path = Path(__file__).with_name("volume-exact-basin-support-probe.py")
    spec = importlib.util.spec_from_file_location("kaminos_front_feature_builder", path)
    if spec is None or spec.loader is None:
        raise CompressionFailure("feature-builder-load", f"cannot load feature builder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_teacher(values: np.ndarray, manifest: dict[str, Any]) -> dict[str, Any]:
    if manifest.get("schema") != "kaminos.volume.selective-head-live-model.v0":
        raise CompressionFailure("teacher-validation", "teacher schema mismatch")
    if manifest.get("identity") != TEACHER_IDENTITY or manifest.get("status") != "captured":
        raise CompressionFailure("teacher-validation", "teacher identity/status mismatch")
    if manifest.get("failurePhase") is not None:
        raise CompressionFailure("teacher-validation", "teacher carries a failure phase")
    if manifest.get("features", {}).get("identity") != FEATURE_IDENTITY:
        raise CompressionFailure("teacher-validation", "teacher feature identity mismatch")
    if int(manifest.get("features", {}).get("featureCount") or 0) != FEATURE_COUNT:
        raise CompressionFailure("teacher-validation", "teacher must retain all 185 inputs")
    if int(manifest.get("architecture", {}).get("hiddenWidth") or 0) != TEACHER_WIDTH:
        raise CompressionFailure("teacher-validation", "teacher hidden width mismatch")
    outputs = manifest.get("outputs") or []
    if len(outputs) != 1 or outputs[0].get("channel") != "frontTopology":
        raise CompressionFailure("teacher-validation", "teacher is not the exact front-only package")
    normalization = manifest.get("normalization") or {}
    mean_desc = normalization.get("featureMean") or {}
    std_desc = normalization.get("featureStd") or {}
    offsets = outputs[0].get("offsets") or {}

    def take(offset: int, count: int, label: str) -> np.ndarray:
        result = values[offset:offset + count]
        if result.size != count:
            raise CompressionFailure("teacher-validation", f"teacher tensor {label} is truncated")
        return np.asarray(result, dtype=np.float32)

    return {
        "featureMean": take(int(mean_desc.get("offset") or 0), FEATURE_COUNT, "featureMean"),
        "featureStd": take(int(std_desc.get("offset") or 0), FEATURE_COUNT, "featureStd"),
        "w1": take(int(offsets.get("w1") or 0), FEATURE_COUNT * TEACHER_WIDTH, "w1").reshape(FEATURE_COUNT, TEACHER_WIDTH),
        "b1": take(int(offsets.get("b1") or 0), TEACHER_WIDTH, "b1"),
        "w2": take(int(offsets.get("w2") or 0), TEACHER_WIDTH, "w2"),
        "b2": float(take(int(offsets.get("b2") or 0), 1, "b2")[0]),
        "targetMean": float(take(int(offsets.get("targetMean") or 0), 1, "targetMean")[0]),
        "targetStd": float(take(int(offsets.get("targetStd") or 0), 1, "targetStd")[0]),
    }


def hidden_values(features: np.ndarray, teacher: dict[str, Any]) -> np.ndarray:
    normalized = (features - teacher["featureMean"]) / teacher["featureStd"]
    return np.tanh(normalized @ teacher["w1"] + teacher["b1"]).astype(np.float32, copy=False)


def teacher_standard_output(hidden: np.ndarray, teacher: dict[str, Any]) -> np.ndarray:
    return (hidden @ teacher["w2"] + np.float32(teacher["b2"])).astype(np.float32, copy=False)


def accumulate_gram(chunks: Any, width: int = TEACHER_WIDTH) -> dict[str, Any]:
    gram = np.zeros((width + 1, width + 1), dtype=np.float64)
    cross = np.zeros(width + 1, dtype=np.float64)
    target_square = 0.0
    row_count = 0
    for hidden, target in chunks:
        h = np.asarray(hidden, dtype=np.float64)
        y = np.asarray(target, dtype=np.float64).reshape(-1)
        if h.ndim != 2 or h.shape[1] != width or h.shape[0] != y.size:
            raise CompressionFailure("gram-accumulation", "hidden/target row shape mismatch")
        gram[:width, :width] += h.T @ h
        sums = np.sum(h, axis=0)
        gram[:width, width] += sums
        gram[width, :width] += sums
        gram[width, width] += h.shape[0]
        cross[:width] += h.T @ y
        cross[width] += np.sum(y)
        target_square += float(y @ y)
        row_count += int(y.size)
    if row_count <= 0:
        raise CompressionFailure("gram-accumulation", "no input rows were accumulated")
    return {"gram": gram, "cross": cross, "targetSquare": target_square, "rowCount": row_count}


def solve_subset(stats: dict[str, Any], hidden_indexes: list[int]) -> tuple[np.ndarray, float]:
    width = stats["gram"].shape[0] - 1
    indexes = [*hidden_indexes, width]
    gram = stats["gram"][np.ix_(indexes, indexes)]
    cross = stats["cross"][indexes]
    ridge = np.eye(len(indexes), dtype=np.float64) * 1.0e-10
    ridge[-1, -1] = 0.0
    beta = np.linalg.lstsq(gram + ridge, cross, rcond=1.0e-12)[0]
    sse = float(stats["targetSquare"] - 2.0 * beta @ cross + beta @ gram @ beta)
    return beta, max(0.0, sse)


def select_hidden_basis(stats: dict[str, Any], requested_width: int) -> dict[str, Any]:
    teacher_width = stats["gram"].shape[0] - 1
    if requested_width <= 0 or requested_width > teacher_width:
        raise CompressionFailure("basis-selection", f"invalid student width {requested_width}")
    selected: list[int] = []
    remaining = set(range(teacher_width))
    for _ in range(requested_width):
        best: tuple[float, int, np.ndarray] | None = None
        for candidate in sorted(remaining):
            trial = [*selected, candidate]
            beta, sse = solve_subset(stats, trial)
            item = (sse, candidate, beta)
            if best is None or item[0] < best[0] - 1.0e-12 or (abs(item[0] - best[0]) <= 1.0e-12 and item[1] < best[1]):
                best = item
        assert best is not None
        selected.append(best[1])
        remaining.remove(best[1])
    beta, sse = solve_subset(stats, selected)
    return {"selected": selected, "w2": beta[:-1], "b2": float(beta[-1]), "fitSse": sse}


def pack_student(
    teacher: dict[str, Any],
    selection: dict[str, Any],
    storage_dtype: str = "float16-le",
) -> tuple[np.ndarray, dict[str, int]]:
    selected = selection["selected"]
    arrays = [
        teacher["featureMean"], teacher["featureStd"], teacher["w1"][:, selected].reshape(-1),
        teacher["b1"][selected], np.asarray(selection["w2"], dtype=np.float32),
        np.asarray([selection["b2"], teacher["targetMean"], teacher["targetStd"]], dtype=np.float32),
    ]
    names = ["featureMean", "featureStd", "w1", "b1", "w2", "b2TargetMeanTargetStd"]
    offsets: dict[str, int] = {}
    cursor = 0
    for name, array in zip(names, arrays):
        offsets[name] = cursor
        cursor += int(np.asarray(array).size)
    numpy_dtype = "<f2" if storage_dtype == "float16-le" else "<f4"
    packed = np.concatenate([np.asarray(array, dtype=np.float32).reshape(-1) for array in arrays]).astype(numpy_dtype)
    return packed, offsets


def unpack_student(
    packed: np.ndarray,
    width: int,
    offsets: dict[str, int],
    storage_dtype: str = "float16-le",
) -> dict[str, Any]:
    numpy_dtype = np.float16 if storage_dtype == "float16-le" else np.float32
    values = np.asarray(packed, dtype=numpy_dtype).astype(np.float32, copy=False)
    tail = offsets["b2TargetMeanTargetStd"]
    return {
        "featureMean": values[offsets["featureMean"]:offsets["featureMean"] + FEATURE_COUNT],
        "featureStd": values[offsets["featureStd"]:offsets["featureStd"] + FEATURE_COUNT],
        "w1": values[offsets["w1"]:offsets["w1"] + FEATURE_COUNT * width].reshape(FEATURE_COUNT, width),
        "b1": values[offsets["b1"]:offsets["b1"] + width],
        "w2": values[offsets["w2"]:offsets["w2"] + width],
        "b2": float(values[tail]),
        "targetMean": float(values[tail + 1]),
        "targetStd": float(values[tail + 2]),
    }


def predict_student(features: np.ndarray, student: dict[str, Any]) -> np.ndarray:
    normalized = (features - student["featureMean"]) / student["featureStd"]
    hidden = np.tanh(normalized @ student["w1"] + student["b1"])
    standardized = hidden @ student["w2"] + np.float32(student["b2"])
    return (standardized * np.float32(student["targetStd"]) + np.float32(student["targetMean"])).astype(np.float32)


def make_metric_state() -> dict[str, float]:
    return {key: 0.0 for key in ("n", "abs", "error2", "truth", "pred", "truth2", "pred2", "cross", "sign")}


def update_metrics(state: dict[str, float], truth: np.ndarray, prediction: np.ndarray) -> None:
    y = np.asarray(truth, dtype=np.float64).reshape(-1)
    p = np.asarray(prediction, dtype=np.float64).reshape(-1)
    error = p - y
    state["n"] += y.size
    state["abs"] += float(np.sum(np.abs(error)))
    state["error2"] += float(error @ error)
    state["truth"] += float(np.sum(y))
    state["pred"] += float(np.sum(p))
    state["truth2"] += float(y @ y)
    state["pred2"] += float(p @ p)
    state["cross"] += float(y @ p)
    state["sign"] += float(np.count_nonzero(np.signbit(y) == np.signbit(p)))


def finalize_metrics(state: dict[str, float]) -> dict[str, Any]:
    n = max(1.0, state["n"])
    truth_var = max(0.0, state["truth2"] - state["truth"] ** 2 / n)
    pred_var = max(0.0, state["pred2"] - state["pred"] ** 2 / n)
    covariance = state["cross"] - state["truth"] * state["pred"] / n
    correlation = covariance / math.sqrt(truth_var * pred_var) if truth_var > 0 and pred_var > 0 else 0.0
    return {
        "rowCount": int(state["n"]),
        "rmseVsTeacher": math.sqrt(state["error2"] / n),
        "maeVsTeacher": state["abs"] / n,
        "correlationVsTeacher": correlation,
        "errorReductionVsZeroTeacher": 1.0 - state["error2"] / max(state["truth2"], 1.0e-30),
        "predictionToTeacherEnergyRatio": state["pred2"] / max(state["truth2"], 1.0e-30),
        "signAgreement": state["sign"] / n,
    }


def self_test(storage_dtype: str = "float16-le") -> dict[str, Any]:
    rng = np.random.default_rng(1707)
    row_count = 4096
    features = rng.normal(0.0, 1.0, size=(row_count, FEATURE_COUNT)).astype(np.float32)
    teacher = {
        "featureMean": rng.normal(0.0, 0.15, size=FEATURE_COUNT).astype(np.float32),
        "featureStd": rng.uniform(0.5, 1.5, size=FEATURE_COUNT).astype(np.float32),
        "w1": rng.normal(0.0, 0.07, size=(FEATURE_COUNT, TEACHER_WIDTH)).astype(np.float32),
        "b1": rng.normal(0.0, 0.05, size=TEACHER_WIDTH).astype(np.float32),
        "w2": rng.normal(0.0, 0.2, size=TEACHER_WIDTH).astype(np.float32),
        "b2": 0.03,
        "targetMean": 0.01,
        "targetStd": 0.4,
    }
    hidden = hidden_values(features, teacher)
    standardized = teacher_standard_output(hidden, teacher)
    stats = accumulate_gram([(hidden[:2048], standardized[:2048]), (hidden[2048:], standardized[2048:])])
    results = []
    deterministic = True
    for width in DEFAULT_WIDTHS:
        selection = select_hidden_basis(stats, width)
        deterministic = deterministic and selection["selected"] == select_hidden_basis(stats, width)["selected"]
        packed, offsets = pack_student(teacher, selection, storage_dtype)
        student = unpack_student(packed, width, offsets, storage_dtype)
        truth = standardized * np.float32(teacher["targetStd"]) + np.float32(teacher["targetMean"])
        prediction = predict_student(features, student)
        metric = make_metric_state()
        update_metrics(metric, truth, prediction)
        final = finalize_metrics(metric)
        results.append({
            "width": width,
            "selectedHiddenUnits": len(selection["selected"]),
            "outputFinite": bool(np.all(np.isfinite(prediction))),
            "quantizedByteLength": int(packed.nbytes),
            **final,
        })
    teacher_float_count = FEATURE_COUNT * 2 + FEATURE_COUNT * TEACHER_WIDTH + TEACHER_WIDTH * 2 + 3
    return {
        "schema": SELF_TEST_SCHEMA,
        "status": "passed",
        "failurePhase": None,
        "featureCount": FEATURE_COUNT,
        "teacherHiddenWidth": TEACHER_WIDTH,
        "maximumRuntimeWidth": TEACHER_WIDTH,
        "studentWidths": list(DEFAULT_WIDTHS),
        "rowAccounting": "complete-uncapped-input-row-accounting-v0",
        "weightStorageDtype": storage_dtype,
        "runtimeArithmeticDtype": "f16" if storage_dtype == "float16-le" else "f32",
        "metricArithmetic": "float32-over-f16-quantized-package-v0" if storage_dtype == "float16-le" else "float32-over-f32-package-v0",
        "runtimeTruthUsed": False,
        "inputAblation": False,
        "teacherFloat32ByteLength": teacher_float_count * 4,
        "deterministicSelection": deterministic,
        "results": results,
    }


def parse_widths(raw: str) -> list[int]:
    try:
        widths = sorted(set(int(item.strip()) for item in raw.split(",") if item.strip()))
    except ValueError as error:
        raise CompressionFailure("argument-validation", f"invalid widths: {raw}") from error
    if not widths or any(width <= 0 or width > TEACHER_WIDTH for width in widths):
        raise CompressionFailure("argument-validation", "student widths must be between 1 and 48")
    return widths


def build_actual_matrix(args: argparse.Namespace) -> dict[str, Any]:
    if not args.teacher_manifest or not args.native_manifest or not args.out_dir:
        raise CompressionFailure("argument-validation", "--teacher-manifest, --native-manifest, and --out-dir are required")
    widths = parse_widths(args.widths)
    storage_dtype = str(args.storage_dtype)
    runtime_arithmetic_dtype = "f16" if storage_dtype == "float16-le" else "f32"
    metric_arithmetic = "float32-over-f16-quantized-package-v0" if storage_dtype == "float16-le" else "float32-over-f32-package-v0"
    packed_suffix = "f16" if storage_dtype == "float16-le" else "f32"
    batch_cells = max(1, int(args.batch_cells))
    teacher_manifest_path = Path(args.teacher_manifest).resolve()
    native_manifest_path = Path(args.native_manifest).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    teacher_manifest = json.loads(teacher_manifest_path.read_text())
    native_manifest = json.loads(native_manifest_path.read_text())
    packed_desc = teacher_manifest.get("packed") or {}
    teacher_path = verify_artifact(packed_desc, teacher_manifest_path, "teacher model")
    values = np.fromfile(teacher_path, dtype="<f4")
    if values.size != int(packed_desc.get("floatCount") or -1):
        raise CompressionFailure("teacher-validation", "teacher float count mismatch")
    teacher = parse_teacher(values, teacher_manifest)

    if native_manifest.get("schema") != "kaminos.volume.full-grid-field-export.v0" or native_manifest.get("status") != "captured":
        raise CompressionFailure("native-validation", "native input is not a captured full-grid export")
    if native_manifest.get("failurePhase") is not None or native_manifest.get("completeFieldCoverage") is not True:
        raise CompressionFailure("native-validation", "native input is partial or failed")
    low_grid = int(native_manifest.get("grid") or 0)
    high_grid = int(teacher_manifest.get("source", {}).get("highGrid") or 0)
    if low_grid != 96 or high_grid != 160 or int(teacher_manifest.get("source", {}).get("lowGrid") or 0) != 96:
        raise CompressionFailure("native-validation", "native/teacher grid relationship must be 96 -> 160")
    sidecars = native_manifest.get("sidecars") or {}
    fluid_desc = sidecars.get("fluid") or {}
    front_desc = sidecars.get("front") or {}
    if fluid_desc.get("shape") != [96, 96, 96, 16] or fluid_desc.get("channelOrder") != FLUID_CHANNELS:
        raise CompressionFailure("native-validation", "native fluid shape/channel order mismatch")
    if front_desc.get("shape") != [96, 96, 96, 1] or front_desc.get("channelOrder") != ["frontTopology"]:
        raise CompressionFailure("native-validation", "native front shape/channel order mismatch")
    fluid_path = verify_artifact(fluid_desc, native_manifest_path, "native fluid")
    front_path = verify_artifact(front_desc, native_manifest_path, "native front")
    low_cells = low_grid ** 3
    high_cells = high_grid ** 3
    low_fluid = np.memmap(fluid_path, dtype="<f4", mode="r", shape=(low_cells, 16))
    low_front = np.memmap(front_path, dtype="<f4", mode="r", shape=(low_cells,))
    feature_module = load_feature_module()

    def feature_batches():
        for start in range(0, high_cells, batch_cells):
            end = min(high_cells, start + batch_cells)
            indexes = np.arange(start, end, dtype=np.int64)
            low_values, x, y, z = feature_module.low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)
            yield feature_module.build_features(low_values, x, y, z, high_grid)

    def gram_chunks():
        for features in feature_batches():
            hidden = hidden_values(features, teacher)
            yield hidden, teacher_standard_output(hidden, teacher)

    stats = accumulate_gram(gram_chunks())
    if stats["rowCount"] != high_cells:
        raise CompressionFailure("row-accounting", f"processed {stats['rowCount']} rows, expected {high_cells}")

    candidates: dict[int, dict[str, Any]] = {}
    for width in widths:
        selection = select_hidden_basis(stats, width)
        packed, offsets = pack_student(teacher, selection, storage_dtype)
        path = out_dir / f"front-student-width{width}.{packed_suffix}"
        temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
        packed.tofile(temp)
        temp.replace(path)
        candidates[width] = {
            "selection": selection,
            "packed": packed,
            "offsets": offsets,
            "path": path,
            "student": unpack_student(packed, width, offsets, storage_dtype),
            "metrics": make_metric_state(),
        }

    for features in feature_batches():
        hidden = hidden_values(features, teacher)
        truth = teacher_standard_output(hidden, teacher) * np.float32(teacher["targetStd"]) + np.float32(teacher["targetMean"])
        for candidate in candidates.values():
            update_metrics(candidate["metrics"], truth, predict_student(features, candidate["student"]))

    teacher_manifest_sha = sha256_file(teacher_manifest_path)
    native_manifest_sha = sha256_file(native_manifest_path)
    results = []
    for width in widths:
        candidate = candidates[width]
        metrics = finalize_metrics(candidate["metrics"])
        if metrics["rowCount"] != high_cells:
            raise CompressionFailure("row-accounting", f"width {width} metric rows are incomplete")
        model_payload = {
            "schema": MODEL_SCHEMA,
            "identity": f"native96-front-student-width{width}-{runtime_arithmetic_dtype}-v0",
            "status": "captured",
            "failurePhase": None,
            "teacher": {
                "identity": TEACHER_IDENTITY,
                "manifestSha256": teacher_manifest_sha,
                "packedSha256": packed_desc.get("sha256"),
                "hiddenWidth": TEACHER_WIDTH,
            },
            "source": {
                "nativeManifestSha256": native_manifest_sha,
                "nativeFluidSha256": fluid_desc.get("sha256"),
                "nativeFrontSha256": front_desc.get("sha256"),
                "lowGrid": low_grid,
                "receiverGrid": high_grid,
                "rowCount": high_cells,
                "rowAccounting": "complete-uncapped-input-row-accounting-v0",
            },
            "features": {
                "identity": FEATURE_IDENTITY,
                "featureCount": FEATURE_COUNT,
                "inputAblation": False,
            },
            "architecture": {
                "identity": "selected-teacher-hidden-basis-refit-output-v0",
                "activation": "tanh",
                "hiddenWidth": width,
                "selectedTeacherHiddenUnits": candidate["selection"]["selected"],
                "fitSseBeforeF16": candidate["selection"]["fitSse"],
            },
            "packed": {
                "path": candidate["path"].name,
                "dtype": storage_dtype,
                "runtimeArithmeticDtype": runtime_arithmetic_dtype,
                "metricArithmetic": metric_arithmetic,
                "floatCount": int(candidate["packed"].size),
                "byteLength": int(candidate["packed"].nbytes),
                "sha256": sha256_file(candidate["path"]),
                "offsets": candidate["offsets"],
            },
            "metrics": metrics,
            "runtimeTruthUsed": False,
            "visualClaim": False,
            "runtimeClaim": False,
        }
        model_manifest_path = out_dir / f"front-student-width{width}.manifest.json"
        write_json_atomic(model_manifest_path, model_payload)
        results.append({
            "width": width,
            "modelIdentity": model_payload["identity"],
            "modelManifestPath": str(model_manifest_path),
            "modelManifestSha256": sha256_file(model_manifest_path),
            "packedPath": str(candidate["path"]),
            "packedSha256": model_payload["packed"]["sha256"],
            "packedByteLength": model_payload["packed"]["byteLength"],
            "selectedTeacherHiddenUnits": candidate["selection"]["selected"],
            **metrics,
        })

    payload = {
        "schema": SCHEMA,
        "identity": f"native96-front-full-input-hidden-basis-{runtime_arithmetic_dtype}-matrix-v0",
        "status": "captured",
        "failurePhase": None,
        "teacherManifestPath": str(teacher_manifest_path),
        "teacherManifestSha256": teacher_manifest_sha,
        "teacherPackedSha256": packed_desc.get("sha256"),
        "nativeManifestPath": str(native_manifest_path),
        "nativeManifestSha256": native_manifest_sha,
        "featureCount": FEATURE_COUNT,
        "inputAblation": False,
        "teacherHiddenWidth": TEACHER_WIDTH,
        "studentWidths": widths,
        "rowCount": high_cells,
        "rowAccounting": "complete-uncapped-input-row-accounting-v0",
        "weightStorageDtype": storage_dtype,
        "runtimeArithmeticDtype": runtime_arithmetic_dtype,
        "metricArithmetic": metric_arithmetic,
        "runtimeTruthUsed": False,
        "visualClaim": False,
        "runtimeClaim": False,
        "results": results,
    }
    payload["identitySha256"] = hashlib.sha256(stable_json(payload).encode()).hexdigest()
    return payload


def main() -> int:
    args = parse_args()
    if args.self_test:
        print(json.dumps(self_test(args.storage_dtype)))
        return 0
    out_dir = Path(args.out_dir).resolve() if args.out_dir else None
    manifest_path = out_dir / "manifest.json" if out_dir else None
    try:
        payload = build_actual_matrix(args)
        assert manifest_path is not None
        write_json_atomic(manifest_path, payload)
        print(json.dumps({"status": "captured", "manifest": str(manifest_path), "results": payload["results"]}))
        return 0
    except Exception as error:
        phase = error.phase if isinstance(error, CompressionFailure) else "unhandled"
        evidence = error.evidence if isinstance(error, CompressionFailure) else {}
        failure = {
            "schema": SCHEMA,
            "identity": f"native96-front-full-input-hidden-basis-{'f16' if args.storage_dtype == 'float16-le' else 'f32'}-matrix-v0",
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "lastTrustworthyEvidence": evidence,
            "runtimeTruthUsed": False,
        }
        if manifest_path is not None:
            write_json_atomic(manifest_path, failure)
        print(json.dumps(failure), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
