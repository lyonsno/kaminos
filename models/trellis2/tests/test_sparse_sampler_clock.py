import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('prefix_export', Path(__file__).parents[1] / 'export-sparse-prefix.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SparseSamplerClock(unittest.TestCase):
    def test_sampler_capture_is_not_model_clock(self):
        self.assertTrue(callable(getattr(module, 'model_timestep_from_sampler_capture', None)),
                        'Missing FlowEuler capture-to-model time conversion; t=1 must become model time1000.')
        for time, expected in [(1.0, 1000.0), (0.5, 500.0), (0.0, 0.0)]:
            result = module.model_timestep_from_sampler_capture(np.array(time, dtype=np.float32))
            self.assertEqual(result.shape, (1,))
            self.assertEqual(result.dtype, np.float32)
            self.assertEqual(result[0], expected)
        for bad in [np.array(float('nan')), np.array([1.0, 0.5])]:
            with self.assertRaises(ValueError):
                module.model_timestep_from_sampler_capture(bad)


if __name__ == '__main__':
    unittest.main()
