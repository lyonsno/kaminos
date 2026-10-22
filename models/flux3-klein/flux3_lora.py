"""Merge a FLUX.3 LoRA (ComfyUI / BFL naming, e.g. Muinez/flux3-klein-distil-4step) into transformer weights.

diffusers' Flux3 LoRA converter renames block targets but keeps the alpha entries and a dozen
BFL-named targets (modulation .lin, emb_in, txt_in, time_in, final_layer), which load_lora_weights
then rejects. lora_deltas() finishes the rename with the mapping diffusers' BFL-to-diffusers
checkpoint conversion uses, including its [shift, scale] -> [scale, shift] swap of the output adaLN,
and returns {diffusers parameter name: strength * alpha / rank * up @ down} in float32. Targets in the
reference-image mode (image_cond) are dropped unless keep_image_cond; text-to-image never runs them.
"""
import torch

RENAMES = [(".time_in.in_layer", ".timestep_embedder.linear_1"), (".time_in.out_layer", ".timestep_embedder.linear_2"),
           (".final_layer.image.adaLN_modulation.1", ".norm_out.linear"), (".final_layer.image.linear", ".proj_out"),
           (".emb_in.", ".x_embedders."), (".txt_in", ".context_embedder")]


def lora_deltas(lora_file, strength=1.0, keep_image_cond=False):
    from diffusers.modular_pipelines.flux3.modular_pipeline import Flux3ModularPipeline
    sd = Flux3ModularPipeline.lora_state_dict(str(lora_file))
    sd = sd[0] if isinstance(sd, tuple) else sd
    deltas = {}
    for down_key in [k for k in sd if k.endswith(".lora_down.weight")]:
        base = down_key[: -len(".lora_down.weight")]
        name = base
        for a, b in RENAMES:
            name = name.replace(a, b)
        if name.endswith(".lin"):
            name = name[:-4] + ".linear"
        if not name.startswith("transformer."):
            raise KeyError(f"unexpected LoRA target {base}")
        name = name[len("transformer."):] + ".weight"
        if "image_cond" in name and not keep_image_cond:
            continue
        down, up = sd[down_key].float(), sd[base + ".lora_up.weight"].float()
        alpha = float(sd[base + ".alpha"]) if base + ".alpha" in sd else down.shape[0]
        if base.endswith("adaLN_modulation.1"):
            up = torch.cat(up.chunk(2, dim=0)[::-1])
        deltas[name] = (up @ down) * (alpha / down.shape[0]) * strength
    return deltas
