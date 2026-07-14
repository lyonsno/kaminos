import importlib.util
import copy
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "boundary-splat-phase-transport-mlx.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_phase_transport_mlx", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def frame(rows):
    positions = np.asarray([row[0] for row in rows], dtype=np.float32)
    candidates = np.asarray([
        [row[1] + channel * 0.01 for channel in range(16)]
        for row in rows
    ], dtype=np.float32)
    splats = np.zeros((len(rows), 12), dtype=np.float32)
    splats[:, :3] = positions
    splats[:, 3:6] = (1.0, 0.5, 0.2)
    splats[:, 6:9] = (0.05, 0.8, 0.03)
    splats[:, 9:] = (0.03, 0.0, 1.0)
    return MODULE.index_frame(candidates, splats)


def frozen_model_document(hidden_size=2):
    def layer(role, activation, input_size, output_size, bias=None):
        return {
            "role": role,
            "activation": activation,
            "inputSize": input_size,
            "outputSize": output_size,
            "weights": [0.0] * (input_size * output_size),
            "bias": list(bias if bias is not None else [0.0] * output_size),
        }
    carrier_bias = [0.0] * (MODULE.DEATH_CLASS + 1)
    carrier_bias[MODULE.DEATH_CLASS] = 3.0
    return {
        "schema": MODULE.MODEL_SCHEMA,
        "status": "completed",
        "route": {"backend": "mlx", "device": "Device(gpu, 0)", "fallbackReason": None},
        "manifest": {"path": "/training/corpus.json", "bytes": 1, "sha256": "0" * 64},
        "input": {
            "authority": MODULE.INPUT_AUTHORITY,
            "featureCount": 64,
            "candidateFeatureCount": 16,
            "directionalOccupancyCount": 27,
            "mean": [0.0] * 64,
            "scale": [1.0] * 64,
        },
        "architecture": {
            "authority": MODULE.ARCHITECTURE_AUTHORITY,
            "carrierOutputOrder": [list(delta) for delta in MODULE.DISPLACEMENTS] + ["death"],
            "layers": [
                layer("shared-trunk-a", "relu", 64, hidden_size),
                layer("shared-trunk-b", "relu", hidden_size, hidden_size),
                layer("carrier-displacement-death-head", "softmax", hidden_size, MODULE.DEATH_CLASS + 1, carrier_bias),
                layer("residual-birth-head", "sigmoid", hidden_size, 1, [1.0]),
            ],
        },
        "calibration": {
            "birth": {"threshold": 0.5, "precision": 0.5},
            "targetSupport": {"medianRatio": 1.0},
        },
    }


def frozen_state_model_document(hidden_size=2):
    def layer(role, activation, input_size, output_size, bias=None):
        return {
            "role": role,
            "activation": activation,
            "inputSize": input_size,
            "outputSize": output_size,
            "weights": [0.0] * (input_size * output_size),
            "bias": list(bias if bias is not None else [0.0] * output_size),
        }
    residual_bias = [0.0] * MODULE.DESTINATION_STATE_ATTRIBUTE_COUNT
    residual_bias[0] = 0.5
    return {
        "schema": MODULE.DESTINATION_STATE_MODEL_SCHEMA,
        "status": "completed",
        "route": {"backend": "mlx", "device": "Device(gpu, 0)", "fallbackReason": None},
        "input": {
            "authority": MODULE.DESTINATION_STATE_INPUT_AUTHORITY,
            "featureCount": MODULE.DESTINATION_STATE_INPUT_COUNT,
            "destinationLocalGridFeatureCount": 64,
            "selectedDonorAttributeCount": MODULE.DESTINATION_STATE_ATTRIBUTE_COUNT,
            "selectedDonorDisplacementCount": MODULE.DEATH_CLASS,
            "mean": [0.0] * MODULE.DESTINATION_STATE_INPUT_COUNT,
            "scale": [1.0] * MODULE.DESTINATION_STATE_INPUT_COUNT,
        },
        "output": {
            "authority": MODULE.DESTINATION_STATE_OUTPUT_AUTHORITY,
            "attributeCount": MODULE.DESTINATION_STATE_ATTRIBUTE_COUNT,
            "residualMean": [0.0] * MODULE.DESTINATION_STATE_ATTRIBUTE_COUNT,
            "residualScale": [1.0] * MODULE.DESTINATION_STATE_ATTRIBUTE_COUNT,
        },
        "architecture": {
            "authority": MODULE.DESTINATION_STATE_ARCHITECTURE_AUTHORITY,
            "layers": [
                layer("destination-state-trunk-a", "relu", MODULE.DESTINATION_STATE_INPUT_COUNT, hidden_size),
                layer("destination-state-trunk-b", "relu", hidden_size, hidden_size),
                layer("destination-state-residual-head", "linear", hidden_size, MODULE.DESTINATION_STATE_ATTRIBUTE_COUNT, residual_bias),
            ],
        },
    }


class TransportDatasetContracts(unittest.TestCase):
    def test_directional_input_preserves_exact_candidate_contract(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((1.0, 0.0, 0.0), 2.0),
        ])
        vector = MODULE.make_directional_input((0.0, 0.0, 0.0), source, 1.0)
        self.assertEqual(vector.shape, (64,))
        self.assertEqual(MODULE.INPUT_AUTHORITY, "exact-16-feature-plus-directional-local-grid-occupancy-v0")
        np.testing.assert_allclose(vector[5:21], source["candidates"][source["index"][(0.0, 0.0, 0.0)]])
        self.assertEqual(int(np.sum(vector[21:48])), 2)

    def test_vectorized_directional_inputs_match_scalar_contract(self):
        source = frame([
            ((-1.0, 0.0, 0.0), 1.0),
            ((0.0, 0.0, 0.0), 2.0),
            ((0.0, 1.0, 0.0), 3.0),
            ((1.0, 1.0, 1.0), 4.0),
        ])
        keys = [
            (-1.0, 0.0, 0.0),
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (2.0, 1.0, 1.0),
            (-2.0, 0.0, 0.0),
        ]
        expected = np.stack([
            MODULE.make_directional_input(key, source, 1.0)
            for key in keys
        ])
        actual = MODULE.make_directional_inputs(keys, source, 1.0)
        self.assertEqual(actual.shape, (len(keys), 64))
        np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-7)

    def test_vectorized_directional_inputs_preserve_half_cell_lattice_origin(self):
        source = frame([
            ((-0.5, 0.5, 0.5), 1.0),
            ((0.5, 0.5, 0.5), 2.0),
            ((1.5, 1.5, 0.5), 3.0),
        ])
        keys = [(-1.5, 0.5, 0.5), (-0.5, 0.5, 0.5), (0.5, 1.5, 0.5)]
        expected = np.stack([MODULE.make_directional_input(key, source, 1.0) for key in keys])
        actual = MODULE.make_directional_inputs(keys, source, 1.0)
        np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-7)

    def test_vectorized_prediction_universe_matches_scalar_sorted_keys(self):
        source = frame([
            ((-1.0, 0.0, 0.0), 1.0),
            ((0.0, 0.0, 0.0), 2.0),
            ((1.0, 1.0, 1.0), 3.0),
        ])
        expected = set()
        for key in source["keys"]:
            expected.update(MODULE.offset_key(key, delta, 1.0) for delta in MODULE.DISPLACEMENTS)
        expected = sorted(expected - set(source["keys"]))
        self.assertEqual(MODULE.prediction_universe(source, 1.0), expected)

    def test_sparse_outlier_grid_uses_exact_nonallocating_fallback(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((1_000_000.0, 1_000_000.0, 1_000_000.0), 2.0),
        ])
        keys = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1_000_000.0, 1_000_000.0, 1_000_000.0)]
        plan = MODULE.local_grid_plan(source, 1.0)
        self.assertEqual(plan["strategy"], "sparse-key-lookup")
        self.assertGreater(plan["boundingVolumeCells"], 10 ** 12)
        expected = np.stack([MODULE.make_directional_input(key, source, 1.0) for key in keys])
        actual = MODULE.make_directional_inputs(keys, source, 1.0)
        np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-7)
        self.assertEqual(len(MODULE.prediction_universe(source, 1.0)), 52)

    def test_carrier_and_residual_birth_labels_are_distinct(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((0.0, 1.0, 0.0), 2.0),
            ((4.0, 4.0, 4.0), 3.0),
        ])
        target = frame([
            ((1.0, 0.0, 0.0), 1.01),
            ((0.0, 1.0, 0.0), 2.01),
            ((8.0, 8.0, 8.0), 9.0),
        ])
        dataset = MODULE.build_pair_dataset(source, target, grid_step=1.0, radius_cells=1)
        self.assertEqual(dataset["correspondence"]["stableCount"], 1)
        self.assertEqual(dataset["correspondence"]["transportedCount"], 1)
        self.assertEqual(dataset["correspondence"]["birthCount"], 1)
        self.assertEqual(dataset["correspondence"]["deathCount"], 1)
        self.assertEqual(dataset["carrierInputs"].shape, (3, 64))
        self.assertIn(MODULE.DEATH_CLASS, dataset["carrierLabels"])
        self.assertGreater(int(np.sum(dataset["birthLabels"])), 0)
        self.assertGreater(int(np.sum(dataset["birthLabels"] == 0)), 0)

    def test_motion_cohorts_partition_stable_change_transport_and_death(self):
        source = frame([
            ((0.0, 0.0, 0.0), 0.0),
            ((0.0, 1.0, 0.0), 0.0),
            ((0.0, 2.0, 0.0), 0.0),
            ((0.0, 3.0, 0.0), 0.0),
            ((0.0, 4.0, 0.0), 0.5),
            ((9.0, 9.0, 9.0), 0.5),
        ])
        target = frame([
            ((0.0, 0.0, 0.0), 0.001),
            ((0.0, 1.0, 0.0), 0.01),
            ((0.0, 2.0, 0.0), 0.1),
            ((0.0, 3.0, 0.0), 1.0),
            ((1.0, 4.0, 0.0), 0.51),
            ((20.0, 20.0, 20.0), 2.0),
        ])
        dataset = MODULE.build_pair_dataset(source, target, grid_step=1.0, radius_cells=1)
        self.assertEqual(
            dataset["carrierCohorts"].tolist(),
            ["stable-q1", "stable-q2", "stable-q3", "stable-q4", "transported", "death"],
        )
        self.assertEqual(dataset["cohortCounts"], {
            "stable-q1": 1,
            "stable-q2": 1,
            "stable-q3": 1,
            "stable-q4": 1,
            "transported": 1,
            "death": 1,
        })

    def test_motion_balanced_sampler_spends_equal_batch_on_each_cohort(self):
        cohorts = np.asarray(
            ["stable-q1"] * 100
            + ["stable-q2"] * 30
            + ["stable-q3"] * 9
            + ["stable-q4"] * 4
            + ["transported"] * 2
            + ["death"],
        )
        pools = MODULE.build_motion_sampling_pools(cohorts)
        self.assertEqual({cohort: len(indices) for cohort, indices in pools.items()}, {
            "stable-q1": 100,
            "stable-q2": 30,
            "stable-q3": 9,
            "stable-q4": 4,
            "transported": 2,
            "death": 1,
        })
        sampled = MODULE.sample_motion_balanced_indices(
            np.random.default_rng(713),
            pools,
            batch_size=12,
        )
        sampled_counts = {
            cohort: int(np.sum(cohorts[sampled] == cohort))
            for cohort in MODULE.CARRIER_COHORTS
        }
        self.assertEqual(sampled_counts, {cohort: 2 for cohort in MODULE.CARRIER_COHORTS})
        birth_labels = np.asarray([0.0] * 100 + [1.0] * 3, dtype=np.float32)
        birth_pools = MODULE.build_binary_sampling_pools(birth_labels)
        birth_sampled = MODULE.sample_binary_balanced_indices(
            np.random.default_rng(713),
            birth_pools,
            batch_size=12,
        )
        self.assertEqual(int(np.sum(birth_labels[birth_sampled] > 0.5)), 6)
        self.assertEqual(int(np.sum(birth_labels[birth_sampled] <= 0.5)), 6)

    def test_eulerian_dataset_labels_destination_occupancy_and_supported_births(self):
        source = frame([
            ((0.0, 0.0, 0.0), 0.0),
            ((0.0, 3.0, 0.0), 0.0),
            ((0.0, 6.0, 0.0), 0.0),
            ((0.0, 9.0, 0.0), 0.0),
            ((0.0, 12.0, 0.0), 0.5),
            ((9.0, 9.0, 9.0), 0.5),
        ])
        target = frame([
            ((0.0, 0.0, 0.0), 0.001),
            ((0.0, 3.0, 0.0), 0.01),
            ((0.0, 6.0, 0.0), 0.1),
            ((0.0, 9.0, 0.0), 1.0),
            ((1.0, 12.0, 0.0), 0.51),
            ((1.0, 0.0, 0.0), 2.0),
            ((20.0, 20.0, 20.0), 3.0),
        ])
        dataset = MODULE.build_eulerian_pair_dataset(source, target, grid_step=1.0)
        destination_index = {key: index for index, key in enumerate(dataset["destinationKeys"])}
        stable_class = MODULE.displacement_class((0, 0, 0))
        right_class = MODULE.displacement_class((1, 0, 0))

        self.assertEqual(dataset["destinationInputs"].shape[1], 64)
        self.assertEqual(dataset["destinationInputs"].shape[0], len(dataset["destinationKeys"]))
        self.assertEqual(len(dataset["birthInputs"]), int(np.sum(~dataset["sourceDestinationMask"])))
        self.assertEqual(int(np.sum(dataset["birthLabels"])), 2)
        self.assertEqual(dataset["carrierLabels"][destination_index[(0.0, 0.0, 0.0)]], stable_class)
        self.assertEqual(dataset["carrierLabels"][destination_index[(1.0, 12.0, 0.0)]], right_class)
        self.assertEqual(dataset["carrierLabels"][destination_index[(1.0, 0.0, 0.0)]], right_class)
        self.assertEqual(dataset["carrierLabels"][destination_index[(0.0, 12.0, 0.0)]], MODULE.DEATH_CLASS)
        self.assertEqual(dataset["destinationCohorts"][destination_index[(1.0, 12.0, 0.0)]], "transported")
        self.assertEqual(dataset["destinationCohorts"][destination_index[(1.0, 0.0, 0.0)]], "birth")
        self.assertEqual(dataset["destinationCohorts"][destination_index[(0.0, 12.0, 0.0)]], "death")
        self.assertIn("empty", dataset["destinationCohorts"])
        self.assertEqual(dataset["occupancyLabels"][destination_index[(1.0, 0.0, 0.0)]], 1.0)
        self.assertNotIn((20.0, 20.0, 20.0), destination_index)
        self.assertEqual(dataset["unsupportedBirthCount"], 1)
        for cohort in MODULE.EULERIAN_DESTINATION_COHORTS:
            self.assertGreater(dataset["cohortCounts"][cohort], 0)

    def test_eulerian_sampler_spends_equal_batch_on_each_destination_cohort(self):
        cohorts = np.asarray([
            cohort
            for cohort_index, cohort in enumerate(MODULE.EULERIAN_DESTINATION_COHORTS)
            for _ in range(cohort_index + 1)
        ])
        pools = MODULE.build_eulerian_sampling_pools(cohorts)
        sampled = MODULE.sample_eulerian_balanced_indices(
            np.random.default_rng(713),
            pools,
            batch_size=16,
        )
        self.assertEqual(
            {cohort: int(np.sum(cohorts[sampled] == cohort)) for cohort in MODULE.EULERIAN_DESTINATION_COHORTS},
            {cohort: 2 for cohort in MODULE.EULERIAN_DESTINATION_COHORTS},
        )

    def test_destination_state_dataset_targets_motion_residual_after_donor_assignment(self):
        source = frame([
            ((0.0, 0.0, 0.0), 0.0),
            ((0.0, 3.0, 0.0), 0.0),
            ((0.0, 6.0, 0.0), 0.0),
            ((0.0, 9.0, 0.0), 0.0),
            ((0.0, 12.0, 0.0), 0.5),
            ((9.0, 9.0, 9.0), 0.5),
        ])
        target = frame([
            ((0.0, 0.0, 0.0), 0.001),
            ((0.0, 3.0, 0.0), 0.01),
            ((0.0, 6.0, 0.0), 0.1),
            ((0.0, 9.0, 0.0), 1.0),
            ((1.0, 12.0, 0.0), 0.51),
            ((1.0, 0.0, 0.0), 2.0),
        ])

        dataset = MODULE.build_destination_state_dataset(source, target, grid_step=1.0)
        self.assertEqual(dataset["stateCohorts"].tolist(), [
            "stable-q3", "stable-q4", "transported", "birth",
        ])
        self.assertEqual(dataset["stateInputs"].shape, (4, 64 + 25 + MODULE.DEATH_CLASS))
        self.assertEqual(dataset["stateTargets"].shape, (4, 25))
        self.assertEqual(dataset["stateBaselines"].shape, (4, 25))
        np.testing.assert_allclose(
            dataset["stateResidualTargets"],
            dataset["stateTargets"] - dataset["stateBaselines"],
        )

        birth_row = dataset["stateDestinationKeys"].index((1.0, 0.0, 0.0))
        donor_index = dataset["stateDonorIndices"][birth_row]
        target_index = target["index"][(1.0, 0.0, 0.0)]
        expected_baseline = np.concatenate((source["candidates"][donor_index], source["splats"][donor_index, 3:]))
        expected_target = np.concatenate((target["candidates"][target_index], target["splats"][target_index, 3:]))
        np.testing.assert_allclose(dataset["stateBaselines"][birth_row], expected_baseline)
        np.testing.assert_allclose(dataset["stateTargets"][birth_row], expected_target)
        donor_code = dataset["stateInputs"][birth_row, 64 + 25:]
        self.assertEqual(int(np.sum(donor_code)), 1)

    def test_destination_state_sampler_balances_only_motion_bearing_cohorts(self):
        cohorts = np.asarray(
            ["stable-q3"] * 100
            + ["stable-q4"] * 30
            + ["transported"] * 4
            + ["birth"],
        )
        pools = MODULE.build_destination_state_sampling_pools(cohorts)
        sampled = MODULE.sample_destination_state_balanced_indices(
            np.random.default_rng(713), pools, batch_size=12,
        )
        self.assertEqual(
            {cohort: int(np.sum(cohorts[sampled] == cohort)) for cohort in MODULE.DESTINATION_STATE_COHORTS},
            {cohort: 3 for cohort in MODULE.DESTINATION_STATE_COHORTS},
        )

    def test_destination_state_residual_changes_attributes_without_moving_support(self):
        carried = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((1.0, 0.0, 0.0), 2.0),
        ])
        residuals = np.zeros((2, 25), dtype=np.float32)
        residuals[0, 0] = 0.5
        residuals[0, 16] = 0.25
        residuals[1, 15] = -0.5
        residuals[1, 24] = -0.25

        predicted = MODULE.apply_destination_state_residuals(carried, residuals)
        self.assertEqual(predicted["keys"], carried["keys"])
        np.testing.assert_array_equal(predicted["splats"][:, :3], carried["splats"][:, :3])
        self.assertAlmostEqual(float(predicted["candidates"][0, 0]), float(carried["candidates"][0, 0] + 0.5))
        self.assertAlmostEqual(float(predicted["splats"][0, 3]), float(carried["splats"][0, 3] + 0.25))
        self.assertAlmostEqual(float(predicted["candidates"][1, 15]), float(carried["candidates"][1, 15] - 0.5))
        self.assertAlmostEqual(float(predicted["splats"][1, 11]), float(carried["splats"][1, 11] - 0.25))

    def test_count_drift_gate_retains_every_step_and_exposes_compounding_inflation(self):
        gate = MODULE.summarize_count_drift_gate(
            source_count=100,
            exact_counts=[101, 102, 103],
            predicted_counts=[102, 110, 130],
        )
        self.assertEqual(gate["authority"], "every-recurrent-step-count-drift-versus-identity-v0")
        self.assertEqual(gate["evaluatedStepCount"], 3)
        self.assertEqual([row["step"] for row in gate["steps"]], [1, 2, 3])
        self.assertEqual(gate["firstWorseThanIdentityStep"], 2)
        self.assertFalse(gate["allStepsNotWorseThanIdentity"])
        self.assertEqual(gate["steps"][-1]["predictedCountError"], 27)
        self.assertEqual(gate["steps"][-1]["identityCountError"], 3)
        self.assertGreater(gate["steps"][-1]["predictedToExactRatio"], gate["steps"][0]["predictedToExactRatio"])

    def test_destination_state_metrics_require_advantage_in_every_motion_cohort(self):
        baselines = np.zeros((4, 25), dtype=np.float32)
        targets = np.ones((4, 25), dtype=np.float32)
        predictions = np.full((4, 25), 0.5, dtype=np.float32)
        metrics = MODULE.summarize_destination_state_metrics(
            baselines,
            predictions,
            targets,
            np.asarray(MODULE.DESTINATION_STATE_COHORTS),
            target_scale=np.ones(25, dtype=np.float32),
        )
        self.assertEqual(metrics["authority"], "cross-episode-state-mse-versus-carried-donor-v0")
        self.assertEqual(metrics["aggregate"]["sampleCount"], 4)
        self.assertEqual(metrics["aggregate"]["predictionToDonorMseRatio"], 0.25)
        self.assertTrue(metrics["allCohortsBeatCarriedDonor"])
        self.assertEqual(list(metrics["cohorts"]), list(MODULE.DESTINATION_STATE_COHORTS))

        hostile = predictions.copy()
        hostile[-1] = 2.0
        hostile_metrics = MODULE.summarize_destination_state_metrics(
            baselines,
            hostile,
            targets,
            np.asarray(MODULE.DESTINATION_STATE_COHORTS),
            target_scale=np.ones(25, dtype=np.float32),
        )
        self.assertFalse(hostile_metrics["cohorts"]["birth"]["beatsCarriedDonor"])
        self.assertFalse(hostile_metrics["allCohortsBeatCarriedDonor"])

    def test_eulerian_composer_preserves_uncertain_scaffold_and_adds_confident_birth(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((2.0, 0.0, 0.0), 2.0),
        ])
        destination_keys = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0), (3.0, 0.0, 0.0)]
        probabilities = np.zeros((4, MODULE.DEATH_CLASS + 1), dtype=np.float32)
        stable_class = MODULE.displacement_class((0, 0, 0))
        right_class = MODULE.displacement_class((1, 0, 0))
        probabilities[0, stable_class] = 0.40
        probabilities[0, MODULE.DEATH_CLASS] = 0.45
        probabilities[1, right_class] = 0.80
        probabilities[1, MODULE.DEATH_CLASS] = 0.10
        probabilities[2, stable_class] = 0.05
        probabilities[2, MODULE.DEATH_CLASS] = 0.90
        probabilities[3, right_class] = 0.80
        probabilities[3, MODULE.DEATH_CLASS] = 0.10
        occupancy = np.asarray([1.0, 0.90, 0.0, 0.60], dtype=np.float32)

        predicted, accounting = MODULE.compose_eulerian_destination_occupancy(
            source,
            destination_keys,
            probabilities,
            occupancy,
            grid_step=1.0,
            death_margin_threshold=0.10,
            birth_threshold=0.70,
            target_support_ratio=1.0,
        )
        self.assertEqual(set(predicted["keys"]), {(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)})
        birth_index = predicted["index"][(1.0, 0.0, 0.0)]
        self.assertAlmostEqual(float(predicted["splats"][birth_index, 7]), 0.8)
        self.assertEqual(accounting["defaultStaticCount"], 1)
        self.assertEqual(accounting["activatedDeathCount"], 1)
        self.assertEqual(accounting["selectedBirthCount"], 1)
        self.assertEqual(accounting["transportedAttributeCount"], 1)
        self.assertEqual(predicted["donorClasses"].shape, (2,))
        self.assertEqual(predicted["donorClasses"][predicted["index"][(0.0, 0.0, 0.0)]], stable_class)
        self.assertEqual(predicted["donorClasses"][birth_index], right_class)
        self.assertEqual(
            accounting["compositionAuthority"],
            "copied-static-scaffold-with-eulerian-destination-occupancy-residual-v0",
        )

    def test_frozen_destination_state_model_is_separate_and_hydrates_exact_residual(self):
        document = frozen_state_model_document()
        model, normalization = MODULE.hydrate_frozen_destination_state_model_document(document)
        self.assertNotEqual(document["schema"], MODULE.MODEL_SCHEMA)
        inputs = np.zeros((1, MODULE.DESTINATION_STATE_INPUT_COUNT), dtype=np.float32)
        residual = MODULE.predict_destination_state_model(
            model,
            inputs,
            normalization["inputMean"],
            normalization["inputScale"],
            normalization["residualMean"],
            normalization["residualScale"],
            batch_size=1,
        )
        self.assertEqual(residual.shape, (1, 25))
        self.assertAlmostEqual(float(residual[0, 0]), 0.5)

        hostile = copy.deepcopy(document)
        hostile["schema"] = MODULE.MODEL_SCHEMA
        with self.assertRaisesRegex(ValueError, "destination-state model schema"):
            MODULE.validate_frozen_destination_state_model_document(hostile)

    def test_destination_state_inference_input_binds_carried_donor_and_class(self):
        source = frame([((0.0, 0.0, 0.0), 1.0)])
        carried = frame([((1.0, 0.0, 0.0), 1.0)])
        donor_class = MODULE.displacement_class((1, 0, 0))
        inputs = MODULE.build_destination_state_inference_inputs(
            source,
            carried,
            np.asarray([donor_class], dtype=np.int32),
            grid_step=1.0,
        )
        self.assertEqual(inputs.shape, (1, MODULE.DESTINATION_STATE_INPUT_COUNT))
        np.testing.assert_allclose(inputs[0, 64:80], carried["candidates"][0])
        np.testing.assert_allclose(inputs[0, 80:89], carried["splats"][0, 3:])
        self.assertEqual(inputs[0, 64 + 25 + donor_class], 1.0)

    def test_frozen_destination_state_application_preserves_predicted_support(self):
        source = frame([((0.0, 0.0, 0.0), 1.0)])
        carried = frame([((1.0, 0.0, 0.0), 1.0)])
        carried["donorClasses"] = np.asarray([MODULE.displacement_class((1, 0, 0))], dtype=np.int32)
        model, normalization = MODULE.hydrate_frozen_destination_state_model_document(
            frozen_state_model_document(),
        )
        predicted, accounting = MODULE.apply_frozen_destination_state_model(
            model,
            normalization,
            source,
            carried,
            grid_step=1.0,
            batch_size=1,
        )
        self.assertEqual(predicted["keys"], carried["keys"])
        np.testing.assert_array_equal(predicted["splats"][:, :3], carried["splats"][:, :3])
        self.assertAlmostEqual(float(predicted["candidates"][0, 0]), 1.5)
        self.assertEqual(accounting["authority"], "frozen-destination-state-residual-on-predicted-support-v0")
        self.assertEqual(accounting["updatedCount"], 1)

    def test_protected_splat_state_uses_recurrent_appearance_without_candidate_feedback(self):
        canonical_source = frame([((0.0, 0.0, 0.0), 1.0)])
        appearance_source = frame([((0.0, 0.0, 0.0), 9.0)])
        appearance_source["splats"][0, 3] = 4.0
        carried = frame([((1.0, 0.0, 0.0), 1.0)])
        donor_class = MODULE.displacement_class((1, 0, 0))
        carried["donorClasses"] = np.asarray([donor_class], dtype=np.int32)
        document = frozen_state_model_document()
        document["architecture"]["layers"][-1]["bias"][0] = 0.5
        document["architecture"]["layers"][-1]["bias"][len(MODULE.FEATURES)] = 0.25
        model, normalization = MODULE.hydrate_frozen_destination_state_model_document(document)

        predicted, accounting = MODULE.apply_protected_splat_destination_state_model(
            model,
            normalization,
            canonical_source,
            appearance_source,
            carried,
            grid_step=1.0,
            batch_size=1,
        )

        self.assertEqual(predicted["keys"], carried["keys"])
        np.testing.assert_array_equal(predicted["candidates"], carried["candidates"])
        np.testing.assert_array_equal(predicted["splats"][:, :3], carried["splats"][:, :3])
        self.assertAlmostEqual(float(predicted["splats"][0, 3]), 4.25)
        self.assertEqual(accounting["authority"], "protected-canonical-candidate-splat-only-recurrence-v0")
        self.assertTrue(accounting["candidateStateProtected"])
        self.assertFalse(accounting["occupancyFeedbackEnabled"])

        mismatched_appearance = frame([((2.0, 0.0, 0.0), 9.0)])
        with self.assertRaisesRegex(ValueError, "protected appearance support"):
            MODULE.apply_protected_splat_destination_state_model(
                model,
                normalization,
                canonical_source,
                mismatched_appearance,
                carried,
                grid_step=1.0,
                batch_size=1,
            )

    def test_protected_splat_recurrence_returns_separate_canonical_and_appearance_tracks(self):
        canonical_source = frame([((0.0, 0.0, 0.0), 1.0)])
        appearance_source = frame([((0.0, 0.0, 0.0), 9.0)])
        appearance_source["splats"][0, 3] = 4.0
        transport_document = frozen_model_document()
        transport_document["training"] = {"objectiveFamily": MODULE.EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY}
        transport_document["calibration"]["birth"]["threshold"] = 1.0
        transport_document["calibration"]["destinationDeath"] = {
            "authority": "training-eulerian-source-death-margin-f1-v0",
            "threshold": 2.0,
            "precision": 1.0,
            "recall": 0.0,
        }
        transport_model, input_mean, input_scale = MODULE.hydrate_frozen_model_document(transport_document)
        state_document = frozen_state_model_document()
        state_document["architecture"]["layers"][-1]["bias"][len(MODULE.FEATURES)] = 0.25
        state_model, state_normalization = MODULE.hydrate_frozen_destination_state_model_document(state_document)

        canonical_next, appearance_next, accounting = MODULE.protected_splat_recurrent_predict(
            transport_model,
            canonical_source,
            appearance_source,
            grid_step=1.0,
            input_mean=input_mean,
            input_scale=input_scale,
            birth_calibration=transport_document["calibration"]["birth"],
            target_support_calibration=transport_document["calibration"]["targetSupport"],
            batch_size=1,
            destination_death_calibration=transport_document["calibration"]["destinationDeath"],
            destination_state_bundle={"model": state_model, "normalization": state_normalization},
        )

        self.assertEqual(canonical_next["keys"], appearance_next["keys"])
        np.testing.assert_array_equal(canonical_next["candidates"], appearance_next["candidates"])
        self.assertAlmostEqual(float(canonical_next["splats"][0, 3]), 1.0)
        self.assertAlmostEqual(float(appearance_next["splats"][0, 3]), 4.25)
        self.assertEqual(accounting["compositionAuthority"], "protected-occupancy-with-splat-only-state-recurrence-v0")
        self.assertEqual(accounting["destinationState"]["occupancyFeedbackEnabled"], False)

    def test_protected_state_recurrence_mode_requires_both_frozen_models_and_eulerian_occupancy(self):
        validated = MODULE.validate_state_recurrence_mode(
            "protected-splat",
            has_transport_model=True,
            has_state_model=True,
            objective_family=MODULE.EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY,
        )
        self.assertEqual(validated["authority"], "explicit-state-recurrence-mode-v0")
        self.assertEqual(validated["mode"], "protected-splat")
        self.assertEqual(validated["occupancyFeedbackEnabled"], False)
        with self.assertRaisesRegex(ValueError, "requires a destination-state model"):
            MODULE.validate_state_recurrence_mode(
                "protected-splat",
                has_transport_model=True,
                has_state_model=False,
                objective_family=MODULE.EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY,
            )
        with self.assertRaisesRegex(ValueError, "requires the Eulerian occupancy objective"):
            MODULE.validate_state_recurrence_mode(
                "protected-splat",
                has_transport_model=True,
                has_state_model=True,
                objective_family=MODULE.MOTION_BALANCED_OBJECTIVE_FAMILY,
            )

    def test_action_margin_calibration_separates_static_and_motion(self):
        probabilities = np.zeros((4, MODULE.DEATH_CLASS + 1), dtype=np.float32)
        stable_class = MODULE.displacement_class((0, 0, 0))
        motion_class = MODULE.displacement_class((1, 0, 0))
        probabilities[:, stable_class] = [0.6, 0.55, 0.1, 0.15]
        probabilities[:, motion_class] = [0.5, 0.35, 0.9, 0.85]
        labels = np.asarray([stable_class, stable_class, motion_class, motion_class], dtype=np.int32)
        calibration = MODULE.calibrate_action_margin(probabilities, labels)
        self.assertEqual(calibration["authority"], "training-carrier-action-margin-f1-v0")
        self.assertEqual(calibration["algorithmAuthority"], "descending-margin-cumulative-confusion-v0")
        self.assertEqual(calibration["thresholdCandidateCount"], 3)
        self.assertEqual(calibration["precision"], 1.0)
        self.assertEqual(calibration["recall"], 1.0)
        self.assertGreater(calibration["threshold"], 0.0)

        hostile_probabilities = np.zeros((12, MODULE.DEATH_CLASS + 1), dtype=np.float32)
        hostile_probabilities[:, stable_class] = 0.51
        hostile_probabilities[:, motion_class] = 0.49
        hostile_probabilities[-1, stable_class] = 0.10
        hostile_probabilities[-1, motion_class] = 0.90
        hostile_labels = np.full(12, motion_class, dtype=np.int32)
        hostile_calibration = MODULE.calibrate_action_margin(hostile_probabilities, hostile_labels)
        self.assertGreaterEqual(
            hostile_calibration["threshold"],
            0.0,
            "learned actions may not override the static scaffold while stable-copy probability is higher",
        )

    def test_eulerian_death_margin_calibration_uses_only_valid_local_donors(self):
        stable_class = MODULE.displacement_class((0, 0, 0))
        invalid_class = MODULE.displacement_class((1, 0, 0))
        probabilities = np.zeros((4, MODULE.DEATH_CLASS + 1), dtype=np.float32)
        probabilities[:, stable_class] = [0.60, 0.55, 0.10, 0.15]
        probabilities[:, invalid_class] = 0.99
        probabilities[:, MODULE.DEATH_CLASS] = [0.50, 0.35, 0.90, 0.85]
        labels = np.asarray([stable_class, stable_class, MODULE.DEATH_CLASS, MODULE.DEATH_CLASS], dtype=np.int32)
        inputs = np.zeros((4, 64), dtype=np.float32)
        inputs[:, 21 + stable_class] = 1.0
        calibration = MODULE.calibrate_destination_death_margin(
            probabilities,
            labels,
            inputs,
            np.ones(4, dtype=bool),
        )
        self.assertEqual(calibration["authority"], "training-eulerian-source-death-margin-f1-v0")
        self.assertEqual(calibration["precision"], 1.0)
        self.assertEqual(calibration["recall"], 1.0)
        self.assertGreater(calibration["threshold"], 0.0)

    def test_static_scaffold_keeps_uncertain_support_and_applies_confident_motion(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((1.0, 0.0, 0.0), 2.0),
        ])
        probabilities = np.zeros((2, MODULE.DEATH_CLASS + 1), dtype=np.float32)
        stable_class = MODULE.displacement_class((0, 0, 0))
        move_class = MODULE.displacement_class((1, 0, 0))
        probabilities[0, stable_class] = 0.40
        probabilities[0, MODULE.DEATH_CLASS] = 0.45
        probabilities[1, stable_class] = 0.10
        probabilities[1, move_class] = 0.80
        claims, accounting = MODULE.compose_static_scaffold_claims(
            source,
            probabilities,
            grid_step=1.0,
            action_margin_threshold=0.10,
        )
        self.assertEqual(set(claims), {(0.0, 0.0, 0.0), (2.0, 0.0, 0.0)})
        self.assertEqual(accounting["defaultStaticCount"], 1)
        self.assertEqual(accounting["activatedTransportCount"], 1)
        self.assertEqual(accounting["activatedDeathCount"], 0)
        self.assertEqual(accounting["compositionAuthority"], "copied-static-scaffold-with-calibrated-carrier-actions-v0")

    def test_displacement_class_round_trips(self):
        for class_index, delta in enumerate(MODULE.DISPLACEMENTS):
            self.assertEqual(MODULE.displacement_class(delta), class_index)
            self.assertEqual(MODULE.DISPLACEMENTS[class_index], delta)
        self.assertEqual(MODULE.DEATH_CLASS, len(MODULE.DISPLACEMENTS))

    def test_target_count_calibration_ranks_births_without_collisions(self):
        ratio = MODULE.calibrate_target_support_ratio([
            {"sourceCount": 100, "targetCount": 102},
            {"sourceCount": 120, "targetCount": 119},
            {"sourceCount": 80, "targetCount": 80},
        ])
        self.assertEqual(ratio["authority"], "training-adjacent-target-source-count-ratio-median-v0")
        self.assertEqual(ratio["medianRatio"], 1.0)
        selected = MODULE.select_ranked_births(
            [(2.0, 0.0, 0.0), (1.0, 0.0, 0.0), (3.0, 0.0, 0.0)],
            np.asarray([0.2, 0.9, 0.8], dtype=np.float32),
            claimed_keys={(3.0, 0.0, 0.0)},
            target_support_budget=4,
            claimed_count=2,
        )
        self.assertEqual(selected, [((1.0, 0.0, 0.0), float(np.float32(0.9))), ((2.0, 0.0, 0.0), float(np.float32(0.2)))])

    def test_frozen_model_loader_rejects_wrong_input_authority(self):
        model_document = frozen_model_document()
        hostile = copy.deepcopy(model_document)
        hostile["input"]["authority"] = "fallback-current-frame-copy"
        with self.assertRaisesRegex(ValueError, "input authority"):
            MODULE.validate_frozen_model_document(hostile)

    def test_motion_balanced_artifact_reuses_schema_but_requires_action_calibration(self):
        model_document = frozen_model_document()
        model_document["training"] = {"objectiveFamily": MODULE.MOTION_BALANCED_OBJECTIVE_FAMILY}
        model_document["calibration"]["carrierAction"] = {
            "authority": "training-carrier-action-margin-f1-v0",
            "threshold": 0.25,
            "precision": 0.8,
            "recall": 0.7,
        }
        validated = MODULE.validate_frozen_model_document(model_document)
        self.assertEqual(model_document["schema"], MODULE.MODEL_SCHEMA)
        self.assertEqual(model_document["architecture"]["authority"], MODULE.ARCHITECTURE_AUTHORITY)
        self.assertEqual(validated["objectiveFamily"], MODULE.MOTION_BALANCED_OBJECTIVE_FAMILY)
        self.assertEqual(validated["compositionAuthority"], "copied-static-scaffold-with-calibrated-carrier-actions-v0")

        hostile = copy.deepcopy(model_document)
        del hostile["calibration"]["carrierAction"]
        with self.assertRaisesRegex(ValueError, "action calibration"):
            MODULE.validate_frozen_model_document(hostile)

        hostile = copy.deepcopy(model_document)
        hostile["calibration"]["carrierAction"]["threshold"] = -0.01
        with self.assertRaisesRegex(ValueError, "nonnegative"):
            MODULE.validate_frozen_model_document(hostile)

    def test_eulerian_artifact_reuses_deployed_schema_but_requires_death_calibration(self):
        model_document = frozen_model_document()
        model_document["training"] = {"objectiveFamily": MODULE.EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY}
        model_document["calibration"]["destinationDeath"] = {
            "authority": "training-eulerian-source-death-margin-f1-v0",
            "threshold": 0.20,
            "precision": 0.8,
            "recall": 0.7,
        }
        validated = MODULE.validate_frozen_model_document(model_document)
        self.assertEqual(model_document["schema"], MODULE.MODEL_SCHEMA)
        self.assertEqual(model_document["input"]["authority"], MODULE.INPUT_AUTHORITY)
        self.assertEqual(model_document["architecture"]["authority"], MODULE.ARCHITECTURE_AUTHORITY)
        self.assertEqual(len(model_document["architecture"]["layers"]), 4)
        self.assertEqual(validated["objectiveFamily"], MODULE.EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY)
        self.assertEqual(
            validated["compositionAuthority"],
            "copied-static-scaffold-with-eulerian-destination-occupancy-residual-v0",
        )

        hostile = copy.deepcopy(model_document)
        del hostile["calibration"]["destinationDeath"]
        with self.assertRaisesRegex(ValueError, "destination death calibration"):
            MODULE.validate_frozen_model_document(hostile)

        hostile = copy.deepcopy(model_document)
        hostile["calibration"]["destinationDeath"]["threshold"] = -0.01
        with self.assertRaisesRegex(ValueError, "nonnegative"):
            MODULE.validate_frozen_model_document(hostile)

    def test_frozen_model_hydration_preserves_serialized_head_logits(self):
        model, input_mean, input_scale = MODULE.hydrate_frozen_model_document(frozen_model_document())
        carrier, birth = MODULE.predict_model(
            model,
            np.zeros((1, 64), dtype=np.float32),
            input_mean,
            input_scale,
            batch_size=1,
        )
        self.assertEqual(int(np.argmax(carrier[0])), MODULE.DEATH_CLASS)
        self.assertAlmostEqual(float(birth[0]), 1.0 / (1.0 + np.exp(-1.0)), places=6)

    def test_prediction_provenance_separates_inference_and_training_corpora(self):
        prediction = MODULE.build_prediction_document(
            inference_manifest={"path": "/new/corpus.json", "bytes": 2, "sha256": "1" * 64},
            training_manifest={"path": "/training/corpus.json", "bytes": 1, "sha256": "0" * 64},
            model={"path": "/model.json", "sha256": "2" * 64, "schema": MODULE.MODEL_SCHEMA},
            route={"backend": "mlx", "device": "Device(gpu, 0)", "fallbackReason": None},
            temporal={},
            frames=[],
            recurrent=[],
            support_metrics=[],
        )
        self.assertEqual(prediction["manifest"]["sha256"], "1" * 64)
        self.assertEqual(prediction["modelTrainingManifest"]["sha256"], "0" * 64)

    def test_rollout_gate_cannot_close_on_early_step_advantage(self):
        gate = MODULE.summarize_rollout_gate([
            {"step": 1, "beatsIdentity": True, "predictionToIdentityRatio": 1.10},
            {"step": 2, "beatsIdentity": True, "predictionToIdentityRatio": 1.02},
            {"step": 3, "beatsIdentity": False, "predictionToIdentityRatio": 0.90},
        ])
        self.assertEqual(gate["authority"], "every-recurrent-step-support-advantage-gate-v0")
        self.assertEqual(gate["evaluatedStepCount"], 3)
        self.assertEqual(gate["beatStepCount"], 2)
        self.assertEqual(gate["firstIdentityLossStep"], 3)
        self.assertEqual(gate["allStepsBeatIdentity"], False)


if __name__ == "__main__":
    unittest.main()
