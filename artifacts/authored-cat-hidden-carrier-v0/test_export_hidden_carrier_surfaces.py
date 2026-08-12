import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
ASSAY = ROOT / "evidence/uniform-inset-medium-scapular-v0"
SOURCE = REPO / "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb"
REPORT_SHA256 = "961ee182de2e3899a6454280aef1a77cd65b0e901e2973a514d244a17f2b3c89"
sys.path.insert(0, str(ROOT))

import export_hidden_carrier_surfaces as exporter  # noqa: E402
from hidden_carrier_fixture import _accessor_array, _glb_chunks, load_glb_surface  # noqa: E402


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def primitive_arrays(path):
    document, binary = _glb_chunks(Path(path))
    primitive = document["meshes"][0]["primitives"][0]
    positions = _accessor_array(document, binary, primitive["attributes"]["POSITION"])
    indices = _accessor_array(document, binary, primitive["indices"]).reshape(-1).astype(np.int64)
    return document, positions, indices


class HiddenCarrierSurfaceExportTest(unittest.TestCase):
    def test_exports_exact_topology_surfaces_and_comparison_glb(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "surfaces"
            receipt = exporter.export_surfaces(
                repo_root=REPO,
                source_path=SOURCE,
                assay_dir=ASSAY,
                output_dir=output,
                expected_report_sha256=REPORT_SHA256,
            )

            self.assertEqual(receipt["status"], "captured")
            self.assertTrue(receipt["terminal"])
            self.assertTrue(receipt["visualArtifactsValidated"])
            self.assertEqual(receipt["operatorVisualAdmission"], "not-requested")
            self.assertEqual(receipt["topology"]["triangleCount"], 1891)
            self.assertEqual(receipt["topology"]["componentCount"], 936)
            self.assertEqual(receipt["topology"]["boundaryEdgeCount"], 3765)
            self.assertEqual(receipt["topology"]["nonManifoldEdgeCount"], 0)
            self.assertEqual(receipt["topology"]["degenerateTriangleCount"], 0)
            self.assertEqual(
                receipt["topology"]["surfaceClass"],
                "open-disconnected-triangle-surface",
            )

            recovered_path = output / "uniform-recovery-surface.glb"
            document, recovered_positions, recovered_indices = primitive_arrays(recovered_path)
            expected_recovered = np.load(ASSAY / "recovered-carrier.npz")["positions"]
            authored_world = load_glb_surface(SOURCE)["positions"]
            presentation_center = (authored_world.min(axis=0) + authored_world.max(axis=0)) * 0.5
            np.testing.assert_allclose(
                recovered_positions + presentation_center,
                expected_recovered,
                atol=4e-6,
            )
            np.testing.assert_allclose(
                receipt["presentationTransform"]["sourceWorldCenter"],
                presentation_center,
                atol=1e-12,
            )
            np.testing.assert_allclose(
                receipt["presentationTransform"]["exportTranslation"],
                -presentation_center,
                atol=1e-12,
            )
            self.assertEqual(
                receipt["presentationTransform"]["contract"],
                "rigid-translation-and-rotation-only-no-shape-change",
            )
            self.assertEqual(
                receipt["presentationTransform"]["viewerRotationQuaternion"],
                [0.0, 0.0, 1.0, 0.0],
            )
            self.assertEqual(recovered_indices.size, 5673)
            self.assertEqual(document["nodes"][0]["name"], "UNIFORM-INSET RECOVERY")
            self.assertEqual(document["nodes"][0]["rotation"], [0.0, 0.0, 1.0, 0.0])
            self.assertTrue(document["materials"][0]["doubleSided"])

            authored_path = output / "authored-carrier-surface.glb"
            _, authored_positions, authored_indices = primitive_arrays(authored_path)
            np.testing.assert_allclose(
                authored_positions + presentation_center,
                authored_world,
                atol=4e-6,
            )
            np.testing.assert_array_equal(recovered_indices, authored_indices)

            observed_path = output / "synthetic-coat-surface.glb"
            _, observed_positions, observed_indices = primitive_arrays(observed_path)
            expected_observed = np.load(ASSAY / "observation.npz")["observedPositions"]
            np.testing.assert_allclose(
                observed_positions + presentation_center,
                expected_observed,
                atol=4e-6,
            )
            np.testing.assert_array_equal(recovered_indices, observed_indices)

            comparison_path = output / "carrier-coat-recovery-comparison.glb"
            comparison_document, _ = _glb_chunks(comparison_path)
            self.assertEqual(len(comparison_document["nodes"]), 3)
            self.assertEqual(
                [node["name"] for node in comparison_document["nodes"]],
                [
                    "AUTHORED HIDDEN CARRIER",
                    "SYNTHETIC OBSERVED COAT",
                    "UNIFORM-INSET RECOVERY",
                ],
            )
            self.assertEqual(len(comparison_document["materials"]), 3)
            self.assertEqual(len(comparison_document["meshes"]), 3)

            for name, artifact in receipt["artifacts"].items():
                path = output / artifact["path"]
                self.assertGreater(path.stat().st_size, 10_000, name)
                self.assertEqual(artifact["sha256"], sha256(path))
            self.assertEqual(
                json.loads((output / "surface-export-report.json").read_text()),
                receipt,
            )
            self.assertNotIn(str(REPO.resolve()), json.dumps(receipt, sort_keys=True))

    def test_wrong_report_digest_fails_without_stale_glbs(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "surfaces"
            output.mkdir(parents=True)
            stale = output / "uniform-recovery-surface.glb"
            stale.write_bytes(b"stale")
            receipt = exporter.export_surfaces(
                repo_root=REPO,
                source_path=SOURCE,
                assay_dir=ASSAY,
                output_dir=output,
                expected_report_sha256="0" * 64,
            )
            self.assertEqual(receipt["status"], "failed")
            self.assertEqual(receipt["failurePhase"], "input-validation")
            self.assertFalse(receipt["visualArtifactsValidated"])
            self.assertIn("report digest mismatch", receipt["reason"])
            self.assertFalse(stale.exists())


if __name__ == "__main__":
    unittest.main()
