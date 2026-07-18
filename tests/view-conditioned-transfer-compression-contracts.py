#!/usr/bin/env python3

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "view-conditioned-transfer-compression.py"


def load_module():
    if not SCRIPT.is_file():
        raise AssertionError(
            "view-conditioned transfer reducer module is absent; "
            "the fail-first optical contract has no implementation"
        )
    spec = importlib.util.spec_from_file_location("view_conditioned_transfer_compression", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_fixture(root: Path, *, fallback_used: bool = False) -> Path:
    depths = np.asarray([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
    ridge = np.zeros((4, 4, 4, 3), dtype=np.float32)
    nonridge = np.zeros_like(ridge)
    extinction = np.zeros((4, 4, 4), dtype=np.float32)
    ridge[0, 1:3, 1:3, 0] = 0.4
    nonridge[1, 1:3, 1:3, 1] = 0.3
    ridge[2, 0:2, 0:2, 2] = 0.2
    extinction[0, 1:3, 1:3] = np.log(2.0)
    extinction[1, 1:3, 1:3] = np.log(4.0)
    arrays_path = root / "transfer-field.npz"
    np.savez(
        arrays_path,
        depths=depths,
        ridge_radiance=ridge,
        nonridge_radiance=nonridge,
        extinction=extinction,
    )
    manifest = {
        "schema": "kaminos.view-conditioned-transfer-input.v0",
        "status": "complete",
        "source": {
            "identity": "synthetic-transfer-contract-v0",
            "stateIdentity": "fixture-state-0",
            "cameraIdentity": "fixture-camera-0",
        },
        "route": {
            "requested": "synthetic-direct-v0",
            "effective": "synthetic-direct-v0",
            "backend": "numpy-cpu-v0",
            "fallbackUsed": fallback_used,
            "fallbackIdentity": "counterfeit-fallback" if fallback_used else None,
        },
        "transfer": {
            "identity": "ordered-ridge-nonridge-shared-transmittance-v0",
            "depthOrder": "near-to-far",
            "radianceBoundary": "premultiplied-per-depth-slice-v0",
            "transmittanceBoundary": "exp-negative-extinction-v0",
            "shape": [4, 4, 4],
        },
        "artifacts": {
            "arrays": {
                "path": arrays_path.name,
                "sha256": sha256_file(arrays_path),
                "bytes": arrays_path.stat().st_size,
            }
        },
    }
    manifest_path = root / "input-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest_path


class TransferAlgebraContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_ordered_composition_is_associative_and_not_commutative(self):
        m = self.module
        front = m.Transfer(
            radiance=np.asarray([0.4, 0.0, 0.0]),
            transmittance=np.asarray(0.5),
        )
        middle = m.Transfer(
            radiance=np.asarray([0.0, 0.6, 0.0]),
            transmittance=np.asarray(0.25),
        )
        back = m.Transfer(
            radiance=np.asarray([0.0, 0.0, 0.8]),
            transmittance=np.asarray(0.75),
        )
        left = m.compose_transfer(m.compose_transfer(front, middle), back)
        right = m.compose_transfer(front, m.compose_transfer(middle, back))
        reverse = m.compose_transfer(back, m.compose_transfer(middle, front))
        self.assertTrue(np.allclose(left.radiance, [0.4, 0.3, 0.1]))
        self.assertTrue(np.allclose(left.radiance, right.radiance))
        self.assertTrue(np.allclose(left.transmittance, right.transmittance))
        self.assertFalse(np.allclose(left.radiance, reverse.radiance))
        self.assertAlmostEqual(float(left.transmittance), 0.09375)

    def test_identity_and_split_recompose_are_exact(self):
        m = self.module
        rng = np.random.default_rng(713)
        radiance = rng.random((6, 3, 2, 6), dtype=np.float32)
        extinction = rng.random((6, 3, 2), dtype=np.float32)
        slices = m.transfer_slices(radiance, extinction)
        reference = m.compose_transfer_sequence(slices)
        identity = m.identity_transfer((3, 2), channels=6)
        self.assertTrue(np.array_equal(m.compose_transfer(identity, reference).radiance, reference.radiance))
        grouped = m.group_depth_slices(slices, group_count=3)
        recomposed = m.compose_transfer_sequence(grouped)
        self.assertTrue(np.allclose(reference.radiance, recomposed.radiance, atol=2e-7))
        self.assertTrue(np.allclose(reference.transmittance, recomposed.transmittance, atol=2e-7))

    def test_opaque_occluder_excludes_back_layers(self):
        m = self.module
        depths = np.asarray([1.0, 3.0], dtype=np.float32)
        radiance = np.asarray(
            [
                [[[[0.4, 0.0, 0.0]]]],
                [[[[0.0, 0.0, 0.8]]]],
            ],
            dtype=np.float32,
        ).reshape(2, 1, 1, 3)
        extinction = np.asarray([[[np.log(2.0)]], [[0.0]]], dtype=np.float32)
        result = m.render_with_opaque_occluder(
            m.transfer_slices(radiance, extinction),
            depths,
            occluder_depth=np.asarray([[2.0]], dtype=np.float32),
            occluder_radiance=np.asarray([1.0, 1.0, 1.0], dtype=np.float32),
        )
        self.assertTrue(np.allclose(result, [[[0.9, 0.5, 0.5]]], atol=1e-7))


class ReducerAndEvidenceContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_tile_one_depth_grouping_preserves_reference(self):
        m = self.module
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = write_fixture(Path(tmp))
            source = m.load_transfer_input(manifest_path)
            treatment = m.reduce_transfer_field(source, depth_groups=2, tile_size=1)
            reference = m.render_transfer_field(source)
            rendered = m.render_reduced_transfer(treatment)
            self.assertTrue(np.allclose(reference, rendered, atol=2e-7))
            self.assertEqual(treatment.element_count, 2 * 4 * 4)
            self.assertEqual(treatment.source_depth_slice_count, 4)
            self.assertTrue(np.allclose(treatment.depths, [1.5, 3.5]))
            self.assertGreater(treatment.active_element_count, 0)
            self.assertLessEqual(treatment.active_element_count, treatment.element_count)

    def test_equal_budget_pruning_keeps_exactly_ranked_active_elements(self):
        m = self.module
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = write_fixture(Path(tmp))
            source = m.load_transfer_input(manifest_path)
            pruned = m.prune_transfer_field(source, element_budget=3)
            self.assertEqual(pruned.active_element_count, 3)
            self.assertEqual(pruned.element_count, 4 * 4 * 4)
            self.assertEqual(pruned.source_depth_slice_count, 4)

    def test_reduced_occluder_render_uses_group_depth_representatives(self):
        m = self.module
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = write_fixture(Path(tmp))
            source = m.load_transfer_input(manifest_path)
            treatment = m.reduce_transfer_field(source, depth_groups=2, tile_size=1)
            occluder_depth = np.full((4, 4), np.inf, dtype=np.float32)
            occluder_depth[1:3, 1:3] = 2.5
            occluder_color = np.asarray([0.5, 0.5, 0.5], dtype=np.float32)
            exact = m.render_transfer_field_with_occluder(source, occluder_depth, occluder_color)
            reduced = m.render_reduced_transfer_with_occluder(treatment, occluder_depth, occluder_color)
            self.assertTrue(np.allclose(exact, reduced, atol=2e-7))

    def test_intra_group_occluder_error_is_explicitly_non_closing(self):
        m = self.module
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = write_fixture(Path(tmp))
            source = m.load_transfer_input(manifest_path)
            treatment = m.reduce_transfer_field(source, depth_groups=2, tile_size=1)
            occluder_depth = np.full((4, 4), np.inf, dtype=np.float32)
            occluder_depth[1:3, 1:3] = 1.5
            occluder_color = np.zeros(3, dtype=np.float32)
            exact = m.render_transfer_field_with_occluder(source, occluder_depth, occluder_color)
            reduced = m.render_reduced_transfer_with_occluder(treatment, occluder_depth, occluder_color)
            self.assertFalse(np.allclose(exact, reduced))
            authority = m.occlusion_authority(treatment)
            self.assertEqual(authority["status"], "non-closing")
            self.assertEqual(authority["representativeDepthPolicy"], "arithmetic-mean-source-depth-centers-v0")
            self.assertEqual(authority["sourceDepthCenterSpans"], [[1.0, 2.0], [3.0, 4.0]])
            self.assertTrue(authority["opaqueGeometryInsideGroupCanBeWrong"])

    def test_fallback_and_hash_drift_are_rejected(self):
        m = self.module
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_manifest = write_fixture(root, fallback_used=True)
            with self.assertRaisesRegex(ValueError, "fallback"):
                m.load_transfer_input(fallback_manifest)
            valid_manifest = write_fixture(root)
            arrays = root / "transfer-field.npz"
            drifted = bytearray(arrays.read_bytes())
            drifted[-1] ^= 0x01
            arrays.write_bytes(drifted)
            with self.assertRaisesRegex(ValueError, "sha256"):
                m.load_transfer_input(valid_manifest)

    def test_cli_failure_before_primary_output_leaves_durable_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_fixture(root, fallback_used=True)
            out_dir = root / "out"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
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
            self.assertNotEqual(completed.returncode, 0)
            report_path = out_dir / "report.json"
            self.assertTrue(report_path.is_file())
            report = json.loads(report_path.read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "input-validation")
            self.assertIn("fallback", report["error"])
            self.assertFalse((out_dir / "treatment.npz").exists())
            self.assertEqual(report["requested"]["depthGroups"], 2)
            self.assertEqual(report["requested"]["tileSize"], 2)

    def test_complete_report_exposes_scalar_source_identity_and_occlusion_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = write_fixture(root)
            out_dir = root / "out"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
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
            self.assertEqual(completed.returncode, 0, completed.stderr)
            report = json.loads((out_dir / "report.json").read_text())
            self.assertEqual(report["source"]["sourceIdentity"], "synthetic-transfer-contract-v0")
            self.assertEqual(report["source"]["stateIdentity"], "fixture-state-0")
            self.assertEqual(report["source"]["cameraIdentity"], "fixture-camera-0")
            self.assertIsInstance(report["source"]["sourceIdentity"], str)
            self.assertEqual(report["effective"]["occlusionAuthority"]["status"], "non-closing")


if __name__ == "__main__":
    unittest.main()
