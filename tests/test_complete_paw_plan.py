# kaminos-test: python
import copy
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from complete_paw_plan import FOOT_MESHES, complete_paws


def source():
    def joint(name, parent, point):
        return dict(name=name, parent=parent, head=point, tail=[point[0], point[1]+1, point[2]],
                    matrix=[[1,0,0,point[0]], [0,1,0,point[1]], [0,0,1,point[2]], [0,0,0,1]],
                    label='Toe', retained=False)
    joints = [joint('pelvis', None, [0,0,-10])]
    anatomy = []
    for i, (name, meshes) in enumerate(FOOT_MESHES.items()):
        parent = name.replace('toe', 'wrist' if name.startswith('fore') else 'hock')
        joints += [joint(parent, 'pelvis', [i*5+2, 3, -4]), joint(name, parent, [i*5+2,3,-2])]
        for mesh in meshes:
            anatomy.append(dict(name=mesh, long_axis_ends=[[i*5,0,0], [i*5,-2,0]]))
    plan = dict(source={'anatomy.glb':'observed-hash'}, anatomy_to_rear_frame=[2,3,0],
                joints=joints, model_joint_limit={'maximum':71,'count':len(joints)})
    return plan, dict(source=copy.deepcopy(plan['source']), source_unchanged=True, anatomy=anatomy)


class CompletePaws(unittest.TestCase):
    def test_recovers_forward_segment_and_preserves_every_nonfoot_joint(self):
        plan, probe = source()
        old = copy.deepcopy((plan, probe))
        result = complete_paws(plan, probe)
        by_name = {j['name']:j for j in result['joints']}
        self.assertEqual(len(result['joints']), len(plan['joints'])+4)
        for j in plan['joints']:
            if j['name'] not in FOOT_MESHES:
                self.assertEqual(by_name[j['name']], j)
        for i, name in enumerate(FOOT_MESHES):
            self.assertEqual(by_name[name]['head'], [i*5+2,3,0])
            end = by_name[name+'-end']
            self.assertEqual(end['head'], [i*5+2,1,0])
            self.assertEqual(end['parent'], name)
            self.assertEqual(by_name[name]['tail'], end['head'])
            self.assertEqual([r[3] for r in by_name[name]['matrix'][:3]], by_name[name]['head'])
        self.assertEqual(result['model_joint_limit']['count'], len(result['joints']))
        self.assertEqual((plan, probe), old)

    def test_endpoint_order_does_not_change_geometry(self):
        plan, probe = source()
        expected = complete_paws(plan, probe)
        for mesh in probe['anatomy']:
            mesh['long_axis_ends'].reverse()
        self.assertEqual(complete_paws(plan, probe), expected)

    def test_missing_digit_is_not_silently_averaged_away(self):
        plan, probe = source()
        probe['anatomy'].pop()
        with self.assertRaisesRegex(ValueError, 'missing anatomy'):
            complete_paws(plan, probe)

    def test_nonfinite_anatomy_rejected(self):
        plan, probe = source()
        probe['anatomy'][0]['long_axis_ends'][0][1] = math.nan
        with self.assertRaisesRegex(ValueError, 'finite'):
            complete_paws(plan, probe)

    def test_mismatched_source_rejected(self):
        plan, probe = source()
        probe['source']['anatomy.glb'] = 'another-source'
        with self.assertRaisesRegex(ValueError, 'source'):
            complete_paws(plan, probe)

    def test_already_extended_tree_refused(self):
        plan, probe = source()
        plan['joints'].append({**copy.deepcopy(plan['joints'][-1]), 'name':'hindlimb-right-toe-end', 'parent':'hindlimb-right-toe'})
        with self.assertRaisesRegex(ValueError, 'terminal'):
            complete_paws(plan, probe)

    def test_degenerate_phalanx_refused(self):
        plan, probe = source()
        probe['anatomy'][0]['long_axis_ends'][1] = probe['anatomy'][0]['long_axis_ends'][0][:]
        with self.assertRaisesRegex(ValueError, 'degenerate'):
            complete_paws(plan, probe)


if __name__ == '__main__':
    unittest.main()
