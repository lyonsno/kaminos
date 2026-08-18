import importlib.util
import unittest
from pathlib import Path


TOOL = Path(__file__).parents[1] / "tools" / "seal-procedural-groom-vlm-proposal.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_proposal_seal", TOOL)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def digest(character: str) -> str:
    return character * 64


class ProposalSealContractTest(unittest.TestCase):
    def setUp(self):
        self.observation = {
            "schema": "kaminos.procedural-groom-observation.v0",
            "observationId": "source-like-v0",
            "digest": digest("a"),
            "truthExposure": "withheld",
            "views": [{"id": "front"}, {"id": "left"}, {"id": "right"}],
        }
        self.inventory = {
            "systems": [
                {
                    "id": "short-coat",
                    "segmenter_phrase": "short fur on the cat torso",
                    "bounding_boxes": [
                        {"x_min": 0.1, "y_min": 0.2, "x_max": 0.8, "y_max": 0.9},
                        {"x_min": 0.1, "y_min": 0.2, "x_max": 0.8, "y_max": 0.9},
                        {"x_min": 0.1, "y_min": 0.2, "x_max": 0.8, "y_max": 0.9},
                    ],
                }
            ]
        }
        self.report = {
            "schema": "kaminos.procedural-groom-vlm-inventory-report.v0",
            "state": "raw_inventory_captured",
            "phase": "complete",
            "observationDigest": digest("a"),
            "promptSha256": digest("b"),
            "inventorySha256": digest("c"),
            "rawStdoutSha256": digest("d"),
            "rawStderrSha256": digest("e"),
            "requestedRoute": "mlx-vlm:model",
            "effectiveModel": "model",
            "effectiveBackend": "mlx-metal",
            "effectiveDevice": "Device(gpu, 0)",
            "lastTrustworthyEvidence": "parsed-raw-inventory",
        }

    def test_seals_only_digest_bound_truth_withheld_terminal_inventory(self):
        seal = MODULE.build_proposal_seal(
            observation=self.observation,
            inventory=self.inventory,
            report=self.report,
            observation_file_sha256=digest("f"),
            inventory_sha256=digest("c"),
            report_sha256=digest("0"),
        )
        self.assertTrue(seal["sealed"])
        self.assertEqual(seal["truthExposure"], "withheld")
        self.assertEqual(seal["inventorySystems"], ["short-coat"])
        self.assertFalse(seal["scientificAdmission"])

    def test_rejects_failed_or_stale_or_truth_exposed_inputs(self):
        for field, value, message in (
            ("truthExposure", "released", "truth-withheld"),
            ("digest", digest("9"), "observation identity"),
        ):
            observation = dict(self.observation)
            observation[field] = value
            with self.assertRaisesRegex(ValueError, message):
                MODULE.build_proposal_seal(
                    observation=observation,
                    inventory=self.inventory,
                    report=self.report,
                    observation_file_sha256=digest("f"),
                    inventory_sha256=digest("c"),
                    report_sha256=digest("0"),
                )

        report = dict(self.report, state="failed")
        with self.assertRaisesRegex(ValueError, "terminal parsed inventory"):
            MODULE.build_proposal_seal(
                observation=self.observation,
                inventory=self.inventory,
                report=report,
                observation_file_sha256=digest("f"),
                inventory_sha256=digest("c"),
                report_sha256=digest("0"),
            )

    def test_rejects_malformed_systems_before_truth_release(self):
        for inventory, message in (
            ({"systems": []}, "non-empty systems"),
            ({"systems": [{"id": "coat", "segmenter_phrase": "", "bounding_boxes": [{}, {}, {}]}]}, "segmenter phrase"),
            ({"systems": [{"id": "coat", "segmenter_phrase": "fur", "bounding_boxes": [{}]}]}, "box per view"),
        ):
            with self.assertRaisesRegex(ValueError, message):
                MODULE.build_proposal_seal(
                    observation=self.observation,
                    inventory=inventory,
                    report=self.report,
                    observation_file_sha256=digest("f"),
                    inventory_sha256=digest("c"),
                    report_sha256=digest("0"),
                )

    def test_rejects_percent_or_degenerate_boxes_before_sealing(self):
        for box, message in (
            ({"x_min": 20, "y_min": 20, "x_max": 60, "y_max": 40}, "normalized"),
            ({"x_min": 0.5, "y_min": 0.2, "x_max": 0.5, "y_max": 0.9}, "positive area"),
        ):
            inventory = {"systems": [dict(self.inventory["systems"][0], bounding_boxes=[box, box, box])]}
            with self.assertRaisesRegex(ValueError, message):
                MODULE.build_proposal_seal(
                    observation=self.observation,
                    inventory=inventory,
                    report=self.report,
                    observation_file_sha256=digest("f"),
                    inventory_sha256=digest("c"),
                    report_sha256=digest("0"),
                )

    def test_prompt_declared_array_boxes_are_preserved_raw_and_normalized_for_sam(self):
        raw = {
            "systems": [dict(
                self.inventory["systems"][0],
                bounding_boxes=[
                    [0.1, 0.2, 0.8, 0.9],
                    [0.15, 0.25, 0.75, 0.85],
                    [0.2, 0.3, 0.7, 0.8],
                ],
            )],
            "whiskers": {"left_whisker_probability": 0.8},
        }
        normalized, status = MODULE.normalize_inventory_boxes(raw, view_count=3)
        self.assertEqual(status, "prompt-array-boxes-normalized-to-named-fields")
        self.assertEqual(raw["systems"][0]["bounding_boxes"][0], [0.1, 0.2, 0.8, 0.9])
        self.assertEqual(normalized["systems"][0]["bounding_boxes"][0], {
            "x_min": 0.1,
            "y_min": 0.2,
            "x_max": 0.8,
            "y_max": 0.9,
        })
        self.assertEqual(normalized["whiskers"], raw["whiskers"])

        seal = MODULE.build_proposal_seal(
            observation=self.observation,
            inventory=raw,
            report=self.report,
            observation_file_sha256=digest("f"),
            inventory_sha256=digest("c"),
            report_sha256=digest("0"),
            normalized_inventory_sha256=digest("8"),
        )
        self.assertEqual(seal["inventorySha256"], digest("c"))
        self.assertEqual(seal["normalizedInventorySha256"], digest("8"))
        self.assertEqual(seal["normalizationStatus"], status)


if __name__ == "__main__":
    unittest.main()
