# kaminos-test: python
"""Output/authentication policy fixtures, not external rig or motion evidence."""
import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('trunk_build',Path(__file__).resolve().parents[1]/'trunk-multicast-build.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def fixture(root):
    def write(name,value):
        p=root/name;p.write_text(json.dumps(value));return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    control=write('control.json',{'sourceSha256':'fixture-only'})
    frame=write('frame.json',{'schema':'kaminos.full-given-rig-frame.v1','bones':[{'name':str(i)} for i in range(28)],'source':{'control':{'sha256':control['sha256']},'sourceSceneSha256':'fixture-only'}})
    state={'schema':'kaminos.trunk-multicast-inputs.v1','control':control,'rigFrame':frame,'poseTemplate':write('poses.json',{'presets':[]}), 'motion':write('motion.json',{}),'casts':[]}
    p=root/'inputs.json';p.write_text(json.dumps(state));return SimpleNamespace(inputs=str(p),out=str(root/'out'),report=str(root/'report.json')),control

class TrunkBuildContracts(unittest.TestCase):
    def test_empty_cohort_cannot_publish_completed_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            args,_=fixture(Path(directory))
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError,'empty'):module.build(args)
            report=json.loads(Path(args.report).read_text());self.assertEqual(report['status'],'failed')
            self.assertFalse((Path(args.out)/'catalog.json').exists())

    def test_catalog_alias_cannot_overwrite_retained_input(self):
        with tempfile.TemporaryDirectory() as directory:
            args,control=fixture(Path(directory));out=Path(args.out);out.mkdir();(out/'catalog.json').symlink_to(control['path'])
            original=Path(control['path']).read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError,'alias'):module.build(args)
            self.assertEqual(Path(control['path']).read_bytes(),original)

if __name__=='__main__':unittest.main()
