#!/usr/bin/env python3

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
REDUCER_PATH = ROOT / "view-conditioned-transfer-compression.py"
WITNESS_PATH = ROOT / "view-conditioned-transfer-occluder-witness.py"
GEOMETRY_IDENTITY = "interleaved-intragroup-plates-v0"


def load(path: Path, name: str):
    if not path.is_file():
        raise AssertionError(f"{name} module is absent")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def write_fixture(root: Path) -> Path:
    reducer = load(REDUCER_PATH, "view_conditioned_transfer_occluder_fixture")
    depth_count, height, width = 8, 12, 16
    depths = np.linspace(1.0, 2.4, depth_count, dtype=np.float32)
    ridge = np.zeros((depth_count, height, width, 3), dtype=np.float32)
    nonridge = np.zeros_like(ridge)
    extinction = np.zeros((depth_count, height, width), dtype=np.float32)
    yy, xx = np.mgrid[:height, :width]
    for index in range(depth_count):
        cx = 4.0 + index
        support = ((xx - cx) ** 2 / 14.0 + (yy - 6.0) ** 2 / 28.0) < 1.0
        ridge[index, support, index % 3] = 0.14 + 0.025 * index
        nonridge[index, support, (index + 1) % 3] = 0.08 + 0.015 * index
        extinction[index, support] = 0.08 + 0.01 * index
    arrays_path = root / "transfer-field.npz"
    np.savez(
        arrays_path,
        depths=depths,
        ridge_radiance=ridge,
        nonridge_radiance=nonridge,
        extinction=extinction,
    )
    manifest = {
        "schema": reducer.INPUT_SCHEMA,
        "status": "complete",
        "source": {
            "identity": "occluder-contract-source-v0",
            "stateIdentity": "fixture-state-0",
            "cameraIdentity": "fixture-camera-0",
        },
        "route": {
            "requested": "synthetic-direct-v0",
            "effective": "synthetic-direct-v0",
            "backend": "numpy-cpu-v0",
            "fallbackUsed": False,
            "fallbackIdentity": None,
        },
        "transfer": {
            "identity": reducer.TRANSFER_IDENTITY,
            "depthOrder": reducer.DEPTH_ORDER,
            "radianceBoundary": reducer.RADIANCE_BOUNDARY,
            "transmittanceBoundary": reducer.TRANSMITTANCE_BOUNDARY,
            "shape": [depth_count, height, width],
        },
        "artifacts": {
            "arrays": {
                "path": arrays_path.name,
                "sha256": reducer.sha256_file(arrays_path),
                "bytes": arrays_path.stat().st_size,
            }
        },
    }
    manifest_path = root / "input-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest_path


def run_reducer(manifest_path: Path, out_dir: Path, tile_size: int) -> Path:
    completed = subprocess.run(
        [
            sys.executable,
            str(REDUCER_PATH),
            "--input-manifest",
            str(manifest_path),
            "--out-dir",
            str(out_dir),
            "--depth-groups",
            "4",
            "--tile-size",
            str(tile_size),
        ],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return out_dir / "report.json"


def run_witness(manifest_path: Path, treatments: list[tuple[str, Path]], out_dir: Path):
    command = [
        sys.executable,
        str(WITNESS_PATH),
        "--input-manifest",
        str(manifest_path),
        "--geometry",
        GEOMETRY_IDENTITY,
        "--occluder-rgb",
        "0,0,0",
        "--out-dir",
        str(out_dir),
    ]
    for label, report_path in treatments:
        command.extend(["--treatment", f"{label}={report_path}"])
    return subprocess.run(command, capture_output=True, text=True)


class TransferOccluderWitnessContracts(unittest.TestCase):
    def test_complete_witness_is_depth_interrupted_and_directly_inspectable(self):
        if not WITNESS_PATH.is_file():
            self.fail("view-conditioned transfer occluder witness is absent")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_fixture(root)
            treatment_t1 = run_reducer(manifest_path, root / "d4-t1", tile_size=1)
            treatment_t2 = run_reducer(manifest_path, root / "d4-t2", tile_size=2)
            out_dir = root / "witness"
            out_dir.mkdir()
            (out_dir / "stale.png").write_bytes(b"stale")
            completed = run_witness(
                manifest_path,
                [("d4-t1", treatment_t1), ("d4-t2", treatment_t2)],
                out_dir,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            report = json.loads((out_dir / "receipt.json").read_text())
            self.assertEqual(report["schema"], "kaminos.view-conditioned-transfer-occluder-witness.v0")
            self.assertEqual(report["status"], "complete")
            self.assertEqual(report["failurePhase"], None)
            self.assertEqual(report["requested"]["geometry"], GEOMETRY_IDENTITY)
            self.assertEqual(report["effective"]["geometry"], GEOMETRY_IDENTITY)
            self.assertEqual(report["effective"]["fallbackUsed"], False)
            self.assertEqual(report["roles"]["exactOccludedReference"], "exact-96-bin-scene-depth-interruption")
            self.assertEqual(report["roles"]["unoccludedReference"], "exact-96-bin-black-background-control")
            self.assertEqual(report["roles"]["treatments"], "persisted-compressed-transfer-scene-depth-interruption")
            self.assertEqual(report["geometry"]["depthSelectionPolicy"], "alternating-quarter-span-v0")
            self.assertEqual(report["geometry"]["plateCount"], 3)
            self.assertGreater(report["geometry"]["finitePixelCount"], 0)
            self.assertGreater(report["geometry"]["sourceActiveIntersectionPixelCount"], 0)
            self.assertEqual([item["label"] for item in report["treatments"]], ["d4-t1", "d4-t2"])
            for item in report["treatments"]:
                self.assertGreater(item["interiorOccluderPixelCount"], 0)
                self.assertEqual(
                    set(item["occludedLinearMetrics"]),
                    {"mae", "mse", "maxAbsError"},
                )
                self.assertEqual(
                    set(item["occlusionSpecificLinearMetrics"]),
                    {"mae", "mse", "maxAbsError"},
                )
                self.assertEqual(
                    set(item["unoccludedOccluderRegionLinearMetrics"]),
                    {"mae", "mse", "maxAbsError"},
                )
                self.assertIn("occludedToUnoccludedMaeRatio", item)
                self.assertIn("occluderRegionOccludedToUnoccludedMaeRatio", item)
                self.assertIn("occlusionSpecificToUnoccludedMaeRatio", item)
                self.assertEqual(item["metricReference"], "exact-occluded-reference.png")
            expected_images = {
                "unoccluded-reference.png",
                "exact-occluded-reference.png",
                "occluder-depth-map.png",
                "d4-t1-occluded.png",
                "d4-t1-occluded-residual.png",
                "d4-t1-occlusion-specific-residual.png",
                "d4-t2-occluded.png",
                "d4-t2-occluded-residual.png",
                "d4-t2-occlusion-specific-residual.png",
                "annotated-occluder-sheet.png",
            }
            self.assertTrue(expected_images.issubset(report["artifacts"]))
            for name in expected_images:
                image_path = out_dir / name
                self.assertTrue(image_path.is_file(), name)
                self.assertGreater(image_path.stat().st_size, 0, name)
                with Image.open(image_path) as image:
                    self.assertGreater(image.width, 0, name)
                    self.assertGreater(image.height, 0, name)
            self.assertNotEqual(
                (out_dir / "unoccluded-reference.png").read_bytes(),
                (out_dir / "exact-occluded-reference.png").read_bytes(),
            )
            self.assertFalse((out_dir / "stale.png").exists())

    def test_hash_drift_removes_stale_primaries_and_writes_failure_receipt(self):
        if not WITNESS_PATH.is_file():
            self.fail("view-conditioned transfer occluder witness is absent")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_fixture(root)
            report_path = run_reducer(manifest_path, root / "d4-t1", tile_size=1)
            treatment_path = report_path.parent / "treatment.npz"
            drifted = bytearray(treatment_path.read_bytes())
            drifted[-1] ^= 0x01
            treatment_path.write_bytes(drifted)
            out_dir = root / "witness"
            out_dir.mkdir()
            (out_dir / "annotated-occluder-sheet.png").write_bytes(b"stale")
            (out_dir / "d4-t1-occluded.png").write_bytes(b"stale")
            completed = run_witness(manifest_path, [("d4-t1", report_path)], out_dir)
            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse((out_dir / "annotated-occluder-sheet.png").exists())
            self.assertFalse((out_dir / "d4-t1-occluded.png").exists())
            report = json.loads((out_dir / "receipt.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "treatment-validation")
            self.assertEqual(report["artifacts"], {})
            self.assertIn("sha256", report["error"])

    def test_abbreviated_argument_fails_inside_durable_output_envelope(self):
        if not WITNESS_PATH.is_file():
            self.fail("view-conditioned transfer occluder witness is absent")
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "witness"
            out_dir.mkdir()
            (out_dir / "annotated-occluder-sheet.png").write_bytes(b"stale")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(WITNESS_PATH),
                    "--geomet",
                    GEOMETRY_IDENTITY,
                    "--out-dir",
                    str(out_dir),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse((out_dir / "annotated-occluder-sheet.png").exists())
            report = json.loads((out_dir / "receipt.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "argument-validation")
            self.assertEqual(report["artifacts"], {})
            self.assertIn("unrecognized arguments", report["error"])


if __name__ == "__main__":
    unittest.main()
