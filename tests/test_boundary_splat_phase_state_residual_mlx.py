import importlib.util
import unittest
from pathlib import Path


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
