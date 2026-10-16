# kaminos-test: python
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from candidate_bind_frame import derive_frame


class CandidateFrameTests(unittest.TestCase):
    def setUp(self):
        self.names = ['pelvis', 'hip', 'foot', 'neck']
        self.parents = [-1, 0, 1, 0]
        points = [[0, 0, 0], [1, 0, 0], [1, 2, -1], [0, -3, -1]]
        self.plan = {'joints': []}
        bones = []
        for i, (name, p) in enumerate(zip(self.names, points)):
            parent = None if self.parents[i] < 0 else self.names[self.parents[i]]
            m = [[1, 0, 0, p[0]], [0, 1, 0, p[1]], [0, 0, 1, p[2]], [0, 0, 0, 1]]
            self.plan['joints'].append({'name': name, 'parent': parent, 'head': p, 'tail': [p[0], p[1]+1, p[2]], 'matrix': m})
            bones.append({'name': name, 'parent': parent, 'restMatrix': m, 'tail': [p[0], p[1]+1, p[2]], 'retainedRear': True})
        self.candidate = copy.deepcopy(self.plan)
        self.candidate['joints'][1]['head'] = [2, 0, 0]
        self.candidate['joints'][1]['matrix'][0][3] = 2
        self.candidate['joints'][1]['tail'] = [2, 1, 0]
        self.frame = {'schema': 'kaminos.full-given-rig-frame.v1', 'source': {},
                      'sourceArmatureLocalToNormalized': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
                      'canonicalWorldToSourceNormalized': [[-9, 0, 0, 0], [0, 0, -9, 0], [0, -9, 0, 0], [0, 0, 0, 1]],
                      'retainedRearMatrixMaxError': 0, 'bones': bones}
        self.control = {'joints': dict(zip(self.names, points)), 'parents': dict(zip(self.names, [b['parent'] for b in bones])),
                        'frames': [{'old': True}], 'reference': {'path': 'paint.npy'}, 'paintedWeightsIncluded': False}
        self.positions = [[-p[0]*.5, -p[2]*.5+1, -p[1]*.5] for p in [j['head'] for j in self.candidate['joints']]]

    def run_frame(self):
        return derive_frame(self.plan, self.candidate, self.frame, self.control, self.names, self.parents, self.positions)

    def test_new_heads_reach_bind_and_control_without_input_mutation(self):
        before = copy.deepcopy((self.plan, self.candidate, self.frame, self.control))
        frame, control = self.run_frame()
        self.assertEqual([r[3] for r in frame['bones'][1]['restMatrix'][:3]], [2, 0, 0])
        self.assertEqual(control['joints']['hip'], [2, 0, 0])
        self.assertEqual(before, (self.plan, self.candidate, self.frame, self.control))

    def test_bridge_maps_every_conditioned_head_into_geometry_frame(self):
        frame, _ = self.run_frame()
        m = frame['canonicalWorldToSourceNormalized']
        for p, joint in zip(self.positions, self.candidate['joints']):
            actual = [sum(m[k][a]*p[a] for a in range(3))+m[k][3] for k in range(3)]
            for a, b in zip(actual, joint['head']):
                self.assertAlmostEqual(a, b, places=6)

    def test_old_painted_reference_and_retained_rear_claim_are_not_transferred(self):
        frame, control = self.run_frame()
        self.assertNotIn('retainedRearMatrixMaxError', frame)
        self.assertNotIn('reference', control)
        self.assertEqual(control['frames'], [])
        self.assertFalse(frame['bones'][1]['retainedRear'])

    def test_wrong_conditioned_geometry_refused(self):
        self.positions[1][0] += .1
        with self.assertRaisesRegex(ValueError, 'canonical'):
            self.run_frame()

    def test_wrong_parent_refused(self):
        self.parents[1] = 2
        with self.assertRaisesRegex(ValueError, 'parent'):
            self.run_frame()

    def test_original_frame_mismatch_refused(self):
        self.frame['bones'][0]['restMatrix'][0][3] = 1
        with self.assertRaisesRegex(ValueError, 'original'):
            self.run_frame()

    def test_added_leaf_reaches_frame_and_painted_comparator_is_not_inherited(self):
        endpoint = copy.deepcopy(self.candidate['joints'][2])
        endpoint.update(name='toe-end',parent='foot',head=[1,3,-1],tail=[1,4,-1])
        endpoint['matrix'][1][3] = 3
        self.candidate['joints'].append(endpoint)
        self.names.append('toe-end')
        self.parents.append(2)
        self.positions.append([-.5,1.5,-1.5])
        frame, control = self.run_frame()
        self.assertEqual(len(frame['bones']),5)
        self.assertEqual(frame['bones'][-1]['parent'],'foot')
        self.assertEqual([r[3] for r in frame['bones'][-1]['restMatrix'][:3]],[1,3,-1])
        self.assertFalse(frame['bones'][-1]['retainedRear'])
        self.assertNotIn('reference',control)

    def test_removed_original_joint_rejected(self):
        self.candidate['joints'].pop()
        self.names.pop(); self.parents.pop(); self.positions.pop()
        with self.assertRaisesRegex(ValueError,'inventory'):
            self.run_frame()


if __name__ == '__main__':
    unittest.main()

