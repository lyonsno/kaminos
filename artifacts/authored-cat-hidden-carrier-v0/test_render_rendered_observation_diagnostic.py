import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = REPO / "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb"
sys.path.insert(0, str(ROOT))

from hidden_carrier_fixture import _sha256  # noqa: E402
from render_rendered_observation_diagnostic import PNG_NAME, render_diagnostic  # noqa: E402
from rendered_observation_assay import run_assay  # noqa: E402


class RenderedObservationDiagnosticTest(unittest.TestCase):
    def test_registered_diagnostic_is_nonblank_and_digest_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            assay_dir = Path(directory) / "assay"
            visual_dir = Path(directory) / "visual"
            report = run_assay(
                repo_root=REPO,
                source_path=SOURCE,
                output_dir=assay_dir,
                raster_size=48,
                grid_size=33,
            )
            self.assertEqual(report["status"], "captured")
            report_sha256 = _sha256(assay_dir / "report.json")
            receipt = render_diagnostic(
                repo_root=REPO,
                source_path=SOURCE,
                assay_dir=assay_dir,
                output_dir=visual_dir,
                expected_report_sha256=report_sha256,
            )
            self.assertEqual(receipt["status"], "captured")
            png = visual_dir / PNG_NAME
            self.assertTrue(png.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertGreater(png.stat().st_size, 1000)
            self.assertEqual(receipt["inputs"]["assayReportSha256"], report_sha256)
            self.assertEqual(receipt["registration"]["columns"][1], "uniform-recovery")

    def test_report_digest_mismatch_fails_without_png(self):
        with tempfile.TemporaryDirectory() as directory:
            assay_dir = Path(directory) / "assay"
            visual_dir = Path(directory) / "visual"
            report = run_assay(
                repo_root=REPO,
                source_path=SOURCE,
                output_dir=assay_dir,
                raster_size=48,
                grid_size=33,
            )
            self.assertEqual(report["status"], "captured")
            receipt = render_diagnostic(
                repo_root=REPO,
                source_path=SOURCE,
                assay_dir=assay_dir,
                output_dir=visual_dir,
                expected_report_sha256="0" * 64,
            )
            self.assertEqual(receipt["status"], "failed")
            self.assertIn("digest mismatch", receipt["reason"])
            self.assertFalse((visual_dir / PNG_NAME).exists())


if __name__ == "__main__":
    unittest.main()
