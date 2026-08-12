import inspect
import sys
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from rendered_observation_volume import (  # noqa: E402
    BACKEND,
    ROUTE,
    SCHEMA,
    VIEW_IDS,
    build_recovery_bundle,
    recover_volume_candidates,
    render_orthographic_views,
    score_volume_candidates,
)


def cube_surface():
    positions = np.array(
        [
            [-1.0, -1.0, -1.0],
            [1.0, -1.0, -1.0],
            [1.0, 1.0, -1.0],
            [-1.0, 1.0, -1.0],
            [-1.0, -1.0, 1.0],
            [1.0, -1.0, 1.0],
            [1.0, 1.0, 1.0],
            [-1.0, 1.0, 1.0],
        ],
        dtype=np.float64,
    )
    triangles = np.array(
        [
            [0, 2, 1], [0, 3, 2],
            [4, 5, 6], [4, 6, 7],
            [0, 1, 5], [0, 5, 4],
            [1, 2, 6], [1, 6, 5],
            [2, 3, 7], [2, 7, 6],
            [3, 0, 4], [3, 4, 7],
        ],
        dtype=np.int64,
    )
    return positions, triangles


class RenderedObservationVolumeTest(unittest.TestCase):
    def test_route_identity_and_recovery_signature_exclude_truth_inputs(self):
        self.assertEqual(SCHEMA, "kaminos.rendered-observation-hidden-carrier-volume.v0")
        self.assertEqual(ROUTE, "cpu-numpy-rendered-observation-volume-v0")
        self.assertEqual(BACKEND, "python-numpy-cpu")
        self.assertEqual(list(inspect.signature(recover_volume_candidates).parameters), ["bundle"])

    def test_render_is_invariant_to_source_vertex_permutation(self):
        positions, triangles = cube_surface()
        first = render_orthographic_views(positions, triangles, raster_size=32)
        permutation = np.array([6, 0, 4, 2, 7, 1, 5, 3])
        inverse = np.empty_like(permutation)
        inverse[permutation] = np.arange(len(permutation))
        second = render_orthographic_views(
            positions[permutation], inverse[triangles], raster_size=32, bounds=first["bounds"]
        )
        self.assertEqual(tuple(first["views"]), VIEW_IDS)
        for view_id in VIEW_IDS:
            np.testing.assert_array_equal(first["views"][view_id]["mask"], second["views"][view_id]["mask"])
            np.testing.assert_allclose(first["views"][view_id]["depth"], second["views"][view_id]["depth"])

    def test_bundle_rejects_oracle_bearing_and_unknown_fields(self):
        positions, triangles = cube_surface()
        rendered = render_orthographic_views(positions, triangles, raster_size=16)
        rendered["sourceNormals"] = np.ones_like(positions)
        with self.assertRaisesRegex(ValueError, "forbidden|unknown"):
            build_recovery_bundle(
                rendered,
                grid_size=17,
                uniform_depth=0.2,
                spatial_prior={"baseDepth": 0.2, "amplitude": 0.1},
            )

    def test_cube_visual_hull_and_erosion_are_nonblank_and_ordered(self):
        positions, triangles = cube_surface()
        rendered = render_orthographic_views(positions, triangles, raster_size=40)
        bundle = build_recovery_bundle(
            rendered,
            grid_size=31,
            uniform_depth=0.20,
            spatial_prior={
                "baseDepth": 0.20,
                "amplitude": 0.20,
                "dorsalStart": 0.40,
                "apCenter": 0.65,
                "apWidth": 0.24,
            },
        )
        recovery = recover_volume_candidates(bundle)
        outer = recovery["outerOccupancy"]
        uniform = recovery["uniformOccupancy"]
        spatial = recovery["spatialOccupancy"]
        self.assertEqual(outer.shape, (31, 31, 31))
        self.assertGreater(np.count_nonzero(outer), np.count_nonzero(uniform))
        self.assertGreater(np.count_nonzero(uniform), 0)
        self.assertGreaterEqual(np.count_nonzero(uniform), np.count_nonzero(spatial))
        self.assertGreater(np.count_nonzero(spatial), 0)
        self.assertFalse(any(key.lower().startswith("source") for key in recovery))

    def test_scoring_opens_truth_after_recovery_and_classifies_a_candidate(self):
        positions, triangles = cube_surface()
        rendered = render_orthographic_views(positions, triangles, raster_size=32)
        bundle = build_recovery_bundle(
            rendered,
            grid_size=25,
            uniform_depth=0.15,
            spatial_prior={"baseDepth": 0.15, "amplitude": 0.0},
        )
        recovery = recover_volume_candidates(bundle)
        score = score_volume_candidates(
            recovery,
            rendered,
            support_spec={
                "id": "bounded-dorsal-ap-procedural-support-v0",
                "dorsalStart": 0.45,
                "apMin": 0.45,
                "apMax": 0.85,
            },
        )
        self.assertEqual(score["truthAccessPhase"], "post-recovery-scoring-only")
        self.assertIn(score["classification"], {"ADVANCE_SPATIAL_PRIOR", "UNIFORM_CONTROL_HOLDS"})
        for arm in ("uniform", "spatial"):
            self.assertGreaterEqual(score["arms"][arm]["occupancyIou"], 0.0)
            self.assertLessEqual(score["arms"][arm]["occupancyIou"], 1.0)
            self.assertIn("sourceNormalizedBoundaryError", score["arms"][arm])


if __name__ == "__main__":
    unittest.main()
