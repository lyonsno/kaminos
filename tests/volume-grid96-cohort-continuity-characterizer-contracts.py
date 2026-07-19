#!/usr/bin/env python3
"""Contracts for exact Grid96 source-cohort spatial continuity."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-cohort-continuity-characterizer.py"
spec = importlib.util.spec_from_file_location("kaminos_grid96_cohort_continuity", SCRIPT)
assert spec is not None and spec.loader is not None
MODULE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MODULE)


# Linear neighbors 95 and 96 straddle the x boundary and must never become an edge.
native_ids = np.asarray((0, 1, 95, 96, 97, 192), dtype=np.uint32)
cohorts = np.asarray((1, 1, 1, 1, 1, 2), dtype=np.uint8)
edges = MODULE.face_neighbor_edges(native_ids, cohorts, grid=96)
assert edges.dtype == np.dtype("<u4")
assert edges.tolist() == [
    [0, 1, 0],
    [0, 3, 1],
    [1, 4, 1],
    [3, 4, 0],
]

# Cohort zero is invalid and a different valid cohort cannot create a cross-cohort edge.
assert MODULE.face_neighbor_edges(
    np.asarray((0, 1, 96), dtype=np.uint32),
    np.asarray((0, 2, 1), dtype=np.uint8),
    grid=96,
).shape == (0, 3)

weights = np.asarray((1.0, 2.0, 3.0, 4.0, 5.0, 6.0), dtype=np.float64)
tangents = np.asarray(((1, 0, 0), (1, 0, 0), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (1, 0, 0)), dtype=np.float64)
normals = np.asarray(((0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0), (1, 0, 0), (0, 1, 0)), dtype=np.float64)
binormals = np.asarray(((0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, -1), (0, 0, 1), (0, 0, 1)), dtype=np.float64)
continuity, continuity_edges = MODULE.parent_continuity(
    native_ids, cohorts, weights, tangents, normals, binormals, grid=96,
)
assert continuity.shape == (6, len(MODULE.CONTINUITY_ORDER))
assert continuity.dtype == np.dtype("<f4")
assert np.array_equal(continuity_edges, edges)
lookup = {name: index for index, name in enumerate(MODULE.CONTINUITY_ORDER)}
assert continuity[:, lookup["sameCohortFaceNeighborCount"]].tolist() == [2.0, 2.0, 0.0, 2.0, 2.0, 0.0]
assert continuity[:, lookup["tangentAbsDot.mean"]].tolist() == [1.0, 0.5, 0.0, 0.5, 0.0, 0.0]
assert continuity[:, lookup["normalAbsDot.mean"]].tolist() == [1.0, 0.5, 0.0, 0.5, 0.0, 0.0]
assert continuity[:, lookup["binormalAbsDot.mean"]].tolist() == [1.0, 1.0, 0.0, 1.0, 1.0, 0.0]
assert continuity[:, lookup["continuity.valid"]].tolist() == [1.0, 1.0, 0.0, 1.0, 1.0, 0.0]
assert np.all(np.isfinite(continuity))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix="kaminos-grid96-cohort-continuity-") as temp:
    fixture = Path(temp)
    native_path = fixture / "native.u32"
    native_ids.astype("<u4").tofile(native_path)
    transverse = np.zeros((6, 21), dtype="<f4")
    material = np.zeros((6, 17), dtype="<f4")
    transverse[:, 3:6] = tangents
    transverse[:, 6:9] = normals
    transverse[:, 9:12] = binormals
    transverse[:, 17] = weights
    transverse[:5, 19] = 1.0
    material[:, 3:6] = tangents
    material[:, 6:9] = normals
    material[:, 9:12] = binormals
    material[:, 14] = weights
    material[5, 15] = 1.0
    transverse_path = fixture / "transverse.f32"
    material_path = fixture / "material.f32"
    transverse.tofile(transverse_path)
    material.tofile(material_path)
    source = {
        "grid": 96,
        "sameStateCaptureId": "fixture-grid96-state120",
        "nativeCellIndexSha256": sha256(native_path),
        "descriptorManifestSha256": "1" * 64,
        "coefficientManifestSha256": "2" * 64,
        "componentSourceManifestSha256": "3" * 64,
        "descriptorSourceManifestSha256": "4" * 64,
        "descriptorArtifactSha256": "a" * 64,
        "coefficientArtifactSha256": "b" * 64,
        "sourceHashes": {
            "fluidSha256": "c" * 64,
            "frontSha256": "d" * 64,
            "boundarySidecarSha256": "e" * 64,
            "majorantSha256": "f" * 64,
        },
        "simStepCount": 120,
        "exactSourceReceiptSha256": "5" * 64,
    }

    def artifact(path: Path, shape: list[int], dtype: str) -> dict[str, object]:
        return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path), "shape": shape, "dtype": dtype}

    transverse_manifest = {
        "schema": "kaminos.volume.grid96-transverse-basis-socket.v0", "status": "complete",
        "identity": "sha256:" + "6" * 64, "source": source,
        "basis": {
            "identity": "declared-normal-flow-tangent-orthonormal-frame-v0",
            "fallbackPolicy": "none-invalid-rows-remain-invalid-v0",
            "reasonIdentity": "grid96-transverse-basis-reason-codes-v0",
            "reasonCodes": {"valid": 0, "normalUndeclared": 1, "normalZero": 2, "tangentZero": 3, "parallel": 4},
            "order": [f"column.{index}" for index in range(21)],
        },
        "artifacts": {"basis": artifact(transverse_path, [6, 21], "float32-le"), "nativeCellIndex": artifact(native_path, [6], "uint32-le")},
        "execution": {"rowCount": 6, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False},
    }
    transverse_manifest["basis"]["order"][3:12] = list(MODULE.AXIS_ORDER)
    transverse_manifest["basis"]["order"][17] = "nonRidgeOpticalWeight"
    transverse_manifest["basis"]["order"][19] = "basis.valid"
    material_manifest = {
        "schema": "kaminos.volume.grid96-nonridge-material-basis-socket.v0", "status": "complete",
        "identity": "sha256:" + "7" * 64, "source": source,
        "basis": {
            "identity": "material-density-gradient-flow-tangent-plane-v0",
            "normalSource": "gradient.material.x",
            "cohort": "structure-normal-undeclared-positive-nonridge-v0",
            "fallbackPolicy": "none-separate-cohort-only-v0",
            "reasonIdentity": "grid96-nonridge-material-basis-reasons-v0",
            "reasonCodes": {"valid": 0, "declaredStructureNormal": 1, "zeroNonRidgeWeight": 2, "gradientZero": 3, "tangentZero": 4, "parallel": 5},
            "order": [f"column.{index}" for index in range(17)],
        },
        "artifacts": {"basis": artifact(material_path, [6, 17], "float32-le"), "nativeCellIndex": artifact(native_path, [6], "uint32-le")},
        "execution": {"rowCount": 6, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False},
    }
    material_manifest["basis"]["order"][3:12] = list(MODULE.AXIS_ORDER)
    material_manifest["basis"]["order"][14] = "nonRidgeOpticalWeight"
    material_manifest["basis"]["order"][15] = "basis.valid"
    transverse_manifest_path = fixture / "transverse-manifest.json"
    material_manifest_path = fixture / "material-manifest.json"
    transverse_manifest_path.write_text(json.dumps(transverse_manifest))
    material_manifest_path.write_text(json.dumps(material_manifest))
    output = fixture / "output"
    command = (
        sys.executable, str(SCRIPT),
        "--transverse-manifest", str(transverse_manifest_path),
        "--transverse-manifest-sha256", sha256(transverse_manifest_path),
        "--material-manifest", str(material_manifest_path),
        "--material-manifest-sha256", sha256(material_manifest_path),
        "--output-dir", str(output),
    )
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    assert completed.returncode == 0, completed.stderr
    report = json.loads((output / "report.json").read_text())
    manifest = json.loads((output / "grid96-cohort-continuity-manifest.json").read_text())
    assert report["schema"] == MODULE.REPORT_SCHEMA and manifest["schema"] == MODULE.MANIFEST_SCHEMA
    assert report["status"] == "complete" and report["failurePhase"] is None
    assert report["execution"] == {"rowCount": 6, "edgeCount": 4, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False}
    assert report["cohorts"]["declaredStructure"]["rowCount"] == 5
    assert report["cohorts"]["missingNonRidgeMaterial"]["rowCount"] == 1
    assert report["cohorts"]["missingNonRidgeMaterial"]["isolatedOpticalMassFraction"] == 1.0
    assert manifest["artifacts"]["parentContinuity"]["shape"] == [6, len(MODULE.CONTINUITY_ORDER)]
    assert manifest["artifacts"]["edges"]["shape"] == [4, 3]

    forged_output = fixture / "forged-output"
    # Changing the expected SHA must fail before any complete output survives.
    forged_command = list(command)
    forged_command[forged_command.index("--material-manifest-sha256") + 1] = "8" * 64
    forged_command[forged_command.index("--output-dir") + 1] = str(forged_output)
    forged = subprocess.run(forged_command, capture_output=True, text=True, check=False)
    assert forged.returncode != 0
    failed = json.loads((forged_output / "report.json").read_text())
    assert failed["status"] == "failed" and failed["failurePhase"] == "source-validation"
    assert not (forged_output / "grid96-cohort-continuity-manifest.json").exists()

    semantic_manifest = json.loads(material_manifest_path.read_text())
    semantic_manifest["basis"]["identity"] = "plausible-but-unreviewed-material-frame-v0"
    semantic_manifest_path = fixture / "semantic-material-manifest.json"
    semantic_manifest_path.write_text(json.dumps(semantic_manifest))
    semantic_output = fixture / "semantic-output"
    semantic_command = list(command)
    semantic_command[semantic_command.index("--material-manifest") + 1] = str(semantic_manifest_path)
    semantic_command[semantic_command.index("--material-manifest-sha256") + 1] = sha256(semantic_manifest_path)
    semantic_command[semantic_command.index("--output-dir") + 1] = str(semantic_output)
    semantic = subprocess.run(semantic_command, capture_output=True, text=True, check=False)
    assert semantic.returncode != 0
    semantic_failed = json.loads((semantic_output / "report.json").read_text())
    assert semantic_failed["status"] == "failed" and semantic_failed["failurePhase"] == "source-validation"
    assert not (semantic_output / "grid96-cohort-continuity-manifest.json").exists()

    source_drift_manifest = json.loads(material_manifest_path.read_text())
    source_drift_manifest["source"]["descriptorArtifactSha256"] = "9" * 64
    source_drift_manifest_path = fixture / "source-drift-material-manifest.json"
    source_drift_manifest_path.write_text(json.dumps(source_drift_manifest))
    source_drift_output = fixture / "source-drift-output"
    source_drift_command = list(command)
    source_drift_command[source_drift_command.index("--material-manifest") + 1] = str(source_drift_manifest_path)
    source_drift_command[source_drift_command.index("--material-manifest-sha256") + 1] = sha256(source_drift_manifest_path)
    source_drift_command[source_drift_command.index("--output-dir") + 1] = str(source_drift_output)
    source_drift = subprocess.run(source_drift_command, capture_output=True, text=True, check=False)
    assert source_drift.returncode != 0
    source_drift_failed = json.loads((source_drift_output / "report.json").read_text())
    assert source_drift_failed["status"] == "failed" and source_drift_failed["failurePhase"] == "source-validation"
    assert not (source_drift_output / "grid96-cohort-continuity-manifest.json").exists()

    hollow_transverse_manifest = json.loads(transverse_manifest_path.read_text())
    hollow_material_manifest = json.loads(material_manifest_path.read_text())
    for hollow_manifest in (hollow_transverse_manifest, hollow_material_manifest):
        for field in ("descriptorArtifactSha256", "coefficientArtifactSha256", "sourceHashes", "simStepCount"):
            hollow_manifest["source"].pop(field)
    hollow_transverse_path = fixture / "hollow-transverse-manifest.json"
    hollow_material_path = fixture / "hollow-material-manifest.json"
    hollow_transverse_path.write_text(json.dumps(hollow_transverse_manifest))
    hollow_material_path.write_text(json.dumps(hollow_material_manifest))
    hollow_output = fixture / "hollow-output"
    hollow_command = list(command)
    hollow_command[hollow_command.index("--transverse-manifest") + 1] = str(hollow_transverse_path)
    hollow_command[hollow_command.index("--transverse-manifest-sha256") + 1] = sha256(hollow_transverse_path)
    hollow_command[hollow_command.index("--material-manifest") + 1] = str(hollow_material_path)
    hollow_command[hollow_command.index("--material-manifest-sha256") + 1] = sha256(hollow_material_path)
    hollow_command[hollow_command.index("--output-dir") + 1] = str(hollow_output)
    hollow = subprocess.run(hollow_command, capture_output=True, text=True, check=False)
    assert hollow.returncode != 0
    hollow_failed = json.loads((hollow_output / "report.json").read_text())
    assert hollow_failed["status"] == "failed" and hollow_failed["failurePhase"] == "source-validation"
    assert not (hollow_output / "grid96-cohort-continuity-manifest.json").exists()

    invented_transverse_manifest = json.loads(transverse_manifest_path.read_text())
    invented_material_manifest = json.loads(material_manifest_path.read_text())
    for invented_manifest in (invented_transverse_manifest, invented_material_manifest):
        invented_manifest["source"]["sourceHashes"]["inventedPayloadIdentity"] = "not-a-sha256"
    invented_transverse_path = fixture / "invented-transverse-manifest.json"
    invented_material_path = fixture / "invented-material-manifest.json"
    invented_transverse_path.write_text(json.dumps(invented_transverse_manifest))
    invented_material_path.write_text(json.dumps(invented_material_manifest))
    invented_output = fixture / "invented-output"
    invented_command = list(command)
    invented_command[invented_command.index("--transverse-manifest") + 1] = str(invented_transverse_path)
    invented_command[invented_command.index("--transverse-manifest-sha256") + 1] = sha256(invented_transverse_path)
    invented_command[invented_command.index("--material-manifest") + 1] = str(invented_material_path)
    invented_command[invented_command.index("--material-manifest-sha256") + 1] = sha256(invented_material_path)
    invented_command[invented_command.index("--output-dir") + 1] = str(invented_output)
    invented = subprocess.run(invented_command, capture_output=True, text=True, check=False)
    assert invented.returncode != 0
    invented_failed = json.loads((invented_output / "report.json").read_text())
    assert invented_failed["status"] == "failed" and invented_failed["failurePhase"] == "source-validation"
    assert not (invented_output / "grid96-cohort-continuity-manifest.json").exists()

    receiptless_material_manifest = json.loads(material_manifest_path.read_text())
    receiptless_material_manifest["source"].pop("exactSourceReceiptSha256")
    receiptless_material_path = fixture / "receiptless-material-manifest.json"
    receiptless_material_path.write_text(json.dumps(receiptless_material_manifest))
    receiptless_output = fixture / "receiptless-output"
    receiptless_command = list(command)
    receiptless_command[receiptless_command.index("--material-manifest") + 1] = str(receiptless_material_path)
    receiptless_command[receiptless_command.index("--material-manifest-sha256") + 1] = sha256(receiptless_material_path)
    receiptless_command[receiptless_command.index("--output-dir") + 1] = str(receiptless_output)
    receiptless = subprocess.run(receiptless_command, capture_output=True, text=True, check=False)
    assert receiptless.returncode != 0
    receiptless_failed = json.loads((receiptless_output / "report.json").read_text())
    assert receiptless_failed["status"] == "failed" and receiptless_failed["failurePhase"] == "source-validation"
    assert not (receiptless_output / "grid96-cohort-continuity-manifest.json").exists()

print("volume-grid96 cohort continuity characterizer contracts passed")
