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
WITNESS_PATH = ROOT / "view-conditioned-transfer-witness.py"


def load(path: Path, name: str):
    if not path.is_file():
        raise AssertionError(f"{name} module is absent")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def write_fixture(root: Path) -> Path:
    reducer = load(REDUCER_PATH, "view_conditioned_transfer_compression_fixture")
    depths = np.asarray([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
    ridge = np.zeros((4, 4, 4, 3), dtype=np.float32)
    nonridge = np.zeros_like(ridge)
    extinction = np.zeros((4, 4, 4), dtype=np.float32)
    ridge[0, 1:3, 1:3, 0] = 0.8
    nonridge[1, 1:3, 1:3, 1] = 0.4
    ridge[2, 0:2, 0:2, 2] = 0.3
    extinction[0, 1:3, 1:3] = np.log(2.0)
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
            "identity": "witness-contract-source-v0",
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
            "shape": [4, 4, 4],
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


def run_reducer(manifest_path: Path, out_dir: Path) -> Path:
    completed = subprocess.run(
        [
            sys.executable,
            str(REDUCER_PATH),
            "--input-manifest",
            str(manifest_path),
            "--out-dir",
            str(out_dir),
            "--depth-groups",
            "2",
            "--tile-size",
            "2",
        ],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return out_dir / "report.json"


def run_witness(manifest_path: Path, target_path: Path, treatment_report: Path, out_dir: Path):
    return subprocess.run(
        [
            sys.executable,
            str(WITNESS_PATH),
            "--input-manifest",
            str(manifest_path),
            "--analytical-target",
            str(target_path),
            "--treatment",
            f"d2-t2={treatment_report}",
            "--out-dir",
            str(out_dir),
        ],
        capture_output=True,
        text=True,
    )


class TransferWitnessContracts(unittest.TestCase):
    def test_complete_witness_preserves_explicit_roles_and_direct_images(self):
        if not WITNESS_PATH.is_file():
            self.fail("view-conditioned transfer witness is absent")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_fixture(root)
            treatment_report = run_reducer(manifest_path, root / "treatment")
            target_path = root / "analytical-target.png"
            Image.fromarray(np.full((4, 4, 3), 80, dtype=np.uint8), mode="RGB").save(target_path)
            out_dir = root / "witness"
            completed = run_witness(manifest_path, target_path, treatment_report, out_dir)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            report = json.loads((out_dir / "receipt.json").read_text())
            self.assertEqual(report["status"], "complete")
            self.assertEqual(report["metricReferenceRole"], "exact-adapted-96-bin-transfer-reference")
            self.assertEqual(report["analyticalTargetRole"], "context-only-not-metric-reference")
            self.assertEqual([item["label"] for item in report["treatments"]], ["d2-t2"])
            self.assertEqual(report["treatments"][0]["metricReference"], "adapted-reference.png")
            self.assertEqual(
                report["treatments"][0]["linearMetricsBasis"],
                "reloaded-persisted-treatment-v0",
            )
            self.assertIn("producerInMemoryLinearMetrics", report["treatments"][0])
            self.assertEqual(
                set(report["treatments"][0]["serializationMetricDelta"]),
                {"mae", "mse", "maxAbsError"},
            )
            for name in (
                "analytical-target.png",
                "adapted-reference.png",
                "d2-t2.png",
                "d2-t2-residual.png",
                "annotated-reduction-sheet.png",
            ):
                image_path = out_dir / name
                self.assertTrue(image_path.is_file(), name)
                self.assertGreater(image_path.stat().st_size, 0, name)
                with Image.open(image_path) as image:
                    self.assertGreater(image.width, 0)
                    self.assertGreater(image.height, 0)

    def test_hash_drift_removes_stale_primary_and_writes_failure_receipt(self):
        if not WITNESS_PATH.is_file():
            self.fail("view-conditioned transfer witness is absent")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_fixture(root)
            treatment_report = run_reducer(manifest_path, root / "treatment")
            treatment_path = root / "treatment" / "treatment.npz"
            drifted = bytearray(treatment_path.read_bytes())
            drifted[-1] ^= 0x01
            treatment_path.write_bytes(drifted)
            target_path = root / "analytical-target.png"
            Image.fromarray(np.zeros((4, 4, 3), dtype=np.uint8), mode="RGB").save(target_path)
            out_dir = root / "witness"
            out_dir.mkdir()
            (out_dir / "annotated-reduction-sheet.png").write_bytes(b"stale")
            completed = run_witness(manifest_path, target_path, treatment_report, out_dir)
            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse((out_dir / "annotated-reduction-sheet.png").exists())
            report = json.loads((out_dir / "receipt.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "treatment-validation")
            self.assertIn("sha256", report["error"])


if __name__ == "__main__":
    unittest.main()
