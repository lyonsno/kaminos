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

            if torch.backends.mps.is_available():
                from extract_delta_adapter import lowrank_svd_decompose

                lb_mps, la_mps, sv_mps, _ = lowrank_svd_decompose(
                    bfl_tensors["model.language_model.layers.0.self_attn.q_proj.weight"],
                    qwen_tensors["model.language_model.layers.0.self_attn.q_proj.weight"],
                    device=torch.device("mps"),
                    max_rank=4,
                    oversample=8,
                    niter=4,
                )
                err_mps = torch.linalg.norm((lb_mps.float() @ la_mps.float()) - target_d).item()
                self.assertLess(err_mps / full_norm, 0.16)
                self.assertTrue(torch.allclose(sv_mps[:4], torch.tensor([12.0, 9.0, 6.0, 3.0]), atol=0.25))

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
            manifest_partial = json.loads((out_dir / "manifest.json").read_text())
            self.assertFalse(manifest_partial.get("complete"))

    def test_resume_invalidated_on_changed_source_or_rank_and_cli_early_failure_report(self):
        import subprocess
        from extract_delta_adapter import run_extraction

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bfl_dir, qwen_dir, _, bfl_tensors = self._make_fixture_dirs(root)
            out_dir = root / "out"

            # 1. Extract at rank 2
            run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=root / "report1.json",
                device="cpu",
                max_rank=2,
                min_lora_dim=64,
                oversample=8,
                niter=2,
                resume=True,
            )

            # 2. Resume with max_rank=4 -> must NOT reuse rank-2 shards
            res_rank4 = run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=root / "report2.json",
                device="cpu",
                max_rank=4,
                min_lora_dim=64,
                oversample=8,
                niter=2,
                resume=True,
            )
            self.assertEqual(res_rank4["counts"]["resumed_shards"], 0)
            manifest_r4 = json.loads((out_dir / "manifest.json").read_text())
            self.assertEqual(manifest_r4["max_rank"], 4)
            self.assertTrue(manifest_r4["complete"])
            with safe_open(str(out_dir / "shards" / "layers_00_03.safetensors"), framework="pt") as sf:
                self.assertEqual(
                    sf.get_tensor("model.language_model.layers.0.self_attn.q_proj.weight.lora_B").shape[1],
                    4,
                )

            # 3. Modify source tensor contents without changing shape/header -> resume must recompute
            modified_bfl = dict(bfl_tensors)
            modified_bfl["model.language_model.layers.0.self_attn.q_proj.weight"] = (
                modified_bfl["model.language_model.layers.0.self_attn.q_proj.weight"] + 1.0
            )
            save_file(modified_bfl, str(bfl_dir / "model.safetensors"))
            res_changed = run_extraction(
                source_mode="local-dir",
                bfl_dir=bfl_dir,
                qwen_dir=qwen_dir,
                out_dir=out_dir,
                report_path=root / "report3.json",
                device="cpu",
                max_rank=4,
                min_lora_dim=64,
                oversample=8,
                niter=2,
                resume=True,
            )
            self.assertEqual(res_changed["counts"]["resumed_shards"], 0)

            # 4. Early setup failure (--out-dir is a regular file) must still write --report
            bad_out = root / "regular_file"
            bad_out.write_text("not a dir")
            early_report = root / "early_fail_report.json"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "models" / "bfl-pup" / "extract_delta_adapter.py"),
                    "--source-mode",
                    "local-dir",
                    "--bfl-dir",
                    str(bfl_dir),
                    "--qwen-dir",
                    str(qwen_dir),
                    "--out-dir",
                    str(bad_out),
                    "--report",
                    str(early_report),
                    "--device",
                    "cpu",
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(proc.returncode, 0)
            self.assertTrue(early_report.exists())
            early_data = json.loads(early_report.read_text())
            self.assertEqual(early_data["status"], "failed")

    def test_http_range_rejects_status_200_and_oversized_stream_without_eager_read(self):
        from unittest.mock import patch
        from extract_delta_adapter import HFRangeSafetensorsReader

        class FakeResponse200:
            status_code = 200
            headers = {"Content-Length": "1000000000"}
            body_read = False
            closed = False

            def iter_content(self, chunk_size=1024):
                FakeResponse200.body_read = True
                yield b"x" * 1024

            def close(self):
                FakeResponse200.closed = True

        class FakeSession200:
            def get(self, url, headers=None, stream=False, timeout=None):
                assert stream is True
                return FakeResponse200()

        reader = object.__new__(HFRangeSafetensorsReader)
        reader.repo_id = "dummy/repo"
        reader.revision = "deadbeef"
        reader._get_session = lambda: FakeSession200()

        with patch("time.sleep"):
            with self.assertRaisesRegex(RuntimeError, "Expected HTTP 206 Partial Content"):
                reader._fetch_range("model.safetensors", 0, 7)
        self.assertFalse(FakeResponse200.body_read)
        self.assertTrue(FakeResponse200.closed)

        class FakeResponseOversized206:
            status_code = 206
            headers = {"Content-Range": "bytes 0-7/1000"}
            chunks_yielded = 0
            max_chunks_in_single_call = 0
            closed = False

            def iter_content(self, chunk_size=1024):
                call_chunks = 0
                for _ in range(10):
                    call_chunks += 1
                    FakeResponseOversized206.chunks_yielded += 1
                    FakeResponseOversized206.max_chunks_in_single_call = max(
                        FakeResponseOversized206.max_chunks_in_single_call, call_chunks
                    )
                    yield b"0123456789"

            def close(self):
                FakeResponseOversized206.closed = True

        class FakeSessionOversized:
            def get(self, url, headers=None, stream=False, timeout=None):
                return FakeResponseOversized206()

        reader._get_session = lambda: FakeSessionOversized()
        with patch("time.sleep"):
            with self.assertRaisesRegex(RuntimeError, "Range response exceeded requested length"):
                reader._fetch_range("model.safetensors", 0, 7)
        self.assertEqual(FakeResponseOversized206.max_chunks_in_single_call, 1)
        self.assertEqual(FakeResponseOversized206.chunks_yielded, 4)
        self.assertTrue(FakeResponseOversized206.closed)


if __name__ == "__main__":
    unittest.main()
