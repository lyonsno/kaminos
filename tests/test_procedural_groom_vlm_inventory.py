import importlib.util
import unittest
from pathlib import Path


RUNNER = Path(__file__).parents[1] / "tools" / "run-procedural-groom-vlm-inventory.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_vlm_inventory", RUNNER)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ExtractJsonTest(unittest.TestCase):
    def test_prefers_fenced_json_over_mlx_vlm_diagnostic_lists(self):
        raw = """==========
Files: ['/tmp/front.png', '/tmp/left.png']
Prompt: <bos>[diagnostic]
```json
{"systems": [{"id": "outer-fibers"}]}
```
==========
Generation: 10 tokens
"""
        self.assertEqual(
            MODULE.extract_json(raw),
            {"systems": [{"id": "outer-fibers"}]},
        )

    def test_public_evidence_replaces_the_private_worktree_prefix(self):
        root = Path("/private/tmp/private-agent-worktree")
        raw = f"Files: ['{root}/artifacts/front.png']\n"
        self.assertEqual(
            MODULE.sanitize_runtime_paths(raw, root),
            "Files: ['<worktree>/artifacts/front.png']\n",
        )
        self.assertEqual(
            MODULE.public_path(root / "artifacts/front.png", root),
            "<worktree>/artifacts/front.png",
        )


if __name__ == "__main__":
    unittest.main()
