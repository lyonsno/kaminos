import importlib.util
import json
import os
import unittest
import copy
import hashlib
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('joint_plan', Path(__file__).parents[1]/'tools/creature_joint_plan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CreaturePlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.probe = json.loads(Path(os.environ['CREATURE_JOINT_PROBE']).read_text())

    def test_four_connected_limbs_and_axial_chain(self):
        plan = module.build_plan(self.probe)
        joints = {j['name']:j for j in plan['joints']}
        for side in ('left', 'right'):
            for segment, parent in [('shoulder','spine-chest'),('elbow',f'forelimb-{side}-shoulder'),
                                    ('wrist',f'forelimb-{side}-elbow'),('toe',f'forelimb-{side}-wrist')]:
                name = f'forelimb-{side}-{segment}'
                self.assertIn(name, joints, f'complete creature requires {name}')
                self.assertEqual(joints[name]['parent'], parent)
        self.assertEqual(joints['spine-chest']['parent'],'spine-lumbar')
        self.assertEqual(joints['head']['parent'],'neck')
        self.assertEqual(sum(j['parent'] is None for j in joints.values()),1)

    def test_accepted_rear_frames_are_exact(self):
        joints = {j['name']:j for j in module.build_plan(self.probe)['joints']}
        for old in self.probe['bones']:
            for field in ('head','tail','matrix','parent'):
                self.assertEqual(joints[old['name']][field],old[field])

    def test_missing_anatomy_cannot_become_complete(self):
        broken = copy.deepcopy(self.probe)
        broken['anatomy'] = [m for m in broken['anatomy'] if m['name']!='Cube.091']
        with self.assertRaises(KeyError):
            module.build_plan(broken)

    def test_unverified_source_refused(self):
        broken = copy.deepcopy(self.probe)
        broken['source_unchanged'] = False
        with self.assertRaisesRegex(ValueError,'unverified anatomical source'):
            module.build_plan(broken)

    def test_cycle_and_nonfinite_pivots_refused(self):
        plan = module.build_plan(self.probe)
        plan['joints'][1]['parent'] = plan['joints'][1]['name']
        with self.assertRaisesRegex(ValueError,'cycle'):
            module.validate_plan(plan)
        plan = module.build_plan(self.probe)
        plan['joints'][-1]['head'][0] = float('nan')
        with self.assertRaisesRegex(ValueError,'nonfinite'):
            module.validate_plan(plan)


class SourceProtection(unittest.TestCase):
    def test_aliases_and_prior_output_refused_without_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            source,anatomy = Path(folder)/'source.blend',Path(folder)/'anatomy.glb'
            source.write_bytes(b'original blend')
            anatomy.write_bytes(b'original anatomy')
            for original in (source,anatomy):
                link = Path(folder)/(original.name+'.link')
                os.link(original,link)
                symlink = Path(folder)/(original.name+'.symlink')
                symlink.symlink_to(original)
                for target in (original,link,symlink):
                    with self.assertRaisesRegex(ValueError,'aliases an input'):
                        module.validate_probe_paths(source,anatomy,target)
                self.assertEqual(original.read_bytes(),b'original blend' if original==source else b'original anatomy')
            old_output = Path(folder)/'prior.json'
            old_output.write_bytes(b'prior evidence')
            with self.assertRaisesRegex(ValueError,'already exists'):
                module.validate_probe_paths(source,anatomy,old_output)
            self.assertEqual(old_output.read_bytes(),b'prior evidence')

    def test_stale_anatomy_hash_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            anatomy = Path(folder)/'anatomy.glb'
            anatomy.write_bytes(b'probed geometry')
            probe = {'source':{str(anatomy):hashlib.sha256(anatomy.read_bytes()).hexdigest()}}
            anatomy.write_bytes(b'changed geometry')
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):
                module.verify_probe_sources(probe)


if __name__ == '__main__':
    unittest.main()
