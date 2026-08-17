import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


CORE = Path(__file__).parents[1] / "tools" / "procedural-groom-source-like-core.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_source_like_core", CORE)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
BUILDER_PATH = Path(__file__).parents[1] / "tools" / "build-procedural-groom-presentation-review.py"
BUILDER_SPEC = importlib.util.spec_from_file_location("procedural_groom_presentation_review", BUILDER_PATH)
BUILDER = importlib.util.module_from_spec(BUILDER_SPEC)
assert BUILDER_SPEC.loader is not None
BUILDER_SPEC.loader.exec_module(BUILDER)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SourceLikeObservationContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.observation_dir = self.root / "artifacts" / "presentation"
        self.observation_dir.mkdir(parents=True)
        self.views = []
        poses = {
            "front": ([0, 0.6, 3], [0, 0, 0]),
            "left-three-quarter": ([-2.1, 0.6, 2.1], [0, 0, 0]),
            "right-three-quarter": ([2.1, 0.6, 2.1], [0, 0, 0]),
        }
        for index, (view_id, (position, target)) in enumerate(poses.items()):
            diagnostic = self.observation_dir / f"diagnostic-{view_id}.png"
            source_like = self.observation_dir / f"source-like-{view_id}.png"
            diagnostic.write_bytes(b"diagnostic" + bytes([index]))
            source_like.write_bytes(b"source-like" + bytes([index]))
            self.views.append({
                "id": view_id,
                "diagnostic": {
                    "path": diagnostic.name,
                    "sha256": digest(diagnostic),
                    "byteLength": diagnostic.stat().st_size,
                },
                "sourceLike": {
                    "path": source_like.name,
                    "sha256": digest(source_like),
                    "byteLength": source_like.stat().st_size,
                },
                "cameraPosition": position,
                "cameraTarget": target,
                "membershipColorsVisible": False,
                "labelsVisible": False,
                "gizmoVisible": False,
            })
        source_manifest = self.root / "truth-manifest.json"
        source_blend = self.root / "truth.blend"
        source_manifest.write_text(json.dumps({"schema": "kaminos.procedural-groom-truth.v0"}))
        source_blend.write_bytes(b"BLENDER-v300-source")
        self.candidate = {
            "schema": MODULE.OBSERVATION_SCHEMA,
            "fixtureId": "procedural-groom-truth-v0",
            "observationId": "procedural-groom-source-like-v0",
            "requestedRoute": "gpu-greenroom:kaminos_blender_cast_cleanup",
            "effectiveRoute": "gpu-greenroom:kaminos_blender_cast_cleanup",
            "presentationVariable": "diagnostic-viewer-vs-source-like-groom",
            "heldConstant": [
                "authored-carrier", "groom-system-membership", "guide-field",
                "camera-poses", "vlm-prompt", "vlm-model", "sam-model", "truth-scoring",
            ],
            "source": {
                "manifestPath": str(source_manifest.relative_to(self.root)),
                "manifestSha256": digest(source_manifest),
                "blendPath": str(source_blend.relative_to(self.root)),
                "blendSha256": digest(source_blend),
            },
            "targetDistributionApproximation": {
                "integratedFiberField": True,
                "naturalShading": True,
                "recognizableCarrierLandmarks": True,
                "membershipColorEncoding": False,
                "renderer": "BLENDER_EEVEE",
                "blenderVersion": "5.1.2",
                "fiberCurveCount": 2048,
            },
            "views": self.views,
            "claimCeiling": "Observation-domain friendliness under one authored fixture only.",
            "visualAdmission": False,
            "scientificAdmission": False,
        }

    def tearDown(self):
        self.temp.cleanup()

    def evaluate(self, candidate=None):
        return MODULE.evaluate_source_like_observation(
            candidate or self.candidate,
            observation_dir=self.observation_dir,
            repo_root=self.root,
        )

    def test_complete_bound_pair_reaches_visual_inspection_without_self_admission(self):
        report = self.evaluate()
        self.assertEqual(report["schema"], MODULE.REPORT_SCHEMA)
        self.assertEqual(report["state"], "presentation_pair_bound_for_visual_inspection")
        self.assertEqual(report["failures"], [])
        self.assertFalse(report["visualAdmission"])
        self.assertFalse(report["scientificAdmission"])

    def test_blank_or_digest_mismatched_image_fails_loud(self):
        path = self.observation_dir / self.views[0]["sourceLike"]["path"]
        path.write_bytes(b"")
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_bound_artifacts")
        self.assertRegex("\n".join(report["failures"]), "blank|byte length|sha256")

    def test_same_image_cannot_masquerade_as_a_presentation_pair(self):
        self.views[0]["sourceLike"] = dict(self.views[0]["diagnostic"])
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_presentation_pair")
        self.assertRegex("\n".join(report["failures"]), "same image")

    def test_membership_coloring_or_camera_drift_fails(self):
        self.views[1]["membershipColorsVisible"] = True
        self.views[2]["cameraPosition"] = [9, 9, 9]
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_presentation_pair")
        joined = "\n".join(report["failures"])
        self.assertRegex(joined, "membership")
        self.assertRegex(joined, "camera")

    def test_review_page_collects_every_pair_without_private_paths(self):
        observation_path = self.observation_dir / "observation.json"
        observation_path.write_text(json.dumps(self.candidate))
        output_path = self.observation_dir / "review.html"
        report = BUILDER.build(observation_path, self.root, output_path)
        self.assertEqual(report["state"], "presentation_pair_bound_for_visual_inspection")
        page = output_path.read_text()
        for view_id in ["front", "left-three-quarter", "right-three-quarter"]:
            self.assertIn(f"diagnostic-{view_id}.png", page)
            self.assertIn(f"source-like-{view_id}.png", page)
        self.assertIn("Same hair truth, friendlier eyes", page)
        self.assertIn("Only variable", page)
        self.assertNotIn(str(self.root), page)


if __name__ == "__main__":
    unittest.main()
