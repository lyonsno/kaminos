# kaminos-test: python
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stock_profile_recovery',ROOT/'tools/stock_profile_recovery.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProfileCorrespondence(unittest.TestCase):
    def test_affine_correspondence_is_exact_between_landmarks(self):
        points=np.array([[-1,-1],[1,-1],[1,1],[-1,1]],dtype=float)
        affine=np.array([[1.2,.3],[-.2,.8]])
        targets=points@affine.T+[.4,-.1]
        field=module.fit_profile_field(points,targets)
        probes=np.array([[.2,.3],[-.4,.25],[0,0]])
        np.testing.assert_allclose(module.evaluate_field(field,probes),probes@affine.T+[.4,-.1],atol=1e-10)
        np.testing.assert_allclose(field['weights'],0,atol=1e-10)

    def test_nonlinear_correspondence_matches_an_independent_exact_field(self):
        points=np.array([[-1,-1],[1,-1],[1,1],[-1,1]],dtype=float)
        weights=np.array([[.1,0],[-.1,0],[.1,0],[-.1,0]])
        def exact(query):
            r2=((query[:,None,:]-points[None,:,:])**2).sum(2)
            basis=np.zeros_like(r2)
            positive=r2>0
            basis[positive]=.5*r2[positive]*np.log(r2[positive])
            return query+basis@weights
        field=module.fit_profile_field(points,exact(points))
        probes=np.array([[.25,.3],[-.2,.7],[0,0]])
        np.testing.assert_allclose(module.evaluate_field(field,probes),exact(probes),atol=1e-10)

    def test_conflicting_or_unresolved_features_refuse(self):
        with self.assertRaisesRegex(ValueError,'distinct|conflict'):
            module.fit_profile_field([[0,0],[0,0],[1,1]],[[0,0],[1,0],[1,1]])
        with self.assertRaisesRegex(ValueError,'rank|collinear'):
            module.fit_profile_field([[0,0],[1,0],[2,0]],[[0,0],[1,0],[2,0]])

    def test_common_rays_below_rim_pair_inner_and_outer_walls(self):
        inner=np.array([[-.9,0],[-.8,0],[0,-.8],[.8,0],[.9,0]])
        outer=np.array([[-1.1,0],[-1,0],[0,-1],[1,0],[1.1,0]])
        segments=np.concatenate([np.stack([inner[:-1],inner[1:]],axis=1),np.stack([outer[:-1],outer[1:]],axis=1)])
        section=dict(evidence=dict(opening=dict(center=[0,0]),segments=segments.tolist(),innerSegments=list(range(4)),outerSegments=list(range(4,8))))
        features=module.section_features(section,dict(center=[0,0],innerRadius=.8,outerRadius=1),[0,.5,1],.01)
        np.testing.assert_allclose(features['points'][0],[-.79,-.01])
        np.testing.assert_allclose(features['points'][3],[-.99,-.01])
        self.assertEqual(len(features['raw']),len(inner)+len(outer),'Fitted envelope must retain all raw rim evidence')

    def test_unresolved_wall_separation_is_not_a_conflicting_control(self):
        inner=np.array([[-1,0],[0,-1],[1,0]])
        outer=inner*1.00001
        segments=np.concatenate([np.stack([inner[:-1],inner[1:]],axis=1),np.stack([outer[:-1],outer[1:]],axis=1)])
        section=dict(evidence=dict(opening=dict(center=[0,0]),segments=segments.tolist(),innerSegments=[0,1],outerSegments=[2,3]))
        features=module.section_features(section,dict(center=[0,0],innerRadius=.8,outerRadius=1),[0,.5,1],.01,.001)
        self.assertEqual(len(features['points']),3)
        self.assertEqual(len(features['raw']),6)
        self.assertTrue(all(not r['outerResolved'] and len(r['distances'])==2 for r in features['rays']))


class ProfileProducerReports(unittest.TestCase):
    def valid_plan(self,root):
        inner=np.array([[-.8,0],[0,-.8],[.8,0]])
        outer=np.array([[-1,0],[0,-1],[1,0]])
        segments=np.concatenate([np.stack([inner[:-1],inner[1:]],axis=1),np.stack([outer[:-1],outer[1:]],axis=1)])
        section=dict(station=0,observed=True,evidence=dict(opening=dict(center=[0,0]),segments=segments.tolist(),innerSegments=[0,1],outerSegments=[2,3]))
        observed=root/'observed.json'
        observed.write_text(json.dumps(dict(ok=True,phase='complete',normalizer={},ellipseFitter={},parts=[dict(name='Synthetic U',source={},profile={},sections=[section])])))
        identity=lambda p:dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        runtime=identity(ROOT/'tools/stock-source-frame.mjs')
        runtime['modules']=[identity(ROOT/'experiments/stock-family'/str(name+'.mjs')) for name in ['model','rest-arc','section','profile','mouths']]
        return dict(observations=str(observed),stations=[0],parameters=[0,.5,1],rimInset=.01,nominal=dict(center=[0,0],innerRadius=.8,outerRadius=1),runtimeValidator=runtime)

    def invoke(self,plan,root):
        path=root/'plan.json';path.write_text(json.dumps(plan))
        report=root/'report.json';report.write_text(json.dumps(dict(ok=True,phase='complete')))
        run=subprocess.run([sys.executable,str(ROOT/'tools/stock_profile_recovery.py'),'--plan',str(path),'--report',str(report)],capture_output=True,text=True)
        value=json.loads(report.read_text())
        self.assertNotEqual(run.returncode,0)
        self.assertFalse(value['ok'],'A failed run must replace stale success')
        self.assertTrue(value.get('error') or value['phase']!='complete')
        return value

    def test_missing_observations_still_replace_stale_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            report=self.invoke(dict(observations=str(root/'missing.json')),root)
            self.assertEqual(report['phase'],'load')

    def test_incomplete_observations_are_not_a_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);observed=root/'observed.json'
            observed.write_text(json.dumps(dict(ok=False,phase='observe',parts=[])))
            report=self.invoke(dict(observations=str(observed)),root)
            self.assertIn('Complete observed source',report['error'])

    def test_wrong_runtime_identity_refuses_before_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);observed=root/'observed.json';runtime=root/'runtime.mjs'
            observed.write_text(json.dumps(dict(ok=True,phase='complete',parts=[{}])))
            runtime.write_text('throw Error("must not execute mismatched runtime");')
            plan=dict(observations=str(observed),parameters=[0,.5,1],nominal=dict(center=[0,0],innerRadius=.8,outerRadius=1),runtimeValidator=dict(path=str(runtime),sha256='0'*64,modules=[]))
            report=self.invoke(plan,root)
            self.assertIn('Runtime validator identity mismatch',report['error'])

    def test_empty_runtime_output_cannot_validate_a_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);observed=root/'observed.json';runtime=root/'runtime.mjs'
            runtime.write_text('process.exit(0);')
            inner=np.array([[-.8,0],[0,-.8],[.8,0]])
            outer=np.array([[-1,0],[0,-1],[1,0]])
            segments=np.concatenate([np.stack([inner[:-1],inner[1:]],axis=1),np.stack([outer[:-1],outer[1:]],axis=1)])
            section=dict(station=0,observed=True,evidence=dict(opening=dict(center=[0,0]),segments=segments.tolist(),innerSegments=[0,1],outerSegments=[2,3]))
            observed.write_text(json.dumps(dict(ok=True,phase='complete',normalizer={},ellipseFitter={},parts=[dict(name='Synthetic U',source={},profile={},sections=[section])])))
            plan=dict(observations=str(observed),stations=[0],parameters=[0,.5,1],rimInset=.01,nominal=dict(center=[0,0],innerRadius=.8,outerRadius=1),runtimeValidator=dict(path=str(runtime),sha256=hashlib.sha256(runtime.read_bytes()).hexdigest(),modules=[]))
            report=self.invoke(plan,root)
            self.assertEqual(report['phase'],'consumer-validation:Synthetic U')
            self.assertEqual(report['parts'][0]['consumerValidation']['stdout'],'')

    def test_one_coordinate_center_cannot_broadcast_into_authored_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);plan=self.valid_plan(root)
            plan['nominal']['center']=[.1]
            report=self.invoke(plan,root)
            self.assertIn('nominal',report['error'].lower())

    def test_each_selected_surface_is_required_and_has_valid_identities(self):
        for selection in [[],[0,0],[-1],[4],[True],[.5],[2]]:
            with self.subTest(selection=selection),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);plan=self.valid_plan(root)
                observed=Path(plan['observations']);value=json.loads(observed.read_text())
                value['parts'][0]['sections'][0]['evidence']['innerSegments']=selection
                observed.write_text(json.dumps(value))
                report=self.invoke(plan,root)
                self.assertIn('surface',report['error'].lower())

    def test_actual_consumer_accepts_complete_selected_surfaces(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);plan=self.valid_plan(root)
            path=root/'plan.json';path.write_text(json.dumps(plan));report=root/'report.json'
            run=subprocess.run([sys.executable,str(ROOT/'tools/stock_profile_recovery.py'),'--plan',str(path),'--report',str(report)],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            value=json.loads(report.read_text())
            self.assertTrue(value['ok'])
            self.assertEqual(set(value['parts'][0]['sections'][0]['profileFit']['features']['roles']),{'inner','outer'})


if __name__=='__main__':unittest.main()
