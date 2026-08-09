#!/usr/bin/env python3
"""Validate the published density-pass result bundle."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
LEDGER = ROOT / "density-pass-ledger.json"
SHEET = ROOT / "density-pass-results.html"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class DensityPassResultBundleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ledger = json.loads(LEDGER.read_text())
        cls.sheet = SHEET.read_text()

    def test_every_cell_has_exact_successful_route(self) -> None:
        cells = self.ledger["cells"]
        self.assertEqual(len(cells), 5)
        for cell in cells:
            self.assertEqual(cell["status"], "done")
            self.assertEqual(cell["exitCode"], 0)
            self.assertTrue(cell["effectiveInputPath"].endswith(cell["source"]))
            self.assertIn(cell["effectiveInputPath"], cell["effectiveRoute"])
            self.assertIn("--seed 80301", cell["effectiveRoute"])
            self.assertIn("--guidance 1.0", cell["effectiveRoute"])

    def test_every_cell_preserves_nonblank_hashed_input_and_output(self) -> None:
        for cell in self.ledger["cells"]:
            for field in ("source", "output"):
                path = ROOT / cell[field]
                self.assertTrue(path.is_file(), path)
                self.assertGreater(path.stat().st_size, 1024, path)
                self.assertEqual(sha256(path), cell[f"{field}Sha256"])
            prompt = ROOT / "prompts" / "fur.txt"
            self.assertEqual(sha256(prompt), cell["promptSha256"])

    def test_raw_greenroom_receipts_are_preserved_and_authenticated(self) -> None:
        records = self.ledger["cells"] + self.ledger["failedSubmissions"]
        self.assertEqual(len(records), 10)
        for record in records:
            receipt = ROOT / record["rawReceipt"]
            self.assertTrue(receipt.is_file(), receipt)
            self.assertEqual(sha256(receipt), record["rawReceiptSha256"])
            payload = json.loads(receipt.read_text())
            self.assertEqual(payload["job_id"], record["jobId"])
            self.assertEqual(payload["status"], record["status"])

    def test_operator_sheet_contains_adjacent_context(self) -> None:
        self.assertIn("This shape covered in fur.", self.sheet)
        self.assertIn("FLUX.2 Klein 9B", self.sheet)
        for cell in self.ledger["cells"]:
            self.assertIn(cell["id"], self.sheet)
            self.assertIn(cell["source"], self.sheet)
            self.assertIn(cell["output"], self.sheet)


if __name__ == "__main__":
    unittest.main()
