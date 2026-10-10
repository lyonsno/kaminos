"""Image-quality assay for FLUX.2 Klein weight quantization schemes.

Runs the pinned diffusers Flux2KleinPipeline in float32 with the text encoder's and the
transformer's linear weights fake-quantized per scheme: quantized and dequantized exactly as
pack-text-encoder.py and pack-transformer.py do (affine b-bit with f16 scale and bias per group;
int8 symmetric with an f16 scale per group). Prompts, seeds and everything else are fixed, so the
differences between schemes are quantization effects. The browser uses its own noise generator, so
these images are not the page's images; the comparison between rows is what this measures.

  python quant-assay.py --model-dir <snapshot> --prompts <dir of .txt> --out <dir>
      [--schemes int4-g64,int4-g128,...] [--size 512] [--steps 4] [--seed-base 7000] [--device mps]

Writes <out>/<scheme>/<prompt>.png, <out>/contact-sheet.jpg (rows are schemes, columns prompts) and
<out>/report.json: scheme definitions, estimated download bytes per component, PSNR of each image
against the first scheme, timings, and the effective device and dtype. The report is written even
when a phase fails.
"""
import argparse
import json
import math
import os
import platform
import subprocess
import time
import traceback
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

TE_LAYERS = 27  # the pipeline reads hidden states 9, 18 and 27
GLOBALS = ["x_embedder", "context_embedder", "time_guidance_embed.timestep_embedder.linear_1",
           "time_guidance_embed.timestep_embedder.linear_2", "double_stream_modulation_img.linear",
           "double_stream_modulation_txt.linear", "single_stream_modulation.linear", "norm_out.linear", "proj_out"]

# Each component is quantized as (kind, bits, group). All but "sym" are the int4 packer's affine
# format (q * scale + bias, f16 scale and bias per group) with different ways of choosing the range:
# "affine" min/max; "mse" the per-group range shrink that minimizes squared error; "hqq" min/max
# with the zero point optimized by HQQ; "sign" (1 bit) +/- mean |w| per group. "sym" is int8.
# On a transformer block weight, relative error at 2 bits is minmax 0.46, hqq 0.44, mse 0.34; at
# 1 bit minmax 1.7, hqq 1.05, sign 0.61 (zeroing the weight would be 1.0).
SCHEMES = {
    "int4-g64": {"te": ("affine", 4, 64), "blocks": ("affine", 4, 64), "globals": ("sym", 8, 64)},
    "int4-g128": {"te": ("affine", 4, 128), "blocks": ("affine", 4, 128), "globals": ("sym", 8, 64)},
    "globals-int4": {"te": ("affine", 4, 64), "blocks": ("affine", 4, 64), "globals": ("affine", 4, 64)},
    "te-3bit": {"te": ("affine", 3, 64), "blocks": ("affine", 4, 64), "globals": ("sym", 8, 64)},
    "dit-3bit": {"te": ("affine", 4, 64), "blocks": ("affine", 3, 64), "globals": ("sym", 8, 64)},
    "all-3bit": {"te": ("affine", 3, 64), "blocks": ("affine", 3, 64), "globals": ("sym", 8, 64)},
    "lean-int4": {"te": ("affine", 4, 128), "blocks": ("affine", 4, 128), "globals": ("affine", 4, 64)},
    # Low-bit ladder: the transformer blocks (and optionally the text encoder) below 4 bits.
    "q3-dit": {"te": ("affine", 4, 128), "blocks": ("mse", 3, 64), "globals": ("affine", 4, 64)},
    "q3-all": {"te": ("mse", 3, 64), "blocks": ("mse", 3, 64), "globals": ("affine", 4, 64)},
    "q2-dit": {"te": ("affine", 4, 128), "blocks": ("mse", 2, 64), "globals": ("affine", 4, 64)},
    "q2-all": {"te": ("mse", 2, 64), "blocks": ("mse", 2, 64), "globals": ("affine", 4, 64)},
    "q1-dit": {"te": ("affine", 4, 128), "blocks": ("sign", 1, 64), "globals": ("affine", 4, 64)},
    "q1-all": {"te": ("sign", 1, 64), "blocks": ("sign", 1, 64), "globals": ("affine", 4, 64)},
}
FIXED_BYTES = {"vae": 99_241_984, "tokenizer": 11_422_654}  # unchanged by these schemes


def hqq_params(g, bits, iters=20, lp_norm=0.7, beta=10.0, kappa=1.01):
    """HQQ (half-quadratic quantization, Badri & Shaji 2023): starting from the min/max range, fit
    each group's zero point to minimize an l_p (p < 1) error that tolerates outliers. Returns the
    affine scale and bias (dequantized = q * scale + bias) for groups g [..., group]."""
    levels = 2 ** bits - 1
    lo, hi = g.amin(dim=-1, keepdim=True), g.amax(dim=-1, keepdim=True)
    inv = (levels / (hi - lo)).clamp(max=2e4)
    zero = -lo * inv
    best_zero, best_err = zero, float("inf")
    for _ in range(iters):
        q = torch.round(g * inv + zero).clamp(0, levels)
        diff = g - (q - zero) / inv
        err = float(diff.abs().mean())
        if err >= best_err:
            break
        best_err, best_zero = err, zero
        mag = diff.abs()
        shrunk = torch.sign(diff) * torch.relu(mag - (1.0 / beta) * mag.pow(lp_norm - 1))
        zero = (q - (g - shrunk) * inv).mean(dim=-1, keepdim=True)
        beta *= kappa
    scale = 1.0 / inv
    return scale, -best_zero * scale


def fake_quantize(w, kind, bits, group, device="cpu"):
    """Dequantized f32 copy of a 2-D weight [N, K], matching the packers' rounding (CPU, f32).
    hqq runs on `device` (its result is a scale and bias per group, stored f16 like the packer's)."""
    n, k = w.shape
    levels = 2 ** bits - 1

    def dequant(g, scale, bias):
        scale, bias = scale.half().float(), bias.half().float()
        safe = torch.where(scale == 0, torch.ones_like(scale), scale)
        return torch.clamp(torch.round((g - bias) / safe), 0, levels) * scale + bias

    if kind in ("hqq", "mse", "sign"):
        g = w.reshape(n, k // group, group).to(device, torch.float32)
        if kind == "hqq":
            out = dequant(g, *hqq_params(g, bits))
        elif kind == "sign":
            assert bits == 1, "sign is the 1-bit scheme"
            a = g.abs().mean(dim=-1, keepdim=True)
            out = dequant(g, 2 * a, -a)
        else:
            lo, hi = g.amin(dim=-1, keepdim=True), g.amax(dim=-1, keepdim=True)
            out, best = None, None
            for r in torch.linspace(0.4, 1.0, 10).tolist():
                d = dequant(g, (hi - lo) * r / levels, lo * r)
                e = ((d - g) ** 2).sum(dim=-1, keepdim=True)
                out = d if out is None else torch.where(e < best, d, out)
                best = e if best is None else torch.minimum(e, best)
        return out.reshape(n, k).cpu()
    g = w.reshape(n, k // group, group).to(torch.float32)
    if kind == "sym":
        qmax = 2 ** (bits - 1) - 1
        scale = (g.abs().amax(dim=2, keepdim=True) / qmax).half().float()
        safe = torch.where(scale == 0, torch.ones_like(scale), scale)
        return (torch.clamp(torch.round(g / safe), -qmax, qmax) * scale).reshape(n, k)
    levels = 2 ** bits - 1
    lo, hi = g.amin(dim=2, keepdim=True), g.amax(dim=2, keepdim=True)
    scale = ((hi - lo) / levels).half().float()
    bias = lo.half().float()
    safe = torch.where(scale == 0, torch.ones_like(scale), scale)
    return (torch.clamp(torch.round((g - bias) / safe), 0, levels) * scale + bias).reshape(n, k)


def bits_per_weight(kind, bits, group):
    return bits + (16 if kind == "sym" else 32) / group  # f16 scale (and f16 bias for affine) per group


def targets(pipe):
    """Linear modules each scheme quantizes, by component, with names for the report."""
    te = pipe.text_encoder
    layers = te.model.layers if hasattr(te, "model") else te.layers
    out = {"te": [], "blocks": [], "globals": []}
    for i in range(TE_LAYERS):
        for name, mod in layers[i].named_modules():
            if isinstance(mod, torch.nn.Linear):
                out["te"].append((f"te.layers.{i}.{name}", mod))
    tr = pipe.transformer
    for prefix in ("transformer_blocks", "single_transformer_blocks"):
        for name, mod in getattr(tr, prefix).named_modules():
            if isinstance(mod, torch.nn.Linear):
                out["blocks"].append((f"{prefix}.{name}", mod))
    for name in GLOBALS:
        mod = tr.get_submodule(name)
        assert isinstance(mod, torch.nn.Linear), name
        out["globals"].append((name, mod))
    return out


def psnr(a, b):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return float("inf") if mse == 0 else 10 * math.log10(255.0 ** 2 / mse)


def contact_sheet(out, schemes, names, report):
    cell, label_w, head_h = 384, 260, 34
    sheet = Image.new("RGB", (label_w + cell * len(names), head_h + cell * len(schemes)), (24, 24, 22))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    for c, name in enumerate(names):
        draw.text((label_w + c * cell + 8, 8), name, fill=(220, 220, 214), font=font)
    for r, scheme in enumerate(schemes):
        gb = report["schemes"][scheme]["download_bytes"] / 1e9
        err = report["schemes"][scheme].get("weight_rel_l2", {})
        detail = "".join(f"\n{c} err {err[c]:.2f}" for c in ("te", "blocks") if c in err)
        draw.text((10, head_h + r * cell + 12), f"{scheme}\n{gb:.2f} GB download{detail}", fill=(220, 220, 214), font=font)
        for c, name in enumerate(names):
            im = Image.open(out / scheme / f"{name}.png").convert("RGB").resize((cell, cell), Image.LANCZOS)
            sheet.paste(im, (label_w + c * cell, head_h + r * cell))
    sheet.save(out / "contact-sheet.jpg", quality=92)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--schemes", default=",".join(SCHEMES))
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--seed-base", type=int, default=7000)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--quant-device", default="cpu", help="where fake quantization runs (cpu matches the packers)")
    ap.add_argument("--only", default=None, help="comma-separated prompt names; seeds stay those of the full sorted set")
    ap.add_argument("--baseline-dir", default=None,
                    help="earlier run whose first-scheme images (same prompts and seeds) are reused instead of regenerated")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).resolve().parent
    try:
        rev = subprocess.run(["git", "-C", str(here), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(here), "status", "--porcelain", "--", "."], capture_output=True, text=True).stdout.split("\n")
    except OSError:
        rev, dirty = None, []
    schemes = args.schemes.split(",")
    report = {"schema": "kaminos.flux2-klein.quant-assay.v0", "phase": "setup", "host": platform.node(),
              "source": {"rev": rev, "dirty": [d for d in dirty if d]}, "model_dir": str(Path(args.model_dir).resolve()),
              "requested": {"device": args.device, "dtype": "float32", "size": args.size, "steps": args.steps,
                            "seed_base": args.seed_base, "schemes": schemes},
              "scheme_definitions": {s: SCHEMES[s] for s in schemes}, "schemes": {}, "images": []}

    def save_report():
        (out / "report.json").write_text(json.dumps(report, indent=1))

    try:
        from diffusers import Flux2KleinPipeline
        prompt_files = sorted(Path(args.prompts).glob("*.txt"))
        prompts = [(p.stem, p.read_text().strip(), args.seed_base + i + 1) for i, p in enumerate(prompt_files)]
        if args.only:
            keep = args.only.split(",")
            prompts = [row for row in prompts if row[0] in keep]
            assert len(prompts) == len(keep), f"--only names not all found: {keep}"
        report["prompts"] = [{"name": n, "prompt": t, "seed": s} for n, t, s in prompts]
        report["phase"] = "load"
        t0 = time.time()
        pipe = Flux2KleinPipeline.from_pretrained(args.model_dir, torch_dtype=torch.float32)
        mods = targets(pipe)
        originals = {comp: [m.weight.detach().to("cpu", torch.float32).clone() for _, m in lst] for comp, lst in mods.items()}
        params = {comp: sum(w.numel() for w in ws) for comp, ws in originals.items()}
        report["params"] = params
        pipe.to(args.device)
        report["effective"] = {"device": str(next(pipe.transformer.parameters()).device),
                               "dtype": str(next(pipe.transformer.parameters()).dtype), "torch": torch.__version__}
        report["load_s"] = time.time() - t0
        save_report()

        applied = {}  # component -> spec currently in the model, so unchanged components are not redone
        if args.baseline_dir:
            # Reuse the first scheme's images when the earlier run used the same prompt text and seed.
            base = Path(args.baseline_dir)
            prior = json.loads((base / "report.json").read_text())
            first = schemes[0]
            (out / first).mkdir(exist_ok=True)
            known = {(p["name"], p["prompt"], p["seed"]) for p in prior["prompts"]}
            times = {i["prompt"]: i["seconds"] for i in prior["images"] if i["scheme"] == first}
            for name, prompt, seed in prompts:
                if (name, prompt, seed) not in known or name not in times:
                    raise RuntimeError(f"baseline {base} has no {first} image for {name} with this prompt and seed")
                Image.open(base / first / f"{name}.png").save(out / first / f"{name}.png")
                report["images"].append({"scheme": first, "prompt": name, "seed": seed, "seconds": times[name], "reused_from": str(base)})
            spec = SCHEMES[first]
            report["schemes"][first] = {"bytes": {**FIXED_BYTES, **{c: params[c] * bits_per_weight(*spec[c]) / 8 for c in params}},
                                        "reused_from": str(base)}
            report["schemes"][first]["download_bytes"] = sum(report["schemes"][first]["bytes"].values())
            save_report()
        for scheme in schemes:
            if scheme in report["schemes"]:
                continue
            report["phase"] = f"quantize {scheme}"
            t0 = time.time()
            spec = SCHEMES[scheme]
            nbytes, weight_err = dict(FIXED_BYTES), {}
            for comp, lst in mods.items():
                kind, bits, group = spec[comp]
                nbytes[comp] = params[comp] * bits_per_weight(kind, bits, group) / 8
                if applied.get(comp) == spec[comp]:
                    weight_err[comp] = report["schemes"][applied[comp + ":scheme"]]["weight_rel_l2"][comp]
                    continue
                err2 = ref2 = 0.0
                for (name, mod), w in zip(lst, originals[comp]):
                    assert w.shape[1] % group == 0, f"{name}: in_features {w.shape[1]} not divisible by {group}"
                    d = fake_quantize(w, kind, bits, group, args.quant_device)
                    if not torch.isfinite(d).all():
                        raise RuntimeError(f"{scheme}: non-finite fake-quantized weight {name}")
                    err2 += float(((d - w) ** 2).sum()); ref2 += float((w ** 2).sum())
                    with torch.no_grad():
                        mod.weight.copy_(d.to(mod.weight.device))
                weight_err[comp] = math.sqrt(err2 / ref2)
                applied[comp], applied[comp + ":scheme"] = spec[comp], scheme
                # Zeroing a weight is 1.0; far above that means the quantizer, not the format, failed.
                if weight_err[comp] > 1.2:
                    raise RuntimeError(f"{scheme}: {comp} weight relative error {weight_err[comp]:.2f}")
            if args.device == "mps":
                torch.mps.synchronize()
            report["schemes"][scheme] = {"bytes": nbytes, "download_bytes": sum(nbytes.values()),
                                         "weight_rel_l2": weight_err, "quantize_s": time.time() - t0}
            save_report()
            report["phase"] = f"generate {scheme}"
            (out / scheme).mkdir(exist_ok=True)
            for name, prompt, seed in prompts:
                t0 = time.time()
                generator = torch.Generator("cpu").manual_seed(seed)
                image = pipe(prompt=prompt, height=args.size, width=args.size, num_inference_steps=args.steps,
                             guidance_scale=1.0, generator=generator).images[0]
                image.save(out / scheme / f"{name}.png")
                row = {"scheme": scheme, "prompt": name, "seed": seed, "seconds": time.time() - t0}
                # A device that stopped executing returns garbage instantly instead of raising.
                first = [i["seconds"] for i in report["images"] if i["scheme"] == schemes[0]]
                if scheme != schemes[0] and first and row["seconds"] < 0.25 * sorted(first)[len(first) // 2]:
                    raise RuntimeError(f"{scheme}/{name} generated in {row['seconds']:.2f} s against "
                                       f"{sorted(first)[len(first) // 2]:.1f} s for {schemes[0]}: the pipeline did not run")
                if scheme != schemes[0]:
                    row["psnr_vs_first"] = psnr(np.asarray(image), np.asarray(Image.open(out / schemes[0] / f"{name}.png")))
                report["images"].append(row)
                save_report()
        report["phase"] = "sheet"
        contact_sheet(out, schemes, [n for n, _, _ in prompts], report)
        report["phase"] = "done"
    except Exception:
        report["error"] = traceback.format_exc()
        save_report()
        raise
    save_report()


if __name__ == "__main__":
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    main()
