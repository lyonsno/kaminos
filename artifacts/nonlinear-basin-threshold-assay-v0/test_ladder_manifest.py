#!/usr/bin/env python3
"""Validate the density-ladder evidence contract without importing Blender."""

import hashlib
import json
import sys
import unittest
from pathlib import Path


MANIFEST = (
    Path(sys.argv.pop(1)).resolve()
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-")
    else Path(__file__).parent / "resolution-ladder" / "manifest.json"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class DensityLadderManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST.read_text())

    def test_effective_source_identity_is_recorded(self) -> None:
        source = self.manifest["source"]
        self.assertEqual(source["requestedBlend"], source["effectiveBlend"])
        blend = Path(source["effectiveBlend"])
        self.assertTrue(blend.is_file(), f"authored Blender source is unavailable: {blend}")
        self.assertEqual(sha256(blend), source["sha256"])
        self.assertTrue(source["object"])

    def test_triangle_density_strictly_decreases(self) -> None:
        counts = [cell["triangleCount"] for cell in self.manifest["cells"]]
        self.assertGreaterEqual(len(counts), 2)
        self.assertTrue(
            all(left > right for left, right in zip(counts, counts[1:])),
            counts,
        )

    def test_every_render_exists_and_is_nonblank(self) -> None:
        for cell in self.manifest["cells"]:
            render = MANIFEST.parent / cell["render"]
            self.assertTrue(render.is_file(), render)
            self.assertGreater(render.stat().st_size, 1024, render)


if __name__ == "__main__":
    unittest.main()
