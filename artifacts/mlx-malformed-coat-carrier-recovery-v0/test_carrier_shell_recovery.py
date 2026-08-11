import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

from carrier_shell_recovery import (  # noqa: E402
    choose_candidate,
    evaluate_candidate,
    load_admitted_selection,
    prepare_run,
    resolve_visual_selection,
    validate_run_outputs,
    verify_source,
    write_failure_report,
)


class CarrierShellRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.campaign = json.loads((ROOT / "campaign.json").read_text())

    def test_campaign_authenticates_every_authority_bearing_source(self):
        source_records = [
            self.campaign["sourcePlate"],
            self.campaign["sourceCast"],
            {
                "path": self.campaign["admittedSelection"]["arraysPath"],
                "sha256": self.campaign["admittedSelection"]["arraysSha256"],
            },
            {
                "path": self.campaign["admittedSelection"]["atlasResultPath"],
                "sha256": self.campaign["admittedSelection"]["atlasResultSha256"],
            },
            {
                "path": self.campaign["admittedSelection"]["visualAdmissionPath"],
                "sha256": self.campaign["admittedSelection"]["visualAdmissionSha256"],
            },
        ]
        for record in source_records:
            self.assertEqual(
                verify_source(REPO / record["path"], record["sha256"]),
                record["sha256"],
            )

    def test_selection_is_exactly_replayed_from_admitted_metric_and_threshold(self):
        selection = load_admitted_selection(REPO, self.campaign)
        self.assertEqual(selection.dtype, np.bool_)
        self.assertEqual(selection.shape, (41141,))
        self.assertEqual(int(selection.sum()), 38305)

    def test_stale_threshold_or_stale_persisted_mask_fails_loud(self):
        with tempfile.TemporaryDirectory() as directory:
            arrays = Path(directory) / "stale-selection.npz"
            with np.load(REPO / self.campaign["admittedSelection"]["arraysPath"]) as source:
                values = {name: source[name] for name in source.files}
            values["relative_area_selected"] = values["relative_area_selected"].copy()
            values["relative_area_selected"][0] = 1.0 - values["relative_area_selected"][0]
            np.savez_compressed(arrays, **values)
            altered = json.loads(json.dumps(self.campaign))
            altered["admittedSelection"]["arraysPath"] = str(arrays)
            altered["admittedSelection"]["arraysSha256"] = hashlib.sha256(arrays.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, "persisted selection does not match"):
                load_admitted_selection(Path("/"), altered)

    def test_candidate_rejects_fragmentation_and_silhouette_loss(self):
        healthy = evaluate_candidate(
            name="healthy",
            face_counts=[970, 30],
            source_bounds=[10.0, 4.0, 3.0],
            candidate_bounds=[9.5, 3.9, 2.9],
            silhouette_ious={"side": 0.88, "front": 0.82, "top": 0.84},
            volume=21.0,
            constraints=self.campaign["candidateSweep"],
        )
        fragmented = evaluate_candidate(
            name="fragmented",
            face_counts=[600, 400],
            source_bounds=[10.0, 4.0, 3.0],
            candidate_bounds=[9.5, 3.9, 2.9],
            silhouette_ious={"side": 0.88, "front": 0.82, "top": 0.84},
            volume=21.0,
            constraints=self.campaign["candidateSweep"],
        )
        collapsed = evaluate_candidate(
            name="collapsed",
            face_counts=[1000],
            source_bounds=[10.0, 4.0, 3.0],
            candidate_bounds=[7.5, 3.9, 2.9],
            silhouette_ious={"side": 0.7, "front": 0.82, "top": 0.84},
            volume=21.0,
            constraints=self.campaign["candidateSweep"],
        )
        self.assertTrue(healthy["admissible"])
        self.assertFalse(fragmented["admissible"])
        self.assertIn("fragmented", fragmented["rejectionReasons"])
        self.assertFalse(collapsed["admissible"])
        self.assertIn("silhouette-loss", collapsed["rejectionReasons"])
        self.assertIn("bounds-shrink", collapsed["rejectionReasons"])

    def test_candidate_choice_is_least_destructive_not_merely_smoothest(self):
        candidates = [
            {"name": "coarse", "admissible": True, "meanSilhouetteIou": 0.84, "meanBoundsRetention": 0.91},
            {"name": "faithful", "admissible": True, "meanSilhouetteIou": 0.9, "meanBoundsRetention": 0.96},
            {"name": "rejected", "admissible": False, "meanSilhouetteIou": 0.99, "meanBoundsRetention": 0.99},
        ]
        self.assertEqual(choose_candidate(candidates)["name"], "faithful")

    def test_visual_selection_must_name_an_admissible_measured_candidate(self):
        candidates = [
            {"name": "fine", "admissible": True},
            {"name": "collapsed", "admissible": False},
        ]
        selected = resolve_visual_selection(
            candidates,
            {"selectionAuthority": "agent-visual-inspection", "chosenCandidate": "fine"},
        )
        self.assertEqual(selected["name"], "fine")
        with self.assertRaisesRegex(ValueError, "not admissible"):
            resolve_visual_selection(
                candidates,
                {"selectionAuthority": "agent-visual-inspection", "chosenCandidate": "collapsed"},
            )
        with self.assertRaisesRegex(ValueError, "selection authority"):
            resolve_visual_selection(
                candidates,
                {"selectionAuthority": "automatic-metric", "chosenCandidate": "fine"},
            )

    def test_preoutput_failure_still_writes_durable_phase_report(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "failure.json"
            write_failure_report(
                destination,
                phase="candidate-voxel-fusion",
                error="synthetic failure",
                last_trustworthy_evidence={"selectedFaceCount": 38305},
            )
            report = json.loads(destination.read_text())
            self.assertEqual(report["phase"], "candidate-voxel-fusion")
            self.assertEqual(report["lastTrustworthyEvidence"]["selectedFaceCount"], 38305)

    def test_nominal_zero_exit_cannot_hide_failure_or_missing_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prepare_run(root, run_id="current-run")
            write_failure_report(
                root / "failure.json",
                phase="render",
                error="synthetic failure",
                last_trustworthy_evidence={"phase": "candidate-measured"},
            )
            with self.assertRaisesRegex(RuntimeError, "durable failure report"):
                validate_run_outputs(root, process_returncode=0)
            (root / "failure.json").unlink()
            with self.assertRaisesRegex(RuntimeError, "result.json is missing"):
                validate_run_outputs(root, process_returncode=0)

    def test_nominal_zero_exit_cannot_accept_a_result_from_an_older_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "run-request.json").write_text(json.dumps({"runId": "current-run"}))
            (root / "result.json").write_text(json.dumps({"runId": "stale-run"}))
            with self.assertRaisesRegex(RuntimeError, "does not match current run"):
                validate_run_outputs(root, process_returncode=0)


if __name__ == "__main__":
    unittest.main()
