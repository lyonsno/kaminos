"""Export small, real-geometry Qwen3.5 kernel references on MLX Metal.

Run through Greenroom. Reads only the named Q4 tensor ranges, never the whole
model. Inputs are deterministic synthetic activations, not captured model
hidden states. All native outputs and used weights are retained for replay.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import struct
import sys
import traceback


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_tensor_range(file, base, meta, start=0, count=None):
    shape = list(meta["shape"])
    rows = shape[0]
    count = rows - start if count is None else count
    if start < 0 or count < 1 or start + count > rows:
        raise ValueError("bad tensor row range")
    begin, end = meta["data_offsets"]
    row_bytes = (end - begin) // rows
    with file.open("rb") as f:
        f.seek(base + begin + start * row_bytes)
        data = f.read(count * row_bytes)
    if len(data) != count * row_bytes:
        raise ValueError("partial source tensor")
    record = {"file": str(file), "sourceShape": list(shape), "rowStart": start,
              "rowCount": count, "dtype": meta["dtype"], "sha256": sha(data)}
    shape[0] = count
    return data, shape, record


def reference_source(model_dir, config_bytes, used, implementation, effective):
    return {"localRoot": str(model_dir.resolve()), "configSha256": sha(config_bytes),
            "upstreamHint": {"model": "mlx-community/flux-3-image-klein-pup-4bit",
                "revision": "34abfa0769000d6a542169b0e61a04059697467c",
                "authority": "intended acquisition source; exporter observes local files and hashes, not upstream identity"},
            "usedTensors": used, "implementation": implementation, "effective": effective}


def export(model_dir, output, report):
    report["phase"] = "source-config"
    if not model_dir.is_dir():
        raise FileNotFoundError(f"model root does not exist: {model_dir}")
    config_bytes = (model_dir / "config.json").read_bytes()
    config = json.loads(config_bytes)
    quant = config.get("quantization", {})
    if config.get("model_type") != "qwen3_5" or any(quant.get(k) != v for k, v in
            {"group_size": 64, "bits": 4, "mode": "affine"}.items()):
        raise ValueError("expected dense Qwen3.5 affine4/group64 model pack")
    report["phase"] = "native-runtime"
    import numpy as np
    import mlx.core as mx
    import mlx.nn as nn
    from mlx_vlm.models.qwen3_5 import gated_delta as gd
    from mlx_vlm.models.qwen3_5 import language as language

    if not mx.metal.is_available():
        raise RuntimeError("MLX Metal is required; CPU fallback is not reference admission")
    mx.set_default_device(mx.gpu)
    report["effective"] = {"backend": "mlx-metal", "device": str(mx.default_device()),
                           "mlx": importlib.metadata.version("mlx"),
                           "mlx_vlm": importlib.metadata.version("mlx-vlm")}
    report["implementation"] = {str(Path(m.__file__).resolve()): sha(Path(m.__file__).read_bytes())
                                for m in [gd, language]}
    output.mkdir(parents=True, exist_ok=True)
    cfg = config["text_config"]
    tensors = {}
    for file in sorted(model_dir.glob("*.safetensors")):
        with file.open("rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            header = f.read(n)
        for name, meta in json.loads(header).items():
            if name != "__metadata__":
                if name in tensors:
                    raise ValueError(f"duplicate tensor {name}")
                tensors[name] = (file, n + 8, meta)
    if not tensors:
        raise ValueError("no safetensors at the requested model root")
    used = {}

    def tensor(name, start=0, count=None):
        file, base, meta = tensors[name]
        data, shape, used[name] = read_tensor_range(file, base, meta, start, count)
        if meta["dtype"] == "U32":
            return np.frombuffer(data, "<u4").reshape(shape).copy()
        if meta["dtype"] == "BF16":
            return (np.frombuffer(data, "<u2").astype(np.uint32) << 16).view(np.float32).reshape(shape)
        raise ValueError(f"unsupported source dtype {meta['dtype']}")

    arrays = {}

    def save(name, value):
        if isinstance(value, mx.array):
            mx.eval(value)
            value = np.array(value)
        array = np.ascontiguousarray(value)
        if array.dtype not in [np.dtype("float32"), np.dtype("uint32")]:
            raise ValueError(f"unexpected witness dtype {array.dtype}")
        if array.dtype == np.float32 and not np.isfinite(array).all():
            raise ValueError(f"nonfinite reference {name}")
        data = array.tobytes()
        (output / f"{name}.bin").write_bytes(data)
        arrays[name] = {"file": f"{name}.bin", "shape": list(array.shape),
                        "dtype": "f32" if array.dtype == np.float32 else "u32",
                        "bytes": len(data), "sha256": sha(data)}
        return array

    def signal(shape, phase=0, scale=.15):
        x = np.arange(int(np.prod(shape)), dtype=np.float32)
        return (np.sin(x * np.float32(.017) + np.float32(phase)) * np.float32(scale)
                + np.cos(x * np.float32(.131) + np.float32(phase)) * np.float32(scale / 5)).reshape(shape)

    report["phase"] = "affine-projection"
    affine = []
    projections = {}
    prefix = "language_model.model.layers.0."
    for label, key, start, count in [
        ("a", "linear_attn.in_proj_a", 0, 32),
        ("b", "linear_attn.in_proj_b", 0, 32),
        ("down", "mlp.down_proj", 17, 32),
    ]:
        w = tensor(prefix + key + ".weight", start, count)
        scales = tensor(prefix + key + ".scales", start, count)
        biases = tensor(prefix + key + ".biases", start, count)
        columns = w.shape[1] * 8
        x = signal((5, columns), phase=.2, scale=.05)
        y = mx.quantized_matmul(mx.array(x), mx.array(w), scales=mx.array(scales),
                                biases=mx.array(biases), transpose=True, group_size=64, bits=4, mode="affine")
        for name, value in [("weight", w), ("scales", scales), ("biases", biases), ("input", x), ("output", y)]:
            stored = save(f"affine-{label}.{name}", value)
            if name == "output":
                projections[label] = stored
        affine.append({"name": label, "tokens": 5, "rows": count, "columns": columns, "group": 64,
                       "sourceTensor": prefix + key, "sourceRowStart": start})

    report["phase"] = "gated-delta"
    gdn_cases = []
    for label, hk, hv, dk, dv, real in [("model", 16, 32, 128, 128, True), ("axes", 2, 4, 8, 12, False)]:
        tokens, kernel = 5, 4
        channels = 2 * hk * dk + hv * dv
        mixed = signal((1, tokens, channels), .3)
        history = signal((1, kernel - 1, channels), .7, .025)
        convw = tensor(prefix + "linear_attn.conv1d.weight") if real else signal((channels, kernel, 1), .4)
        A = tensor(prefix + "linear_attn.A_log") if real else signal((hv,), .2)
        dt = tensor(prefix + "linear_attn.dt_bias") if real else signal((hv,), -.3)
        normw = tensor(prefix + "linear_attn.norm.weight") if real else np.ones(dv, np.float32)
        a = projections["a"][None] if real else signal((1, tokens, hv), .1)
        b = projections["b"][None] if real else signal((1, tokens, hv), .4)
        z = signal((1, tokens, hv, dv), .9)
        initial = signal((1, hv, dv, dk), .6, .01)
        conv_input = mx.concatenate([mx.array(history), mx.array(mixed)], axis=1)
        convolved = nn.silu(mx.conv1d(conv_input, mx.array(convw), groups=channels))
        q, k, v = [t.reshape(1, tokens, h, d) for t, h, d in zip(
            mx.split(convolved, [hk * dk, 2 * hk * dk], axis=-1), [hk, hk, hv], [dk, dk, dv])]
        q, k = language.Qwen3_5GatedDeltaNet._normalize_qk(None, q, k)
        g, beta = gd._compute_g_beta(mx.array(A), mx.array(a), mx.array(b), mx.array(dt))
        y, state = gd.gated_delta_ops(q, k, v, g, beta, mx.array(initial))
        if real:
            fast_y, fast_state = gd.gated_delta_kernel(q, k, v, g, beta, mx.array(initial))
            mx.eval(y, state, fast_y, fast_state)
            np.testing.assert_allclose(np.array(fast_y), np.array(y), rtol=5e-5, atol=5e-6)
            np.testing.assert_allclose(np.array(fast_state), np.array(state), rtol=5e-5, atol=5e-6)
        norm = language.Qwen3_5RMSNormGated(dv)
        norm.weight = mx.array(normw)
        gated = norm(y, mx.array(z))
        prepared = mx.concatenate([q.reshape(tokens, -1), k.reshape(tokens, -1), v.reshape(tokens, -1),
                                   g.reshape(tokens, -1), beta.reshape(tokens, -1)], axis=-1)
        for name, value in [
            ("mixed", mixed[0]), ("history-in", history[0]), ("conv-weight", convw[:, :, 0]),
            ("gates", np.concatenate([a[0], b[0]], axis=-1)), ("parameters", np.concatenate([A, dt])),
            ("norm-weight", normw), ("z", z[0]), ("convolved", convolved[0]), ("prepared", prepared),
            ("state-in", initial[0].transpose(0, 2, 1)), ("state", state[0].transpose(0, 2, 1)),
            ("recurrence", y[0]), ("gated", gated[0]), ("history", conv_input[0, -(kernel - 1):]),
        ]:
            save(f"gdn-{label}.{name}", value)
        gdn_cases.append({"name": label, "tokens": tokens, "keyHeads": hk, "valueHeads": hv,
                          "keyDim": dk, "valueDim": dv, "kernel": kernel,
                          "authority": "real model geometry and parameters; synthetic activations" if real else "asymmetric synthetic axis witness"})

    report["phase"] = "cached-attention"
    tokens, qh, kvh, dim, capacity = 5, 16, 4, 256, 8
    qp = signal((1, tokens, qh, 2 * dim), .4)
    kp = signal((1, tokens, kvh, dim), .6)
    vp = signal((1, tokens, kvh, dim), .8)
    qnorm = tensor("language_model.model.layers.3.self_attn.q_norm.weight")
    knorm = tensor("language_model.model.layers.3.self_attn.k_norm.weight")
    q, gate = mx.split(mx.array(qp), 2, axis=-1)
    q = mx.fast.rms_norm(q, mx.array(qnorm), 1e-6).transpose(0, 2, 1, 3)
    k = mx.fast.rms_norm(mx.array(kp), mx.array(knorm), 1e-6).transpose(0, 2, 1, 3)
    rotary = language.Qwen3_5RotaryEmbedding(64, max_position_embeddings=cfg["max_position_embeddings"],
                                            base=cfg["rope_parameters"]["rope_theta"], mrope_section=[11, 11, 10])
    positions = mx.broadcast_to(mx.arange(tokens)[None, None, :], (3, 1, tokens))
    q, k = rotary.apply_rotary(q, k, positions)
    attention = mx.fast.scaled_dot_product_attention(q, k, mx.array(vp).transpose(0, 2, 1, 3),
                                                    scale=dim ** -.5, mask="causal").transpose(0, 2, 1, 3)
    gated = attention * mx.sigmoid(gate)
    kc = np.full((capacity, kvh, dim), .125, np.float32)
    vc = np.full((capacity, kvh, dim), -.25, np.float32)
    mx.eval(q, k, attention, gated)
    kc[:tokens] = np.array(k[0].transpose(1, 0, 2))
    vc[:tokens] = vp[0]
    for name, value in [("q-proj", qp[0]), ("k-proj", kp[0]), ("v-proj", vp[0]),
                        ("norms", np.concatenate([qnorm, knorm])), ("q", q[0].transpose(1, 0, 2)),
                        ("key-cache", kc), ("value-cache", vc), ("output", attention[0]), ("gated", gated[0])]:
        save(f"attention.{name}", value)
    meta = {"schema": "kaminos.qwen35-kernel-reference.v1", "source": reference_source(
            model_dir, config_bytes, used, report["implementation"], report["effective"]),
            "affine": affine, "gdn": gdn_cases, "attention": {"tokens": tokens, "queryHeads": qh, "kvHeads": kvh,
            "headDim": dim, "rotaryDim": 64, "ropeTheta": cfg["rope_parameters"]["rope_theta"], "capacity": capacity},
            "chunks": [2, 1, 2], "arrays": arrays}
    (output / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    report.update(status="passed", phase="complete", output=str(output / "meta.json"),
                  metaSha256=sha((output / "meta.json").read_bytes()), arrays=len(arrays))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    report = {"status": "failed", "phase": "setup", "exporter": {"path": str(Path(__file__).resolve()),
              "sha256": sha(Path(__file__).read_bytes())}, "requested": {"backend": "mlx-metal",
              "modelRoot": str(args.model_dir.resolve()), "outputRoot": str(args.out.resolve())}}
    try:
        export(args.model_dir.resolve(), args.out.resolve(), report)
    except BaseException:
        report["error"] = traceback.format_exc()
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report.get(k) for k in ["status", "phase", "output", "error"]}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
