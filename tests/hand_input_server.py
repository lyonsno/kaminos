# kaminos-test: python
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ENTRY=Path(__file__).resolve().parents[1]/'hand_input.py'
class HandInputServerTests(unittest.TestCase):
    def test_configuration_and_paths(self):
        self.assertTrue(ENTRY.is_file(), 'shared hand input needs an explicit server route for existing packages and native WiLoR')
        spec=importlib.util.spec_from_file_location('hand_input_under_test',ENTRY)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);config=root/'hands.json'
            config.write_text('{"schema":"wrong"}')
            service=module.HandInputService(config)
            self.assertEqual(service.status()['status'],'invalid-configuration')
            package=root/'spiral';package.mkdir()
            (package/'package.json').write_text(json.dumps({'schema':'mobrecon.browser-weight-package.v0','models':[{'manifest':{'modelId':'mobrecon.densestack-spiralconv'}}]}))
            config.write_text(json.dumps({'schema':'kaminos.hand-input-installation.v1','packages':{'spiralconv':str(package)}}))
            service=module.HandInputService(config)
            self.assertIsNone(service.package_file('spiralconv','../hands.json'))
            self.assertEqual(service.package_file('spiralconv','package.json'),package/'package.json')
            self.assertIsNone(service.package_file('unknown','package.json'))
            with self.assertRaisesRegex(ValueError,'session'):
                service.retain({'sessionId':'../escape','captureId':'a'})
            with self.assertRaisesRegex(ValueError,'WiLoR'):
                service.open('a')
    def test_worker_failure_has_durable_report(self):
        if not ENTRY.is_file():self.skipTest('route absent')
        spec=importlib.util.spec_from_file_location('hand_input_under_test2',ENTRY)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            worker=module.NativeWorker({'python':'/absent/python'},root)
            with self.assertRaises(OSError):worker.open()
            report=json.loads((root/'report.json').read_text())
            self.assertEqual(report['phase'],'launch')
            self.assertEqual(report['status'],'failed')
            self.assertNotIn('identity',report)

if __name__=='__main__':unittest.main()
