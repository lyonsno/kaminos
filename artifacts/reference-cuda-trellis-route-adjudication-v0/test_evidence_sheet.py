import json
import tempfile
import unittest
from pathlib import Path

from build_evidence_sheet import (
    validate_comparison_sources,
    validate_launch_attempts,
    validate_route_evidence,
)


class EvidenceValidationTests(unittest.TestCase):
    def test_live_route_evidence_distinguishes_model_return_from_export(self):
        root = Path(__file__).resolve().parent
        evidence = validate_route_evidence(root)

        self.assertEqual(evidence["control"]["status"], "completed")
        self.assertTrue(evidence["control"]["previewReturned"])
        self.assertIsNotNone(evidence["control"]["output"])

        self.assertEqual(evidence["stone"]["status"], "failed")
        self.assertTrue(evidence["stone"]["previewReturned"])
        self.assertEqual(evidence["stone"]["failurePhase"], "space-glb-extraction")
        self.assertIsNone(evidence["stone"]["output"])

        self.assertEqual(evidence["authenticatedRetry"]["status"], "failed")
        self.assertFalse(evidence["authenticatedRetry"]["previewReturned"])
        self.assertEqual(evidence["authenticatedRetry"]["failurePhase"], "space-inference")

    def test_live_comparison_sources_are_vendored_and_hash_bound(self):
        root = Path(__file__).resolve().parent
        comparison = validate_comparison_sources(root / "comparison-sources.json")

        self.assertEqual(set(comparison["routes"]), {"sf3d", "trellis2mlx_fast"})
        for route in comparison["routes"].values():
            self.assertEqual(len(route["frames"]), 6)

    def test_rejects_launch_failure_that_pretends_a_job_was_provisioned(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "launch-attempts.json"
            path.write_text(json.dumps({
                "attempts": [{
                    "route": "huggingface-jobs-cli",
                    "status": "rejected-pre-provisioning",
                    "jobId": "fake-job",
                    "charged": False,
                    "failurePhase": "account-billing-preflight",
                }]
            }))

            with self.assertRaisesRegex(RuntimeError, "jobId"):
                validate_launch_attempts(path)


if __name__ == "__main__":
    unittest.main()
