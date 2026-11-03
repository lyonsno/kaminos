# kaminos-test: manual -- Local MLX switchable evaluation harness check; run with the MLX-VLM interpreter.
"""Fail-first tests for evaluate_switchable_mlx.py false-closure guards and durable failure reporting."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import mlx.core as mx

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "models" / "bfl-pup"))


class TestMLXSwitchableEvalHarness(unittest.TestCase):
    def _write_partial_adapter(self, adapter_dir: Path, include_lowrank_file: bool = False) -> None:
        shards = adapter_dir / "shards"
        shards.mkdir(parents=True, exist_ok=True)
        mx.save_safetensors(
            str(shards / "exact_small.safetensors"),
            {
                "model.language_model.norm.weight.delta": mx.zeros((8,), dtype=mx.bfloat16),
                "model.language_model.norm.weight.bfl": mx.ones((8,), dtype=mx.bfloat16),
            },
        )
        if include_lowrank_file:
            mx.save_safetensors(
                str(shards / "layers_00_07.safetensors"),
                {
                    "model.language_model.layers.0.linear_attn.out_proj.weight.lora_B": mx.zeros((8, 4), dtype=mx.bfloat16),
                    "model.language_model.layers.0.linear_attn.out_proj.weight.lora_A": mx.zeros((4, 8), dtype=mx.bfloat16),
                    "model.language_model.layers.0.linear_attn.out_proj.weight.singular_values": mx.ones((4,), dtype=mx.float32),
                },
            )
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
                    base_role="bfl",
                    modes=[{"name": "on_r4", "enabled": True, "rank": 4}],
                    cases=[{"id": "t2i", "task": "t2i", "prompt": "A copper kettle"}],
                )

            self.assertTrue(report_path.exists())
            rep = json.loads(report_path.read_text())
            self.assertEqual(rep["status"], "failed")
            self.assertEqual(rep["failure_phase"], "adapter-validation")
            self.assertIn("last_trustworthy_evidence", rep)

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
