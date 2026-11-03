# kaminos-test: manual -- Local MLX switchable delta-adapter check; run with the MLX-VLM interpreter.
"""Fail-first unit tests for MLXSwitchableDeltaController (unquantized + 4-bit QuantizedLinear/Embedding + MLX norm/conv1d semantics + cache reset)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "models" / "bfl-pup"))


class FakeKVCache:
    def __init__(self):
        self.keys = mx.ones((1, 4, 8, 16))
        self.values = mx.ones((1, 4, 8, 16))
        self.offset = 8

    def reset(self):
        self.keys = None
        self.values = None
        self.offset = 0


class FakeArraysCache:
    def __init__(self):
        self.cache = [mx.ones((1, 3, 64)), mx.ones((1, 4, 16, 16))]

    def __getitem__(self, idx):
        return self.cache[idx]

    def __setitem__(self, idx, val):
        self.cache[idx] = val


class MiniMLXLinearAttn(nn.Module):
    def __init__(self, hidden: int = 64, heads: int = 8):
        super().__init__()
        self.conv1d = nn.Conv1d(in_channels=hidden, out_channels=hidden, kernel_size=4, groups=hidden, bias=False)
        self.in_proj_a = nn.Linear(hidden, heads, bias=False)
        self.in_proj_qkv = nn.Linear(hidden, hidden, bias=False)
        self.out_proj = nn.Linear(hidden, hidden, bias=False)
        self.A_log = mx.linspace(1.0, 2.0, heads).astype(mx.float32)
        self.dt_bias = mx.ones((heads,), dtype=mx.bfloat16)
        self.norm = nn.RMSNorm(hidden)

    def __call__(self, x: mx.array) -> mx.array:
        B, S, D = x.shape
        padded = mx.concatenate([mx.zeros((B, 3, D), dtype=x.dtype), x], axis=1)
        c = nn.silu(self.conv1d(padded))
        qkv = self.in_proj_qkv(c)
        a = self.in_proj_a(x).astype(mx.float32)
        gate = mx.sigmoid(a * mx.exp(self.A_log) + self.dt_bias.astype(mx.float32)).mean(axis=-1, keepdims=True)
        normed = self.norm(qkv) * (1.0 + gate.astype(x.dtype))
        return self.out_proj(normed)


class MiniMLXDecoderLayer(nn.Module):
    def __init__(self, hidden: int = 64, heads: int = 8):
        super().__init__()
        self.is_linear = True
        self.input_layernorm = nn.RMSNorm(hidden)
        self.post_attention_layernorm = nn.RMSNorm(hidden)
        self.linear_attn = MiniMLXLinearAttn(hidden=hidden, heads=heads)

    def __call__(self, x: mx.array) -> mx.array:
        h = x + self.linear_attn(self.input_layernorm(x))
        return h + self.post_attention_layernorm(h)


class MiniMLXTextCore(nn.Module):
    def __init__(self, vocab_size: int = 128, hidden: int = 64):
        super().__init__()
        self.embed_tokens = nn.Embedding(vocab_size, hidden)
        self.layers = [MiniMLXDecoderLayer(hidden=hidden, heads=8)]
        self.norm = nn.RMSNorm(hidden)

    def __call__(self, input_ids: mx.array) -> mx.array:
        h = self.embed_tokens(input_ids)
        for layer in self.layers:
            h = layer(h)
        return self.norm(h)


class MiniMLXLanguageModel(nn.Module):
    def __init__(self, vocab_size: int = 128, hidden: int = 64):
        super().__init__()
        self.model = MiniMLXTextCore(vocab_size=vocab_size, hidden=hidden)
        self.lm_head = nn.Linear(hidden, vocab_size, bias=False)
        self._position_ids = None
        self._rope_deltas = None

    @property
    def layers(self):
        return self.model.layers

    def __call__(self, input_ids: mx.array) -> mx.array:
        return self.lm_head(self.model(input_ids))


class MiniMLXVLM(nn.Module):
    def __init__(self, vocab_size: int = 128, hidden: int = 64):
        super().__init__()
        self.language_model = MiniMLXLanguageModel(vocab_size=vocab_size, hidden=hidden)

    def __call__(self, input_ids: mx.array) -> mx.array:
        return self.language_model(input_ids)


class TestMLXSwitchableAdapter(unittest.TestCase):
    def _build_fixture(self, root: Path):
        rng = np.random.default_rng(19)
        vocab_size, hidden, heads = 128, 64, 8

        qwen_hf = {
            "model.language_model.embed_tokens.weight": (rng.standard_normal((vocab_size, hidden)).astype(np.float32) * 0.1),
            "model.language_model.layers.0.input_layernorm.weight": np.linspace(-0.05, 0.05, hidden, dtype=np.float32),
            "model.language_model.layers.0.post_attention_layernorm.weight": np.linspace(-0.02, 0.03, hidden, dtype=np.float32),
            "model.language_model.layers.0.linear_attn.conv1d.weight": (rng.standard_normal((hidden, 1, 4)).astype(np.float32) * 0.1),
            "model.language_model.layers.0.linear_attn.in_proj_a.weight": (rng.standard_normal((heads, hidden)).astype(np.float32) * 0.1),
            "model.language_model.layers.0.linear_attn.in_proj_qkv.weight": (rng.standard_normal((hidden, hidden)).astype(np.float32) * 0.1),
            "model.language_model.layers.0.linear_attn.out_proj.weight": (rng.standard_normal((hidden, hidden)).astype(np.float32) * 0.1),
            "model.language_model.layers.0.linear_attn.A_log": np.linspace(1.0, 2.0, heads, dtype=np.float32),
            "model.language_model.layers.0.linear_attn.dt_bias": np.ones((heads,), dtype=np.float32),
            "model.language_model.layers.0.linear_attn.norm.weight": np.ones((hidden,), dtype=np.float32),
            "model.language_model.norm.weight": np.zeros((hidden,), dtype=np.float32),
            "lm_head.weight": (rng.standard_normal((vocab_size, hidden)).astype(np.float32) * 0.1),
        }

        bfl_hf = {k: v.copy() for k, v in qwen_hf.items()}
        bfl_hf["model.language_model.layers.0.input_layernorm.weight"] += np.linspace(-0.1, 0.1, hidden, dtype=np.float32)
        bfl_hf["model.language_model.layers.0.post_attention_layernorm.weight"] += 0.05
        bfl_hf["model.language_model.layers.0.linear_attn.conv1d.weight"] += rng.standard_normal((hidden, 1, 4)).astype(np.float32) * 0.05
        bfl_hf["model.language_model.layers.0.linear_attn.in_proj_a.weight"] += rng.standard_normal((heads, hidden)).astype(np.float32) * 0.08
        bfl_hf["model.language_model.layers.0.linear_attn.A_log"] += 0.3
        bfl_hf["model.language_model.layers.0.linear_attn.dt_bias"] -= 0.1
        bfl_hf["model.language_model.layers.0.linear_attn.norm.weight"] += 0.15
        bfl_hf["model.language_model.norm.weight"] += 0.04

        lowrank_keys = (
            "model.language_model.embed_tokens.weight",
            "model.language_model.layers.0.linear_attn.in_proj_qkv.weight",
            "model.language_model.layers.0.linear_attn.out_proj.weight",
            "lm_head.weight",
        )
        factors = {}
        for key in lowrank_keys:
            m, n = bfl_hf[key].shape
            u, _ = np.linalg.qr(rng.standard_normal((m, 4)).astype(np.float32))
            v, _ = np.linalg.qr(rng.standard_normal((n, 4)).astype(np.float32))
            s = np.array([3.0, 1.5, 0.75, 0.25], dtype=np.float32)
            sqrt_s = np.sqrt(s)
            lora_b = (u * sqrt_s[None, :]).astype(np.float32)
            lora_a = (sqrt_s[:, None] * v.T).astype(np.float32)
            factors[key] = (lora_b, lora_a, s)
            bfl_hf[key] = bfl_hf[key] + (lora_b @ lora_a)

        adapter_dir = root / "adapter"
        shards_dir = adapter_dir / "shards"
        shards_dir.mkdir(parents=True)

        exact_tensors = {}
        exact_stats = {}
        for key in qwen_hf:
            if key in lowrank_keys:
                continue
            dt = mx.float32 if key.endswith("A_log") else mx.bfloat16
            q_arr = mx.array(qwen_hf[key]).astype(dt)
            b_arr = mx.array(bfl_hf[key]).astype(dt)
            d_arr = (b_arr.astype(mx.float32) - q_arr.astype(mx.float32)).astype(dt)
            exact_tensors[f"{key}.delta"] = d_arr
            exact_tensors[f"{key}.bfl"] = b_arr
            exact_stats[key] = {"mode": "exact", "shape": list(qwen_hf[key].shape)}
        mx.save_safetensors(str(shards_dir / "exact_small.safetensors"), exact_tensors)

        lr_tensors = {}
        lr_stats = {}
        for key, (lb, la, sv) in factors.items():
            lr_tensors[f"{key}.lora_B"] = mx.array(lb).astype(mx.bfloat16)
            lr_tensors[f"{key}.lora_A"] = mx.array(la).astype(mx.bfloat16)
            lr_tensors[f"{key}.singular_values"] = mx.array(sv).astype(mx.float32)
            lr_stats[key] = {"mode": "lowrank_svd", "shape": list(qwen_hf[key].shape), "rank": 4}
        mx.save_safetensors(str(shards_dir / "layers_00_07.safetensors"), lr_tensors)

        manifest = {
            "schema": "kaminos.bfl-pup.delta-adapter.v1",
            "max_rank": 4,
            "min_lora_dim": 32,
            "complete": True,
            "expected_shard_groups": ["exact_small", "layers_00_07"],
            "expected_exact_count": len(exact_stats),
            "expected_lowrank_count": len(lr_stats),
            "shards": {
                "exact_small": {"file": "shards/exact_small.safetensors", "tensor_stats": exact_stats},
                "layers_00_07": {"file": "shards/layers_00_07.safetensors", "tensor_stats": lr_stats},
            },
        }
        (adapter_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

        def reconstruct_hf(rank: int):
            out = {}
            for k, v in qwen_hf.items():
                if k in lowrank_keys:
                    lb = np.array(lr_tensors[f"{k}.lora_B"].astype(mx.float32))[:, :rank]
                    la = np.array(lr_tensors[f"{k}.lora_A"].astype(mx.float32))[:rank, :]
                    out[k] = v + (lb @ la)
                else:
                    out[k] = np.array(exact_tensors[f"{k}.bfl"].astype(mx.float32))
            return out

        return qwen_hf, adapter_dir, reconstruct_hf

    @staticmethod
    def _load_hf_into_mlx(model: MiniMLXVLM, hf_sd: dict) -> None:
        norm_suffixes = (
            ".input_layernorm.weight",
            ".post_attention_layernorm.weight",
            "model.norm.weight",
            ".q_norm.weight",
            ".k_norm.weight",
        )
        flat = []
        for k, arr_np in hf_sd.items():
            mk = k.replace("model.language_model", "language_model.model").replace("lm_head", "language_model.lm_head")
            dt = mx.float32 if k.endswith("A_log") else mx.bfloat16
            arr = mx.array(arr_np).astype(dt)
            if "conv1d.weight" in mk and arr.shape[-1] != 1:
                arr = mx.moveaxis(arr, 2, 1)
            if any(mk.endswith(sfx) for sfx in norm_suffixes):
                arr = (arr.astype(mx.float32) + 1.0).astype(dt)
            flat.append((mk, arr))
        model.load_weights(flat, strict=True)
        mx.eval(model.parameters())

    def test_unquantized_and_quantized_mlx_switchable_controller(self):
        from mlx_switchable_adapter import MLXSwitchableDeltaController

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            qwen_hf, adapter_dir, reconstruct_hf = self._build_fixture(root)
            input_ids = mx.array([[2, 11, 45, 90, 120]], dtype=mx.int32)

            # 1. Unquantized MLX model: verify exact parity with reconstructed rank-4 and rank-2 models
            model_bf16 = MiniMLXVLM()
            self._load_hf_into_mlx(model_bf16, qwen_hf)
            baseline_bf16 = model_bf16(input_ids)
            mx.eval(baseline_bf16)

            ctrl_bf16 = MLXSwitchableDeltaController(model_bf16, adapter_dir, base_role="qwen")
            kv_cache = FakeKVCache()
            ssm_cache = FakeArraysCache()
            ctrl_bf16.attach_cache([kv_cache, ssm_cache])
            model_bf16.language_model._position_ids = mx.ones((3, 1, 5))
            model_bf16.language_model._rope_deltas = mx.ones((1, 1))

            res4 = ctrl_bf16.set_mode(enabled=True, rank=4)
            self.assertTrue(res4["enabled"])
            self.assertEqual(res4["rank"], 4)
            self.assertTrue(res4["reset_performed"])
            self.assertIsNone(model_bf16.language_model._position_ids)
            self.assertIsNone(model_bf16.language_model._rope_deltas)
            self.assertEqual(kv_cache.offset, 0)
            self.assertIsNone(ssm_cache[0])
            self.assertIsNone(ssm_cache[1])

            out_on4 = model_bf16(input_ids)
            mx.eval(out_on4)

            ref_r4 = MiniMLXVLM()
            self._load_hf_into_mlx(ref_r4, reconstruct_hf(rank=4))
            expected_r4 = ref_r4(input_ids)
            mx.eval(expected_r4)
            max_diff_r4 = float(mx.max(mx.abs(out_on4.astype(mx.float32) - expected_r4.astype(mx.float32))).item())
            self.assertLess(max_diff_r4, 5e-2)

            # Switch to rank 2 -> re-populate caches first and verify repeated cache clearing across transitions
            kv_cache.keys = mx.ones((1, 4, 4, 16))
            kv_cache.values = mx.ones((1, 4, 4, 16))
            kv_cache.offset = 4
            ssm_cache[0] = mx.ones((1, 3, 64))
            ssm_cache[1] = mx.ones((1, 4, 16, 16))
            model_bf16.language_model._position_ids = mx.ones((3, 1, 4))
            model_bf16.language_model._rope_deltas = mx.ones((1, 1))
            res2 = ctrl_bf16.set_mode(enabled=True, rank=2)
            self.assertTrue(res2["reset_performed"])
            self.assertEqual(kv_cache.offset, 0)
            self.assertIsNone(ssm_cache[0])
            self.assertIsNone(ssm_cache[1])
            self.assertIsNone(model_bf16.language_model._position_ids)
            self.assertIsNone(model_bf16.language_model._rope_deltas)
            out_on2 = model_bf16(input_ids)
            mx.eval(out_on2)

            ref_r2 = MiniMLXVLM()
            self._load_hf_into_mlx(ref_r2, reconstruct_hf(rank=2))
            expected_r2 = ref_r2(input_ids)
            mx.eval(expected_r2)
            max_diff_r2 = float(mx.max(mx.abs(out_on2.astype(mx.float32) - expected_r2.astype(mx.float32))).item())
            self.assertLess(max_diff_r2, 5e-2)

            # Switch OFF -> bit-identical to baseline_bf16
            ctrl_bf16.set_mode(enabled=False)
            out_off = model_bf16(input_ids)
            mx.eval(out_off)
            self.assertEqual(
                float(mx.max(mx.abs(out_off.astype(mx.float32) - baseline_bf16.astype(mx.float32))).item()),
                0.0,
            )

            # 2. 4-bit Quantized MLX model (QuantizedLinear including in_proj_a + QuantizedEmbedding)
            model_q4 = MiniMLXVLM()
            self._load_hf_into_mlx(model_q4, qwen_hf)
            nn.quantize(model_q4, group_size=64, bits=4)
            mx.eval(model_q4.parameters())

            baseline_q4 = model_q4(input_ids)
            mx.eval(baseline_q4)

            ctrl_q4 = MLXSwitchableDeltaController(model_q4, adapter_dir, base_role="qwen")
            ctrl_q4.set_mode(enabled=True, rank=4)
            out_q4_on = model_q4(input_ids)
            mx.eval(out_q4_on)
            q4_delta = float(mx.max(mx.abs(out_q4_on.astype(mx.float32) - baseline_q4.astype(mx.float32))).item())
            self.assertGreater(q4_delta, 1e-2)

            # Switch back OFF -> exact 0.0 difference vs baseline_q4 (quantized weights never mutated)
            ctrl_q4.set_mode(enabled=False)
            out_q4_off = model_q4(input_ids)
            mx.eval(out_q4_off)
            self.assertEqual(
                float(mx.max(mx.abs(out_q4_off.astype(mx.float32) - baseline_q4.astype(mx.float32))).item()),
                0.0,
            )

            # 3. BFL-resident role (`base_role="bfl"`): requires explicit allow_bfl_residual_approx=True
            # and on a true BFL model with a nonzero omitted SVD tail (rank > 4), retains that tail residual
            bfl_with_tail_hf = dict(reconstruct_hf(rank=4))
            tail_vec = np.ones_like(bfl_with_tail_hf["model.language_model.layers.0.linear_attn.out_proj.weight"]) * 0.05
            bfl_with_tail_hf["model.language_model.layers.0.linear_attn.out_proj.weight"] = (
                bfl_with_tail_hf["model.language_model.layers.0.linear_attn.out_proj.weight"] + tail_vec
            )
            model_bfl_res = MiniMLXVLM()
            self._load_hf_into_mlx(model_bfl_res, bfl_with_tail_hf)

            with self.assertRaisesRegex(ValueError, "allow_bfl_residual_approx=True"):
                MLXSwitchableDeltaController(model_bfl_res, adapter_dir, base_role="bfl")

            # PUP-CONF-01: supplying a BFL-weighted model with base_role='qwen' must fail weight-provenance verification
            with self.assertRaisesRegex(ValueError, "contradicting base_role='qwen'"):
                MLXSwitchableDeltaController(model_bfl_res, adapter_dir, base_role="qwen")

            ctrl_bfl = MLXSwitchableDeltaController(
                model_bfl_res, adapter_dir, base_role="bfl", allow_bfl_residual_approx=True
            )
            self.assertEqual(
                ctrl_bfl.effective_model_semantics,
                "bfl_resident_retains_unextracted_svd_tail_residual",
            )
            self.assertEqual(
                ctrl_bf16.effective_model_semantics,
                "qwen_resident_exact_target",
            )
            epoch0 = ctrl_bfl.state_epoch

            # Switch OFF on BFL-resident model with omitted tail -> differs from Qwen baseline_bf16 by the omitted tail
            ctrl_bfl.set_mode(enabled=False)
            out_bfl_off = model_bfl_res(input_ids)
            mx.eval(out_bfl_off)
            tail_diff = float(mx.max(mx.abs(out_bfl_off.astype(mx.float32) - baseline_bf16.astype(mx.float32))).item())
            self.assertGreater(tail_diff, 1e-3)

            with self.assertRaises(RuntimeError):
                ctrl_bfl.assert_cache_epoch(epoch0)

            # 4. Unresolved required tensor path in manifest must fail loudly during attachment
            bad_adapter_dir = root / "bad_adapter"
            bad_shards = bad_adapter_dir / "shards"
            bad_shards.mkdir(parents=True)
            mx.save_safetensors(
                str(bad_shards / "exact_small.safetensors"),
                {
                    "model.language_model.layers.99.nonexistent.weight.delta": mx.zeros((8,), dtype=mx.bfloat16),
                    "model.language_model.layers.99.nonexistent.weight.bfl": mx.ones((8,), dtype=mx.bfloat16),
                },
            )
            (bad_adapter_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema": "kaminos.bfl-pup.delta-adapter.v1",
                        "max_rank": 4,
                        "min_lora_dim": 32,
                        "complete": True,
                        "shards": {
                            "exact_small": {
                                "file": "shards/exact_small.safetensors",
                                "tensor_stats": {
                                    "model.language_model.layers.99.nonexistent.weight": {
                                        "mode": "exact",
                                        "shape": [8],
                                    }
                                },
                            }
                        },
                    }
                )
            )
            with self.assertRaisesRegex(KeyError, "Unresolved MLX adapter target"):
                MLXSwitchableDeltaController(MiniMLXVLM(), bad_adapter_dir, base_role="qwen")


if __name__ == "__main__":
    unittest.main()
