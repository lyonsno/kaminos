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
import hashlib
import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

MLX_NORM_OFFSET_SUFFIXES = (
    ".input_layernorm.weight",
    ".post_attention_layernorm.weight",
    "model.norm.weight",
    ".q_norm.weight",
    ".k_norm.weight",
)


def is_mlx_offset_norm_key(hf_key: str) -> bool:
    return hf_key.endswith(MLX_NORM_OFFSET_SUFFIXES)


def compute_mlx_exact_swap_pair(
    key: str,
    orig_arr: Any,
    delta_arr: Any,
    bfl_ref: Optional[Any],
    base_role: str,
    float32_dtype: Any = None,
    moveaxis_fn: Optional[Callable[[Any, int, int], Any]] = None,
    qwen_ref: Optional[Any] = None,
) -> Tuple[Any, Any]:
    """Compute exact (qwen_arr, bfl_arr) parameter arrays for MLX exact-small swaps.

    Preserves the resident array (`orig_arr`) for exact restoration in its base mode,
    and constructs the counterpart array from the saved `.bfl` / `.qwen` reference through the
    applicable MLX sanitization (`+ 1.0` in float32 then rounded to `orig_arr.dtype`
    for offset RMSNorm keys).
    """
    dt = orig_arr.dtype
    if float32_dtype is None:
        import torch

        float32_dtype = torch.float32
    delta_mlx = delta_arr
    if "conv1d.weight" in key and orig_arr.ndim == 3 and orig_arr.shape != delta_mlx.shape and moveaxis_fn is not None:
        delta_mlx = moveaxis_fn(delta_mlx, 2, 1)

    if bfl_ref is not None:
        bfl_aligned = bfl_ref
        if "conv1d.weight" in key and orig_arr.ndim == 3 and orig_arr.shape != bfl_aligned.shape and moveaxis_fn is not None:
            bfl_aligned = moveaxis_fn(bfl_aligned, 2, 1)
        bfl_f32 = bfl_aligned.astype(float32_dtype) if hasattr(bfl_aligned, "astype") else bfl_aligned.to(float32_dtype)
        delta_f32 = delta_mlx.astype(float32_dtype) if hasattr(delta_mlx, "astype") else delta_mlx.to(float32_dtype)
        if qwen_ref is not None:
            qwen_aligned = qwen_ref
            if (
                "conv1d.weight" in key
                and orig_arr.ndim == 3
                and orig_arr.shape != qwen_aligned.shape
                and moveaxis_fn is not None
            ):
                qwen_aligned = moveaxis_fn(qwen_aligned, 2, 1)
            qwen_raw_f32 = (
                qwen_aligned.astype(float32_dtype) if hasattr(qwen_aligned, "astype") else qwen_aligned.to(float32_dtype)
            )
        else:
            qwen_raw_f32 = bfl_f32 - delta_f32
        if is_mlx_offset_norm_key(key):
            sanitized_bfl_f32 = bfl_f32 + 1.0
            qwen_bf16 = qwen_raw_f32.astype(dt) if hasattr(qwen_raw_f32, "astype") else qwen_raw_f32.to(dt)
            qwen_bf16_f32 = qwen_bf16.astype(float32_dtype) if hasattr(qwen_bf16, "astype") else qwen_bf16.to(float32_dtype)
            sanitized_qwen_f32 = qwen_bf16_f32 + 1.0
            sanitized_bfl = sanitized_bfl_f32.astype(dt) if hasattr(sanitized_bfl_f32, "astype") else sanitized_bfl_f32.to(dt)
            sanitized_qwen = sanitized_qwen_f32.astype(dt) if hasattr(sanitized_qwen_f32, "astype") else sanitized_qwen_f32.to(dt)
        else:
            sanitized_bfl = bfl_aligned.astype(dt) if hasattr(bfl_aligned, "astype") else bfl_aligned.to(dt)
            sanitized_qwen = qwen_raw_f32.astype(dt) if hasattr(qwen_raw_f32, "astype") else qwen_raw_f32.to(dt)
    else:
        orig_f32 = orig_arr.astype(float32_dtype) if hasattr(orig_arr, "astype") else orig_arr.to(float32_dtype)
        delta_f32 = delta_mlx.astype(float32_dtype) if hasattr(delta_mlx, "astype") else delta_mlx.to(float32_dtype)
        if base_role == "qwen":
            sanitized_qwen = orig_arr
            sum_f32 = orig_f32 + delta_f32
            sanitized_bfl = sum_f32.astype(dt) if hasattr(sum_f32, "astype") else sum_f32.to(dt)
        else:
            sanitized_bfl = orig_arr
            diff_f32 = orig_f32 - delta_f32
            sanitized_qwen = diff_f32.astype(dt) if hasattr(diff_f32, "astype") else diff_f32.to(dt)

    if base_role == "qwen":
        return orig_arr, sanitized_bfl
    return sanitized_qwen, orig_arr


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

    class _AdapterHolder:
        """Plain non-Module container so mlx.nn.Module (a dict subclass) never registers adapter arrays."""

        def __init__(self, **kwargs: Any) -> None:
            for k, v in kwargs.items():
                setattr(self, k, v)

    class SwitchableMLXExactLinear(nn.Module):
        """Wraps a 2D small linear layer (e.g. `in_proj_a`, `in_proj_b`) with exact BFL/Qwen target reconstruction."""

        def __init__(
            self,
            base: nn.Module,
            delta_weight: mx.array,
            controller: "MLXSwitchableDeltaController",
            bfl_weight: Optional[mx.array] = None,
            qwen_weight: Optional[mx.array] = None,
        ) -> None:
            super().__init__()
            self.base = base
            if qwen_weight is None and bfl_weight is not None:
                q_f32 = bfl_weight.astype(mx.float32) - delta_weight.astype(mx.float32)
                qwen_weight = q_f32.astype(bfl_weight.dtype)
                mx.eval(qwen_weight)
            self._holder = _AdapterHolder(
                delta_weight=delta_weight,
                bfl_weight=bfl_weight,
                qwen_weight=qwen_weight,
                controller=controller,
            )

        def __call__(self, x: mx.array) -> mx.array:
            h = self._holder
            ctrl = h.controller
            if ctrl.base_role == "qwen":
                if not ctrl.enabled:
                    return self.base(x)
                if h.bfl_weight is not None:
                    dt = x.dtype
                    bfl_T_f32 = mx.transpose(h.bfl_weight.astype(mx.float32))
                    out_f32 = x.astype(mx.float32) @ bfl_T_f32
                    bias = getattr(self.base, "bias", None)
                    if bias is not None:
                        out_f32 = out_f32 + bias.astype(mx.float32)
                    return out_f32.astype(dt)
            else:
                if ctrl.enabled:
                    return self.base(x)
                if h.qwen_weight is not None:
                    dt = x.dtype
                    qwen_T_f32 = mx.transpose(h.qwen_weight.astype(mx.float32))
                    out_f32 = x.astype(mx.float32) @ qwen_T_f32
                    bias = getattr(self.base, "bias", None)
                    if bias is not None:
                        out_f32 = out_f32 + bias.astype(mx.float32)
                    return out_f32.astype(dt)

            y = self.base(x)
            scale = ctrl.exact_delta_scale()
            if scale == 0.0:
                return y
            dt = y.dtype
            delta_T = mx.transpose(h.delta_weight.astype(mx.float32))
            delta = (x.astype(mx.float32) @ delta_T) * scale
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
            self._holder = _AdapterHolder(
                lora_B=lora_B,
                lora_A=lora_A,
                max_rank=int(lora_B.shape[1]),
                controller=controller,
            )

        def __call__(self, x: mx.array) -> mx.array:
            y = self.base(x)
            h = self._holder
            r_start, r_end, scale = h.controller.lora_slice_and_scale(h.max_rank)
            if scale == 0.0 or r_end <= r_start:
                return y
            dt = y.dtype
            w_dt = h.lora_A.dtype
            a_slice_T = mx.transpose(h.lora_A[r_start:r_end, :])
            b_slice_T = mx.transpose(h.lora_B[:, r_start:r_end])
            if a_slice_T.dtype != w_dt:
                a_slice_T = a_slice_T.astype(w_dt)
            if b_slice_T.dtype != w_dt:
                b_slice_T = b_slice_T.astype(w_dt)
            x_w = x if x.dtype == w_dt else x.astype(w_dt)
            mid = (x_w @ a_slice_T).astype(mx.float32) * scale
            delta = mid.astype(w_dt) @ b_slice_T
            return (y.astype(mx.float32) + delta.astype(mx.float32)).astype(dt)

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
            self._holder = _AdapterHolder(
                lora_B=lora_B,
                lora_A=lora_A,
                max_rank=int(lora_B.shape[1]),
                controller=controller,
            )

        def __call__(self, x: mx.array) -> mx.array:
            y = self.base(x)
            h = self._holder
            r_start, r_end, scale = h.controller.lora_slice_and_scale(h.max_rank)
            if scale == 0.0 or r_end <= r_start:
                return y
            dt = y.dtype
            w_dt = h.lora_A.dtype
            gathered = h.lora_B[x, r_start:r_end]
            if gathered.dtype != w_dt:
                gathered = gathered.astype(w_dt)
            a_slice = h.lora_A[r_start:r_end, :]
            if a_slice.dtype != w_dt:
                a_slice = a_slice.astype(w_dt)
            delta = (gathered @ a_slice).astype(mx.float32) * scale
            return (y.astype(mx.float32) + delta).astype(dt)

        def as_linear(self, x: mx.array) -> mx.array:
            y = self.base.as_linear(x)
            h = self._holder
            r_start, r_end, scale = h.controller.lora_slice_and_scale(h.max_rank)
            if scale == 0.0 or r_end <= r_start:
                return y
            dt = y.dtype
            w_dt = h.lora_A.dtype
            a_slice_T = mx.transpose(h.lora_A[r_start:r_end, :])
            b_slice_T = mx.transpose(h.lora_B[:, r_start:r_end])
            if a_slice_T.dtype != w_dt:
                a_slice_T = a_slice_T.astype(w_dt)
            if b_slice_T.dtype != w_dt:
                b_slice_T = b_slice_T.astype(w_dt)
            x_w = x if x.dtype == w_dt else x.astype(w_dt)
            mid = (x_w @ a_slice_T).astype(mx.float32) * scale
            delta = mid.astype(w_dt) @ b_slice_T
            return (y.astype(mx.float32) + delta.astype(mx.float32)).astype(dt)

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
        if not isinstance(allow_bfl_residual_approx, bool):
            raise ValueError(f"allow_bfl_residual_approx must be a boolean, got {allow_bfl_residual_approx!r}")
        if not isinstance(include_exact_small, bool):
            raise ValueError(f"include_exact_small must be a boolean, got {include_exact_small!r}")
        if not isinstance(include_vocab, bool):
            raise ValueError(f"include_vocab must be a boolean, got {include_vocab!r}")
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
        self._wrapped_modules: List[Tuple[Any, str, Any, Any, bool]] = []
        self.attached_exact_count: int = 0
        self.attached_lowrank_count: int = 0
        self.vision_tower_invariant: bool = True

        for grp, shard_info in self.manifest["shards"].items():
            for t_key in shard_info.get("tensor_stats", {}).keys():
                if "vision_tower" in t_key or ".visual." in t_key:
                    self.vision_tower_invariant = False
            if grp == "exact_small" and not include_exact_small:
                continue
            if grp == "vocab_embed_lm_head" and not include_vocab:
                continue
            shard_path = self.adapter_dir / shard_info["file"]
            if not shard_path.is_file() or shard_path.stat().st_size == 0:
                raise FileNotFoundError(f"Missing or empty MLX adapter shard for group {grp}: {shard_path}")
            recorded_sha = shard_info.get("sha256")
            if recorded_sha:
                actual_sha = hashlib.sha256(shard_path.read_bytes()).hexdigest()
                if actual_sha != recorded_sha:
                    raise ValueError(
                        f"MLX adapter shard {grp} SHA-256 mismatch: actual={actual_sha} != manifest={recorded_sha}"
                    )
            tensors = mx.load(str(shard_path))
            kept_arrays: List[Any] = []
            for key, st in shard_info["tensor_stats"].items():
                if st["mode"] == "exact":
                    delta_arr = tensors[f"{key}.delta"]
                    bfl_raw = tensors.get(f"{key}.bfl")
                    qwen_raw = tensors.get(f"{key}.qwen")
                    if key.endswith(".weight") and len(st["shape"]) == 2:
                        mod_key = key.removesuffix(".weight")
                        resolved_mod = _resolve_mlx_path(self.model, mod_key)
                        if resolved_mod is None:
                            raise KeyError(f"Unresolved MLX adapter target module: {mod_key} (from {key})")
                        parent, attr = resolved_mod
                        orig_mod = getattr(parent, attr)
                        if bfl_raw is not None:
                            orig_w = getattr(orig_mod, "weight", None)
                            if orig_w is None:
                                raise ValueError(
                                    f"Loaded resident module {mod_key} has no inspectable .weight attribute "
                                    f"to verify {self.base_role} provenance"
                                )
                            is_quant = hasattr(orig_mod, "scales")
                            if is_quant and hasattr(mx, "dequantize"):
                                n_rows = min(2, int(orig_mod.weight.shape[0]))
                                biases_attr = getattr(orig_mod, "biases", None)
                                orig_f32 = mx.dequantize(
                                    orig_mod.weight[0:n_rows],
                                    orig_mod.scales[0:n_rows],
                                    biases_attr[0:n_rows] if biases_attr is not None else None,
                                    getattr(orig_mod, "group_size", 64),
                                    getattr(orig_mod, "bits", 4),
                                ).astype(mx.float32)
                                bfl_f32 = bfl_raw[0:n_rows].astype(mx.float32)
                                qwen_f32 = (
                                    qwen_raw[0:n_rows].astype(mx.float32)
                                    if qwen_raw is not None
                                    else (bfl_f32 - delta_arr[0:n_rows].astype(mx.float32))
                                )
                            elif not is_quant:
                                orig_f32 = orig_w.astype(mx.float32)
                                bfl_f32 = bfl_raw.astype(mx.float32)
                                qwen_f32 = (
                                    qwen_raw.astype(mx.float32)
                                    if qwen_raw is not None
                                    else (bfl_f32 - delta_arr.astype(mx.float32))
                                )
                            else:
                                orig_f32 = None
                                bfl_f32 = None
                                qwen_f32 = None
                            if orig_f32 is not None and bfl_f32 is not None and qwen_f32 is not None:
                                ref_diff = bfl_f32 - qwen_f32
                                delta_norm = float(mx.sqrt(mx.sum(ref_diff * ref_diff)).item())
                                diff_q = orig_f32 - qwen_f32
                                diff_b = orig_f32 - bfl_f32
                                dist_qwen = float(mx.sqrt(mx.sum(diff_q * diff_q)).item())
                                dist_bfl = float(mx.sqrt(mx.sum(diff_b * diff_b)).item())
                                if delta_norm > 1e-4:
                                    if self.base_role == "qwen" and dist_bfl + 1e-4 < dist_qwen:
                                        raise ValueError(
                                            f"Loaded resident model parameter {key} matches BFL weights "
                                            f"(dist_bfl={dist_bfl:.6f} < dist_qwen={dist_qwen:.6f}), contradicting base_role='qwen'"
                                        )
                                    if self.base_role == "bfl" and dist_qwen + 1e-4 < dist_bfl:
                                        raise ValueError(
                                            f"Loaded resident model parameter {key} matches Qwen weights "
                                            f"(dist_qwen={dist_qwen:.6f} < dist_bfl={dist_bfl:.6f}), contradicting base_role='bfl'"
                                        )
                                expected_ref = qwen_f32 if self.base_role == "qwen" else bfl_f32
                                dist_exp = dist_qwen if self.base_role == "qwen" else dist_bfl
                                ref_norm = max(float(mx.sqrt(mx.sum(expected_ref * expected_ref)).item()), 1e-6)
                                rel_tol = 0.25 if is_quant else 0.02
                                abs_tol = 0.1 if is_quant else 0.02
                                if dist_exp > max(rel_tol * ref_norm, abs_tol):
                                    raise ValueError(
                                        f"Loaded resident model parameter {key} does not match expected {self.base_role} "
                                        f"reference weights (dist={dist_exp:.6f}, ref_norm={ref_norm:.6f})"
                                    )
                        wrapped = SwitchableMLXExactLinear(
                            orig_mod, delta_arr, self, bfl_weight=bfl_raw, qwen_weight=qwen_raw
                        )
                        kept_arrays.append(delta_arr)
                        if bfl_raw is not None:
                            kept_arrays.append(bfl_raw)
                        if qwen_raw is not None:
                            kept_arrays.append(qwen_raw)
                        self._wrapped_modules.append((parent, attr, orig_mod, wrapped, True))
                        if self._is_wrapper_active(is_exact=True):
                            setattr(parent, attr, wrapped)
                        self.attached_exact_count += 1
                        continue

                    resolved_param = _resolve_mlx_path(self.model, key)
                    if resolved_param is None:
                        raise KeyError(f"Unresolved MLX adapter target parameter: {key}")
                    parent, attr = resolved_param
                    orig_arr = getattr(parent, attr)
                    qwen_expected, bfl_expected = compute_mlx_exact_swap_pair(
                        key=key,
                        orig_arr=orig_arr,
                        delta_arr=delta_arr,
                        bfl_ref=bfl_raw,
                        base_role=self.base_role,
                        float32_dtype=mx.float32,
                        moveaxis_fn=getattr(mx, "moveaxis", None),
                        qwen_ref=qwen_raw,
                    )
                    if bfl_raw is not None:
                        _, bfl_sanitized = compute_mlx_exact_swap_pair(
                            key=key,
                            orig_arr=orig_arr,
                            delta_arr=delta_arr,
                            bfl_ref=bfl_raw,
                            base_role="qwen",
                            float32_dtype=mx.float32,
                            moveaxis_fn=getattr(mx, "moveaxis", None),
                            qwen_ref=qwen_raw,
                        )
                        qwen_sanitized, _ = compute_mlx_exact_swap_pair(
                            key=key,
                            orig_arr=orig_arr,
                            delta_arr=delta_arr,
                            bfl_ref=bfl_raw,
                            base_role="bfl",
                            float32_dtype=mx.float32,
                            moveaxis_fn=getattr(mx, "moveaxis", None),
                            qwen_ref=qwen_raw,
                        )
                        orig_f32 = orig_arr.astype(mx.float32)
                        qwen_san_f32 = qwen_sanitized.astype(mx.float32)
                        bfl_san_f32 = bfl_sanitized.astype(mx.float32)
                        ref_diff = bfl_san_f32 - qwen_san_f32
                        delta_norm = float(mx.sqrt(mx.sum(ref_diff * ref_diff)).item())
                        diff_q = orig_f32 - qwen_san_f32
                        diff_b = orig_f32 - bfl_san_f32
                        dist_qwen = float(mx.sqrt(mx.sum(diff_q * diff_q)).item())
                        dist_bfl = float(mx.sqrt(mx.sum(diff_b * diff_b)).item())
                        if delta_norm > 1e-4:
                            if self.base_role == "qwen" and dist_bfl + 1e-4 < dist_qwen:
                                raise ValueError(
                                    f"Loaded resident model parameter {key} matches BFL weights "
                                    f"(dist_bfl={dist_bfl:.6f} < dist_qwen={dist_qwen:.6f}), contradicting base_role='qwen'"
                                )
                            if self.base_role == "bfl" and dist_qwen + 1e-4 < dist_bfl:
                                raise ValueError(
                                    f"Loaded resident model parameter {key} matches Qwen weights "
                                    f"(dist_qwen={dist_qwen:.6f} < dist_bfl={dist_bfl:.6f}), contradicting base_role='bfl'"
                                )
                        expected_san_f32 = qwen_san_f32 if self.base_role == "qwen" else bfl_san_f32
                        dist_exp = dist_qwen if self.base_role == "qwen" else dist_bfl
                        ref_norm = max(float(mx.sqrt(mx.sum(expected_san_f32 * expected_san_f32)).item()), 1e-6)
                        if dist_exp > max(0.02 * ref_norm, 2e-2):
                            raise ValueError(
                                f"Loaded resident model parameter {key} does not match expected {self.base_role} "
                                f"reference weights (dist={dist_exp:.6f}, ref_norm={ref_norm:.6f})"
                            )
                    qwen_arr, bfl_arr = qwen_expected, bfl_expected
                    kept_arrays.extend([qwen_arr, bfl_arr])
                    self._exact_array_swaps.append((parent, attr, qwen_arr, bfl_arr))
                    self.attached_exact_count += 1

                elif st["mode"] == "lowrank_svd":
                    mod_key = key.removesuffix(".weight")
                    resolved_mod = _resolve_mlx_path(self.model, mod_key)
                    if resolved_mod is None:
                        raise KeyError(f"Unresolved MLX adapter target module: {mod_key} (from {key})")
                    parent, attr = resolved_mod
                    orig_mod = getattr(parent, attr)
                    orig_w = getattr(orig_mod, "weight", None)
                    if orig_w is None:
                        raise ValueError(
                            f"Loaded resident module {mod_key} has no inspectable .weight attribute "
                            f"to verify {self.base_role} provenance"
                        )
                    is_quant = hasattr(orig_mod, "scales")
                    if not is_quant:
                        w_f32 = orig_w.astype(mx.float32)
                        if self.base_role == "qwen":
                            if "frob_base" in st:
                                expected_frob = float(st["frob_base"])
                                actual_frob = float(mx.sqrt(mx.sum(w_f32 * w_f32)).item())
                                if abs(actual_frob - expected_frob) > max(0.02 * expected_frob, 2e-2):
                                    raise ValueError(
                                        f"Loaded resident model parameter {key} does not match expected qwen "
                                        f"Frobenius norm (actual={actual_frob:.6f}, expected={expected_frob:.6f})"
                                    )
                            if "qwen_00" in st:
                                expected_00 = float(st["qwen_00"])
                                actual_00 = float(mx.sum(w_f32[0:1, 0:1]).item())
                                if abs(actual_00 - expected_00) > 2e-2:
                                    raise ValueError(
                                        f"Loaded resident model parameter {key}[0,0] does not match expected qwen "
                                        f"reference value (actual={actual_00:.6f}, expected={expected_00:.6f})"
                                    )
                        else:
                            if "frob_bfl" in st:
                                expected_frob = float(st["frob_bfl"])
                                frob_delta = float(st.get("frob_delta", 0.0))
                                actual_frob = float(mx.sqrt(mx.sum(w_f32 * w_f32)).item())
                                if abs(actual_frob - expected_frob) > max(0.10 * expected_frob + frob_delta, 0.5):
                                    raise ValueError(
                                        f"Loaded resident model parameter {key} does not match expected bfl "
                                        f"Frobenius norm (actual={actual_frob:.6f}, expected={expected_frob:.6f})"
                                    )
                    elif hasattr(mx, "dequantize"):
                        biases_attr = getattr(orig_mod, "biases", None)
                        deq_row0 = mx.dequantize(
                            orig_mod.weight[0:1],
                            orig_mod.scales[0:1],
                            biases_attr[0:1] if biases_attr is not None else None,
                            getattr(orig_mod, "group_size", 64),
                            getattr(orig_mod, "bits", 4),
                        ).astype(mx.float32)
                        ref_00_key = "qwen_00" if self.base_role == "qwen" else "bfl_00"
                        if ref_00_key in st:
                            expected_00 = float(st[ref_00_key])
                            actual_00 = float(mx.sum(deq_row0[0:1, 0:1]).item())
                            if abs(actual_00 - expected_00) > 0.5:
                                raise ValueError(
                                    f"Loaded quantized resident model parameter {key}[0,0] does not match expected "
                                    f"{self.base_role} reference value (actual={actual_00:.6f}, expected={expected_00:.6f})"
                                )
                        elif "frob_base" in st and float(st["frob_base"]) > 0.0:
                            row_norm = float(mx.sqrt(mx.sum(deq_row0 * deq_row0)).item())
                            if not (row_norm > 0.0):
                                raise ValueError(
                                    f"Loaded quantized resident model parameter {key} row 0 dequantized to zero/NaN"
                                )
                    b_arr = tensors[f"{key}.lora_B"]
                    a_arr = tensors[f"{key}.lora_A"]
                    kept_arrays.extend([b_arr, a_arr])
                    if hasattr(orig_mod, "as_linear") or "embed_tokens" in mod_key:
                        wrapped = SwitchableMLXLoRAEmbedding(orig_mod, b_arr, a_arr, self)
                    else:
                        wrapped = SwitchableMLXLoRALinear(orig_mod, b_arr, a_arr, self)
                    self._wrapped_modules.append((parent, attr, orig_mod, wrapped, False))
                    if self._is_wrapper_active(is_exact=False):
                        setattr(parent, attr, wrapped)
                    self.attached_lowrank_count += 1

            if kept_arrays:
                mx.eval(*kept_arrays)
            del tensors, kept_arrays
            if hasattr(mx, "clear_cache"):
                mx.clear_cache()

    def _is_wrapper_active(self, is_exact: bool) -> bool:
        if self.base_role == "qwen":
            if not self.enabled:
                return False
            return True if is_exact else (self.active_rank > 0)
        if not self.enabled:
            return True
        return False if is_exact else (self.active_rank < self.max_rank)

    def _sync_module_wrappers(self) -> None:
        for parent, attr, orig_mod, wrapped, is_exact in self._wrapped_modules:
            target_mod = wrapped if self._is_wrapper_active(is_exact) else orig_mod
            if getattr(parent, attr) is not target_mod:
                setattr(parent, attr, target_mod)

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

    def set_mode(self, enabled: bool, rank: int = 64, preserve_cache: bool = False) -> Dict[str, Any]:
        if not isinstance(enabled, bool):
            raise ValueError(f"enabled must be a boolean, got {enabled!r}")
        if not isinstance(preserve_cache, bool):
            raise ValueError(f"preserve_cache must be a boolean, got {preserve_cache!r}")
        if isinstance(rank, bool) or not isinstance(rank, int) or rank < 0:
            raise ValueError(f"rank must be a non-negative integer, got {rank!r}")
        target_rank = min(rank, self.max_rank) if enabled else 0
        changed = (enabled != self.enabled) or (enabled and target_rank != self.active_rank)

        for parent, attr, qwen_arr, bfl_arr in self._exact_array_swaps:
            setattr(parent, attr, bfl_arr if enabled else qwen_arr)

        self.enabled = enabled
        self.active_rank = target_rank
        self._sync_module_wrappers()

        reset_performed = bool(changed and not preserve_cache)
        if reset_performed:
            self.state_epoch += 1
            self._reset_caches_and_model_state()
            if hasattr(self._mx, "clear_cache"):
                self._mx.clear_cache()

        return {
            "enabled": self.enabled,
            "rank": self.active_rank,
            "state_epoch": self.state_epoch,
            "reset_performed": reset_performed,
            "preserve_cache": preserve_cache,
            "effective_model_semantics": self.effective_model_semantics,
        }

    def detach(self) -> None:
        self.set_mode(enabled=(self.base_role == "bfl"), rank=self.max_rank)
        for parent, attr, orig_mod, _wrapped, _is_exact in self._wrapped_modules:
            setattr(parent, attr, orig_mod)
        self._wrapped_modules.clear()
