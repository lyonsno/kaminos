# kaminos-test: manual -- Offline PyTorch/safetensors delta-adapter extraction check; run with venv-flux3.
"""Fail-first unit tests for BFL PUP -> Qwen3.5-9B delta/LoRA adapter extraction."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "models" / "bfl-pup"))


class TestBflPupDeltaExtract(unittest.TestCase):
    def _make_fixture_dirs(self, root: Path, visual_diff: float = 0.0):
        bfl_dir = root / "bfl"
        qwen_dir = root / "qwen"
        bfl_dir.mkdir(parents=True, exist_ok=True)
        qwen_dir.mkdir(parents=True, exist_ok=True)

        torch.manual_seed(42)
        vis_w = torch.randn(64, 64, dtype=torch.bfloat16)
        norm_qwen = torch.ones(128, dtype=torch.bfloat16)
        norm_bfl = norm_qwen + torch.linspace(-0.05, 0.05, 128, dtype=torch.bfloat16)
        a_log_qwen = torch.linspace(1.0, 4.0, 16, dtype=torch.float32)
        a_log_bfl = (a_log_qwen + 0.125).to(torch.bfloat16)

        # Construct a controlled low-rank + tail delta on a 2D projection [256, 128]
        base_proj = torch.randn(256, 128, dtype=torch.bfloat16)
        u_raw, _ = torch.linalg.qr(torch.randn(256, 8, dtype=torch.float32))
        v_raw, _ = torch.linalg.qr(torch.randn(128, 8, dtype=torch.float32))
        known_s = torch.tensor([12.0, 9.0, 6.0, 3.0, 1.5, 0.75, 0.25, 0.1], dtype=torch.float32)
        delta_proj = (u_raw * known_s) @ v_raw.T
        bfl_proj = (base_proj.float() + delta_proj).to(torch.bfloat16)

        qwen_tensors = {
            "model.visual.blocks.0.attn.qkv.weight": vis_w,
            "model.language_model.layers.0.input_layernorm.weight": norm_qwen,
            "model.language_model.layers.0.linear_attn.A_log": a_log_qwen,
            "model.language_model.layers.0.self_attn.q_proj.weight": base_proj,
            "mtp.layers.0.weight": torch.zeros(16, 16, dtype=torch.bfloat16),
        }
        bfl_tensors = {
            "model.visual.blocks.0.attn.qkv.weight": (vis_w.float() + visual_diff).to(torch.bfloat16),
            "model.language_model.layers.0.input_layernorm.weight": norm_bfl,
            "model.language_model.layers.0.linear_attn.A_log": a_log_bfl,
            "model.language_model.layers.0.self_attn.q_proj.weight": bfl_proj,
        }
        save_file(qwen_tensors, str(qwen_dir / "model.safetensors"))
        save_file(bfl_tensors, str(bfl_dir / "model.safetensors"))
        return bfl_dir, qwen_dir, qwen_tensors, bfl_tensors

    def test_extract_exact_small_and_rank_sliceable_lora(self):
        from extract_delta_adapter import apply_extracted_delta, run_extraction

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir, qwen_dir, qwen_tensors, bfl_tensors = self._make_fixture_dirs(root)
            out_dir = root / "out"
            report_path = root / "report.json"

            result = run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=report_path,
                device="cpu",
                max_rank=4,
                min_lora_dim=64,
                oversample=8,
                niter=4,
                resume=False,
            )
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["counts"]["visual_identical_skipped"], 1)
            self.assertEqual(result["counts"]["exact_small_saved"], 2)
            self.assertEqual(result["counts"]["lowrank_saved"], 1)

            # Verify exact small tensors reconstruct BFL weights identically
            recon_r4 = apply_extracted_delta(qwen_tensors, out_dir, rank=4)
            self.assertTrue(
                torch.equal(
                    recon_r4["model.language_model.layers.0.input_layernorm.weight"],
                    bfl_tensors["model.language_model.layers.0.input_layernorm.weight"],
                )
            )
            self.assertTrue(
                torch.allclose(
                    recon_r4["model.language_model.layers.0.linear_attn.A_log"].float(),
                    bfl_tensors["model.language_model.layers.0.linear_attn.A_log"].float(),
                    atol=1e-6,
                )
            )

            # Verify rank-4 approximation is strictly closer to BFL than rank-2 slice
            target_d = (
                bfl_tensors["model.language_model.layers.0.self_attn.q_proj.weight"].float()
                - qwen_tensors["model.language_model.layers.0.self_attn.q_proj.weight"].float()
            )
            recon_r2 = apply_extracted_delta(qwen_tensors, out_dir, rank=2)
            err_r2 = torch.linalg.norm(
                (recon_r2["model.language_model.layers.0.self_attn.q_proj.weight"].float()
                 - qwen_tensors["model.language_model.layers.0.self_attn.q_proj.weight"].float())
                - target_d
            ).item()
            err_r4 = torch.linalg.norm(
                (recon_r4["model.language_model.layers.0.self_attn.q_proj.weight"].float()
                 - qwen_tensors["model.language_model.layers.0.self_attn.q_proj.weight"].float())
                - target_d
            ).item()
            full_norm = torch.linalg.norm(target_d).item()
            self.assertLess(err_r4, err_r2)
            self.assertLess(err_r4 / full_norm, 0.16)

            # Verify resume skips already-completed shards
            resumed = run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=report_path,
                device="cpu",
                max_rank=4,
                min_lora_dim=64,
                oversample=8,
                niter=4,
                resume=True,
            )
            self.assertGreaterEqual(resumed["counts"]["resumed_shards"], 2)

    def test_visual_drift_fails_loud_with_report(self):
        from extract_delta_adapter import run_extraction

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir, qwen_dir, _, _ = self._make_fixture_dirs(root, visual_diff=0.25)
            out_dir = root / "out"
            report_path = root / "report.json"

            with self.assertRaises(ValueError):
                run_extraction(
                    source_mode="local-dir",
                    bfl_dir=bfl_dir,
                    qwen_dir=qwen_dir,
                    out_dir=out_dir,
                    report_path=report_path,
                    device="cpu",
                    max_rank=4,
                    min_lora_dim=64,
                    oversample=8,
                    niter=2,
                    resume=False,
                )
            saved_report = json.loads(report_path.read_text())
            self.assertEqual(saved_report["status"], "failed")
            self.assertEqual(saved_report["failure_phase"], "visual-identity-check")

    def test_false_closure_guards_and_shard_selection(self):
        from unittest.mock import patch
        from extract_delta_adapter import HFRangeSafetensorsReader, resolve_device, run_extraction

        with patch("torch.backends.mps.is_available", return_value=False):
            with self.assertRaises(RuntimeError):
                resolve_device("mps")

        reader = object.__new__(HFRangeSafetensorsReader)
        reader.repo_id = "dummy/repo"
        reader.revision = "deadbeef"
        reader._session = None
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"short"
            with self.assertRaises(RuntimeError):
                reader._fetch_range("model.safetensors", 0, 15)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir, qwen_dir, _, _ = self._make_fixture_dirs(root)
            out_dir = root / "out"
            report_path = root / "report.json"
            res = run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=report_path,
                device="cpu",
                max_rank=4,
                min_lora_dim=64,
                oversample=8,
                niter=2,
                selected_shards=["exact_small"],
            )
            self.assertEqual(list(res["shards"].keys()), ["exact_small"])
            self.assertEqual(res["counts"]["lowrank_saved"], 0)


if __name__ == "__main__":
    unittest.main()
