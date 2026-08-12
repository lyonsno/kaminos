import hashlib
import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = REPO / "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb"
sys.path.insert(0, str(ROOT))

import hidden_carrier_assay as assay  # noqa: E402


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class HiddenCarrierAssayTest(unittest.TestCase):
    def run_in(self, output_dir, **overrides):
        arguments = {
            "repo_root": REPO,
            "source_path": SOURCE,
            "output_dir": output_dir,
            "profile": "short-with-medium-scapular-v0",
            "uniform_inset": 0.94,
        }
        arguments.update(overrides)
        return assay.run_assay(**arguments)

    def test_success_is_source_bound_truth_isolated_and_artifact_complete(self):
        self.assertEqual(
            list(inspect.signature(assay.recover_uniform_inset).parameters),
            ["observed", "normals", "inset"],
        )
        with tempfile.TemporaryDirectory() as directory:
            report = self.run_in(directory)
            self.assertEqual(report["schema"], assay.SCHEMA)
            self.assertEqual(report["status"], "captured")
            self.assertTrue(report["terminal"])
            self.assertIsNone(report["failurePhase"])
            self.assertEqual(report["requestedConfig"]["route"], assay.ROUTE)
            self.assertEqual(report["effectiveConfig"]["route"], assay.ROUTE)
            self.assertEqual(report["requestedConfig"]["sourcePath"], str(SOURCE))
            self.assertEqual(
                report["effectiveConfig"]["sourcePath"],
                "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb",
            )
            self.assertEqual(report["effectiveConfig"]["repoRoot"], ".")
            self.assertEqual(report["effectiveConfig"]["outputDir"], str(Path(directory).resolve()))
            self.assertEqual(
                report["implementation"]["runner"],
                {
                    "path": "artifacts/authored-cat-hidden-carrier-v0/hidden_carrier_assay.py",
                    "sha256": sha256(ROOT / "hidden_carrier_assay.py"),
                },
            )
            self.assertEqual(
                report["implementation"]["fixture"],
                {
                    "path": "artifacts/authored-cat-hidden-carrier-v0/hidden_carrier_fixture.py",
                    "sha256": sha256(ROOT / "hidden_carrier_fixture.py"),
                },
            )
            self.assertEqual(report["effectiveConfig"]["recoveryArm"], assay.RECOVERY_ARM)
            self.assertEqual(report["effectiveConfig"]["uniformInset"], 0.94)
            self.assertEqual(
                report["effectiveConfig"]["uniformInsetAuthority"],
                "assay-author-explicit-config",
            )
            self.assertEqual(
                report["effectiveConfig"]["uniformInsetCalibration"],
                "fixture-author-selected-from-prior-authored-truth-depth-summary",
            )
            self.assertEqual(
                report["source"]["sha256"],
                "cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e",
            )
            self.assertGreater(report["source"]["vertexCount"], 100)
            self.assertIsNone(report["priorTerminalReportSha256"])
            self.assertEqual(set(report["artifacts"]), {"observation", "recoveredCarrier"})
            for artifact in report["artifacts"].values():
                path = Path(directory) / artifact["path"]
                self.assertGreater(path.stat().st_size, 0)
                self.assertEqual(artifact["sha256"], sha256(path))
            self.assertGreater(report["metrics"]["rmse"], 0.0)
            self.assertIn("medium-scapular", report["metrics"]["regionalRmse"])
            self.assertEqual(json.loads((Path(directory) / "report.json").read_text()), report)

    def test_missing_and_digest_mismatched_sources_fail_with_terminal_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = self.run_in(Path(directory) / "missing-run", source_path=REPO / "absent.glb")
            self.assertEqual(missing["status"], "failed")
            self.assertTrue(missing["terminal"])
            self.assertEqual(missing["failurePhase"], "source-validation")
            self.assertIsNone(missing["effectiveConfig"])
            self.assertEqual(missing["artifacts"], {})
            self.assertTrue((Path(directory) / "missing-run/report.json").is_file())

            wrong_source = Path(directory) / "wrong.glb"
            wrong_source.write_bytes(b"not the frozen source")
            mismatch = self.run_in(Path(directory) / "mismatch-run", source_path=wrong_source)
            self.assertEqual(mismatch["status"], "failed")
            self.assertEqual(mismatch["failurePhase"], "source-validation")
            self.assertIn("digest mismatch", mismatch["reason"])

    def test_wrong_route_and_profile_fail_instead_of_falling_back_to_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            wrong_route = self.run_in(Path(directory) / "route", requested_route="fallback-maybe")
            self.assertEqual(wrong_route["status"], "failed")
            self.assertEqual(wrong_route["failurePhase"], "route-validation")
            self.assertEqual(wrong_route["requestedConfig"]["route"], "fallback-maybe")
            self.assertIsNone(wrong_route["effectiveConfig"])

            wrong_profile = self.run_in(Path(directory) / "profile", profile="quiet-default")
            self.assertEqual(wrong_profile["status"], "failed")
            self.assertEqual(wrong_profile["failurePhase"], "configuration-validation")
            self.assertEqual(wrong_profile["requestedConfig"]["profile"], "quiet-default")
            self.assertIsNone(wrong_profile["effectiveConfig"])

    def test_repo_internal_effective_paths_are_portable_locators(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            relative_output = Path(directory).resolve().relative_to(REPO.resolve()).as_posix()
            report = self.run_in(directory, repo_root=REPO)
            self.assertEqual(report["status"], "captured")
            self.assertEqual(report["effectiveConfig"]["repoRoot"], ".")
            self.assertEqual(
                report["effectiveConfig"]["sourcePath"],
                "artifacts/registration-consumer-v0/inputs/authored_cat_envelope.glb",
            )
            self.assertEqual(report["effectiveConfig"]["outputDir"], relative_output)

    def test_missing_or_blank_primary_artifacts_cannot_close_the_assay(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(assay, "_write_npz", autospec=True):
                missing = self.run_in(Path(directory) / "missing")
            self.assertEqual(missing["status"], "failed")
            self.assertEqual(missing["failurePhase"], "observation-artifact-validation")
            self.assertEqual(missing["artifacts"], {})

            def write_blank(path, **arrays):
                Path(path).write_bytes(b"")

            with mock.patch.object(assay, "_write_npz", side_effect=write_blank):
                blank = self.run_in(Path(directory) / "blank")
            self.assertEqual(blank["status"], "failed")
            self.assertEqual(blank["failurePhase"], "observation-artifact-validation")
            self.assertEqual(blank["artifacts"], {})

    def test_partial_recovery_shape_fails_before_primary_recovery_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            original = assay.recover_uniform_inset

            def partial(observed, normals, inset):
                return original(observed, normals, inset)[:-1]

            with mock.patch.object(assay, "recover_uniform_inset", side_effect=partial):
                report = self.run_in(directory)
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "recovery-validation")
            self.assertNotIn("recoveredCarrier", report["artifacts"])
            self.assertFalse((Path(directory) / "recovered-carrier.npz").exists())

    def test_prior_run_cannot_masquerade_as_current_evidence_after_early_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / "observation.npz").write_bytes(b"stale observation")
            (out / "recovered-carrier.npz").write_bytes(b"stale recovery")
            (out / "report.json").write_text('{"status":"captured","terminal":true}\n')
            prior_sha = sha256(out / "report.json")
            with mock.patch.object(assay, "load_glb_surface", side_effect=RuntimeError("injected load failure")):
                report = self.run_in(out)
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "carrier-load")
            self.assertEqual(report["priorTerminalReportSha256"], prior_sha)
            self.assertFalse((out / "observation.npz").exists())
            self.assertFalse((out / "recovered-carrier.npz").exists())
            self.assertEqual(json.loads((out / "report.json").read_text()), report)

    def test_unremovable_stale_primary_overwrites_prior_success_with_terminal_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            stale_report = out / "report.json"
            stale_report.write_text('{"status":"captured","terminal":true}\n')
            prior_sha = sha256(stale_report)
            (out / "observation.npz").mkdir()
            (out / "recovered-carrier.npz").write_bytes(b"stale recovery")
            report = self.run_in(out)
            self.assertEqual(report["status"], "failed")
            self.assertTrue(report["terminal"])
            self.assertEqual(report["failurePhase"], "output-initialization")
            self.assertEqual(report["priorTerminalReportSha256"], prior_sha)
            self.assertIn("could not invalidate", report["reason"])
            self.assertEqual(json.loads(stale_report.read_text()), report)
            self.assertFalse((out / "recovered-carrier.npz").exists())

    def test_repeated_execution_recomputes_artifacts_and_preserves_prior_receipt_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_in(directory)
            first_report_sha = sha256(Path(directory) / "report.json")
            first_artifact_hashes = {
                name: value["sha256"] for name, value in first["artifacts"].items()
            }
            second = self.run_in(directory)
            self.assertEqual(second["status"], "captured")
            self.assertNotEqual(second["executionId"], first["executionId"])
            self.assertEqual(second["priorTerminalReportSha256"], first_report_sha)
            self.assertEqual(
                {name: value["sha256"] for name, value in second["artifacts"].items()},
                first_artifact_hashes,
            )
            self.assertEqual(second["metrics"], first["metrics"])

    def test_cli_parse_failure_invalidates_prior_primaries_and_writes_terminal_report(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / "observation.npz").write_bytes(b"stale observation")
            (out / "recovered-carrier.npz").write_bytes(b"stale recovery")
            (out / "report.json").write_text('{"status":"captured","terminal":true}\n')
            prior_sha = sha256(out / "report.json")
            status = assay.main(
                [
                    "--repo-root",
                    str(REPO),
                    "--source",
                    str(SOURCE),
                    "--output-dir",
                    str(out),
                    "--profile",
                    "short-v0",
                    "--uniform-inset",
                ]
            )
            self.assertEqual(status, 2)
            report = json.loads((out / "report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertTrue(report["terminal"])
            self.assertEqual(report["failurePhase"], "argument-parse")
            self.assertEqual(report["priorTerminalReportSha256"], prior_sha)
            self.assertFalse((out / "observation.npz").exists())
            self.assertFalse((out / "recovered-carrier.npz").exists())


if __name__ == "__main__":
    unittest.main()
