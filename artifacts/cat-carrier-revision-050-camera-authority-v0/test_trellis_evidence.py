"""Fail-loud contracts for terminal Trellis evidence."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TrellisEvidenceContract(unittest.TestCase):
    def test_ledger_covers_selection_and_binds_outputs(self) -> None:
        self.assertFalse(
            (ROOT / "trellis-collection-state.json").exists(),
            "terminal evidence is incomplete or failed",
        )
        ledger_path = ROOT / "trellis-result-ledger.json"
        self.assertTrue(ledger_path.is_file(), "terminal Trellis ledger is missing")
        ledger = json.loads(ledger_path.read_text())
        selection_path = ROOT / "trellis-selection.json"
        selection = json.loads(selection_path.read_text())
        expected = {row["cellId"] for row in selection["candidates"]}
        self.assertEqual(set(ledger["cells"]), expected)
        self.assertEqual(ledger["selectionSha256"], digest(selection_path))
        for record in ledger["cells"].values():
            output = ROOT / record["output"]
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 4096)
            self.assertEqual(record["outputSha256"], digest(output))
            self.assertIn("generate.py", record["effectiveRoute"])


if __name__ == "__main__":
    unittest.main()
