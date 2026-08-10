#!/usr/bin/env python3
"""Validate the authored-envelope FLUX-to-TRELLIS basin campaign."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
CAMPAIGN = ROOT / "campaign.json"
FLUX_LEDGER = ROOT / "flux-ledger.json"
VISUAL_ADMISSION = ROOT / "visual-admission.json"
TRELLIS_LEDGER = ROOT / "trellis-ledger.json"
TRELLIS_VISUAL_REVIEW = ROOT / "trellis-visual-review.json"
CAUSAL_SHEET = ROOT / "latest-envelope-basin-reconstruction.html"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CampaignContractTest(unittest.TestCase):
    def test_campaign_is_six_families_crossed_with_three_common_seeds(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        self.assertEqual(campaign["schema"], "kaminos.latest-envelope-basin-reconstruction.v0")
        self.assertEqual(campaign["seeds"], [80301, 80302, 80413])
        self.assertEqual(
            [family["id"] for family in campaign["promptFamilies"]],
            ["neutral", "skin", "short-fur", "armor", "shell", "mossy-stone"],
        )
        self.assertEqual(len(campaign["cells"]), 18)
        self.assertEqual(
            {(cell["family"], cell["seed"]) for cell in campaign["cells"]},
            {
                (family["id"], seed)
                for family in campaign["promptFamilies"]
                for seed in campaign["seeds"]
            },
        )

    def test_source_prompt_and_route_are_frozen(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        source = campaign["source"]
        source_plate = ROOT / source["plate"]
        self.assertEqual(source["blendSha256"], "0df08915c9319ec37bf0de02bd6bd59b028bcb77d7870ca91a2663afe40e8360")
        self.assertEqual(source["plateSha256"], sha256(source_plate))
        self.assertGreater(source_plate.stat().st_size, 1024)
        for family in campaign["promptFamilies"]:
            prompt_path = ROOT / family["promptFile"]
            self.assertEqual(prompt_path.read_text().strip(), family["prompt"])
            self.assertLessEqual(len(family["prompt"].split()), 10)
        for cell in campaign["cells"]:
            self.assertEqual(cell["source"], source["plate"])
            self.assertEqual(cell["jobType"], "mflux_flux2_edit_promptfile")
            self.assertEqual(cell["model"], "flux2-klein-9b")
            self.assertEqual(cell["quantize"], 4)
            self.assertEqual([cell["width"], cell["height"]], [512, 512])
            self.assertEqual(cell["steps"], 8)
            self.assertEqual(cell["guidance"], 1.0)
            self.assertEqual(cell["mlxCacheLimitGb"], 48)

        render_manifest = json.loads((ROOT / source["renderManifest"]).read_text())
        self.assertEqual(render_manifest["plate"]["path"], Path(source["plate"]).name)
        self.assertEqual(render_manifest["plate"]["sha256"], source["plateSha256"])
        self.assertEqual(render_manifest["plate"]["sha256"], sha256(source_plate))
        self.assertIn("exactReplay", render_manifest["provenance"])

    def test_trellis_policy_exercises_admitted_outputs_without_fur_prejudice(self) -> None:
        policy = json.loads(CAMPAIGN.read_text())["trellisPolicy"]
        self.assertEqual(policy["jobType"], "trellis2mlx_fast")
        self.assertEqual(policy["seedBinding"], "reuse-flux-seed")
        self.assertTrue(policy["advanceAllHappyStructurallyLegibleNonFur"])
        self.assertTrue(policy["advanceStructurallyLegibleFur"])
        self.assertEqual(policy["orbitAzimuths"], [0, 60, 120, 180, 240, 300])

        submit = load_module("submit_trellis", ROOT / "submit_trellis.py")
        self.assertEqual(
            submit.trellis_params(policy, 80301),
            ["seed=80301", "steps=6", "target_faces=200000", "texture_size=1024"],
        )

    def test_flux_results_are_complete_nonblank_and_route_identified(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        ledger = json.loads(FLUX_LEDGER.read_text())
        self.assertEqual(ledger["schema"], "kaminos.latest-envelope-basin-reconstruction.flux-ledger.v0")
        self.assertEqual(set(ledger["cells"]), {cell["id"] for cell in campaign["cells"]})
        for cell in campaign["cells"]:
            result = ledger["cells"][cell["id"]]
            self.assertEqual(result["status"], "done")
            self.assertEqual(result["jobType"], cell["jobType"])
            self.assertIn("mflux-generate-flux2-edit", result["effectiveRoute"])
            self.assertEqual(result["params"]["seed"], str(cell["seed"]))
            output = ROOT / result["output"]
            receipt = ROOT / result["receipt"]
            self.assertGreater(output.stat().st_size, 1024)
            self.assertTrue(receipt.is_file())

    def test_visual_disposition_promotes_the_full_matrix_with_explicit_controls(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        admission = json.loads(VISUAL_ADMISSION.read_text())
        self.assertEqual(admission["schema"], "kaminos.latest-envelope-basin-reconstruction.visual-admission.v0")
        self.assertTrue(admission["operatorSafety"]["campaignSafe"])
        self.assertEqual(set(admission["cells"]), {cell["id"] for cell in campaign["cells"]})
        self.assertTrue(all(cell["promotedToTrellis"] for cell in admission["cells"].values()))
        shell_cells = [cell for cell in admission["cells"].values() if cell["family"] == "shell"]
        self.assertEqual(len(shell_cells), 3)
        self.assertTrue(any(cell["trellisRole"] == "negative-control" for cell in shell_cells))
        fur_cells = [cell for cell in admission["cells"].values() if cell["family"] == "short-fur"]
        self.assertEqual(len(fur_cells), 3)
        self.assertTrue(all(cell["structureLegible"] for cell in fur_cells))

    def test_trellis_results_are_complete_nonblank_and_route_identified(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        policy = campaign["trellisPolicy"]
        admission = json.loads(VISUAL_ADMISSION.read_text())
        promoted = {cell_id for cell_id, cell in admission["cells"].items() if cell["promotedToTrellis"]}
        ledger = json.loads(TRELLIS_LEDGER.read_text())
        self.assertEqual(ledger["schema"], "kaminos.latest-envelope-basin-reconstruction.trellis-ledger.v0")
        self.assertEqual(set(ledger["cells"]), promoted)
        for cell_id, result in ledger["cells"].items():
            self.assertEqual(result["status"], "done")
            self.assertEqual(result["jobType"], "trellis2mlx_fast")
            self.assertIn("trellis2mlx", result["effectiveRoute"])
            self.assertIn(f'--steps {policy["steps"]}', result["effectiveRoute"])
            self.assertIn(f'--target-faces {policy["targetFaces"]}', result["effectiveRoute"])
            self.assertIn(f'--texture-size {policy["textureSize"]}', result["effectiveRoute"])
            glb = ROOT / result["output"]
            receipt = ROOT / result["receipt"]
            self.assertGreater(glb.stat().st_size, 4096, cell_id)
            self.assertTrue(receipt.is_file(), cell_id)

    def test_every_trellis_cast_has_a_complete_six_view_orbit(self) -> None:
        admission = json.loads(VISUAL_ADMISSION.read_text())
        promoted = {cell_id for cell_id, cell in admission["cells"].items() if cell["promotedToTrellis"]}
        for cell_id in promoted:
            manifest_path = ROOT / "trellis" / cell_id / "orbit-manifest.json"
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["status"], "completed", cell_id)
            self.assertEqual(len(manifest["outputs"]), 6, cell_id)
            for output in manifest["outputs"]:
                image = Path(output["path"])
                self.assertTrue(image.is_file(), cell_id)
                self.assertGreater(image.stat().st_size, 4096, cell_id)

    def test_every_trellis_cast_has_an_explicit_multi_axis_visual_disposition(self) -> None:
        admission = json.loads(VISUAL_ADMISSION.read_text())
        promoted = {cell_id for cell_id, cell in admission["cells"].items() if cell["promotedToTrellis"]}
        review = json.loads(TRELLIS_VISUAL_REVIEW.read_text())
        self.assertEqual(
            review["schema"],
            "kaminos.latest-envelope-basin-reconstruction.trellis-visual-review.v0",
        )
        self.assertEqual(set(review["cells"]), promoted)
        required = {
            "status",
            "macrostructure",
            "supportSeparation",
            "backsideCompletion",
            "surfaceGeometry",
            "textureQuality",
            "reuseDisposition",
            "note",
        }
        for cell_id, record in review["cells"].items():
            self.assertEqual(record["status"], "reviewed", cell_id)
            self.assertTrue(required.issubset(record), cell_id)
            self.assertTrue(all(str(record[field]).strip() for field in required), cell_id)

    def test_operator_sheet_is_nonblank_and_names_the_causal_surfaces(self) -> None:
        self.assertGreater(CAUSAL_SHEET.stat().st_size, 16_000)
        document = CAUSAL_SHEET.read_text()
        self.assertIn("Authored source", document)
        self.assertIn("FLUX output", document)
        self.assertIn("TRELLIS orbit", document)
        self.assertIn("guidance 1.0", document)
        self.assertIn("Interpretation:", document)
        campaign = json.loads(CAMPAIGN.read_text())
        for azimuth in campaign["trellisPolicy"]["orbitAzimuths"]:
            self.assertEqual(document.count(f"az{azimuth:03d}-el12.png"), 18)

    def test_failure_reports_preserve_phase_and_last_trustworthy_evidence(self) -> None:
        evidence = load_module("evidence_contract", ROOT / "evidence_contract.py")
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "failure.json"
            evidence.write_failure_report(
                report,
                schema="test.failure.v0",
                phase="primary-output-validation",
                statuses={"cell": {"status": "done", "effective_route": "route-a"}},
                failures={"cell": {"reason": "blank-output"}},
            )
            payload = json.loads(report.read_text())
            self.assertEqual(payload["failurePhase"], "primary-output-validation")
            self.assertEqual(payload["lastTrustworthyEvidence"]["cell"]["effective_route"], "route-a")
            self.assertEqual(payload["failures"]["cell"]["reason"], "blank-output")


if __name__ == "__main__":
    unittest.main()
