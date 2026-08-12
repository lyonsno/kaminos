"""Fail-loud contracts for revision-050 terminal FLUX evidence."""

import tempfile
import time
import unittest
from pathlib import Path

from collect_flux import sha256_bytes, validate_output, validate_prompt, validate_status


EXPECTED = {
    "jobType": "mflux_flux2_edit_promptfile",
    "source": "/fixture/revision-050.png",
    "promptFile": "/fixture/prompt.txt",
    "output": "/fixture/output.png",
    "seed": 80301,
    "model": "flux2-klein-9b",
    "quantize": 4,
    "width": 512,
    "height": 512,
    "steps": 8,
    "guidance": 1.0,
    "mlxCacheLimitGb": 48,
}


def good_status() -> dict:
    return {
        "job_id": "abc123abc123",
        "status": "done",
        "job_type": EXPECTED["jobType"],
        "exit_code": 0,
        "input_path": EXPECTED["source"],
        "params": {
            "prompt_file": EXPECTED["promptFile"],
            "seed": str(EXPECTED["seed"]),
            "model": EXPECTED["model"],
            "quantize": str(EXPECTED["quantize"]),
            "width": str(EXPECTED["width"]),
            "height": str(EXPECTED["height"]),
            "steps": str(EXPECTED["steps"]),
            "guidance": str(EXPECTED["guidance"]),
            "mlx_cache_limit_gb": str(EXPECTED["mlxCacheLimitGb"]),
        },
        "effective_route": (
            "/route/mflux-generate-flux2-edit "
            f"--image-paths {EXPECTED['source']} --prompt-file {EXPECTED['promptFile']} "
            f"--output {EXPECTED['output']} --model {EXPECTED['model']} "
            f"--quantize {EXPECTED['quantize']} --height {EXPECTED['height']} "
            f"--width {EXPECTED['width']} --steps {EXPECTED['steps']} "
            f"--guidance {EXPECTED['guidance']} --seed {EXPECTED['seed']} "
            f"--mlx-cache-limit-gb {EXPECTED['mlxCacheLimitGb']}"
        ),
    }


class TerminalEvidenceContract(unittest.TestCase):
    def test_accepts_exact_done_route(self) -> None:
        self.assertEqual(validate_status(good_status(), EXPECTED), [])

    def test_rejects_fallback_route_and_wrong_seed(self) -> None:
        status = good_status()
        status["params"]["seed"] = "999"
        status["effective_route"] = status["effective_route"].replace(
            "mflux-generate-flux2-edit", "fallback-runner"
        )
        errors = validate_status(status, EXPECTED)
        self.assertTrue(any("seed" in error for error in errors))
        self.assertTrue(any("effective route" in error for error in errors))

    def test_rejects_nonterminal_success_appearance(self) -> None:
        status = good_status()
        status["status"] = "running"
        self.assertIn("status is running, expected done", validate_status(status, EXPECTED))

    def test_rejects_missing_tiny_or_wrong_size_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertTrue(validate_output(root / "missing.png", (512, 512)))
            tiny = root / "tiny.png"
            tiny.write_bytes(b"not an image")
            self.assertTrue(validate_output(tiny, (512, 512)))

    def test_rejects_stale_primary_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.png"
            output.write_bytes(
                b"\x89PNG\r\n\x1a\n"
                + b"\x00\x00\x00\rIHDR"
                + (512).to_bytes(4, "big")
                + (512).to_bytes(4, "big")
                + b"x" * 2048
            )
            errors = validate_output(output, (512, 512), started_at=time.time() + 10)
            self.assertTrue(any("predates" in error for error in errors))

    def test_rejects_prompt_drift_and_post_start_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            prompt = Path(directory) / "prompt.txt"
            prompt.write_text("This shape as a dog.\n")
            expected_text = "This shape as a cat."
            errors = validate_prompt(
                prompt,
                expected_text,
                sha256_bytes(expected_text.encode()),
                started_at=time.time() - 10,
            )
            self.assertTrue(any("content" in error for error in errors))
            self.assertTrue(any("modified after" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
