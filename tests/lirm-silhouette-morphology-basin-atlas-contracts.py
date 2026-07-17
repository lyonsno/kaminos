#!/usr/bin/env python3

import importlib.util
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "lirm-silhouette-morphology-basin-atlas.py"

if not MODULE_PATH.is_file():
    raise AssertionError("missing morphology basin atlas route")

spec = importlib.util.spec_from_file_location("lirm_morphology_basin_atlas", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def blank(size=64):
    return np.zeros((size, size), dtype=np.uint8)


def rectangle(width, height):
    mask = blank()
    x0 = (mask.shape[1] - width) // 2
    y0 = (mask.shape[0] - height) // 2
    mask[y0:y0 + height, x0:x0 + width] = 1
    return mask


def disk(radius, center=(32, 32)):
    yy, xx = np.mgrid[:64, :64]
    return (((xx - center[0]) ** 2 + (yy - center[1]) ** 2) <= radius ** 2).astype(np.uint8)


def ring(outer=22, inner=11):
    result = disk(outer)
    result[disk(inner) == 1] = 0
    return result


def radial_cross():
    result = blank()
    result[28:36, 8:56] = 1
    result[8:56, 28:36] = 1
    return result


upright = rectangle(14, 48)
horizontal = rectangle(48, 14)
solid = disk(22)
open_ring = ring()
radial = radial_cross()
lopsided = np.maximum(disk(18, (24, 32)), rectangle(12, 42))
fragmented = np.maximum.reduce((disk(8, (14, 18)), disk(8, (32, 44)), disk(8, (50, 18))))

descriptors = {
    name: module.describe_silhouette(mask)
    for name, mask in {
        "upright": upright,
        "horizontal": horizontal,
        "solid": solid,
        "ring": open_ring,
        "radial": radial,
        "lopsided": lopsided,
    }.items()
}

for name, descriptor in descriptors.items():
    values = np.asarray(descriptor["vector"], dtype=np.float64)
    assert np.isfinite(values).all(), f"{name} descriptor contains non-finite values"
    assert len(values) == len(module.DESCRIPTOR_NAMES)

mirror = module.describe_silhouette(np.fliplr(lopsided))
assert module.descriptor_distance(descriptors["lopsided"], mirror) < 1e-9

assert descriptors["upright"]["metrics"]["principalAspect"] > 2.5
assert descriptors["horizontal"]["metrics"]["principalAspect"] < 0.4
assert descriptors["ring"]["topology"]["holes"] == 1
assert descriptors["solid"]["topology"]["holes"] == 0
assert descriptors["radial"]["metrics"]["radialPeakCount"] >= 4
assert descriptors["upright"]["metrics"]["radialPeakCount"] < descriptors["radial"]["metrics"]["radialPeakCount"]

filled_square_assay = module.assay_atlas_eligibility(rectangle(48, 48))
assert filled_square_assay["eligible"] is False
assert "filled_bounding_box" in filled_square_assay["reasons"]
fragmented_assay = module.assay_atlas_eligibility(fragmented)
assert fragmented_assay["eligible"] is False
assert "fragmented_foreground" in fragmented_assay["reasons"]
assert module.assay_atlas_eligibility(radial)["eligible"] is True

fixture_descriptors = list(descriptors.values())
distance_matrix = module.standardized_distance_matrix(fixture_descriptors)
assert distance_matrix.shape == (len(fixture_descriptors), len(fixture_descriptors))
assert np.allclose(distance_matrix, distance_matrix.T)
assert np.allclose(np.diag(distance_matrix), 0)

selected = module.maximin_indexes(distance_matrix, count=5)
assert len(selected) == 5
assert len(set(selected)) == 5
selected_names = {list(descriptors)[index] for index in selected}
assert {"upright", "horizontal", "ring", "radial"}.issubset(selected_names)

fixture_distance = module.descriptor_distance(descriptors["upright"], descriptors["horizontal"])
assert fixture_distance > module.descriptor_distance(descriptors["solid"], descriptors["radial"])
assert math.isfinite(fixture_distance)


def write_pgm(path, mask):
    pixels = np.where(mask, 255, 0).astype(np.uint8)
    path.write_bytes(f"P5\n{mask.shape[1]} {mask.shape[0]}\n255\n".encode() + pixels.tobytes())


with tempfile.TemporaryDirectory(prefix="kaminos-morphology-basin-contract-") as temporary:
    temporary_path = Path(temporary)
    corpus_path = temporary_path / "fixture-corpus"
    masks_path = corpus_path / "masks"
    masks_path.mkdir(parents=True)
    fixture_masks = [upright, horizontal, solid, open_ring, radial, lopsided, rectangle(48, 48), fragmented]
    index_rows = []
    for index, mask in enumerate(fixture_masks):
        relative_path = Path("masks") / f"fixture-{index:02d}.pgm"
        write_pgm(corpus_path / relative_path, mask)
        index_rows.append({
            "shapeId": f"sha256:{index:064x}",
            "mask": {"path": str(relative_path)},
        })
    (corpus_path / "training-index.jsonl").write_text(
        "".join(f"{json.dumps(row)}\n" for row in index_rows)
    )
    (corpus_path / "receipt.json").write_text(json.dumps({
        "status": "complete",
        "acceptedSourceCount": len(index_rows),
        "failedSourceCount": 0,
        "routeIdentity": {
            "effectiveRoute": "kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0",
        },
    }))

    output_path = temporary_path / "atlas"
    run = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--corpus-dir", str(corpus_path),
        "--out-dir", str(output_path),
        "--basins", "4",
        "--columns", "2",
    ], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr or run.stdout
    receipt = json.loads((output_path / "receipt.json").read_text())
    assert receipt["status"] == "complete"
    assert receipt["uniqueShapeCount"] == len(fixture_masks)
    assert receipt["eligibleMedoidCandidateCount"] == 4
    assert receipt["excludedMedoidCandidateCount"] == 4
    assert receipt["exclusionReasonCounts"] == {
        "filled_bounding_box": 3,
        "fragmented_foreground": 1,
    }
    assert receipt["falseClosureGuards"]["medoidsAllEligible"] is True
    assert (output_path / "contact-sheet.png").stat().st_size > 0
    assignment_rows = [json.loads(line) for line in (output_path / "assignments.jsonl").read_text().splitlines()]
    assert len(assignment_rows) == len(fixture_masks)
    assert sum(not row["atlasEligibility"]["eligible"] for row in assignment_rows) == 4

    failure_path = temporary_path / "failed-atlas"
    failed = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--corpus-dir", str(temporary_path / "missing-corpus"),
        "--out-dir", str(failure_path),
    ], capture_output=True, text=True)
    assert failed.returncode != 0
    failure_receipt = json.loads((failure_path / "receipt.json").read_text())
    assert failure_receipt["status"] == "failed"
    assert failure_receipt["failurePhase"] == "loading_corpora"
    assert failure_receipt["lastTrustworthyEvidence"] == "receipt_initialized"

print("LIRM silhouette morphology basin atlas contracts passed")
