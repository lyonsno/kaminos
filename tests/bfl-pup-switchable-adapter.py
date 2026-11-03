# kaminos-test: manual -- Offline PyTorch switchable delta-adapter check; run with venv-flux3.
"""Fail-first unit tests for SwitchableDeltaController (sidecar LoRA + exact small tensors + state reset)."""
import sys
import tempfile
import unittest
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from safetensors.torch import save_file

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "models" / "bfl-pup"))


class MiniQwen35Model(nn.Module):
    def __init__(self, vocab_size: int = 96, hidden: int = 64):
        super().__init__()
        self.embed_tokens = nn.Embedding(vocab_size, hidden, dtype=torch.bfloat16)
        self.input_layernorm = nn.Parameter(torch.ones(hidden, dtype=torch.bfloat16))
        self.A_log = nn.Parameter(torch.linspace(1.0, 2.0, 8, dtype=torch.float32))
        self.in_proj_a = nn.Linear(hidden, 8, bias=False, dtype=torch.bfloat16)
        self.q_proj = nn.Linear(hidden, hidden, bias=False, dtype=torch.bfloat16)
        self.o_proj = nn.Linear(hidden, hidden, bias=False, dtype=torch.bfloat16)
        self.lm_head = nn.Linear(hidden, vocab_size, bias=False, dtype=torch.bfloat16)

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        x = self.embed_tokens(input_ids).float()
        x = x * self.input_layernorm.float()
        gate = torch.sigmoid(self.in_proj_a(x.to(torch.bfloat16)).float() * self.A_log.float()).mean(dim=-1, keepdim=True)
        h = self.q_proj(x.to(torch.bfloat16)).float() * (1.0 + gate)
        h = self.o_proj(h.to(torch.bfloat16)).float()
        logits = self.lm_head(h.to(torch.bfloat16)).float()
        return logits


class TestSwitchableDeltaController(unittest.TestCase):
    def _build_models_and_adapter(self, root: Path):
        from extract_delta_adapter import apply_extracted_delta, run_extraction

        torch.manual_seed(7)
        qwen_model = MiniQwen35Model(vocab_size=96, hidden=64)
        bfl_model = MiniQwen35Model(vocab_size=96, hidden=64)
        bfl_model.load_state_dict(qwen_model.state_dict())

        with torch.no_grad():
            bfl_model.input_layernorm.add_(torch.linspace(-0.1, 0.1, 64, dtype=torch.bfloat16))
            bfl_model.A_log.add_(0.25)
            bfl_model.in_proj_a.weight.add_(torch.randn_like(bfl_model.in_proj_a.weight) * 0.05)

            for lin in (bfl_model.q_proj, bfl_model.o_proj, bfl_model.lm_head):
                m, n = lin.weight.shape
                u, _ = torch.linalg.qr(torch.randn(m, 4))
                v, _ = torch.linalg.qr(torch.randn(n, 4))
                s = torch.tensor([4.0, 2.0, 1.0, 0.5])
                lin.weight.add_(((u * s) @ v.T).to(torch.bfloat16))

            m, n = bfl_model.embed_tokens.weight.shape
            u, _ = torch.linalg.qr(torch.randn(m, 4))
            v, _ = torch.linalg.qr(torch.randn(n, 4))
            s = torch.tensor([3.0, 1.5, 0.8, 0.4])
            bfl_model.embed_tokens.weight.add_(((u * s) @ v.T).to(torch.bfloat16))

        qwen_dir = root / "qwen"
        bfl_dir = root / "bfl"
        out_dir = root / "adapter"
        qwen_dir.mkdir()
        bfl_dir.mkdir()

        qwen_sd = {k: v.detach().clone() for k, v in qwen_model.state_dict().items()}
        bfl_sd = {k: v.detach().clone() for k, v in bfl_model.state_dict().items()}
        save_file(qwen_sd, str(qwen_dir / "model.safetensors"))
        save_file(bfl_sd, str(bfl_dir / "model.safetensors"))

        run_extraction(
            source_mode="local-dir",
            bfl_dir=bfl_dir,
            qwen_dir=qwen_dir,
            out_dir=out_dir,
            report_path=root / "report.json",
            device="cpu",
            max_rank=4,
            min_lora_dim=32,
            oversample=4,
            niter=4,
            resume=False,
        )
        return qwen_model, qwen_sd, out_dir, apply_extracted_delta

    def test_switch_on_off_rank_and_cache_reset_without_base_reload(self):
        from switchable_adapter import GenerationCacheState, SwitchableDeltaController

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model, qwen_sd, adapter_dir, apply_extracted_delta = self._build_models_and_adapter(root)
            input_ids = torch.tensor([[1, 5, 12, 33, 70]], dtype=torch.long)

            with torch.no_grad():
                baseline_off = model(input_ids).clone()

            # Record original data_ptrs of large base weights to prove zero base-weight reload
            base_ptrs = {
                "embed_tokens": model.embed_tokens.weight.data_ptr(),
                "q_proj": model.q_proj.weight.data_ptr(),
                "o_proj": model.o_proj.weight.data_ptr(),
                "lm_head": model.lm_head.weight.data_ptr(),
            }

            ctrl = SwitchableDeltaController(model, adapter_dir, include_vocab=True)
            cache = ctrl.attach_cache(GenerationCacheState())
            cache.kv_cache["layer0"] = torch.ones(2, 4)
            cache.recurrent_state["layer0"] = torch.ones(2, 8)

            # Switch ON at rank 4 -> must reset cache and match reconstructed rank-4 model
            res_on4 = ctrl.set_mode(enabled=True, rank=4)
            self.assertTrue(res_on4["enabled"])
            self.assertEqual(res_on4["rank"], 4)
            self.assertTrue(res_on4["reset_performed"])
            self.assertEqual(len(cache.kv_cache), 0)
            self.assertEqual(len(cache.recurrent_state), 0)
            ctrl.assert_cache_valid(cache)

            ref_model_r4 = MiniQwen35Model(vocab_size=96, hidden=64)
            ref_model_r4.load_state_dict(apply_extracted_delta(qwen_sd, adapter_dir, rank=4))
            with torch.no_grad():
                out_on4 = model(input_ids)
                expected_r4 = ref_model_r4(input_ids)
            self.assertTrue(torch.allclose(out_on4, expected_r4, atol=5e-2, rtol=1e-2))

            # Switch to rank 2 -> must reset cache again and match reconstructed rank-2 model
            cache.kv_cache["layer0"] = torch.ones(2, 4)
            res_on2 = ctrl.set_mode(enabled=True, rank=2)
            self.assertTrue(res_on2["reset_performed"])
            self.assertEqual(len(cache.kv_cache), 0)

            ref_model_r2 = MiniQwen35Model(vocab_size=96, hidden=64)
            ref_model_r2.load_state_dict(apply_extracted_delta(qwen_sd, adapter_dir, rank=2))
            with torch.no_grad():
                out_on2 = model(input_ids)
                expected_r2 = ref_model_r2(input_ids)
            self.assertTrue(torch.allclose(out_on2, expected_r2, atol=5e-2, rtol=1e-2))

            # Switch OFF -> must restore exact baseline output and keep identical base weight pointers
            cache.recurrent_state["layer0"] = torch.ones(2, 8)
            res_off = ctrl.set_mode(enabled=False)
            self.assertFalse(res_off["enabled"])
            self.assertTrue(res_off["reset_performed"])
            self.assertEqual(len(cache.recurrent_state), 0)

            with torch.no_grad():
                out_off = model(input_ids)
            self.assertTrue(torch.equal(out_off, baseline_off))

            for name, ptr in base_ptrs.items():
                mod = getattr(model, name)
                self.assertEqual(mod.weight.data_ptr(), ptr)

            # Stale unattached cache must be rejected after epoch change
            stale_cache = GenerationCacheState()
            stale_cache.bound_epoch = 0
            with self.assertRaises(RuntimeError):
                ctrl.assert_cache_valid(stale_cache)


if __name__ == "__main__":
    unittest.main()
