#!/usr/bin/env python3

import tempfile
import unittest
from pathlib import Path

from run_official_space import reset_run_outputs


class OfficialSpaceRunnerTests(unittest.TestCase):
    def test_reset_removes_stale_success_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output_dir = Path(temporary) / "run"
            output_dir.mkdir()
            stale = [
                output_dir / "output.glb",
                output_dir / "preprocessed.png",
                output_dir / "preview.html",
                output_dir / "run-report.json",
            ]
            for path in stale:
                path.write_bytes(b"stale success")

            reset_run_outputs(output_dir)

            self.assertTrue(output_dir.is_dir())
            self.assertTrue(all(not path.exists() for path in stale))


if __name__ == "__main__":
    unittest.main()
