import importlib.util
import pathlib
import unittest
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRAINER = ROOT / 'scripts/train-optical-probes.py'


class TrainingContract(unittest.TestCase):
    def test_training_only_normalization_and_uncertainty(self):
        self.assertTrue(TRAINER.exists(), 'missing optical quantile trainer')
        spec = importlib.util.spec_from_file_location('optical_training', TRAINER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        def row(split, value, resolved=True):
            return dict(split=split, features=[value]*35, label=[value]*4, resolved=resolved)
        rows = [row('train', 1), row('train', 3), row('train', 100, False),
                row('validation', 1000), row('test', 2000), row('view-test', 3000)]
        data = module.prepare_arrays(rows, 3)
        np.testing.assert_array_equal(data['mean'], np.full(35, 2))
        np.testing.assert_array_equal(data['scale'], np.ones(35))
        np.testing.assert_array_equal(data['target_scale'], np.full(4, 2))
        self.assertEqual(data['indices']['train'].tolist(), [0, 1])
        self.assertEqual(len(data['x']), 6)
        rows[0]['label'][0] = -1
        with self.assertRaisesRegex(ValueError, 'nonnegative'):
            module.prepare_arrays(rows, 3)


if __name__ == '__main__':
    unittest.main()
