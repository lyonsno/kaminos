from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "tools" / "blender-cat-source-preview.py"


class BlenderCatSourcePreviewContracts(unittest.TestCase):
    def test_preview_exposes_explicit_palette_authority(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--palette", choices=("ecorche", "white-clay"), default="ecorche")', source)
        self.assertIn('"palette": args.palette', source)
        self.assertIn('if args.palette == "white-clay"', source)

    def test_palette_changes_material_only_not_admission(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn('shared_clay_material = _material("Diagnostic White Clay"', source)
        self.assertIn('_assign_material(obj, shared_clay_material)', source)
        self.assertIn('obj.hide_render = obj.name not in admitted_by_name', source)

    def test_views_declare_anatomical_axes_and_unambiguous_names(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn('ANATOMICAL_RIGHT = Vector((1.0, 0.0, 0.0))', source)
        self.assertIn('ANATOMICAL_ANTERIOR = Vector((0.0, -1.0, 0.0))', source)
        self.assertIn('ANATOMICAL_DORSAL = Vector((0.0, 0.0, -1.0))', source)
        self.assertIn('"right-anterior-three-quarter"', source)
        self.assertNotIn('"front-three-quarter"', source)
        self.assertIn('"anatomicalAxes":', source)
        self.assertIn('def _orient_camera(', source)
        self.assertIn('"imageUpAxis": list(image_up)', source)


if __name__ == "__main__":
    unittest.main()
