import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "blender-m31-m47-articulation-witness.py"


class BlenderWitnessContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_source_identity_and_read_only_route_are_explicit(self):
        self.assertIn("a6a4650f0114f7bb56ffcc6a336b6fd6f2db756e3a137857d92ff6571f9568e3", self.source)
        self.assertIn("bpy.ops.wm.open_mainfile", self.source)
        self.assertNotIn("bpy.ops.wm.save_as_mainfile", self.source)

    def test_failure_report_precedes_primary_outputs(self):
        self.assertIn('"failurePhase": "startup"', self.source)
        self.assertIn('"lastTrustworthyEvidence"', self.source)
        self.assertIn("failure.json", self.source)

    def test_failure_report_accumulates_effective_route_identity(self):
        for token in (
            '"witnessScript"',
            '"requestedRoute"',
            '"effectiveRoute"',
            '"sourceSha256"',
            '"sourceEffective"',
            '"effectiveHinge"',
            '"effectiveRenderEngine"',
        ):
            self.assertIn(token, self.source)
        self.assertIn("advance_failure_receipt", self.source)

    def test_selected_supports_and_routes_are_exact(self):
        for token in ("Cube.002", "Cube.003", "Muscle 31", "Muscle 47", "Muscle 35", "Muscle 38"):
            self.assertIn(token, self.source)

    def test_operator_page_opens_paused_with_manual_scrubbing(self):
        self.assertIn('playing = false', self.source)
        self.assertIn('type="range"', self.source)
        self.assertIn('id="playPause"', self.source)
        self.assertNotIn("autoplay", self.source.lower())

    def test_manifest_records_requested_and_effective_hinge(self):
        self.assertIn('"requestedHinge"', self.source)
        self.assertIn('"effectiveHinge"', self.source)
        self.assertIn('"frameMetrics"', self.source)

    def test_render_engine_is_negotiated_and_recorded(self):
        self.assertIn("select_render_engine", self.source)
        self.assertIn('"effectiveRenderEngine"', self.source)
        self.assertNotIn('scene.render.engine = "BLENDER_EEVEE_NEXT"', self.source)

    def test_visual_witness_uses_deterministic_material_color_and_effect_size(self):
        selector = self.source.index("def select_render_engine")
        workbench = self.source.index('"BLENDER_WORKBENCH"', selector)
        eevee = self.source.index('"BLENDER_EEVEE"', selector)
        self.assertLess(workbench, eevee)
        self.assertIn('color_type = "MATERIAL"', self.source)
        self.assertIn('"muscleMaxVertexDisplacement"', self.source)
        self.assertIn('"movingSupportMaxCornerDisplacement"', self.source)

    def test_png_hash_is_not_presented_as_visual_identity(self):
        self.assertIn('"pngFileSha256"', self.source)
        self.assertNotIn('"frameSha256"', self.source)

    def test_camera_fit_is_projection_aware(self):
        self.assertIn("fit_orthographic_camera", self.source)
        self.assertIn("math.hypot(width, height)", self.source)
        self.assertIn("bpy.context.view_layer.update()", self.source)
        self.assertIn("pose_envelope_points", self.source)
        self.assertIn("camera_view_direction = axis.normalized()", self.source)
        envelope_index = self.source.index("pose_envelope_points =")
        camera_fit_index = self.source.rindex("fit_orthographic_camera(")
        self.assertLess(envelope_index, camera_fit_index)
        self.assertIn("cameraFitEvidence", self.source)
        self.assertIn('"cameraFitMargin"', self.source)


if __name__ == "__main__":
    unittest.main()
