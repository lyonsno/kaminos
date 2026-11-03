# kaminos-test: manual -- Local MLX switchable evaluation harness check; run with the MLX-VLM interpreter.
"""Fail-first tests for evaluate_switchable_mlx.py false-closure guards and durable failure reporting."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "models" / "bfl-pup"))


class TestMLXSwitchableEvalHarness(unittest.TestCase):
    def _write_partial_adapter(self, adapter_dir: Path, include_lowrank_file: bool = False) -> None:
        shards = adapter_dir / "shards"
        shards.mkdir(parents=True, exist_ok=True)
        empty_st = b"\x02\x00\x00\x00\x00\x00\x00\x00{}"
        (shards / "exact_small.safetensors").write_bytes(empty_st)
        if include_lowrank_file:
            (shards / "layers_00_07.safetensors").write_bytes(empty_st)
        manifest = {
            "schema": "kaminos.bfl-pup.delta-adapter.v1",
            "max_rank": 4,
            "min_lora_dim": 8,
            "shards": {
                "exact_small": {
                    "file": "shards/exact_small.safetensors",
                    "tensor_stats": {"model.language_model.norm.weight": {"mode": "exact", "shape": [8]}},
                },
                "layers_00_07": {
                    "file": "shards/layers_00_07.safetensors",
                    "tensor_stats": {
                        "model.language_model.layers.0.linear_attn.out_proj.weight": {
                            "mode": "lowrank_svd",
                            "shape": [8, 8],
                            "rank": 4,
                        }
                    },
                },
            },
        }
        (adapter_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    def test_rejects_missing_lowrank_shards_and_writes_failure_report(self):
        from evaluate_switchable_mlx import run_switchable_evaluation

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter_dir = root / "adapter"
            report_path = root / "report.json"
            self._write_partial_adapter(adapter_dir, include_lowrank_file=False)

            with self.assertRaisesRegex(RuntimeError, "Missing adapter shard"):
                run_switchable_evaluation(
                    model_dir=root / "nonexistent-model",
                    adapter_dir=adapter_dir,
                    report_path=report_path,
                    base_role="qwen",
                    modes=[{"name": "on_r4", "enabled": True, "rank": 4}],
                    cases=[{"id": "t2i", "task": "t2i", "prompt": "A copper kettle"}],
                )

            self.assertTrue(report_path.exists())
            rep = json.loads(report_path.read_text())
            self.assertEqual(rep["status"], "failed")
            self.assertEqual(rep["failure_phase"], "adapter-validation")
            self.assertIn("last_trustworthy_evidence", rep)

            # Even if shard files exist, an incomplete adapter (missing expected groups or exact_small=0) must be rejected
            self._write_partial_adapter(adapter_dir, include_lowrank_file=True)
            with self.assertRaisesRegex(RuntimeError, "Incomplete adapter"):
                run_switchable_evaluation(
                    model_dir=root / "nonexistent-model",
                    adapter_dir=adapter_dir,
                    report_path=report_path,
                    base_role="qwen",
                    modes=[{"name": "on_r4", "enabled": True, "rank": 4}],
                    cases=[{"id": "t2i", "task": "t2i", "prompt": "A copper kettle"}],
                )

    def test_cli_early_failure_writes_report_and_bfl_role_requires_explicit_approx_flag(self):
        import subprocess
        from evaluate_switchable_mlx import run_switchable_evaluation

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            early_report = root / "cli_early_report.json"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "models" / "bfl-pup" / "evaluate_switchable_mlx.py"),
                    "--config",
                    str(root / "missing_config.json"),
                    "--report",
                    str(early_report),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(proc.returncode, 0)
            self.assertTrue(early_report.exists())
            early_data = json.loads(early_report.read_text())
            self.assertEqual(early_data["status"], "failed")
            self.assertIn("failure_phase", early_data)

            # Reject base_role='bfl' unless allow_bfl_residual_approx=True is explicit
            with self.assertRaisesRegex(RuntimeError, "base_role='bfl' retains the unextracted SVD tail residual"):
                run_switchable_evaluation(
                    model_dir=root / "nonexistent-model",
                    adapter_dir=root / "nonexistent-adapter",
                    report_path=root / "bfl_reject.json",
                    base_role="bfl",
                    modes=[{"name": "off", "enabled": False, "rank": 0}],
                    cases=[{"id": "t2i", "task": "t2i", "prompt": "test"}],
                )

    def test_rejects_blank_or_non_stop_generation_as_false_closure(self):
        from evaluate_switchable_mlx import validate_generation_observation

        with self.assertRaisesRegex(RuntimeError, "Empty generation output"):
            validate_generation_observation({"output": "   ", "finish_reason": "stop", "effective_backend": "mlx-metal"})

        with self.assertRaisesRegex(RuntimeError, "Non-terminal finish_reason"):
            validate_generation_observation({"output": "Partial caption", "finish_reason": "length", "effective_backend": "mlx-metal"})

        with self.assertRaisesRegex(RuntimeError, "Unexpected effective_backend"):
            validate_generation_observation({"output": "Caption", "finish_reason": "stop", "effective_backend": "cpu"})


if __name__ == "__main__":
    unittest.main()
