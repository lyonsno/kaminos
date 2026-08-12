#!/usr/bin/env python3
"""False-closure tests for the selective Trellis evidence collector."""

import json
import tempfile
import unittest
from pathlib import Path

from collect_trellis import sha256, validate_output, validate_status


class TrellisEvidenceContract(unittest.TestCase):
    def setUp(self) -> None:
        self.expected = {
            "jobType": "trellis2mlx_fast",
            "input": "/tmp/source.png",
            "output": "/tmp/output.glb",
            "seed": 42,
            "steps": 6,
            "targetFaces": 200000,
            "textureSize": 1024,
        }
        self.status = {
            "status": "done",
            "exit_code": 0,
            "job_type": "trellis2mlx_fast",
            "input_path": "/tmp/source.png",
            "params": {"texture_size": "1024"},
            "effective_route": (
                "python generate.py --image /tmp/source.png --output /tmp/output.glb "
                "--seed 42 --steps 6 --target-faces 200000 --texture-size 1024"
            ),
        }

    def test_effective_route_can_supply_greenroom_defaults(self) -> None:
        self.assertEqual(validate_status(self.status, self.expected), [])

    def test_wrong_effective_seed_fails_loud(self) -> None:
        self.status["effective_route"] = self.status["effective_route"].replace("--seed 42", "--seed 7")
        self.assertTrue(any("effective route" in error for error in validate_status(self.status, self.expected)))

    def test_seed_prefix_lie_fails_loud(self) -> None:
        self.status["effective_route"] = self.status["effective_route"].replace("--seed 42", "--seed 420")
        self.assertTrue(any("effective route" in error for error in validate_status(self.status, self.expected)))

    def test_output_path_prefix_lie_fails_loud(self) -> None:
        self.status["effective_route"] = self.status["effective_route"].replace(
            "--output /tmp/output.glb",
            "--output /tmp/output.glb.stale",
        )
        self.assertTrue(any("effective route" in error for error in validate_status(self.status, self.expected)))

    def test_wrong_input_fails_loud(self) -> None:
        self.status["input_path"] = "/tmp/other.png"
        self.assertTrue(any("effective input" in error for error in validate_status(self.status, self.expected)))

    def test_stale_primary_output_fails_loud(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.glb"
            output.write_bytes(b"x" * 5000)
            self.assertTrue(any("predates" in error for error in validate_output(output, started_at=output.stat().st_mtime + 10)))

    def test_blank_primary_output_fails_loud(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.glb"
            output.write_bytes(b"x" * 100)
            self.assertTrue(any("small" in error for error in validate_output(output)))

    def test_input_hash_is_content_bound(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"first")
            first = sha256(source)
            source.write_bytes(b"second")
            self.assertNotEqual(sha256(source), first)


if __name__ == "__main__":
    unittest.main()
