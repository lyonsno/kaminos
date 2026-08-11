import hashlib
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FinalResultTest(unittest.TestCase):
    def setUp(self):
        self.sweep = json.loads((ROOT / "result.json").read_text())
        self.final = json.loads((ROOT / "final-result.json").read_text())
        self.selection = json.loads((ROOT / "carrier-selection.json").read_text())

    def test_final_result_binds_sweep_selection_and_every_output(self):
        self.assertEqual(self.final["sweepResultSha256"], sha256(ROOT / "result.json"))
        self.assertEqual(self.final["carrierSelectionSha256"], sha256(ROOT / "carrier-selection.json"))
        self.assertEqual(self.final["chosenCandidate"]["name"], self.selection["chosenCandidate"])
        for record in self.final["outputs"].values():
            self.assertEqual(record["sha256"], sha256(ROOT / record["path"]))

    def test_sweep_names_only_a_metric_nominee_before_visual_selection(self):
        self.assertIn("metricNominee", self.sweep)
        self.assertNotIn("chosenCandidate", self.sweep)
        self.assertNotIn("staticGroom", self.sweep)
        serialized = json.dumps(self.sweep)
        self.assertNotIn("chosen-carrier-with-static-groom", serialized)

    def test_visual_admission_is_agent_owned_and_hash_bound(self):
        admission = json.loads((ROOT / "visual-admission.json").read_text())
        self.assertEqual(admission["finalResultSha256"], sha256(ROOT / "final-result.json"))
        self.assertEqual(admission["inspector"], "agent-visual-review")
        self.assertEqual(admission["verdicts"]["cleanCarrierRecovery"], "admitted-exact-route-seed")
        self.assertEqual(admission["verdicts"]["staticGroomPlacement"], "admitted-mechanism-only")
        self.assertEqual(admission["verdicts"]["originalFurVolumeReplacement"], "not-supported")
        for image in admission["inspectedImages"]:
            self.assertEqual(image["sha256"], sha256(ROOT / image["path"]))

    def test_sheet_exposes_source_sweep_selection_and_final_groom(self):
        sheet = (ROOT / "sheet.html").read_text()
        for token in (
            "Authenticated source",
            "Admitted malformed-coat selection",
            "Carrier sweep",
            "Visual selection",
            "Static groom witness",
            "not a volume-matched fur replacement",
        ):
            self.assertIn(token, sheet)

    def test_sheet_is_part_of_the_normally_publishable_artifact(self):
        completed = subprocess.run(
            [
                "git",
                "check-ignore",
                "-q",
                "--no-index",
                str(ROOT / "sheet.html"),
            ],
            cwd=ROOT.parents[1],
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            1,
            "sheet.html is ignored and would silently disappear from publication",
        )


if __name__ == "__main__":
    unittest.main()
