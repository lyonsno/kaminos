#!/usr/bin/env python3
"""Export learned scalar activity cues for the browser receiver harness."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.learned-scalar-activity-cue.v0"
IDENTITY = "learned-diagnostic-rgb-norm-scalar-activity-cue-v0"
TRUTH_CUE_IDENTITY = "truth-oracle-diagnostic-rgb-norm-scalar-activity-cue-v0"
LOW_CUE_IDENTITY = "low-derived-diagnostic-rgb-norm-scalar-activity-cue-v0"
CUE_NORMALIZATION_IDENTITY = "diagnostic-rgb-norm-quantile-normalized-scalar-activity-v0"
DOWNSAMPLE_IDENTITY = "max-diagnostic-norm-per-receiver-cell-v0"

_CTX_PATH = Path(__file__).with_name("volume-full-grid-diagnostic-rgb-context-ablation.py")
_CTX_SPEC = importlib.util.spec_from_file_location("volume_full_grid_diagnostic_rgb_context_ablation", _CTX_PATH)
if _CTX_SPEC is None or _CTX_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_CTX_PATH}")
_CTX = importlib.util.module_from_spec(_CTX_SPEC)
_CTX_SPEC.loader.exec_module(_CTX)

_APPLY = _CTX._APPLY
_CHANNEL = _CTX._CHANNEL


class LearnedCueFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True, help="Full-grid low/high field-pair manifest.")
    parser.add_argument("--out-dir", required=True, help="Output directory for cue payloads and manifest.")
    parser.add_argument("--receiver-grid", type=int, default=96, help="Cue grid to feed to the receiver.")
    parser.add_argument("--source-prediction-regime", default=_CTX.LOCAL_GEOMETRY_IDENTITY, choices=[
        _CTX.SAME_CELL_IDENTITY,
        _CTX.LOCAL_GEOMETRY_IDENTITY,
        _CTX.GLOBAL_SUMMARY_IDENTITY,
    ])
    parser.add_argument("--train-samples", type=int, default=60_000)
    parser.add_argument("--test-samples", type=int, default=35_000)
    parser.add_argument("--support-sample-fraction", type=float, default=0.55)
    parser.add_argument("--support-scan-samples", type=int, default=120_000)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=55)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--predict-batch-size", type=int, default=196_608)
    parser.add_argument("--activity-quantile", type=float, default=0.995)
    parser.add_argument("--activity-floor", type=float, default=0.0)
    parser.add_argument("--activity-gamma", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=9719)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_failure(path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    payload = {
        "schema": SCHEMA,
        "status": "failed",
        "identity": IDENTITY,
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, LearnedCueFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(path, payload)


def writeFloat32Cue(path: Path, values: np.ndarray) -> dict[str, Any]:
    cue = np.asarray(values, dtype="<f4")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(cue.tobytes(order="C"))
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "byteLength": int(path.stat().st_size),
        "dtype": "float32le",
        "valueCount": int(cue.size),
        "min": float(np.min(cue)) if cue.size else 0.0,
        "mean": float(np.mean(cue, dtype=np.float64)) if cue.size else 0.0,
        "p95": float(np.quantile(cue.astype(np.float64), 0.95)) if cue.size else 0.0,
        "p99": float(np.quantile(cue.astype(np.float64), 0.99)) if cue.size else 0.0,
        "max": float(np.max(cue)) if cue.size else 0.0,
        "nonzeroFraction": float(np.count_nonzero(cue > np.float32(1.0e-6)) / max(1, cue.size)),
    }


def receiver_indexes_for_high(indexes: np.ndarray, high_grid: int, receiver_grid: int) -> np.ndarray:
    x = indexes % high_grid
    y = (indexes // high_grid) % high_grid
    z = indexes // (high_grid * high_grid)
    ratio = receiver_grid / high_grid
    rx = np.minimum(receiver_grid - 1, np.floor(x * ratio).astype(np.int64))
    ry = np.minimum(receiver_grid - 1, np.floor(y * ratio).astype(np.int64))
    rz = np.minimum(receiver_grid - 1, np.floor(z * ratio).astype(np.int64))
    return rx + ry * receiver_grid + rz * receiver_grid * receiver_grid


def aggregate_max(target: np.ndarray, receiver_indexes: np.ndarray, values: np.ndarray) -> None:
    np.maximum.at(target, receiver_indexes, values.astype(np.float32, copy=False))


def normalize_activity(raw: np.ndarray, scale: float, floor: float, gamma: float) -> np.ndarray:
    denom = max(float(scale) - float(floor), 1.0e-6)
    cue = np.clip((raw.astype(np.float32) - np.float32(floor)) / np.float32(denom), 0.0, 1.0)
    if abs(float(gamma) - 1.0) > 1.0e-6:
        cue = np.power(cue.astype(np.float32), np.float32(gamma)).astype(np.float32)
    return cue.astype(np.float32, copy=False)


def cue_metrics(candidate: np.ndarray, truth: np.ndarray, low: np.ndarray) -> dict[str, Any]:
    threshold = max(1.0e-5, float(np.quantile(truth.astype(np.float64), 0.90)) * 0.35)
    truth_mask = truth > np.float32(threshold)
    cand_mask = candidate > np.float32(threshold)
    intersection = int(np.count_nonzero(truth_mask & cand_mask))
    union = int(np.count_nonzero(truth_mask | cand_mask))
    cand_count = int(np.count_nonzero(cand_mask))
    truth_count = int(np.count_nonzero(truth_mask))
    outside = ~truth_mask
    err = candidate.astype(np.float64) - truth.astype(np.float64)
    low_err = low.astype(np.float64) - truth.astype(np.float64)
    return {
        "truthSupportThreshold": threshold,
        "truthSupportCount": truth_count,
        "candidateSupportCount": cand_count,
        "supportPrecision": float(intersection / max(1, cand_count)),
        "supportRecall": float(intersection / max(1, truth_count)),
        "supportJaccard": float(intersection / max(1, union)),
        "rmse": float(math.sqrt(float(np.mean(err * err)))),
        "mae": float(np.mean(np.abs(err))),
        "rmseReductionVsLowCue": float((math.sqrt(float(np.mean(low_err * low_err))) - math.sqrt(float(np.mean(err * err)))) / max(math.sqrt(float(np.mean(low_err * low_err))), 1.0e-12)),
        "outsideTruthMass": float(np.sum(candidate[outside], dtype=np.float64)),
        "outsideTruthMassVsLow": float(np.sum(candidate[outside], dtype=np.float64) / max(float(np.sum(low[outside], dtype=np.float64)), 1.0e-12)),
        "pearsonCorrelation": pearson(candidate, truth),
    }


def pearson(a: np.ndarray, b: np.ndarray) -> float:
    av = a.astype(np.float64)
    bv = b.astype(np.float64)
    ac = av - float(np.mean(av))
    bc = bv - float(np.mean(bv))
    denom = math.sqrt(float(np.sum(ac * ac)) * float(np.sum(bc * bc)))
    return float(np.sum(ac * bc) / denom) if denom > 1.0e-12 else 0.0


def cue_projection_image(cue: np.ndarray, grid: int) -> np.ndarray:
    volume = cue.reshape(grid, grid, grid)
    projection = np.max(volume, axis=0)
    gray = np.asarray(np.round(np.clip(projection[::-1, :], 0.0, 1.0) * 255.0), dtype=np.uint8)
    return np.repeat(gray[:, :, None], 3, axis=2)


def write_cue_sheet(out_dir: Path, receiver_grid: int, rows: list[tuple[str, np.ndarray]]) -> dict[str, Any]:
    label_height = 28
    gap = 6
    width = receiver_grid
    height = label_height + len(rows) * receiver_grid + max(0, len(rows) - 1) * gap
    sheet = np.zeros((height, width, 3), dtype=np.uint8)
    labels = [_CTX.draw_label(sheet, f"receiver={receiver_grid}", 8, 8, scale=2)]
    offset_y = label_height
    for label, cue in rows:
        sheet[offset_y:offset_y + receiver_grid, :, :] = cue_projection_image(cue, receiver_grid)
        labels.append(_CTX.draw_label(sheet, label, 8, offset_y + 8, scale=2))
        offset_y += receiver_grid + gap
    path = out_dir / "scalar-activity-cue-sheet.png"
    _CTX.write_png_rgb(path, sheet)
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "projection": "max cue value along z",
        "visibleRasterLabels": {
            "identity": "burned-contact-sheet-labels-v0",
            "labels": labels,
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    evidence: dict[str, Any] = {"args": vars(args)}
    try:
        pair_path = Path(args.pair_manifest).resolve()
        pair = read_json(pair_path)
        low_grid = int(pair["lowGrid"])
        high_grid = int(pair["highGrid"])
        receiver_grid = int(args.receiver_grid)
        if receiver_grid <= 0:
            raise LearnedCueFailure("argument-parse", "receiver grid must be positive", {"receiverGrid": receiver_grid})
        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        receiver_cells = receiver_grid ** 3
        low_fluid_path = _CTX.verify_sidecar_descriptor(pair["low"]["fluid"])
        low_front_path = _CTX.verify_sidecar_descriptor(pair["low"]["front"])
        high_fluid_path = _CTX.verify_sidecar_descriptor(pair["high"]["fluid"])
        high_front_path = _CTX.verify_sidecar_descriptor(pair["high"]["front"])
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, len(_CTX.FLUID_CHANNELS)))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, len(_CTX.FLUID_CHANNELS)))
        _high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))
        evidence.update({
            "pairManifest": str(pair_path),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "receiverGrid": receiver_grid,
            "sourcePredictionRegime": args.source_prediction_regime,
        })

        rng = np.random.default_rng(int(args.seed))
        support_scan = _CTX.mixed_sample_indexes(high_cells, min(high_cells, max(int(args.support_scan_samples), int(args.train_samples))), np.array([], dtype=np.int64), 0.0, rng)
        support_truth, support_target_diagnostics = _CTX.derived_flow_debug_rgb(high_fluid, support_scan, high_grid)
        support_norm = np.linalg.norm(support_truth.astype(np.float64), axis=1)
        support_threshold = max(1.0e-5, float(np.quantile(support_norm, 0.90)) * 0.35)
        support = support_scan[np.flatnonzero(support_norm > support_threshold)]
        train_indexes = _CTX.mixed_sample_indexes(high_cells, int(args.train_samples), support, float(args.support_sample_fraction), rng)
        test_indexes = _CTX.mixed_sample_indexes(high_cells, int(args.test_samples), support, float(args.support_sample_fraction), rng, train_indexes)
        low_train_cells = _CTX.low_cell_indexes_for_high(train_indexes, low_grid, high_grid)
        low_test_cells = _CTX.low_cell_indexes_for_high(test_indexes, low_grid, high_grid)
        train_truth_rgb, train_target_diagnostics = _CTX.derived_flow_debug_rgb(high_fluid, train_indexes, high_grid)
        test_truth_rgb, test_target_diagnostics = _CTX.derived_flow_debug_rgb(high_fluid, test_indexes, high_grid)
        train_low_rgb, _ = _CTX.derived_flow_debug_rgb(low_fluid, low_train_cells, low_grid)
        test_low_rgb, _ = _CTX.derived_flow_debug_rgb(low_fluid, low_test_cells, low_grid)
        low_train_values, x_train, y_train, z_train = _APPLY.low_values_for_high_cells(low_fluid, low_front, train_indexes, low_grid, high_grid)
        low_test_values, x_test, y_test, z_test = _APPLY.low_values_for_high_cells(low_fluid, low_front, test_indexes, low_grid, high_grid)
        train_base = _APPLY.build_features(low_train_values, x_train, y_train, z_train, high_grid)
        test_base = _APPLY.build_features(low_test_values, x_test, y_test, z_test, high_grid)
        global_context, global_summary_manifest = _CTX.global_basin_summary_features(low_fluid, low_front, low_grid)
        train_features = _CTX.build_regime_features(args.source_prediction_regime, train_base, low_fluid, low_front, train_indexes, low_grid, high_grid, global_context)
        test_features = _CTX.build_regime_features(args.source_prediction_regime, test_base, low_fluid, low_front, test_indexes, low_grid, high_grid, global_context)
        prediction, states, standardization, component_reports = _CTX.train_regime(
            args.source_prediction_regime,
            args,
            train_features,
            test_features,
            train_low_rgb,
            test_low_rgb,
            train_truth_rgb,
            test_truth_rgb,
        )
        test_prediction_metrics = _CTX.vector_metrics(prediction, test_truth_rgb)
        test_low_metrics = _CTX.vector_metrics(test_low_rgb, test_truth_rgb)

        raw_truth = np.zeros(receiver_cells, dtype=np.float32)
        raw_low = np.zeros(receiver_cells, dtype=np.float32)
        raw_predicted = np.zeros(receiver_cells, dtype=np.float32)
        batch_size = max(1, int(args.predict_batch_size))
        for start in range(0, high_cells, batch_size):
            stop = min(high_cells, start + batch_size)
            indexes = np.arange(start, stop, dtype=np.int64)
            receiver_indexes = receiver_indexes_for_high(indexes, high_grid, receiver_grid)
            low_cells_for_batch = _CTX.low_cell_indexes_for_high(indexes, low_grid, high_grid)
            truth_rgb, _ = _CTX.derived_flow_debug_rgb(high_fluid, indexes, high_grid)
            low_rgb, _ = _CTX.derived_flow_debug_rgb(low_fluid, low_cells_for_batch, low_grid)
            low_values, bx, by, bz = _APPLY.low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)
            base = _APPLY.build_features(low_values, bx, by, bz, high_grid)
            features = _CTX.build_regime_features(args.source_prediction_regime, base, low_fluid, low_front, indexes, low_grid, high_grid, global_context)
            predicted_rgb = _CTX.predict_regime(features, low_rgb, states, standardization)
            aggregate_max(raw_truth, receiver_indexes, np.linalg.norm(truth_rgb.astype(np.float32), axis=1))
            aggregate_max(raw_low, receiver_indexes, np.linalg.norm(low_rgb.astype(np.float32), axis=1))
            aggregate_max(raw_predicted, receiver_indexes, np.linalg.norm(predicted_rgb.astype(np.float32), axis=1))

        quantile = max(0.0, min(1.0, float(args.activity_quantile)))
        scale = max(
            1.0e-5,
            float(np.quantile(raw_truth.astype(np.float64), quantile)),
            float(np.quantile(raw_predicted.astype(np.float64), quantile)),
            float(np.quantile(raw_low.astype(np.float64), quantile)),
        )
        truth_cue = normalize_activity(raw_truth, scale, float(args.activity_floor), float(args.activity_gamma))
        low_cue = normalize_activity(raw_low, scale, float(args.activity_floor), float(args.activity_gamma))
        predicted_cue = normalize_activity(raw_predicted, scale, float(args.activity_floor), float(args.activity_gamma))

        outputs = {
            "truthOracleCeilingCue": {
                "identity": TRUTH_CUE_IDENTITY,
                **writeFloat32Cue(out_dir / "truth-oracle-scalar-activity-cue.f32", truth_cue),
                "rawNormStats": cue_stats(raw_truth),
                "metricsVsTruth": cue_metrics(truth_cue, truth_cue, low_cue),
            },
            "lowDerivedCue": {
                "identity": LOW_CUE_IDENTITY,
                **writeFloat32Cue(out_dir / "low-derived-scalar-activity-cue.f32", low_cue),
                "rawNormStats": cue_stats(raw_low),
                "metricsVsTruth": cue_metrics(low_cue, truth_cue, low_cue),
            },
            "predictedLearnedCue": {
                "identity": IDENTITY,
                **writeFloat32Cue(out_dir / "predicted-learned-scalar-activity-cue.f32", predicted_cue),
                "rawNormStats": cue_stats(raw_predicted),
                "metricsVsTruth": cue_metrics(predicted_cue, truth_cue, low_cue),
            },
        }
        sheet = write_cue_sheet(out_dir, receiver_grid, [
            ("truthCue", truth_cue),
            ("lowCue", low_cue),
            ("predCue", predicted_cue),
        ])
        manifest = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": IDENTITY,
            "authority": "same-pair-learned-derived-diagnostic-rgb-norm-cue-not-product-runtime",
            "pairManifest": str(pair_path),
            "pairManifestSha256": sha256_file(pair_path),
            "routeIdentity": pair.get("routeIdentity"),
            "effectiveRoute": pair.get("effectiveRoute"),
            "backend": pair.get("backend"),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "receiverGrid": receiver_grid,
            "receiverCellCount": receiver_cells,
            "sourcePredictionRegime": args.source_prediction_regime,
            "diagnosticRgbTargetIdentity": _CTX.DIAGNOSTIC_RGB_TARGET_IDENTITY,
            "cueNormalizationIdentity": CUE_NORMALIZATION_IDENTITY,
            "cueNormalization": {
                "identity": CUE_NORMALIZATION_IDENTITY,
                "activityQuantile": quantile,
                "activityFloor": float(args.activity_floor),
                "activityGamma": float(args.activity_gamma),
                "scale": scale,
                "sourceRawNorms": ["truthOracleCeilingCue", "lowDerivedCue", "predictedLearnedCue"],
            },
            "downsampleIdentity": DOWNSAMPLE_IDENTITY,
            "training": {
                "modelIdentity": "diagnostic-rgb-context-ablation-component-mlp-residual-v0",
                "trainSamples": int(train_indexes.shape[0]),
                "testSamples": int(test_indexes.shape[0]),
                "supportScanSamples": int(support_scan.shape[0]),
                "supportSampleFraction": float(args.support_sample_fraction),
                "hiddenWidth": int(args.hidden_width),
                "epochs": int(args.epochs),
                "learningRate": float(args.learning_rate),
                "batchSize": int(args.batch_size),
                "seed": int(args.seed),
                "componentReports": component_reports,
                "testLowMetrics": test_low_metrics,
                "testPredictedMetrics": test_prediction_metrics,
                "improvementVsLowUpsampled": _CHANNEL.improvement_vs(test_low_metrics, test_prediction_metrics),
                "targetDiagnostics": {
                    "supportScan": support_target_diagnostics,
                    "train": train_target_diagnostics,
                    "test": test_target_diagnostics,
                },
            },
            "outputs": outputs,
            "contactSheet": sheet,
            "visibleRasterLabels": sheet["visibleRasterLabels"],
            "sourceChecksums": {
                "lowFluid": {"path": str(low_fluid_path), "sha256": sha256_file(low_fluid_path)},
                "lowFront": {"path": str(low_front_path), "sha256": sha256_file(low_front_path)},
                "highFluid": {"path": str(high_fluid_path), "sha256": sha256_file(high_fluid_path)},
                "highFront": {"path": str(high_front_path), "sha256": sha256_file(high_front_path)},
            },
            "limitations": [
                "Same-pair learned diagnostic cue export; not held-out proof.",
                "Truth cue is an oracle ceiling and diagnostic comparator only.",
                "Predicted cue derives scalar activity from diagnostic RGB norm, not vector velocity direction or debug chroma.",
            ],
        }
        write_json(manifest_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_path),
            "contactSheet": sheet["path"],
            "predictedCue": outputs["predictedLearnedCue"]["path"],
            "predictedMetrics": outputs["predictedLearnedCue"]["metricsVsTruth"],
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(manifest_path, "unknown", error, evidence)
        print(f"error: {error}", file=sys.stderr)
        return 1


def cue_stats(values: np.ndarray) -> dict[str, float]:
    raw = values.astype(np.float64)
    return {
        "min": float(np.min(raw)) if raw.size else 0.0,
        "mean": float(np.mean(raw)) if raw.size else 0.0,
        "p95": float(np.quantile(raw, 0.95)) if raw.size else 0.0,
        "p99": float(np.quantile(raw, 0.99)) if raw.size else 0.0,
        "max": float(np.max(raw)) if raw.size else 0.0,
    }


if __name__ == "__main__":
    raise SystemExit(main())
