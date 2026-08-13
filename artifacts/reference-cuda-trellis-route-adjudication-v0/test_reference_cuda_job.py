#!/usr/bin/env python3

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from reference_cuda_job import build_initial_report, emit_local_report


class ReferenceCudaJobTests(unittest.TestCase):
    def test_initial_report_binds_route_source_and_cost_ceiling(self) -> None:
        report = build_initial_report()

        self.assertEqual(report["status"], "running")
        self.assertEqual(
            report["source"]["sha256"],
            "b1d13ee8169c6310d783b5a9395a2f43ebc010d6c3d711712c29e9080cac24e7",
        )
        self.assertEqual(report["effectiveRoute"]["hardwareFlavor"], "a10g-small")
        self.assertEqual(report["effectiveRoute"]["timeoutMinutes"], 15)
        self.assertEqual(report["effectiveRoute"]["maximumCostUsd"], 0.2505)
        self.assertEqual(report["effectiveRoute"]["pipelineType"], "1024_cascade")
        self.assertEqual(report["effectiveRoute"]["seed"], 80301)

    def test_local_report_is_emitted_before_remote_persistence(self) -> None:
        report = build_initial_report()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "run-report.json"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                emit_local_report(path, report)

            self.assertEqual(json.loads(path.read_text())["status"], "running")
            self.assertIn('"lastTrustworthyEvidence": "invocation-recorded"', stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
