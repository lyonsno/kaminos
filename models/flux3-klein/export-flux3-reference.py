"""Export a FLUX.3 Klein transformer reference for browser parity work.

Runs diffusers' Flux3Transformer2DModel (flow map, text-to-image) on CPU in float32 for chosen
denoising steps, with every weight replaced by exactly what the browser reconstructs from
pack-flux3-transformer.py's bundles: block linears through Klein's quantizer at --format, globals at
--globals-format, norm weights rounded to f16. The text features come from the shipped Qwen3-VL text
encoder through Flux3's own prompt-embedding function, run in float32 with its packed layers' linears
quantized like pack-text-encoder.py at --te-format (f16 norms and token embeddings), so the browser's
text encoder can be compared too: token ids, mask, positions, every tapped hidden state and the stacked
prompt embeddings are saved. Initial latents come from a seeded float32 normal draw.

Writes raw little-endian float32 tensors beside manifest.json (shape, dtype, sha256, effective
versions and weight identity), per step: inputs, the per-mode conditioning (timestep embeddings and
modulation vectors), embedder outputs, every block's output, the output norm and the velocity.
manifest.json is written even when a phase fails, naming it.

  python export-flux3-reference.py --model-dir <hf snapshot> --out <dir> --prompt-file <txt>
      [--size 256] [--seed 9001] [--steps 16] [--at 0,15] [--format i4] [--globals-format i8] [--te-format i4]
      [--lora <file> [--lora-strength 1]] [--shift 6.93]

For the base checkpoint (no flow map) pass --lora (merged in f32 before quantization, exactly as
pack-flux3-transformer.py does) and the LoRA's recipe, e.g. --steps 4 --at 0,3 --shift 3.
"""
import argparse
import hashlib
import importlib.util
import json
import platform
import time
import traceback
from pathlib import Path

import numpy as np
import torch

here = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("flux3_pack", here / "pack-flux3-transformer.py")
flux3_pack = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flux3_pack)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--seed", type=int, default=9001)
    ap.add_argument("--steps", type=int, default=16)
    ap.add_argument("--at", default="0,15", help="steps whose transformer evaluation is exported")
    ap.add_argument("--format", default="i4")
    ap.add_argument("--globals-format", default="i8")
    ap.add_argument("--group", type=int, default=64)
    ap.add_argument("--te-format", default="i4")
    ap.add_argument("--lora")
    ap.add_argument("--lora-strength", type=float, default=1.0)
    ap.add_argument("--shift", type=float, default=6.93)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    model_dir = Path(args.model_dir)
    manifest = {"schema": "kaminos.flux3-klein.transformer-reference.v0", "host": platform.node(), "phase": "import",
                "size": args.size, "seed": args.seed, "steps": args.steps, "weights": {"format": args.format,
                "globals_format": args.globals_format, "group": args.group, "te_format": args.te_format}, "tensors": {}}

    def write():
        (out / "manifest.json").write_text(json.dumps(manifest, indent=1))

    def save(name, t):
        a = np.ascontiguousarray(t.detach().to(torch.float32).cpu().numpy())
        data = a.tobytes()
        file = name.replace("/", "__") + ".f32"
        (out / file).write_bytes(data)
        manifest["tensors"][name] = {"file": file, "dtype": "float32", "shape": list(a.shape),
                                     "sha256": hashlib.sha256(data).hexdigest()}

    try:
        import diffusers
        import transformers
        from diffusers.models.transformers.transformer_flux3 import Flux3Transformer2DModel
        from diffusers.modular_pipelines.flux3.encoders import Flux3TextEncoderStep
        from diffusers.modular_pipelines.flux3.before_denoise import _prepare_image_ids
        from transformers import Qwen3VLForConditionalGeneration, Qwen3VLProcessor
        from diffusers import FlowMatchEulerDiscreteScheduler
        from diffusers.modular_pipelines.flux3.before_denoise import retrieve_timesteps
        manifest["versions"] = {"torch": torch.__version__, "diffusers": diffusers.__version__,
                                "transformers": transformers.__version__}
        manifest["source"] = flux3_pack.source_identity(model_dir / "transformer")
        prompt = Path(args.prompt_file).read_text().strip()
        manifest["prompt"] = prompt

        manifest["phase"] = "text"
        t0 = time.time()
        te = Qwen3VLForConditionalGeneration.from_pretrained(model_dir / "text_encoder", dtype=torch.float32).eval()
        proc = Qwen3VLProcessor.from_pretrained(model_dir / "text_encoder")
        lm = te.model.language_model
        taps_read = (4, 8, 12, 16, 20, 24, 28, 32)
        te_q = {"quantized": 0, "f16": 0}
        with torch.no_grad():
            for i, layer in enumerate(lm.layers[:max(taps_read)]):
                for name, param in layer.named_parameters():
                    w = param.data.numpy()
                    if w.ndim == 2 and w.shape[1] % args.group == 0 and args.te_format != "f16":
                        param.data.copy_(torch.from_numpy(flux3_pack.quantize(w, args.te_format, args.group)[2]))
                        te_q["quantized"] += 1
                    else:
                        param.data.copy_(torch.from_numpy(w.astype(np.float16).astype(np.float32)))
                        te_q["f16"] += 1
            lm.embed_tokens.weight.data.copy_(lm.embed_tokens.weight.data.half().float())
        manifest["textEncoderTensors"] = te_q
        # the framing the pipeline uses, saved for the browser tokenizer
        text = proc.apply_chat_template([{"role": "user", "content": prompt}], tokenize=False, add_generation_prompt=True)
        real = proc.tokenizer(text, return_tensors="pt", truncation=True, max_length=8192)["input_ids"].shape[1]
        padded = min(-(-real // 80) * 80, 8192)
        tok = proc.tokenizer(text, return_tensors="pt", padding="max_length", padding_side="right", truncation=True, max_length=padded)
        manifest["chat_template_text"] = text
        manifest["real_tokens"] = real
        ids, mask = tok["input_ids"][0], tok["attention_mask"][0]
        save("text/input_ids", ids.to(torch.float32))
        save("text/attention_mask", mask.to(torch.float32))
        save("text/position_ids", torch.arange(padded).masked_fill(mask == 0, 1).to(torch.float32))
        hidden = {}
        hooks_te = [lm.layers[k - 1].register_forward_hook(lambda _m, _i, o, k=k: hidden.__setitem__(k, o[0] if isinstance(o, tuple) else o)) for k in taps_read]
        with torch.no_grad():
            embeds = Flux3TextEncoderStep._get_qwen3_vl_prompt_embeds(te, proc, prompt, device=torch.device("cpu"))
        for h in hooks_te:
            h.remove()
        for k in taps_read:
            save(f"text/hidden{k:02d}", hidden[k][0])
        embeds = embeds.to(torch.float32)
        del te
        manifest["textSeconds"] = round(time.time() - t0, 1)
        save("text/prompt_embeds", embeds[0])
        txt_n = embeds.shape[1]
        txt_ids = torch.zeros(txt_n, 4)
        txt_ids[:, 3] = torch.arange(txt_n)
        save("text/txt_ids", txt_ids)

        manifest["phase"] = "transformer-load"
        t0 = time.time()
        tr = Flux3Transformer2DModel.from_pretrained(model_dir / "transformer", torch_dtype=torch.float32).eval()
        tr.mode_blocks["image_cond"] = torch.nn.ModuleList()
        for d in (tr.x_embedders, tr.early_stream_modulations, tr.single_stream_modulations):
            del d["image_cond"]
        flow_map = bool(tr.config.flow_map)
        manifest["flowMap"] = flow_map
        if args.lora:
            import sys
            sys.path.insert(0, str(here))
            from flux3_lora import lora_deltas
            deltas = lora_deltas(args.lora, args.lora_strength)
            params = dict(tr.named_parameters())
            with torch.no_grad():
                for name, d in deltas.items():
                    params[name].data.add_(d)
            manifest["lora"] = {"file": Path(args.lora).name, "merged": len(deltas), "strength": args.lora_strength}
        manifest["phase"] = "transformer-quantize"
        globals_names = {p for _, p in flux3_pack.GLOBALS}
        quantized = {"block": 0, "globals": 0, "f16": 0}
        with torch.no_grad():
            for name, param in tr.named_parameters():
                w = param.data.numpy()
                if w.ndim == 2 and w.shape[1] % args.group == 0:
                    kind = "globals" if name in globals_names else "block"
                    fmt = args.globals_format if kind == "globals" else args.format
                    if fmt == "f16":
                        param.data.copy_(torch.from_numpy(w.astype(np.float16).astype(np.float32)))
                    else:
                        _, _, deq = flux3_pack.quantize(w, fmt, args.group)
                        param.data.copy_(torch.from_numpy(deq))
                    quantized[kind] += 1
                else:
                    param.data.copy_(torch.from_numpy(w.astype(np.float16).astype(np.float32)))
                    quantized["f16"] += 1
        manifest["quantizedTensors"] = quantized
        manifest["transformerSeconds"] = round(time.time() - t0, 1)

        manifest["phase"] = "inputs"
        grid = args.size // 16
        gen = torch.Generator("cpu").manual_seed(args.seed)
        latents = torch.randn(1, 128, grid, grid, generator=gen, dtype=torch.float32).flatten(2).transpose(1, 2)
        img_ids = _prepare_image_ids(grid, grid, 0.5)
        save("denoise/img_ids", img_ids)
        save("denoise/latents_init", latents[0])
        scheduler = FlowMatchEulerDiscreteScheduler(shift=args.shift)
        manifest["shift"] = args.shift
        retrieve_timesteps(scheduler, None, "cpu", sigmas=np.linspace(1.0, 1 / args.steps, args.steps))
        sigmas = scheduler.sigmas
        manifest["sigmas"] = [float(s) for s in sigmas]

        taps = {}

        def hook(name):
            def fn(_m, _i, o):
                taps.setdefault(name, []).append(o[1] if isinstance(o, tuple) and name.startswith("single") else o)
            return fn

        def hook_txt(name):
            def fn(_m, _i, o):
                taps.setdefault(name, []).append(o[0])
            return fn

        hooks = [tr.timestep_embedder.register_forward_hook(hook("temb")),
                 tr.context_embedder.register_forward_hook(hook("context_embedder")),
                 tr.x_embedders["image"].register_forward_hook(hook("x_embedder")),
                 tr.norm_out.register_forward_hook(hook("norm_out"))]
        if flow_map:
            hooks.append(tr.target_timestep_embedder.register_forward_hook(hook("target")))
        for key, mod in (("mod_early_img", tr.early_stream_modulations["image"]), ("mod_early_txt", tr.early_stream_modulations["txt"]),
                         ("mod_single_img", tr.single_stream_modulations["image"]), ("mod_single_txt", tr.single_stream_modulations["txt"])):
            hooks.append(mod.register_forward_hook(hook(key)))
        hooks.append(tr.norm_out.linear.register_forward_hook(hook("mod_norm_out")))
        for i, b in enumerate(tr.txt_mode_blocks):
            hooks.append(b.register_forward_hook(hook(f"txt{i:02d}")))
        for i, b in enumerate(tr.mode_blocks["image"]):
            hooks.append(b.register_forward_hook(hook(f"img{i:02d}")))
        for i, b in enumerate(tr.single_transformer_blocks):
            hooks.append(b.register_forward_hook(hook(f"single{i:02d}")))
            hooks.append(b.register_forward_hook(hook_txt(f"single{i:02d}_txt")))

        for step in [int(s) for s in args.at.split(",")]:
            manifest["phase"] = f"step{step}"
            taps.clear()
            sigma, target = float(sigmas[step]), float(sigmas[step + 1])
            # the pipeline passes t / 1000 with t = sigma * 1000 (float32 here)
            timestep = (torch.tensor([sigma * 1000], dtype=torch.float32) / 1000)
            target_t = (torch.tensor([target * 1000], dtype=torch.float32) / 1000)
            p = f"step{step}"
            save(f"{p}/latents_in", latents[0])
            save(f"{p}/timestep", timestep)
            if flow_map:
                save(f"{p}/target_timestep", target_t)
            t0 = time.time()
            with torch.no_grad():
                v = tr(hidden_states=latents, encoder_hidden_states=embeds, timestep=timestep, img_ids=img_ids,
                       txt_ids=txt_ids, target_timestep=target_t if flow_map else None, return_dict=False)[0]
            manifest[f"{p}/seconds"] = round(time.time() - t0, 2)
            temb_img, temb_zero = taps["temb"][0], taps["temb"][1]
            tgt = taps["target"][0] if flow_map else 0
            save(f"{p}/temb_img", (temb_img + tgt)[0])
            save(f"{p}/temb_zero", (temb_zero + tgt)[0])
            mods = torch.cat([taps["mod_early_img"][0][0, 0], taps["mod_early_txt"][0][0, 0], taps["mod_single_img"][0][0, 0],
                              taps["mod_single_txt"][0][0, 0], taps["mod_norm_out"][0][0, 0]])
            save(f"{p}/mods", mods)
            save(f"{p}/context_embedder", taps["context_embedder"][0][0])
            save(f"{p}/x_embedder", taps["x_embedder"][0][0])
            for i in range(tr.config.num_layers):
                save(f"{p}/txt{i:02d}", taps[f"txt{i:02d}"][0][0])
                save(f"{p}/img{i:02d}", taps[f"img{i:02d}"][0][0])
            for i in range(tr.config.num_single_layers):
                # the joint stream as the browser holds it: text rows, then image rows
                save(f"{p}/single{i:02d}", torch.cat([taps[f"single{i:02d}_txt"][0][0], taps[f"single{i:02d}"][0][0]]))
            save(f"{p}/norm_out", taps["norm_out"][0][0])
            save(f"{p}/velocity", v[0])
            write()
        for h in hooks:
            h.remove()
        manifest["phase"] = "done"
    except Exception:
        manifest["error"] = traceback.format_exc()
    write()
    print(json.dumps({"phase": manifest["phase"], "error": (manifest.get("error") or "").splitlines()[-1:]}))


if __name__ == "__main__":
    main()
