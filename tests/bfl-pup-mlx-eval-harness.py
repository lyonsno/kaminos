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
        import hashlib
        import torch
        from safetensors.torch import save_file

        shards = adapter_dir / "shards"
        shards.mkdir(parents=True, exist_ok=True)
        exact_f = shards / "exact_small.safetensors"
        lr_f = shards / "layers_00_07.safetensors"
        save_file(
            {
                "model.language_model.norm.weight.delta": torch.zeros(8, dtype=torch.bfloat16),
                "model.language_model.norm.weight.bfl": torch.ones(8, dtype=torch.bfloat16),
            },
            str(exact_f),
        )
        if include_lowrank_file:
            save_file(
                {
                    "model.language_model.layers.0.linear_attn.out_proj.weight.lora_B": torch.ones(8, 4, dtype=torch.bfloat16),
                    "model.language_model.layers.0.linear_attn.out_proj.weight.lora_A": torch.ones(4, 8, dtype=torch.bfloat16),
                },
                str(lr_f),
            )
        manifest = {
            "schema": "kaminos.bfl-pup.delta-adapter.v1",
            "max_rank": 4,
            "min_lora_dim": 8,
            "shards": {
                "exact_small": {
                    "file": "shards/exact_small.safetensors",
                    "sha256": hashlib.sha256(exact_f.read_bytes()).hexdigest(),
                    "size_bytes": exact_f.stat().st_size,
                    "tensor_stats": {"model.language_model.norm.weight": {"mode": "exact", "shape": [8]}},
                },
                "layers_00_07": {
                    "file": "shards/layers_00_07.safetensors",
                    "sha256": hashlib.sha256(lr_f.read_bytes()).hexdigest() if include_lowrank_file else "0" * 64,
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

            # PUP-CONF-04: valid JSON config with invalid optional max_tokens must write status='failed' report
            bad_opt_cfg = root / "bad_opt_config.json"
            bad_opt_report = root / "bad_opt_report.json"
            bad_opt_cfg.write_text(
                json.dumps(
                    {
                        "model_dir": str(root / "missing"),
                        "adapter_dir": str(root / "missing"),
                        "modes": [{"name": "off", "enabled": False, "rank": 0}],
                        "cases": [{"id": "t2i", "task": "t2i", "prompt": "test"}],
                        "max_tokens": "invalid",
                    }
                )
            )
            proc_opt = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "models" / "bfl-pup" / "evaluate_switchable_mlx.py"),
                    "--config",
                    str(bad_opt_cfg),
                    "--report",
                    str(bad_opt_report),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(proc_opt.returncode, 0)
            self.assertTrue(bad_opt_report.exists())
            opt_data = json.loads(bad_opt_report.read_text())
            self.assertEqual(opt_data["status"], "failed")
            self.assertIn("invalid literal for int()", opt_data.get("error", ""))

    def test_strict_completeness_requires_expected_counts_and_nonempty_modes_cases_and_provenance(self):
        import hashlib
        import torch
        from safetensors.torch import save_file
        from evaluate_switchable_mlx import inspect_model_dir_provenance, run_switchable_evaluation, validate_adapter_complete

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter_dir = root / "adapter_counts"
            shards = adapter_dir / "shards"
            shards.mkdir(parents=True)
            exact_f = shards / "exact_small.safetensors"
            lr_f = shards / "layers_00_03.safetensors"
            save_file(
                {
                    "model.language_model.norm.weight.delta": torch.zeros(8, dtype=torch.bfloat16),
                    "model.language_model.norm.weight.bfl": torch.ones(8, dtype=torch.bfloat16),
                },
                str(exact_f),
            )
            save_file(
                {
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_B": torch.ones(8, 4, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_A": torch.ones(4, 8, dtype=torch.bfloat16),
                },
                str(lr_f),
            )

            base_manifest = {
                "schema": "kaminos.bfl-pup.delta-adapter.v1",
                "complete": True,
                "max_rank": 4,
                "min_lora_dim": 8,
                "expected_shard_groups": ["exact_small", "layers_00_03"],
                "expected_exact_count": 1,
                "expected_lowrank_count": 1,
                "shards": {
                    "exact_small": {
                        "file": "shards/exact_small.safetensors",
                        "sha256": hashlib.sha256(exact_f.read_bytes()).hexdigest(),
                        "size_bytes": exact_f.stat().st_size,
                        "expected_keys": ["model.language_model.norm.weight"],
                        "tensor_stats": {"model.language_model.norm.weight": {"mode": "exact", "shape": [8]}},
                    },
                    "layers_00_03": {
                        "file": "shards/layers_00_03.safetensors",
                        "sha256": hashlib.sha256(lr_f.read_bytes()).hexdigest(),
                        "size_bytes": lr_f.stat().st_size,
                        "expected_keys": ["model.language_model.layers.0.self_attn.q_proj.weight"],
                        "tensor_stats": {
                            "model.language_model.layers.0.self_attn.q_proj.weight": {
                                "mode": "lowrank_svd",
                                "shape": [8, 8],
                                "rank": 4,
                            }
                        },
                    },
                },
            }

            # PUP-CONF-02: missing expected_exact_count or expected_lowrank_count in strict mode must fail
            for missing_key in ("expected_exact_count", "expected_lowrank_count"):
                m_bad = dict(base_manifest)
                del m_bad[missing_key]
                (adapter_dir / "manifest.json").write_text(json.dumps(m_bad))
                with self.assertRaisesRegex(RuntimeError, missing_key):
                    validate_adapter_complete(adapter_dir, allow_partial=False)

            # Restore valid manifest
            (adapter_dir / "manifest.json").write_text(json.dumps(base_manifest))
            valid_summary = validate_adapter_complete(adapter_dir, allow_partial=False)
            self.assertTrue(valid_summary["complete"])

            # PUP-CONF-03: empty modes or empty cases must fail before model loading
            with self.assertRaisesRegex(ValueError, "modes must be a non-empty list"):
                run_switchable_evaluation(
                    model_dir=root / "nonexistent-model",
                    adapter_dir=adapter_dir,
                    report_path=root / "empty_modes.json",
                    base_role="qwen",
                    modes=[],
                    cases=[{"id": "t2i", "task": "t2i", "prompt": "A kettle"}],
                )
            with self.assertRaisesRegex(ValueError, "cases must be a non-empty list"):
                run_switchable_evaluation(
                    model_dir=root / "nonexistent-model",
                    adapter_dir=adapter_dir,
                    report_path=root / "empty_cases.json",
                    base_role="qwen",
                    modes=[{"name": "off", "enabled": False, "rank": 0}],
                    cases=[],
                )

            # PUP-CONF-01: BFL checkpoint provenance passed with base_role='qwen' must be rejected
            bfl_model_dir = root / "flux-3-image-klein-pup-q4"
            bfl_model_dir.mkdir()
            (bfl_model_dir / "config.json").write_text(json.dumps({"model_type": "qwen3_5"}))
            (bfl_model_dir / "README.md").write_text("base_model: black-forest-labs/flux-3-image-klein-pup\n")
            with self.assertRaisesRegex(RuntimeError, "contradicts requested base_role='qwen'"):
                inspect_model_dir_provenance(bfl_model_dir, base_role="qwen")

    def test_r2_01_mlx_offset_norm_exact_reconstruction_uses_sanitized_bfl_weights(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock, patch
        import torch
        from safetensors.torch import save_file
        from mlx_switchable_adapter import MLXSwitchableDeltaController

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter_dir = root / "adapter_norm"
            shards_dir = adapter_dir / "shards"
            shards_dir.mkdir(parents=True)

            qwen_hf_bf16 = torch.tensor([0.10009765625], dtype=torch.bfloat16)
            bfl_hf_bf16 = torch.tensor([-0.10009765625], dtype=torch.bfloat16)
            delta_bf16 = (bfl_hf_bf16.float() - qwen_hf_bf16.float()).to(torch.bfloat16)
            resident_qwen_sanitized = (qwen_hf_bf16.float() + 1.0).to(torch.bfloat16)
            expected_bfl_sanitized = (bfl_hf_bf16.float() + 1.0).to(torch.bfloat16)
            self.assertEqual(float(resident_qwen_sanitized.item()), 1.1015625)
            self.assertEqual(float(expected_bfl_sanitized.item()), 0.8984375)

            exact_file = shards_dir / "exact_small.safetensors"
            save_file(
                {
                    "model.language_model.norm.weight.delta": delta_bf16,
                    "model.language_model.norm.weight.bfl": bfl_hf_bf16,
                },
                str(exact_file),
            )
            import hashlib

            manifest = {
                "schema": "kaminos.bfl-pup-delta-manifest.v1",
                "complete": True,
                "max_rank": 4,
                "min_lora_dim": 8,
                "shards": {
                    "exact_small": {
                        "file": "shards/exact_small.safetensors",
                        "sha256": hashlib.sha256(exact_file.read_bytes()).hexdigest(),
                        "size_bytes": exact_file.stat().st_size,
                        "expected_keys": ["model.language_model.norm.weight"],
                        "tensor_stats": {"model.language_model.norm.weight": {"mode": "exact", "shape": [1]}},
                    }
                },
            }
            (adapter_dir / "manifest.json").write_text(json.dumps(manifest))

            class TorchArrayProxy:
                def __init__(self, t: torch.Tensor):
                    self.t = t
                    self.dtype = t.dtype
                    self.ndim = t.ndim
                    self.shape = tuple(t.shape)

                def astype(self, dt):
                    return TorchArrayProxy(self.t.to(dt))

                def __add__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t + o)

                def __sub__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t - o)

                def __mul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t * o)

                def item(self):
                    return float(self.t.item())

            fake_mx = SimpleNamespace(
                array=TorchArrayProxy,
                float32=torch.float32,
                bfloat16=torch.bfloat16,
                load=lambda _p: {
                    "model.language_model.norm.weight.delta": TorchArrayProxy(delta_bf16),
                    "model.language_model.norm.weight.bfl": TorchArrayProxy(bfl_hf_bf16),
                },
                sqrt=lambda x: TorchArrayProxy(torch.sqrt(x.t)),
                sum=lambda x: TorchArrayProxy(torch.sum(x.t)),
                eval=lambda *_args: None,
            )
            fake_nn = SimpleNamespace(Module=object)
            fake_model = SimpleNamespace(
                language_model=SimpleNamespace(
                    model=SimpleNamespace(norm=SimpleNamespace(weight=TorchArrayProxy(resident_qwen_sanitized)))
                )
            )

            with patch.dict(sys.modules, {"mlx": SimpleNamespace(core=fake_mx, nn=fake_nn), "mlx.core": fake_mx, "mlx.nn": fake_nn}):
                ctrl = MLXSwitchableDeltaController(fake_model, adapter_dir, base_role="qwen")
                ctrl.set_mode(enabled=True, rank=4)
                switched_val = fake_model.language_model.model.norm.weight.item()
                self.assertEqual(switched_val, 0.8984375)
                ctrl.set_mode(enabled=False)
                restored_val = fake_model.language_model.model.norm.weight.item()
                self.assertEqual(restored_val, 1.1015625)

    def test_r2_02_strict_validator_checks_recorded_sha256_and_safetensors_headers(self):
        import hashlib
        import torch
        from safetensors.torch import save_file
        from evaluate_switchable_mlx import validate_adapter_complete

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter_dir = root / "adapter_sha"
            shards_dir = adapter_dir / "shards"
            shards_dir.mkdir(parents=True)
            exact_file = shards_dir / "exact_small.safetensors"
            lr_file = shards_dir / "layers_00_03.safetensors"
            save_file(
                {
                    "model.language_model.norm.weight.delta": torch.zeros(8, dtype=torch.bfloat16),
                    "model.language_model.norm.weight.bfl": torch.ones(8, dtype=torch.bfloat16),
                },
                str(exact_file),
            )
            save_file(
                {
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_B": torch.ones(8, 4, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_A": torch.ones(4, 8, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.singular_values": torch.ones(4, dtype=torch.float32),
                },
                str(lr_file),
            )

            exact_sha = hashlib.sha256(exact_file.read_bytes()).hexdigest()
            lr_sha = hashlib.sha256(lr_file.read_bytes()).hexdigest()
            manifest_sha = {
                "schema": "kaminos.bfl-pup-delta-manifest.v1",
                "complete": True,
                "max_rank": 4,
                "min_lora_dim": 8,
                "expected_shard_groups": ["exact_small", "layers_00_03"],
                "expected_exact_count": 1,
                "expected_lowrank_count": 1,
                "shards": {
                    "exact_small": {
                        "file": "shards/exact_small.safetensors",
                        "sha256": exact_sha,
                        "size_bytes": exact_file.stat().st_size,
                        "expected_keys": ["model.language_model.norm.weight"],
                        "tensor_stats": {"model.language_model.norm.weight": {"mode": "exact", "shape": [8]}},
                    },
                    "layers_00_03": {
                        "file": "shards/layers_00_03.safetensors",
                        "sha256": lr_sha,
                        "size_bytes": lr_file.stat().st_size,
                        "expected_keys": ["model.language_model.layers.0.self_attn.q_proj.weight"],
                        "tensor_stats": {
                            "model.language_model.layers.0.self_attn.q_proj.weight": {
                                "mode": "lowrank_svd",
                                "shape": [8, 8],
                                "rank": 4,
                            }
                        },
                    },
                },
            }
            (adapter_dir / "manifest.json").write_text(json.dumps(manifest_sha, indent=2))
            self.assertTrue(validate_adapter_complete(adapter_dir, allow_partial=False)["complete"])

            # Modify layers_00_03.safetensors (zero lora_B, valid safetensors) without updating manifest SHA-256
            save_file(
                {
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_B": torch.zeros(8, 4, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_A": torch.ones(4, 8, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.singular_values": torch.ones(4, dtype=torch.float32),
                },
                str(lr_file),
            )
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                validate_adapter_complete(adapter_dir, allow_partial=False)

    def test_r2_03_strict_booleans_reject_string_false_coercion(self):
        import subprocess
        from evaluate_switchable_mlx import run_switchable_evaluation

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for bad_kwargs, expected_field in [
                ({"allow_bfl_residual_approx": "false"}, "allow_bfl_residual_approx"),
                ({"allow_partial_adapter": "false"}, "allow_partial_adapter"),
                ({"modes": [{"name": "off", "enabled": "false", "rank": 0}]}, "modes\\[0\\]\\.enabled"),
            ]:
                call_kwargs = {
                    "model_dir": root / "missing_model",
                    "adapter_dir": root / "missing_adapter",
                    "report_path": root / "bool_reject.json",
                    "base_role": "bfl" if "allow_bfl_residual_approx" in bad_kwargs else "qwen",
                    "modes": [{"name": "off", "enabled": False, "rank": 0}],
                    "cases": [{"id": "t2i", "task": "t2i", "prompt": "test"}],
                }
                call_kwargs.update(bad_kwargs)
                with self.assertRaisesRegex(ValueError, expected_field):
                    run_switchable_evaluation(**call_kwargs)
                rep_bool = json.loads((root / "bool_reject.json").read_text())
                self.assertEqual(rep_bool["status"], "failed")
                self.assertEqual(rep_bool["failure_phase"], "config-validation")

            cli_bool_cfg = root / "cli_bool_cfg.json"
            cli_bool_rep = root / "cli_bool_rep.json"
            cli_bool_cfg.write_text(
                json.dumps(
                    {
                        "model_dir": str(root / "missing"),
                        "adapter_dir": str(root / "missing_adapter"),
                        "base_role": "bfl",
                        "allow_bfl_residual_approx": "false",
                        "modes": [{"name": "off", "enabled": False, "rank": 0}],
                        "cases": [{"id": "t2i", "task": "t2i", "prompt": "test"}],
                    }
                )
            )
            proc_bool = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "models" / "bfl-pup" / "evaluate_switchable_mlx.py"),
                    "--config",
                    str(cli_bool_cfg),
                    "--report",
                    str(cli_bool_rep),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(proc_bool.returncode, 0)
            rep_cli = json.loads(cli_bool_rep.read_text())
            self.assertEqual(rep_cli["status"], "failed")
            self.assertEqual(rep_cli["failure_phase"], "cli-config-load")

    def test_r2_04_rejected_or_interrupted_generation_retains_attempted_observations(self):
        import hashlib
        from types import SimpleNamespace
        from unittest.mock import MagicMock, patch
        import torch
        from safetensors.torch import save_file
        from evaluate_switchable_mlx import run_switchable_evaluation

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            adapter_dir = root / "adapter_obs"
            shards_dir = adapter_dir / "shards"
            shards_dir.mkdir(parents=True)
            exact_file = shards_dir / "exact_small.safetensors"
            lr_file = shards_dir / "layers_00_03.safetensors"
            save_file(
                {
                    "model.language_model.norm.weight.delta": torch.zeros(8, dtype=torch.bfloat16),
                    "model.language_model.norm.weight.bfl": torch.ones(8, dtype=torch.bfloat16),
                },
                str(exact_file),
            )
            save_file(
                {
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_B": torch.ones(8, 4, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.lora_A": torch.ones(4, 8, dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight.singular_values": torch.ones(4, dtype=torch.float32),
                },
                str(lr_file),
            )
            manifest = {
                "schema": "kaminos.bfl-pup-delta-manifest.v1",
                "complete": True,
                "max_rank": 4,
                "min_lora_dim": 8,
                "expected_shard_groups": ["exact_small", "layers_00_03"],
                "expected_exact_count": 1,
                "expected_lowrank_count": 1,
                "shards": {
                    "exact_small": {
                        "file": "shards/exact_small.safetensors",
                        "sha256": hashlib.sha256(exact_file.read_bytes()).hexdigest(),
                        "size_bytes": exact_file.stat().st_size,
                        "expected_keys": ["model.language_model.norm.weight"],
                        "tensor_stats": {"model.language_model.norm.weight": {"mode": "exact", "shape": [8]}},
                    },
                    "layers_00_03": {
                        "file": "shards/layers_00_03.safetensors",
                        "sha256": hashlib.sha256(lr_file.read_bytes()).hexdigest(),
                        "size_bytes": lr_file.stat().st_size,
                        "expected_keys": ["model.language_model.layers.0.self_attn.q_proj.weight"],
                        "tensor_stats": {
                            "model.language_model.layers.0.self_attn.q_proj.weight": {
                                "mode": "lowrank_svd",
                                "shape": [8, 8],
                                "rank": 4,
                            }
                        },
                    },
                },
            }
            (adapter_dir / "manifest.json").write_text(json.dumps(manifest))

            qwen_model_dir = root / "qwen3.5-9b"
            qwen_model_dir.mkdir()
            (qwen_model_dir / "config.json").write_text(json.dumps({"model_type": "qwen3_5"}))
            (qwen_model_dir / "system_prompts.json").write_text(json.dumps({"t2i": "sys t2i", "i2i": "sys i2i"}))
            save_file(
                {"model.language_model.norm.weight": torch.ones(8, dtype=torch.bfloat16)},
                str(qwen_model_dir / "model.safetensors"),
            )

            fake_mx = MagicMock()
            fake_mx.metal.is_available.return_value = True
            fake_ctrl = SimpleNamespace(
                attached_lowrank_count=1,
                attached_exact_count=1,
                effective_model_semantics="qwen_resident_exact_target",
                _wrapped_modules=[("p", "a", "m")],
                _exact_array_swaps=[("p", "a", "q", "b")],
                max_rank=4,
                state_epoch=1,
                set_mode=lambda **_kw: {
                    "enabled": True,
                    "rank": 4,
                    "state_epoch": 1,
                    "reset_performed": True,
                    "effective_model_semantics": "qwen_resident_exact_target",
                },
                assert_cache_epoch=lambda _ep: None,
            )
            fake_ctrl_cls = lambda *_a, **_kw: fake_ctrl

            fake_processor = MagicMock()
            fake_processor.tokenizer.convert_tokens_to_ids.return_value = 151645
            fake_processor.tokenizer.apply_chat_template.return_value = "<prompt>"

            def fake_stream_length(*_args, **_kwargs):
                yield SimpleNamespace(
                    text="Truncated expansion text that hit max_tokens",
                    prompt_tokens=20,
                    generation_tokens=64,
                    peak_memory=6.5,
                    finish_reason="length",
                )

            fake_mlx_vlm = MagicMock()
            fake_mlx_vlm.load.return_value = (MagicMock(), fake_processor)
            fake_mlx_vlm.stream_generate = fake_stream_length

            rep_len_path = root / "rep_length.json"
            with patch.dict(
                sys.modules,
                {
                    "mlx": MagicMock(core=fake_mx),
                    "mlx.core": fake_mx,
                    "mlx_vlm": fake_mlx_vlm,
                },
            ), patch("mlx_switchable_adapter.MLXSwitchableDeltaController", fake_ctrl_cls), patch(
                "evaluate_switchable_mlx.version", return_value="0.0.0-test"
            ):
                with self.assertRaisesRegex(RuntimeError, "Non-terminal finish_reason: 'length'"):
                    run_switchable_evaluation(
                        model_dir=qwen_model_dir,
                        adapter_dir=adapter_dir,
                        report_path=rep_len_path,
                        base_role="qwen",
                        modes=[{"name": "on_r4", "enabled": True, "rank": 4}],
                        cases=[{"id": "c1", "task": "t2i", "prompt": "A brass lantern"}],
                    )
            rep_len = json.loads(rep_len_path.read_text())
            self.assertEqual(rep_len["status"], "failed")
            self.assertEqual(rep_len["observations"], [])
            self.assertEqual(len(rep_len.get("attempted_observations", [])), 1)
            self.assertEqual(
                rep_len["attempted_observations"][0]["output"],
                "Truncated expansion text that hit max_tokens",
            )
            self.assertEqual(rep_len["attempted_observations"][0]["finish_reason"], "length")
            self.assertFalse(rep_len["attempted_observations"][0]["accepted"])

            def fake_stream_crash(*_args, **_kwargs):
                yield SimpleNamespace(
                    text="Partial stream text before crash",
                    prompt_tokens=20,
                    generation_tokens=5,
                    peak_memory=6.5,
                    finish_reason=None,
                )
                raise RuntimeError("Simulated mid-stream error")

            fake_mlx_vlm.stream_generate = fake_stream_crash
            rep_crash_path = root / "rep_crash.json"
            with patch.dict(
                sys.modules,
                {
                    "mlx": MagicMock(core=fake_mx),
                    "mlx.core": fake_mx,
                    "mlx_vlm": fake_mlx_vlm,
                },
            ), patch("mlx_switchable_adapter.MLXSwitchableDeltaController", fake_ctrl_cls), patch(
                "evaluate_switchable_mlx.version", return_value="0.0.0-test"
            ):
                with self.assertRaisesRegex(RuntimeError, "Simulated mid-stream error"):
                    run_switchable_evaluation(
                        model_dir=qwen_model_dir,
                        adapter_dir=adapter_dir,
                        report_path=rep_crash_path,
                        base_role="qwen",
                        modes=[{"name": "on_r4", "enabled": True, "rank": 4}],
                        cases=[{"id": "c1", "task": "t2i", "prompt": "A brass lantern"}],
                    )
            rep_crash = json.loads(rep_crash_path.read_text())
            self.assertEqual(rep_crash["status"], "failed")
            self.assertEqual(rep_crash["observations"], [])
            self.assertEqual(len(rep_crash.get("attempted_observations", [])), 1)
            self.assertEqual(
                rep_crash["attempted_observations"][0]["raw_output"],
                "Partial stream text before crash",
            )
            self.assertEqual(rep_crash["attempted_observations"][0]["stream_error"], "Simulated mid-stream error")

    def test_rejects_blank_or_non_stop_generation_as_false_closure(self):
        from evaluate_switchable_mlx import validate_generation_observation

        with self.assertRaisesRegex(RuntimeError, "Empty generation output"):
            validate_generation_observation({"output": "   ", "finish_reason": "stop", "effective_backend": "mlx-metal"})

        with self.assertRaisesRegex(RuntimeError, "Non-terminal finish_reason"):
            validate_generation_observation({"output": "Partial caption", "finish_reason": "length", "effective_backend": "mlx-metal"})

        with self.assertRaisesRegex(RuntimeError, "Unexpected effective_backend"):
            validate_generation_observation({"output": "Caption", "finish_reason": "stop", "effective_backend": "cpu"})

    def test_r3_01_mlx_2d_exact_linear_reconstructs_saved_bfl_under_cancellation(self):
        import hashlib
        from types import SimpleNamespace
        from unittest.mock import patch
        import torch
        from safetensors import safe_open
        from safetensors.torch import save_file
        from extract_delta_adapter import run_extraction
        from mlx_switchable_adapter import MLXSwitchableDeltaController
        from switchable_adapter import SwitchableDeltaController

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir = root / "bfl"
            qwen_dir = root / "qwen"
            out_dir = root / "adapter"
            bfl_dir.mkdir()
            qwen_dir.mkdir()

            qwen_small_w = torch.tensor([[1.0]], dtype=torch.bfloat16)
            bfl_small_w = torch.tensor([[0.00099945068359375]], dtype=torch.bfloat16)
            vis_w = torch.ones((4, 4), dtype=torch.bfloat16)
            proj_q = torch.eye(8, dtype=torch.bfloat16)
            proj_b = (proj_q.float() + 0.25 * torch.ones((8, 8), dtype=torch.float32)).to(torch.bfloat16)

            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.layers.0.linear_attn.in_proj_a.weight": qwen_small_w,
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_q,
                },
                str(qwen_dir / "model.safetensors"),
            )
            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.layers.0.linear_attn.in_proj_a.weight": bfl_small_w,
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_b,
                },
                str(bfl_dir / "model.safetensors"),
            )

            run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=root / "extract_rep.json",
                device="cpu",
                max_rank=2,
                min_lora_dim=4,
                oversample=2,
                niter=2,
                resume=False,
            )

            class TorchArrayProxy:
                def __init__(self, t: torch.Tensor):
                    self.t = t
                    self.dtype = t.dtype
                    self.ndim = t.ndim
                    self.shape = tuple(t.shape)

                def astype(self, dt):
                    return TorchArrayProxy(self.t.to(dt))

                def __matmul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t @ o)

                def __add__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t + o)

                def __sub__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t - o)

                def __mul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t * o)

                def __getitem__(self, idx):
                    if isinstance(idx, tuple):
                        idx = tuple(i.t if isinstance(i, TorchArrayProxy) else i for i in idx)
                    elif isinstance(idx, TorchArrayProxy):
                        idx = idx.t
                    return TorchArrayProxy(self.t[idx])

                def item(self):
                    return float(self.t.item())

            def load_sf(p: str):
                out = {}
                with safe_open(p, framework="pt") as sf:
                    for k in sf.keys():
                        out[k] = TorchArrayProxy(sf.get_tensor(k))
                return out

            fake_mx = SimpleNamespace(
                array=TorchArrayProxy,
                float32=torch.float32,
                bfloat16=torch.bfloat16,
                load=load_sf,
                transpose=lambda a: TorchArrayProxy(a.t.T.contiguous()),
                sqrt=lambda x: TorchArrayProxy(torch.sqrt(x.t)),
                sum=lambda x: TorchArrayProxy(torch.sum(x.t)),
                eval=lambda *_args: None,
            )
            fake_nn = SimpleNamespace(Module=object)

            class DummyLinear:
                def __init__(self, w: torch.Tensor):
                    self.weight = TorchArrayProxy(w.clone())
                    self.bias = None

                def __call__(self, x: TorchArrayProxy) -> TorchArrayProxy:
                    return TorchArrayProxy((x.t.float() @ self.weight.t.float().T).to(x.dtype))

            fake_model = SimpleNamespace(
                language_model=SimpleNamespace(
                    model=SimpleNamespace(
                        layers=[
                            SimpleNamespace(
                                linear_attn=SimpleNamespace(in_proj_a=DummyLinear(qwen_small_w)),
                                self_attn=SimpleNamespace(q_proj=DummyLinear(proj_q)),
                            )
                        ]
                    )
                )
            )

            with patch.dict(
                sys.modules,
                {"mlx": SimpleNamespace(core=fake_mx, nn=fake_nn), "mlx.core": fake_mx, "mlx.nn": fake_nn},
            ):
                ctrl = MLXSwitchableDeltaController(fake_model, out_dir, base_role="qwen")
                x_in = TorchArrayProxy(torch.tensor([[1.0]], dtype=torch.bfloat16))
                ctrl.set_mode(enabled=True, rank=2)
                y_on = fake_model.language_model.model.layers[0].linear_attn.in_proj_a(x_in).item()
                self.assertEqual(y_on, float(bfl_small_w.item()))
                ctrl.set_mode(enabled=False)
                y_off = fake_model.language_model.model.layers[0].linear_attn.in_proj_a(x_in).item()
                self.assertEqual(y_off, float(qwen_small_w.item()))

    def test_r3_conf_01_rejects_unrelated_qwen_weights_and_unverified_model_dir_provenance(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        import torch
        from safetensors import safe_open
        from safetensors.torch import save_file
        from evaluate_switchable_mlx import inspect_model_dir_provenance, run_switchable_evaluation
        from extract_delta_adapter import run_extraction
        from mlx_switchable_adapter import MLXSwitchableDeltaController

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir = root / "bfl"
            qwen_dir = root / "qwen"
            out_dir = root / "adapter"
            bfl_dir.mkdir()
            qwen_dir.mkdir()

            vis_w = torch.ones((4, 4), dtype=torch.bfloat16)
            norm_q = torch.tensor([1.0], dtype=torch.bfloat16)
            norm_b = torch.tensor([2.0], dtype=torch.bfloat16)
            proj_q = torch.ones((4, 4), dtype=torch.bfloat16)
            proj_b = torch.full((4, 4), 1.5, dtype=torch.bfloat16)

            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.norm.weight": norm_q,
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_q,
                },
                str(qwen_dir / "model.safetensors"),
            )
            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.norm.weight": norm_b,
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_b,
                },
                str(bfl_dir / "model.safetensors"),
            )

            run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=root / "extract_rep.json",
                device="cpu",
                max_rank=2,
                min_lora_dim=4,
                oversample=2,
                niter=2,
                resume=False,
            )

            class TorchArrayProxy:
                def __init__(self, t: torch.Tensor):
                    self.t = t
                    self.dtype = t.dtype
                    self.ndim = t.ndim
                    self.shape = tuple(t.shape)

                def astype(self, dt):
                    return TorchArrayProxy(self.t.to(dt))

                def __matmul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t @ o)

                def __add__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t + o)

                def __sub__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t - o)

                def __mul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t * o)

                def __getitem__(self, idx):
                    if isinstance(idx, tuple):
                        idx = tuple(i.t if isinstance(i, TorchArrayProxy) else i for i in idx)
                    elif isinstance(idx, TorchArrayProxy):
                        idx = idx.t
                    return TorchArrayProxy(self.t[idx])

                def item(self):
                    return float(self.t.item())

            def load_sf(p: str):
                out = {}
                with safe_open(p, framework="pt") as sf:
                    for k in sf.keys():
                        out[k] = TorchArrayProxy(sf.get_tensor(k))
                return out

            fake_mx = SimpleNamespace(
                array=TorchArrayProxy,
                float32=torch.float32,
                bfloat16=torch.bfloat16,
                load=load_sf,
                transpose=lambda a: TorchArrayProxy(a.t.T.contiguous()),
                sqrt=lambda x: TorchArrayProxy(torch.sqrt(x.t)),
                sum=lambda x: TorchArrayProxy(torch.sum(x.t)),
                eval=lambda *_args: None,
            )
            fake_nn = SimpleNamespace(Module=object)

            class DummyLinear:
                def __init__(self, w: torch.Tensor):
                    self.weight = TorchArrayProxy(w.clone())
                    self.bias = None

                def __call__(self, x: TorchArrayProxy) -> TorchArrayProxy:
                    return TorchArrayProxy((x.t.float() @ self.weight.t.float().T).to(x.dtype))

            # Case 1: Resident norm is -100.0 (closer to Qwen 1.0 than BFL 2.0, but unrelated) -> must reject
            bad_norm_model = SimpleNamespace(
                language_model=SimpleNamespace(
                    model=SimpleNamespace(
                        norm=SimpleNamespace(weight=TorchArrayProxy(torch.tensor([-100.0], dtype=torch.bfloat16))),
                        layers=[SimpleNamespace(self_attn=SimpleNamespace(q_proj=DummyLinear(proj_q)))],
                    )
                )
            )
            with patch.dict(
                sys.modules,
                {"mlx": SimpleNamespace(core=fake_mx, nn=fake_nn), "mlx.core": fake_mx, "mlx.nn": fake_nn},
            ):
                with self.assertRaisesRegex(ValueError, "does not match expected qwen"):
                    MLXSwitchableDeltaController(bad_norm_model, out_dir, base_role="qwen")

            # Case 2: Resident norm matches sanitized Qwen (1.0 + 1.0 = 2.0), but projection[0,0] is 51.0 -> must reject
            bad_proj_w = proj_q.clone()
            bad_proj_w[0, 0] = 51.0
            bad_proj_model = SimpleNamespace(
                language_model=SimpleNamespace(
                    model=SimpleNamespace(
                        norm=SimpleNamespace(weight=TorchArrayProxy(torch.tensor([2.0], dtype=torch.bfloat16))),
                        layers=[SimpleNamespace(self_attn=SimpleNamespace(q_proj=DummyLinear(bad_proj_w)))],
                    )
                )
            )
            with patch.dict(
                sys.modules,
                {"mlx": SimpleNamespace(core=fake_mx, nn=fake_nn), "mlx.core": fake_mx, "mlx.nn": fake_nn},
            ):
                with self.assertRaisesRegex(ValueError, "does not match expected qwen"):
                    MLXSwitchableDeltaController(bad_proj_model, out_dir, base_role="qwen")

            # Case 3a: Unrelated directory with ordinary qwen3_5 config (no safetensors) must fail provenance-validation
            unrelated_dir = root / "unrelated_qwen3_5"
            unrelated_dir.mkdir()
            (unrelated_dir / "config.json").write_text(json.dumps({"model_type": "qwen3_5"}))
            rep_unrel = root / "rep_unrelated.json"
            with self.assertRaisesRegex(RuntimeError, "provenance"):
                run_switchable_evaluation(
                    model_dir=unrelated_dir,
                    adapter_dir=out_dir,
                    report_path=rep_unrel,
                    base_role="qwen",
                    modes=[{"name": "off", "enabled": False, "rank": 0}],
                    cases=[{"id": "c1", "task": "t2i", "prompt": "test"}],
                )
            rep_data = json.loads(rep_unrel.read_text())
            self.assertEqual(rep_data["status"], "failed")
            self.assertEqual(rep_data["failure_phase"], "provenance-validation")

            # Case 3b: Unrelated directory with matching safetensors header schema but unrelated weights must also fail provenance-validation
            unrelated_sf_dir = root / "unrelated_qwen3_5_with_sf"
            unrelated_sf_dir.mkdir()
            (unrelated_sf_dir / "config.json").write_text(json.dumps({"model_type": "qwen3_5"}))
            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.norm.weight": torch.tensor([-100.0], dtype=torch.bfloat16),
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_q,
                },
                str(unrelated_sf_dir / "model.safetensors"),
            )
            rep_unrel_sf = root / "rep_unrelated_sf.json"
            with self.assertRaisesRegex(RuntimeError, "provenance"):
                run_switchable_evaluation(
                    model_dir=unrelated_sf_dir,
                    adapter_dir=out_dir,
                    report_path=rep_unrel_sf,
                    base_role="qwen",
                    modes=[{"name": "off", "enabled": False, "rank": 0}],
                    cases=[{"id": "c1", "task": "t2i", "prompt": "test"}],
                )
            rep_sf_data = json.loads(rep_unrel_sf.read_text())
            self.assertEqual(rep_sf_data["status"], "failed")
            self.assertEqual(rep_sf_data["failure_phase"], "provenance-validation")

    def test_r4_01_mlx_memory_and_module_wrapping_safety(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        import torch
        from safetensors import safe_open
        from safetensors.torch import save_file
        from extract_delta_adapter import run_extraction
        from mlx_switchable_adapter import MLXSwitchableDeltaController

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir = root / "bfl"
            qwen_dir = root / "qwen"
            out_dir = root / "adapter"
            bfl_dir.mkdir()
            qwen_dir.mkdir()

            vis_w = torch.ones((4, 4), dtype=torch.bfloat16)
            norm_q = torch.tensor([1.0, 1.0, 1.0, 1.0], dtype=torch.bfloat16)
            norm_b = torch.tensor([1.5, 1.5, 1.5, 1.5], dtype=torch.bfloat16)
            small_q = torch.full((2, 4), 0.5, dtype=torch.bfloat16)
            small_b = torch.full((2, 4), 1.25, dtype=torch.bfloat16)
            proj_q = torch.ones((8, 4), dtype=torch.bfloat16)
            proj_b = torch.full((8, 4), 1.5, dtype=torch.bfloat16)
            emb_q = torch.ones((16, 4), dtype=torch.bfloat16)
            emb_b = torch.full((16, 4), 1.25, dtype=torch.bfloat16)

            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.norm.weight": norm_q,
                    "model.language_model.layers.0.linear_attn.in_proj_a.weight": small_q,
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_q,
                    "model.language_model.embed_tokens.weight": emb_q,
                },
                str(qwen_dir / "model.safetensors"),
            )
            save_file(
                {
                    "model.visual.blocks.0.attn.qkv.weight": vis_w,
                    "model.language_model.norm.weight": norm_b,
                    "model.language_model.layers.0.linear_attn.in_proj_a.weight": small_b,
                    "model.language_model.layers.0.self_attn.q_proj.weight": proj_b,
                    "model.language_model.embed_tokens.weight": emb_b,
                },
                str(bfl_dir / "model.safetensors"),
            )

            run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=root / "extract_rep.json",
                device="cpu",
                max_rank=2,
                min_lora_dim=4,
                oversample=2,
                niter=2,
                resume=False,
            )

            class FakeMLXModule(dict):
                """Mimics mlx.nn.Module: stores public attributes inside dict (self)."""

                def __setattr__(self, key, val):
                    if not key.startswith("_"):
                        self[key] = val
                    super().__setattr__(key, val)

            class TorchArrayProxy:
                def __init__(self, t: torch.Tensor):
                    self.t = t
                    self.dtype = t.dtype
                    self.ndim = t.ndim
                    self.shape = tuple(t.shape)

                def astype(self, dt):
                    return TorchArrayProxy(self.t.to(dt))

                def __matmul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t @ o)

                def __add__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t + o)

                def __sub__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t - o)

                def __mul__(self, other):
                    o = other.t if isinstance(other, TorchArrayProxy) else other
                    return TorchArrayProxy(self.t * o)

                def __getitem__(self, idx):
                    if isinstance(idx, tuple):
                        idx = tuple(i.t if isinstance(i, TorchArrayProxy) else i for i in idx)
                    elif isinstance(idx, TorchArrayProxy):
                        idx = idx.t
                    return TorchArrayProxy(self.t[idx])

                def item(self):
                    return float(self.t.item())

            def load_sf(p: str):
                out = {}
                with safe_open(p, framework="pt") as sf:
                    for k in sf.keys():
                        out[k] = TorchArrayProxy(sf.get_tensor(k))
                return out

            dequant_row_counts = []
            clear_cache_calls = []

            def fake_dequantize(w, scales, biases=None, group_size=64, bits=4):
                dequant_row_counts.append(w.shape[0])
                return w

            fake_mx = SimpleNamespace(
                array=TorchArrayProxy,
                float32=torch.float32,
                bfloat16=torch.bfloat16,
                load=load_sf,
                transpose=lambda a: TorchArrayProxy(a.t.T.contiguous()),
                sqrt=lambda x: TorchArrayProxy(torch.sqrt(x.t)),
                sum=lambda x: TorchArrayProxy(torch.sum(x.t)),
                eval=lambda *_args: None,
                dequantize=fake_dequantize,
                clear_cache=lambda: clear_cache_calls.append(1),
            )
            fake_nn = SimpleNamespace(Module=FakeMLXModule)

            class DummyQuantLinear(FakeMLXModule):
                def __init__(self, w: torch.Tensor):
                    super().__init__()
                    self.weight = TorchArrayProxy(w.clone())
                    self.scales = TorchArrayProxy(torch.ones((w.shape[0], 1), dtype=torch.bfloat16))
                    self.biases = TorchArrayProxy(torch.zeros((w.shape[0], 1), dtype=torch.bfloat16))
                    self.group_size = 64
                    self.bits = 4
                    self.bias = None

                def __call__(self, x: TorchArrayProxy) -> TorchArrayProxy:
                    return TorchArrayProxy((x.t.float() @ self.weight.t.float().T).to(x.dtype))

            class DummyQuantEmbedding(FakeMLXModule):
                def __init__(self, w: torch.Tensor):
                    super().__init__()
                    self.weight = TorchArrayProxy(w.clone())
                    self.scales = TorchArrayProxy(torch.ones((w.shape[0], 1), dtype=torch.bfloat16))
                    self.biases = TorchArrayProxy(torch.zeros((w.shape[0], 1), dtype=torch.bfloat16))
                    self.group_size = 64
                    self.bits = 4

                def __call__(self, x: TorchArrayProxy) -> TorchArrayProxy:
                    return TorchArrayProxy(self.weight.t[x.t])

                def as_linear(self, x: TorchArrayProxy) -> TorchArrayProxy:
                    return TorchArrayProxy((x.t.float() @ self.weight.t.float().T).to(x.dtype))

            norm_sanitized = TorchArrayProxy((norm_q.float() + 1.0).to(torch.bfloat16))
            orig_in_proj_a = DummyQuantLinear(small_q)
            orig_q_proj = DummyQuantLinear(proj_q)
            orig_embed = DummyQuantEmbedding(emb_q)

            fake_model = SimpleNamespace(
                language_model=SimpleNamespace(
                    model=SimpleNamespace(
                        norm=SimpleNamespace(weight=norm_sanitized),
                        embed_tokens=orig_embed,
                        layers=[
                            SimpleNamespace(
                                linear_attn=SimpleNamespace(in_proj_a=orig_in_proj_a),
                                self_attn=SimpleNamespace(q_proj=orig_q_proj),
                            )
                        ],
                    )
                )
            )

            with patch.dict(
                sys.modules,
                {"mlx": SimpleNamespace(core=fake_mx, nn=fake_nn), "mlx.core": fake_mx, "mlx.nn": fake_nn},
            ):
                ctrl = MLXSwitchableDeltaController(fake_model, out_dir, base_role="qwen")

                # 1. Quantized low-rank provenance must never dequantize full matrices (>1 row)
                # (only exact_small 2x4 or 1-row slices on lowrank_svd are dequantized)
                self.assertTrue(all(r <= 2 for r in dequant_row_counts), f"Full-matrix dequantize called: {dequant_row_counts}")
                self.assertGreaterEqual(len(clear_cache_calls), 2)

                # 2. In off mode (base_role='qwen', enabled=False), original unwrapped modules stay attached
                # so mlx_vlm's isinstance(m, nn.QuantizedLinear) fast path is preserved!
                self.assertIs(fake_model.language_model.model.layers[0].linear_attn.in_proj_a, orig_in_proj_a)
                self.assertIs(fake_model.language_model.model.layers[0].self_attn.q_proj, orig_q_proj)
                self.assertIs(fake_model.language_model.model.embed_tokens, orig_embed)

                # 3. Switching to enabled=True attaches the wrapper modules
                ctrl.set_mode(enabled=True, rank=2)
                wrapped_in_proj_a = fake_model.language_model.model.layers[0].linear_attn.in_proj_a
                wrapped_q_proj = fake_model.language_model.model.layers[0].self_attn.q_proj
                wrapped_embed = fake_model.language_model.model.embed_tokens
                self.assertIsNot(wrapped_in_proj_a, orig_in_proj_a)
                self.assertIsNot(wrapped_q_proj, orig_q_proj)
                self.assertIsNot(wrapped_embed, orig_embed)

                # 4. Wrapper modules must not register adapter tensors as mlx.nn.Module dict entries
                self.assertEqual(list(wrapped_in_proj_a.keys()), ["base"])
                self.assertEqual(list(wrapped_q_proj.keys()), ["base"])
                self.assertEqual(list(wrapped_embed.keys()), ["base"])

                # 5. Adapter tensors live on _holder in native bfloat16 without pre-transposed duplicate copies
                self.assertEqual(wrapped_q_proj._holder.lora_B.dtype, torch.bfloat16)
                self.assertEqual(wrapped_q_proj._holder.lora_A.dtype, torch.bfloat16)
                self.assertFalse(hasattr(wrapped_q_proj._holder, "lora_B_T"))
                self.assertFalse(hasattr(wrapped_embed._holder, "lora_B_T"))

                # Verify forward pass in bfloat16 works accurately in on mode
                x_in = TorchArrayProxy(torch.ones((1, 4), dtype=torch.bfloat16))
                y_exact = wrapped_in_proj_a(x_in)
                self.assertEqual(y_exact.dtype, torch.bfloat16)
                self.assertTrue(torch.allclose(y_exact.t.float(), torch.full((1, 2), 5.0), atol=1e-2))

                y_lora = wrapped_q_proj(x_in)
                self.assertEqual(y_lora.dtype, torch.bfloat16)
                self.assertTrue(torch.allclose(y_lora.t.float(), torch.full((1, 8), 6.0), atol=5e-2))

                tok_ids = TorchArrayProxy(torch.tensor([0, 1], dtype=torch.long))
                y_emb = wrapped_embed(tok_ids)
                self.assertEqual(y_emb.dtype, torch.bfloat16)
                self.assertTrue(torch.allclose(y_emb.t.float(), torch.full((2, 4), 1.25), atol=2e-2))

                y_lm = wrapped_embed.as_linear(x_in)
                self.assertEqual(y_lm.dtype, torch.bfloat16)
                self.assertTrue(torch.allclose(y_lm.t.float(), torch.full((1, 16), 5.0), atol=5e-2))

                # 6. Switching back to enabled=False restores the original unwrapped modules
                ctrl.set_mode(enabled=False)
                self.assertIs(fake_model.language_model.model.layers[0].linear_attn.in_proj_a, orig_in_proj_a)
                self.assertIs(fake_model.language_model.model.layers[0].self_attn.q_proj, orig_q_proj)
                self.assertIs(fake_model.language_model.model.embed_tokens, orig_embed)


if __name__ == "__main__":
    unittest.main()
