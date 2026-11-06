# kaminos-test: python
import importlib.util
from pathlib import Path
import unittest
import numpy as np
import hashlib
import json
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stock_section_recovery',ROOT/'tools/stock_section_recovery.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def channel(inner=.8,outer=1.,center=(.03,.12),segments=48):
    angles=np.linspace(-np.pi,0,segments+1)
    arc=lambda r:np.column_stack([center[0]+r*np.cos(angles),center[1]+r*np.sin(angles)])
    inside,outside=arc(inner),arc(outer)
    return np.concatenate([np.stack([inside[:-1],inside[1:]],axis=1),
        np.stack([outside[:-1],outside[1:]],axis=1),
        np.array([[inside[0],outside[0]],[inside[-1],outside[-1]]])])


def measured_ellipse(lines,target_radius):
    # Independent circular fixture fitter; the live path uses the source-pinned
    # known-bore ellipse fitter, not this test helper.
    points=lines.reshape(-1,2)
    design=np.column_stack([2*points,np.ones(len(points))])
    solved=np.linalg.lstsq(design,(points*points).sum(1),rcond=None)[0]
    center=solved[:2]
    radius=np.sqrt(solved[2]+center@center)
    return dict(center=center.tolist(),linear=(np.eye(2)*target_radius/radius).tolist(),
                ellipseAxes=[float(radius)]*2,ellipseResidualRMS=0.)


class ObservedOpenSection(unittest.TestCase):
    def test_invalid_plan_geometry_has_a_durable_plan_failure(self):
        cases=[([.2,-.2],.15,'strictly ordered'),([0,float('nan')],.15,'finite'),([0,.2],.1,'nominal')]
        for stations,outer,message in cases:
            with self.subTest(stations=stations,outer=outer),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                plan=root/'plan.json'
                plan.write_text(json.dumps(dict(nominal=dict(center=[0,0],innerRadius=.14,outerRadius=outer),
                    sources=[dict(name='channel',stations=stations)])))
                report=root/'report.json'
                process=subprocess.run([sys.executable,str(ROOT/'tools/stock_section_recovery.py'),
                    '--plan',str(plan),'--report',str(report)],capture_output=True,text=True)
                self.assertNotEqual(process.returncode,0)
                value=json.loads(report.read_text())
                self.assertFalse(value['ok'])
                self.assertEqual(value['phase'],'plan-validation')
                self.assertIn(message,value['error'].lower())

    def test_source_frame_exposes_the_actual_recovery_validator(self):
        descriptor=dict(schema='kaminos.stock-section.v1',nominal=dict(center=[0,0],innerRadius=.14,outerRadius=.15),
            observations=[dict(station=0,inner=dict(center=[0,0],linear=[1,0,0,1]),outer=dict(center=[0,0],linear=[1,0,0,1]))])
        def run(value):
            return subprocess.run(['node',str(ROOT/'tools/stock-source-frame.mjs')],
                input=json.dumps(dict(operation='validate-section',recovery=value)),capture_output=True,text=True)
        valid=run(descriptor)
        self.assertEqual(valid.returncode,0,valid.stderr)
        self.assertTrue(json.loads(valid.stdout)['valid'])
        descriptor['nominal']['outerRadius']=.1
        invalid=run(descriptor)
        self.assertNotEqual(invalid.returncode,0)
        self.assertIn('Positive ordered nominal',invalid.stderr)

    def test_distinct_inner_outer_observations_and_retained_lines(self):
        lines=channel()
        result=module.observe_section(lines,measured_ellipse,.2)
        self.assertTrue(result['observed'])
        self.assertEqual(result['station'],.2)
        np.testing.assert_allclose(result['inner']['center'],[.03,.12],atol=1e-9)
        np.testing.assert_allclose(result['outer']['center'],[.03,.12],atol=1e-9)
        np.testing.assert_allclose(result['inner']['linear'],[1.25,0,0,1.25],atol=1e-9)
        np.testing.assert_allclose(result['outer']['linear'],[1,0,0,1],atol=1e-9)
        np.testing.assert_array_equal(result['evidence']['segments'],lines)
        self.assertTrue(set(result['evidence']['innerSegments']).isdisjoint(result['evidence']['outerSegments']))

    def test_incomplete_tip_is_not_a_full_open_section(self):
        lines=channel()[:7]
        result=module.observe_section(lines,measured_ellipse,0.)
        self.assertFalse(result['observed'])
        self.assertIn('error',result)
        np.testing.assert_array_equal(result['evidence']['segments'],lines)

    def test_actual_terminal_fragment_cannot_reach_the_fitter(self):
        fixture=json.loads((ROOT/'tests/fixtures/stock-section-terminal-fragment.json').read_text())
        calls=[]
        def fitter(lines,radius):
            calls.append(lines)
            return measured_ellipse(lines,radius)
        result=module.observe_section(fixture['segments'],fitter,fixture['station'])
        self.assertFalse(result['observed'],'A bottom sliver is not an observed channel')
        self.assertEqual(calls,[],'Opening correspondence must precede ellipse fitting')
        self.assertIn('opening',result['error'].lower())
        np.testing.assert_array_equal(result['evidence']['segments'],fixture['segments'])

    def test_support_detour_does_not_become_the_outer_bowl(self):
        lines=channel()
        left,right=lines[48+20,0],lines[48+27,1]
        detour=np.array([left,[left[0],-1.5],[right[0],-1.5],right])
        lines=np.concatenate([lines[:48+20],lines[48+28:],np.stack([detour[:-1],detour[1:]],axis=1)])
        result=module.observe_section(lines,measured_ellipse,0.)
        self.assertTrue(result['observed'])
        np.testing.assert_allclose(result['outer']['linear'],[1,0,0,1],atol=1e-9)
        self.assertTrue(any('thickness' in e['reason'] for e in result['evidence']['excluded']))

    def test_wrong_fitter_identity_overwrites_stale_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            runtime=root/'fitter.py'
            runtime.write_text('')
            plan=root/'plan.json'
            plan.write_text(json.dumps(dict(ellipseFitter=dict(path=str(runtime),sha256='0'*64),
                nominal=dict(center=[0,0],innerRadius=.14,outerRadius=.15),sources=[dict(stations=[0,.2])])) )
            report=root/'report.json'
            report.write_text('{"ok":true,"phase":"complete"}')
            process=subprocess.run([sys.executable,str(ROOT/'tools/stock_section_recovery.py'),
                '--plan',str(plan),'--report',str(report)],capture_output=True,text=True)
            self.assertNotEqual(process.returncode,0)
            value=json.loads(report.read_text())
            self.assertFalse(value['ok'])
            self.assertEqual(value['phase'],'runtime-identity')
            self.assertEqual(value['ellipseFitter']['requestedSha256'],'0'*64)
            self.assertEqual(value['ellipseFitter']['effectiveSha256'],hashlib.sha256(b'').hexdigest())

    def test_missing_dependency_still_records_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            plan=root/'plan.json'
            plan.write_text('{}')
            report=root/'report.json'
            report.write_text('{"ok":true}')
            process=subprocess.run([sys.executable,'-S',str(ROOT/'tools/stock_section_recovery.py'),
                '--plan',str(plan),'--report',str(report)],capture_output=True,text=True)
            self.assertNotEqual(process.returncode,0)
            value=json.loads(report.read_text())
            self.assertFalse(value['ok'])
            self.assertEqual(value['phase'],'dependencies')


if __name__=='__main__':
    unittest.main()
