import hashlib
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "boundary-splat-phase-state-interpolate.py"
GENERATION_TWO_MODEL = (
    ROOT / "artifacts/pyro-phase-rollout-generation-two-r1-0715/receipts/gen2-model.json"
)
ONLINE_MODEL = ROOT / "artifacts/pyro-phase-online-rollout-r1-0715/receipts/online-model.json"


def load_module():
    if not MODULE_PATH.exists():
        raise AssertionError("destination-state checkpoint interpolation tool is missing")
    spec = importlib.util.spec_from_file_location(
        "boundary_splat_phase_state_interpolate", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class DestinationStateCheckpointInterpolationContracts(unittest.TestCase):
    def test_interpolates_every_requested_alpha_with_exact_endpoints_and_receipts(self):
        module = load_module()
        requested_alphas = [0.0, 0.25, 0.5, 0.75, 1.0]
        generation_two = json.loads(GENERATION_TWO_MODEL.read_text())
        online = json.loads(ONLINE_MODEL.read_text())

        with tempfile.TemporaryDirectory() as root:
            report = module.run_interpolation(
                GENERATION_TWO_MODEL,
                ONLINE_MODEL,
                requested_alphas,
                Path(root),
            )

            self.assertEqual(report["status"], "completed")
            self.assertEqual(report["requestedAlphas"], requested_alphas)
            self.assertEqual(len(report["outputs"]), len(requested_alphas))
            self.assertNotIn("maxModels", report)
            self.assertEqual(report["sources"]["from"]["sha256"], sha256(GENERATION_TWO_MODEL))
            self.assertEqual(report["sources"]["to"]["sha256"], sha256(ONLINE_MODEL))
            self.assertEqual(report["parameterCount"], 34713)
            self.assertEqual(report["constructionRoute"]["backend"], "python-cpu")
            self.assertIsNone(report["constructionRoute"]["fallbackReason"])

            outputs = {row["alpha"]: row for row in report["outputs"]}
            models = {
                alpha: json.loads(Path(outputs[alpha]["path"]).read_text())
                for alpha in requested_alphas
            }
            for alpha, row in outputs.items():
                self.assertEqual(row["sha256"], sha256(row["path"]))
                self.assertEqual(models[alpha]["interpolation"]["effectiveAlpha"], alpha)
                self.assertEqual(
                    models[alpha]["evaluation"]["authority"],
                    "not-evaluated-checkpoint-interpolation-v0",
                )
                self.assertEqual(
                    models[alpha]["route"]["checkpointConstruction"]["authority"],
                    "deterministic-python-checkpoint-interpolation-v0",
                )
                self.assertEqual(
                    models[alpha]["route"]["checkpointConstruction"]["backend"],
                    "python-cpu",
                )

            for layer_index in range(3):
                self.assertEqual(
                    models[0.0]["architecture"]["layers"][layer_index]["weights"],
                    generation_two["architecture"]["layers"][layer_index]["weights"],
                )
                self.assertEqual(
                    models[0.0]["architecture"]["layers"][layer_index]["bias"],
                    generation_two["architecture"]["layers"][layer_index]["bias"],
                )
                self.assertEqual(
                    models[1.0]["architecture"]["layers"][layer_index]["weights"],
                    online["architecture"]["layers"][layer_index]["weights"],
                )
                self.assertEqual(
                    models[1.0]["architecture"]["layers"][layer_index]["bias"],
                    online["architecture"]["layers"][layer_index]["bias"],
                )

            from_weight = generation_two["architecture"]["layers"][0]["weights"][0]
            to_weight = online["architecture"]["layers"][0]["weights"][0]
            self.assertAlmostEqual(
                models[0.25]["architecture"]["layers"][0]["weights"][0],
                from_weight * 0.75 + to_weight * 0.25,
                places=12,
            )
            self.assertEqual(outputs[0.0]["maxAbsEndpointParameterError"], 0.0)
            self.assertEqual(outputs[1.0]["maxAbsEndpointParameterError"], 0.0)
            self.assertTrue((Path(root) / "interpolation-report.json").exists())

    def test_rejects_normalization_mismatch_and_writes_durable_failure_report(self):
        module = load_module()
        mismatched = json.loads(ONLINE_MODEL.read_text())
        mismatched["input"]["mean"][0] += 0.125

        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            mismatched_path = root_path / "mismatched.json"
            mismatched_path.write_text(json.dumps(mismatched))
            out_dir = root_path / "output"

            with self.assertRaisesRegex(ValueError, "input contract mismatch"):
                module.run_interpolation(
                    GENERATION_TWO_MODEL,
                    mismatched_path,
                    [0.5],
                    out_dir,
                )

            report = json.loads((out_dir / "interpolation-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "validate-source-compatibility")
            self.assertEqual(report["lastTrustworthyEvidence"]["from"]["sha256"], sha256(GENERATION_TWO_MODEL))
            self.assertEqual(report["lastTrustworthyEvidence"]["to"]["sha256"], sha256(mismatched_path))
            self.assertEqual(list(out_dir.glob("destination-state-model-alpha-*.json")), [])

    def test_rejects_nonfinite_parameters_before_writing_models(self):
        module = load_module()
        nonfinite = json.loads(ONLINE_MODEL.read_text())
        nonfinite["architecture"]["layers"][1]["bias"][3] = math.nan

        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            nonfinite_path = root_path / "nonfinite.json"
            nonfinite_path.write_text(json.dumps(nonfinite))
            out_dir = root_path / "output"

            with self.assertRaisesRegex(ValueError, "finite"):
                module.run_interpolation(
                    GENERATION_TWO_MODEL,
                    nonfinite_path,
                    [0.5],
                    out_dir,
                )

            report = json.loads((out_dir / "interpolation-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "validate-source-models")
            self.assertEqual(list(out_dir.glob("destination-state-model-alpha-*.json")), [])

    def test_parser_requires_caller_paths_and_preserves_every_alpha_without_a_cap(self):
        module = load_module()
        args = module.parse_args([
            "--from-model", str(GENERATION_TWO_MODEL),
            "--to-model", str(ONLINE_MODEL),
            "--out-dir", "/tmp/interpolated-models",
            "--alpha", "0.25",
            "--alpha", "0.50",
            "--alpha", "0.75",
        ])
        self.assertEqual(args.alpha, [0.25, 0.5, 0.75])
        self.assertEqual(args.out_dir, "/tmp/interpolated-models")
        self.assertFalse(hasattr(args, "max_models"))
        self.assertFalse(hasattr(args, "max_parameters"))

    def test_mid_write_failure_removes_partial_models_and_reports_the_phase(self):
        module = load_module()
        real_writer = module.write_json_atomic

        with tempfile.TemporaryDirectory() as root:
            out_dir = Path(root) / "output"

            def fail_second_model(path, document):
                if Path(path).name == "destination-state-model-alpha-0p5.json":
                    raise OSError("synthetic second-model write failure")
                return real_writer(path, document)

            with patch.object(module, "write_json_atomic", side_effect=fail_second_model):
                with self.assertRaisesRegex(OSError, "second-model write failure"):
                    module.run_interpolation(
                        GENERATION_TWO_MODEL,
                        ONLINE_MODEL,
                        [0.25, 0.5],
                        out_dir,
                    )

            report = json.loads((out_dir / "interpolation-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "write-output-models")
            self.assertEqual(list(out_dir.glob("destination-state-model-alpha-*.json")), [])

    def test_rejects_duplicate_or_out_of_range_alphas(self):
        module = load_module()
        with self.assertRaisesRegex(ValueError, "unique"):
            module.validate_alphas([0.25, 0.25])
        with self.assertRaisesRegex(ValueError, "closed interval"):
            module.validate_alphas([-0.1])
        with self.assertRaisesRegex(ValueError, "finite"):
            module.validate_alphas([math.nan])

    def test_invalid_alpha_failure_records_constructor_and_requested_source_paths(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as root:
            out_dir = Path(root) / "output"
            with self.assertRaisesRegex(ValueError, "finite"):
                module.run_interpolation(
                    GENERATION_TWO_MODEL,
                    ONLINE_MODEL,
                    [math.nan],
                    out_dir,
                )

            report = json.loads((out_dir / "interpolation-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "validate-request")
            self.assertEqual(report["constructionRoute"]["backend"], "python-cpu")
            self.assertEqual(report["requestedAlphas"], ["nan"])
            self.assertEqual(
                report["sourceRequests"]["from"]["requestedPath"],
                str(GENERATION_TWO_MODEL),
            )
            self.assertEqual(
                report["sourceRequests"]["from"]["effectivePath"],
                str(GENERATION_TWO_MODEL.resolve()),
            )
            self.assertEqual(
                report["sourceRequests"]["to"]["effectivePath"],
                str(ONLINE_MODEL.resolve()),
            )

    def test_missing_second_source_failure_retains_first_source_hash(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            missing_path = root_path / "missing-online-model.json"
            out_dir = root_path / "output"
            with self.assertRaises(FileNotFoundError):
                module.run_interpolation(
                    GENERATION_TWO_MODEL,
                    missing_path,
                    [0.5],
                    out_dir,
                )

            report = json.loads((out_dir / "interpolation-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "read-to-source-model")
            self.assertEqual(report["constructionRoute"]["backend"], "python-cpu")
            self.assertEqual(
                report["lastTrustworthyEvidence"]["from"]["sha256"],
                sha256(GENERATION_TWO_MODEL),
            )
            self.assertEqual(
                report["sourceRequests"]["to"]["effectivePath"], str(missing_path.resolve())
            )

    def test_stale_output_cleanup_failure_writes_report_before_removal(self):
        module = load_module()
        real_unlink = Path.unlink
        with tempfile.TemporaryDirectory() as root:
            out_dir = Path(root) / "output"
            out_dir.mkdir()
            stale_path = out_dir / "destination-state-model-alpha-0p5.json"
            stale_path.write_text("stale")

            def fail_stale_unlink(path, *args, **kwargs):
                if path.resolve() == stale_path.resolve():
                    raise PermissionError("synthetic stale-output cleanup failure")
                return real_unlink(path, *args, **kwargs)

            with patch.object(Path, "unlink", new=fail_stale_unlink):
                with self.assertRaisesRegex(PermissionError, "stale-output cleanup failure"):
                    module.run_interpolation(
                        GENERATION_TWO_MODEL,
                        ONLINE_MODEL,
                        [0.5],
                        out_dir,
                    )

            report = json.loads((out_dir / "interpolation-report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "remove-stale-outputs")
            self.assertEqual(report["constructionRoute"]["backend"], "python-cpu")
            self.assertEqual(report["staleOutputPaths"], [str(stale_path.resolve())])
            self.assertTrue(stale_path.exists())


if __name__ == "__main__":
    unittest.main()
