import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "fur_signal_metric_atlas", ROOT / "fur_signal_metric_atlas.py"
)
ATLAS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ATLAS)


class FurSignalMetricAtlasTest(unittest.TestCase):
    def test_source_identity_mismatch_fails_loud(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.glb"
            source.write_bytes(b"observed source")
            observed = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(ATLAS.verify_source(source, observed), observed)
            with self.assertRaisesRegex(RuntimeError, "source hash mismatch"):
                ATLAS.verify_source(source, "0" * 64)

    def test_disconnected_sheet_is_distinguished_from_closed_body(self):
        # A tetrahedron supplies one compact closed component. The detached quad
        # supplies one open planar component, triangulated into two faces.
        vertices = np.array(
            [
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [3.0, 0.0, 0.0],
                [4.0, 0.0, 0.0],
                [4.0, 1.0, 0.0],
                [3.0, 1.0, 0.0],
            ],
            dtype=np.float64,
        )
        triangles = np.array(
            [
                [0, 2, 1],
                [0, 1, 3],
                [1, 2, 3],
                [2, 0, 3],
                [4, 5, 6],
                [4, 6, 7],
            ],
            dtype=np.int64,
        )

        metrics = ATLAS.analyze_topology(vertices, triangles)

        self.assertEqual(metrics["component_count"], 2)
        np.testing.assert_array_equal(metrics["component_face_count"], [4, 4, 4, 4, 2, 2])
        np.testing.assert_allclose(metrics["boundary_fraction"][:4], 0.0)
        np.testing.assert_allclose(metrics["boundary_fraction"][4:], 2.0 / 3.0)
        self.assertTrue(np.all(metrics["component_sheetness"][4:] > 0.99))
        self.assertTrue(np.all(metrics["component_sheetness"][:4] < 0.9))

    def test_triangle_channels_are_finite_for_degenerate_input(self):
        vertices = np.array(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
            dtype=np.float64,
        )
        metrics = ATLAS.analyze_topology(vertices, np.array([[0, 1, 2]], dtype=np.int64))
        for name in ("relative_area", "aspect_ratio", "normal_disorder"):
            self.assertTrue(np.all(np.isfinite(metrics[name])), name)

    def test_constant_or_blank_channel_cannot_pose_as_evidence(self):
        with self.assertRaisesRegex(ValueError, "nonconstant"):
            ATLAS.normalize_channel(np.ones(12))
        with self.assertRaisesRegex(ValueError, "finite"):
            ATLAS.normalize_channel(np.array([np.nan, np.inf]))

    def test_candidate_signal_rewards_sheet_boundary_and_disorder(self):
        metrics = {
            "small_component": np.array([0.0, 1.0]),
            "component_sheetness": np.array([0.0, 1.0]),
            "boundary_fraction": np.array([0.0, 1.0]),
            "normal_disorder": np.array([0.0, 1.0]),
            "aspect_ratio": np.array([1.0, 8.0]),
        }
        signal = ATLAS.candidate_signal(metrics)
        self.assertLess(signal[0], 0.1)
        self.assertGreater(signal[1], 0.9)

    def test_failure_before_primary_output_still_writes_a_report(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "failure.json"
            ATLAS.write_failure_report(
                output,
                phase="metric-extraction",
                error="synthetic failure",
                last_trustworthy_evidence={"sourceSha256": "a" * 64},
            )
            report = json.loads(output.read_text())
            self.assertEqual(report["phase"], "metric-extraction")
            self.assertEqual(report["lastTrustworthyEvidence"]["sourceSha256"], "a" * 64)
            self.assertIn("synthetic failure", report["error"])

    def test_discrimination_threshold_is_learned_only_from_skin_controls(self):
        fur = {
            "80301": np.array([0.8, 0.9, 1.0]),
            "80302": np.array([0.7, 0.8, 0.9]),
        }
        skin = {
            "80301": np.array([0.0, 0.1, 0.2]),
            "80302": np.array([0.0, 0.1, 0.2]),
        }
        result = ATLAS.channel_discrimination(fur, skin, control_quantile=0.95)
        self.assertLessEqual(result["threshold"], 0.2)
        self.assertGreater(result["furCoverage"], 0.95)
        self.assertLess(result["skinCoverage"], 0.1)
        self.assertEqual(set(result["furCoverageBySeed"]), {"80301", "80302"})
        self.assertGreater(result["separation"], 0.9)


if __name__ == "__main__":
    unittest.main()
