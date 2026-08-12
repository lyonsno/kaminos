import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SEEDS = {80301, 80302, 80413}
FAMILIES = {"dragon", "golem", "maquette", "cat"}
SOURCE_IDS = {
    "revision-050-matched",
    "revision-050-oblique-negative-35",
    "revision-050-oblique-positive-35",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CampaignContract(unittest.TestCase):
    def setUp(self) -> None:
        self.campaign = json.loads((ROOT / "campaign.json").read_text())

    def test_exact_twenty_cell_matrix(self) -> None:
        cells = self.campaign["cells"]
        self.assertEqual(len(cells), 20)
        self.assertEqual(len({cell["id"] for cell in cells}), 20)

        matched = [cell for cell in cells if cell["sourceId"] == "revision-050-matched"]
        self.assertEqual(len(matched), 12)
        self.assertEqual({cell["family"] for cell in matched}, FAMILIES)
        for family in FAMILIES:
            self.assertEqual(
                {cell["seed"] for cell in matched if cell["family"] == family},
                SEEDS,
            )

        oblique = [cell for cell in cells if cell["sourceId"] != "revision-050-matched"]
        self.assertEqual(len(oblique), 8)
        self.assertEqual({cell["sourceId"] for cell in oblique}, SOURCE_IDS - {"revision-050-matched"})
        self.assertEqual({cell["family"] for cell in oblique}, FAMILIES)
        self.assertEqual({cell["seed"] for cell in oblique}, {80301})

    def test_sources_bind_current_blend_and_render_evidence(self) -> None:
        sources = self.campaign["sources"]
        self.assertEqual(set(sources), SOURCE_IDS)
        expected_blend = Path(
            "/Users/noahlyons/dev/operator-scratch/blender-scenes/cat-bauplan-050.blend"
        )
        expected_blend_sha = "9f0409d99321ec4d74d237ba6cff1f425b402aeae653db43e699f53150b11fbe"
        self.assertEqual(sha256(expected_blend), expected_blend_sha)
        plate_hashes = set()
        for source in sources.values():
            self.assertEqual(source["effectiveBlend"], str(expected_blend))
            self.assertEqual(source["blendSha256"], expected_blend_sha)
            self.assertEqual(source["object"], "Cube.056")
            plate = ROOT / source["plate"]
            manifest = ROOT / source["renderManifest"]
            self.assertEqual(sha256(plate), source["plateSha256"])
            rendered = json.loads(manifest.read_text())
            self.assertEqual(rendered["source"]["sha256"], expected_blend_sha)
            self.assertEqual(rendered["source"]["object"], "Cube.056")
            self.assertEqual(rendered["plate"]["sha256"], source["plateSha256"])
            self.assertEqual(rendered["plate"]["dimensions"], [768, 768])
            plate_hashes.add(source["plateSha256"])
        self.assertEqual(len(plate_hashes), 3)

    def test_prompts_and_prior_controls_are_exact(self) -> None:
        families = {row["id"]: row for row in self.campaign["promptFamilies"]}
        self.assertEqual(set(families), FAMILIES)
        for family, row in families.items():
            prompt_file = ROOT / row["promptFile"]
            self.assertEqual(prompt_file.read_text().strip(), row["prompt"])
            self.assertEqual(sha256(prompt_file), row["promptFileSha256"])

        controls = self.campaign["comparisonControls"]
        self.assertEqual(len(controls), 12)
        self.assertEqual({row["family"] for row in controls}, FAMILIES)
        self.assertEqual({row["seed"] for row in controls}, SEEDS)
        prior_root = (ROOT / controls[0]["campaignRoot"]).resolve()
        prior_ledger = json.loads((prior_root / "result-ledger.json").read_text())
        for row in controls:
            self.assertEqual(row["sourceId"], "revision-048")
            self.assertIn(row["cellId"], prior_ledger["cells"])
            prior = prior_ledger["cells"][row["cellId"]]
            self.assertEqual(prior["family"], row["family"])
            self.assertEqual(prior["seed"], row["seed"])
            self.assertEqual(prior["outputSha256"], row["outputSha256"])

    def test_route_and_claim_ceiling_are_explicit(self) -> None:
        route = self.campaign["fluxRoute"]
        self.assertEqual(route["jobType"], "mflux_flux2_edit_promptfile")
        self.assertEqual(route["model"], "flux2-klein-9b")
        self.assertEqual(route["quantize"], 4)
        self.assertEqual((route["width"], route["height"]), (512, 512))
        self.assertEqual(route["steps"], 8)
        self.assertEqual(route["guidance"], 1.0)
        claim_ceiling = self.campaign["claimCeiling"].lower()
        self.assertIn("exact frozen plates", claim_ceiling)
        self.assertIn("no arbitrary-view", claim_ceiling)


if __name__ == "__main__":
    unittest.main()
