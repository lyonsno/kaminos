import importlib.util
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).parents[1] / "tools" / "selected_splat_view_bake.py"
SPEC = importlib.util.spec_from_file_location("selected_splat_view_bake", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SelectedSplatViewBakeMathTests(unittest.TestCase):
    def test_renderer_depth_coverage_rejects_hidden_center_at_same_pixel(self):
        uv = np.array([[4.0, 3.0], [4.0, 3.0]], dtype=np.float32)
        ndc_depth = np.array([0.25, 0.75], dtype=np.float32)
        visible = np.array([True, True])
        depth_frame = np.zeros((8, 8), dtype=np.float32)
        depth_frame[3, 4] = 0.25

        coverage = MODULE.renderer_depth_coverage(
            uv,
            ndc_depth,
            visible,
            depth_frame,
            ndc_tolerance=0.01,
        )

        np.testing.assert_array_equal(coverage, [1.0, 0.0])

    def test_renderer_depth_coverage_rejects_background_and_nonfinite_depth(self):
        uv = np.array([[1.0, 1.0], [2.0, 2.0]], dtype=np.float32)
        ndc_depth = np.array([0.0, np.nan], dtype=np.float32)
        visible = np.array([True, True])
        depth_frame = np.zeros((4, 4), dtype=np.float32)

        coverage = MODULE.renderer_depth_coverage(
            uv,
            ndc_depth,
            visible,
            depth_frame,
        )

        np.testing.assert_array_equal(coverage, [0.0, 0.0])

    def test_lotus_camera_normals_negate_z_before_asset_transform(self):
        asset_to_camera = np.array([
            [0.0, 0.0, 2.0, 0.0],
            [0.0, 2.0, 0.0, 0.0],
            [-2.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ], dtype=np.float32)
        lotus_normals = np.array([
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
        ], dtype=np.float32)

        asset_normals = MODULE.lotus_camera_normals_to_asset(
            lotus_normals,
            asset_to_camera,
        )

        np.testing.assert_allclose(asset_normals[0], [1.0, 0.0, 0.0], atol=1e-6)
        np.testing.assert_allclose(asset_normals[1], [0.0, 0.0, 1.0], atol=1e-6)

    def test_projection_maps_positive_camera_y_to_top_rows(self):
        positions = np.array([
            [0.0, 0.5, -2.0],
            [0.0, -0.5, -2.0],
        ], dtype=np.float32)
        view = np.eye(4, dtype=np.float32)
        projection = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, -0.2],
            [0.0, 0.0, -1.0, 0.0],
        ], dtype=np.float32)

        uv, visible = MODULE.project_positions(
            positions,
            view,
            projection,
            width=100,
            height=100,
        )

        self.assertTrue(visible.all())
        self.assertLess(uv[0, 1], uv[1, 1])
        self.assertAlmostEqual(float(uv[0, 1]), 37.5, places=4)
        self.assertAlmostEqual(float(uv[1, 1]), 62.5, places=4)

    def test_layer_composition_accumulates_views_and_honors_strength(self):
        base = {
            "normals": np.array([[0.0, 0.0, 1.0], [0.0, 0.0, 1.0]], dtype=np.float32),
            "roughness": np.array([0.5, 0.5], dtype=np.float32),
            "metallic": np.array([0.0, 0.0], dtype=np.float32),
        }
        layer_a = {
            "normals": np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32),
            "roughness": np.array([0.1, 0.5], dtype=np.float32),
            "metallic": np.array([0.8, 0.0], dtype=np.float32),
            "coverage": np.array([1.0, 0.0], dtype=np.float32),
            "strength": 0.5,
        }
        layer_b = {
            "normals": np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0]], dtype=np.float32),
            "roughness": np.array([0.5, 0.9], dtype=np.float32),
            "metallic": np.array([0.0, 0.2], dtype=np.float32),
            "coverage": np.array([0.0, 1.0], dtype=np.float32),
            "strength": 1.0,
        }

        composed = MODULE.compose_material_layers(base, [layer_a, layer_b])

        np.testing.assert_allclose(composed["roughness"], [0.3, 0.9], atol=1e-6)
        np.testing.assert_allclose(composed["metallic"], [0.4, 0.2], atol=1e-6)
        np.testing.assert_allclose(
            composed["normals"],
            [[2 ** -0.5, 0.0, 2 ** -0.5], [0.0, 1.0, 0.0]],
            atol=1e-6,
        )

    def test_disabled_layer_has_no_effect(self):
        base = {
            "normals": np.array([[0.0, 0.0, 1.0]], dtype=np.float32),
            "roughness": np.array([0.5], dtype=np.float32),
            "metallic": np.array([0.0], dtype=np.float32),
        }
        disabled = {
            "normals": np.array([[1.0, 0.0, 0.0]], dtype=np.float32),
            "roughness": np.array([0.1], dtype=np.float32),
            "metallic": np.array([1.0], dtype=np.float32),
            "coverage": np.array([1.0], dtype=np.float32),
            "strength": 1.0,
            "enabled": False,
        }

        composed = MODULE.compose_material_layers(base, [disabled])

        np.testing.assert_allclose(composed["normals"], base["normals"])
        np.testing.assert_allclose(composed["roughness"], base["roughness"])
        np.testing.assert_allclose(composed["metallic"], base["metallic"])


if __name__ == "__main__":
    unittest.main()
