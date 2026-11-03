"""MLX switchable low-rank + exact-small-tensor adapter controller for Qwen3.5-9B.

Primary production mode:
- `base_role="qwen"`: resident model is standard `Qwen3.5-9B` (4-bit or BF16).
  - `enabled=False`: exact unmodified `Qwen3.5-9B` (zero adapter compute).
  - `enabled=True, rank=r`: applies exact small-tensor deltas (225 tensors) +
    rank-r SVD delta (`B[:, :r] @ A[:r, :]`) on the 202 large 2D matrices.
  - `effective_model_semantics == "qwen_resident_exact_target"`.

Exploratory diagnostic mode (requires explicit `allow_bfl_residual_approx=True`):
- `base_role="bfl"`: resident model is BFL `flux-3-image-klein-pup`.
  - Because `Delta W = Delta W_R + E_R`, subtracting `Delta W_R` (when `enabled=False`) or
    subtracting `Delta W_{r:R}` (when `enabled=True, rank=r < R`) retains the unextracted
    SVD tail residual `E_R`.
  - `effective_model_semantics == "bfl_resident_retains_unextracted_svd_tail_residual"`.

Works transparently on 4-bit `nn.QuantizedLinear` and `nn.QuantizedEmbedding` as well as
unquantized `nn.Linear` and `nn.Embedding` without dequantizing or mutating base 2D weights.
"""
import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


def _resolve_mlx_path(root: Any, hf_key: str) -> Optional[Tuple[Any, str]]:
    """Resolve a HuggingFace Qwen3.5 parameter/module path against an MLX VLM or LanguageModel."""
    candidates = [
        hf_key.replace("model.language_model.", "language_model.model.").replace("lm_head", "language_model.lm_head"),
        hf_key.replace("model.language_model.", "model."),
        hf_key,
    ]
    for cand in candidates:
        parts = cand.split(".")
        curr = root
        ok = True
        for p in parts[:-1]:
            if p.isdigit() and isinstance(curr, (list, tuple)):
                idx = int(p)
                if 0 <= idx < len(curr):
                    curr = curr[idx]
                else:
                    ok = False
                    break
            elif hasattr(curr, p):
                curr = getattr(curr, p)
            elif isinstance(curr, dict) and p in curr:
                curr = curr[p]
            else:
                ok = False
                break
        if ok:
            last = parts[-1]
            if hasattr(curr, last) or (isinstance(curr, dict) and last in curr):
                return curr, last
    return None


def _make_mlx_wrappers():
    import mlx.core as mx
    import mlx.nn as nn

    class SwitchableMLXExactLinear(nn.Module):
        """Wraps a 2D small linear layer (e.g. `in_proj_a`, `in_proj_b`) with an exact rank-32 delta."""

        def __init__(self, base: nn.Module, delta_weight: mx.array, controller: "MLXSwitchableDeltaController") -> None:
            super().__init__()
            self.base = base
            self.delta_T = mx.transpose(delta_weight.astype(mx.float32))
            self._controller = controller

        def __call__(self, x: mx.array) -> mx.array:
            y = self.base(x)
            scale = self._controller.exact_delta_scale()
            if scale == 0.0:
                return y
            dt = y.dtype
            delta = (x.astype(mx.float32) @ self.delta_T) * scale
            return (y.astype(mx.float32) + delta).astype(dt)

    class SwitchableMLXLoRALinear(nn.Module):
        """Wraps a large 2D `nn.Linear` or `nn.QuantizedLinear` with a rank-sliceable SVD delta."""

        def __init__(
            self,
            base: nn.Module,
            lora_B: mx.array,
            lora_A: mx.array,
            controller: "MLXSwitchableDeltaController",
        ) -> None:
            super().__init__()
            self.base = base
            self.lora_B_T = mx.transpose(lora_B.astype(mx.float32))  # [R, out]
            self.lora_A_T = mx.transpose(lora_A.astype(mx.float32))  # [in, R]
            self.max_rank = int(lora_B.shape[1])
            self._controller = controller

        def __call__(self, x: mx.array) -> mx.array:
            y = self.base(x)
            r_start, r_end, scale = self._controller.lora_slice_and_scale(self.max_rank)
            if scale == 0.0 or r_end <= r_start:
                return y
            dt = y.dtype
            a_slice = self.lora_A_T[:, r_start:r_end]
            b_slice = self.lora_B_T[r_start:r_end, :]
            delta = ((x.astype(mx.float32) @ a_slice) @ b_slice) * scale
            return (y.astype(mx.float32) + delta).astype(dt)

    class SwitchableMLXLoRAEmbedding(nn.Module):
        """Wraps `nn.Embedding` or `nn.QuantizedEmbedding` with a rank-sliceable SVD delta."""

        def __init__(
            self,
            base: nn.Module,
            lora_B: mx.array,
            lora_A: mx.array,
            controller: "MLXSwitchableDeltaController",
        ) -> None:
            super().__init__()
            self.base = base
            self.lora_B = lora_B.astype(mx.float32)  # [vocab, R]
            self.lora_A = lora_A.astype(mx.float32)  # [R, hidden]
            self.lora_B_T = mx.transpose(self.lora_B)  # [R, vocab]
            self.lora_A_T = mx.transpose(self.lora_A)  # [hidden, R]
            self.max_rank = int(lora_B.shape[1])
            self._controller = controller

        def __call__(self, x: mx.array) -> mx.array:
            y = self.base(x)
            r_start, r_end, scale = self._controller.lora_slice_and_scale(self.max_rank)
            if scale == 0.0 or r_end <= r_start:
                return y
            dt = y.dtype
            gathered = self.lora_B[x, r_start:r_end]
            delta = (gathered @ self.lora_A[r_start:r_end, :]) * scale
            return (y.astype(mx.float32) + delta).astype(dt)

        def as_linear(self, x: mx.array) -> mx.array:
            y = self.base.as_linear(x)
            r_start, r_end, scale = self._controller.lora_slice_and_scale(self.max_rank)
            if scale == 0.0 or r_end <= r_start:
                return y
            dt = y.dtype
            a_slice = self.lora_A_T[:, r_start:r_end]
            b_slice = self.lora_B_T[r_start:r_end, :]
            delta = ((x.astype(mx.float32) @ a_slice) @ b_slice) * scale
            return (y.astype(mx.float32) + delta).astype(dt)

    return mx, SwitchableMLXExactLinear, SwitchableMLXLoRALinear, SwitchableMLXLoRAEmbedding


class MLXSwitchableDeltaController:
    """Attaches a rank-sliceable delta adapter to a resident MLX Qwen3.5 VLM or LanguageModel."""

    def __init__(
        self,
        model: Any,
        adapter_dir: Path,
        base_role: str = "qwen",
        allow_bfl_residual_approx: bool = False,
        include_exact_small: bool = True,
        include_vocab: bool = True,
    ) -> None:
        if base_role not in ("qwen", "bfl"):
            raise ValueError(f"Unsupported base_role: {base_role!r}; expected 'qwen' or 'bfl'")
        if base_role == "bfl" and not allow_bfl_residual_approx:
            raise ValueError(
                "base_role='bfl' retains the unextracted SVD tail residual E_R = Delta_W - Delta_W_R; "
                "pass allow_bfl_residual_approx=True only for explicit residual-bearing comparisons."
            )

        mx, SwitchableMLXExactLinear, SwitchableMLXLoRALinear, SwitchableMLXLoRAEmbedding = _make_mlx_wrappers()
        self._mx = mx
        self.model = model
        self.adapter_dir = Path(adapter_dir)
        self.base_role = base_role
        self.effective_model_semantics = (
            "qwen_resident_exact_target"
            if base_role == "qwen"
            else "bfl_resident_retains_unextracted_svd_tail_residual"
        )
        self.manifest = json.loads((self.adapter_dir / "manifest.json").read_text())
        self.max_rank: int = int(self.manifest["max_rank"])
        self.enabled: bool = (base_role == "bfl")
        self.active_rank: int = self.max_rank if self.enabled else 0
        self.state_epoch: int = 0

        self._attached_caches: List[Any] = []
        self._reset_callbacks: List[Callable[[int], None]] = []
        self._exact_array_swaps: List[Tuple[Any, str, Any, Any]] = []
        self._wrapped_modules: List[Tuple[Any, str, Any]] = []
        self.attached_exact_count: int = 0
        self.attached_lowrank_count: int = 0

        for grp, shard_info in self.manifest["shards"].items():
            if grp == "exact_small" and not include_exact_small:
                continue
            if grp == "vocab_embed_lm_head" and not include_vocab:
                continue
            shard_path = self.adapter_dir / shard_info["file"]
            if not shard_path.is_file() or shard_path.stat().st_size == 0:
                raise FileNotFoundError(f"Missing or empty MLX adapter shard for group {grp}: {shard_path}")
            tensors = mx.load(str(shard_path))
            for key, st in shard_info["tensor_stats"].items():
                if st["mode"] == "exact":
                    delta_arr = tensors[f"{key}.delta"]
                    if key.endswith(".weight") and len(st["shape"]) == 2:
                        mod_key = key.removesuffix(".weight")
                        resolved_mod = _resolve_mlx_path(self.model, mod_key)
                        if resolved_mod is None:
                            raise KeyError(f"Unresolved MLX adapter target module: {mod_key} (from {key})")
                        parent, attr = resolved_mod
                        orig_mod = getattr(parent, attr)
                        wrapped = SwitchableMLXExactLinear(orig_mod, delta_arr, self)
                        setattr(parent, attr, wrapped)
                        self._wrapped_modules.append((parent, attr, orig_mod))
                        self.attached_exact_count += 1
                        continue

                    resolved_param = _resolve_mlx_path(self.model, key)
                    if resolved_param is None:
                        raise KeyError(f"Unresolved MLX adapter target parameter: {key}")
                    parent, attr = resolved_param
                    orig_arr = getattr(parent, attr)
                    delta_mlx = delta_arr
                    if "conv1d.weight" in key and orig_arr.ndim == 3 and orig_arr.shape != delta_mlx.shape:
                        delta_mlx = mx.moveaxis(delta_mlx, 2, 1)
                    dt = orig_arr.dtype
                    if self.base_role == "qwen":
                        qwen_arr = orig_arr
                        bfl_arr = (orig_arr.astype(mx.float32) + delta_mlx.astype(mx.float32)).astype(dt)
                    else:
                        bfl_arr = orig_arr
                        qwen_arr = (orig_arr.astype(mx.float32) - delta_mlx.astype(mx.float32)).astype(dt)
                    mx.eval(qwen_arr, bfl_arr)
                    self._exact_array_swaps.append((parent, attr, qwen_arr, bfl_arr))
                    self.attached_exact_count += 1

                elif st["mode"] == "lowrank_svd":
                    mod_key = key.removesuffix(".weight")
                    resolved_mod = _resolve_mlx_path(self.model, mod_key)
                    if resolved_mod is None:
                        raise KeyError(f"Unresolved MLX adapter target module: {mod_key} (from {key})")
                    parent, attr = resolved_mod
                    orig_mod = getattr(parent, attr)
                    b_arr = tensors[f"{key}.lora_B"]
                    a_arr = tensors[f"{key}.lora_A"]
                    if hasattr(orig_mod, "as_linear") or "embed_tokens" in mod_key:
                        wrapped = SwitchableMLXLoRAEmbedding(orig_mod, b_arr, a_arr, self)
                    else:
                        wrapped = SwitchableMLXLoRALinear(orig_mod, b_arr, a_arr, self)
                    setattr(parent, attr, wrapped)
                    self._wrapped_modules.append((parent, attr, orig_mod))
                    self.attached_lowrank_count += 1

    def exact_delta_scale(self) -> float:
        if self.base_role == "qwen":
            return 1.0 if self.enabled else 0.0
        return 0.0 if self.enabled else -1.0

    def lora_slice_and_scale(self, layer_max_rank: int) -> Tuple[int, int, float]:
        r = min(self.active_rank, layer_max_rank) if self.enabled else 0
        if self.base_role == "qwen":
            if not self.enabled or r <= 0:
                return 0, 0, 0.0
            return 0, r, 1.0
        else:
            if not self.enabled:
                return 0, layer_max_rank, -1.0
            if r >= layer_max_rank:
                return 0, 0, 0.0
            return r, layer_max_rank, -1.0

    def attach_cache(self, cache_list: Any) -> Any:
        if cache_list not in self._attached_caches:
            self._attached_caches.append(cache_list)
        return cache_list

    def register_reset_callback(self, fn: Callable[[int], None]) -> None:
        self._reset_callbacks.append(fn)

    def _reset_caches_and_model_state(self) -> None:
        lang = getattr(self.model, "language_model", self.model)
        if hasattr(lang, "_position_ids"):
            lang._position_ids = None
        if hasattr(lang, "_rope_deltas"):
            lang._rope_deltas = None

        for cache_container in self._attached_caches:
            items = cache_container if isinstance(cache_container, (list, tuple)) else [cache_container]
            for c in items:
                if c is None:
                    continue
                if hasattr(c, "reset") and callable(c.reset):
                    c.reset()
                elif hasattr(c, "cache") and isinstance(c.cache, list):
                    for idx in range(len(c.cache)):
                        c.cache[idx] = None
                elif isinstance(c, dict):
                    c.clear()

        for cb in self._reset_callbacks:
            cb(self.state_epoch)

    def assert_cache_epoch(self, bound_epoch: int) -> None:
        if bound_epoch != self.state_epoch:
            raise RuntimeError(
                f"MLX generation cache epoch mismatch across adapter switch: "
                f"bound_epoch={bound_epoch} != state_epoch={self.state_epoch}"
            )

    def set_mode(self, enabled: bool, rank: int = 64) -> Dict[str, Any]:
        target_rank = min(rank, self.max_rank) if enabled else 0
        changed = (bool(enabled) != self.enabled) or (enabled and target_rank != self.active_rank)

        for parent, attr, qwen_arr, bfl_arr in self._exact_array_swaps:
            setattr(parent, attr, bfl_arr if enabled else qwen_arr)

        self.enabled = bool(enabled)
        self.active_rank = target_rank

        if changed:
            self.state_epoch += 1
            self._reset_caches_and_model_state()

        return {
            "enabled": self.enabled,
            "rank": self.active_rank,
            "state_epoch": self.state_epoch,
            "reset_performed": changed,
            "effective_model_semantics": self.effective_model_semantics,
        }

    def detach(self) -> None:
        self.set_mode(enabled=(self.base_role == "bfl"), rank=self.max_rank)
        for parent, attr, orig_mod in self._wrapped_modules:
            setattr(parent, attr, orig_mod)
        self._wrapped_modules.clear()
