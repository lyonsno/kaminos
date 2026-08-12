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

import export_hidden_carrier_registered_diagnostics as diagnostics  # noqa: E402
from hidden_carrier_fixture import _accessor_array, _glb_chunks  # noqa: E402


class HiddenCarrierRegisteredDiagnosticsTest(unittest.TestCase):
    def test_exports_exact_mask_and_registered_vector_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "registered"
            receipt = diagnostics.export_registered_diagnostics(
                repo_root=REPO,
                source_path=SOURCE,
                assay_dir=ASSAY,
                output_dir=output,
                expected_report_sha256=REPORT_SHA256,
            )

            self.assertEqual(receipt["status"], "captured")
            self.assertTrue(receipt["terminal"])
            self.assertEqual(
                receipt["region"]["honestLabel"],
                "bounded-dorsal-ap-procedural-support-v0",
            )
            self.assertEqual(receipt["region"]["anatomicalInterpretation"], "unverified")
            self.assertEqual(receipt["region"]["selectedVertexCount"], 974)
            self.assertAlmostEqual(receipt["region"]["selectedFraction"], 974 / 3764)
            self.assertEqual(receipt["recoveryVectors"]["outwardCount"], 1903)
            self.assertEqual(receipt["recoveryVectors"]["inwardCount"], 1861)
            self.assertEqual(receipt["recoveryVectors"]["zeroCount"], 0)

            mask_document, mask_binary = _glb_chunks(output / "procedural-support-mask.glb")
            mask_primitive = mask_document["meshes"][0]["primitives"][0]
            self.assertEqual(mask_primitive["mode"], 4)
            colors = _accessor_array(
                mask_document,
                mask_binary,
                mask_primitive["attributes"]["COLOR_0"],
            )
            selected = np.all(np.isclose(colors[:, :3], [1.0, 0.08, 0.02]), axis=1)
            self.assertEqual(int(np.count_nonzero(selected)), 974)
            self.assertEqual(mask_document["nodes"][0]["rotation"], [0.0, 0.0, 1.0, 0.0])

            recovery_document, recovery_binary = _glb_chunks(
                output / "registered-recovery-vectors.glb"
            )
            recovery_primitives = recovery_document["meshes"][0]["primitives"]
            self.assertEqual([item["mode"] for item in recovery_primitives], [4, 1, 1])
            outward = _accessor_array(
                recovery_document,
                recovery_binary,
                recovery_primitives[1]["attributes"]["POSITION"],
            )
            inward = _accessor_array(
                recovery_document,
                recovery_binary,
                recovery_primitives[2]["attributes"]["POSITION"],
            )
            self.assertEqual(outward.shape, (1903 * 2, 3))
            self.assertEqual(inward.shape, (1861 * 2, 3))
            self.assertTrue(np.all(np.linalg.norm(outward[1::2] - outward[0::2], axis=1) > 0))
            self.assertTrue(np.all(np.linalg.norm(inward[1::2] - inward[0::2], axis=1) > 0))

            coat_document, coat_binary = _glb_chunks(output / "registered-coat-vectors.glb")
            coat_primitives = coat_document["meshes"][0]["primitives"]
            self.assertEqual([item["mode"] for item in coat_primitives], [4, 1])
            coat_lines = _accessor_array(
                coat_document,
                coat_binary,
                coat_primitives[1]["attributes"]["POSITION"],
            )
            self.assertEqual(coat_lines.shape, (3764 * 2, 3))

            self.assertEqual(
                json.loads((output / "registered-diagnostic-report.json").read_text()),
                receipt,
            )
            self.assertNotIn(str(REPO.resolve()), json.dumps(receipt, sort_keys=True))

    def test_wrong_report_digest_removes_stale_visuals_and_fails_loud(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "registered"
            output.mkdir(parents=True)
            stale = output / "procedural-support-mask.glb"
            stale.write_bytes(b"stale")
            receipt = diagnostics.export_registered_diagnostics(
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
