from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "tools" / "blender-cat-provisional-envelope.py"


class BlenderCatProvisionalEnvelopeContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_compiler_binds_exact_source_and_classification(self) -> None:
        self.assertIn('parser.add_argument("--source", required=True)', self.source)
        self.assertIn('parser.add_argument("--classification", required=True)', self.source)
        self.assertIn('parser.add_argument("--expected-source-sha256", required=True)', self.source)
        self.assertIn('if source_sha256 != args.expected_source_sha256:', self.source)
        self.assertIn('if classification.get("source", {}).get("sha256") != source_sha256:', self.source)

    def test_envelope_uses_only_admitted_evaluated_mesh_geometry(self) -> None:
        self.assertIn('admitted_by_name = {record["name"]: record for record in admitted}', self.source)
        self.assertIn('evaluated = source_object.evaluated_get(depsgraph)', self.source)
        self.assertIn('surface_samples = _mesh_world_surface_samples(', self.source)
        self.assertIn('surface_cloud_closing(', self.source)
        self.assertNotIn('principal_axis_capsules(', self.source)
        self.assertIn('sourceObjectName', self.source)
        self.assertIn('envelopeElementCount', self.source)

    def test_surface_cloud_is_spatially_deduplicated_and_source_bound(self) -> None:
        self.assertIn('parser.add_argument("--surface-sample-fraction"', self.source)
        self.assertIn('parser.add_argument("--closing-radius-fraction"', self.source)
        self.assertIn('voxel_key = tuple(np.floor(point / sample_spacing).astype(np.int64))', self.source)
        self.assertIn('"surfaceSampleCount"', self.source)
        self.assertIn('"deduplicatedSurfaceSampleCount"', self.source)

    def test_route_preserves_source_camera_and_emits_effective_identities(self) -> None:
        self.assertIn('ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))', self.source)
        self.assertIn('source_corners = _view_corners(source_bounds)', self.source)
        self.assertIn('"right-sagittal"', self.source)
        self.assertIn('"compilerId": COMPILER_ID', self.source)
        self.assertIn('"effectiveRoute":', self.source)
        self.assertIn('"sha256": _sha256(envelope_path)', self.source)
        self.assertIn('"sha256": _sha256(neutral_path)', self.source)

    def test_compiler_writes_primary_artifacts_or_durable_failure(self) -> None:
        self.assertIn('bpy.ops.export_scene.gltf(', self.source)
        self.assertIn('bpy.ops.render.render(write_still=True)', self.source)
        self.assertIn('FAILURE_SCHEMA', self.source)
        self.assertIn('"failurePhase": "provisional-envelope-compile"', self.source)
        self.assertIn('"lastTrustworthyEvidence":', self.source)


if __name__ == "__main__":
    unittest.main()
