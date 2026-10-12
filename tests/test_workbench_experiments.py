import importlib.util
import pathlib
import tempfile
import unittest

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'workbench_experiments.py'


class DiscoveryTests(unittest.TestCase):
    def discover(self, root, **kwargs):
        self.assertTrue(MODULE.is_file(), 'Owner file discovery is unavailable on the baseline')
        spec = importlib.util.spec_from_file_location('discovery', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.discover_experiments(root, **kwargs)

    def test_fresh_recursive_discovery_and_followup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            owner = root / 'workbench-experiments' / 'paper'
            owner.mkdir(parents=True)
            (owner / 'river.experiment.mjs').write_text('export default {}')
            (owner / 'helper.mjs').write_text('export default {}')
            self.assertEqual(self.discover(root), ['/workbench-experiments/paper/river.experiment.mjs'])
            (owner / 'finite box.experiment.mjs').write_text('export default {}')
            self.assertEqual(self.discover(root), [
                '/workbench-experiments/paper/finite%20box.experiment.mjs',
                '/workbench-experiments/paper/river.experiment.mjs'])

    def test_explicit_root_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as other:
            root = pathlib.Path(directory)
            self.assertEqual(self.discover(root), [])
            with self.assertRaisesRegex(ValueError, 'within'):
                self.discover(root, directory=other)
            target = pathlib.Path(other) / 'outside.experiment.mjs'
            target.write_text('export default {}')
            (root / 'workbench-experiments').mkdir()
            (root / 'workbench-experiments' / target.name).symlink_to(target)
            with self.assertRaisesRegex(ValueError, 'outside'):
                self.discover(root)


if __name__ == '__main__':
    unittest.main()
