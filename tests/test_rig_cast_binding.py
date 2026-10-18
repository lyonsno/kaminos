# kaminos-test: python
import hashlib
import importlib.util
import argparse
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('rig_cast_binding', Path(__file__).parents[1]/'tools/rig_cast_binding.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    root = np.eye(4)
    child = np.eye(4); child[1, 3] = 2
    frame = {'schema': 'kaminos.full-given-rig-frame.v1',
             'sourceArmatureLocalToNormalized': np.eye(4).tolist(),
             'canonicalWorldToSourceNormalized': np.eye(4).tolist(),
             'bones': [{'name': 'pelvis', 'parent': None, 'restMatrix': root.tolist()},
                       {'name': 'toe', 'parent': 'pelvis', 'restMatrix': child.tolist()}]}
    rig = {'joints': [{'name': 'pelvis', 'parent': None, 'head': [0, 0, 0]},
                      {'name': 'toe', 'parent': 'pelvis', 'head': [0, 2, 0]},
                      {'name': 'tip', 'parent': 'toe', 'head': [0, 3, 0], 'provisional': True}]}
    return rig, frame


class RigCastBinding(unittest.TestCase):
    def test_frame_preserves_every_existing_matrix_and_appends_actual_descendant(self):
        rig, original = fixture()
        result = module.derive_frame(rig, original)
        self.assertEqual(result['bones'][:2], original['bones'])
        self.assertEqual(result['bones'][2]['parent'], 'toe')
        np.testing.assert_array_equal(np.asarray(result['bones'][2]['restMatrix'])[:3, 3], [0, 3, 0])
        self.assertEqual(len(original['bones']), 2)

    def test_changed_base_joint_refuses_instead_of_retargeting(self):
        rig, original = fixture(); rig['joints'][1]['head'][1] = 2.1
        with self.assertRaisesRegex(ValueError, 'base.*head'):
            module.derive_frame(rig, original)

    def test_changed_parent_or_missing_joint_refuses(self):
        rig, original = fixture(); rig['joints'][1]['parent'] = None
        with self.assertRaisesRegex(ValueError, 'base.*parent'):
            module.derive_frame(rig, original)
        rig, original = fixture(); rig['joints'].pop(1)
        with self.assertRaisesRegex(ValueError, 'missing base'):
            module.derive_frame(rig, original)

    def test_unresolved_or_unmarked_extra_refuses(self):
        rig, original = fixture(); rig['joints'][-1]['parent'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'descendant'):
            module.derive_frame(rig, original)
        rig, original = fixture(); del rig['joints'][-1]['provisional']
        with self.assertRaisesRegex(ValueError, 'provisional'):
            module.derive_frame(rig, original)

    def test_saved_registration_uses_blender_world_flip_and_normalization_once(self):
        _, original = fixture()
        original['sourceArmatureLocalToNormalized'] = [[.5, 0, 0, 10], [0, .5, 0, 20], [0, 0, .5, 30], [0, 0, 0, 1]]
        points = np.array([[1., 2., 3.], [-1, 0, 2]])
        registration = {'scale': 2., 'rotation': np.eye(3).tolist(), 'translation': [4, 5, 6]}
        result, matrix = module.cast_to_normalized(points, registration, original)
        np.testing.assert_allclose(result, [[7, 24.5, 24], [9, 22.5, 25]])
        np.testing.assert_allclose(result, points@np.asarray(matrix)[:3, :3].T+np.asarray(matrix)[:3, 3])
        np.testing.assert_array_equal(points, [[1, 2, 3], [-1, 0, 2]])

    def test_bad_registration_refuses_not_fallback(self):
        _, original = fixture()
        for scale, rotation in [(0, np.eye(3)), (1, np.diag([-1, 1, 1])), (1, np.diag([2, 1, 1]))]:
            with self.assertRaisesRegex(ValueError, 'registration'):
                module.cast_to_normalized(np.ones((2, 3)), {'scale': scale, 'rotation': rotation.tolist(), 'translation': [0, 0, 0]}, original)

    def test_actual_digest_and_missing_source_are_not_substituted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'source'; path.write_bytes(b'actual source')
            record = {'path': str(path), 'sha256': hashlib.sha256(b'actual source').hexdigest()}
            self.assertEqual(module.authenticate_record(record), path.resolve())
            with self.assertRaisesRegex(ValueError, 'digest'):
                module.authenticate_record({**record, 'sha256': '0'*64})
            with self.assertRaisesRegex(ValueError, 'missing'):
                module.authenticate_record({**record, 'path': str(path)+'-missing'})

    def test_failure_before_primary_output_still_has_a_terminal_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = argparse.Namespace(inputs=str(root/'missing.json'), out=str(root/'output'), report=str(root/'report.json'), blender='unused')
            with self.assertRaises(FileNotFoundError):
                module.build(args)
            report = json.loads((root/'report.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'input-discovery')
            self.assertFalse((root/'output').exists())

    def test_report_cannot_overwrite_a_generated_package_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root/'inputs.json'
            record = {'path': str(path), 'sha256': '0'*64}
            path.write_text(json.dumps({'schema': 'wrong', 'rig': record, 'baseFrame': record, 'binderFiles': [], 'casts': []}))
            args = argparse.Namespace(inputs=str(path), out=str(root/'output'), report=str(root/'output/frame.json'), blender='unused')
            with self.assertRaisesRegex(ValueError, 'independent'):
                module.build(args)
            self.assertFalse((root/'output').exists())


if __name__ == '__main__':
    unittest.main()
