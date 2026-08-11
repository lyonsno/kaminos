import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]


class FurSignalCampaignResultTest(unittest.TestCase):
    def setUp(self):
        self.campaign = json.loads((ROOT / "campaign.json").read_text())

    def test_all_inputs_are_hash_bound_and_seed_matched(self):
        seeds = []
        for family_name, family in self.campaign["families"].items():
            family_seeds = []
            for asset in family["assets"]:
                source = REPO / asset["path"]
                self.assertTrue(source.is_file(), f"missing {family_name} source {source}")
                observed = hashlib.sha256(source.read_bytes()).hexdigest()
                self.assertEqual(observed, asset["sha256"])
                family_seeds.append(asset["seed"])
            seeds.append(family_seeds)
        self.assertEqual(seeds[0], seeds[1])

    def test_primary_result_records_effective_route_and_replayable_views(self):
        result = json.loads((ROOT / "result.json").read_text())
        self.assertEqual(result["schema"], "kaminos.fur-signal-metric-atlas-result.v0")
        self.assertEqual(result["effectiveRoute"]["extractor"], "blender-python")
        self.assertRegex(result["effectiveRoute"]["blenderVersion"], r"^\d+\.\d+")
        self.assertEqual(len(result["assets"]), 6)
        for asset in result["assets"]:
            self.assertGreater(asset["triangleCount"], 1000)
            self.assertEqual(asset["sourceSha256"], asset["expectedSha256"])
            for relative in asset["views"].values():
                view = ROOT / relative
                self.assertTrue(view.is_file(), relative)
                self.assertGreater(view.stat().st_size, 1000)
            for channel, validation in asset["renderValidation"].items():
                self.assertGreater(validation["foregroundPixels"], 1000, channel)
                self.assertLess(validation["nearWhiteFraction"], 0.15, channel)
                if channel.endswith("_selected"):
                    self.assertGreater(validation["selectedPixels"], 8, channel)
                else:
                    self.assertGreater(validation["luminanceSpan"], 0.06, channel)
                    self.assertGreater(validation["p90Chroma"], 0.025, channel)

    def test_result_cannot_claim_visual_admission_automatically(self):
        result = json.loads((ROOT / "result.json").read_text())
        self.assertEqual(result["visualAdmission"], "pending-agent-inspection")
        self.assertIn(result["quantitativeStatus"], {"candidate", "no-signal"})
        self.assertIn("claimCeiling", result)

    def test_surviving_metrics_have_exact_control_threshold_selection_views(self):
        result = json.loads((ROOT / "result.json").read_text())
        discrimination = {entry["metric"]: entry for entry in result["discrimination"]}
        for metric in ("relative_area", "component_sheetness"):
            self.assertIn(metric, result["candidateMetrics"])
            selected = f"{metric}_selected"
            for asset in result["assets"]:
                self.assertIn(selected, asset["views"])
                view = ROOT / asset["views"][selected]
                self.assertTrue(view.is_file(), str(view))
                expected = discrimination[metric][f"{asset['family']}CoverageBySeed"][str(asset["seed"])]
                self.assertAlmostEqual(asset["selectionCoverage"][metric], expected)

    def test_visual_adjudication_is_bound_to_the_generated_result_and_inspected_images(self):
        result_path = ROOT / "result.json"
        admission = json.loads((ROOT / "visual-admission.json").read_text())
        self.assertEqual(
            admission["resultSha256"],
            hashlib.sha256(result_path.read_bytes()).hexdigest(),
        )
        self.assertEqual(admission["verdicts"]["mlxFailureCoatVolumeDetector"], "admitted")
        self.assertEqual(admission["verdicts"]["cleanFurVersusSkinSegmentation"], "rejected")
        self.assertEqual(admission["verdicts"]["generalFurDetector"], "not-supported")
        self.assertEqual(len(admission["inspectedImages"]), 12)
        for evidence in admission["inspectedImages"]:
            path = ROOT / evidence["path"]
            self.assertTrue(path.is_file(), str(path))
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), evidence["sha256"])

    def test_sheet_contains_prompts_sources_statistics_and_every_view(self):
        result = json.loads((ROOT / "result.json").read_text())
        sheet = (ROOT / "sheet.html").read_text()
        for family in self.campaign["families"].values():
            self.assertIn(family["prompt"], sheet)
        for asset in result["assets"]:
            self.assertIn(asset["sourceSha256"][:12], sheet)
            for relative in asset["views"].values():
                self.assertIn(relative, sheet)
        self.assertIn("Control-derived discrimination", sheet)


if __name__ == "__main__":
    unittest.main()
