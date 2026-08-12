import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = REPO / "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb"
EXPECTED_SOURCE_SHA256 = "cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e"
sys.path.insert(0, str(ROOT))

from hidden_carrier_fixture import (  # noqa: E402
    build_fixture_contract,
    coat_depths,
    load_glb_surface,
    recover_uniform_inset,
    recovery_metrics,
    synthesize_observation,
)


class HiddenCarrierFixtureTest(unittest.TestCase):
    def test_contract_freezes_the_authored_carrier_by_digest_and_locator(self):
        contract = build_fixture_contract(SOURCE, repo_root=REPO)
        self.assertEqual(contract["schema"], "kaminos.authored-cat-hidden-carrier-fixture.v0")
        self.assertEqual(
            contract["source"],
            {
                "path": "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb",
                "sha256": EXPECTED_SOURCE_SHA256,
                "contentClass": "operator-authored-carrier-export",
            },
        )
        self.assertEqual(
            [profile["id"] for profile in contract["coatProfiles"]],
            ["short-v0", "short-with-medium-scapular-v0"],
        )
        self.assertEqual(
            contract["frame"],
            {"ML": "X", "AP": "Z", "DV": "Y", "dorsalDirection": "-Y"},
        )
        self.assertEqual(contract["recoveryArms"], ["uniform-inset-negative-control-v0"])
        self.assertIn("arbitrary-source", contract["claimCeiling"])

    def test_contract_rejects_a_missing_or_different_source(self):
        with tempfile.TemporaryDirectory() as directory:
            wrong = Path(directory) / "authored_cat_envelope.glb"
            wrong.write_bytes(b"not the authored carrier")
            with self.assertRaisesRegex(ValueError, "source digest mismatch"):
                build_fixture_contract(wrong, repo_root=Path(directory))
        with self.assertRaises(FileNotFoundError):
            build_fixture_contract(ROOT / "missing.glb", repo_root=REPO)

    def test_real_frozen_carrier_surface_is_finite_and_has_unit_normals(self):
        surface = load_glb_surface(SOURCE)
        self.assertGreater(len(surface["positions"]), 100)
        self.assertEqual(surface["positions"].shape, surface["normals"].shape)
        self.assertTrue(np.isfinite(surface["positions"]).all())
        self.assertTrue(np.isfinite(surface["normals"]).all())
        np.testing.assert_allclose(
            np.linalg.norm(surface["normals"], axis=1),
            np.ones(len(surface["normals"])),
            atol=1e-6,
        )
        self.assertTrue(np.all(np.ptp(surface["positions"], axis=0) > 0.0))

    def test_two_coat_fields_are_deterministic_spatially_varying_and_distinct(self):
        positions = np.array(
            [
                [-1.0, 1.0, -1.0],
                [-0.5, 0.0, -0.2],
                [0.0, -1.0, 0.2],
                [0.5, 0.0, 0.7],
                [1.0, 1.0, 1.0],
            ]
        )
        short_a = coat_depths(positions, "short-v0")
        short_b = coat_depths(positions, "short-v0")
        medium = coat_depths(positions, "short-with-medium-scapular-v0")
        np.testing.assert_array_equal(short_a, short_b)
        self.assertTrue(np.all(short_a > 0.0))
        self.assertGreater(float(np.ptp(short_a)), 0.0)
        delta = medium - short_a
        self.assertGreater(float(delta.max()), 0.0)
        self.assertTrue(np.any(np.isclose(delta, 0.0)))
        self.assertTrue(np.any(delta > 0.0))

    def test_medium_region_uses_negative_y_as_dorsal_in_the_frozen_export(self):
        positions = np.array(
            [
                [-1.0, -1.0, -1.0],
                [0.0, -1.0, 0.2],
                [0.0, 1.0, 0.2],
                [1.0, 1.0, 1.0],
            ]
        )
        short = coat_depths(positions, "short-v0")
        medium = coat_depths(positions, "short-with-medium-scapular-v0")
        delta = medium - short
        self.assertGreater(delta[1], 0.0, "dorsal -Y scapular sample must receive medium coat")
        self.assertEqual(delta[2], 0.0, "ventral +Y sample must remain short")

    def test_observation_moves_only_along_normal_by_the_authored_depth(self):
        truth = np.array([[0.0, 0.0, 0.0], [1.0, 2.0, 3.0]])
        normals = np.array([[0.0, 0.0, 2.0], [0.0, 3.0, 0.0]])
        depths = np.array([0.25, 0.5])
        observed = synthesize_observation(truth, normals, depths)
        np.testing.assert_allclose(observed, [[0.0, 0.0, 0.25], [1.0, 2.5, 3.0]])

    def test_no_vlm_negative_control_cannot_receive_per_vertex_truth_depths(self):
        self.assertEqual(
            list(inspect.signature(recover_uniform_inset).parameters),
            ["observed", "normals", "inset"],
        )
        truth = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
        normals = np.array([[0.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
        depths = np.array([0.1, 0.3])
        observed = synthesize_observation(truth, normals, depths)
        recovered = recover_uniform_inset(observed, normals, inset=0.2)
        np.testing.assert_allclose(recovered, [[0.0, -0.1, 0.0], [1.0, 0.1, 0.0]])

    def test_metrics_preserve_global_and_regional_residuals(self):
        truth = np.zeros((4, 3))
        recovered = np.array(
            [[0.0, 0.0, 0.0], [0.1, 0.0, 0.0], [0.0, 0.2, 0.0], [0.0, 0.0, 0.3]]
        )
        metrics = recovery_metrics(
            truth,
            recovered,
            region_ids=np.array(["bare-anchor", "bare-anchor", "medium", "medium"]),
        )
        self.assertAlmostEqual(metrics["rmse"], np.sqrt((0.0 + 0.01 + 0.04 + 0.09) / 4.0))
        self.assertAlmostEqual(metrics["maxError"], 0.3)
        self.assertEqual(set(metrics["regionalRmse"]), {"bare-anchor", "medium"})
        self.assertGreater(metrics["regionalRmse"]["medium"], metrics["regionalRmse"]["bare-anchor"])


if __name__ == "__main__":
    unittest.main()
