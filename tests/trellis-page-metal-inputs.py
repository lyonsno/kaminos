# kaminos-test: python
"""CPU conformance: production page codec -> retained Metal input admission."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'models/trellis2/finish-retained-metal.py'
RAW = np.array([-1, 0, 1, 2, -2, .5], dtype=np.float32)

class PageMetalInputs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.source = self.root/'source'; self.source.mkdir()
        subprocess.run(['git','init','-q',str(self.source)],check=True)
        subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-q','--allow-empty','-m','CPU source admission fixture'],cwd=self.source,check=True)
        self.revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=self.source,text=True).strip()
        self.input = self.root/'page.glb'
        # The production encoder supplies the wire format; Python does not invent its layout.
        subprocess.run(['node','--input-type=module','-e',"""
import fs from 'node:fs';import {encodeTrellisReconstruction} from './trellis-reconstruction.mjs';
const raw={decode:{vertices:new Float32Array([0,0,0,.25,0,0,0,.25,0]),triangles:new Uint32Array([0,1,2])},
 materialFields:{features:new Float32Array([-1,0,1,2,-2,.5]),coordinates:new Int32Array([4,4,4]),resolution:8}};
fs.writeFileSync(process.argv[1],new Uint8Array(encodeTrellisReconstruction(raw,{provenance:{runId:'page-fixture',route:'cooperative-page-fixture'}})));
""",str(self.input)],cwd=ROOT,check=True)
    def invoke(self, name='out', expected=None, input_file=None, revision=None, stage_only=True):
        file=input_file or self.input; self.out=self.root/name
        return subprocess.run([sys.executable,str(SCRIPT),'--source-root',str(self.source),'--expected-source-commit',revision or self.revision,
            '--reconstruction-glb',str(file),'--expected-reconstruction-sha256',expected or hashlib.sha256(file.read_bytes()).hexdigest(),
            '--backend-manifest',str(self.root/'not-opened-backend.json'),'--output-dir',str(self.out),'--grid-size','8',
            '--target-faces','20','--texture-size','4','--band','1','--project-back','0']+(['--stage-inputs-only'] if stage_only else []),capture_output=True,text=True)
    def report(self): return json.loads((self.out/'report.json').read_text())
    def test_canonical_page_glb_stages_complete_raw_mesh_and_all_material_channels_without_gpu(self):
        run=self.invoke();self.assertEqual(run.returncode,0,run.stderr)
        r=self.report();self.assertEqual(r['status'],'inputs-staged');self.assertEqual(r['phase'],'retained-inputs-staged')
        self.assertEqual(r['modelCalls'],0);self.assertNotIn('finishing',r);self.assertFalse((self.out/'finishing').exists())
        self.assertEqual(r['reconstructionProvenance']['runId'],'page-fixture')
        with np.load(self.out/'checkpoints/mesh_raw.npz') as mesh:
            np.testing.assert_array_equal(mesh['vertices'],[[0,0,0],[.25,0,0],[0,.25,0]])
            np.testing.assert_array_equal(mesh['faces'],[[0,1,2]])
        with np.load(self.out/'checkpoints/texture.npz') as material:
            np.testing.assert_array_equal(material['tex_np'],(RAW*np.float32(.5)+np.float32(.5)).reshape(1,6))
            np.testing.assert_array_equal(material['tex_coords_spatial'],[[4,4,4]])
            self.assertEqual(material['mesh_grid_size'].item(),8)
    def test_full_cli_passes_page_checkpoints_and_requested_controls_to_exporter(self):
        # The real source ignores Python import caches; keep this clean fixture equivalent.
        (self.source/'.gitignore').write_text('__pycache__/\n')
        scripts=self.source/'scripts';scripts.mkdir()
        (scripts/'source_metal_remesh_finishing.py').write_text("""import json
from pathlib import Path
def run(args):
    args.output_dir.mkdir()
    received={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()}
    (args.output_dir/'received.json').write_text(json.dumps(received))
    return {'status':'complete','syntheticExporter':True}
""")
        subprocess.run(['git','add','.'],cwd=self.source,check=True)
        subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-q','-m','Explicit exporter stand-in'],cwd=self.source,check=True)
        self.revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=self.source,text=True).strip()
        run=self.invoke(stage_only=False);self.assertEqual(run.returncode,0,run.stderr+json.dumps(self.report()))
        r=self.report();self.assertEqual(r['status'],'complete');self.assertTrue(r['finishing']['syntheticExporter'])
        received=json.loads((self.out/'finishing/received.json').read_text())
        for key,value in {'grid_size':8,'target_faces':20,'texture_size':4,'band':1,'project_back':0,
                          'expected_revision':self.revision,'checkpoints':str(self.out/'checkpoints')}.items():
            self.assertEqual(received[key],value)
        for key,file in [('mesh_sha256','mesh_raw.npz'),('texture_sha256','texture.npz')]:
            self.assertEqual(received[key],hashlib.sha256((self.out/'checkpoints'/file).read_bytes()).hexdigest())
    def test_changed_or_partial_input_fails_with_report_before_backend(self):
        for name,file,sha in [('wrong-hash',self.input,'0'*64),('partial',self.root/'partial.glb',None)]:
            if name=='partial':file.write_bytes(self.input.read_bytes()[:-4])
            run=self.invoke(name,expected=sha,input_file=file);self.assertNotEqual(run.returncode,0)
            r=self.report();self.assertEqual(r['status'],'failed');self.assertEqual(r['phase'],'retained-input-admission')
            self.assertNotIn('finishing',r);self.assertFalse((self.out/'checkpoints').exists())
    def test_valid_hash_does_not_admit_nonfinite_material_or_out_of_grid_coordinates(self):
        raw=self.input.read_bytes();jl=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jl]);fields=doc['extras']['trellisReconstruction']['materialFields']
        for key,value,fmt in [('features',float('nan'),'<f'),('coordinates',8,'<i')]:
            blob=bytearray(raw);view=doc['bufferViews'][fields[key]];struct.pack_into(fmt,blob,28+jl+view.get('byteOffset',0),value)
            file=self.root/(key+'.glb');file.write_bytes(blob);run=self.invoke(key,input_file=file);self.assertNotEqual(run.returncode,0)
            r=self.report();self.assertEqual(r['phase'],'retained-input-admission');self.assertNotIn('finishing',r)
    def test_invalid_display_accessor_cannot_be_admitted_as_the_raw_mesh(self):
        blob=self.input.read_bytes();jl=struct.unpack_from('<I',blob,12)[0]
        original=json.loads(blob[20:20+jl]);binary=blob[28+jl:]
        for name in ('negative-accessor', 'sparse-accessor'):
            doc=json.loads(json.dumps(original));primitive=doc['meshes'][0]['primitives'][0]
            if name=='negative-accessor':primitive['attributes']['POSITION']-=len(doc['accessors'])
            else:doc['accessors'][primitive['attributes']['POSITION']]['sparse']={'count':1}
            raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
            payload=struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
            file=self.root/(name+'.glb');file.write_bytes(struct.pack('<III',0x46546c67,2,12+len(payload))+payload)
            run=self.invoke(name,input_file=file)
            self.assertNotEqual(run.returncode,0,name+' must fail before staging a different displayed mesh')
            self.assertEqual(self.report()['phase'],'retained-input-admission')
            self.assertFalse((self.out/'checkpoints').exists())
    def test_changed_display_envelope_fails_before_staging(self):
        blob=self.input.read_bytes();jl=struct.unpack_from('<I',blob,12)[0]
        original=json.loads(blob[20:20+jl]);binary=blob[28+jl:]
        for name in ('points', 'translated', 'empty-scene'):
            with self.subTest(name=name):
                doc=json.loads(json.dumps(original))
                if name=='points':doc['meshes'][0]['primitives'][0]['mode']=0
                elif name=='translated':doc['nodes'][0]['matrix'][12]=25
                else:doc['scenes'][0]['nodes']=[]
                raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
                payload=struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
                file=self.root/(name+'.glb');file.write_bytes(struct.pack('<III',0x46546c67,2,12+len(payload))+payload)
                run=self.invoke(name,input_file=file)
                self.assertNotEqual(run.returncode,0,name+' must fail before staging a different displayed surface')
                self.assertEqual(self.report()['phase'],'retained-input-admission')
                self.assertFalse((self.out/'checkpoints').exists())
    def test_wrong_source_fails_before_retained_input_staging(self):
        run=self.invoke(revision='0'*40);self.assertNotEqual(run.returncode,0)
        r=self.report();self.assertEqual(r['phase'],'source-admission');self.assertFalse((self.out/'checkpoints').exists())

if __name__=='__main__':unittest.main()
