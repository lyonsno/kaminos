import importlib.util
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "boundary-splat-phase-transport-mlx.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_phase_transport_mlx", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def frame(rows):
    positions = np.asarray([row[0] for row in rows], dtype=np.float32)
    candidates = np.asarray([
        [row[1] + channel * 0.01 for channel in range(16)]
        for row in rows
    ], dtype=np.float32)
    splats = np.zeros((len(rows), 12), dtype=np.float32)
    splats[:, :3] = positions
    splats[:, 3:6] = (1.0, 0.5, 0.2)
    splats[:, 6:9] = (0.05, 0.8, 0.03)
    splats[:, 9:] = (0.03, 0.0, 1.0)
    return MODULE.index_frame(candidates, splats)


class TransportDatasetContracts(unittest.TestCase):
    def test_directional_input_preserves_exact_candidate_contract(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((1.0, 0.0, 0.0), 2.0),
        ])
        vector = MODULE.make_directional_input((0.0, 0.0, 0.0), source, 1.0)
        self.assertEqual(vector.shape, (64,))
        self.assertEqual(MODULE.INPUT_AUTHORITY, "exact-16-feature-plus-directional-local-grid-occupancy-v0")
        np.testing.assert_allclose(vector[5:21], source["candidates"][source["index"][(0.0, 0.0, 0.0)]])
        self.assertEqual(int(np.sum(vector[21:48])), 2)

    def test_carrier_and_residual_birth_labels_are_distinct(self):
        source = frame([
            ((0.0, 0.0, 0.0), 1.0),
            ((0.0, 1.0, 0.0), 2.0),
            ((4.0, 4.0, 4.0), 3.0),
        ])
        target = frame([
            ((1.0, 0.0, 0.0), 1.01),
            ((0.0, 1.0, 0.0), 2.01),
            ((8.0, 8.0, 8.0), 9.0),
        ])
        dataset = MODULE.build_pair_dataset(source, target, grid_step=1.0, radius_cells=1)
        self.assertEqual(dataset["correspondence"]["stableCount"], 1)
        self.assertEqual(dataset["correspondence"]["transportedCount"], 1)
        self.assertEqual(dataset["correspondence"]["birthCount"], 1)
        self.assertEqual(dataset["correspondence"]["deathCount"], 1)
        self.assertEqual(dataset["carrierInputs"].shape, (3, 64))
        self.assertIn(MODULE.DEATH_CLASS, dataset["carrierLabels"])
        self.assertGreater(int(np.sum(dataset["birthLabels"])), 0)
        self.assertGreater(int(np.sum(dataset["birthLabels"] == 0)), 0)

    def test_displacement_class_round_trips(self):
        for class_index, delta in enumerate(MODULE.DISPLACEMENTS):
            self.assertEqual(MODULE.displacement_class(delta), class_index)
            self.assertEqual(MODULE.DISPLACEMENTS[class_index], delta)
        self.assertEqual(MODULE.DEATH_CLASS, len(MODULE.DISPLACEMENTS))

    def test_target_count_calibration_ranks_births_without_collisions(self):
        ratio = MODULE.calibrate_target_support_ratio([
            {"sourceCount": 100, "targetCount": 102},
            {"sourceCount": 120, "targetCount": 119},
            {"sourceCount": 80, "targetCount": 80},
        ])
        self.assertEqual(ratio["authority"], "training-adjacent-target-source-count-ratio-median-v0")
        self.assertEqual(ratio["medianRatio"], 1.0)
        selected = MODULE.select_ranked_births(
            [(2.0, 0.0, 0.0), (1.0, 0.0, 0.0), (3.0, 0.0, 0.0)],
            np.asarray([0.2, 0.9, 0.8], dtype=np.float32),
            claimed_keys={(3.0, 0.0, 0.0)},
            target_support_budget=4,
            claimed_count=2,
        )
        self.assertEqual(selected, [((1.0, 0.0, 0.0), float(np.float32(0.9))), ((2.0, 0.0, 0.0), float(np.float32(0.2)))])


if __name__ == "__main__":
    unittest.main()
