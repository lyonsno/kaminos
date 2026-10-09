"""Export a source-faithful FLUX.2 Klein reference run for browser parity work.

Runs the pinned diffusers Flux2KleinPipeline on CPU in float32 for one prompt,
seed and size, and writes every boundary a WebGPU port needs to match:
tokenizer ids and mask, the three Qwen3 hidden-state taps, initial noise,
sigmas/timesteps, per-step transformer inputs and outputs, per-block outputs
for the first step, the de-normalized VAE input, and the decoded image.

Tensors are raw little-endian float32 (or int32) files beside manifest.json,
which records shapes, dtypes, sha256 digests, and the effective source
versions. Usage:

  python export-reference.py --model-dir <hf snapshot> --out <dir> \
      --prompt-file <txt> --seed 7006 --size 512 --steps 4
"""
import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import numpy as np
import torch
import diffusers
import transformers
from diffusers import Flux2KleinPipeline


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--block-step", type=int, default=0, help="step whose per-block outputs are saved")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tensors = {}
    report = {"schema": "kaminos.flux2-klein.reference.v0", "phase": "load", "started_at": time.time()}

    def save(name, t):
        a = t.detach().to(torch.float32 if t.is_floating_point() else torch.int32).contiguous().cpu().numpy()
        path = out / f"{name}.bin"
        path.parent.mkdir(parents=True, exist_ok=True)
        data = a.tobytes()
        path.write_bytes(data)
        tensors[name] = {"file": f"{name}.bin", "shape": list(a.shape), "dtype": str(a.dtype),
                         "sha256": hashlib.sha256(data).hexdigest()}

    def write_manifest():
        report["tensors"] = tensors
        (out / "manifest.json").write_text(json.dumps(report, indent=1))

    try:
        torch.set_grad_enabled(False)
        prompt = Path(args.prompt_file).read_text().strip()
        pipe = Flux2KleinPipeline.from_pretrained(args.model_dir, torch_dtype=torch.float32)
        pipe.to("cpu")
        report.update({
            "prompt": prompt, "seed": args.seed, "size": args.size, "steps": args.steps,
            "model_dir": str(Path(args.model_dir).resolve()),
            "versions": {"diffusers": diffusers.__version__, "transformers": transformers.__version__,
                         "torch": torch.__version__, "python": platform.python_version()},
            "device": "cpu", "dtype": "float32", "is_distilled": bool(pipe.config.is_distilled),
            "transformer_config": dict(pipe.transformer.config),
        })

        # Tokenizer boundary, reproduced exactly as _get_qwen3_prompt_embeds builds it.
        report["phase"] = "tokenize"
        text = pipe.tokenizer.apply_chat_template([{"role": "user", "content": prompt}], tokenize=False,
                                                  add_generation_prompt=True, enable_thinking=False)
        tok = pipe.tokenizer(text, return_tensors="pt", padding="max_length", truncation=True, max_length=512)
        report["chat_template_text"] = text
        report["prompt_token_count"] = int(tok["attention_mask"].sum())
        save("tokenizer/input_ids", tok["input_ids"][0])
        save("tokenizer/attention_mask", tok["attention_mask"][0])

        report["phase"] = "text-encoder"
        prompt_embeds, text_ids = pipe.encode_prompt(prompt=prompt, device="cpu", num_images_per_prompt=1,
                                                     max_sequence_length=512)
        save("text/prompt_embeds", prompt_embeds[0])
        save("text/text_ids", text_ids[0])

        # Capture transformer inputs/outputs per call and per-block outputs on one step.
        report["phase"] = "denoise"
        calls = []
        block_outputs = {}

        def transformer_pre(module, a, kw):
            calls.append({"hidden_states": kw["hidden_states"].clone(), "timestep": kw["timestep"].clone(),
                          "img_ids": kw["img_ids"].clone()})

        def transformer_post(module, a, kw, output):
            calls[-1]["output"] = (output[0] if isinstance(output, tuple) else output.sample).clone()

        def block_hook(name):
            def hook(module, a, kw, output):
                if len(calls) - 1 != args.block_step:
                    return
                if isinstance(output, tuple):
                    block_outputs[f"{name}/txt"] = output[0].clone()
                    block_outputs[f"{name}/img"] = output[1].clone()
                else:
                    block_outputs[name] = output.clone()
            return hook

        hooks = [pipe.transformer.register_forward_pre_hook(transformer_pre, with_kwargs=True),
                 pipe.transformer.register_forward_hook(transformer_post, with_kwargs=True)]
        for i, b in enumerate(pipe.transformer.transformer_blocks):
            hooks.append(b.register_forward_hook(block_hook(f"double{i:02d}"), with_kwargs=True))
        for i, b in enumerate(pipe.transformer.single_transformer_blocks):
            hooks.append(b.register_forward_hook(block_hook(f"single{i:02d}"), with_kwargs=True))
        tr = pipe.transformer
        for name, mod in [("x_embedder", tr.x_embedder), ("context_embedder", tr.context_embedder),
                          ("temb", tr.time_guidance_embed), ("mod_double_img", tr.double_stream_modulation_img),
                          ("mod_double_txt", tr.double_stream_modulation_txt),
                          ("mod_single", tr.single_stream_modulation), ("norm_out", tr.norm_out)]:
            hooks.append(mod.register_forward_hook(block_hook(f"model/{name}"), with_kwargs=True))
        pos_calls = []

        def pos_hook(module, a, kw, output):
            if len(calls) - 1 == args.block_step:
                pos_calls.append(output)
        hooks.append(tr.pos_embed.register_forward_hook(pos_hook, with_kwargs=True))

        generator = torch.Generator("cpu").manual_seed(args.seed)
        t0 = time.time()
        latents = pipe(prompt_embeds=prompt_embeds, height=args.size, width=args.size,
                       num_inference_steps=args.steps, guidance_scale=1.0, generator=generator,
                       output_type="latent", return_dict=False)[0]
        report["denoise_seconds"] = time.time() - t0
        for h in hooks:
            h.remove()

        report["sigmas"] = [float(s) for s in pipe.scheduler.sigmas]
        report["timesteps"] = [float(t) for t in pipe.scheduler.timesteps]
        save("denoise/img_ids", calls[0]["img_ids"][0])
        for i, c in enumerate(calls):
            save(f"denoise/step{i}/latents_in", c["hidden_states"][0])
            save(f"denoise/step{i}/timestep", c["timestep"])
            save(f"denoise/step{i}/velocity", c["output"][0])
        for name, t in block_outputs.items():
            save(f"blocks_step{args.block_step}/{name}", t[0] if t.ndim == 3 else t)
        # Flux2PosEmbed runs on image ids first, then text ids.
        for label, (cos, sin) in zip(("img", "txt"), pos_calls):
            save(f"blocks_step{args.block_step}/rope/{label}_cos", cos)
            save(f"blocks_step{args.block_step}/rope/{label}_sin", sin)

        # VAE boundary: `latents` is already de-normalized and unpatchified by the pipeline.
        report["phase"] = "vae-decode"
        save("vae/latents_in", latents[0])
        t0 = time.time()
        image = pipe.vae.decode(latents, return_dict=False)[0]
        report["vae_seconds"] = time.time() - t0
        save("vae/image", image[0])
        pil = pipe.image_processor.postprocess(image, output_type="pil")[0]
        pil.save(out / "image.png")
        report["image_png_sha256"] = hashlib.sha256((out / "image.png").read_bytes()).hexdigest()
        report["phase"] = "done"
    except Exception as e:  # the manifest names the failure phase and keeps what was written
        report["error"] = repr(e)
        raise
    finally:
        report["finished_at"] = time.time()
        write_manifest()


if __name__ == "__main__":
    main()
