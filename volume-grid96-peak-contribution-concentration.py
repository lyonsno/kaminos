#!/usr/bin/env python3
"""Classify Grid96 bright pixels by renderer-exact parent concentration."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


PARENT_PATH = Path(__file__).with_name("volume-grid96-parent-peak-wisp-attribution.py")
PARENT: Any = None

REPORT_SCHEMA = "kaminos.volume.grid96-peak-contribution-concentration-report.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-peak-contribution-concentration.v0"
CONTRIBUTION_IDENTITY = "deposited-kernel-times-pre-bin-shared-transmittance-times-local-optical-weight-v0"
EMISSION_CONTRIBUTION_IDENTITY = "deposited-kernel-times-pre-bin-shared-transmittance-times-parent-emission-luma-times-path-scale-v0"
COHORT_IDENTITY = "top1-majority-hotspot_top4-submajority-distributed_else-mixed_unattributed-explicit-v0"
EXPECTED_PARENT_MANIFEST_IDENTITY = "sha256:6ee6177872333988eaaff59b143c5e5fd890db6128a809ab93ce56ba17909cd7"
EXPECTED_PARENT_MANIFEST_SHA256 = "fbf40d3690141d61b5ef08eef4eb5dce58273e51ac398d90b67aa192b2cc74c3"

COHORT_OUTSIDE = 0
COHORT_HOTSPOT = 1
COHORT_MIXED = 2
COHORT_DISTRIBUTED = 3
COHORT_UNATTRIBUTED = 4

PIXEL_ORDER = (
    "targetLuma",
    "targetBright",
    "positivePeakResidual",
    "totalContribution",
    "top1Fraction",
    "top2Fraction",
    "top4Fraction",
    "contributorCount",
    "effectiveContributorCount",
    "normalizedEntropy",
    "depthBinCount",
    "depthBinSpan",
    "columnOpticalDepth",
    "finalTransmittance",
    "cohortCode",
    "emissionTotalContribution",
    "emissionTop1Fraction",
    "emissionTop2Fraction",
    "emissionTop4Fraction",
    "emissionContributorCount",
    "emissionEffectiveContributorCount",
    "emissionNormalizedEntropy",
    "emissionCohortCode",
    "composedLinearLuma",
    "emissionReconstructionDelta",
)

CLAIM_BOUNDARY = {
    "projectionRelevanceOnly": True,
    "leaveOneOutCausalityClaimed": False,
    "exactPerParentRadianceClaimed": False,
    "exactPerParentEmittedLumaClaimed": True,
    "supportChanged": False,
    "coefficientsChanged": False,
    "opticalMassChanged": False,
    "parentsMoved": False,
    "footprintChanged": False,
    "targetChanged": False,
    "cameraConditionedAttributesProduced": False,
    "featureSelectionPerformed": False,
    "learnerStarted": False,
    "placementChosen": False,
    "rendererClaimMade": False,
    "productClaimMade": False,
}


def load_parent() -> Any:
    global PARENT
    if PARENT is not None:
        return PARENT
    spec = importlib.util.spec_from_file_location("kaminos_grid96_parent_attribution", PARENT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load parent attribution dependency: {PARENT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    PARENT = module
    return PARENT


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def producer_identity() -> dict[str, Any]:
    concentration_path = Path(__file__).resolve()
    parent_path = PARENT_PATH.resolve()
    oracle_path = PARENT_PATH.with_name("volume-layer-coefficient-render-oracle.py").resolve()
    for path in (concentration_path, parent_path, oracle_path):
        require(path.is_file() and path.stat().st_size > 0, f"producer dependency is missing or blank: {path}")
    return {
        "concentrationScript": {"path": str(concentration_path), "sha256": sha256_file(concentration_path)},
        "parentScript": {"path": str(parent_path), "sha256": sha256_file(parent_path)},
        "oracleScript": {"path": str(oracle_path), "sha256": sha256_file(oracle_path)},
        "pythonExecutable": str(Path(sys.executable).resolve()),
        "routeReceiptAuthority": "external-gpu-greenroom-receipt-required-v0",
    }


def cohort_summary(mask: np.ndarray, cohort: np.ndarray) -> dict[str, Any]:
    selected = np.asarray(mask, dtype=bool)
    codes = np.asarray(cohort, dtype=np.uint8)
    require(selected.shape == codes.shape, "cohort summary mask shape drifted")
    pixel_count = int(np.count_nonzero(selected))
    require(pixel_count > 0, "cohort summary mask is blank")
    counts = {
        "hotspotPixelCount": int(np.count_nonzero(selected & (codes == COHORT_HOTSPOT))),
        "mixedPixelCount": int(np.count_nonzero(selected & (codes == COHORT_MIXED))),
        "distributedPixelCount": int(np.count_nonzero(selected & (codes == COHORT_DISTRIBUTED))),
        "unattributedPixelCount": int(np.count_nonzero(selected & (codes == COHORT_UNATTRIBUTED))),
    }
    attributed = counts["hotspotPixelCount"] + counts["mixedPixelCount"] + counts["distributedPixelCount"]
    require(attributed + counts["unattributedPixelCount"] == pixel_count, "cohort partition is incomplete")
    denominator = max(attributed, 1)
    return {
        "pixelCount": pixel_count,
        "attributedPixelCount": attributed,
        "attributedPixelFraction": attributed / pixel_count,
        **counts,
        "hotspotFractionOfAttributed": counts["hotspotPixelCount"] / denominator,
        "mixedFractionOfAttributed": counts["mixedPixelCount"] / denominator,
        "distributedFractionOfAttributed": counts["distributedPixelCount"] / denominator,
        "unattributedFractionOfMask": counts["unattributedPixelCount"] / pixel_count,
    }


def metric_summary(mask: np.ndarray, metrics: np.ndarray) -> dict[str, Any]:
    column = {name: index for index, name in enumerate(PIXEL_ORDER)}
    selected = np.asarray(mask, dtype=bool) & (metrics[..., column["totalContribution"]] > 0.0)
    require(np.any(selected), "metric summary has zero attributed pixels")
    result: dict[str, Any] = {}
    for name in (
        "top1Fraction", "top2Fraction", "top4Fraction", "contributorCount",
        "effectiveContributorCount", "normalizedEntropy", "depthBinCount",
        "depthBinSpan", "columnOpticalDepth", "totalContribution",
    ):
        values = np.asarray(metrics[..., column[name]][selected], dtype=np.float64)
        result[name] = {
            "mean": float(np.mean(values)),
            "median": float(np.median(values)),
            "p90": float(np.percentile(values, 90.0)),
            "maximum": float(np.max(values)),
        }
    return result


def emission_metric_summary(mask: np.ndarray, metrics: np.ndarray) -> dict[str, Any]:
    column = {name: index for index, name in enumerate(PIXEL_ORDER)}
    selected = np.asarray(mask, dtype=bool) & (metrics[..., column["emissionTotalContribution"]] > 0.0)
    require(np.any(selected), "emission metric summary has zero attributed pixels")
    result: dict[str, Any] = {}
    for name in (
        "emissionTop1Fraction", "emissionTop2Fraction", "emissionTop4Fraction",
        "emissionContributorCount", "emissionEffectiveContributorCount",
        "emissionNormalizedEntropy", "emissionTotalContribution",
        "emissionReconstructionDelta",
    ):
        values = np.asarray(metrics[..., column[name]][selected], dtype=np.float64)
        result[name] = {
            "mean": float(np.mean(values)),
            "median": float(np.median(values)),
            "p90": float(np.percentile(values, 90.0)),
            "maximum": float(np.max(values)),
        }
    return result


def concentrate_parent_contributions(
    *,
    row_count: int,
    row_index: np.ndarray,
    sample_x: np.ndarray,
    sample_y: np.ndarray,
    sample_depth: np.ndarray,
    sample_weight: np.ndarray,
    transmittance_before: np.ndarray,
    local_optical_weight: np.ndarray,
    parent_emission_luma: np.ndarray,
    path_scale: float,
    composed_linear_luma: np.ndarray,
    target_bright_mask: np.ndarray,
    positive_peak_mask: np.ndarray,
    column_optical_depth: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Aggregate fragments by parent/pixel, then compute concentration metrics."""

    rows = np.asarray(row_index, dtype=np.int64)
    x = np.asarray(sample_x, dtype=np.int64)
    y = np.asarray(sample_y, dtype=np.int64)
    depth = np.asarray(sample_depth, dtype=np.int64)
    weight = np.asarray(sample_weight, dtype=np.float64)
    require(row_count > 0, "row count must be positive")
    require(rows.ndim == 1 and rows.size > 0, "concentration requires deposited fragments")
    require(all(value.shape == rows.shape for value in (x, y, depth, weight)), "fragment vectors must align")
    require(local_optical_weight.shape == (row_count,), "local optical weights must contain every parent")
    require(parent_emission_luma.shape == (row_count,), "parent emission luma must contain every parent")
    require(math.isfinite(path_scale) and path_scale > 0.0, "path scale must be finite and positive")
    require(transmittance_before.ndim == 3, "pre-bin transmittance must have shape [depth,height,width]")
    height, width = transmittance_before.shape[1:]
    require(target_bright_mask.shape == positive_peak_mask.shape == column_optical_depth.shape == (height, width), "pixel masks and optical depth shape drifted")
    require(composed_linear_luma.shape == (height, width), "composed linear luma shape drifted")
    require(np.all((rows >= 0) & (rows < row_count)), "fragment parent row is out of range")
    require(np.all((depth >= 0) & (depth < transmittance_before.shape[0])), "fragment depth is out of range")
    require(np.all((x >= 0) & (x < width) & (y >= 0) & (y < height)), "fragment pixel is out of range")
    require(np.all(np.isfinite(weight)) and np.all(weight > 0.0), "fragment weights must be finite and positive")
    require(np.all(np.isfinite(local_optical_weight)) and float(np.min(local_optical_weight)) >= 0.0, "local optical weights are invalid")
    require(np.all(np.isfinite(parent_emission_luma)) and float(np.min(parent_emission_luma)) >= 0.0, "parent emission luma is invalid")
    require(np.all(np.isfinite(composed_linear_luma)) and float(np.min(composed_linear_luma)) >= 0.0, "composed linear luma is invalid")
    require(np.all(np.isfinite(column_optical_depth)) and float(np.min(column_optical_depth)) >= 0.0, "column optical depth is invalid")

    raw_rows = rows
    raw_pixel = y * width + x
    raw_depth = depth
    raw_weight = weight
    pixel = raw_pixel
    transmitted = transmittance_before[depth, y, x].astype(np.float64, copy=False)
    raw_transmitted = transmitted
    contributions = weight * transmitted * np.asarray(local_optical_weight[rows], dtype=np.float64)
    require(np.all(np.isfinite(contributions)) and float(np.min(contributions)) >= 0.0, "fragment contributions are invalid")
    positive = contributions > 0.0
    require(np.any(positive), "all fragment contributions are zero")
    rows = rows[positive]
    pixel = pixel[positive]
    depth = depth[positive]
    contributions = contributions[positive]

    parent_pixel_key = pixel * np.int64(row_count) + rows
    parent_order = np.argsort(parent_pixel_key, kind="stable")
    sorted_key = parent_pixel_key[parent_order]
    sorted_depth = depth[parent_order]
    duplicate = sorted_key[1:] == sorted_key[:-1]
    require(np.all((~duplicate) | (sorted_depth[1:] == sorted_depth[:-1])), "one parent reached one pixel through multiple depth bins")
    group_start = np.concatenate((np.asarray((0,), dtype=np.int64), np.flatnonzero(sorted_key[1:] != sorted_key[:-1]) + 1))
    group_contribution = np.add.reduceat(contributions[parent_order], group_start)
    group_pixel = sorted_key[group_start] // np.int64(row_count)
    group_depth = sorted_depth[group_start]
    pixel_count = height * width

    total = np.bincount(group_pixel, weights=group_contribution, minlength=pixel_count).astype(np.float64)
    contributor_count = np.bincount(group_pixel, minlength=pixel_count).astype(np.int32)
    square_sum = np.bincount(group_pixel, weights=np.square(group_contribution), minlength=pixel_count).astype(np.float64)
    c_log_c = np.bincount(
        group_pixel,
        weights=group_contribution * np.log(np.maximum(group_contribution, 1e-300)),
        minlength=pixel_count,
    ).astype(np.float64)

    rank_order = np.lexsort((-group_contribution, group_pixel))
    ranked_pixel = group_pixel[rank_order]
    ranked_contribution = group_contribution[rank_order]
    pixel_start = np.concatenate((np.asarray((0,), dtype=np.int64), np.flatnonzero(ranked_pixel[1:] != ranked_pixel[:-1]) + 1))
    pixel_run_count = np.diff(np.concatenate((pixel_start, np.asarray((ranked_pixel.size,), dtype=np.int64))))
    rank = np.arange(ranked_pixel.size, dtype=np.int64) - np.repeat(pixel_start, pixel_run_count)

    top_sums: dict[int, np.ndarray] = {}
    for top_k in (1, 2, 4):
        selected = rank < top_k
        top_sums[top_k] = np.bincount(
            ranked_pixel[selected], weights=ranked_contribution[selected], minlength=pixel_count
        ).astype(np.float64)

    depth_presence = np.zeros((pixel_count, transmittance_before.shape[0]), dtype=bool)
    depth_presence[group_pixel, group_depth] = True
    depth_count = np.sum(depth_presence, axis=1, dtype=np.int32)
    depth_span = np.zeros(pixel_count, dtype=np.int32)
    has_depth = depth_count > 0
    if np.any(has_depth):
        minimum = np.argmax(depth_presence, axis=1)
        maximum = depth_presence.shape[1] - 1 - np.argmax(depth_presence[:, ::-1], axis=1)
        depth_span[has_depth] = maximum[has_depth] - minimum[has_depth]

    top_fraction = {top_k: np.zeros(pixel_count, dtype=np.float64) for top_k in (1, 2, 4)}
    has_contribution = total > 0.0
    for top_k in (1, 2, 4):
        np.divide(top_sums[top_k], total, out=top_fraction[top_k], where=has_contribution)
    effective_count = np.zeros(pixel_count, dtype=np.float64)
    np.divide(np.square(total), square_sum, out=effective_count, where=square_sum > 0.0)
    entropy = np.zeros(pixel_count, dtype=np.float64)
    multi = contributor_count > 1
    entropy[multi] = (
        np.log(total[multi]) - c_log_c[multi] / total[multi]
    ) / np.log(contributor_count[multi])
    entropy = np.clip(entropy, 0.0, 1.0)

    bright = np.asarray(target_bright_mask, dtype=bool).reshape(-1)
    peak = np.asarray(positive_peak_mask, dtype=bool).reshape(-1)
    require(not np.any(peak & ~bright), "positive-peak mask escaped target-bright mask")
    relevant = bright | peak
    cohort = np.full(pixel_count, COHORT_OUTSIDE, dtype=np.uint8)
    attributed = relevant & has_contribution
    hotspot = attributed & (top_fraction[1] >= 0.5)
    distributed = attributed & ~hotspot & (top_fraction[4] < 0.5)
    mixed = attributed & ~hotspot & ~distributed
    cohort[hotspot] = COHORT_HOTSPOT
    cohort[mixed] = COHORT_MIXED
    cohort[distributed] = COHORT_DISTRIBUTED
    cohort[relevant & ~has_contribution] = COHORT_UNATTRIBUTED

    emission_contributions = (
        raw_weight
        * raw_transmitted
        * np.asarray(parent_emission_luma[raw_rows], dtype=np.float64)
        * path_scale
    )
    require(
        np.all(np.isfinite(emission_contributions)) and float(np.min(emission_contributions)) >= 0.0,
        "fragment emitted-luma contributions are invalid",
    )
    emission_positive = emission_contributions > 0.0
    require(np.any(emission_positive), "all fragment emitted-luma contributions are zero")
    emission_rows = raw_rows[emission_positive]
    emission_pixel = raw_pixel[emission_positive]
    emission_depth = raw_depth[emission_positive]
    emission_values = emission_contributions[emission_positive]
    emission_key = emission_pixel * np.int64(row_count) + emission_rows
    emission_order = np.argsort(emission_key, kind="stable")
    sorted_emission_key = emission_key[emission_order]
    sorted_emission_depth = emission_depth[emission_order]
    emission_duplicate = sorted_emission_key[1:] == sorted_emission_key[:-1]
    require(
        np.all((~emission_duplicate) | (sorted_emission_depth[1:] == sorted_emission_depth[:-1])),
        "one emitted-luma parent reached one pixel through multiple depth bins",
    )
    emission_group_start = np.concatenate((
        np.asarray((0,), dtype=np.int64),
        np.flatnonzero(sorted_emission_key[1:] != sorted_emission_key[:-1]) + 1,
    ))
    emission_group = np.add.reduceat(emission_values[emission_order], emission_group_start)
    emission_group_pixel = sorted_emission_key[emission_group_start] // np.int64(row_count)
    emission_total = np.bincount(
        emission_group_pixel, weights=emission_group, minlength=pixel_count
    ).astype(np.float64)
    emission_count = np.bincount(emission_group_pixel, minlength=pixel_count).astype(np.int32)
    emission_square_sum = np.bincount(
        emission_group_pixel, weights=np.square(emission_group), minlength=pixel_count
    ).astype(np.float64)
    emission_c_log_c = np.bincount(
        emission_group_pixel,
        weights=emission_group * np.log(np.maximum(emission_group, 1e-300)),
        minlength=pixel_count,
    ).astype(np.float64)
    emission_rank_order = np.lexsort((-emission_group, emission_group_pixel))
    emission_ranked_pixel = emission_group_pixel[emission_rank_order]
    emission_ranked_value = emission_group[emission_rank_order]
    emission_pixel_start = np.concatenate((
        np.asarray((0,), dtype=np.int64),
        np.flatnonzero(emission_ranked_pixel[1:] != emission_ranked_pixel[:-1]) + 1,
    ))
    emission_run_count = np.diff(np.concatenate((
        emission_pixel_start, np.asarray((emission_ranked_pixel.size,), dtype=np.int64)
    )))
    emission_rank = np.arange(emission_ranked_pixel.size, dtype=np.int64) - np.repeat(
        emission_pixel_start, emission_run_count
    )
    emission_top_fraction: dict[int, np.ndarray] = {}
    emission_has_contribution = emission_total > 0.0
    for top_k in (1, 2, 4):
        emission_selected = emission_rank < top_k
        emission_top_sum = np.bincount(
            emission_ranked_pixel[emission_selected],
            weights=emission_ranked_value[emission_selected],
            minlength=pixel_count,
        ).astype(np.float64)
        emission_top_fraction[top_k] = np.zeros(pixel_count, dtype=np.float64)
        np.divide(
            emission_top_sum,
            emission_total,
            out=emission_top_fraction[top_k],
            where=emission_has_contribution,
        )
    emission_effective_count = np.zeros(pixel_count, dtype=np.float64)
    np.divide(
        np.square(emission_total),
        emission_square_sum,
        out=emission_effective_count,
        where=emission_square_sum > 0.0,
    )
    emission_entropy = np.zeros(pixel_count, dtype=np.float64)
    emission_multi = emission_count > 1
    emission_entropy[emission_multi] = (
        np.log(emission_total[emission_multi])
        - emission_c_log_c[emission_multi] / emission_total[emission_multi]
    ) / np.log(emission_count[emission_multi])
    emission_entropy = np.clip(emission_entropy, 0.0, 1.0)
    emission_cohort = np.full(pixel_count, COHORT_OUTSIDE, dtype=np.uint8)
    emission_attributed = relevant & emission_has_contribution
    emission_hotspot = emission_attributed & (emission_top_fraction[1] >= 0.5)
    emission_distributed = emission_attributed & ~emission_hotspot & (emission_top_fraction[4] < 0.5)
    emission_mixed = emission_attributed & ~emission_hotspot & ~emission_distributed
    emission_cohort[emission_hotspot] = COHORT_HOTSPOT
    emission_cohort[emission_mixed] = COHORT_MIXED
    emission_cohort[emission_distributed] = COHORT_DISTRIBUTED
    emission_cohort[relevant & ~emission_has_contribution] = COHORT_UNATTRIBUTED

    composed_luma = np.asarray(composed_linear_luma, dtype=np.float64).reshape(-1)
    emission_reconstruction_delta = np.abs(emission_total - composed_luma)
    emission_tolerance = 1e-6 + 5e-5 * np.abs(composed_luma)
    emission_failing = emission_reconstruction_delta > emission_tolerance
    require(
        not np.any(emission_failing),
        "emitted luma reconstruction drifted from the composed linear image",
    )

    metrics = np.zeros((pixel_count, len(PIXEL_ORDER)), dtype=np.float32)
    column = {name: index for index, name in enumerate(PIXEL_ORDER)}
    metrics[:, column["targetBright"]] = bright
    metrics[:, column["totalContribution"]] = total
    metrics[:, column["top1Fraction"]] = top_fraction[1]
    metrics[:, column["top2Fraction"]] = top_fraction[2]
    metrics[:, column["top4Fraction"]] = top_fraction[4]
    metrics[:, column["contributorCount"]] = contributor_count
    metrics[:, column["effectiveContributorCount"]] = effective_count
    metrics[:, column["normalizedEntropy"]] = entropy
    metrics[:, column["depthBinCount"]] = depth_count
    metrics[:, column["depthBinSpan"]] = depth_span
    metrics[:, column["columnOpticalDepth"]] = np.asarray(column_optical_depth, dtype=np.float32).reshape(-1)
    metrics[:, column["finalTransmittance"]] = np.exp(-np.asarray(column_optical_depth, dtype=np.float64)).reshape(-1)
    metrics[:, column["cohortCode"]] = cohort
    metrics[:, column["emissionTotalContribution"]] = emission_total
    metrics[:, column["emissionTop1Fraction"]] = emission_top_fraction[1]
    metrics[:, column["emissionTop2Fraction"]] = emission_top_fraction[2]
    metrics[:, column["emissionTop4Fraction"]] = emission_top_fraction[4]
    metrics[:, column["emissionContributorCount"]] = emission_count
    metrics[:, column["emissionEffectiveContributorCount"]] = emission_effective_count
    metrics[:, column["emissionNormalizedEntropy"]] = emission_entropy
    metrics[:, column["emissionCohortCode"]] = emission_cohort
    metrics[:, column["composedLinearLuma"]] = composed_luma
    metrics[:, column["emissionReconstructionDelta"]] = emission_reconstruction_delta
    metrics = metrics.reshape(height, width, len(PIXEL_ORDER))
    require(np.all(np.isfinite(metrics)) and float(np.min(metrics)) >= 0.0, "per-pixel concentration metrics are invalid")

    receipt = {
        "identity": CONTRIBUTION_IDENTITY,
        "cohortIdentity": COHORT_IDENTITY,
        "fragmentCount": int(row_index.size),
        "positiveFragmentCount": int(np.count_nonzero(positive)),
        "uniqueParentPixelCount": int(group_contribution.size),
        "cohorts": {
            "targetBright": cohort_summary(target_bright_mask, cohort.reshape(height, width)),
            "positivePeak": cohort_summary(positive_peak_mask, cohort.reshape(height, width)),
        },
        "emission": {
            "identity": EMISSION_CONTRIBUTION_IDENTITY,
            "positiveFragmentCount": int(np.count_nonzero(emission_positive)),
            "uniqueParentPixelCount": int(emission_group.size),
            "reconstruction": {
                "absoluteTolerance": 1e-6,
                "relativeTolerance": 5e-5,
                "maximumAbsoluteDelta": float(np.max(emission_reconstruction_delta)),
                "meanAbsoluteDelta": float(np.mean(emission_reconstruction_delta)),
                "failingPixelCount": int(np.count_nonzero(emission_failing)),
            },
            "cohorts": {
                "targetBright": cohort_summary(target_bright_mask, emission_cohort.reshape(height, width)),
                "positivePeak": cohort_summary(positive_peak_mask, emission_cohort.reshape(height, width)),
            },
        },
    }
    return metrics, receipt


def validate_parent_manifest(path: Path) -> dict[str, Any]:
    require(path.is_file(), f"parent attribution manifest is missing: {path}")
    require(sha256_file(path) == EXPECTED_PARENT_MANIFEST_SHA256, "parent attribution manifest sha256 drifted")
    try:
        manifest = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"parent attribution manifest could not be read: {exc}") from exc
    require(manifest.get("status") == "complete", "parent attribution manifest is not complete")
    require(manifest.get("identity") == EXPECTED_PARENT_MANIFEST_IDENTITY, "parent attribution manifest identity drifted")
    attribution = manifest.get("attribution") or {}
    require(attribution.get("identity") == PARENT.ATTRIBUTION_IDENTITY, "parent attribution identity drifted")
    require(attribution.get("fragmentAdmission") == PARENT.FRAGMENT_ADMISSION_IDENTITY, "parent fragment admission drifted")
    execution = manifest.get("execution") or {}
    require(execution.get("rowCount") == PARENT.EXPECTED_ROW_COUNT, "parent attribution row count drifted")
    require(execution.get("cameraCount") == 21, "parent attribution camera count drifted")
    require(execution.get("sampleCap") is None, "parent attribution used a hidden sample cap")
    require(execution.get("droppedRowCount") == 0 and execution.get("fallbackRowCount") == 0, "parent attribution dropped or substituted rows")
    for artifact in (manifest.get("artifacts") or {}).values():
        artifact_path = Path(artifact.get("path", ""))
        require(artifact_path.is_file(), "parent attribution artifact is missing")
        require(artifact_path.stat().st_size == artifact.get("bytes"), "parent attribution artifact is partial")
        require(sha256_file(artifact_path) == artifact.get("sha256"), "parent attribution artifact hash drifted")
    return manifest


def image_receipt(path: Path, role: str, oracle: Any) -> dict[str, Any]:
    require(path.is_file() and path.stat().st_size > 0, f"visual artifact is missing or blank: {path}")
    image = oracle.image_rgb(path)
    require(image.shape == (242, 314, 3), f"visual artifact dimensions drifted: {path}")
    require(np.unique(image.reshape(-1, 3), axis=0).shape[0] > 1, f"visual artifact is flat: {path}")
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256_file(path), "shape": [242, 314, 3], "semanticRole": role}


def scalar_heatmap(values: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    field = np.asarray(values, dtype=np.float32)
    selected = np.ones_like(field, dtype=bool) if mask is None else np.asarray(mask, dtype=bool)
    positive = field[selected & (field > 0.0)]
    scale = float(np.percentile(positive, 99.0)) if positive.size else 1.0
    normalized = np.clip(field / max(scale, 1e-12), 0.0, 1.0)
    red = np.clip(normalized * 2.2, 0.0, 1.0)
    green = np.clip(1.6 - np.abs(normalized * 2.8 - 1.4), 0.0, 1.0)
    blue = np.clip(1.0 - normalized * 1.6, 0.0, 1.0)
    rgb = np.rint(np.stack((red, green, blue), axis=2) * 255.0).astype(np.uint8)
    rgb[~selected] = 0
    return rgb


def cohort_image(cohort: np.ndarray, mask: np.ndarray) -> np.ndarray:
    codes = np.asarray(cohort, dtype=np.uint8)
    selected = np.asarray(mask, dtype=bool)
    image = np.zeros((*codes.shape, 3), dtype=np.uint8)
    image[selected & (codes == COHORT_HOTSPOT)] = (255, 72, 36)
    image[selected & (codes == COHORT_MIXED)] = (255, 205, 45)
    image[selected & (codes == COHORT_DISTRIBUTED)] = (45, 190, 255)
    image[selected & (codes == COHORT_UNATTRIBUTED)] = (236, 62, 255)
    return image


def evidence_scope(camera_rows: list[dict[str, Any]], full_orbit: bool) -> tuple[str, str]:
    if full_orbit:
        return "complete", "full 21-camera orbit"
    if len(camera_rows) == 1 and camera_rows[0].get("cameraIndex") == 10 and camera_rows[0].get("role") == "calibration":
        return "calibration-smoke", "calibration-camera smoke"
    if len(camera_rows) == 1 and camera_rows[0].get("role") == "held-out":
        return "subset-smoke", "held-out-camera smoke"
    return "subset-smoke", f"{len(camera_rows)}-camera subset smoke"


def gallery_html(camera_rows: list[dict[str, Any]], full_orbit: bool) -> str:
    rows = json.dumps(camera_rows, separators=(",", ":"))
    status, authority = evidence_scope(camera_rows, full_orbit)
    maximum = len(camera_rows) - 1
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>Grid96 Peak Contribution Concentration</title><style>
:root{{--bg:#101214;--line:#353b40;--text:#f3f4f5;--muted:#aeb4b9;--hot:#ff4824;--mix:#ffcd2d;--dist:#2dbeff;--none:#ec3eff}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}}header{{position:sticky;top:0;z-index:2;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#15181a;border-bottom:1px solid var(--line)}}h1{{font-size:15px;margin:0}}label{{display:flex;gap:6px;align-items:center;color:var(--muted)}}button{{width:32px;height:30px;border:1px solid var(--line);background:#22272b;color:var(--text);font-size:18px}}main{{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;padding:14px}}.stage{{position:relative;width:min(100%,calc((100vh - 110px)*1.298));aspect-ratio:314/242;margin:auto;background:#050607;border:1px solid var(--line)}}.stage img{{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}}#rightImage{{clip-path:inset(0 0 0 50%)}}#divider{{position:absolute;top:0;bottom:0;left:50%;width:1px;background:white}}.labels{{display:flex;justify-content:space-between;width:min(100%,calc((100vh - 110px)*1.298));margin:6px auto;color:var(--muted)}}aside{{border-left:1px solid var(--line);padding-left:14px}}h2{{font-size:13px;margin:0 0 10px}}dl{{display:grid;grid-template-columns:1fr auto;gap:6px 10px;margin:0 0 14px}}dt{{color:var(--muted)}}dd{{margin:0;text-align:right}}.legend{{display:grid;grid-template-columns:12px 1fr;gap:5px 8px;color:var(--muted)}}.swatch{{width:12px;height:12px}}a{{color:var(--mix)}}@media(max-width:780px){{header{{position:static}}h1{{width:100%}}main{{grid-template-columns:1fr}}.stage,.labels{{width:100%}}aside{{border-left:0;border-top:1px solid var(--line);padding:12px 0 0}}}}
</style></head><body><header><h1>Grid96 peak contribution concentration</h1><button id="prev" title="Previous camera">&#8592;</button><label>Camera <input id="camera" type="range" min="0" max="{maximum}" value="0"></label><span id="cameraLabel"></span><button id="next" title="Next camera">&#8594;</button><label>Left <select id="left"><option value="target">Exact target</option><option value="candidate">Bilinear splats</option><option value="brightCohorts">Optical bright cohorts</option><option value="peakCohorts">Optical peak cohorts</option><option value="emissionBrightCohorts">Emission bright cohorts</option><option value="emissionPeakCohorts">Emission peak cohorts</option><option value="top1">Optical top-1</option><option value="effective">Optical effective contributors</option><option value="emissionTop1">Emission top-1</option><option value="emissionEffective">Emission effective contributors</option><option value="tau">Column optical depth</option></select></label><label>Right <select id="right"><option value="emissionPeakCohorts">Emission peak cohorts</option><option value="peakCohorts">Optical peak cohorts</option><option value="target">Exact target</option><option value="candidate">Bilinear splats</option><option value="emissionTop1">Emission top-1</option><option value="emissionEffective">Emission effective contributors</option><option value="top1">Optical top-1</option><option value="effective">Optical effective contributors</option><option value="tau">Column optical depth</option></select></label><label>Blend <input id="blend" type="range" min="0" max="100" value="50"></label></header><main><section><div class="stage"><img id="leftImage" alt="left evidence"><img id="rightImage" alt="right evidence"><div id="divider"></div></div><div class="labels"><span id="leftLabel"></span><span id="rightLabel"></span></div></section><aside><h2>Exact-source receipt</h2><dl><dt>Status</dt><dd>{status}</dd><dt>Authority</dt><dd>{authority}</dd><dt>Admission</dt><dd>center-visible</dd><dt>Primary</dt><dd>optical influence</dd><dt>Diagonal</dt><dd>emitted luma</dd><dt>Bright attributed</dt><dd id="brightAttributed"></dd><dt>Optical peak distributed</dt><dd id="peakDist"></dd><dt>Emission peak distributed</dt><dd id="emissionPeakDist"></dd><dt>Emission parity max</dt><dd id="emissionParity"></dd><dt>Report</dt><dd><a href="report.json">JSON</a></dd><dt>Manifest</dt><dd><a href="grid96-peak-contribution-concentration-manifest.json">JSON</a></dd></dl><div class="legend"><span class="swatch" style="background:var(--hot)"></span><span>Top-1 majority</span><span class="swatch" style="background:var(--mix)"></span><span>Top-4 majority</span><span class="swatch" style="background:var(--dist)"></span><span>Top-4 submajority</span><span class="swatch" style="background:var(--none)"></span><span>No attributed parent</span></div></aside></main><script>
const rows={rows},labels={{target:'Exact target',candidate:'Bilinear splats',brightCohorts:'Optical bright cohorts',peakCohorts:'Optical peak cohorts',emissionBrightCohorts:'Emission bright cohorts',emissionPeakCohorts:'Emission peak cohorts',top1:'Optical top-1',effective:'Optical effective contributors',emissionTop1:'Emission top-1',emissionEffective:'Emission effective contributors',tau:'Column optical depth'}},$=id=>document.getElementById(id),pct=v=>`${{(v*100).toFixed(1)}}%`;function render(){{const r=rows[+$('camera').value],l=$('left').value,q=$('right').value,b=+$('blend').value,p=r.concentration.cohorts.positivePeak,t=r.concentration.cohorts.targetBright,e=r.concentration.emission.cohorts.positivePeak;$('cameraLabel').textContent=`${{r.cameraIndex}} / ${{r.role}}`;$('leftImage').src=r.images[l];$('rightImage').src=r.images[q];$('rightImage').style.clipPath=`inset(0 0 0 ${{b}}%)`;$('divider').style.left=`${{b}}%`;$('leftLabel').textContent=labels[l];$('rightLabel').textContent=labels[q];$('brightAttributed').textContent=pct(t.attributedPixelFraction);$('peakDist').textContent=pct(p.distributedFractionOfAttributed);$('emissionPeakDist').textContent=pct(e.distributedFractionOfAttributed);$('emissionParity').textContent=r.concentration.emission.reconstruction.maximumAbsoluteDelta.toExponential(2)}}for(const id of ['camera','left','right','blend'])$(id).addEventListener('input',render);$('prev').onclick=()=>{{$('camera').value=Math.max(0,+$('camera').value-1);render()}};$('next').onclick=()=>{{$('camera').value=Math.min({maximum},+$('camera').value+1);render()}};render();</script></body></html>"""


def run(args: argparse.Namespace, output_dir: Path) -> dict[str, Any]:
    parent_manifest = validate_parent_manifest(args.parent_attribution_manifest.resolve())
    args._phase["value"] = "source-registry-validation"
    registry, registry_paths, registry_ids = PARENT.validate_registry(args.source_registry.resolve())
    PARENT.load_oracle()
    oracle = PARENT.ORACLE
    args._phase["value"] = "frozen-source-validation"
    state, paths, capture, cameras = PARENT.validate_frozen_sources(
        args.manifest.resolve(), args.capture_report.resolve(), registry, registry_paths, registry_ids
    )
    require((parent_manifest.get("source") or {}).get("registry", {}).get("identity") == registry["identity"], "parent/source registry identity drifted")
    requested_cameras = list(dict.fromkeys(args.camera_index or []))
    available = {int(camera["cameraIndex"]): camera for camera in cameras}
    if requested_cameras:
        require(all(index in available for index in requested_cameras), "requested camera is outside the frozen cohort")
        effective_cameras = [available[index] for index in requested_cameras]
    else:
        effective_cameras = cameras
    full_orbit = len(effective_cameras) == 21 and [int(camera["cameraIndex"]) for camera in effective_cameras] == list(range(21))

    if args.validate_only:
        return {
            "schema": REPORT_SCHEMA,
            "status": "validated",
            "failurePhase": None,
            "source": {"parentAttributionIdentity": parent_manifest["identity"], "registryIdentity": registry["identity"]},
            "effective": {"cameraIndices": [int(camera["cameraIndex"]) for camera in effective_cameras], "fullOrbit": full_orbit, "contributionIdentity": CONTRIBUTION_IDENTITY, "emissionContributionIdentity": EMISSION_CONTRIBUTION_IDENTITY, "cohortIdentity": COHORT_IDENTITY},
            "execution": {"rowCount": PARENT.EXPECTED_ROW_COUNT, "cameraCount": len(effective_cameras), "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0},
            "claimBoundary": CLAIM_BOUNDARY,
        }

    args._phase["value"] = "row-artifact-load"
    count = PARENT.EXPECTED_ROW_COUNT
    features = np.memmap(paths["features"], dtype="<f4", mode="r", shape=(count, 24))
    coefficients = np.memmap(paths["coefficients"], dtype="<f4", mode="r", shape=(count, 8))
    descriptors = np.memmap(paths["kernelDescriptors"], dtype="<f4", mode="r", shape=(count, 100))
    positions = np.asarray(descriptors[:, 0:3])
    tangents = np.asarray(descriptors[:, 20:23])
    optical = PARENT.local_optical_weights(coefficients, args.path_scale)
    require(np.all(np.isfinite(optical)) and np.any(optical > 0.0), "local optical weights are blank")
    luma_weights = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float32)
    emission_luma = np.asarray(
        (coefficients[:, 0:3] + coefficients[:, 4:7]) @ luma_weights,
        dtype=np.float32,
    )
    require(
        np.all(np.isfinite(emission_luma)) and np.any(emission_luma > 0.0)
        and float(np.min(emission_luma)) >= 0.0,
        "parent emission luma is blank or invalid",
    )
    height, width = int(effective_cameras[0]["height"]), int(effective_cameras[0]["width"])
    require((height, width) == (242, 314), "frozen camera dimensions drifted")

    per_pixel_path = output_dir / "grid96-peak-contribution-per-pixel.f32"
    camera_index_path = output_dir / "grid96-peak-contribution-camera-index.u32"
    per_pixel = np.memmap(per_pixel_path, dtype="<f4", mode="w+", shape=(len(effective_cameras), height, width, len(PIXEL_ORDER)))
    controls = oracle.bilinear_footprint_controls()
    camera_rows: list[dict[str, Any]] = []
    visual_receipts: list[dict[str, Any]] = []

    for camera_slot, camera in enumerate(effective_cameras):
        camera_index = int(camera["cameraIndex"])
        args._phase["value"] = f"camera-{camera_index:02d}-raster"
        planes, raster_receipt = oracle.rasterize_coefficients(
            positions, tangents, features, coefficients, camera, args.depth_bins,
            "bilinear", controls, PARENT.EXPECTED_GRID,
        )
        linear = oracle.compose_planes(planes, args.path_scale, "total")[0]
        linear_luma = np.asarray(linear @ luma_weights, dtype=np.float32)
        candidate = oracle.tone_map(linear)
        target_capture = oracle.find_capture(capture, camera_index, "sharedTransmittanceContributionSum", 160)
        target = oracle.image_rgb(Path(target_capture["imagePath"]))
        target_luma, _ = PARENT.luma_and_gradient(target)
        peak_field, _, thresholds = PARENT.positive_residual_fields(candidate, target)
        target_bright = target_luma >= thresholds["peakLumaThreshold"]
        positive_peak = peak_field > 0.0
        transmittance = PARENT.transmittance_before_bins(planes, args.path_scale)
        sigma = np.maximum(planes[..., 3] + planes[..., 7], 0.0)
        column_tau = np.sum(sigma, axis=0, dtype=np.float64) * args.path_scale

        fragment_rows: list[np.ndarray] = []
        fragment_x: list[np.ndarray] = []
        fragment_y: list[np.ndarray] = []
        fragment_depth: list[np.ndarray] = []
        fragment_weight: list[np.ndarray] = []
        for rows, x, y, depth, weight in PARENT.projected_bilinear_fragments(
            positions, tangents, features, camera, PARENT.EXPECTED_GRID, args.depth_bins
        ):
            fragment_rows.append(rows)
            fragment_x.append(x)
            fragment_y.append(y)
            fragment_depth.append(depth)
            fragment_weight.append(weight)
        rows = np.concatenate(fragment_rows)
        x = np.concatenate(fragment_x)
        y = np.concatenate(fragment_y)
        depth = np.concatenate(fragment_depth)
        weight = np.concatenate(fragment_weight)

        args._phase["value"] = f"camera-{camera_index:02d}-concentration"
        metrics, concentration = concentrate_parent_contributions(
            row_count=count, row_index=rows, sample_x=x, sample_y=y,
            sample_depth=depth, sample_weight=weight,
            transmittance_before=transmittance, local_optical_weight=optical,
            parent_emission_luma=emission_luma, path_scale=args.path_scale,
            composed_linear_luma=linear_luma,
            target_bright_mask=target_bright, positive_peak_mask=positive_peak,
            column_optical_depth=column_tau,
        )
        column = {name: index for index, name in enumerate(PIXEL_ORDER)}
        metrics[..., column["targetLuma"]] = target_luma
        metrics[..., column["positivePeakResidual"]] = peak_field
        per_pixel[camera_slot] = metrics
        concentration["metricSummary"] = {
            "targetBright": metric_summary(target_bright, metrics),
            "positivePeak": metric_summary(positive_peak, metrics),
        }
        concentration["emission"]["metricSummary"] = {
            "targetBright": emission_metric_summary(target_bright, metrics),
            "positivePeak": emission_metric_summary(positive_peak, metrics),
        }
        require(concentration["fragmentCount"] == raster_receipt["projectedFragments"], f"camera {camera_index} concentration/raster fragment count drifted")

        cohort = np.rint(metrics[..., column["cohortCode"]]).astype(np.uint8)
        emission_cohort = np.rint(metrics[..., column["emissionCohortCode"]]).astype(np.uint8)
        image_names = {
            "candidate": f"camera-{camera_index:02d}-bilinear.png",
            "target": f"camera-{camera_index:02d}-target.png",
            "brightCohorts": f"camera-{camera_index:02d}-bright-cohorts.png",
            "peakCohorts": f"camera-{camera_index:02d}-positive-peak-cohorts.png",
            "top1": f"camera-{camera_index:02d}-top1-fraction.png",
            "effective": f"camera-{camera_index:02d}-effective-contributors.png",
            "tau": f"camera-{camera_index:02d}-column-optical-depth.png",
            "emissionBrightCohorts": f"camera-{camera_index:02d}-emission-bright-cohorts.png",
            "emissionPeakCohorts": f"camera-{camera_index:02d}-emission-positive-peak-cohorts.png",
            "emissionTop1": f"camera-{camera_index:02d}-emission-top1-fraction.png",
            "emissionEffective": f"camera-{camera_index:02d}-emission-effective-contributors.png",
        }
        images = {
            "candidate": candidate,
            "target": target,
            "brightCohorts": cohort_image(cohort, target_bright),
            "peakCohorts": cohort_image(cohort, positive_peak),
            "top1": scalar_heatmap(metrics[..., column["top1Fraction"]], target_bright),
            "effective": scalar_heatmap(metrics[..., column["effectiveContributorCount"]], target_bright),
            "tau": scalar_heatmap(metrics[..., column["columnOpticalDepth"]], target_bright),
            "emissionBrightCohorts": cohort_image(emission_cohort, target_bright),
            "emissionPeakCohorts": cohort_image(emission_cohort, positive_peak),
            "emissionTop1": scalar_heatmap(metrics[..., column["emissionTop1Fraction"]], target_bright),
            "emissionEffective": scalar_heatmap(metrics[..., column["emissionEffectiveContributorCount"]], target_bright),
        }
        for role, image in images.items():
            path = output_dir / image_names[role]
            oracle.write_png(path, image)
            visual_receipts.append(image_receipt(path, f"camera-{camera_index:02d}-{role}", oracle))
        camera_rows.append({
            "cameraIndex": camera_index,
            "role": "calibration" if camera_index == PARENT.CALIBRATION_CAMERA_INDEX else "held-out",
            "cameraPoseHash": oracle.effective_camera_pose_hash(camera["cameraPose"]),
            "targetPixelHash": target_capture.get("pixelHash"),
            "thresholds": thresholds,
            "raster": raster_receipt,
            "concentration": concentration,
            "images": image_names,
        })
        del planes, linear, linear_luma, transmittance, sigma, metrics, rows, x, y, depth, weight

    args._phase["value"] = "artifact-validation"
    per_pixel.flush()
    np.asarray([row["cameraIndex"] for row in camera_rows], dtype="<u4").tofile(camera_index_path)
    del per_pixel
    per_pixel_receipt = PARENT.artifact_receipt(
        per_pixel_path, "float32-le",
        [len(camera_rows), height, width, len(PIXEL_ORDER)],
        "all-selected-camera-dense-bright-peak-concentration",
    )
    camera_index_receipt = PARENT.artifact_receipt(
        camera_index_path, "uint32-le", [len(camera_rows)], "selected-camera-index-order"
    )
    gallery_path = output_dir / "index.html"
    gallery_path.write_text(gallery_html(camera_rows, full_orbit))
    require(gallery_path.stat().st_size > 1000, "concentration gallery is blank or partial")
    gallery_receipt = {"path": str(gallery_path), "bytes": gallery_path.stat().st_size, "sha256": sha256_file(gallery_path), "semanticRole": "interactive-all-camera-concentration-gallery"}

    args._phase["value"] = "manifest-write"
    evidence_status, _ = evidence_scope(camera_rows, full_orbit)
    manifest_payload = {
        "schema": MANIFEST_SCHEMA,
        "status": evidence_status,
        "failurePhase": None,
        "source": {
            "parentAttributionManifest": {"path": str(args.parent_attribution_manifest.resolve()), "sha256": EXPECTED_PARENT_MANIFEST_SHA256, "identity": EXPECTED_PARENT_MANIFEST_IDENTITY},
            "registry": {"path": str(args.source_registry.resolve()), "sha256": PARENT.EXPECTED_REGISTRY_SHA256, "identity": PARENT.EXPECTED_REGISTRY_IDENTITY},
            "trainingManifest": {"path": str(args.manifest.resolve()), "sha256": PARENT.EXPECTED_MANIFEST_SHA256},
            "captureReport": {"path": str(args.capture_report.resolve()), "sha256": PARENT.EXPECTED_CAPTURE_SHA256},
            "sameStateCaptureId": registry["sameStateCaptureId"],
            "sourceHashes": registry["sourceHashes"],
            "producer": producer_identity(),
        },
        "concentration": {
            "identity": CONTRIBUTION_IDENTITY,
            "emissionIdentity": EMISSION_CONTRIBUTION_IDENTITY,
            "cohortIdentity": COHORT_IDENTITY,
            "fragmentAdmission": PARENT.FRAGMENT_ADMISSION_IDENTITY,
            "footprint": oracle.FOOTPRINT_MODES["bilinear"],
            "pathScale": args.path_scale,
            "depthBins": args.depth_bins,
            "pixelOrder": list(PIXEL_ORDER),
            "topK": [1, 2, 4],
            "effectiveContributorCount": "inverse-simpson-one-over-sum-squared-normalized-parent-contribution-v0",
            "normalizedEntropy": "shannon-entropy-divided-by-log-positive-parent-count-v0",
            "depthBinCount": "unique-positive-parent-contribution-depth-bin-count-v0",
            "depthBinSpan": "maximum-minus-minimum-positive-parent-contribution-depth-bin-v0",
            "columnOpticalDepth": "sum-positive-shared-ridge-plus-nonridge-sigma-times-path-scale-v0",
            "emissionReconstruction": {
                "target": "luma-of-compose-planes-total-linear-image-v0",
                "absoluteTolerance": 1e-6,
                "relativeTolerance": 5e-5,
                "failureMode": "fail-loud-before-primary-manifest",
            },
        },
        "cameraRows": camera_rows,
        "artifacts": {"perPixel": per_pixel_receipt, "cameraIndex": camera_index_receipt, "visuals": visual_receipts, "gallery": gallery_receipt},
        "execution": {"rowCount": count, "cameraCount": len(camera_rows), "calibrationCameraCount": sum(row["role"] == "calibration" for row in camera_rows), "heldOutCameraCount": sum(row["role"] == "held-out" for row in camera_rows), "fullOrbit": full_orbit, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "cachedCameraCount": 0},
        "claimBoundary": CLAIM_BOUNDARY,
    }
    manifest_payload["identity"] = "sha256:" + hashlib.sha256(
        oracle.canonical_json(manifest_payload).encode("ascii")
    ).hexdigest()
    manifest_path = output_dir / "grid96-peak-contribution-concentration-manifest.json"
    manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True) + "\n")
    return {
        "schema": REPORT_SCHEMA,
        "status": manifest_payload["status"],
        "failurePhase": None,
        "source": manifest_payload["source"],
        "effective": manifest_payload["concentration"],
        "cameras": camera_rows,
        "artifacts": {**manifest_payload["artifacts"], "manifest": {"path": str(manifest_path), "sha256": sha256_file(manifest_path), "identity": manifest_payload["identity"]}},
        "execution": manifest_payload["execution"],
        "claimBoundary": CLAIM_BOUNDARY,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-registry", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--capture-report", type=Path, required=True)
    parser.add_argument("--parent-attribution-manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--path-scale", type=float, required=True)
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--camera-index", type=int, action="append")
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_parent()
    args = parse_args(argv)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "report.json"
    primary_names = (
        "grid96-peak-contribution-concentration-manifest.json",
        "grid96-peak-contribution-per-pixel.f32",
        "grid96-peak-contribution-camera-index.u32",
        "index.html",
    )
    for name in primary_names:
        (output_dir / name).unlink(missing_ok=True)
    for path in output_dir.glob("camera-*.png"):
        path.unlink()
    started = time.time()
    args._phase = {"value": "parent-attribution-validation"}
    requested = {
        "sourceRegistry": str(args.source_registry.resolve()),
        "manifest": str(args.manifest.resolve()),
        "captureReport": str(args.capture_report.resolve()),
        "parentAttributionManifest": str(args.parent_attribution_manifest.resolve()),
        "outputDir": str(output_dir),
        "pathScale": args.path_scale,
        "depthBins": args.depth_bins,
        "cameraIndices": args.camera_index,
        "validateOnly": args.validate_only,
    }
    try:
        require(math.isfinite(args.path_scale) and args.path_scale > 0.0, "path scale must be finite and positive")
        require(args.depth_bins == 96, "the frozen concentration contract requires exactly 96 depth bins")
        result = run(args, output_dir)
        report = {**result, "requested": requested, "startedAtUnix": started, "finishedAtUnix": time.time()}
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"ok": True, "status": report["status"], "report": str(report_path), "artifacts": report.get("artifacts")}, indent=2))
        return 0
    except Exception as exc:
        for name in primary_names:
            (output_dir / name).unlink(missing_ok=True)
        failed = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": args._phase["value"],
            "requested": requested,
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
            "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()},
            "lastTrustworthyEvidence": {"parentAttributionExpectedIdentity": EXPECTED_PARENT_MANIFEST_IDENTITY, "parentAttributionExpectedSha256": EXPECTED_PARENT_MANIFEST_SHA256},
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(failed, indent=2, sort_keys=True) + "\n")
        print(f"Grid96 peak concentration failed at {args._phase['value']}: {exc}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
