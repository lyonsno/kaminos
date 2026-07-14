import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "boundary-splat-phase-state-evaluate-mlx.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_phase_state_evaluate_mlx", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DestinationStateEvaluatorContracts(unittest.TestCase):
    def test_oracle_support_composition_preserves_positions_and_limits_model_updates(self):
        target_candidates = np.arange(48, dtype=np.float32).reshape(3, 16)
        target_splats = np.arange(36, dtype=np.float32).reshape(3, 12)
        target_splats[:, :3] = np.asarray([
            [0.0, 0.0, 0.0],
            [0.1, 0.0, 0.0],
            [0.2, 0.0, 0.0],
        ], dtype=np.float32)
        target = MODULE.CORE.index_frame(target_candidates, target_splats)
        baseline_rows = np.full((3, 25), 5.0, dtype=np.float32)
        predicted_rows = np.full((2, 25), 9.0, dtype=np.float32)

        exact, control, predicted, accounting = MODULE.compose_oracle_support_frames(
            target,
            target_indices=np.asarray([2, 0, 1], dtype=np.int32),
            baseline_rows=baseline_rows,
            predicted_target_indices=np.asarray([0, 2], dtype=np.int32),
            predicted_rows=predicted_rows,
        )

        np.testing.assert_array_equal(exact["splats"][:, :3], target_splats[:, :3])
        np.testing.assert_array_equal(control["splats"][:, :3], target_splats[:, :3])
        np.testing.assert_array_equal(predicted["splats"][:, :3], target_splats[:, :3])
        np.testing.assert_array_equal(control["candidates"][2], baseline_rows[0, :16])
        np.testing.assert_array_equal(control["candidates"][0], baseline_rows[1, :16])
        np.testing.assert_array_equal(control["candidates"][1], baseline_rows[2, :16])
        np.testing.assert_array_equal(predicted["candidates"][0], predicted_rows[0, :16])
        np.testing.assert_array_equal(predicted["candidates"][2], predicted_rows[1, :16])
        np.testing.assert_array_equal(predicted["candidates"][1], control["candidates"][1])
        self.assertEqual(accounting["exactSupportCount"], 3)
        self.assertEqual(accounting["learnedUpdatedCount"], 2)
        self.assertEqual(accounting["copiedStaticCount"], 1)
        self.assertFalse(accounting["supportChanged"])
        self.assertFalse(accounting["worldPositionsChanged"])

    def test_oracle_support_composition_rejects_duplicate_target_coverage(self):
        target = MODULE.CORE.index_frame(
            np.zeros((2, 16), dtype=np.float32),
            np.asarray([[0, 0, 0] + [0] * 9, [1, 0, 0] + [0] * 9], dtype=np.float32),
        )
        with self.assertRaisesRegex(ValueError, "unique"):
            MODULE.compose_oracle_support_frames(
                target,
                target_indices=np.asarray([0, 0], dtype=np.int32),
                baseline_rows=np.zeros((2, 25), dtype=np.float32),
                predicted_target_indices=np.asarray([0], dtype=np.int32),
                predicted_rows=np.zeros((1, 25), dtype=np.float32),
            )

    def test_writer_records_effective_role_authority_and_hashes(self):
        frame = MODULE.CORE.index_frame(
            np.zeros((1, 16), dtype=np.float32),
            np.asarray([[0, 0, 0] + [1] * 9], dtype=np.float32),
        )
        with tempfile.TemporaryDirectory() as root:
            document = MODULE.write_role_frame_artifacts(Path(root), "pair-001-control", frame, "oracle-support-carried-donor-control-v0")
            self.assertEqual(document["candidates"]["authority"], "oracle-support-carried-donor-control-v0")
            self.assertEqual(document["splats"]["authority"], "oracle-support-carried-donor-control-v0")
            self.assertEqual(len(document["candidates"]["sha256"]), 64)
            self.assertEqual(len(document["splats"]["sha256"]), 64)
            self.assertEqual(document["candidates"]["count"], 1)
            self.assertEqual(document["splats"]["strideFloats"], 12)

    def test_cohort_writer_preserves_every_eligible_row_without_string_expansion(self):
        with tempfile.TemporaryDirectory() as root:
            document = MODULE.write_cohort_artifact(
                Path(root),
                "pair-001-cohorts",
                ["stable-q1", "stable-q4", "transported", "birth"],
            )
            self.assertEqual(document["authority"], "exact-oracle-support-motion-cohort-index-v0")
            self.assertEqual(document["dtype"], "uint8")
            self.assertEqual(document["count"], 4)
            self.assertEqual(document["order"], list(MODULE.COHORT_ORDER))
            self.assertEqual(Path(document["path"]).read_bytes(), bytes([0, 3, 4, 5]))
            self.assertEqual(len(document["sha256"]), 64)

    def test_parser_has_no_pair_or_sample_cap(self):
        args = MODULE.parse_args([
            "--model", "/model.json",
            "--evaluation-manifest", "/evaluation.json",
            "--out-dir", "/output",
            "--batch-size", "8192",
        ])
        self.assertEqual(args.batch_size, 8192)
        self.assertFalse(hasattr(args, "max_pairs"))
        self.assertFalse(hasattr(args, "max_samples"))


if __name__ == "__main__":
    unittest.main()
