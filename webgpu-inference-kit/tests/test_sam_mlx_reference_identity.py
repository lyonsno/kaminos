import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from sam_mlx_reference_identity import capture_reference_source


class ReferenceIdentityTests(unittest.TestCase):
    def test_effective_source_and_rejections(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            relative = "mlx_vlm/models/sam3/decoder.py"
            source = root / relative
            source.parent.mkdir(parents=True)
            source.write_text("observed reference\n")
            pin = {"commit": "pinned", "files": {
                relative: hashlib.sha256(source.read_bytes()).hexdigest(),
            }}
            replies = {
                ("rev-parse", "--show-toplevel"): str(root),
                ("rev-parse", "HEAD"): "pinned",
                ("ls-files", "--"): relative,
                ("diff", "HEAD"): "",
                ("ls-files", "--others"): "",
            }
            def git(argv, **kwargs):
                return replies[tuple(argv[3:5])] + "\n"
            original_read = Path.read_text
            def read(path, *args, **kwargs):
                if path.name == "sam-mlx-reference-pin.json":
                    return json.dumps(pin)
                return original_read(path, *args, **kwargs)
            with patch("sam_mlx_reference_identity.subprocess.check_output", side_effect=git), patch.object(Path, "read_text", read):
                result = capture_reference_source(source, root)
                self.assertEqual(result, {"root": str(root), "commit": "pinned", "clean": True, "files": pin["files"]})
                with self.assertRaisesRegex(ValueError, "root mismatch"):
                    capture_reference_source(source, root / "other")
                for key, value, message in [
                    (("rev-parse", "HEAD"), "wrong", "commit mismatch"),
                    (("diff", "HEAD"), relative, "source is dirty"),
                    (("ls-files", "--others"), "mlx_vlm/models/sam3/new.py", "source is dirty"),
                    (("ls-files", "--"), "mlx_vlm/models/sam3/other.py", "not tracked"),
                ]:
                    previous = replies[key]
                    replies[key] = value
                    with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                        capture_reference_source(source, root)
                    replies[key] = previous
                source.write_text("changed bytes\n")
                with self.assertRaisesRegex(ValueError, "hashes mismatch"):
                    capture_reference_source(source, root)


if __name__ == "__main__":
    unittest.main()
