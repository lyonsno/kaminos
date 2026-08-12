"""Focused fail-loud tests for stale, blank, missing, and mixed-route evidence."""

import struct
import tempfile
import time
import unittest
import zlib
from pathlib import Path

from evidence_contract import validate_output, validate_status


EXPECTED = {
    "jobType": "mflux_flux2_edit_promptfile", "source": "/fixture/source.png", "promptFile": "/fixture/prompt.txt",
    "output": "/fixture/output.png", "params": {"prompt_file": "/fixture/prompt.txt", "seed": "80301", "model": "flux2-klein-9b", "quantize": "4", "width": "512", "height": "512", "steps": "8", "guidance": "1.0", "mlx_cache_limit_gb": "48"},
}


def png(path: Path, value: int) -> None:
    row = bytes([0]) + bytes([value, value, value]) * 512
    body = zlib.compress(row * 512)
    def chunk(name: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + name + payload + b"\0\0\0\0"
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 512, 512, 8, 2, 0, 0, 0)) + chunk(b"IDAT", body) + chunk(b"IEND", b""))


def status() -> dict:
    return {"status": "done", "exit_code": 0, "job_type": EXPECTED["jobType"], "params": dict(EXPECTED["params"]), "effective_route": "/route/mflux-generate-flux2-edit --image-paths /fixture/source.png --prompt-file /fixture/prompt.txt --output /fixture/output.png --seed 80301 --model flux2-klein-9b --quantize 4 --height 512 --width 512 --steps 8 --guidance 1.0 --mlx-cache-limit-gb 48"}


class EvidenceContract(unittest.TestCase):
    def test_accepts_exact_route(self) -> None:
        self.assertEqual(validate_status(status(), EXPECTED), [])

    def test_rejects_mixed_route_and_wrong_seed(self) -> None:
        record = status()
        record["params"]["seed"] = "9"
        record["effective_route"] = record["effective_route"].replace("mflux-generate-flux2-edit", "fallback")
        errors = validate_status(record, EXPECTED)
        self.assertTrue(any("seed" in error for error in errors))
        self.assertTrue(any("effective route" in error for error in errors))

    def test_rejects_missing_blank_and_stale_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertTrue(validate_output(root / "missing.png", (512, 512), None))
            blank = root / "blank.png"
            png(blank, 0)
            self.assertTrue(any("blank" in error for error in validate_output(blank, (512, 512), None)))
            image = root / "stale.png"
            png(image, 127)
            self.assertTrue(any("predates" in error for error in validate_output(image, (512, 512), time.time() + 10)))
