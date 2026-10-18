# kaminos-test: python
import sys
import unittest
import argparse
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
from pose_normalization import rotation_between, canonical_joints, deform_points, fit_skeleton, quadruped_foot_targets
spec=importlib.util.spec_from_file_location('pose_build',Path(__file__).resolve().parents[1]/'tools/pose-normalization-build.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)


class PoseNormalizationTests(unittest.TestCase):
    def test_fixed_axial_joints_are_exact_while_free_limb_fits(self):
        theta=np.arange(16)*2*np.pi/16
        points=np.array([[.3+.12*np.cos(t),y,.12*np.sin(t)] for y in np.linspace(0,2,13) for t in theta])
        joints=np.array([[0.,0,0],[0,1,0],[0,2,0]])
        result=fit_skeleton(points,np.ones(len(points)),joints,[-1,0,1],[.12]*3,
            voxel_size=.08,fixed_joints=[0,1],
            anchors=[{'joint':2,'target':[.3,2,0]}])
        np.testing.assert_array_equal(result['joints'][:2],joints[:2])
        self.assertGreater(result['joints'][2,0],.2)
        self.assertEqual(result['fixedJointIndices'],[0,1])

    def test_fixed_joint_request_is_validated_not_silently_dropped(self):
        for fixed in [[-1],[2],[.5],[True]]:
            with self.subTest(fixed=fixed),self.assertRaisesRegex(ValueError,'fixed joint'):
                fit_skeleton([[.1,0,0],[.1,1,0]],[1,1],[[0,0,0],[0,1,0]],[-1,0],[.1,.1],
                    voxel_size=.1,fixed_joints=fixed)
        with self.assertRaisesRegex(ValueError,'fixed joint.*anchor'):
            fit_skeleton([[.1,0,0],[.1,1,0]],[1,1],[[0,0,0],[0,1,0]],[-1,0],[.1,.1],
                voxel_size=.1,fixed_joints=[0],anchors=[{'joint':0,'target':[1,0,0]}])

    def test_missing_fit_discovery_cannot_create_either_missing_input(self):
        for alias in ['fit','case']:
            with self.subTest(alias=alias),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);source=root/'source.json';source.write_text('{}')
                missing_case=root/'missing-case.json';missing_fit=root/'missing-fit.json';plan=root/'plan.json'
                plan.write_text(json.dumps({'schema':'kaminos.pose-normalization-inputs.v1','frame':build.record(source),
                    'radii':build.record(source),'binderFiles':[],
                    'casts':[{'slug':'a','case':{'path':str(missing_case),'sha256':'0'*64}},{'slug':'b','case':build.record(source)}]}))
                args=argparse.Namespace(plan=str(plan),out=str(root/'derived'),report=str(missing_fit if alias=='fit' else missing_case),stage='correct',voxel_size=.1,fit_report=str(missing_fit))
                with self.assertRaises(FileNotFoundError):build.run(args)
                self.assertFalse(missing_fit.exists(),'failure report manufactured fit-report input')
                self.assertFalse(missing_case.exists(),'failure report manufactured source-case input')

    def test_failure_report_cannot_create_missing_source_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source.json';source.write_text('{}')
            missing=root/'missing-case.json';plan=root/'plan.json'
            plan.write_text(json.dumps({'schema':'kaminos.pose-normalization-inputs.v1','frame':build.record(source),
                'radii':build.record(source),'binderFiles':[],
                'casts':[{'slug':'a','case':{'path':str(missing),'sha256':'0'*64}},{'slug':'b','case':build.record(source)}]}))
            args=argparse.Namespace(plan=str(plan),out=str(root/'derived'),report=str(missing),stage='fit',voxel_size=.1,fit_report=None)
            with self.assertRaises(FileNotFoundError):build.run(args)
            self.assertFalse(missing.exists(),'failure report created a missing retained input')

    def test_missing_plan_still_writes_independent_failure_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            args=argparse.Namespace(plan=str(root/'missing.json'),out=str(root/'derived'),report=str(root/'report.json'),stage='fit',voxel_size=.1,fit_report=None)
            with self.assertRaises(FileNotFoundError):build.run(args)
            self.assertTrue((root/'report.json').is_file(),'input discovery omitted independent report')
            report=json.loads((root/'report.json').read_text())
            self.assertEqual(report['status'],'failed');self.assertEqual(report['phase'],'input-discovery')
            self.assertIn('FileNotFoundError',report['error'])

    def test_correction_report_cannot_overwrite_referenced_fit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source.json';source.write_text('{}')
            fit=root/'fit.json';fit.write_text('{"original":"fit evidence"}')
            plan=root/'plan.json';plan.write_text(json.dumps({'schema':'kaminos.pose-normalization-inputs.v1',
                'frame':build.record(source),'radii':build.record(source),'binderFiles':[],
                'casts':[{'slug':'a','case':build.record(source)},{'slug':'b','case':build.record(source)}]}))
            fit_report=root/'fit-report.json';fit_report.write_text(json.dumps({'status':'completed','phase':'complete',
                'casts':[{'slug':'a','fit':build.record(fit)},{'slug':'b','fit':build.record(fit)}]}))
            before=fit.read_bytes()
            args=argparse.Namespace(plan=str(plan),out=str(root/'derived'),report=str(fit),stage='correct',voxel_size=.1,fit_report=str(fit_report))
            with self.assertRaises(Exception):build.run(args)
            self.assertEqual(fit.read_bytes(),before,'correction overwrote consumed correspondence')

    def test_failure_report_cannot_overwrite_retained_case_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);case=root/'source';case.mkdir()
            asset=case/'rest.bin';asset.write_bytes(b'preserve-original')
            manifest=case/'manifest.json';manifest.write_text(json.dumps({'assets':{'rest.bin':{'sha256':build.sha(asset)}}}))
            frame=root/'frame.json';frame.write_text('{}')
            plan=root/'plan.json';plan.write_text(json.dumps({'schema':'kaminos.pose-normalization-inputs.v1',
                'frame':build.record(frame),'radii':build.record(frame),'binderFiles':[],
                'casts':[{'slug':'a','case':build.record(manifest)},{'slug':'b','case':build.record(manifest)}]}))
            args=argparse.Namespace(plan=str(plan),out=str(root/'derived'),report=str(asset),stage='fit',voxel_size=.1)
            with self.assertRaises(Exception):build.run(args)
            self.assertEqual(asset.read_bytes(),b'preserve-original','failure publication overwrote retained source bytes')

    def test_failed_input_authentication_leaves_durable_failure_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source.json';source.write_text('{}')
            bad={'path':str(source),'sha256':'0'*64}
            plan=root/'plan.json';plan.write_text(json.dumps({'schema':'kaminos.pose-normalization-inputs.v1',
                'frame':bad,'radii':bad,'binderFiles':[], 'casts':[{'slug':'a','case':bad},{'slug':'b','case':bad}]}))
            args=argparse.Namespace(plan=str(plan),out=str(root/'derived'),report=str(root/'report.json'),stage='fit',voxel_size=.1)
            with self.assertRaisesRegex(ValueError,'digest mismatch'):build.run(args)
            report=json.loads((root/'report.json').read_text())
            self.assertEqual(report['status'],'failed');self.assertEqual(report['phase'],'authentication')
    def test_foot_correspondences_follow_four_surface_patches(self):
        names=['pelvis','hindlimb-left-hip','hindlimb-right-hip','forelimb-left-shoulder','forelimb-right-shoulder']
        q=[[0,1,0],[-.4,1,0],[.4,1,0],[-.4,1,-2],[.4,1,-2]]
        for limb in ['forelimb','hindlimb']:
            for side in ['left','right']:
                for end in ['mtp','toe-tip']:names.append(f'{limb}-{side}-{end}');q.append([0,-2,0])
        points=np.array([[x+dx,y,z+dz] for x in [-.4,.4] for z in [-2,0] for y in np.linspace(0,.6,13) for dx,dz in [(-.05,0),(.05,0),(0,-.05),(0,.05)]])
        anchors=quadruped_foot_targets(points,np.ones(len(points)),np.array(q),names)
        self.assertEqual(len(anchors),8)
        for a in anchors:
            self.assertLess(abs(a['target'][1]),.1)
            self.assertLess(abs(abs(a['target'][0])-.4),.02)
            self.assertGreater(a['surfaceSupport'],0)
    def test_rotation_including_opposite_and_zero_rejection(self):
        for a, b in [([0,1,0],[1,0,0]), ([0,1,0],[0,-1,0])]:
            r = rotation_between(a,b)
            np.testing.assert_allclose(r@a,b,atol=1e-10)
            np.testing.assert_allclose(r.T@r,np.eye(3),atol=1e-10)
            self.assertAlmostEqual(np.linalg.det(r),1)
        with self.assertRaises(ValueError): rotation_between([0,0,0],[1,0,0])

    def test_pose_only_preserves_fitted_lengths_not_authored_lengths(self):
        rest=np.array([[0.,0,0],[0,1,0],[0,2,0]])
        fitted=np.array([[1.,0,0],[1,.5,0],[1.5,.5,0]])
        parents=np.array([-1,0,1])
        pose=canonical_joints(rest,fitted,parents)
        np.testing.assert_allclose(pose,[[0,0,0],[0,.5,0],[0,1,0]])
        exact=canonical_joints(rest,fitted,parents,match_lengths=True)
        np.testing.assert_allclose(exact,rest)

    def test_transport_preserves_radial_detail_and_maps_both_endpoints(self):
        fitted=np.array([[0.,0,0],[1,0,0]])
        target=np.array([[0.,0,0],[0,2,0]])
        points=np.array([[0.,0,0],[1,0,0],[.5,.1,0]])
        result=deform_points(points,fitted,target,[-1,0],np.ones((3,1)))
        np.testing.assert_allclose(result,[[0,0,0],[0,2,0],[-.1,1,0]],atol=1e-10)
        with self.assertRaises(ValueError):
            deform_points(points,fitted,target,[-1,0],np.zeros((3,1)))

    def test_automatic_fit_to_offset_cylinder_uses_geometry(self):
        # No supplied target correspondences: recover the axis from a surface.
        theta=np.arange(32)*2*np.pi/32
        points=np.array([[.28+.12*np.cos(t),y,.12*np.sin(t)] for y in np.linspace(0,1,17) for t in theta])
        joints=np.array([[0.,0,0],[0,1,0]])
        result=fit_skeleton(points,np.ones(len(points)),joints,[-1,0],[.12,.12],voxel_size=.025)
        self.assertLess(np.max(np.abs(result['joints'][:,0]-.28)),.05)
        self.assertLess(result['after']['surfaceRms'],result['before']['surfaceRms']*.5)
        self.assertGreater(result['coarsePoints'],0)
        self.assertEqual(result['inputPoints'],len(points))

    def test_nonfinite_or_disconnected_tree_fails(self):
        with self.assertRaises(ValueError):
            fit_skeleton([[float('nan'),0,0]],[1],[[0,0,0],[0,1,0]],[-1,0],[.1,.1],voxel_size=.1)
        with self.assertRaises(ValueError):
            canonical_joints(np.zeros((2,3)),np.zeros((2,3)),[-1,-1])


if __name__=='__main__': unittest.main()
