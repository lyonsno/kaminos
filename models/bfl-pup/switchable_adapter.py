"""Switchable low-rank + exact-small-tensor adapter controller for Qwen3.5-9B.

Keeps the large base weights resident and untouched (never reloading or mutating
the 2D projection/vocabulary base weights), swaps the 14 MiB of exact small
parameters (norms, conv1d, in_proj_a/b, A_log), applies rank-sliceable sidecar
LoRA hooks when enabled, and enforces generation cache / recurrent state reset
whenever the adapter state or rank changes.
"""
import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from safetensors import safe_open


class GenerationCacheState:
    """Tracks KV cache and recurrent Gated DeltaNet state bound to an adapter epoch."""

    def __init__(self) -> None:
        self.kv_cache: Dict[str, Any] = {}
        self.recurrent_state: Dict[str, Any] = {}
        self.bound_epoch: int = 0

    def reset(self, new_epoch: Optional[int] = None) -> None:
        self.kv_cache.clear()
        self.recurrent_state.clear()
        if new_epoch is not None:
            self.bound_epoch = new_epoch


class SwitchableDeltaController:
    """Attaches a rank-sliceable delta adapter to a resident Qwen3.5 model."""

    def __init__(
        self,
        model: nn.Module,
        adapter_dir: Path,
        include_exact_small: bool = True,
        include_vocab: bool = True,
    ) -> None:
        self.model = model
        self.adapter_dir = Path(adapter_dir)
        self.manifest = json.loads((self.adapter_dir / "manifest.json").read_text())
        self.max_rank: int = int(self.manifest["max_rank"])
        self.enabled: bool = False
        self.active_rank: int = 0
        self.state_epoch: int = 0

        self._attached_caches: List[GenerationCacheState] = []
        self._reset_callbacks: List[Callable[[int], None]] = []
        self._hooks: List[Any] = []

        self._exact_params: Dict[str, Tuple[nn.Parameter, torch.Tensor, torch.Tensor]] = {}
        self._lowrank_factors: Dict[str, Tuple[torch.Tensor, torch.Tensor]] = {}

        param_map: Dict[str, nn.Parameter] = dict(self.model.named_parameters())
        module_map: Dict[str, nn.Module] = dict(self.model.named_modules())

        for grp, shard_info in self.manifest["shards"].items():
            if grp == "exact_small" and not include_exact_small:
                continue
            if grp == "vocab_embed_lm_head" and not include_vocab:
                continue
            shard_path = self.adapter_dir / shard_info["file"]
            if not shard_path.is_file() or shard_path.stat().st_size == 0:
                raise FileNotFoundError(f"Missing or empty PyTorch adapter shard for group {grp}: {shard_path}")
            with safe_open(str(shard_path), framework="pt", device="cpu") as sf:
                for key, st in shard_info["tensor_stats"].items():
                    if st["mode"] == "exact":
                        if key not in param_map:
                            raise KeyError(f"Unresolved PyTorch adapter parameter: {key}")
                        p = param_map[key]
                        qwen_copy = p.detach().clone()
                        bfl_copy = sf.get_tensor(f"{key}.bfl").to(device=p.device, dtype=p.dtype)
                        self._exact_params[key] = (p, qwen_copy, bfl_copy)
                    elif st["mode"] == "lowrank_svd":
                        mod_name = key.removesuffix(".weight")
                        if mod_name not in module_map:
                            raise KeyError(f"Unresolved PyTorch adapter module: {mod_name}")
                        mod = module_map[mod_name]
                        b_t = sf.get_tensor(f"{key}.lora_B")
                        a_t = sf.get_tensor(f"{key}.lora_A")
                        self._lowrank_factors[mod_name] = (b_t, a_t)
                        self._install_hook(mod_name, mod)

    def _install_hook(self, mod_name: str, module: nn.Module) -> None:
        def _hook(mod: nn.Module, inputs: Tuple[Any, ...], output: torch.Tensor) -> Optional[torch.Tensor]:
            if not self.enabled or self.active_rank <= 0:
                return None
            b_cpu, a_cpu = self._lowrank_factors[mod_name]
            r = min(self.active_rank, b_cpu.shape[1], a_cpu.shape[0])
            inp = inputs[0]
            dev = output.device
            b_r = b_cpu[:, :r].to(device=dev, dtype=torch.float32)
            a_r = a_cpu[:r, :].to(device=dev, dtype=torch.float32)

            if isinstance(mod, nn.Embedding) or inp.dtype in (torch.int32, torch.int64):
                gathered = F.embedding(inp, b_r)
                delta = gathered @ a_r
            else:
                x_f = inp.to(device=dev, dtype=torch.float32)
                delta = (x_f @ a_r.T) @ b_r.T
            return (output.float() + delta).to(output.dtype)

        handle = module.register_forward_hook(_hook)
        self._hooks.append(handle)

    def attach_cache(self, cache: GenerationCacheState) -> GenerationCacheState:
        cache.bound_epoch = self.state_epoch
        if cache not in self._attached_caches:
            self._attached_caches.append(cache)
        return cache

    def register_reset_callback(self, fn: Callable[[int], None]) -> None:
        self._reset_callbacks.append(fn)

    def assert_cache_valid(self, cache: GenerationCacheState) -> None:
        if cache.bound_epoch != self.state_epoch:
            raise RuntimeError(
                f"Generation state/cache epoch mismatch across adapter switch: "
                f"cache bound_epoch={cache.bound_epoch} != controller state_epoch={self.state_epoch}"
            )

    def set_mode(self, enabled: bool, rank: int = 64) -> Dict[str, Any]:
        target_rank = min(rank, self.max_rank) if enabled else 0
        changed = (bool(enabled) != self.enabled) or (enabled and target_rank != self.active_rank)

        with torch.no_grad():
            for _, (param, qwen_val, bfl_val) in self._exact_params.items():
                param.data.copy_(bfl_val if enabled else qwen_val)

        self.enabled = bool(enabled)
        self.active_rank = target_rank

        if changed:
            self.state_epoch += 1
            for cache in self._attached_caches:
                cache.reset(new_epoch=self.state_epoch)
            for cb in self._reset_callbacks:
                cb(self.state_epoch)

        return {
            "enabled": self.enabled,
            "rank": self.active_rank,
            "state_epoch": self.state_epoch,
            "reset_performed": changed,
        }

    def remove_hooks(self) -> None:
        self.set_mode(enabled=False)
        for h in self._hooks:
            h.remove()
        self._hooks.clear()
