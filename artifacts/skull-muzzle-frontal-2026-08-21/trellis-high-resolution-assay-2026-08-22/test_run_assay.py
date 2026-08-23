#!/usr/bin/env python3

import copy
import unittest
from unittest import mock

import run_assay


class HighResolutionAssayContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = run_assay.load_json(run_assay.PLAN_PATH)
        cls.cells = run_assay.build_cells(cls.plan)

    def test_plan_expands_source_by_resolution(self):
        self.assertEqual(len(self.cells), 4)
        self.assertEqual(
            {(cell["quality_class"], cell["resolution"]) for cell in self.cells},
            {("strong", 768), ("strong", 1024), ("moderate", 768), ("moderate", 1024)},
        )

    def test_source_hash_drift_fails_loud(self):
        drifted = copy.deepcopy(self.plan)
        drifted["sources"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(run_assay.AssayError, "Source hash drift"):
            run_assay.build_cells(drifted)

    def test_effective_resolution_fallback_fails_loud(self):
        cell = next(cell for cell in self.cells if cell["resolution"] == 1024)
        route = self._effective_route(cell).replace("--resolution 1024", "--resolution 512")
        with self.assertRaisesRegex(run_assay.AssayError, "effective --resolution mismatch"):
            run_assay.validate_effective_route(cell, {"effective_route": route}, self.plan)

    def test_no_cascade_fallback_fails_loud(self):
        cell = self.cells[0]
        route = self._effective_route(cell) + " --no-cascade"
        with self.assertRaisesRegex(run_assay.AssayError, "unexpected --no-cascade"):
            run_assay.validate_effective_route(cell, {"effective_route": route}, self.plan)

    def test_texture_fallback_fails_loud(self):
        cell = self.cells[0]
        route = self._effective_route(cell).replace("--texture-size 4096", "--texture-size 512")
        with self.assertRaisesRegex(run_assay.AssayError, "effective --texture-size mismatch"):
            run_assay.validate_effective_route(cell, {"effective_route": route}, self.plan)

    def test_successful_entrypoint_does_not_write_failure(self):
        with mock.patch.object(run_assay, "main", return_value=0), mock.patch.object(
            run_assay, "write_failure"
        ) as write_failure:
            self.assertEqual(run_assay.entrypoint(), 0)
            write_failure.assert_not_called()

    def _effective_route(self, cell):
        return (
            f"python generate.py --image {cell['source_path']} "
            f"--output {cell['output_dir']}/output.glb --seed {cell['seed']} "
            f"--resolution {cell['resolution']} --steps 8 --target-faces 100000 "
            f"--texture-size 4096 --simplify-first --save-checkpoints {cell['output_dir']}/checkpoints"
        )


if __name__ == "__main__":
    unittest.main()
