# kaminos-test: python
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from creature_attachment_layout import calibrate_attachment_layout


class AttachmentLayoutTests(unittest.TestCase):
    def setUp(self):
        self.names = ['pelvis', 'forelimb-left-shoulder', 'forelimb-right-shoulder',
                      'hindlimb-left-hip', 'hindlimb-right-hip', 'head']
        self.positions = [[0, 1, 0], [.4, .8, 1], [-.4, .8, 1],
                          [.1, .7, -.2], [-.1, .7, -.2], [0, 1.2, 1.5]]
        self.source = dict(names=self.names, positions=self.positions, rootIndex=0,
                           fore=[1, 2], hips=[3, 4], parents=[-1,0,0,0,0,0])
        self.reference = dict(names=self.names, rootIndex=0, fore=[1, 2], hips=[3, 4],
                              positions=[[0, 1, 0], [.2, .8, 1], [-.2, .8, 1],
                                         [.15, 1, 0], [-.15, 1, 0], [0, 1.2, 1.5]])
        self.plan = dict(joints=[dict(name=n, parent=None if i == 0 else 'pelvis',
                           head=[-p[0]*10, -p[2]*10, -p[1]*10],
                           tail=[-p[0]*10, -p[2]*10+1, -p[1]*10], retained=True,
                           matrix=[[1,0,0,-p[0]*10], [0,1,0,-p[2]*10],
                                   [0,0,1,-p[1]*10], [0,0,0,1]])
                       for i, (n,p) in enumerate(zip(self.names,self.positions))])

    def test_four_origins_change_and_other_joints_are_exact(self):
        before = copy.deepcopy((self.plan,self.source,self.reference))
        result = calibrate_attachment_layout(self.plan,self.source,self.reference)
        self.assertEqual(result['joints'][0], self.plan['joints'][0])
        self.assertEqual(result['joints'][5], self.plan['joints'][5])
        for i in [1,2,3,4]:
            self.assertNotEqual(result['joints'][i]['head'],self.plan['joints'][i]['head'])
            self.assertEqual(result['joints'][i]['parent'],self.plan['joints'][i]['parent'])
        self.assertEqual((self.plan,self.source,self.reference),before)

    def test_calibrated_coordinates_and_rest_translation(self):
        result = calibrate_attachment_layout(self.plan,self.source,self.reference)
        for i in [1,2,3,4]:
            expected = self.reference['positions'][i]
            actual = result['joints'][i]
            for k,v in enumerate([-expected[0]*10,-expected[2]*10,-expected[1]*10]):
                self.assertAlmostEqual(actual['head'][k],v)
                self.assertAlmostEqual(actual['matrix'][k][3],v)
            self.assertEqual([round(actual['tail'][k]-actual['head'][k],10) for k in range(3)], [0,1,0])

    def test_missing_origin_refused(self):
        self.source['names'][1] = 'unrelated'
        with self.assertRaisesRegex(ValueError,'correspondence'):
            calibrate_attachment_layout(self.plan,self.source,self.reference)

    def test_wrong_frame_refused(self):
        self.plan['joints'][5]['head'][0] += 2
        with self.assertRaisesRegex(ValueError,'frame'):
            calibrate_attachment_layout(self.plan,self.source,self.reference)

    def test_invalid_reference_refused(self):
        self.reference['positions'][1][0] = float('nan')
        with self.assertRaisesRegex(ValueError,'finite'):
            calibrate_attachment_layout(self.plan,self.source,self.reference)

    def test_parent_correspondence_refused(self):
        self.plan['joints'][5]['parent'] = self.names[1]
        with self.assertRaisesRegex(ValueError,'parent correspondence'):
            calibrate_attachment_layout(self.plan,self.source,self.reference)

    def test_nonfinite_control_refused(self):
        self.plan['joints'][5]['tail'][0] = float('nan')
        with self.assertRaisesRegex(ValueError,'finite'):
            calibrate_attachment_layout(self.plan,self.source,self.reference)


if __name__ == '__main__':
    unittest.main()
