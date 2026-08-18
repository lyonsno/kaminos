import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np


TOOL = Path(__file__).parents[1] / "tools" / "run-procedural-groom-sam3-sanity.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_sam3_sanity", TOOL)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(SPEC is not None and SPEC.loader is not None, "sanity runner loader unavailable")
class ProceduralGroomSam3SanityTest(unittest.TestCase):
    def load_module(self):
        module = importlib.util.module_from_spec(SPEC)
        assert SPEC.loader is not None
        SPEC.loader.exec_module(module)
        return module

    def test_request_binds_source_and_rejects_digest_drift(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "fixture.png"
            image.write_bytes(b"image")
            request = root / "request.json"
            request.write_text(json.dumps({
                "schema": module.REQUEST_SCHEMA,
                "source": {"path": "fixture.png", "sha256": digest(image)},
                "model": "mlx-community/sam3-bf16",
                "backend": "mlx-metal",
                "rawThreshold": 0.1,
                "reportThresholds": [0.1, 0.3, 0.5],
                "nmsIouThreshold": 0.5,
                "prompts": [{"id": "cat", "text": "a cat", "mode": "text-only"}],
                "claimCeiling": "One authored image and one SAM route only.",
            }))
            loaded = module.load_request(request, root)
            self.assertEqual(loaded["sourcePath"], image.resolve())

            image.write_bytes(b"drift")
            with self.assertRaisesRegex(ValueError, "digest"):
                module.load_request(request, root)

    def test_threshold_and_nms_views_explain_raw_spray_without_destroying_candidates(self):
        module = self.load_module()
        scores = np.array([0.11, 0.34, 0.81, 0.72], dtype=np.float32)
        boxes = np.array([
            [0, 0, 10, 10],
            [20, 20, 40, 40],
            [21, 21, 41, 41],
            [70, 70, 90, 90],
        ], dtype=np.float32)

        views = module.selection_views(scores, boxes, [0.1, 0.3, 0.5], 0.5)

        self.assertEqual(views["raw-0p1"], [0, 1, 2, 3])
        self.assertEqual(views["raw-0p3"], [1, 2, 3])
        self.assertEqual(views["raw-0p5"], [2, 3])
        self.assertEqual(views["default-0p3-nms-0p5"], [2, 3])
        self.assertEqual(views["top-1"], [2])

    def test_report_contract_keeps_raw_candidate_identity_and_withholds_admission(self):
        module = self.load_module()
        report = module.report_contract(
            request_digest="abc",
            source_digest="def",
            model="mlx-community/sam3-bf16",
            backend="mlx-metal",
            raw_threshold=0.1,
            report_thresholds=[0.1, 0.3, 0.5],
            nms_iou_threshold=0.5,
        )
        self.assertEqual(report["schema"], module.REPORT_SCHEMA)
        self.assertEqual(report["candidateCustody"], "individual-raw-candidates-preserved")
        self.assertFalse(report["visualAdmission"])
        self.assertFalse(report["scientificAdmission"])


if __name__ == "__main__":
    unittest.main()
