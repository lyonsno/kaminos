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

import mlx.core as mx

from mlx_switchable_adapter import MLXSwitchableDeltaController

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


def validate_adapter_complete(adapter_dir: Path, require_lowrank: bool = True) -> Dict[str, Any]:
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

    return {
        "manifest_path": str(manifest_path),
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
    base_role: str = "bfl",
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
        "model_load_count": 0,
        "last_trustworthy_evidence": None,
        "observations": [],
    }
    _atomic_write_json(report_path, report)

    try:
        report["failure_phase"] = "adapter-validation"
        _atomic_write_json(report_path, report)
        adapter_summary = validate_adapter_complete(adapter_dir, require_lowrank=True)
        report["adapter_summary"] = adapter_summary
        report["last_trustworthy_evidence"] = "adapter-validation"
        _atomic_write_json(report_path, report)

        report["failure_phase"] = "backend-validation"
        _atomic_write_json(report_path, report)
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
        controller = MLXSwitchableDeltaController(model, adapter_dir, base_role=base_role)
        report["attach_seconds"] = round(time.monotonic() - attach_t0, 4)
        report["wrapped_module_count"] = len(controller._wrapped_modules)
        report["exact_swap_count"] = len(controller._exact_array_swaps)
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
    cfg = json.loads(args.config.read_text())
    run_switchable_evaluation(
        model_dir=Path(cfg["model_dir"]),
        adapter_dir=Path(cfg["adapter_dir"]),
        report_path=args.report,
        base_role=cfg.get("base_role", "bfl"),
        modes=cfg["modes"],
        cases=cfg["cases"],
        system_prompts_path=Path(cfg["system_prompts_path"]) if cfg.get("system_prompts_path") else None,
        max_tokens=int(cfg.get("max_tokens", 512)),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
