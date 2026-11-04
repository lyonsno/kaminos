"""Extract a rank-sliceable low-rank SVD + exact-small-tensor delta adapter
between black-forest-labs/flux-3-image-klein-pup and Qwen/Qwen3.5-9B.

Supports both local safetensors directories (--source-mode local-dir) and
bounded-memory HTTP-Range tensor streaming (--source-mode hf-range) so the
37.6 GB dual BF16 source checkpoints never need to be staged on disk at once.
"""
import argparse
import concurrent.futures
import hashlib
import json
import math
import re
import struct
import threading
import time
import traceback
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import torch
from safetensors import safe_open
from safetensors.torch import save_file

DEFAULT_BFL_REPO = "black-forest-labs/flux-3-image-klein-pup"
DEFAULT_BFL_REV = "3f3edb52b2c55de0d49feab28598b68f7f8e4830"
DEFAULT_QWEN_REPO = "Qwen/Qwen3.5-9B"
DEFAULT_QWEN_REV = "c202236235762e1c871ad0ccb60c8ee5ba337b9a"

DTYPE_MAP = {
    "BF16": (torch.bfloat16, 2),
    "F16": (torch.float16, 2),
    "F32": (torch.float32, 4),
}


def atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(path)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class HFRangeSafetensorsReader:
    """Streams individual tensors from Hugging Face safetensors via bounded HTTP Range."""

    def __init__(self, repo_id: str, revision: str, shard_files: List[str]):
        self.repo_id = repo_id
        self.revision = revision
        self.shard_files = shard_files
        self.headers: Dict[str, Tuple[str, int, Dict[str, Any]]] = {}
        self.header_digests: Dict[str, str] = {}
        self._tls = threading.local()
        self._has_requests = False
        try:
            import requests  # noqa: F401

            self._has_requests = True
        except ImportError:
            self._has_requests = False
        self._load_headers()

    def _get_session(self) -> Any:
        if not getattr(self, "_has_requests", False):
            return None
        tls = getattr(self, "_tls", None)
        if tls is None:
            self._tls = threading.local()
            tls = self._tls
        sess = getattr(tls, "session", None)
        if sess is None:
            import requests
            from requests.adapters import HTTPAdapter

            sess = requests.Session()
            adapter = HTTPAdapter(pool_connections=8, pool_maxsize=8, max_retries=2)
            sess.mount("https://", adapter)
            sess.mount("http://", adapter)
            tls.session = sess
        return sess

    def _url(self, filename: str) -> str:
        return f"https://huggingface.co/{self.repo_id}/resolve/{self.revision}/{filename}"

    @staticmethod
    def _validate_content_range(content_range: Optional[str], start: int, end_inclusive: int) -> None:
        if not content_range or not isinstance(content_range, str) or not content_range.strip():
            raise RuntimeError(
                f"Missing Content-Range header for requested range {start}-{end_inclusive}"
            )
        m = re.match(r"^bytes\s+(\d+)-(\d+)/(\d+|\*)$", content_range.strip(), re.IGNORECASE)
        if not m:
            raise RuntimeError(f"Malformed Content-Range header: {content_range!r}")
        r_start, r_end, r_total = int(m.group(1)), int(m.group(2)), m.group(3)
        if r_start != start or r_end != end_inclusive:
            raise RuntimeError(
                f"Content-Range mismatch: requested {start}-{end_inclusive}, got {r_start}-{r_end}"
            )
        if r_total != "*" and int(r_total) <= end_inclusive:
            raise RuntimeError(
                f"Content-Range total length {r_total} is smaller than requested end {end_inclusive}"
            )

    def _fetch_range(self, filename: str, start: int, end_inclusive: int) -> bytes:
        expected_len = end_inclusive - start + 1
        url = self._url(filename)
        headers = {"Range": f"bytes={start}-{end_inclusive}"}
        last_err: Optional[Exception] = None
        for attempt in range(4):
            try:
                sess_getter = getattr(self, "_get_session", None)
                sess = sess_getter() if callable(sess_getter) else getattr(self, "_session", None)
                if sess is not None:
                    resp = sess.get(url, headers=headers, stream=True, timeout=60)
                    try:
                        status_code = getattr(resp, "status_code", None)
                        if not isinstance(status_code, int) or status_code != 206:
                            raise RuntimeError(
                                f"Expected HTTP 206 Partial Content for {url} range {start}-{end_inclusive}, "
                                f"got HTTP {status_code}"
                            )
                        resp_hdrs = getattr(resp, "headers", None)
                        cr_val = None
                        if isinstance(resp_hdrs, dict) or hasattr(resp_hdrs, "get"):
                            cr_val = resp_hdrs.get("Content-Range") or resp_hdrs.get("content-range")
                        self._validate_content_range(cr_val, start, end_inclusive)
                        buf = bytearray()
                        for chunk in resp.iter_content(chunk_size=1024 * 1024):
                            if not chunk:
                                continue
                            buf.extend(chunk)
                            if len(buf) > expected_len:
                                raise RuntimeError(
                                    f"Range response exceeded requested length for {filename}: "
                                    f"expected {expected_len} bytes, received >={len(buf)}"
                                )
                        data = bytes(buf)
                    finally:
                        resp.close()
                else:
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=60) as r:
                        status = getattr(r, "status", getattr(r, "code", None))
                        if not isinstance(status, int) or status != 206:
                            raise RuntimeError(
                                f"Expected HTTP 206 Partial Content for {url} range {start}-{end_inclusive}, "
                                f"got HTTP {status}"
                            )
                        r_hdrs = getattr(r, "headers", None)
                        if r_hdrs is None and hasattr(r, "info") and callable(r.info):
                            r_hdrs = r.info()
                        cr_val = None
                        if isinstance(r_hdrs, dict) or hasattr(r_hdrs, "get"):
                            cr_val = r_hdrs.get("Content-Range") or r_hdrs.get("content-range")
                        self._validate_content_range(cr_val, start, end_inclusive)
                        data = r.read(expected_len + 1)
                        if len(data) > expected_len:
                            raise RuntimeError(
                                f"Range response exceeded requested length for {filename}: "
                                f"expected {expected_len} bytes, received >={len(data)}"
                            )
                if len(data) != expected_len:
                    raise RuntimeError(
                        f"Truncated HTTP Range response for {filename}: expected {expected_len} bytes, got {len(data)}"
                    )
                return data
            except Exception as exc:
                last_err = exc
                if attempt < 3:
                    time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"Failed fetching range {start}-{end_inclusive} from {url}: {last_err}")

    def _load_headers(self) -> None:
        for shard in self.shard_files:
            raw_len = self._fetch_range(shard, 0, 7)
            header_len = struct.unpack("<Q", raw_len)[0]
            raw_header = self._fetch_range(shard, 8, 8 + header_len - 1)
            self.header_digests[shard] = hashlib.sha256(raw_header).hexdigest()
            parsed = json.loads(raw_header.decode("utf-8"))
            data_base = 8 + header_len
            for k, meta in parsed.items():
                if k == "__metadata__":
                    continue
                self.headers[k] = (shard, data_base, meta)

    def keys(self) -> List[str]:
        return list(self.headers.keys())

    def get_meta(self, key: str) -> Dict[str, Any]:
        return self.headers[key][2]

    def get_tensor(self, key: str) -> torch.Tensor:
        shard, data_base, meta = self.headers[key]
        rel_start, rel_end = meta["data_offsets"]
        expected_bytes = rel_end - rel_start
        dtype, elem_bytes = DTYPE_MAP[meta["dtype"]]
        shape = tuple(meta["shape"])
        numel = math.prod(shape)
        if numel * elem_bytes != expected_bytes:
            raise ValueError(f"Header byte mismatch on {key}: shape {shape} * {elem_bytes} != {expected_bytes}")
        raw = self._fetch_range(shard, data_base + rel_start, data_base + rel_end - 1)
        tensor = torch.frombuffer(bytearray(raw), dtype=dtype).reshape(shape)
        return tensor


class LocalSafetensorsReader:
    """Reads tensors from a local directory containing one or more .safetensors files."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.shard_files = sorted(p.name for p in self.directory.glob("*.safetensors"))
        if not self.shard_files:
            raise FileNotFoundError(f"No .safetensors files found in {self.directory}")
        self.key_to_shard: Dict[str, Path] = {}
        self.metas: Dict[str, Dict[str, Any]] = {}
        self.header_digests: Dict[str, str] = {}
        self.file_digests: Dict[str, str] = {}
        for shard_name in self.shard_files:
            shard_path = self.directory / shard_name
            with shard_path.open("rb") as f:
                header_len = struct.unpack("<Q", f.read(8))[0]
                raw_header = f.read(header_len)
            self.header_digests[shard_name] = hashlib.sha256(raw_header).hexdigest()
            self.file_digests[shard_name] = sha256_file(shard_path)
            parsed = json.loads(raw_header.decode("utf-8"))
            for k, meta in parsed.items():
                if k == "__metadata__":
                    continue
                self.key_to_shard[k] = shard_path
                self.metas[k] = meta

    def keys(self) -> List[str]:
        return list(self.key_to_shard.keys())

    def get_meta(self, key: str) -> Dict[str, Any]:
        return self.metas[key]

    def get_tensor(self, key: str) -> torch.Tensor:
        shard_path = self.key_to_shard[key]
        with safe_open(str(shard_path), framework="pt", device="cpu") as f:
            return f.get_tensor(key)


def resolve_device(requested: str) -> torch.device:
    if requested == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("Requested --device mps, but torch.backends.mps.is_available() is False")
        return torch.device("mps")
    if requested == "cpu":
        return torch.device("cpu")
    raise ValueError(f"Unsupported device: {requested}")


def shard_group_for_key(key: str, min_lora_dim: int, shape: Tuple[int, ...]) -> str:
    if key.startswith("model.visual."):
        return "visual"
    if len(shape) != 2 or min(shape) < min_lora_dim:
        return "exact_small"
    if key in ("model.language_model.embed_tokens.weight", "lm_head.weight"):
        return "vocab_embed_lm_head"
    m = re.match(r"^model\.language_model\.layers\.(\d+)\.", key)
    if m:
        layer_idx = int(m.group(1))
        start = (layer_idx // 4) * 4
        end = start + 3
        return f"layers_{start:02d}_{end:02d}"
    return "other_lowrank"


def _mps_gemm_svd_lowrank(
    dw: torch.Tensor,
    q: int,
    niter: int,
    max_chunk_rows: int = 32768,
    device: Optional[torch.device] = None,
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Fast randomized SVD on MPS using GPU GEMMs (`@`) and CPU LAPACK on the small subspace.

    Avoids PyTorch's `svd_kernel_mps` / `qr_kernel_mps`, which perform thousands of synchronous
    per-column Metal command-buffer waits (>3 minutes per 12288x4096 matrix).
    """
    import numpy as np

    target_dev = device if device is not None else dw.device
    step = max(1, int(max_chunk_rows))
    transposed = dw.shape[0] < dw.shape[1]
    a = dw.T if transposed else dw
    d_max, d_min = a.shape

    rng = np.random.default_rng(0)
    omega_np = rng.standard_normal((d_min, q), dtype=np.float32)
    q_np, _ = np.linalg.qr(omega_np, mode="reduced")

    if d_max > step or a.device != target_dev:
        g_dev = torch.zeros((d_min, d_min), device=target_dev, dtype=torch.float32)
        for s_idx in range(0, d_max, step):
            chunk = a[s_idx : s_idx + step].to(device=target_dev, dtype=torch.float32)
            g_dev.addmm_(chunk.T, chunk)
            del chunk
    else:
        g_dev = a.T @ a
    g_np = g_dev.cpu().numpy()
    del g_dev

    steps = max(1, niter)
    for _ in range(steps):
        y_np = g_np @ q_np
        q_np, _ = np.linalg.qr(y_np, mode="reduced")
    del g_np

    q_dev = torch.from_numpy(q_np).to(device=target_dev, dtype=torch.float32)
    if d_max > step or a.device != target_dev:
        b_chunks = []
        bb_dev = torch.zeros((q_np.shape[1], q_np.shape[1]), device=target_dev, dtype=torch.float32)
        for s_idx in range(0, d_max, step):
            chunk = a[s_idx : s_idx + step].to(device=target_dev, dtype=torch.float32)
            b_part = chunk @ q_dev
            bb_dev.addmm_(b_part.T, b_part)
            b_chunks.append(b_part.cpu())
            del chunk, b_part
        bb_np = bb_dev.cpu().numpy().astype(np.float64)
        del bb_dev
        b_dev = None
    else:
        b_dev = a @ q_dev
        bb_np = (b_dev.T @ b_dev).cpu().numpy().astype(np.float64)
        b_chunks = None
    del q_dev

    bb_np = 0.5 * (bb_np + bb_np.T)
    u_b64, s_sq64, _ = np.linalg.svd(bb_np, hermitian=True)
    s_np = np.sqrt(np.maximum(s_sq64, 0.0)).astype(np.float32)
    v_small_np = (q_np.astype(np.float64) @ u_b64).astype(np.float32)

    u_b_dev = torch.from_numpy(u_b64.astype(np.float32)).to(device=target_dev)
    s_dev = torch.from_numpy(s_np).to(device=target_dev)
    inv_s = torch.where(s_dev > 1e-7, 1.0 / s_dev, torch.zeros_like(s_dev))
    scale_mat = u_b_dev * inv_s.unsqueeze(0)

    if b_chunks is not None:
        u_chunks = []
        for b_part_cpu in b_chunks:
            b_part_dev = b_part_cpu.to(device=target_dev, dtype=torch.float32)
            u_chunks.append((b_part_dev @ scale_mat).cpu())
            del b_part_dev
        u_large = torch.cat(u_chunks, dim=0)
        del u_chunks, b_chunks
    else:
        u_large = (b_dev @ scale_mat).cpu()
        del b_dev
    del u_b_dev, s_dev, inv_s, scale_mat

    v_small = torch.from_numpy(v_small_np)
    s_cpu = torch.from_numpy(s_np)
    if transposed:
        return v_small, s_cpu, u_large
    return u_large, s_cpu, v_small


def lowrank_svd_decompose(
    bfl_t: torch.Tensor,
    qwen_t: torch.Tensor,
    device: torch.device,
    max_rank: int,
    oversample: int,
    niter: int,
    max_chunk_rows: int = 32768,
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, Dict[str, Any]]:
    m, n = bfl_t.shape
    r_eff = min(max_rank, m, n)
    q_eff = min(r_eff + oversample, m, n)
    step = max(1, int(max_chunk_rows))

    with torch.no_grad():
        bfl_00 = float(bfl_t.flatten()[0].float().item())
        qwen_00 = float(qwen_t.flatten()[0].float().item())
        if max(m, n) > step:
            sq_bfl = 0.0
            sq_base = 0.0
            sq_delta = 0.0
            dw_chunks = []
            for r_idx in range(0, m, step):
                b_c = bfl_t[r_idx : r_idx + step].to(dtype=torch.float32)
                q_c = qwen_t[r_idx : r_idx + step].to(dtype=torch.float32)
                d_c = b_c - q_c
                sq_bfl += float(torch.linalg.norm(b_c).item()) ** 2
                sq_base += float(torch.linalg.norm(q_c).item()) ** 2
                sq_delta += float(torch.linalg.norm(d_c).item()) ** 2
                dw_chunks.append(d_c)
                del b_c, q_c
            frob_bfl = sq_bfl ** 0.5
            frob_base = sq_base ** 0.5
            frob_delta = sq_delta ** 0.5
            dw_cpu = torch.cat(dw_chunks, dim=0)
            del dw_chunks
            u, s, v = _mps_gemm_svd_lowrank(
                dw_cpu, q=q_eff, niter=niter, max_chunk_rows=step, device=device
            )
            del dw_cpu
        else:
            w_bfl = bfl_t.to(device=device, dtype=torch.float32)
            frob_bfl = float(torch.linalg.norm(w_bfl).item())
            w_qwen = qwen_t.to(device=device, dtype=torch.float32)
            frob_base = float(torch.linalg.norm(w_qwen).item())
            dw = w_bfl - w_qwen
            del w_bfl, w_qwen
            frob_delta = float(torch.linalg.norm(dw).item())

            if device.type == "mps":
                u, s, v = _mps_gemm_svd_lowrank(
                    dw, q=q_eff, niter=niter, max_chunk_rows=step, device=device
                )
                del dw
            else:
                torch.manual_seed(0)
                u, s, v = torch.svd_lowrank(dw, q=q_eff, niter=niter)
                del dw

        if device.type == "mps":
            torch.mps.synchronize()
            torch.mps.empty_cache()

        u_r = u[:, :r_eff]
        s_r = s[:r_eff]
        v_r = v[:, :r_eff]

        sqrt_s = torch.sqrt(torch.clamp(s_r, min=0.0))
        lora_b = (u_r * sqrt_s.unsqueeze(0)).to(torch.bfloat16).cpu().contiguous()
        lora_a = (sqrt_s.unsqueeze(1) * v_r.T).to(torch.bfloat16).cpu().contiguous()
        sv_cpu = s_r.to(torch.float32).cpu().contiguous()

        captured = {}
        denom = max(frob_delta, 1e-12)
        for probe_r in (16, 32, 64, 128, 256):
            if probe_r <= r_eff:
                cap_norm = float(torch.linalg.norm(sv_cpu[:probe_r]).item())
                captured[f"r{probe_r}"] = round(cap_norm / denom, 6)
        cap_max = float(torch.linalg.norm(sv_cpu).item())
        captured[f"r{r_eff}"] = round(cap_max / denom, 6)

    stats = {
        "shape": [m, n],
        "rank": r_eff,
        "frob_delta": round(frob_delta, 6),
        "frob_base": round(frob_base, 6),
        "frob_bfl": round(frob_bfl, 6),
        "qwen_00": round(qwen_00, 6),
        "bfl_00": round(bfl_00, 6),
        "rel_l2": round(frob_delta / max(frob_base, 1e-12), 6),
        "sv_top5": [round(float(x), 5) for x in sv_cpu[:5].tolist()],
        "sv_rank_boundary": round(float(sv_cpu[-1].item()), 5) if r_eff > 0 else 0.0,
        "captured_frobenius_ratio": captured,
    }
    return lora_b, lora_a, sv_cpu, stats


def run_extraction(
    *,
    source_mode: str = "hf-range",
    bfl_dir: Optional[Path] = None,
    qwen_dir: Optional[Path] = None,
    bfl_repo: str = DEFAULT_BFL_REPO,
    bfl_rev: str = DEFAULT_BFL_REV,
    qwen_repo: str = DEFAULT_QWEN_REPO,
    qwen_rev: str = DEFAULT_QWEN_REV,
    out_dir: Path,
    report_path: Path,
    device: str = "mps",
    max_rank: int = 256,
    min_lora_dim: int = 1024,
    oversample: int = 32,
    niter: int = 4,
    resume: bool = True,
    verify_visual_samples: int = 8,
    include_vocab: bool = True,
    prefetch_workers: int = 2,
    selected_shards: Optional[List[str]] = None,
) -> Dict[str, Any]:
    out_dir = Path(out_dir)
    report_path = Path(report_path)

    t0 = time.time()
    report: Dict[str, Any] = {
        "schema": "kaminos.bfl-pup-delta-extraction.v1",
        "status": "running",
        "failure_phase": "initialization",
        "last_trustworthy_evidence": None,
        "started_at": t0,
        "source_mode": source_mode,
        "requested_device": device,
        "effective_device": None,
        "torch_version": torch.__version__,
        "params": {
            "max_rank": max_rank,
            "min_lora_dim": min_lora_dim,
            "oversample": oversample,
            "niter": niter,
            "include_vocab": include_vocab,
        },
        "counts": {
            "visual_identical_skipped": 0,
            "visual_verified": 0,
            "exact_small_saved": 0,
            "lowrank_saved": 0,
            "resumed_shards": 0,
        },
        "shards": {},
        "tensor_stats": {},
    }
    atomic_write_json(report_path, report)

    try:
        report["failure_phase"] = "output-dir-setup"
        atomic_write_json(report_path, report)
        shards_dir = out_dir / "shards"
        shards_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = out_dir / "manifest.json"
        report["last_trustworthy_evidence"] = "output-dir-setup"

        dev = resolve_device(device)
        report["effective_device"] = str(dev)
        report["failure_phase"] = "source-headers"
        atomic_write_json(report_path, report)

        if source_mode == "local-dir":
            if bfl_dir is None or qwen_dir is None:
                raise ValueError("local-dir mode requires bfl_dir and qwen_dir")
            bfl_reader: Any = LocalSafetensorsReader(Path(bfl_dir))
            qwen_reader: Any = LocalSafetensorsReader(Path(qwen_dir))
            report["sources"] = {
                "bfl_dir": str(bfl_dir),
                "qwen_dir": str(qwen_dir),
                "bfl_header_digests": bfl_reader.header_digests,
                "qwen_header_digests": qwen_reader.header_digests,
                "bfl_file_digests": bfl_reader.file_digests,
                "qwen_file_digests": qwen_reader.file_digests,
            }
        elif source_mode == "hf-range":
            bfl_reader = HFRangeSafetensorsReader(bfl_repo, bfl_rev, ["model.safetensors"])
            qwen_shards = [f"model.safetensors-0000{i}-of-00004.safetensors" for i in range(1, 5)]
            qwen_reader = HFRangeSafetensorsReader(qwen_repo, qwen_rev, qwen_shards)
            report["sources"] = {
                "bfl_repo": bfl_repo,
                "bfl_revision": bfl_rev,
                "qwen_repo": qwen_repo,
                "qwen_revision": qwen_rev,
                "bfl_header_digests": bfl_reader.header_digests,
                "qwen_header_digests": qwen_reader.header_digests,
            }
        else:
            raise ValueError(f"Unsupported source_mode: {source_mode}")

        report["last_trustworthy_evidence"] = "source-headers"

        bfl_keys = bfl_reader.keys()
        qwen_key_set = set(qwen_reader.keys())
        missing = [k for k in bfl_keys if k not in qwen_key_set]
        if missing:
            raise KeyError(f"{len(missing)} BFL keys missing in Qwen source: {missing[:5]}")

        groups: Dict[str, List[str]] = {}
        visual_keys: List[str] = []
        for k in sorted(bfl_keys):
            meta_bfl = bfl_reader.get_meta(k)
            meta_qwen = qwen_reader.get_meta(k)
            if tuple(meta_bfl["shape"]) != tuple(meta_qwen["shape"]):
                raise ValueError(f"Shape mismatch on {k}: {meta_bfl['shape']} vs {meta_qwen['shape']}")
            grp = shard_group_for_key(k, min_lora_dim, tuple(meta_bfl["shape"]))
            if grp == "visual":
                visual_keys.append(k)
            elif grp == "vocab_embed_lm_head" and not include_vocab:
                continue
            else:
                groups.setdefault(grp, []).append(k)

        all_expected_groups = sorted(
            groups.keys(),
            key=lambda g: (0 if g == "exact_small" else (2 if g == "vocab_embed_lm_head" else 1), g),
        )
        expected_exact_count = len(groups.get("exact_small", []))
        expected_lowrank_count = sum(len(v) for k, v in groups.items() if k != "exact_small")

        extraction_signature_payload = {
            "source_mode": source_mode,
            "sources": report["sources"],
            "params": report["params"],
            "expected_groups": {g: groups[g] for g in all_expected_groups},
        }
        extraction_signature_sha256 = hashlib.sha256(
            json.dumps(extraction_signature_payload, sort_keys=True).encode("utf-8")
        ).hexdigest()
        report["extraction_signature_sha256"] = extraction_signature_sha256

        # Verify visual identity on sampled (or all small fixture) visual tensors
        report["failure_phase"] = "visual-identity-check"
        atomic_write_json(report_path, report)
        if visual_keys:
            step = max(1, len(visual_keys) // max(1, verify_visual_samples))
            sampled_vis = visual_keys[::step][:verify_visual_samples]
            for vk in sampled_vis:
                vb = bfl_reader.get_tensor(vk).float()
                vq = qwen_reader.get_tensor(vk).float()
                max_diff = float((vb - vq).abs().max().item())
                if max_diff > 0.0:
                    raise ValueError(f"Vision tensor {vk} is not identical between BFL and Qwen (max_abs={max_diff})")
                report["counts"]["visual_verified"] += 1
            report["counts"]["visual_identical_skipped"] = len(visual_keys)
        report["last_trustworthy_evidence"] = "visual-identity-check"

        existing_manifest: Dict[str, Any] = {}
        signature_matches_prior = False
        if resume and manifest_path.exists():
            try:
                existing_manifest = json.loads(manifest_path.read_text())
                signature_matches_prior = (
                    existing_manifest.get("extraction_signature_sha256") == extraction_signature_sha256
                )
            except Exception:
                existing_manifest = {}
                signature_matches_prior = False

        ordered_groups = list(all_expected_groups)
        if selected_shards is not None:
            unknown = set(selected_shards) - set(ordered_groups)
            if unknown:
                raise ValueError(f"Unknown shard names in selected_shards: {sorted(unknown)}")
            ordered_groups = [g for g in ordered_groups if g in set(selected_shards)]

        def _verify_existing_shard(grp_name: str, prior_shard_rec: Any, expected_keys_list: List[str]) -> bool:
            if not isinstance(prior_shard_rec, dict):
                return False
            if prior_shard_rec.get("expected_keys") != expected_keys_list:
                return False
            sf_path = shards_dir / f"{grp_name}.safetensors"
            if not sf_path.is_file() or sf_path.stat().st_size == 0:
                return False
            rec_size = prior_shard_rec.get("size_bytes")
            if rec_size is not None and sf_path.stat().st_size != int(rec_size):
                return False
            rec_sha = prior_shard_rec.get("sha256")
            if not rec_sha or sha256_file(sf_path) != rec_sha:
                return False
            try:
                with sf_path.open("rb") as fh:
                    raw_len = fh.read(8)
                    if len(raw_len) != 8:
                        return False
                    hlen = struct.unpack("<Q", raw_len)[0]
                    header_obj = json.loads(fh.read(hlen).decode("utf-8"))
            except Exception:
                return False
            t_stats = prior_shard_rec.get("tensor_stats", {})
            if not isinstance(t_stats, dict) or sorted(t_stats.keys()) != sorted(expected_keys_list):
                return False
            for tk in expected_keys_list:
                mode = t_stats.get(tk, {}).get("mode")
                if grp_name == "exact_small":
                    if mode != "exact" or f"{tk}.delta" not in header_obj or f"{tk}.bfl" not in header_obj:
                        return False
                else:
                    if mode != "lowrank_svd" or f"{tk}.lora_B" not in header_obj or f"{tk}.lora_A" not in header_obj:
                        return False
            return True

        merged_shards: Dict[str, Any] = {}
        if resume and signature_matches_prior:
            for existing_grp, existing_rec in existing_manifest.get("shards", {}).items():
                if existing_grp in groups and existing_grp not in ordered_groups:
                    if _verify_existing_shard(existing_grp, existing_rec, groups[existing_grp]):
                        merged_shards[existing_grp] = existing_rec

        def _write_current_manifest() -> None:
            present_groups = set(merged_shards.keys())
            total_exact = sum(
                1
                for g_info in merged_shards.values()
                for st in g_info.get("tensor_stats", {}).values()
                if st.get("mode") == "exact"
            )
            total_lr = sum(
                1
                for g_info in merged_shards.values()
                for st in g_info.get("tensor_stats", {}).values()
                if st.get("mode") == "lowrank_svd"
            )
            is_complete = (
                present_groups == set(all_expected_groups)
                and total_exact == expected_exact_count
                and total_lr == expected_lowrank_count
            )
            manifest_payload = {
                "schema": "kaminos.bfl-pup-delta-manifest.v1",
                "complete": is_complete,
                "extraction_signature_sha256": extraction_signature_sha256,
                "max_rank": max_rank,
                "min_lora_dim": min_lora_dim,
                "expected_shard_groups": all_expected_groups,
                "expected_exact_count": expected_exact_count,
                "expected_lowrank_count": expected_lowrank_count,
                "sources": report["sources"],
                "params": report["params"],
                "counts": report["counts"],
                "shards": merged_shards,
            }
            atomic_write_json(manifest_path, manifest_payload)

        for grp in ordered_groups:
            keys_in_grp = groups[grp]
            shard_file = shards_dir / f"{grp}.safetensors"
            prior_shard = existing_manifest.get("shards", {}).get(grp) if signature_matches_prior else None
            if (
                resume
                and signature_matches_prior
                and _verify_existing_shard(grp, prior_shard, keys_in_grp)
            ):
                report["shards"][grp] = prior_shard
                merged_shards[grp] = prior_shard
                report["counts"]["resumed_shards"] += 1
                if grp == "exact_small":
                    report["counts"]["exact_small_saved"] += len(keys_in_grp)
                else:
                    report["counts"]["lowrank_saved"] += len(keys_in_grp)
                for k, st in prior_shard.get("tensor_stats", {}).items():
                    report["tensor_stats"][k] = st
                report["last_trustworthy_evidence"] = f"resumed-{grp}"
                _write_current_manifest()
                atomic_write_json(report_path, report)
                continue

            report["failure_phase"] = f"extract-{grp}"
            atomic_write_json(report_path, report)
            shard_t0 = time.time()
            shard_tensors: Dict[str, torch.Tensor] = {}
            shard_stats: Dict[str, Any] = {}

            def _fetch_pair(k: str) -> Tuple[str, torch.Tensor, torch.Tensor]:
                return k, bfl_reader.get_tensor(k), qwen_reader.get_tensor(k)

            effective_prefetch = min(max(1, prefetch_workers), 2) if dev.type == "mps" else max(1, prefetch_workers)
            with concurrent.futures.ThreadPoolExecutor(max_workers=effective_prefetch) as pool:
                in_flight: List[concurrent.futures.Future] = []
                key_iter = iter(keys_in_grp)
                for _ in range(min(len(keys_in_grp), effective_prefetch)):
                    in_flight.append(pool.submit(_fetch_pair, next(key_iter)))

                while in_flight:
                    fut = in_flight.pop(0)
                    try:
                        nxt_k = next(key_iter)
                        in_flight.append(pool.submit(_fetch_pair, nxt_k))
                    except StopIteration:
                        pass

                    k, bfl_t, qwen_t = fut.result()
                    if grp == "exact_small":
                        use_f32 = bfl_t.dtype == torch.float32 or qwen_t.dtype == torch.float32
                        target_dtype = torch.float32 if use_f32 else torch.bfloat16
                        delta_t = (bfl_t.float() - qwen_t.float()).to(target_dtype).contiguous()
                        shard_tensors[f"{k}.delta"] = delta_t
                        shard_tensors[f"{k}.bfl"] = bfl_t.contiguous()
                        shard_tensors[f"{k}.qwen"] = qwen_t.contiguous()
                        f_delta = float(torch.linalg.norm(delta_t.float()).item())
                        f_base = float(torch.linalg.norm(qwen_t.float()).item())
                        shard_stats[k] = {
                            "mode": "exact",
                            "shape": list(bfl_t.shape),
                            "dtype": str(target_dtype).removeprefix("torch."),
                            "frob_delta": round(f_delta, 6),
                            "frob_base": round(f_base, 6),
                            "rel_l2": round(f_delta / max(f_base, 1e-12), 6),
                        }
                        report["counts"]["exact_small_saved"] += 1
                    else:
                        lora_b, lora_a, sv_cpu, st = lowrank_svd_decompose(
                            bfl_t,
                            qwen_t,
                            device=dev,
                            max_rank=max_rank,
                            oversample=oversample,
                            niter=niter,
                        )
                        shard_tensors[f"{k}.lora_B"] = lora_b
                        shard_tensors[f"{k}.lora_A"] = lora_a
                        shard_tensors[f"{k}.singular_values"] = sv_cpu
                        st["mode"] = "lowrank_svd"
                        shard_stats[k] = st
                        report["counts"]["lowrank_saved"] += 1
                        report["last_completed_tensor"] = k
                        atomic_write_json(report_path, report)

                    del bfl_t, qwen_t
                    report["tensor_stats"][k] = shard_stats[k]

            if dev.type == "mps":
                torch.mps.synchronize()
                torch.mps.empty_cache()

            tmp_shard = shard_file.with_suffix(".safetensors.tmp")
            save_file(shard_tensors, str(tmp_shard))
            tmp_shard.replace(shard_file)
            shard_digest = sha256_file(shard_file)
            shard_bytes = shard_file.stat().st_size

            shard_record = {
                "file": f"shards/{shard_file.name}",
                "sha256": shard_digest,
                "size_bytes": shard_bytes,
                "tensor_count": len(keys_in_grp),
                "expected_keys": keys_in_grp,
                "elapsed_seconds": round(time.time() - shard_t0, 3),
                "tensor_stats": shard_stats,
            }
            report["shards"][grp] = shard_record
            merged_shards[grp] = shard_record
            report["last_trustworthy_evidence"] = f"extracted-{grp}"

            _write_current_manifest()
            atomic_write_json(report_path, report)

        _write_current_manifest()
        report["status"] = "complete"
        report["failure_phase"] = None
        report["finished_at"] = time.time()
        report["elapsed_seconds"] = round(report["finished_at"] - t0, 3)
        atomic_write_json(report_path, report)
        return report

    except BaseException as exc:
        report["status"] = "failed"
        report["error_message"] = str(exc)
        report["traceback"] = traceback.format_exc()
        report["finished_at"] = time.time()
        report["elapsed_seconds"] = round(report["finished_at"] - t0, 3)
        atomic_write_json(report_path, report)
        raise


def apply_extracted_delta(
    base_tensors: Dict[str, torch.Tensor],
    adapter_dir: Path,
    rank: int = 64,
    include_exact_small: bool = True,
    include_vocab: bool = True,
) -> Dict[str, torch.Tensor]:
    """Return a dict of adapted tensors at the chosen rank <= max_rank."""
    adapter_dir = Path(adapter_dir)
    manifest = json.loads((adapter_dir / "manifest.json").read_text())
    out = dict(base_tensors)

    for grp, shard_info in manifest["shards"].items():
        if grp == "exact_small" and not include_exact_small:
            continue
        if grp == "vocab_embed_lm_head" and not include_vocab:
            continue
        shard_path = adapter_dir / shard_info["file"]
        with safe_open(str(shard_path), framework="pt", device="cpu") as sf:
            for k, st in shard_info["tensor_stats"].items():
                if k not in out:
                    continue
                orig = out[k]
                if st["mode"] == "exact":
                    out[k] = sf.get_tensor(f"{k}.bfl").to(orig.dtype)
                elif st["mode"] == "lowrank_svd":
                    b = sf.get_tensor(f"{k}.lora_B")
                    a = sf.get_tensor(f"{k}.lora_A")
                    r_slice = min(rank, b.shape[1], a.shape[0])
                    delta = b[:, :r_slice].float() @ a[:r_slice, :].float()
                    out[k] = (orig.float() + delta).to(orig.dtype)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract BFL PUP -> Qwen3.5-9B switchable delta/LoRA adapter.")
    parser.add_argument("--source-mode", choices=["hf-range", "local-dir"], default="hf-range")
    parser.add_argument("--bfl-dir", type=Path, default=None)
    parser.add_argument("--qwen-dir", type=Path, default=None)
    parser.add_argument("--bfl-repo", default=DEFAULT_BFL_REPO)
    parser.add_argument("--bfl-rev", default=DEFAULT_BFL_REV)
    parser.add_argument("--qwen-repo", default=DEFAULT_QWEN_REPO)
    parser.add_argument("--qwen-rev", default=DEFAULT_QWEN_REV)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--device", choices=["mps", "cpu"], default="mps")
    parser.add_argument("--max-rank", type=int, default=256)
    parser.add_argument("--min-lora-dim", type=int, default=1024)
    parser.add_argument("--oversample", type=int, default=32)
    parser.add_argument("--niter", type=int, default=4)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--skip-vocab", action="store_true")
    parser.add_argument("--prefetch-workers", type=int, default=2)
    parser.add_argument("--shards", default=None, help="Comma-separated shard names to extract")
    args = parser.parse_args()

    selected = [s.strip() for s in args.shards.split(",") if s.strip()] if args.shards else None

    res = run_extraction(
        source_mode=args.source_mode,
        bfl_dir=args.bfl_dir,
        bfl_repo=args.bfl_repo,
        bfl_rev=args.bfl_rev,
        qwen_dir=args.qwen_dir,
        qwen_repo=args.qwen_repo,
        qwen_rev=args.qwen_rev,
        out_dir=args.out_dir,
        report_path=args.report,
        device=args.device,
        max_rank=args.max_rank,
        min_lora_dim=args.min_lora_dim,
        oversample=args.oversample,
        niter=args.niter,
        resume=not args.no_resume,
        include_vocab=not args.skip_vocab,
        prefetch_workers=args.prefetch_workers,
        selected_shards=selected,
    )
    print(json.dumps({"status": res["status"], "counts": res["counts"], "elapsed_seconds": res["elapsed_seconds"]}))


if __name__ == "__main__":
    main()
