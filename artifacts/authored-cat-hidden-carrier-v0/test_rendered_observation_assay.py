import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = REPO / "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb"
sys.path.insert(0, str(ROOT))

from rendered_observation_assay import (  # noqa: E402
    OBSERVATION_NAME,
    RECOVERY_NAME,
    REPORT_NAME,
    ROUTE,
    run_assay,
)


class RenderedObservationAssayTest(unittest.TestCase):
    def run_small(self, output_dir, **overrides):
        config = {
            "repo_root": REPO,
            "source_path": SOURCE,
            "output_dir": output_dir,
            "raster_size": 48,
            "grid_size": 33,
            "uniform_depth": 0.94,
            "spatial_base_depth": 0.94,
            "spatial_amplitude": 1.0,
        }
        config.update(overrides)
        return run_assay(**config)

    def test_success_writes_only_firewalled_observation_and_scored_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            report = self.run_small(directory)
            self.assertEqual(report["status"], "captured")
            self.assertTrue(report["terminal"])
            self.assertEqual(report["effectiveConfig"]["route"], ROUTE)
            self.assertEqual(report["score"]["truthAccessPhase"], "post-recovery-scoring-only")
            self.assertIn(
                report["score"]["classification"],
                {"ADVANCE_SPATIAL_PRIOR", "UNIFORM_CONTROL_HOLDS"},
            )
            with np.load(Path(directory) / OBSERVATION_NAME, allow_pickle=False) as archive:
                fields = set(archive.files)
                self.assertEqual(len(fields), 14)
                forbidden_fragments = ("position", "normal", "vertex", "triangle", "depths", "support")
                self.assertFalse(
                    any(fragment in field.lower() for field in fields for fragment in forbidden_fragments)
                )
            with np.load(Path(directory) / RECOVERY_NAME, allow_pickle=False) as archive:
                self.assertEqual(
                    set(archive.files),
                    {
                        "bounds",
                        "outerOccupancy",
                        "uniformOccupancy",
                        "spatialOccupancy",
                        "inwardDistance",
                        "spatialDepthPrior",
                    },
                )

    def test_unsupported_route_fails_loud_without_fallback_or_primary_output(self):
        with tempfile.TemporaryDirectory() as directory:
            report = self.run_small(directory, route="silent-fallback")
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "input-validation")
            self.assertIsNone(report["effectiveConfig"])
            self.assertIn("no fallback", report["reason"])
            self.assertFalse((Path(directory) / OBSERVATION_NAME).exists())
            self.assertFalse((Path(directory) / RECOVERY_NAME).exists())
            persisted = json.loads((Path(directory) / REPORT_NAME).read_text())
            self.assertEqual(persisted["status"], "failed")

    def test_wrong_source_writes_terminal_failure_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            wrong = Path(directory) / "wrong.glb"
            wrong.write_bytes(b"not-authenticated")
            report = self.run_small(Path(directory) / "out", source_path=wrong)
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "input-validation")
            self.assertIn("digest mismatch", report["reason"])
            self.assertTrue((Path(directory) / "out" / REPORT_NAME).is_file())

    def test_rerun_recomputes_artifacts_and_records_prior_terminal_report(self):
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_small(directory)
            second = self.run_small(directory)
            self.assertEqual(second["status"], "captured")
            self.assertNotEqual(first["executionId"], second["executionId"])
            self.assertIsNotNone(second["priorTerminalReportSha256"])
            self.assertEqual(
                first["artifacts"]["renderedObservation"]["sha256"],
                second["artifacts"]["renderedObservation"]["sha256"],
            )
            self.assertEqual(
                first["artifacts"]["recoveredVolumes"]["sha256"],
                second["artifacts"]["recoveredVolumes"]["sha256"],
            )


if __name__ == "__main__":
    unittest.main()
