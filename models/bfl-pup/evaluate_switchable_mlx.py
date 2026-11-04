"""Evaluation harness for the switchable BFL prompt-expansion delta adapter on a resident MLX Qwen3.5-9B.

Loads the base MLX model once (`model_load_count == 1`), attaches `MLXSwitchableDeltaController`,
switches across adapter modes/ranks (`off`, `on_r64`, `on_r128`, `on_r256`) while enforcing
recurrent/KV cache resets on every transition, and writes a durable JSON report with
fail-first false-closure guards.
"""
import argparse
import hashlib
import json
import re
import time
import traceback
import uuid
from importlib.metadata import version
from pathlib import Path
from typing import Any, Dict, List, Optional

SAMPLING = dict(temperature=0.0, top_p=0.95, top_k=20, min_p=0.0, max_tokens=1024)
SCAFFOLD = (
    "Reference images follow in order (the first image, the second image, ...).\n"
    "User request: {instruction}\n"
    "Output the caption."
)


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(path)


def _word_jaccard(a: str, b: str) -> float:
    wa = set(re.findall(r"[a-z0-9']+", a.lower()))
    wb = set(re.findall(r"[a-z0-9']+", b.lower()))
    if not wa and not wb:
        return 1.0
    if not wa or not wb:
        return 0.0
    return round(len(wa & wb) / len(wa | wb), 4)


def generated_presence_penalty(penalty: float):
    """Match vLLM/BFL PUP: penalize generated tokens only, never the prompt."""
    prompt_length = None

    def process(tokens, logits):
        nonlocal prompt_length
        if prompt_length is None:
            prompt_length = tokens.size
        generated = tokens[prompt_length:]
        if generated.size:
            logits[:, generated] = logits[:, generated] - penalty
        return logits

    return process


def _require_bool(val: Any, field_name: str) -> bool:
    if not isinstance(val, bool):
        raise ValueError(f"{field_name} must be a boolean (true/false), got {val!r}")
    return val


def validate_adapter_complete(
    adapter_dir: Path,
    require_lowrank: bool = True,
    allow_partial: bool = False,
) -> Dict[str, Any]:
    import struct

    _require_bool(require_lowrank, "require_lowrank")
    _require_bool(allow_partial, "allow_partial")
    manifest_path = Path(adapter_dir) / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError(f"Missing adapter manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    shards = manifest.get("shards", {})
    if not shards:
        raise RuntimeError(f"Adapter manifest contains no shards: {manifest_path}")

    lowrank_count = 0
    exact_count = 0
    for grp, info in shards.items():
        if not isinstance(info, dict):
            raise RuntimeError(f"Adapter shard {grp} entry must be a JSON object")
        rel_file = info.get("file")
        if not rel_file:
            raise RuntimeError(f"Adapter shard {grp} missing file field")
        shard_file = Path(adapter_dir) / rel_file
        if not shard_file.is_file() or shard_file.stat().st_size == 0:
            raise RuntimeError(f"Missing adapter shard for group {grp}: {shard_file}")

        recorded_size = info.get("size_bytes")
        actual_size = shard_file.stat().st_size
        if recorded_size is not None and actual_size != int(recorded_size):
            raise RuntimeError(
                f"Adapter shard {grp} size_bytes mismatch: actual={actual_size} != manifest={recorded_size}"
            )

        recorded_sha = info.get("sha256")
        if not allow_partial and (not isinstance(recorded_sha, str) or len(recorded_sha) != 64):
            raise RuntimeError(
                f"Incomplete adapter shard {grp}: missing or invalid sha256={recorded_sha!r} in strict mode"
            )
        if recorded_sha is not None:
            actual_sha = hashlib.sha256(shard_file.read_bytes()).hexdigest()
            if actual_sha != recorded_sha:
                raise RuntimeError(
                    f"Adapter shard {grp} SHA-256 mismatch: actual={actual_sha} != manifest={recorded_sha}"
                )

        try:
            with shard_file.open("rb") as sf_fh:
                raw_len = sf_fh.read(8)
                if len(raw_len) != 8:
                    raise RuntimeError("truncated header length")
                hlen = struct.unpack("<Q", raw_len)[0]
                if hlen <= 0 or hlen > actual_size - 8:
                    raise RuntimeError(f"invalid header length {hlen}")
                header_obj = json.loads(sf_fh.read(hlen).decode("utf-8"))
        except Exception as exc:
            raise RuntimeError(f"Corrupt safetensors shard {grp} ({shard_file}): {exc}") from exc

        t_stats = info.get("tensor_stats", {})
        if not isinstance(t_stats, dict):
            raise RuntimeError(f"Adapter shard {grp} tensor_stats must be a JSON object")
        expected_keys = info.get("expected_keys")
        if expected_keys is not None and sorted(expected_keys) != sorted(t_stats.keys()):
            raise RuntimeError(
                f"Adapter shard {grp} expected_keys mismatch vs tensor_stats: "
                f"expected_keys={expected_keys}, tensor_stats={sorted(t_stats.keys())}"
            )
        for k, st in t_stats.items():
            mode = st.get("mode")
            if mode == "lowrank_svd":
                if not allow_partial and (f"{k}.lora_B" not in header_obj or f"{k}.lora_A" not in header_obj):
                    raise RuntimeError(
                        f"Adapter shard {grp} missing lowrank_svd tensors for {k} in safetensors header"
                    )
                lowrank_count += 1
            elif mode == "exact":
                if not allow_partial and (f"{k}.delta" not in header_obj or f"{k}.bfl" not in header_obj):
                    raise RuntimeError(
                        f"Adapter shard {grp} missing exact tensors (.delta/.bfl) for {k} in safetensors header"
                    )
                exact_count += 1

    if require_lowrank and lowrank_count == 0:
        raise RuntimeError("Adapter manifest contains zero lowrank_svd tensors; refusing partial exact-only evaluation.")

    expected_groups = manifest.get("expected_shard_groups")
    expected_exact = manifest.get("expected_exact_count")
    expected_lowrank = manifest.get("expected_lowrank_count")
    manifest_complete = manifest.get("complete")

    if not allow_partial:
        if manifest_complete is not True:
            raise RuntimeError(
                f"Incomplete adapter in {adapter_dir}: manifest 'complete' is {manifest_complete!r} "
                f"(shards present: {sorted(shards.keys())})"
            )
        if not expected_groups or set(shards.keys()) != set(expected_groups):
            raise RuntimeError(
                f"Incomplete adapter shard inventory: present={sorted(shards.keys())}, "
                f"expected={expected_groups}"
            )
        if (
            expected_exact is None
            or isinstance(expected_exact, bool)
            or not isinstance(expected_exact, int)
            or expected_exact <= 0
        ):
            raise RuntimeError(
                f"Incomplete adapter manifest: missing or invalid expected_exact_count={expected_exact!r} in strict mode"
            )
        if (
            expected_lowrank is None
            or isinstance(expected_lowrank, bool)
            or not isinstance(expected_lowrank, int)
            or expected_lowrank <= 0
        ):
            raise RuntimeError(
                f"Incomplete adapter manifest: missing or invalid expected_lowrank_count={expected_lowrank!r} in strict mode"
            )
        if exact_count == 0 or exact_count != int(expected_exact):
            raise RuntimeError(
                f"Incomplete adapter exact-small coverage: exact_count={exact_count}, expected={expected_exact}"
            )
        if lowrank_count != int(expected_lowrank):
            raise RuntimeError(
                f"Incomplete adapter lowrank coverage: lowrank_count={lowrank_count}, expected={expected_lowrank}"
            )

    return {
        "manifest_path": str(manifest_path),
        "complete": bool(manifest_complete),
        "allow_partial": bool(allow_partial),
        "max_rank": int(manifest["max_rank"]),
        "shard_groups": sorted(shards.keys()),
        "lowrank_tensor_count": lowrank_count,
        "exact_tensor_count": exact_count,
    }


def inspect_model_dir_provenance(
    model_dir: Path,
    base_role: str,
    adapter_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    import struct

    model_dir = Path(model_dir)
    cfg_path = model_dir / "config.json"
    if not cfg_path.is_file():
        raise RuntimeError(f"Missing model config.json in {model_dir}")
    cfg_bytes = cfg_path.read_bytes()
    cfg_sha256 = hashlib.sha256(cfg_bytes).hexdigest()
    cfg_text = cfg_bytes.decode("utf-8", errors="replace")

    readme_path = model_dir / "README.md"
    readme_text = readme_path.read_text(errors="replace") if readme_path.is_file() else ""
    readme_sha256 = hashlib.sha256(readme_path.read_bytes()).hexdigest() if readme_path.is_file() else None

    header_digests: Dict[str, str] = {}
    file_digests: Dict[str, str] = {}
    sf_files = sorted(model_dir.glob("*.safetensors"))
    for sf in sf_files:
        with sf.open("rb") as f:
            raw_len = f.read(8)
            if len(raw_len) == 8:
                hlen = struct.unpack("<Q", raw_len)[0]
                header_digests[sf.name] = hashlib.sha256(f.read(hlen)).hexdigest()

    combined_text = f"{model_dir.name}\n{cfg_text}\n{readme_text}".lower()
    has_bfl_marker = ("flux-3-image-klein-pup" in combined_text) or ("black-forest-labs" in combined_text)
    has_qwen_marker = ("qwen3.5-9b" in combined_text) or ("qwen3_5" in combined_text)

    if base_role == "qwen" and has_bfl_marker:
        raise RuntimeError(
            f"Model directory {model_dir} provenance identifies BFL PUP checkpoint, "
            f"which contradicts requested base_role='qwen'"
        )
    if base_role == "bfl" and not has_bfl_marker and has_qwen_marker:
        raise RuntimeError(
            f"Model directory {model_dir} provenance identifies Qwen checkpoint without BFL markers, "
            f"which contradicts requested base_role='bfl'"
        )

    provenance_mode = "marker_only"
    if adapter_dir is not None:
        if not header_digests:
            raise RuntimeError(
                f"Model directory {model_dir} provenance unverified: no .safetensors weight files found"
            )
        manifest_path = Path(adapter_dir) / "manifest.json"
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text())
            sources = manifest.get("sources", {})
            expected_hdr = sources.get(f"{base_role}_header_digests")
            expected_files = sources.get(f"{base_role}_file_digests")
            conv_path = model_dir / "conversion_provenance.json"
            if conv_path.is_file():
                conv = json.loads(conv_path.read_text())
                if conv.get("base_role") != base_role:
                    raise RuntimeError(
                        f"Model directory {model_dir} conversion_provenance.json base_role={conv.get('base_role')!r} "
                        f"contradicts requested base_role={base_role!r}"
                    )
                if conv.get("converted_config_sha256") != cfg_sha256:
                    raise RuntimeError(
                        f"Model directory {model_dir} conversion_provenance.json config_sha256 mismatch"
                    )
                if conv.get("converted_header_digests") != header_digests:
                    raise RuntimeError(
                        f"Model directory {model_dir} conversion_provenance.json safetensors header digest mismatch"
                    )
                if expected_hdr and conv.get("source_header_digests") != expected_hdr:
                    raise RuntimeError(
                        f"Model directory {model_dir} conversion_provenance.json source_header_digests do not match "
                        f"adapter manifest {base_role}_header_digests"
                    )
                provenance_mode = "verified_conversion_provenance"
            else:
                if expected_hdr and header_digests != expected_hdr:
                    raise RuntimeError(
                        f"Model directory {model_dir} provenance unverified: safetensors header digests "
                        f"do not match adapter manifest {base_role}_header_digests or conversion_provenance.json"
                    )
                if expected_files:
                    for sf in sf_files:
                        h = hashlib.sha256()
                        with sf.open("rb") as fh:
                            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                                h.update(chunk)
                        file_digests[sf.name] = h.hexdigest()
                    if file_digests != expected_files:
                        raise RuntimeError(
                            f"Model directory {model_dir} provenance unverified: safetensors file digests "
                            f"do not match adapter manifest {base_role}_file_digests"
                        )
                provenance_mode = "pinned_source_digests"

            exact_info = manifest.get("shards", {}).get("exact_small")
            if isinstance(exact_info, dict) and exact_info.get("file"):
                exact_sf = Path(adapter_dir) / exact_info["file"]
                if exact_sf.is_file():
                    try:
                        import torch
                        from safetensors import safe_open

                        model_key_map = {}
                        for sf in sf_files:
                            with safe_open(str(sf), framework="pt") as msf:
                                for mk in msf.keys():
                                    model_key_map[mk] = sf
                        checked = 0
                        with safe_open(str(exact_sf), framework="pt") as esf:
                            esf_keys = set(esf.keys())
                            for hk in sorted(exact_info.get("tensor_stats", {}).keys()):
                                if f"{hk}.bfl" not in esf_keys or f"{hk}.delta" not in esf_keys:
                                    continue
                                cand_keys = [
                                    hk,
                                    hk.replace("model.language_model.", "language_model.model."),
                                    hk.replace("model.language_model.", "model."),
                                ]
                                matched_mk = next((ck for ck in cand_keys if ck in model_key_map), None)
                                if matched_mk is None:
                                    continue
                                with safe_open(str(model_key_map[matched_mk]), framework="pt") as msf:
                                    m_t = msf.get_tensor(matched_mk)
                                if m_t.dtype not in (torch.bfloat16, torch.float16, torch.float32):
                                    continue
                                bfl_t = esf.get_tensor(f"{hk}.bfl").float()
                                delta_t = esf.get_tensor(f"{hk}.delta").float()
                                qwen_t = (
                                    esf.get_tensor(f"{hk}.qwen").float()
                                    if f"{hk}.qwen" in esf_keys
                                    else (bfl_t - delta_t)
                                )
                                exp_t = qwen_t if base_role == "qwen" else bfl_t
                                if m_t.shape != exp_t.shape:
                                    continue
                                m_f32 = m_t.float()
                                d_raw = float(torch.linalg.norm(m_f32 - exp_t).item())
                                d_off_f32 = float(torch.linalg.norm(m_f32 - (exp_t + 1.0)).item())
                                d_off_cast = float(torch.linalg.norm(m_f32 - (exp_t + 1.0).to(m_t.dtype).float()).item())
                                best_d = min(d_raw, d_off_f32, d_off_cast)
                                ref_n = max(float(torch.linalg.norm(exp_t).item()), 1e-6)
                                if best_d > max(0.02 * ref_n, 2e-2):
                                    raise RuntimeError(
                                        f"Model directory {model_dir} provenance weight mismatch on {hk} "
                                        f"for base_role={base_role!r} (dist={best_d:.6f}, ref_norm={ref_n:.6f})"
                                    )
                                checked += 1
                                if checked >= 8:
                                    break
                    except RuntimeError:
                        raise
                    except Exception:
                        pass

    return {
        "model_dir": str(model_dir),
        "config_sha256": cfg_sha256,
        "readme_sha256": readme_sha256,
        "safetensors_header_digests": header_digests,
        "detected_bfl_marker": has_bfl_marker,
        "detected_qwen_marker": has_qwen_marker,
        "provenance_mode": provenance_mode,
    }


def validate_generation_observation(obs: Dict[str, Any]) -> None:
    if obs.get("effective_backend") != "mlx-metal":
        raise RuntimeError(f"Unexpected effective_backend: {obs.get('effective_backend')!r} (expected 'mlx-metal')")
    if not str(obs.get("output", "")).strip():
        raise RuntimeError("Empty generation output")
    if obs.get("finish_reason") != "stop":
        raise RuntimeError(f"Non-terminal finish_reason: {obs.get('finish_reason')!r} (expected 'stop')")


def _resolve_finish_reason(final_chunk: Any, stop_ids: List[int], max_tokens: int) -> Optional[str]:
    if final_chunk is None:
        return None
    fr = getattr(final_chunk, "finish_reason", None)
    if fr is not None:
        return str(fr)
    tok = getattr(final_chunk, "token", None)
    if tok is not None and int(tok) in stop_ids:
        return "stop"
    gen_toks = getattr(final_chunk, "generation_tokens", 0)
    if gen_toks and int(gen_toks) >= int(max_tokens):
        return "length"
    return None


def run_switchable_evaluation(
    model_dir: Path,
    adapter_dir: Path,
    report_path: Path,
    base_role: str = "qwen",
    allow_bfl_residual_approx: bool = False,
    allow_partial_adapter: bool = False,
    modes: Optional[List[Dict[str, Any]]] = None,
    cases: Optional[List[Dict[str, Any]]] = None,
    system_prompts_path: Optional[Path] = None,
    max_tokens: int = 512,
) -> Dict[str, Any]:
    t0 = time.monotonic()
    model_dir = Path(model_dir)
    adapter_dir = Path(adapter_dir)
    report_path = Path(report_path)

    report: Dict[str, Any] = {
        "schema": "kaminos.bfl-pup.switchable-mlx-eval.v1",
        "status": "running",
        "failure_phase": "startup",
        "model_dir": str(model_dir),
        "adapter_dir": str(adapter_dir),
        "base_role": base_role,
        "allow_bfl_residual_approx": allow_bfl_residual_approx if isinstance(allow_bfl_residual_approx, bool) else None,
        "model_load_count": 0,
        "last_trustworthy_evidence": None,
        "observations": [],
        "attempted_observations": [],
    }
    _atomic_write_json(report_path, report)

    try:
        report["failure_phase"] = "config-validation"
        _atomic_write_json(report_path, report)
        allow_bfl_residual_approx = _require_bool(allow_bfl_residual_approx, "allow_bfl_residual_approx")
        allow_partial_adapter = _require_bool(allow_partial_adapter, "allow_partial_adapter")
        report["allow_bfl_residual_approx"] = allow_bfl_residual_approx
        if not isinstance(modes, list) or len(modes) == 0:
            raise ValueError("modes must be a non-empty list of mode specifications")
        for idx, m_spec in enumerate(modes):
            if not isinstance(m_spec, dict) or "name" not in m_spec or "enabled" not in m_spec:
                raise ValueError(f"modes[{idx}] must be a dict containing 'name' and 'enabled'")
            _require_bool(m_spec["enabled"], f"modes[{idx}].enabled")
            if "rank" in m_spec and m_spec["rank"] is not None:
                if isinstance(m_spec["rank"], bool) or not isinstance(m_spec["rank"], int) or m_spec["rank"] < 0:
                    raise ValueError(f"modes[{idx}].rank must be a non-negative integer, got {m_spec['rank']!r}")
        if not isinstance(cases, list) or len(cases) == 0:
            raise ValueError("cases must be a non-empty list of prompt evaluation cases")
        for idx, c_spec in enumerate(cases):
            if not isinstance(c_spec, dict) or "id" not in c_spec or "task" not in c_spec or "prompt" not in c_spec:
                raise ValueError(f"cases[{idx}] must be a dict containing 'id', 'task', and 'prompt'")
        if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens <= 0:
            raise ValueError(f"max_tokens must be a positive integer, got {max_tokens!r}")
        report["last_trustworthy_evidence"] = "config-validation"

        report["failure_phase"] = "role-validation"
        _atomic_write_json(report_path, report)
        if base_role not in ("qwen", "bfl"):
            raise ValueError(f"Unsupported base_role: {base_role!r}; expected 'qwen' or 'bfl'")
        if base_role == "bfl" and not allow_bfl_residual_approx:
            raise RuntimeError(
                "base_role='bfl' retains the unextracted SVD tail residual E_R = Delta_W - Delta_W_R and "
                "cannot establish Qwen-resident adapter sufficiency; use base_role='qwen' or pass "
                "allow_bfl_residual_approx=True for an explicitly labeled residual approximation."
            )
        report["last_trustworthy_evidence"] = "role-validation"

        report["failure_phase"] = "adapter-validation"
        _atomic_write_json(report_path, report)
        adapter_summary = validate_adapter_complete(
            adapter_dir, require_lowrank=True, allow_partial=allow_partial_adapter
        )
        report["adapter_summary"] = adapter_summary
        report["last_trustworthy_evidence"] = "adapter-validation"
        _atomic_write_json(report_path, report)

        report["failure_phase"] = "provenance-validation"
        _atomic_write_json(report_path, report)
        model_provenance = inspect_model_dir_provenance(
            model_dir, base_role=base_role, adapter_dir=adapter_dir
        )
        report["model_provenance"] = model_provenance
        report["last_trustworthy_evidence"] = "provenance-validation"
        _atomic_write_json(report_path, report)

        report["failure_phase"] = "backend-validation"
        _atomic_write_json(report_path, report)
        import mlx.core as mx
        from mlx_switchable_adapter import MLXSwitchableDeltaController

        if not mx.metal.is_available():
            raise RuntimeError("Metal is unavailable; no CPU fallback is permitted.")
        mx.set_default_device(mx.gpu)
        if hasattr(mx, "set_cache_limit"):
            mx.set_cache_limit(512 * 1024 * 1024)
        if hasattr(mx, "set_wired_limit") and not getattr(mx, "_kaminos_wired_limit_capped", False):
            _orig_set_wired_limit = mx.set_wired_limit
            _max_wired_bytes = 16 * 1024 * 1024 * 1024
            mx.set_wired_limit = lambda limit: _orig_set_wired_limit(
                min(int(limit), _max_wired_bytes) if int(limit) > 0 else int(limit)
            )
            mx._kaminos_wired_limit_capped = True
        effective_backend = "mlx-metal"

        prompts_file = Path(system_prompts_path) if system_prompts_path else (model_dir / "system_prompts.json")
        if not prompts_file.is_file():
            raise RuntimeError(f"Missing system_prompts.json: {prompts_file}")
        sys_prompts = json.loads(prompts_file.read_text())

        report["failure_phase"] = "loading-model"
        _atomic_write_json(report_path, report)
        from mlx_vlm import load, stream_generate

        load_t0 = time.monotonic()
        model, processor = load(str(model_dir), strict=True)
        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
        report["model_load_count"] += 1
        report["load_seconds"] = round(time.monotonic() - load_t0, 4)
        report["effective_backend"] = effective_backend
        report["mlx_version"] = version("mlx")
        report["mlx_vlm_version"] = version("mlx-vlm")
        report["system_prompts_sha256"] = hashlib.sha256(prompts_file.read_bytes()).hexdigest()
        report["last_trustworthy_evidence"] = "loading-model"
        _atomic_write_json(report_path, report)

        report["failure_phase"] = "attaching-adapter"
        _atomic_write_json(report_path, report)
        attach_t0 = time.monotonic()
        controller = MLXSwitchableDeltaController(
            model,
            adapter_dir,
            base_role=base_role,
            allow_bfl_residual_approx=allow_bfl_residual_approx,
        )
        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
        if controller.attached_lowrank_count != adapter_summary["lowrank_tensor_count"]:
            raise RuntimeError(
                f"Attached lowrank count mismatch: attached={controller.attached_lowrank_count} != "
                f"manifest={adapter_summary['lowrank_tensor_count']}"
            )
        if controller.attached_exact_count != adapter_summary["exact_tensor_count"]:
            raise RuntimeError(
                f"Attached exact count mismatch: attached={controller.attached_exact_count} != "
                f"manifest={adapter_summary['exact_tensor_count']}"
            )
        report["attach_seconds"] = round(time.monotonic() - attach_t0, 4)
        report["effective_model_semantics"] = controller.effective_model_semantics
        report["wrapped_module_count"] = len(controller._wrapped_modules)
        report["exact_swap_count"] = len(controller._exact_array_swaps)
        report["attached_lowrank_count"] = controller.attached_lowrank_count
        report["attached_exact_count"] = controller.attached_exact_count
        report["last_trustworthy_evidence"] = "attaching-adapter"
        _atomic_write_json(report_path, report)

        tokenizer = processor.tokenizer
        stop_ids = [tokenizer.convert_tokens_to_ids(t) for t in ("<|im_end|>", "<|endoftext|>")]
        tokenizer.stopping_criteria = lambda token: int(token) in stop_ids

        sampling = dict(SAMPLING)
        sampling["max_tokens"] = int(max_tokens)

        for mode_spec in modes:
            mode_name = mode_spec["name"]
            enabled = _require_bool(mode_spec["enabled"], f"mode({mode_name}).enabled")
            rank = int(mode_spec.get("rank", controller.max_rank))

            report["failure_phase"] = f"switching:{mode_name}"
            _atomic_write_json(report_path, report)
            sw_t0 = time.monotonic()
            sw_res = controller.set_mode(enabled=enabled, rank=rank)
            sw_ms = round((time.monotonic() - sw_t0) * 1000.0, 3)
            bound_epoch = controller.state_epoch

            for case in cases:
                case_id = case["id"]
                task = case["task"]
                prompt = case["prompt"]
                images = case.get("images", [])

                report["failure_phase"] = f"generating:{mode_name}:{case_id}"
                _atomic_write_json(report_path, report)
                controller.assert_cache_epoch(bound_epoch)
                if hasattr(controller, "_reset_caches_and_model_state"):
                    controller._reset_caches_and_model_state()

                if task == "vlm":
                    sys_text = case.get("system_prompt", "You are a helpful assistant.")
                    user_content = (
                        [{"type": "image"} for _ in images] + [{"type": "text", "text": prompt}]
                        if images
                        else prompt
                    )
                    messages = [{"role": "system", "content": sys_text}, {"role": "user", "content": user_content}]
                    logits_procs = []
                elif task == "i2i":
                    user_content = [{"type": "image"} for _ in images] + [
                        {"type": "text", "text": SCAFFOLD.format(instruction=prompt)}
                    ]
                    messages = [{"role": "system", "content": sys_prompts["i2i"]}, {"role": "user", "content": user_content}]
                    logits_procs = []
                else:
                    messages = [{"role": "system", "content": sys_prompts["t2i"]}, {"role": "user", "content": prompt}]
                    logits_procs = [generated_presence_penalty(1.5)]

                templater = processor if images else processor.tokenizer
                formatted = templater.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
                )

                gen_t0 = time.monotonic()
                text_out = ""
                final_chunk = None
                try:
                    for chunk in stream_generate(
                        model,
                        processor,
                        formatted,
                        image=images or None,
                        **sampling,
                        logits_processors=logits_procs,
                    ):
                        text_out += chunk.text
                        final_chunk = chunk
                except BaseException as stream_exc:
                    gen_s = round(time.monotonic() - gen_t0, 4)
                    failed_obs = {
                        "mode": mode_name,
                        "enabled": sw_res["enabled"],
                        "rank": sw_res["rank"],
                        "state_epoch": sw_res["state_epoch"],
                        "reset_performed_on_mode_entry": sw_res["reset_performed"],
                        "effective_model_semantics": sw_res["effective_model_semantics"],
                        "switch_ms": sw_ms,
                        "case_id": case_id,
                        "task": task,
                        "prompt": prompt,
                        "images": images,
                        "raw_output": text_out,
                        "output": text_out.strip(),
                        "effective_backend": effective_backend,
                        "generation_seconds": gen_s,
                        "prompt_tokens": int(final_chunk.prompt_tokens) if final_chunk else 0,
                        "generated_tokens": int(final_chunk.generation_tokens) if final_chunk else 0,
                        "peak_memory_gb": float(final_chunk.peak_memory) if final_chunk and final_chunk.peak_memory else None,
                        "finish_reason": _resolve_finish_reason(final_chunk, stop_ids, sampling["max_tokens"]),
                        "accepted": False,
                        "stream_error": str(stream_exc),
                    }
                    report["attempted_observations"].append(failed_obs)
                    _atomic_write_json(report_path, report)
                    raise
                finally:
                    if hasattr(mx, "clear_cache"):
                        mx.clear_cache()

                gen_s = round(time.monotonic() - gen_t0, 4)
                obs = {
                    "mode": mode_name,
                    "enabled": sw_res["enabled"],
                    "rank": sw_res["rank"],
                    "state_epoch": sw_res["state_epoch"],
                    "reset_performed_on_mode_entry": sw_res["reset_performed"],
                    "effective_model_semantics": sw_res["effective_model_semantics"],
                    "switch_ms": sw_ms,
                    "case_id": case_id,
                    "task": task,
                    "prompt": prompt,
                    "images": images,
                    "raw_output": text_out,
                    "output": text_out.strip(),
                    "effective_backend": effective_backend,
                    "generation_seconds": gen_s,
                    "prompt_tokens": int(final_chunk.prompt_tokens) if final_chunk else 0,
                    "generated_tokens": int(final_chunk.generation_tokens) if final_chunk else 0,
                    "peak_memory_gb": float(final_chunk.peak_memory) if final_chunk and final_chunk.peak_memory else None,
                    "finish_reason": final_chunk.finish_reason if final_chunk else None,
                    "accepted": False,
                }
                if case.get("reference_output"):
                    obs["word_jaccard_vs_reference"] = _word_jaccard(obs["output"], case["reference_output"])

                try:
                    validate_generation_observation(obs)
                except BaseException as val_exc:
                    obs["validation_error"] = str(val_exc)
                    report["attempted_observations"].append(obs)
                    _atomic_write_json(report_path, report)
                    raise

                obs["accepted"] = True
                report["attempted_observations"].append(obs)
                report["observations"].append(obs)
                report["last_trustworthy_evidence"] = f"generated:{mode_name}:{case_id}"
                _atomic_write_json(report_path, report)

        expected_obs_count = len(modes) * len(cases)
        if len(report["observations"]) != expected_obs_count or expected_obs_count == 0:
            raise RuntimeError(
                f"Observation count mismatch: recorded={len(report['observations'])}, expected={expected_obs_count}"
            )
        report["status"] = "complete"
        report["failure_phase"] = None
        report["elapsed_seconds"] = round(time.monotonic() - t0, 3)
        _atomic_write_json(report_path, report)
        return report

    except BaseException as exc:
        report["status"] = "failed"
        report["error"] = str(exc)
        report["traceback"] = traceback.format_exc()
        report["elapsed_seconds"] = round(time.monotonic() - t0, 3)
        _atomic_write_json(report_path, report)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="JSON evaluation config path")
    parser.add_argument("--report", type=Path, required=True, help="Output JSON report path")
    args = parser.parse_args()

    t0 = time.monotonic()
    early_report: Dict[str, Any] = {
        "schema": "kaminos.bfl-pup.switchable-mlx-eval.v1",
        "status": "running",
        "failure_phase": "cli-config-load",
        "config_path": str(args.config),
        "last_trustworthy_evidence": None,
    }
    _atomic_write_json(args.report, early_report)
    try:
        cfg = json.loads(args.config.read_text())
        if not isinstance(cfg, dict):
            raise ValueError("Evaluation config root must be a JSON object")
        model_dir = Path(cfg["model_dir"])
        adapter_dir = Path(cfg["adapter_dir"])
        modes = cfg["modes"]
        cases = cfg["cases"]
        base_role = str(cfg.get("base_role", "qwen"))
        allow_bfl_residual_approx = _require_bool(
            cfg.get("allow_bfl_residual_approx", False), "allow_bfl_residual_approx"
        )
        allow_partial_adapter = _require_bool(cfg.get("allow_partial_adapter", False), "allow_partial_adapter")
        sys_prompts_path = Path(cfg["system_prompts_path"]) if cfg.get("system_prompts_path") else None
        raw_max_tokens = cfg.get("max_tokens", 512)
        if isinstance(raw_max_tokens, bool):
            raise ValueError(f"Invalid boolean max_tokens: {raw_max_tokens!r}")
        max_tokens = int(raw_max_tokens)
    except BaseException as exc:
        early_report["status"] = "failed"
        early_report["error"] = str(exc)
        early_report["traceback"] = traceback.format_exc()
        early_report["elapsed_seconds"] = round(time.monotonic() - t0, 3)
        _atomic_write_json(args.report, early_report)
        raise

    run_switchable_evaluation(
        model_dir=model_dir,
        adapter_dir=adapter_dir,
        report_path=args.report,
        base_role=base_role,
        allow_bfl_residual_approx=allow_bfl_residual_approx,
        allow_partial_adapter=allow_partial_adapter,
        modes=modes,
        cases=cases,
        system_prompts_path=sys_prompts_path,
        max_tokens=max_tokens,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
