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
    def test_forced_support_learned_donor_uses_best_valid_displacement_without_hiding_death_preference(self):
        valid_donor_indices = np.full((2, MODULE.CORE.DEATH_CLASS), -1, dtype=np.int32)
        valid_donor_indices[0, [0, 2]] = [4, 2]
        valid_donor_indices[1, [1, 3]] = [8, 6]
        carrier_probabilities = np.full((2, MODULE.CORE.DEATH_CLASS + 1), 0.01, dtype=np.float32)
        carrier_probabilities[0, [0, 2, MODULE.CORE.DEATH_CLASS]] = [0.10, 0.20, 0.90]
        carrier_probabilities[1, [1, 3, MODULE.CORE.DEATH_CLASS]] = [0.20, 0.70, 0.10]

        donor_indices, donor_classes, accounting = MODULE.select_forced_support_learned_donors(
            carrier_probabilities,
            valid_donor_indices,
        )

        np.testing.assert_array_equal(donor_indices, np.asarray([2, 6], dtype=np.int32))
        np.testing.assert_array_equal(donor_classes, np.asarray([2, 3], dtype=np.int32))
        self.assertEqual(accounting["authority"], "forced-exact-support-best-valid-learned-displacement-v0")
        self.assertEqual(accounting["destinationCount"], 2)
        self.assertEqual(accounting["deathWouldHaveWonCount"], 1)
        self.assertEqual(accounting["sameSiteDonorCount"], 0)

    def test_forced_support_learned_donor_rejects_destinations_without_a_valid_local_source(self):
        probabilities = np.zeros((1, MODULE.CORE.DEATH_CLASS + 1), dtype=np.float32)
        donors = np.full((1, MODULE.CORE.DEATH_CLASS), -1, dtype=np.int32)
        with self.assertRaisesRegex(ValueError, "valid local donor"):
            MODULE.select_forced_support_learned_donors(probabilities, donors)

    def test_counterfactual_destination_inputs_bind_the_selected_donor_state_and_class(self):
        destination_inputs = np.arange(128, dtype=np.float32).reshape(2, 64)
        donor_rows = np.arange(50, dtype=np.float32).reshape(2, 25)
        donor_classes = np.asarray([0, 6], dtype=np.int32)

        inputs = MODULE.build_counterfactual_destination_state_inputs(
            destination_inputs,
            donor_rows,
            donor_classes,
        )

        self.assertEqual(inputs.shape, (2, MODULE.CORE.DESTINATION_STATE_INPUT_COUNT))
        np.testing.assert_array_equal(inputs[:, :64], destination_inputs)
        np.testing.assert_array_equal(inputs[:, 64:89], donor_rows)
        np.testing.assert_array_equal(inputs[0, 89:], np.eye(MODULE.CORE.DEATH_CLASS, dtype=np.float32)[0])
        np.testing.assert_array_equal(inputs[1, 89:], np.eye(MODULE.CORE.DEATH_CLASS, dtype=np.float32)[6])

    def test_valid_local_donor_matrix_preserves_displacement_to_source_identity(self):
        source = MODULE.CORE.index_frame(
            np.arange(48, dtype=np.float32).reshape(3, 16),
            np.asarray([
                [0.0, 0.0, 0.0] + [1.0] * 9,
                [1.0, 0.0, 0.0] + [2.0] * 9,
                [0.0, 1.0, 0.0] + [3.0] * 9,
            ], dtype=np.float32),
        )
        destination_keys = [(1.0, 0.0, 0.0), (1.0, 1.0, 0.0)]

        donors = MODULE.build_valid_local_donor_index_matrix(destination_keys, source, grid_step=1.0)

        self.assertEqual(donors.shape, (2, MODULE.CORE.DEATH_CLASS))
        same_site = MODULE.CORE.DISPLACEMENTS.index((0, 0, 0))
        positive_x = MODULE.CORE.DISPLACEMENTS.index((1, 0, 0))
        positive_y = MODULE.CORE.DISPLACEMENTS.index((0, 1, 0))
        self.assertEqual(donors[0, same_site], source["index"][(1.0, 0.0, 0.0)])
        self.assertEqual(donors[0, positive_x], source["index"][(0.0, 0.0, 0.0)])
        self.assertEqual(donors[1, positive_y], source["index"][(1.0, 0.0, 0.0)])
        self.assertEqual(donors[1, positive_x], source["index"][(0.0, 1.0, 0.0)])

    def test_parser_accepts_exact_transport_model_without_adding_caps(self):
        args = MODULE.parse_args([
            "--model", "/state-model.json",
            "--transport-model", "/transport-model.json",
            "--evaluation-manifest", "/evaluation.json",
            "--out-dir", "/output",
        ])
        self.assertEqual(args.transport_model, "/transport-model.json")
        self.assertFalse(hasattr(args, "max_pairs"))
        self.assertFalse(hasattr(args, "max_samples"))

    def test_appearance_composition_freezes_exact_candidate_state_and_changes_only_nonposition_splats(self):
        target_candidates = np.arange(32, dtype=np.float32).reshape(2, 16)
        target_splats = np.arange(24, dtype=np.float32).reshape(2, 12)
        target_splats[:, :3] = np.asarray([[0, 0, 0], [1, 0, 0]], dtype=np.float32)
        target = MODULE.CORE.index_frame(target_candidates, target_splats)
        donor_rows = np.full((2, MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT), 5.0, dtype=np.float32)
        predicted_rows = np.full((2, MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT), 9.0, dtype=np.float32)

        exact, donor, predicted, accounting = MODULE.compose_oracle_support_appearance_frames(
            target,
            target_indices=np.asarray([1, 0], dtype=np.int32),
            donor_rows=donor_rows,
            predicted_rows=predicted_rows,
        )

        np.testing.assert_array_equal(donor["candidates"], exact["candidates"])
        np.testing.assert_array_equal(predicted["candidates"], exact["candidates"])
        np.testing.assert_array_equal(donor["splats"][:, :3], exact["splats"][:, :3])
        np.testing.assert_array_equal(predicted["splats"][:, :3], exact["splats"][:, :3])
        np.testing.assert_array_equal(donor["splats"][:, 3:], np.full((2, 9), 5.0, dtype=np.float32))
        np.testing.assert_array_equal(predicted["splats"][:, 3:], np.full((2, 9), 9.0, dtype=np.float32))
        self.assertEqual(accounting["authority"], "exact-candidate-and-support-frozen-splat-appearance-comparison-v0")
        self.assertTrue(accounting["candidateStateFrozenToExact"])
        self.assertFalse(accounting["worldPositionsChanged"])

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
        self.assertIsNone(args.transport_model)
        self.assertFalse(hasattr(args, "max_pairs"))
        self.assertFalse(hasattr(args, "max_samples"))


if __name__ == "__main__":
    unittest.main()
