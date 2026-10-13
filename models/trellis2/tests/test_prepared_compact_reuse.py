# kaminos-test: python
"""Small deterministic checks of the production package-reuse blocks.

AST extraction skips command/source admission only; it executes the actual
packing policy, not a replacement packager or browser conformance fixture.
"""
import ast
import hashlib
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "pack-prepared-generation.py"
TREE = ast.parse(SCRIPT.read_text())
TRY = next(node for node in TREE.body if isinstance(node, ast.Try))
LINK = next(node for node in TRY.body if isinstance(node, ast.For)
            and ast.unparse(node.target) == "(key, row)")
PROFILE = next(node for node in TRY.body if isinstance(node, ast.If)
               and ast.unparse(node.test) == "a.pipeline_type == '512'")


class PreparedCompactReuse(unittest.TestCase):
    def reuse(self, descriptor, physical_name="weight.f32", data=b"12345678"):
        with tempfile.TemporaryDirectory() as temporary:
            base, out = Path(temporary) / "base", Path(temporary) / "out"
            base.mkdir()
            out.mkdir()
            (base / physical_name).write_bytes(data)
            namespace = {"m": {"tensors": {"weight": descriptor}}, "image_tensor": "pixels",
                         "base": base, "out": out, "Path": Path, "os": os,
                         "linked": 0, "linked_bytes": 0}
            exec(compile(ast.Module(body=[LINK], type_ignores=[]), str(SCRIPT), "exec"), namespace)
            self.assertTrue(os.path.samefile(base / physical_name, out / physical_name))
            return namespace["linked_bytes"]

    def test_legacy_f32_and_partial_physical_file(self):
        self.assertEqual(self.reuse({"file": "weight.f32", "byteLength": 8}), 8)
        with self.assertRaisesRegex(ValueError, "partial retained checkpoint"):
            self.reuse({"file": "weight.f32", "byteLength": 12})

    def test_declared_storage_cannot_fall_back_to_logical_file(self):
        for storage in [None, {"encoding": "unknown", "file": "weight.f32", "byteLength": 4,
                               "sha256": "a" * 64},
                        {"encoding": "f16-le", "file": "../weight.f32", "byteLength": 4,
                         "sha256": "a" * 64},
                        {"encoding": "f16-le", "file": "weight.f32", "byteLength": 8,
                         "sha256": "a" * 64}]:
            with self.subTest(storage=storage), self.assertRaisesRegex(ValueError, "storage|tensor name"):
                self.reuse({"file": "weight.f32", "byteLength": 8, "storage": storage})

    def test_compact_physical_file_reused_without_logical_f32_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary) / "base"
            out = Path(temporary) / "out"
            base.mkdir()
            out.mkdir()
            data = bytes.fromhex("803f0040")  # BF16 [1, 2], source logical F32 is eight bytes.
            (base / "weight.bf16-le").write_bytes(data)
            descriptor = {"file": "weight.f32", "byteLength": 8,
                          "storage": {"encoding": "bf16-le", "file": "weight.bf16-le",
                                      "byteLength": 4, "sha256": hashlib.sha256(data).hexdigest()}}
            namespace = {"m": {"tensors": {"weight": descriptor}}, "image_tensor": "pixels",
                         "base": base, "out": out, "Path": Path, "os": os,
                         "linked": 0, "linked_bytes": 0}
            exec(compile(ast.Module(body=[LINK], type_ignores=[]), str(SCRIPT), "exec"), namespace)
            self.assertTrue(os.path.samefile(base / "weight.bf16-le", out / "weight.bf16-le"))
            self.assertFalse((out / "weight.f32").exists())
            self.assertEqual(namespace["linked_bytes"], 4)
            self.assertEqual(namespace["m"]["tensors"]["weight"], descriptor)

    def test_existing_512_package_needs_no_high_resolution_role(self):
        namespace = {"a": SimpleNamespace(pipeline_type="512"),
                     "m": {"models": {role: {"config": {"resolution": 32}}
                                       for role in ["shapeDecoder", "textureDecoder"]}}}
        exec(compile(ast.Module(body=[PROFILE], type_ignores=[]), str(SCRIPT), "exec"), namespace)
        self.assertEqual(set(namespace["m"]["models"]), {"shapeDecoder", "textureDecoder"})


if __name__ == "__main__":
    unittest.main()
