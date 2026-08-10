import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class CampaignScreenTest(unittest.TestCase):
    def test_joined_screen_exists_and_carries_every_flux_cell(self):
        screen = ROOT / "campaign-screen.html"
        self.assertTrue(screen.is_file(), "joined campaign screen is missing")
        html = screen.read_text()
        flux = json.loads((ROOT / "flux-results.json").read_text())
        for cell in flux["cells"]:
            self.assertIn(cell["outputPath"], html)
            self.assertIn(cell["prompt"], html)
            self.assertIn(f"seed {cell['seed']}", html)

    def test_promoted_rows_carry_trellis_and_registration_evidence(self):
        html = (ROOT / "campaign-screen.html").read_text()
        trellis = json.loads((ROOT / "trellis-results.json").read_text())
        registration = json.loads((ROOT / "registration-results.json").read_text())
        for cast in trellis["casts"]:
            name = f"{cast['promptId']}-seed{cast['seed']}"
            registered = next(item for item in registration["casts"] if item["name"] == name)
            orbit = json.loads((ROOT / cast["orbitManifestPath"]).read_text())
            self.assertIn(cast["glbSha256"], html)
            for view in orbit["outputs"]:
                self.assertIn(view["path"], html)
            for view in registered["views"]:
                self.assertIn(view, html)
            self.assertIn("global similarity only", html.lower())

    def test_screen_exposes_effective_routes_and_claim_ceiling(self):
        html = (ROOT / "campaign-screen.html").read_text()
        self.assertIn("mflux_flux2_edit_promptfile", html)
        self.assertIn("trellis2mlx_fast", html)
        self.assertIn("does not show a general registration improvement", html)

    def test_screen_exposes_historical_registration_comparison(self):
        html = (ROOT / "campaign-screen.html").read_text()
        historical = json.loads((ROOT / "historical-registration-results.json").read_text())
        self.assertIn("Historical comparison", html)
        self.assertIn("0.93% median", html)
        self.assertIn("3.23% p90", html)
        self.assertIn("cannot isolate source revision causally", html.lower())
        for view in historical["views"]:
            self.assertIn(view, html)


if __name__ == "__main__":
    unittest.main()
