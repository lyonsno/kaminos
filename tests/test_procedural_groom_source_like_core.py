import hashlib
import importlib.util
import copy
import json
import shutil
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
PREPARER_PATH = Path(__file__).parents[1] / "tools" / "prepare-procedural-groom-source-like-vlm-observation.py"
PREPARER_SPEC = importlib.util.spec_from_file_location("procedural_groom_source_like_vlm_preparer", PREPARER_PATH)
PREPARER = importlib.util.module_from_spec(PREPARER_SPEC)
assert PREPARER_SPEC.loader is not None
PREPARER_SPEC.loader.exec_module(PREPARER)
PAIR_BUILDER_PATH = Path(__file__).parents[1] / "tools" / "build-procedural-groom-threshold-review.py"
PAIR_BUILDER_SPEC = importlib.util.spec_from_file_location("procedural_groom_threshold_review", PAIR_BUILDER_PATH)
PAIR_BUILDER = importlib.util.module_from_spec(PAIR_BUILDER_SPEC)


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
                "baselineCoatFiberCurveCount": 2000,
                "coatFiberCurveCount": 24000,
                "requestedDensityMultiplier": 12,
                "effectiveDensityMultiplier": 12,
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

    def test_declared_density_pressure_must_match_effective_coat_sampling(self):
        approximation = self.candidate["targetDistributionApproximation"]
        approximation["effectiveDensityMultiplier"] = 10
        approximation["coatFiberCurveCount"] = 20000
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_presentation_pair")
        self.assertRegex("\n".join(report["failures"]), "density multiplier")

        approximation["effectiveDensityMultiplier"] = 12
        approximation["coatFiberCurveCount"] = 23000
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_presentation_pair")
        self.assertRegex("\n".join(report["failures"]), "coat fiber count")

    def test_declared_ruff_length_pressure_must_change_only_ruff_by_the_requested_factor(self):
        approximation = self.candidate["targetDistributionApproximation"]
        approximation.update({
            "baselineFiberLengths": {"short": 0.065, "puffy": 0.19, "ruff": 0.34},
            "effectiveFiberLengths": {"short": 0.065, "puffy": 0.19, "ruff": 0.85},
            "requestedRuffLengthMultiplier": 2.5,
            "effectiveRuffLengthMultiplier": 2.5,
        })
        self.assertEqual(self.evaluate()["state"], "presentation_pair_bound_for_visual_inspection")

        approximation["effectiveFiberLengths"]["puffy"] = 0.21
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_presentation_pair")
        self.assertRegex("\n".join(report["failures"]), "only ruff")

        approximation["effectiveFiberLengths"]["puffy"] = 0.19
        approximation["effectiveFiberLengths"]["ruff"] = 0.84
        report = self.evaluate()
        self.assertEqual(report["state"], "invalid_presentation_pair")
        self.assertRegex("\n".join(report["failures"]), "ruff length")

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
        self.assertIn("Density pressure", page)
        self.assertIn("12×", page)
        self.assertNotIn(str(self.root), page)

    def test_vlm_projection_preserves_the_exact_dense_observation_identity(self):
        self.candidate["observationId"] = "procedural-groom-source-like-v0-density-12x"
        source_path = self.observation_dir / "dense-observation.json"
        source_path.write_text(json.dumps(self.candidate))
        output_path = self.observation_dir / "vlm-observation.json"
        projected = PREPARER.project_source_like_observation(source_path, output_path)
        self.assertEqual(projected["observationId"], self.candidate["observationId"])
        self.assertEqual(projected["sourceObservationId"], self.candidate["observationId"])
        self.assertEqual(projected["sourceWitness"]["sha256"], digest(source_path))

    def test_vlm_projection_supports_an_independent_sibling_run_directory(self):
        source_path = self.observation_dir / "dense-observation.json"
        source_path.write_text(json.dumps(self.candidate))
        output_path = self.root / "artifacts" / "estimation-runs" / "subtle-arm" / "observation.json"

        projected = PREPARER.project_source_like_observation(source_path, output_path)

        witness_path = (output_path.parent / projected["sourceWitness"]["path"]).resolve()
        self.assertEqual(witness_path, source_path.resolve())
        for source_view, projected_view in zip(self.candidate["views"], projected["views"]):
            expected = (source_path.parent / source_view["sourceLike"]["path"]).resolve()
            actual = (output_path.parent / projected_view["path"]).resolve()
            self.assertEqual(actual, expected)

    def test_threshold_review_collects_matched_subtle_and_constitutive_ruff_views(self):
        assert PAIR_BUILDER_SPEC.loader is not None
        PAIR_BUILDER_SPEC.loader.exec_module(PAIR_BUILDER)
        baseline = copy.deepcopy(self.candidate)
        baseline["observationId"] = "subtle-density12x"
        baseline["targetDistributionApproximation"].update({
            "baselineFiberLengths": {"short": 0.065, "puffy": 0.19, "ruff": 0.34},
            "effectiveFiberLengths": {"short": 0.065, "puffy": 0.19, "ruff": 0.34},
            "requestedRuffLengthMultiplier": 1.0,
            "effectiveRuffLengthMultiplier": 1.0,
        })
        baseline_path = self.observation_dir / "baseline.json"
        baseline_path.write_text(json.dumps(baseline))

        successor_dir = self.root / "artifacts" / "constitutive"
        successor_dir.mkdir()
        successor = copy.deepcopy(baseline)
        successor["observationId"] = "constitutive-ruff2p5x"
        successor["targetDistributionApproximation"]["effectiveFiberLengths"]["ruff"] = 0.85
        successor["targetDistributionApproximation"]["requestedRuffLengthMultiplier"] = 2.5
        successor["targetDistributionApproximation"]["effectiveRuffLengthMultiplier"] = 2.5
        for view in successor["views"]:
            for arm in ("diagnostic", "sourceLike"):
                original = self.observation_dir / view[arm]["path"]
                target = successor_dir / view[arm]["path"]
                shutil.copyfile(original, target)
                if arm == "sourceLike":
                    target.write_bytes(target.read_bytes() + b"-constitutive")
                view[arm]["sha256"] = digest(target)
                view[arm]["byteLength"] = target.stat().st_size
        successor_path = successor_dir / "observation.json"
        successor_path.write_text(json.dumps(successor))
        output_path = self.root / "artifacts" / "threshold-review.html"

        report = PAIR_BUILDER.build(baseline_path, successor_path, self.root, output_path)

        self.assertEqual(report["state"], "threshold_pair_bound_for_visual_inspection")
        page = output_path.read_text()
        self.assertIn("Subtle ruff", page)
        self.assertIn("Constitutive ruff", page)
        self.assertIn("2.5×", page)
        self.assertEqual(page.count("source-like-"), 6)
        self.assertNotIn(str(self.root), page)

    def test_threshold_review_binds_estimator_routes_and_overlay_bytes(self):
        assert PAIR_BUILDER_SPEC.loader is not None
        PAIR_BUILDER_SPEC.loader.exec_module(PAIR_BUILDER)
        run_root = self.root / "artifacts" / "runs" / "subtle"
        vlm_root = run_root / "vlm-raw"
        sam_root = run_root / "sam3-raw"
        overlay = sam_root / "overlays" / "front" / "main_fur.png"
        mask = sam_root / "masks" / "front" / "main_fur.png"
        overlay.parent.mkdir(parents=True)
        mask.parent.mkdir(parents=True)
        overlay.write_bytes(b"overlay")
        mask.write_bytes(b"mask")
        (run_root / "run-manifest.json").write_text(json.dumps({
            "schema": "kaminos.procedural-groom-estimation-assay-run.v0",
            "armId": "subtle",
            "requestedVlm": {"model": "gemma", "backend": "mlx-metal"},
            "requestedSam": {"model": "sam3", "backend": "mlx-metal", "threshold": 0.1},
        }))
        (vlm_root / "inventory.json").parent.mkdir(parents=True)
        (vlm_root / "inventory.json").write_text(json.dumps({"systems": [{"id": "main_fur"}]}))
        (vlm_root / "report.json").write_text(json.dumps({
            "state": "raw_inventory_captured",
            "phase": "complete",
            "requestedModel": "gemma",
            "effectiveModel": "gemma",
            "requestedBackend": "mlx-metal",
            "effectiveBackend": "mlx-metal",
        }))
        (sam_root / "report.json").write_text(json.dumps({
            "state": "segmentation_captured",
            "phase": "complete",
            "requestedModel": "sam3",
            "effectiveModel": "sam3",
            "requestedBackend": "mlx-metal",
            "effectiveBackend": "mlx-metal",
            "threshold": 0.1,
            "masks": [{
                "viewId": "front",
                "proposalSystemId": "main_fur",
                "state": "mask_captured",
                "positivePixels": 42,
                "mask": {"path": "masks/front/main_fur.png", "sha256": digest(mask), "byteLength": mask.stat().st_size},
                "overlay": {"path": "overlays/front/main_fur.png", "sha256": digest(overlay), "byteLength": overlay.stat().st_size},
            }],
        }))
        (run_root / "comparison.json").write_text(json.dumps({
            "schema": "kaminos.procedural-groom-mask-comparison.v0",
            "rows": [{
                "viewId": "front",
                "proposalSystemId": "main_fur",
                "bestTruthMatch": "puffy-coat",
                "bestMetrics": {"iou": 0.1, "precision": 0.2, "recall": 0.3},
            }],
        }))

        loaded = PAIR_BUILDER.load_estimator_run(run_root)
        self.assertEqual(loaded["armId"], "subtle")
        self.assertEqual(loaded["rows"][0]["bestTruthMatch"], "puffy-coat")

        overlay.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "overlay.*digest|overlay.*byte length"):
            PAIR_BUILDER.load_estimator_run(run_root)


if __name__ == "__main__":
    unittest.main()
