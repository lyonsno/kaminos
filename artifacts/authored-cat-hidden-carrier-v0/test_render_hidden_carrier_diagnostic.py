import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
ASSAY = ROOT / "evidence/uniform-inset-medium-scapular-v0"
REPORT_SHA256 = "961ee182de2e3899a6454280aef1a77cd65b0e901e2973a514d244a17f2b3c89"
sys.path.insert(0, str(ROOT))

import render_hidden_carrier_diagnostic as diagnostic  # noqa: E402


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class HiddenCarrierDiagnosticTest(unittest.TestCase):
    def test_captured_inputs_render_nonblank_digest_bound_svg(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagnostic"
            receipt = diagnostic.build_diagnostic(
                repo_root=REPO,
                assay_dir=ASSAY,
                output_dir=output,
                expected_report_sha256=REPORT_SHA256,
            )
            svg = output / "hidden-carrier-diagnostic.svg"
            self.assertEqual(receipt["status"], "captured")
            self.assertTrue(receipt["terminal"])
            self.assertTrue(receipt["visualArtifactValidated"])
            self.assertEqual(receipt["operatorVisualAdmission"], "not-requested")
            self.assertGreater(svg.stat().st_size, 100_000)
            body = svg.read_text()
            for label in (
                "AUTHORED HIDDEN CARRIER",
                "SYNTHETIC OBSERVED COAT",
                "UNIFORM-INSET RECOVERY",
                "CARRIER ERROR",
                "LATERAL",
                "ANTERIOR",
                "DORSAL",
            ):
                self.assertIn(label, body)
            self.assertEqual(receipt["artifact"]["sha256"], sha256(svg))
            report = json.loads((ASSAY / "report.json").read_text())
            self.assertEqual(receipt["inputs"]["reportSha256"], REPORT_SHA256)
            self.assertEqual(
                receipt["inputs"]["observationSha256"],
                report["artifacts"]["observation"]["sha256"],
            )
            self.assertEqual(
                receipt["inputs"]["recoveredCarrierSha256"],
                report["artifacts"]["recoveredCarrier"]["sha256"],
            )
            serialized = json.dumps(receipt, sort_keys=True)
            self.assertNotIn(str(REPO.resolve()), serialized)
            self.assertEqual(json.loads((output / "diagnostic-report.json").read_text()), receipt)

    def test_wrong_expected_report_digest_fails_without_visual_admission(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagnostic"
            receipt = diagnostic.build_diagnostic(
                repo_root=REPO,
                assay_dir=ASSAY,
                output_dir=output,
                expected_report_sha256="0" * 64,
            )
            self.assertEqual(receipt["status"], "failed")
            self.assertTrue(receipt["terminal"])
            self.assertFalse(receipt["visualArtifactValidated"])
            self.assertEqual(receipt["failurePhase"], "input-validation")
            self.assertIn("report digest mismatch", receipt["reason"])
            self.assertFalse((output / "hidden-carrier-diagnostic.svg").exists())

    def test_corrupt_primary_fails_loud_instead_of_rendering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copied_assay = root / "assay"
            copied_assay.mkdir()
            for name in ("report.json", "observation.npz", "recovered-carrier.npz"):
                shutil.copy2(ASSAY / name, copied_assay / name)
            (copied_assay / "observation.npz").write_bytes(b"corrupt")
            output = root / "diagnostic"
            receipt = diagnostic.build_diagnostic(
                repo_root=REPO,
                assay_dir=copied_assay,
                output_dir=output,
                expected_report_sha256=REPORT_SHA256,
            )
            self.assertEqual(receipt["status"], "failed")
            self.assertFalse(receipt["visualArtifactValidated"])
            self.assertEqual(receipt["failurePhase"], "input-validation")
            self.assertIn("observation digest mismatch", receipt["reason"])
            self.assertFalse((output / "hidden-carrier-diagnostic.svg").exists())


if __name__ == "__main__":
    unittest.main()
