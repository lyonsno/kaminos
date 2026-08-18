import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


TOOL = Path(__file__).parents[1] / "tools" / "procedural-groom-estimation-assay.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_estimation_assay", TOOL)
MODULE = importlib.util.module_from_spec(SPEC)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(SPEC.loader is not None, "assay tool loader unavailable")
class ProceduralGroomEstimationAssayTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source_dir = self.root / "artifacts" / "presentation" / "subtle"
        source_dir.mkdir(parents=True)
        views = []
        for view_id in ["front", "left-three-quarter", "right-three-quarter"]:
            image = source_dir / f"source-like-{view_id}.png"
            image.write_bytes(f"image-{view_id}".encode())
            views.append({
                "id": view_id,
                "cameraPosition": [0, 0.6, 3],
                "cameraTarget": [0, 0, 0],
                "sourceLike": {
                    "path": image.name,
                    "sha256": digest(image),
                    "byteLength": image.stat().st_size,
                },
            })
        self.source = source_dir / "observation.json"
        self.source.write_text(json.dumps({
            "schema": "kaminos.procedural-groom-source-like-observation.v0",
            "fixtureId": "procedural-groom-truth-v0",
            "observationId": "procedural-groom-source-like-v0-density-12x",
            "views": views,
            "visualAdmission": False,
            "scientificAdmission": False,
        }))
        prompt = self.root / "artifacts" / "prompt.txt"
        prompt.write_text("Return JSON.")
        truth = self.root / "artifacts" / "truth"
        truth.mkdir()
        self.config = self.root / "artifacts" / "harness" / "assay-config.json"
        self.config.parent.mkdir()
        self.config.write_text(json.dumps({
            "schema": "kaminos.procedural-groom-estimation-assay-config.v0",
            "promptPath": "artifacts/prompt.txt",
            "truthRoot": "artifacts/truth",
            "vlm": {
                "jobType": "kaminos_procedural_groom_source_like_vlm",
                "model": "mlx-community/gemma-3-4b-it-qat-4bit",
                "backend": "mlx-metal",
            },
            "sam": {
                "jobType": "kaminos_procedural_groom_sam3",
                "model": "mlx-community/sam3-bf16",
                "backend": "mlx-metal",
                "threshold": 0.1,
            },
            "claimCeiling": "One fixture and one model arm only.",
            "arms": {
                "subtle": {
                    "sourceLikeObservation": "artifacts/presentation/subtle/observation.json",
                    "outputRoot": "artifacts/runs/subtle",
                    "expectedObservationId": "procedural-groom-source-like-v0-density-12x",
                    "controlledDifference": "baseline ruff length 0.34",
                },
            },
        }))

    def tearDown(self):
        self.temp.cleanup()

    def load_module(self):
        assert SPEC.loader is not None
        SPEC.loader.exec_module(MODULE)
        return MODULE

    def test_prepare_binds_source_config_and_portable_registered_command_templates(self):
        module = self.load_module()
        manifest = module.materialize_run(self.config, "subtle", self.root)
        output_root = self.root / "artifacts" / "runs" / "subtle"
        self.assertEqual(manifest["state"], "prepared_for_vlm_submission")
        self.assertEqual(manifest["sourceLikeObservationSha256"], digest(self.source))
        self.assertEqual(manifest["observationId"], "procedural-groom-source-like-v0-density-12x")
        self.assertEqual(manifest["claimCeiling"], "One fixture and one model arm only.")
        self.assertEqual(manifest["requestedVlm"]["model"], "mlx-community/gemma-3-4b-it-qat-4bit")
        self.assertEqual(manifest["requestedSam"]["threshold"], 0.1)
        templates = manifest["commandTemplates"]
        self.assertEqual(templates["vlmSubmit"][-1], "{repoRoot}")
        self.assertIn("{repoRoot}/artifacts/runs/subtle/observation.json", templates["vlmSubmit"])
        self.assertIn("{repoRoot}/artifacts/runs/subtle/vlm-raw", templates["vlmSubmit"])
        self.assertIn(
            "inventory={repoRoot}/artifacts/runs/subtle/vlm-raw/normalized-inventory.json",
            templates["samSubmit"],
        )
        self.assertNotIn(str(self.root.resolve()), json.dumps(manifest))
        self.assertEqual(json.loads((output_root / "run-manifest.json").read_text()), manifest)
        projected = json.loads((output_root / "observation.json").read_text())
        self.assertEqual(projected["sourceObservationId"], manifest["observationId"])

    def test_prepare_rejects_model_specific_run_without_claim_ceiling(self):
        module = self.load_module()
        config = json.loads(self.config.read_text())
        config["claimCeiling"] = ""
        self.config.write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError, "claim ceiling"):
            module.materialize_run(self.config, "subtle", self.root)

    def test_next_action_fails_loud_on_terminal_vlm_failure(self):
        module = self.load_module()
        module.materialize_run(self.config, "subtle", self.root)
        output_root = self.root / "artifacts" / "runs" / "subtle"
        vlm = output_root / "vlm-raw"
        vlm.mkdir()
        (vlm / "report.json").write_text(json.dumps({
            "state": "failed",
            "phase": "model-generation",
            "error": "backend died",
        }))
        state = module.next_action(self.config, "subtle", self.root)
        self.assertEqual(state["state"], "vlm_failed")
        self.assertEqual(state["nextAction"], None)
        self.assertEqual(state["failurePhase"], "model-generation")


if __name__ == "__main__":
    unittest.main()
