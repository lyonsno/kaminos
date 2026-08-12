"""Contracts for unattended Trellis completion and visual publication."""

import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
DRIVER = ROOT / "await_trellis.py"


def load_driver():
    if not DRIVER.is_file():
        raise AssertionError("Trellis completion driver is missing")
    spec = importlib.util.spec_from_file_location("await_trellis", DRIVER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TrellisCompletionDriverContract(unittest.TestCase):
    def test_waits_then_renders_builds_and_validates(self) -> None:
        driver = load_driver()
        results = [
            subprocess.CompletedProcess([], 2),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0),
        ]
        with patch.object(driver.subprocess, "run", side_effect=results) as run, patch.object(
            driver.time, "sleep"
        ) as sleep:
            self.assertEqual(driver.main(), 0)
        sleep.assert_called_once_with(driver.RETRY_SECONDS)
        names = [Path(call.args[0][-1]).name for call in run.call_args_list[:4]]
        self.assertEqual(
            names,
            ["collect_trellis.py", "collect_trellis.py", "render_trellis_orbits.py", "build_trellis_sheet.py"],
        )
        self.assertIn("test_trellis_result_bundle.py", run.call_args_list[4].args[0])

    def test_terminal_collection_failure_stops_before_render(self) -> None:
        driver = load_driver()
        with patch.object(
            driver.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)
        ) as run:
            self.assertEqual(driver.main(), 1)
        self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
