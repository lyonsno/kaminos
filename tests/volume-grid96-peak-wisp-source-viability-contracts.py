#!/usr/bin/env python3
"""Contracts for the streaming Grid96 peak/wisp source viability audit."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-peak-wisp-source-viability.py"
REGISTRY_SCRIPT = ROOT / "volume-grid96-peak-wisp-source-registry.py"
spec = importlib.util.spec_from_file_location("grid96_registry_contract", REGISTRY_SCRIPT)
assert spec is not None and spec.loader is not None
REGISTRY = importlib.util.module_from_spec(spec)
spec.loader.exec_module(REGISTRY)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def artifact(path: Path, values: np.ndarray, role: str) -> dict[str, object]:
    values.tofile(path)
    dtype = "float32-le" if values.dtype == np.dtype("<f4") else "uint32-le"
    if values.dtype == np.dtype("uint8"):
        dtype = "uint8"
    return {
        "path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path),
        "dtype": dtype, "shape": list(values.shape), "semanticRole": role,
    }


with tempfile.TemporaryDirectory(prefix="kaminos-grid96-source-viability-") as temp:
    fixture = Path(temp)
    row_count = 4
    native = np.asarray((0, 1, 96, 97), dtype="<u4")
    positions = np.asarray((
        (-1.0, 0.0, 0.0), (-0.5, 0.25, 0.0),
        (0.0, 0.5, 0.25), (0.5, 0.75, 0.5),
    ), dtype="<f4")

    descriptors = np.zeros((row_count, len(REGISTRY.DESCRIPTOR_ORDER)), dtype="<f4")
    descriptors[:, :3] = positions
    descriptors[:, 3] = native
    descriptors[:, 4] = (0.0, 0.25, 0.5, 1.0)
    descriptors[:, 27] = (1.0, 2.0, 3.0, 4.0)
    coefficients = np.zeros((row_count, len(REGISTRY.COEFFICIENT_ORDER)), dtype="<f4")
    coefficients[:, 3] = (0.0, 0.1, 0.2, 0.3)
    coefficients[:, 7] = (0.4, 0.3, 0.2, 0.1)
    transverse = np.zeros((row_count, len(REGISTRY.TRANSVERSE_ORDER)), dtype="<f4")
    transverse[:, :3] = positions
    transverse[:, 3] = 1.0
    transverse[:, 7] = 1.0
    transverse[:, 11] = 1.0
    transverse[:, 19] = 1.0
    material = np.zeros((row_count, len(REGISTRY.MATERIAL_ORDER)), dtype="<f4")
    material[:, :3] = positions
    material[:, 3] = 1.0
    material[:, 7] = 1.0
    material[:, 11] = 1.0
    material[:, 15] = 1.0
    continuity = np.zeros((row_count, len(REGISTRY.CONTINUITY_ORDER)), dtype="<f4")
    continuity[:, 0] = (1, 1, 2, 2)
    continuity[:, 1] = (0.1, 0.2, 0.3, 0.4)
    continuity[:, 2] = (1, 2, 2, 1)
    continuity[:, 12] = 1.0
    transverse_reasons = np.asarray((0, 0, 1, 1), dtype=np.uint8)
    material_reasons = np.asarray((1, 1, 0, 0), dtype=np.uint8)
    edges = np.asarray(((0, 1, 0), (2, 3, 0)), dtype="<u4")

    native_receipt = artifact(fixture / "native.u32", native, "caller-ordered-native-cell-index")
    family_values = {
        "descriptors": (descriptors, tuple(REGISTRY.DESCRIPTOR_ORDER)),
        "coefficients": (coefficients, tuple(REGISTRY.COEFFICIENT_ORDER)),
        "transverseBasis": (transverse, tuple(REGISTRY.TRANSVERSE_ORDER)),
        "materialBasis": (material, tuple(REGISTRY.MATERIAL_ORDER)),
        "cohortContinuity": (continuity, tuple(REGISTRY.CONTINUITY_ORDER)),
    }
    families = {}
    for index, (name, (values, order)) in enumerate(family_values.items(), start=1):
        families[name] = {
            "manifest": {"path": str(fixture / f"{name}-manifest.json"), "sha256": str(index) * 64, "schema": f"fixture.{name}.v0", "identity": f"fixture-{name}-v0"},
            "order": list(order),
            "artifact": artifact(fixture / f"{name}.f32", values, f"fixture-{name}"),
        }
    families["transverseBasis"]["reasonCodes"] = artifact(fixture / "transverse-reasons.u8", transverse_reasons, "transverse-reasons")
    families["materialBasis"]["reasonCodes"] = artifact(fixture / "material-reasons.u8", material_reasons, "material-reasons")
    families["cohortContinuity"]["edges"] = artifact(fixture / "edges.u32", edges, "same-cohort-edges")

    registry = {
        "schema": "kaminos.volume.grid96-peak-wisp-source-registry.v0", "status": "complete",
        "identity": "sha256:" + "a" * 64, "grid": 96, "rowCount": row_count,
        "sameStateCaptureId": "fixture-grid96-state120", "simStepCount": 120,
        "nativeCellIndexSha256": native_receipt["sha256"], "nativeCellIndex": native_receipt,
        "route": {"requested": "http://127.0.0.1:19096/?volume_resolution=96", "effective": "native-3d-compute-fluid-raymarch-v0", "backend": "WebGPU:apple", "fallbackReason": None},
        "sourceHashes": {"fluidSha256": "b" * 64, "frontSha256": "c" * 64, "boundarySidecarSha256": "d" * 64, "majorantSha256": "e" * 64},
        "componentSourceManifestSha256": "f" * 64, "featureFamilies": families,
        "execution": {"rowCount": row_count, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "copiedPayloadBytes": 0},
        "claimBoundary": {"sourceRegistryOnly": True, "attributionAttached": False, "featureSelectionPerformed": False, "learnerStarted": False, "placementChosen": False, "depositionAdjudicated": False, "rendererClaimMade": False, "productClaimMade": False},
    }
    registry_path = fixture / "registry.json"
    registry_path.write_text(json.dumps(registry, sort_keys=True))

    loader = (
        "import importlib.util,sys;"
        f"s=importlib.util.spec_from_file_location('grid96_viability',{str(SCRIPT)!r});"
        "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
        "m.EXACT_PARENT_COUNT=4;raise SystemExit(m.main())"
    )
    output = fixture / "output"
    command = [sys.executable, "-c", loader, "--registry", str(registry_path), "--registry-sha256", sha256(registry_path), "--output-dir", str(output)]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    assert completed.returncode == 0, completed.stderr
    report = json.loads((output / "report.json").read_text())
    viability_path = output / "grid96-peak-wisp-source-viability.json"
    viability = json.loads(viability_path.read_text())
    assert report["status"] == "complete" and report["failurePhase"] is None
    assert viability["schema"] == "kaminos.volume.grid96-peak-wisp-source-viability.v0"
    assert viability["rowCount"] == row_count and viability["registrySha256"] == sha256(registry_path)
    assert viability["rowAlignment"] == {"descriptorNativeCellIndexExact": True, "transverseCentersExact": True, "materialCentersExact": True}
    assert viability["execution"] == {"rowCount": row_count, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "copiedPayloadBytes": 0}
    descriptor_stats = viability["families"]["descriptors"]["columns"]
    assert descriptor_stats[4]["name"] == "kernel.normalizedMass"
    assert descriptor_stats[4]["minimum"] == 0.0 and descriptor_stats[4]["maximum"] == 1.0
    assert descriptor_stats[4]["mean"] == 0.4375 and descriptor_stats[4]["zeroFraction"] == 0.25
    assert descriptor_stats[5]["constant"] is True
    assert all(column["nonfiniteCount"] == 0 for family in viability["families"].values() for column in family["columns"])
    assert viability["reasonCodeDistributions"]["transverseBasis"] == {"0": 2, "1": 2}
    assert viability["reasonCodeDistributions"]["materialBasis"] == {"0": 2, "1": 2}
    assert sorted(path.name for path in output.iterdir()) == ["grid96-peak-wisp-source-viability.json", "report.json"]

    def run_mutation(name: str, mutate_registry=None, mutate_payload=None, mutate_aux_payload=None, expected_phase="source-characterization"):
        forged_registry = deepcopy(registry)
        forged_dir = fixture / name
        forged_dir.mkdir()
        if mutate_payload is not None:
            family, mutator = mutate_payload
            original = np.fromfile(forged_registry["featureFamilies"][family]["artifact"]["path"], dtype="<f4").reshape(forged_registry["featureFamilies"][family]["artifact"]["shape"])
            forged_values = original.copy()
            mutator(forged_values)
            forged_receipt = artifact(forged_dir / f"{family}.f32", forged_values, forged_registry["featureFamilies"][family]["artifact"]["semanticRole"])
            forged_registry["featureFamilies"][family]["artifact"] = forged_receipt
        if mutate_aux_payload is not None:
            family, receipt_key, dtype, mutator = mutate_aux_payload
            receipt = forged_registry["featureFamilies"][family][receipt_key]
            original = np.fromfile(receipt["path"], dtype=dtype).reshape(receipt["shape"])
            forged_values = original.copy()
            mutator(forged_values)
            suffix = "u8" if forged_values.dtype == np.dtype("uint8") else "u32"
            forged_registry["featureFamilies"][family][receipt_key] = artifact(
                forged_dir / f"{family}-{receipt_key}.{suffix}", forged_values, receipt["semanticRole"]
            )
        if mutate_registry is not None:
            mutate_registry(forged_registry)
        forged_path = forged_dir / "registry.json"
        forged_path.write_text(json.dumps(forged_registry, sort_keys=True))
        forged_output = forged_dir / "output"
        forged_output.mkdir()
        (forged_output / "grid96-peak-wisp-source-viability.json").write_text('{"status":"complete"}')
        (forged_output / "unrelated.bin").write_bytes(b"keep")
        forged_command = list(command)
        forged_command[forged_command.index("--registry") + 1] = str(forged_path)
        forged_command[forged_command.index("--registry-sha256") + 1] = sha256(forged_path)
        forged_command[forged_command.index("--output-dir") + 1] = str(forged_output)
        failed = subprocess.run(forged_command, capture_output=True, text=True, check=False)
        assert failed.returncode != 0, name
        failure = json.loads((forged_output / "report.json").read_text())
        assert failure["status"] == "failed" and failure["failurePhase"] == expected_phase, name
        assert not (forged_output / "grid96-peak-wisp-source-viability.json").exists(), name
        assert (forged_output / "unrelated.bin").read_bytes() == b"keep", name

    run_mutation("payload-hash-drift", lambda value: value["featureFamilies"]["descriptors"]["artifact"].__setitem__("sha256", "9" * 64))
    run_mutation("registry-cap", lambda value: value["execution"].__setitem__("sampleCap", 2), expected_phase="registry-validation")
    run_mutation("fallback-route", lambda value: value["route"].__setitem__("fallbackReason", "fixture-fallback"), expected_phase="registry-validation")
    run_mutation("nonfinite-descriptor", mutate_payload=("descriptors", lambda values: values.__setitem__((2, 4), np.nan)))
    run_mutation("negative-coefficient", mutate_payload=("coefficients", lambda values: values.__setitem__((1, 3), -0.25)))
    run_mutation("native-row-drift", mutate_payload=("descriptors", lambda values: values.__setitem__((1, 3), 97.0)))
    run_mutation("transverse-center-drift", mutate_payload=("transverseBasis", lambda values: values.__setitem__((2, 0), 0.75)))
    run_mutation("material-center-drift", mutate_payload=("materialBasis", lambda values: values.__setitem__((3, 2), 0.75)))
    run_mutation(
        "reason-code-overflow",
        mutate_aux_payload=("transverseBasis", "reasonCodes", "u1", lambda values: values.__setitem__(2, 5)),
    )
    run_mutation(
        "edge-row-overflow",
        mutate_aux_payload=("cohortContinuity", "edges", "<u4", lambda values: values.__setitem__((0, 0), row_count)),
    )
    run_mutation(
        "edge-axis-overflow",
        mutate_aux_payload=("cohortContinuity", "edges", "<u4", lambda values: values.__setitem__((0, 2), 3)),
    )

    mismatch_output = fixture / "registry-sha-mismatch"
    mismatch_command = list(command)
    mismatch_command[mismatch_command.index("--registry-sha256") + 1] = "0" * 64
    mismatch_command[mismatch_command.index("--output-dir") + 1] = str(mismatch_output)
    mismatch = subprocess.run(mismatch_command, capture_output=True, text=True, check=False)
    assert mismatch.returncode != 0
    mismatch_report = json.loads((mismatch_output / "report.json").read_text())
    assert mismatch_report["failurePhase"] == "registry-validation"
    assert mismatch_report["requested"]["expectedRegistrySha256"] == "0" * 64
    assert mismatch_report["requested"]["actualRegistrySha256"] == sha256(registry_path)

    hostile_output = fixture / "hostile-primary-output"
    hostile_output.mkdir()
    (hostile_output / "grid96-peak-wisp-source-viability.json").mkdir()
    (hostile_output / "unrelated.bin").write_bytes(b"keep")
    hostile_command = list(command)
    hostile_command[hostile_command.index("--output-dir") + 1] = str(hostile_output)
    hostile = subprocess.run(hostile_command, capture_output=True, text=True, check=False)
    assert hostile.returncode != 0
    hostile_report = json.loads((hostile_output / "report.json").read_text())
    assert hostile_report["status"] == "failed" and hostile_report["failurePhase"] == "registry-validation"
    assert hostile_report["requested"]["registry"] == str(registry_path.resolve())
    assert hostile_report["requested"]["expectedRegistrySha256"] == sha256(registry_path)
    assert (hostile_output / "grid96-peak-wisp-source-viability.json").is_dir()
    assert (hostile_output / "unrelated.bin").read_bytes() == b"keep"

print("volume grid96 peak/wisp source viability contracts passed")
