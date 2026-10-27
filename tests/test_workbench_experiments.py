# kaminos-test: python
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


class CatalogueTests(unittest.TestCase):
    def test_hand_reach_is_available_in_the_real_catalogue(self):
        spec = importlib.util.spec_from_file_location('discovery', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        rows = module.experiment_catalogue(MODULE.parent, ['/experiments/hand-reach.experiment.mjs'])
        self.assertNotIn('error', rows[0], 'the hand consumer must be admitted by actual Workbench discovery')
        self.assertEqual(rows[0]['id'], 'hand-reach')
        self.assertEqual(rows[0]['title'], 'Hand reach')

    def test_metadata_is_independent_of_broken_code_and_refreshes(self):
        spec = importlib.util.spec_from_file_location('discovery', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            owner = root / 'experiments'
            owner.mkdir()
            for name in ('healthy', 'broken', 'missing'):
                (owner / f'{name}.experiment.mjs').write_text('import "missing"; invalid javascript !!!')
            (owner / 'healthy.experiment.json').write_text('{"id":"healthy","title":"Healthy","future":true}')
            (owner / 'broken.experiment.json').write_text('{bad json')
            urls = module.discover_experiments(root, 'experiments')
            rows = module.experiment_catalogue(root, urls)
            self.assertEqual(rows[1], {'id':'healthy','title':'Healthy','moduleUrl':'/experiments/healthy.experiment.mjs'})
            self.assertIn('error', rows[0])
            self.assertIn('error', rows[2])
            (owner / 'broken.experiment.json').write_text('{"id":"fixed","title":"Fixed"}')
            self.assertEqual(module.experiment_catalogue(root, urls)[0]['id'], 'fixed')

    def test_metadata_escape_is_unavailable_and_does_not_read_external_data(self):
        spec = importlib.util.spec_from_file_location('discovery', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = pathlib.Path(directory)
            external = pathlib.Path(outside) / 'secret.json'
            external.write_text('{"id":"secret","title":"Secret"}')
            (root / 'a.experiment.json').symlink_to(external)
            rows = module.experiment_catalogue(root, ['/a.experiment.mjs'])
            self.assertIn('outside', rows[0]['error'])
            self.assertNotIn('id', rows[0])


if __name__ == '__main__':
    unittest.main()
