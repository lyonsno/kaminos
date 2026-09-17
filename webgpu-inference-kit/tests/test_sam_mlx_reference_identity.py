import hashlib
import ast
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from sam_mlx_reference_identity import capture_reference_source


class ReferenceIdentityTests(unittest.TestCase):
    def test_uncalibrated_serving_export_keeps_reference_without_acceptance(self):
        source_path = Path(__file__).resolve().parents[1] / "tools/sam-detr-stack-mlx-packet.py"
        tree = ast.parse(source_path.read_text())
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
        boundary = [node for node in main.body if isinstance(node, ast.If)
                    and isinstance(node.test, ast.Name) and node.test.id == "include_image_fpn_neck"][-1]
        keys = ["model", "modelLoad", "staticWeights", "shape", "claims", "promptTokenizer", "imagePreprocess",
                "imagePatchEmbed", "imageVitPrefix", "imageVitFirstBlock", "imageVitBlockStack", "imageFpnNeck",
                "promptTextIngress", "weights", "prompt", "sourceImage", "postprocess", "reference",
                "upstreamBoundaries", "toleranceBudgetSource", "toleranceCalibration", "tolerances",
                "visualization", "tensors", "schema", "routeId", "mode", "boundary", "createdAt"]
        artifacts = {}
        def write(path, payload):
            artifacts[path.name] = payload
            return {"file": path.name, "schema": payload["schema"], "sha256": "observed"}
        scope = {"include_image_fpn_neck": True, "manifest": dict.fromkeys(keys, {}),
                 "args": SimpleNamespace(execution_only=True), "out_dir": Path("/fixture"),
                 "tolerance_calibration": {"modelPackageId": "other-resolution"},
                 "canonical_identity_json": json.dumps,
                 "encoder_tool": SimpleNamespace(sha256_bytes=lambda value: hashlib.sha256(value).hexdigest()),
                 "write_json_artifact": write,
                 "SAM3_BROWSER_MODEL_PACKAGE_SCHEMA": "model", "SAM3_BROWSER_INVOCATION_SCHEMA": "invocation",
                 "SAM3_BROWSER_VERIFICATION_SCHEMA": "verification"}
        executable = compile(ast.Module(body=[boundary], type_ignores=[]), str(source_path), "exec")
        exec(executable, scope)
        self.assertNotIn("verification", scope["root_manifest"])
        reference = artifacts[scope["root_manifest"]["referenceObservations"]["file"]]
        self.assertEqual(reference["schema"], "kaminos.sam3-reference-observations.v0")
        self.assertIsNone(reference["tolerances"])
        self.assertIsNone(reference["toleranceCalibration"])
        self.assertIn("tensors", reference)
        scope["args"].execution_only = False
        with self.assertRaisesRegex(ValueError, "calibration model package identity drift"):
            exec(executable, scope)

    def test_detector_export_framework_expression(self):
        source_path = Path(os.environ.get("SAM_EXPORTER_TEST_SOURCE", Path(__file__).resolve().parents[1] / "tools/sam-detr-stack-mlx-packet.py"))
        tree = ast.parse(source_path.read_text())
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
        reference = next(node.value for node in main.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "reference" for target in node.targets))
        framework = next(value for key, value in zip(reference.keys, reference.values) if isinstance(key, ast.Constant) and key.value == "framework")
        source = {"root": "/observed/source", "commit": "observed", "clean": True}
        encoder = SimpleNamespace(sys=SimpleNamespace(executable="/effective/python"), mx=SimpleNamespace(default_device=lambda: "Device(cpu, 0)"))
        actual = eval(compile(ast.Expression(framework), str(source_path), "eval"), {"encoder_tool": encoder, "ref": {"reference_source": source}})
        self.assertEqual(actual, {"name": "mlx-vlm", "root": source["root"], "sourceCode": source, "execution": "/effective/python", "device": "Device(cpu, 0)"})

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
