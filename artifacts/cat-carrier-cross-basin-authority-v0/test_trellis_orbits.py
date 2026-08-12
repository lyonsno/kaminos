#!/usr/bin/env python3
"""Hash-bound reuse contract for Trellis orbit evidence."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from render_trellis_orbits import orbit_is_current


class TrellisOrbitContract(unittest.TestCase):
    def test_manifest_is_reused_only_for_the_current_glb(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            glb = root / "output.glb"
            manifest = root / "orbit-manifest.json"
            glb.write_bytes(b"first")
            outputs = []
            for index in range(6):
                view = root / f"view-{index}.png"
                view.write_bytes(b"png")
                outputs.append({
                    "path": str(view),
                    "sha256": hashlib.sha256(view.read_bytes()).hexdigest(),
                })
            manifest.write_text(json.dumps({
                "status": "completed",
                "glb": {"sha256": hashlib.sha256(b"first").hexdigest()},
                "outputs": outputs,
            }))
            self.assertTrue(orbit_is_current(manifest, glb))
            (root / "view-2.png").write_bytes(b"tampered")
            self.assertFalse(orbit_is_current(manifest, glb))
            (root / "view-2.png").write_bytes(b"png")
            glb.write_bytes(b"second")
            self.assertFalse(orbit_is_current(manifest, glb))


if __name__ == "__main__":
    unittest.main()
