#!/usr/bin/env python3

import copy
import unittest

import run_assay


class AssayContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = run_assay.load_json(run_assay.PLAN_PATH)
        cls.cells = run_assay.build_cells(cls.plan)

    def test_plan_expands_every_declared_seed(self):
        expected = sum(len(source["reconstruction_seeds"]) for source in self.plan["sources"])
        self.assertEqual(expected, 7)
        self.assertEqual(len(self.cells), expected)

    def test_source_hash_drift_fails_loud(self):
        drifted = copy.deepcopy(self.plan)
        drifted["sources"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(run_assay.AssayError, "Source hash drift"):
            run_assay.build_cells(drifted)

    def test_effective_seed_fallback_fails_loud(self):
        cell = self.cells[0]
        route = (
            f"python generate.py --image {cell['source_path']} "
            f"--output {cell['output_dir']}/output.glb --seed 42 --resolution 512 "
            "--steps 8 --no-cascade --target-faces 100000 --texture-size 512 "
            f"--simplify-first --save-checkpoints {cell['output_dir']}/checkpoints"
        )
        with self.assertRaisesRegex(run_assay.AssayError, "effective --seed mismatch"):
            run_assay.validate_effective_route(cell, {"effective_route": route}, self.plan)

    def test_missing_no_cascade_flag_fails_loud(self):
        cell = self.cells[0]
        route = (
            f"python generate.py --image {cell['source_path']} "
            f"--output {cell['output_dir']}/output.glb --seed {cell['seed']} --resolution 512 "
            "--steps 8 --target-faces 100000 --texture-size 512 "
            f"--simplify-first --save-checkpoints {cell['output_dir']}/checkpoints"
        )
        with self.assertRaisesRegex(run_assay.AssayError, "omitted --no-cascade"):
            run_assay.validate_effective_route(cell, {"effective_route": route}, self.plan)


if __name__ == "__main__":
    unittest.main()
