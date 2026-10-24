# kaminos-test: python
"""Small geometric cases for the offline surface proposal; no model/GPU work."""
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
import numpy as np
import trimesh

spec = importlib.util.spec_from_file_location('registration_surface', Path(__file__).parents[1] / 'tools/registration_surface.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SurfaceClaims(unittest.TestCase):
    def test_disconnected_unseeded_surface_stays_unclaimed(self):
        vertices = np.array([[0,0,0],[.01,0,0],[0,.01,0],[0,0,.001],[.01,0,.001],[0,.01,.001]])
        faces = np.array([[0,1,2],[3,4,5]])
        distances = np.array([[0,.1]] * 3 + [[.025,.1]] * 3)
        claims, seeds, costs = m.surface_claims(vertices, faces, distances,
                          seed_radius=.01, seed_margin=.02, reach=.08, ambiguity=.005)
        self.assertTrue(claims[:3,0].all())
        self.assertFalse(claims[3:].any(), 'nearby disconnected shell must not inherit a claim without a seed')
        self.assertTrue(np.isinf(costs[3:]).all())

    def test_ambiguous_surface_can_keep_multiple_claims(self):
        vertices = np.array([[0,0,0],[.01,0,0],[.02,0,0],[.01,.001,0]])
        faces = np.array([[0,1,3],[1,2,3]])
        distances = np.array([[0,.1],[.01,.01],[.1,0],[.01,.01]])
        claims, seeds, costs = m.surface_claims(vertices, faces, distances,
                          seed_radius=.001, seed_margin=.02, reach=.1, ambiguity=.005)
        self.assertEqual(seeds.sum(axis=0).tolist(), [1,1])
        self.assertTrue(claims[1].all())
        self.assertEqual(claims[0].tolist(), [True,False])

    def test_target_frame_matches_native_export(self):
        np.testing.assert_array_equal(m.export_frame(np.array([[1,2,3]])), [[1,3,-2]])

    def test_invalid_geometry_is_rejected(self):
        with self.assertRaises(ValueError): m.checked_mesh(np.zeros((1,3)), np.array([[0,1,0]]))

    def fixture(self, root):
        a = trimesh.creation.box(extents=[.1,.1,.1]); a.apply_translation([-.2,0,0])
        b = trimesh.creation.box(extents=[.1,.1,.1]); b.apply_translation([.2,0,0])
        mesh = trimesh.util.concatenate([a,b]); mesh.export(root/'target.glb')
        # Inverse of the observed native export convention.
        np.savez(root/'raw.npz', vertices=mesh.vertices[:,[0,2,1]] * [1,-1,1], faces=mesh.faces)
        (root/'raw.json').write_text(json.dumps({'mesh_grid_size':768}))
        identity = {'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}
        source = {'provenance':{'analyticalCarrier':{'parts':{'base':['a'],'boom':['b']}}}, 'objects':[
            {'id':key,'type':'procedural-mesh','geometry':{'kind':'box','parameters':{'width':.1,'height':.1,'depth':.1}},
             'transform':{**identity,'position':[x,0,0]}} for key,x in [('a',-.2),('b',.2)]]}
        (root/'source.json').write_text(json.dumps(source))
        fit = {'identity':{'source':{'sha256':m.digest(root/'source.json')},'target':{'sha256':m.digest(root/'target.glb')}},
               'recipe':{'targetTransform':identity,'settings':{'alignment':identity,'falloff':.035,'threshold':.5}}}
        (root/'fit.json').write_text(json.dumps(fit))
        inputs = {key:{'path':str(root/file),'sha256':m.digest(root/file)} for key,file in
                  [('source','source.json'),('fit','fit.json'),('target','target.glb'),('raw_mesh','raw.npz'),('raw_metadata','raw.json')]}
        manifest = {'output_dir':str(root/'output'),'inputs':inputs,'parameters':{'seed_radius':.01,'seed_margin':.02,'reach':.08,'ambiguity':.005},'transfer_tolerance':.1}
        path=root/'manifest.json';path.write_text(json.dumps(manifest));return path,manifest

    def test_full_transfer_preserves_triangles_and_exported_part_membership(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); path,manifest=self.fixture(root)
            report=m.run(path)
            self.assertEqual(report['status'],'complete')
            self.assertEqual(report['candidate']['triangles'],24)
            self.assertEqual(report['candidate']['unclaimed'],0)
            self.assertEqual(report['candidate']['contested'],0)
            self.assertEqual(report['candidate']['parts'],{'base':12,'boom':12})
            self.assertEqual(report['transfer']['unsupported_triangles'],0)
            for name,count in [('candidate',24),('baseline',24),('base',12),('boom',12)]:
                scene=trimesh.load(root/'output'/f'{name}.glb',force='scene',process=False)
                self.assertEqual(sum(len(g.faces) for g in scene.geometry.values()),count)

    def test_wrong_input_identity_leaves_failure_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path,manifest=self.fixture(root)
            manifest['inputs']['raw_mesh']['sha256']='incorrect';path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'source identity mismatch'):m.run(path)
            report=json.loads((root/'output/report.json').read_text())
            self.assertEqual(report['status'],'failed');self.assertEqual(report['phase'],'inputs')
            self.assertFalse((root/'output/candidate.glb').exists())

    def test_empty_raw_mesh_cannot_be_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path,manifest=self.fixture(root)
            np.savez(root/'raw.npz',vertices=np.zeros((0,3)),faces=np.zeros((0,3),dtype=int))
            manifest['inputs']['raw_mesh']['sha256']=m.digest(root/'raw.npz');path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'nonempty'):m.run(path)
            report=json.loads((root/'output/report.json').read_text())
            self.assertEqual(report['status'],'failed');self.assertEqual(report['phase'],'raw_surface')
            self.assertFalse((root/'output/candidate.glb').exists())

    def reject_raw_mutation(self, mutate, error):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, manifest = self.fixture(root)
            with np.load(root/'raw.npz', allow_pickle=False) as raw:
                vertices, faces = mutate(raw['vertices'], raw['faces'])
            np.savez(root/'raw.npz', vertices=vertices, faces=faces)
            manifest['inputs']['raw_mesh']['sha256'] = m.digest(root/'raw.npz')
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, error):
                m.run(path)
            report = json.loads((root/'output/report.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'raw_surface')
            self.assertEqual(report['last_trustworthy_evidence'], {})
            self.assertEqual({p.name for p in (root/'output').iterdir()}, {'report.json'})

    def test_fractional_raw_indices_cannot_be_truncated_into_success(self):
        self.reject_raw_mutation(lambda v, f: (v, f.astype(float) + .75), 'integer triangles')

    def test_out_of_range_raw_indices_cannot_wrap_into_success(self):
        self.reject_raw_mutation(lambda v, f: (v, f.astype(np.int64) + 2**32), 'outside vertex range')

    def test_extra_vertex_component_cannot_be_discarded_into_success(self):
        self.reject_raw_mutation(lambda v, f: (np.column_stack([v, np.full(len(v), np.nan)]), f),
                                 'finite vertices')


if __name__ == '__main__': unittest.main()
