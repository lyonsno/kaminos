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


def validate_adapter_complete(
    adapter_dir: Path,
    require_lowrank: bool = True,
    allow_partial: bool = False,
) -> Dict[str, Any]:
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
        rel_file = info.get("file")
        if not rel_file:
            raise RuntimeError(f"Adapter shard {grp} missing file field")
        shard_file = Path(adapter_dir) / rel_file
        if not shard_file.is_file() or shard_file.stat().st_size == 0:
            raise RuntimeError(f"Missing adapter shard for group {grp}: {shard_file}")
        for _k, st in info.get("tensor_stats", {}).items():
            if st.get("mode") == "lowrank_svd":
                lowrank_count += 1
            elif st.get("mode") == "exact":
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
        if exact_count == 0 or (expected_exact is not None and exact_count != int(expected_exact)):
            raise RuntimeError(
                f"Incomplete adapter exact-small coverage: exact_count={exact_count}, expected={expected_exact}"
            )
        if expected_lowrank is not None and lowrank_count != int(expected_lowrank):
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


def validate_generation_observation(obs: Dict[str, Any]) -> None:
    if obs.get("effective_backend") != "mlx-metal":
        raise RuntimeError(f"Unexpected effective_backend: {obs.get('effective_backend')!r} (expected 'mlx-metal')")
    if not str(obs.get("output", "")).strip():
        raise RuntimeError("Empty generation output")
    if obs.get("finish_reason") != "stop":
        raise RuntimeError(f"Non-terminal finish_reason: {obs.get('finish_reason')!r} (expected 'stop')")


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
        "allow_bfl_residual_approx": bool(allow_bfl_residual_approx),
        "model_load_count": 0,
        "last_trustworthy_evidence": None,
        "observations": [],
    }
    _atomic_write_json(report_path, report)

    try:
        report["failure_phase"] = "role-validation"
        _atomic_write_json(report_path, report)
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

        report["failure_phase"] = "backend-validation"
        _atomic_write_json(report_path, report)
        import mlx.core as mx
        from mlx_switchable_adapter import MLXSwitchableDeltaController

        if not mx.metal.is_available():
            raise RuntimeError("Metal is unavailable; no CPU fallback is permitted.")
        mx.set_default_device(mx.gpu)
        effective_backend = "mlx-metal"

        if not (model_dir / "config.json").is_file():
            raise RuntimeError(f"Missing model config.json in {model_dir}")

        prompts_file = Path(system_prompts_path) if system_prompts_path else (model_dir / "system_prompts.json")
        if not prompts_file.is_file():
            raise RuntimeError(f"Missing system_prompts.json: {prompts_file}")
        sys_prompts = json.loads(prompts_file.read_text())

        report["failure_phase"] = "loading-model"
        _atomic_write_json(report_path, report)
        from mlx_vlm import load, stream_generate

        load_t0 = time.monotonic()
        model, processor = load(str(model_dir), strict=True)
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

        for mode_spec in (modes or []):
            mode_name = mode_spec["name"]
            enabled = bool(mode_spec["enabled"])
            rank = int(mode_spec.get("rank", controller.max_rank))

            report["failure_phase"] = f"switching:{mode_name}"
            _atomic_write_json(report_path, report)
            sw_t0 = time.monotonic()
            sw_res = controller.set_mode(enabled=enabled, rank=rank)
            sw_ms = round((time.monotonic() - sw_t0) * 1000.0, 3)
            bound_epoch = controller.state_epoch

            for case in (cases or []):
                case_id = case["id"]
                task = case["task"]
                prompt = case["prompt"]
                images = case.get("images", [])

                report["failure_phase"] = f"generating:{mode_name}:{case_id}"
                _atomic_write_json(report_path, report)
                controller.assert_cache_epoch(bound_epoch)

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
                    "output": text_out.strip(),
                    "effective_backend": effective_backend,
                    "generation_seconds": gen_s,
                    "prompt_tokens": int(final_chunk.prompt_tokens) if final_chunk else 0,
                    "generated_tokens": int(final_chunk.generation_tokens) if final_chunk else 0,
                    "peak_memory_gb": float(final_chunk.peak_memory) if final_chunk and final_chunk.peak_memory else None,
                    "finish_reason": final_chunk.finish_reason if final_chunk else None,
                }
                if case.get("reference_output"):
                    obs["word_jaccard_vs_reference"] = _word_jaccard(obs["output"], case["reference_output"])

                validate_generation_observation(obs)
                report["observations"].append(obs)
                report["last_trustworthy_evidence"] = f"generated:{mode_name}:{case_id}"
                _atomic_write_json(report_path, report)

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
        model_dir = Path(cfg["model_dir"])
        adapter_dir = Path(cfg["adapter_dir"])
        modes = cfg["modes"]
        cases = cfg["cases"]
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
        base_role=cfg.get("base_role", "qwen"),
        allow_bfl_residual_approx=bool(cfg.get("allow_bfl_residual_approx", False)),
        allow_partial_adapter=bool(cfg.get("allow_partial_adapter", False)),
        modes=modes,
        cases=cases,
        system_prompts_path=Path(cfg["system_prompts_path"]) if cfg.get("system_prompts_path") else None,
        max_tokens=int(cfg.get("max_tokens", 512)),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
