# kaminos-test: python
"""Local transform/admission policy checks; no native-backend evidence."""
import importlib.util
import json
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('regional_state_data', Path(__file__).parents[1] / 'regional_state_data.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RegionalStateData(unittest.TestCase):
    def test_trainer_reports_failure_before_loading_a_dataset(self):
        with tempfile.TemporaryDirectory(prefix='regional-training-failure-') as out:
            run = subprocess.run([sys.executable, 'scripts/train-regional-state.py', '--out', out],
                                 cwd=Path(__file__).parents[1], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            report = json.loads((Path(out) / 'report.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['failurePhase'], 'inputs')
            self.assertNotIn('arms', report)

    def test_storage_preserves_constants_and_charges_metadata(self):
        x = np.array([[2, 2, 2], [-3, .2, 9]], dtype=np.float32)
        for bits in (4, 8, 16):
            actual, cost = m.quantize_vectors(x, bits)
            np.testing.assert_array_equal(actual[0], x[0])
            self.assertEqual(cost['payloadBytes'], 2 * ((3 * bits + 7) // 8))
            self.assertEqual(cost['metadataBytes'], 0 if bits == 16 else 16)
            if bits != 16:
                self.assertLessEqual(abs(actual[1, 1] - x[1, 1]), 12 / ((1 << bits) - 1) / 2 + 1e-6)

    def test_moments_preserve_directional_linear_structure(self):
        side = 3
        z, y, x = np.meshgrid(*([np.linspace(-1, 1, side)] * 3), indexing='ij')
        field = np.zeros((1, side, side, side, 7), dtype=np.float32)
        field[0, ..., 1] = 2 + 3*x + 5*y + 7*z
        summary = m.explicit_moments(field.reshape(1, -1), side).reshape(1, 4, 7)
        np.testing.assert_allclose(summary[0, :, 1], [2, 3, 5, 7], atol=1e-6)

    def test_targets_keep_signed_color_and_opaque_transmission(self):
        target = np.array([[2, -.3, 0, .1, .2, .3, 0]], dtype=np.float32)
        tau = np.array([1000.0])
        scale = m.channel_scale(target[:, :6])
        decoded = m.decode_targets(m.target_features(target, tau, scale), scale)
        np.testing.assert_allclose(decoded[:, :6], target[:, :6], rtol=2e-6, atol=1e-7)
        self.assertEqual(decoded[0, 6], 0)

    def test_region_split_never_leaks_region(self):
        split = m.region_split(12, 1108)
        self.assertFalse(set(split['train']) & set(split['heldOut']))
        self.assertEqual(sorted(split['train'] + split['heldOut']), list(range(12)))
        self.assertEqual(m.region_split(12, 1108), split)

    def test_bad_values_fail_instead_of_clipping(self):
        with self.assertRaisesRegex(ValueError, 'nonfinite'):
            m.quantize_vectors([[np.inf]], 4)
        with self.assertRaisesRegex(ValueError, 'FP16'):
            m.quantize_vectors([[1e20]], 16)
        with self.assertRaisesRegex(ValueError, 'nonnegative'):
            m.decode_targets(np.array([[0, 0, 0, 0, 0, 0, -1]]), np.ones(6))


class NativeAdmissionPolicy(unittest.TestCase):
    """Synthetic fixture tests admission policy, never native conformance."""
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory(prefix='regional-admission-fixture-')
        script = r"""
import fs from 'node:fs';import {createHash} from 'node:crypto';
import {regionalQueryPlan,regionalDataset} from './volume-regional-state.mjs';
const out=process.argv[1],plan=regionalQueryPlan({bounds:{lo:[-1,-1,-1],hi:[1,2,1]},tiles:[3,1,1],contextSide:3,queriesPerRegion:4,subdivisions:8,seed:42});
const rows=new Float32Array(plan.pointCount*32);
for(let i=0;i<plan.pointCount;i++){const p=plan.points[i].position,b=i*32;rows.set([i,0,1,1],b);rows.set(p,b+8);rows.set([1+.1*p[0],2+p[1],-.1,.3,.1,.2,.3],b+16);}
const d=regionalDataset(plan,rows),artifacts={};
const write=(n,b)=>{fs.writeFileSync(out+'/'+n,b);artifacts[n]={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
write('plan.json',Buffer.from(JSON.stringify(plan)));write('native-points-0.f32',Buffer.from(rows.buffer));
for(const n of ['context','query','target','coarse','onePoint','sparse','opticalDepth','regionIndex'])write(n+'.bin',Buffer.from(d[n].buffer));
const capture={identity:'native-fine-regional-optical-query-v0',scope:'fine-domain',kind:'points',worldTraversalIncluded:false,worldCollarIncluded:true,materialPreparation:{effective:true},coefficientSource:'native-material-before-trace-support-mask'};
const report={status:'observed',phase:'complete',scope:'synthetic-admission-policy-fixture-only',source:{commit:'f'.repeat(40),dirty:false,authority:'synthetic-policy-fixture'},hold:{effectiveSimStepCount:151},dataset:{identity:d.identity,shape:d.shape,reference:d.reference,observation:d.observation},artifacts,chunks:[{label:'native-points',offset:0,count:plan.pointCount,ok:true,identity:capture.identity,path:'native-points-0.f32',effective:{route:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU:apple',simStepCount:151,controls:{test:true},uniforms:[0,1],regionalCapture:capture}}]};
fs.writeFileSync(out+'/report.json',JSON.stringify(report));
"""
        subprocess.run(['node', '--input-type=module', '-e', script, cls.fixture.name],
                       cwd=Path(__file__).parents[1], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='regional-admission-case-')
        shutil.copytree(self.fixture.name, self.temp.name, dirs_exist_ok=True)
        self.root = Path(self.temp.name)
        self.report = json.loads((self.root / 'report.json').read_text())

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        (self.root / 'report.json').write_text(json.dumps(self.report))

    def test_complete_policy_fixture_is_read_without_dropping_rows(self):
        data = m.load_native_dataset(self.root, 'f'*40)
        self.assertEqual(len(data['query']), 12)
        self.assertEqual(data['sparse'].shape, (12, 7))
        self.assertEqual(data['report']['scope'], 'synthetic-admission-policy-fixture-only')

    def test_fallback_route_cannot_be_laundered_by_observed_status(self):
        self.report['chunks'][0]['effective']['route'] = 'fallback'
        self.save()
        with self.assertRaisesRegex(ValueError, 'route'):
            m.load_native_dataset(self.root, 'f'*40)

    def test_missing_points_fail_even_when_summary_shapes_look_complete(self):
        self.report['chunks'] = []
        self.save()
        with self.assertRaisesRegex(ValueError, 'missing native'):
            m.load_native_dataset(self.root, 'f'*40)

    def test_changed_payload_hash_fails(self):
        p = self.root / 'context.bin'
        p.write_bytes(p.read_bytes()[:-4])
        with self.assertRaisesRegex(ValueError, 'partial or changed'):
            m.load_native_dataset(self.root, 'f'*40)

    def test_validly_hashed_wrong_sparse_sample_fails(self):
        p = self.root / 'sparse.bin'
        values = np.fromfile(p, dtype='<f4')
        values[1] += 1
        values.tofile(p)
        raw = p.read_bytes()
        self.report['artifacts']['sparse.bin'] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        self.save()
        with self.assertRaisesRegex(ValueError, 'actual native midpoint'):
            m.load_native_dataset(self.root, 'f'*40)

    def test_wrong_source_fails_before_learning(self):
        with self.assertRaisesRegex(ValueError, 'source identity'):
            m.load_native_dataset(self.root, '0'*40)


if __name__ == '__main__':
    unittest.main()
