import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "source_plate_assay_manifest.py"


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _spec(root: Path) -> dict:
    source = root / "source.png"
    source.write_bytes(b"source-pixels")
    output = root / "output.png"
    output.write_bytes(b"output-pixels")
    receipt = root / "receipt.json"
    receipt.write_text('{"status":"done"}\n')
    descriptor = root / "plate.json"
    descriptor.write_text('{"plate":"sentinel"}\n')
    return {
        "schema": "kaminos.source-plate-assay-spec.v0",
        "id": "fixture-cell",
        "status": "complete",
        "comparison": {"trancheId": "fixture", "cellId": "fixture-cell", "matchedFactors": [], "variableFactors": []},
        "conditioningInputs": [{
            "slot": 0,
            "role": "source-plate-rgb",
            "requestedPath": str(source),
            "effectivePath": str(source.resolve()),
            "sha256": _sha256(source.read_bytes()),
            "mediaType": "image/png",
            "descriptor": {
                "requestedPath": str(descriptor),
                "effectivePath": str(descriptor.resolve()),
                "sha256": _sha256(descriptor.read_bytes()),
            },
            "projection": {"mode": "orthographic", "cameraSha256": "a" * 64, "silhouetteSha256": "b" * 64},
        }],
        "promptClauses": {
            "sourceAuthority": "Treat this plate as authoritative.",
            "completion": "Complete one coherent organism.",
            "aesthetic": "Use neutral clay.",
            "projection": "Preserve projection and silhouette.",
            "structural": "Retain the distinctive structural event.",
            "exclusion": "",
        },
        "requestedSettings": {
            "routeId": "gpu-greenroom/mflux_flux2_edit_promptfile", "model": "flux2-klein-9b",
            "modelRevision": "92196c8e11f7b6cf2b7493e037d8c5345c559216", "steps": 8, "guidance": 1.0, "seed": 80301,
            "width": 512, "height": 512, "quantize": 4,
        },
        "effectiveSettings": {
            "routeId": "gpu-greenroom/mflux_flux2_edit_promptfile", "runner": "mflux-generate-flux2-edit",
            "runnerVersion": "mflux-0.16.9", "model": "flux2-klein-9b", "modelRevision": "92196c8e11f7b6cf2b7493e037d8c5345c559216",
            "steps": 8, "guidance": 1.0, "seed": 80301, "width": 512, "height": 512, "quantize": 4,
            "settingAuthority": {
                "guidance": "fixed-distilled-1.0", "steps": "effective-scheduler-iterations",
                "seed": "effective-generation-latent-seed", "dimensions": "effective-generation-latent-shape",
                "quantize": "effective-weight-precision",
            },
            "receiptPath": str(receipt.resolve()), "receiptSha256": _sha256(receipt.read_bytes()),
            "ignoredParams": [], "fallback": False,
        },
        "requestedChannels": ["rgb"],
        "outputs": [{
            "channel": "rgb", "status": "complete", "path": str(output.resolve()),
            "sha256": _sha256(output.read_bytes()), "byteLength": len(output.read_bytes()),
            "nonblank": True, "cached": False,
        }],
        "failure": None,
    }


class SourcePlateAssayCliContracts(unittest.TestCase):
    def test_cli_writes_manifest_plate_and_terminal_report_to_caller_paths(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(_spec(root)))
            manifest_path = root / "out" / "manifest.json"
            plate_path = root / "out" / "plate.html"
            report_path = root / "out" / "report.json"

            completed = subprocess.run(
                [sys.executable, str(CLI), "--input", str(spec_path), "--manifest", str(manifest_path),
                 "--plate", str(plate_path), "--report", str(report_path)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            report = json.loads(report_path.read_text())
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(report["status"], "complete")
            self.assertEqual(report["manifestSha256"], manifest["manifestSha256"])
            self.assertTrue(plate_path.read_text().startswith("<!doctype html>"))

    def test_cli_failure_still_writes_phase_and_last_trustworthy_input_identity(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            spec_path = root / "broken.json"
            spec_path.write_text('{"schema":"wrong"}\n')
            report_path = root / "report.json"

            completed = subprocess.run(
                [sys.executable, str(CLI), "--input", str(spec_path), "--manifest", str(root / "manifest.json"),
                 "--plate", str(root / "plate.html"), "--report", str(report_path)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(completed.returncode, 0)
            report = json.loads(report_path.read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "manifest-schema")
            self.assertEqual(report["lastTrustworthyEvidence"]["inputSha256"], _sha256(spec_path.read_bytes()))
            self.assertFalse((root / "manifest.json").exists())
            self.assertFalse((root / "plate.html").exists())


if __name__ == "__main__":
    unittest.main()
