import importlib.util
import pathlib
import unittest
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRAINER = ROOT / 'scripts/train-optical-probes.py'


class TrainingContract(unittest.TestCase):
    def test_source_conditioning_preserves_labels_and_blind_spots(self):
        spec = importlib.util.spec_from_file_location('optical_training', TRAINER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for n in [3, 5]:
            features = np.arange(9*n+8, dtype=np.float32) + 1
            source = [9*j+k for j in range(n) for k in range(1, 7)]
            features[source[0]] = -100
            rows = [dict(split=s, features=features.tolist(), label=[2, 4, 6, .25], resolved=True)
                    for s in ['train', 'validation', 'test', 'view-test']]
            hidden = dict(split='train', features=np.ones(9*n+8).tolist(), label=[1, 2, 3, .5], resolved=True)
            for k in source:
                hidden['features'][k] = 0
            rows.append(hidden)
            data = module.prepare_arrays(rows, n, conditioning='source-max-abs-v1')
            np.testing.assert_array_equal(data['source_scale'], [100, 100, 100, 100, 1])
            np.testing.assert_array_equal(data['x'][0, source], features[source]/100)
            other = [k for k in range(len(features)) if k not in source]
            np.testing.assert_array_equal(data['x'][0, other], features[other])
            np.testing.assert_array_equal(data['y'], np.array([r['label'] for r in rows], dtype=np.float32))
            np.testing.assert_allclose(data['training_y'][0], [.02, .04, .06, .25])
            np.testing.assert_array_equal(data['training_y'][-1], hidden['label'])
            self.assertEqual(data['indices']['train'].tolist(), [0, 4])
            for factor in [.125, 8]:
                scaled = [dict(r, features=list(r['features']), label=list(r['label'])) for r in rows[:4]]
                for r in scaled:
                    for k in source:
                        r['features'][k] *= factor
                    r['label'][:3] = [v*factor for v in r['label'][:3]]
                derived = module.prepare_arrays(scaled, n, conditioning='source-max-abs-v1')
                np.testing.assert_array_equal(derived['x'], data['x'][:4])
                np.testing.assert_array_equal(derived['training_y'], data['training_y'][:4])
            with self.assertRaisesRegex(ValueError, 'conditioning'):
                module.prepare_arrays(rows, n, conditioning='unknown')

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
