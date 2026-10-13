# kaminos-test: python
import importlib.util
import sys
import subprocess
import tempfile
import hashlib
import os
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('full_binding',Path(__file__).resolve().parents[1]/'full-creature-binding.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def bone(name,x,parent=None):
    matrix=np.eye(4);matrix[0,3]=x
    return {'name':name,'parent':parent,'restMatrix':matrix.tolist(),'tail':[x,.1,0]}

class FullTreeContracts(unittest.TestCase):
    def test_early_refusal_report_cannot_overwrite_referenced_geometry(self):
        import json
        for mode in ['authentication','output-protection']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);inputs=root/'inputs';inputs.mkdir();out=root/'out';out.mkdir()
                geometry=inputs/'geometry.npz';geometry.write_bytes(b'retained geometry bytes')
                control=inputs/'control.json';control.write_text(json.dumps({'geometry':{'path':str(geometry)}}))
                frame=inputs/'frame.json';frame.write_text('{}');baseline=inputs/'baseline';baseline.mkdir();(baseline/'manifest.json').write_text('{}')
                if mode=='output-protection':(out/'rest.bin').symlink_to(frame)
                r=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'full-creature-binding.py'),
                    '--control',str(control),'--rig-frame',str(frame),'--expected-rig-frame-sha256','0'*64,
                    '--baseline',str(baseline),'--expected-baseline-sha256','0'*64,'--out',str(out),'--report',str(geometry)],capture_output=True,text=True)
                self.assertNotEqual(r.returncode,0)
                self.assertEqual(geometry.read_bytes(),b'retained geometry bytes','early refusal report overwrote undiscovered geometry')

    def test_report_cannot_take_a_prospective_manifest_or_binary_path(self):
        for name in ['manifest.json','rest.bin','triangles.bin','automatic-weights.bin','automatic-presets.bin']:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);inputs=root/'inputs';inputs.mkdir();out=root/'out';out.mkdir()
                control=inputs/'control.json';control.write_text('{}');frame=inputs/'frame.json';frame.write_text('{}')
                baseline=inputs/'baseline';baseline.mkdir();(baseline/'manifest.json').write_text('{}')
                r=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'full-creature-binding.py'),
                    '--control',str(control),'--rig-frame',str(frame),'--expected-rig-frame-sha256','0'*64,
                    '--baseline',str(baseline),'--expected-baseline-sha256','0'*64,'--out',str(out),'--report',str(out/name)],capture_output=True,text=True)
                self.assertNotEqual(r.returncode,0)
                self.assertFalse((out/name).exists(),'refusal wrote a report over a prospective asset')

    def test_production_report_alias_rejection_preserves_retained_input(self):
        for kind in ['symlink','hardlink']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);source=root/'inputs';source.mkdir();out=root/'outputs';out.mkdir()
                frame=source/'rig.json';frame.write_text('{"retained":true}')
                control=source/'control.json';control.write_text('{}');baseline=source/'baseline';baseline.mkdir();(baseline/'manifest.json').write_text('{}')
                alias=out/'build-report.json'
                if kind=='symlink':alias.symlink_to(frame)
                else:os.link(frame,alias)
                before=hashlib.sha256(frame.read_bytes()).hexdigest()
                result=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'full-creature-binding.py'),
                    '--control',str(control),'--rig-frame',str(frame),'--expected-rig-frame-sha256','0'*64,
                    '--baseline',str(baseline),'--expected-baseline-sha256','0'*64,'--out',str(out)],capture_output=True,text=True)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(hashlib.sha256(frame.read_bytes()).hexdigest(),before,'authentication refusal overwrote linked retained input')

    def test_each_prospective_binary_manifest_and_report_rejects_aliases(self):
        for name in module.OUTPUT_NAMES:
            for kind in ['symlink','hardlink']:
                with self.subTest(name=name,kind=kind),tempfile.TemporaryDirectory() as folder:
                    root=Path(folder);source=root/'input';source.write_bytes(b'input preserved');out=root/'out';out.mkdir()
                    if kind=='symlink':(out/name).symlink_to(source)
                    else:os.link(source,out/name)
                    with self.assertRaisesRegex(ValueError,'alias'):module.protect_outputs(out,[source])
                    self.assertEqual(source.read_bytes(),b'input preserved')

    def test_control_bytes_and_cast_cannot_impersonate_given_source(self):
        control={'sourceSha256':'source','cast':'real'};frame={'source':{'control':{'sha256':'control'},'sourceSceneSha256':'source'}}
        baseline={'sourceSha256':'source','sourceCast':'real','candidatePaintedWeights':False}
        module.validate_source_frame(control,frame,baseline,'control')
        with self.assertRaisesRegex(ValueError,'digest'):module.validate_source_frame(control,frame,baseline,'changed')
        with self.assertRaisesRegex(ValueError,'cast source'):module.validate_source_frame({**control,'cast':'other'},frame,baseline,'control')
    def test_unpainted_head_receives_automatic_given_control(self):
        points=np.array([[0.,0,0],[1.,0,0],[2.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1
        result=module.extend_weights(points,np.array([[0,1],[1,2]]),prior,[bone('pelvis',0),bone('head',2,'pelvis')])
        weights=result['weights'];self.assertGreater(weights[2,2],.99)
        np.testing.assert_allclose(weights.sum(axis=1),1,atol=1e-12)
        self.assertEqual(result['channels'],['fixed','pelvis','head'])
    def test_rear_mobility_is_preserved_when_new_tree_adds_head(self):
        points=np.array([[0.,0,0],[1.,0,0],[2.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1;prior[0,0]=.4;prior[0,2]=.6
        names=module.JOINT_CHANNELS[1:]
        bones=[bone(name,0,None if name=='pelvis' else 'pelvis') for name in names]+[bone('head',2,'pelvis')]
        result=module.extend_weights(points,np.array([[0,1],[1,2]]),prior,bones)
        self.assertAlmostEqual(result['weights'][0,result['channels'].index('hindlimb-left-hip')],.6)
        self.assertTrue(np.all(result['weights']>=0))
    def test_unreached_material_is_named_and_carried_by_root(self):
        points=np.array([[0.,0,0],[1.,0,0],[3.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1
        result=module.extend_weights(points,np.array([[0,1]]),prior,[bone('pelvis',0),bone('head',1,'pelvis')])
        self.assertEqual(result['unknownVertices'],[2]);self.assertEqual(result['weights'][2,1],1)

    def test_one_ulp_partition_roundoff_does_not_create_negative_body_weights(self):
        points=np.array([[0.,0,0],[1.,0,0],[2.,0,0]])
        prior=np.zeros((3,8));prior[:,0]=1
        prior[0,2]=np.nextafter(1.,2.);prior[0,0]=1-prior[0,2]
        names=module.JOINT_CHANNELS[1:]
        bones=[bone(name,0,None if name=='pelvis' else 'pelvis') for name in names]+[bone('head',2,'pelvis')]
        result=module.extend_weights(points,np.array([[0,1],[1,2]]),prior,bones)
        self.assertTrue(np.all(result['weights']>=0));np.testing.assert_allclose(result['weights'].sum(axis=1),1,atol=1e-12)
        prior[0,0]=-.01;prior[0,2]=1.01
        with self.assertRaisesRegex(ValueError,'rear partition'):module.extend_weights(points,np.array([[0,1],[1,2]]),prior,bones)

if __name__=='__main__':unittest.main()
