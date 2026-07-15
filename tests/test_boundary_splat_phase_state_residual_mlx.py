import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "boundary-splat-phase-state-residual-mlx.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_phase_state_residual_mlx", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DestinationStateTrainerContracts(unittest.TestCase):
    def test_route_validation_rejects_cpu_and_fallback(self):
        self.assertEqual(
            MODULE.validate_training_route("Device(gpu, 0)", fallback_reason=None)["backend"],
            "mlx",
        )
        with self.assertRaisesRegex(RuntimeError, "MLX GPU"):
            MODULE.validate_training_route("Device(cpu, 0)", fallback_reason=None)
        with self.assertRaisesRegex(RuntimeError, "fallback"):
            MODULE.validate_training_route("Device(gpu, 0)", fallback_reason="cpu retry")

    def test_training_and_evaluation_corpora_must_be_distinct(self):
        training = {"path": "/training/corpus.json", "sha256": "a" * 64}
        evaluation = {"path": "/evaluation/corpus.json", "sha256": "b" * 64}
        MODULE.validate_manifest_roles(training, evaluation)
        with self.assertRaisesRegex(ValueError, "distinct cross-episode"):
            MODULE.validate_manifest_roles(training, {"path": "/copy/corpus.json", "sha256": "a" * 64})

    def test_parser_preserves_requested_capacity_without_hidden_sample_cap(self):
        args = MODULE.parse_args([
            "--training-manifest", "/training/corpus.json",
            "--evaluation-manifest", "/evaluation/corpus.json",
            "--out-dir", "/output",
            "--epochs", "7",
            "--batch-size", "13",
        ])
        self.assertEqual(args.epochs, 7)
        self.assertEqual(args.batch_size, 13)
        self.assertFalse(hasattr(args, "max_samples"))

    def test_parser_exposes_protected_rollout_training_without_hidden_horizon(self):
        args = MODULE.parse_args([
            "--training-manifest", "/training/corpus.json",
            "--evaluation-manifest", "/evaluation/corpus.json",
            "--out-dir", "/output",
            "--training-mode", "protected-rollout",
            "--rollout-seed-model", "/models/one-step.json",
            "--rollout-horizon", "4",
            "--predicted-input-fraction", "0.625",
            "--candidate-loss-weight", "0.1",
            "--splat-loss-weight", "1.0",
            "--energy-loss-weight", "0.25",
        ])
        self.assertEqual(args.training_mode, "protected-rollout")
        self.assertEqual(args.rollout_seed_model, "/models/one-step.json")
        self.assertEqual(args.rollout_horizon, 4)
        self.assertEqual(args.predicted_input_fraction, 0.625)
        self.assertEqual(args.candidate_loss_weight, 0.1)
        self.assertEqual(args.splat_loss_weight, 1.0)
        self.assertEqual(args.energy_loss_weight, 0.25)
        self.assertFalse(hasattr(args, "max_rollout_rows"))

    def test_rollout_configuration_requires_explicit_seed_and_positive_losses(self):
        config = MODULE.validate_rollout_training_config(
            training_mode="protected-rollout",
            rollout_seed_model="/models/one-step.json",
            rollout_horizon=4,
            predicted_input_fraction=0.625,
            candidate_loss_weight=0.1,
            splat_loss_weight=1.0,
            energy_loss_weight=0.25,
        )
        self.assertEqual(config["authority"], "protected-splat-scheduled-exposure-training-v0")
        self.assertEqual(config["rolloutHorizon"], 4)
        self.assertEqual(config["predictedInputFraction"], 0.625)
        with self.assertRaisesRegex(ValueError, "seed model"):
            MODULE.validate_rollout_training_config(
                "protected-rollout", None, 4, 0.625, 0.1, 1.0, 0.25,
            )
        with self.assertRaisesRegex(ValueError, "loss weights"):
            MODULE.validate_rollout_training_config(
                "protected-rollout", "/models/one-step.json", 4, 0.625, 0.1, 0.0, 0.25,
            )

    def test_loss_receipt_matches_executed_training_mode(self):
        teacher = MODULE.validate_rollout_training_config(
            "teacher-forced", None, 4, 0.625, 0.1, 1.0, 0.25,
        )
        self.assertEqual(teacher["loss"], {
            "authority": "normalized-residual-aggregate-mse-v0",
            "channelCount": MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT,
        })
        teacher_receipt = MODULE.build_training_loss_receipt(teacher, visible_energy_scale=2.0)
        self.assertNotIn("visibleEnergyScale", teacher_receipt)

        rollout = MODULE.validate_rollout_training_config(
            "protected-rollout", "/models/one-step.json", 4, 0.625, 0.1, 1.0, 0.25,
        )
        rollout_receipt = MODULE.build_training_loss_receipt(rollout, visible_energy_scale=2.0)
        self.assertEqual(rollout_receipt["authority"], "candidate-splat-visible-energy-weighted-loss-v0")
        self.assertEqual(rollout_receipt["visibleEnergyScale"], 2.0)

    def test_protected_exposure_replaces_only_splat_baseline_and_records_authority(self):
        inputs = np.zeros((2, MODULE.CORE.DESTINATION_STATE_INPUT_COUNT), dtype=np.float32)
        baselines = np.arange(50, dtype=np.float32).reshape(2, 25)
        targets = baselines + 1
        inputs[:, 64:89] = baselines
        predicted_splats = np.asarray([
            [101, 102, 103, 104, 105, 106, 107, 108, 109],
            [201, 202, 203, 204, 205, 206, 207, 208, 209],
        ], dtype=np.float32)
        exposed = MODULE.apply_protected_splat_exposure(
            inputs,
            baselines,
            targets,
            predicted_splats,
            np.asarray([True, False]),
        )
        np.testing.assert_array_equal(exposed["stateBaselines"][0, :16], baselines[0, :16])
        np.testing.assert_array_equal(exposed["stateBaselines"][0, 16:], predicted_splats[0])
        np.testing.assert_array_equal(exposed["stateBaselines"][1], baselines[1])
        np.testing.assert_array_equal(exposed["stateInputs"][:, 64:80], baselines[:, :16])
        np.testing.assert_array_equal(exposed["stateInputs"][0, 80:89], predicted_splats[0])
        np.testing.assert_array_equal(
            exposed["stateResidualTargets"],
            targets - exposed["stateBaselines"],
        )
        self.assertEqual(exposed["authority"], "canonical-candidate-splat-only-predicted-exposure-v0")
        self.assertEqual(exposed["predictedExposureCount"], 1)
        self.assertFalse(exposed["candidateStateExposed"])

    def test_visible_energy_matches_opacity_weighted_luminance(self):
        states = np.zeros((2, 25), dtype=np.float32)
        states[0, 19:23] = [1.0, 0.5, 0.25, 0.8]
        states[1, 19:23] = [0.2, 0.4, 0.6, -1.0]
        energy = MODULE.visible_energy_numpy(states)
        self.assertAlmostEqual(
            energy[0],
            0.8 * (1.0 * 0.2126 + 0.5 * 0.7152 + 0.25 * 0.0722),
            places=6,
        )
        self.assertEqual(energy[1], 0.0)

    def test_loss_contract_keeps_candidate_splat_and_energy_terms_distinct(self):
        contract = MODULE.build_rollout_loss_contract(0.1, 1.0, 0.25)
        self.assertEqual(contract["authority"], "candidate-splat-visible-energy-weighted-loss-v0")
        self.assertEqual(contract["candidateChannelCount"], 16)
        self.assertEqual(contract["splatChannelCount"], 9)
        self.assertEqual(contract["visibleEnergy"], "max(opacity,0)*max(rec709-luminance,0)")
        self.assertEqual(contract["weights"], {"candidate": 0.1, "splat": 1.0, "visibleEnergy": 0.25})

    def test_protected_rollout_preserves_seed_normalization_identity(self):
        inputs = np.arange(2 * MODULE.CORE.DESTINATION_STATE_INPUT_COUNT, dtype=np.float32).reshape(2, -1)
        residuals = np.arange(2 * MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT, dtype=np.float32).reshape(2, -1)
        seed = {
            "inputMean": np.full(MODULE.CORE.DESTINATION_STATE_INPUT_COUNT, 3.0, dtype=np.float32),
            "inputScale": np.full(MODULE.CORE.DESTINATION_STATE_INPUT_COUNT, 4.0, dtype=np.float32),
            "residualMean": np.full(MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT, 5.0, dtype=np.float32),
            "residualScale": np.full(MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT, 6.0, dtype=np.float32),
        }
        normalization = MODULE.resolve_training_normalization(
            "protected-rollout", inputs, residuals, seed,
        )
        self.assertEqual(normalization["authority"], "frozen-rollout-seed-normalization-v0")
        np.testing.assert_array_equal(normalization["inputMean"], seed["inputMean"])
        np.testing.assert_array_equal(normalization["inputScale"], seed["inputScale"])
        np.testing.assert_array_equal(normalization["residualMean"], seed["residualMean"])
        np.testing.assert_array_equal(normalization["residualScale"], seed["residualScale"])

    def test_rollout_seed_receipt_preserves_validated_route_and_fallback(self):
        model_path = (
            MODULE_PATH.parent
            / "artifacts/pyro-phase-destination-state-coupling-r1-0714/receipts/destination-state-model.json"
        )
        _, _, receipt = MODULE.load_rollout_seed_model(model_path)
        self.assertEqual(receipt["route"]["backend"], "mlx")
        self.assertRegex(receipt["route"]["device"], r"^Device\(gpu")
        self.assertIsNone(receipt["route"]["fallbackReason"])

    def test_rollout_sampler_balances_every_deployed_supported_cohort(self):
        cohorts = np.asarray([
            cohort
            for cohort_index, cohort in enumerate(MODULE.ROLLOUT_STATE_COHORTS)
            for _ in range(cohort_index + 1)
        ])
        pools = MODULE.build_state_sampling_pools(cohorts, MODULE.ROLLOUT_STATE_COHORTS)
        sampled = MODULE.sample_state_balanced_indices(
            np.random.default_rng(713),
            pools,
            MODULE.ROLLOUT_STATE_COHORTS,
            batch_size=12,
        )
        self.assertEqual(
            {cohort: int(np.sum(cohorts[sampled] == cohort)) for cohort in MODULE.ROLLOUT_STATE_COHORTS},
            {cohort: 2 for cohort in MODULE.ROLLOUT_STATE_COHORTS},
        )

    def test_rollout_sequences_reset_and_report_effective_exposure_without_cap(self):
        row = {
            "stateInputs": np.zeros((1, MODULE.CORE.DESTINATION_STATE_INPUT_COUNT), dtype=np.float32),
            "stateBaselines": np.zeros((1, MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT), dtype=np.float32),
            "stateTargets": np.ones((1, MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT), dtype=np.float32),
            "stateResidualTargets": np.ones((1, MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT), dtype=np.float32),
            "stateCohorts": np.asarray(["stable-q1"]),
            "stateDestinationKeys": [(0.0, 0.0, 0.0)],
            "stateDonorIndices": np.asarray([0]),
        }
        datasets = [{key: value.copy() if isinstance(value, np.ndarray) else list(value) for key, value in row.items()} for _ in range(3)]
        documents = [{"id": f"frame-{index}"} for index in range(4)]
        frames = {document["id"]: {"keys": [(0.0, 0.0, 0.0)]} for document in documents}
        normalization = {
            "inputMean": np.zeros(MODULE.CORE.DESTINATION_STATE_INPUT_COUNT, dtype=np.float32),
            "inputScale": np.ones(MODULE.CORE.DESTINATION_STATE_INPUT_COUNT, dtype=np.float32),
            "residualMean": np.zeros(MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT, dtype=np.float32),
            "residualScale": np.ones(MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT, dtype=np.float32),
        }
        with patch.object(
            MODULE.CORE,
            "predict_destination_state_model",
            return_value=np.zeros((1, MODULE.CORE.DESTINATION_STATE_ATTRIBUTE_COUNT), dtype=np.float32),
        ):
            _, report = MODULE.build_protected_rollout_datasets(
                datasets,
                documents,
                frames,
                seed_model=object(),
                seed_normalization=normalization,
                predicted_input_fraction=1.0,
                rollout_horizon=2,
                batch_size=8,
                rng=np.random.default_rng(713),
            )
        self.assertEqual([pair["sequenceReset"] for pair in report["pairReports"]], [True, False, True])
        self.assertEqual(report["eligiblePredictedInputCount"], 1)
        self.assertEqual(report["predictedExposureCount"], 1)
        self.assertEqual(report["effectivePredictedInputFraction"], 1.0)
        self.assertIsNone(report["sampleCap"])

    def test_protected_pair_reports_include_all_configured_cohorts(self):
        dataset = {
            "stateCohorts": np.asarray(MODULE.ROLLOUT_STATE_COHORTS),
        }
        documents = [{"id": "frame-0"}, {"id": "frame-1"}]
        frames = {"frame-0": object(), "frame-1": object()}
        with patch.object(MODULE.CORE, "build_destination_state_dataset", return_value=dataset):
            _, reports = MODULE.build_adjacent_state_datasets(
                documents,
                frames,
                grid_step=0.1,
                state_cohorts=MODULE.ROLLOUT_STATE_COHORTS,
            )
        self.assertEqual(reports[0]["cohortCounts"], {
            cohort: 1 for cohort in MODULE.ROLLOUT_STATE_COHORTS
        })

    def test_failure_report_preserves_phase_and_last_trustworthy_evidence(self):
        report = MODULE.build_failure_report(
            started_at=10.0,
            failure_phase="evaluation-dataset-construction",
            error=RuntimeError("bad heldout payload"),
            last_trustworthy={"trainingManifestSha256": "a" * 64, "effectiveDevice": "Device(gpu, 0)"},
        )
        self.assertEqual(report["schema"], MODULE.REPORT_SCHEMA)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["failurePhase"], "evaluation-dataset-construction")
        self.assertEqual(report["lastTrustworthyEvidence"]["trainingManifestSha256"], "a" * 64)
        self.assertIn("bad heldout payload", report["error"])

    def test_running_report_exists_before_primary_artifacts_and_names_current_phase(self):
        report = MODULE.build_running_report(
            started_at=10.0,
            phase="training-manifest-validation",
            last_trustworthy={"requestedEpochs": 8, "requestedBatchSize": 4096},
        )
        self.assertEqual(report["schema"], MODULE.REPORT_SCHEMA)
        self.assertEqual(report["status"], "running")
        self.assertEqual(report["currentPhase"], "training-manifest-validation")
        self.assertEqual(report["lastTrustworthyEvidence"]["requestedEpochs"], 8)


if __name__ == "__main__":
    unittest.main()
