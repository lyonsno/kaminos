# kaminos-test: python
"""Normal server import must resolve shared installed packages independently of cwd."""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent / 'helpers'))
from installed_model_fixture import flux3_package
ROOT = Path(__file__).resolve().parents[1]

class ModelFixture(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.package = flux3_package(self.home / 'installed' / 'flux3')
        self.config = self.home / '.config' / 'kaminos' / 'models.json'
        self.config.parent.mkdir(parents=True)
        self.config.write_text(json.dumps({'schema': 'kaminos.model-installations.v1', 'models': {'flux3': {'root': str(self.package)}}}))
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('KAMINOS_') and k not in ('XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'PYTHONPATH')}
        self.env.update(HOME=str(self.home), PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(ROOT))

    def runtime(self, cwd=None, extra=None):
        result = subprocess.run([sys.executable, '-c', 'import json,serve; print(json.dumps(serve.runtime_config()))'],
                                cwd=cwd or ROOT, env={**self.env, **(extra or {})}, check=True, capture_output=True, text=True)
        return json.loads(result.stdout)


class InstalledModelStartup(ModelFixture):
    def test_normal_startup_uses_shared_installation_without_model_environment(self):
        first = self.runtime()
        self.assertIsInstance(first.get('flux3'), dict, 'normal startup ignored the installed package and silently lost FLUX.3')
        self.assertTrue(first['flux3']['mounted'])
        self.assertEqual(first['flux3']['modelRoot'], str(self.package))
        other = self.home / 'other-caller'; other.mkdir()
        second = self.runtime(cwd=other)
        self.assertEqual(second['flux3']['modelRoot'], first['flux3']['modelRoot'])
        self.assertEqual(second['modelAvailability']['flux3']['source'], 'installation')

    def test_explicit_override_keeps_its_selected_identity(self):
        override = flux3_package(self.home / 'different-package')
        result = self.runtime(extra={'KAMINOS_FLUX3_WEIGHTS_ROOT': str(override)})
        self.assertEqual(result['flux3']['modelRoot'], str(override))
        self.assertTrue(result['flux3']['mounted'])

    def test_incomplete_explicit_override_is_diagnosed_without_hidden_fallback(self):
        override = self.home / 'missing-package'
        result = self.runtime(extra={'KAMINOS_FLUX3_WEIGHTS_ROOT': str(override)})
        self.assertFalse(result['flux3']['mounted'])
        report = result.get('modelAvailability', {}).get('flux3')
        self.assertIsInstance(report, dict, 'the caller needs a diagnosis of the selected package, not only mounted:false')
        self.assertEqual(report['source'], 'environment')
        self.assertEqual(report['root'], str(override))
        self.assertEqual(report['status'], 'unavailable')
        self.assertIn('manifest', report['reason'])

    def test_incompatible_installed_schema_is_named(self):
        path = self.package / 'dit' / 'manifest.json'
        value = json.loads(path.read_text()); value['schema'] = 'kaminos.flux2-klein.transformer-weights.v1'; path.write_text(json.dumps(value))
        result = self.runtime()
        report = result.get('modelAvailability', {}).get('flux3')
        self.assertIsInstance(report, dict, 'incompatible installed weights need an availability diagnosis')
        self.assertEqual(report['status'], 'unavailable')
        self.assertIn('kaminos.flux3-klein.transformer-weights.v1', report['reason'])
        self.assertIn(value['schema'], report['reason'])


class InstallationOperations(ModelFixture):
    def register(self, name, root, config=None):
        return subprocess.run([sys.executable, str(ROOT / 'model_installations.py'), 'register', name,
                               '--root', str(root), '--config', str(config or self.config)],
                              env=self.env, capture_output=True, text=True)

    def test_registration_preserves_other_entries_and_additive_fields(self):
        value=json.loads(self.config.read_text());value['future']='retained';value['models']['future-model']={'root':'do-not-touch'};value['models']['flux3']['note']='owner note';self.config.write_text(json.dumps(value))
        result=self.register('flux3',self.package);self.assertEqual(result.returncode,0,result.stderr)
        saved=json.loads(self.config.read_text());self.assertEqual(saved['future'],'retained');self.assertEqual(saved['models']['future-model'],value['models']['future-model']);self.assertEqual(saved['models']['flux3']['note'],'owner note')
        again=self.register('flux3',self.package);self.assertEqual(again.returncode,0,again.stderr);self.assertEqual(json.loads(self.config.read_text()),saved)

    def test_bad_registration_cannot_replace_the_existing_installation(self):
        before=self.config.read_bytes();result=self.register('flux3',self.home/'absent')
        self.assertNotEqual(result.returncode,0);self.assertIn('manifest',result.stderr);self.assertEqual(self.config.read_bytes(),before)

    def test_malformed_catalog_is_visible_and_does_not_hide_an_explicit_valid_override(self):
        self.config.write_text('{broken')
        result=self.runtime();self.assertEqual(result['modelAvailability']['flux3']['status'],'invalid-configuration');self.assertIsNone(result['flux3'])
        explicit=self.runtime(extra={'KAMINOS_FLUX3_WEIGHTS_ROOT':str(self.package)})
        self.assertTrue(explicit['flux3']['mounted']);self.assertEqual(explicit['modelAvailability']['flux3']['source'],'environment')

    def test_empty_override_explicitly_disables_the_installed_package(self):
        result=self.runtime(extra={'KAMINOS_FLUX3_WEIGHTS_ROOT':''});self.assertIsNone(result['flux3']);self.assertEqual(result['modelAvailability']['flux3']['status'],'disabled')

    def test_relative_installation_paths_belong_to_the_catalog_not_the_working_directory(self):
        value=json.loads(self.config.read_text());value['models']['flux3']['root']='../../installed/flux3';self.config.write_text(json.dumps(value))
        elsewhere=self.home/'elsewhere';elsewhere.mkdir();result=self.runtime(cwd=elsewhere)
        self.assertEqual(result['flux3']['modelRoot'],str(self.package));self.assertTrue(result['flux3']['mounted'])

    def test_invalid_selected_path_is_diagnosed_without_losing_server_startup(self):
        value=json.loads(self.config.read_text());value['models']['flux3']['root']='bad\x00path';self.config.write_text(json.dumps(value))
        result=self.runtime();self.assertEqual(result['modelAvailability']['flux3']['status'],'invalid-configuration');self.assertIsNone(result['flux3'])

    def test_registration_writers_preserve_each_others_models(self):
        checkpoint=self.home/'trellis';checkpoint.mkdir();(checkpoint/'manifest.json').write_text(json.dumps({'schema':'trellis2.generation-inputs.v0'}))
        self.config.write_text(json.dumps({'schema':'kaminos.model-installations.v1','models':{},'note':'keep'}))
        children=[subprocess.Popen([sys.executable,str(ROOT/'model_installations.py'),'register',name,'--root',str(root),'--config',str(self.config)],env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for name,root in [('flux3',self.package),('trellisPage',checkpoint)]]
        for child in children:
            out,error=child.communicate();self.assertEqual(child.returncode,0,error)
        saved=json.loads(self.config.read_text());self.assertEqual(saved['note'],'keep');self.assertEqual(set(saved['models']),{'flux3','trellisPage'})

if __name__ == '__main__':
    unittest.main()
