#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

IDENTITY = "orb-inner-engine-sdxl-adapter-smoke-v0"
DEFAULT_BASE = "stabilityai/stable-diffusion-xl-base-1.0"
DEFAULT_ADAPTERS = {
    "canny": "TencentARC/t2i-adapter-canny-sdxl-1.0",
    "lineart": "TencentARC/t2i-adapter-lineart-sdxl-1.0",
}
HF_HUB = Path("/Users/noahlyons/.cache/huggingface/hub")


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def repo_cache_root(repo_id):
    return HF_HUB / f"models--{repo_id.replace('/', '--')}"


def latest_snapshot(repo_id):
    root = repo_cache_root(repo_id) / "snapshots"
    if not root.exists():
        return None
    snapshots = [path for path in root.iterdir() if path.is_dir()]
    if not snapshots:
        return None
    return max(snapshots, key=lambda path: path.stat().st_mtime)


def numeric_seed(seed):
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") & 0x7FFFFFFF


def guide_metrics(image):
    rgba = image.convert("RGBA")
    pixels = list(rgba.getdata())
    total = max(1, len(pixels))
    non_background = 0
    hot_center = 0
    dark_rim = 0
    for r, g, b, _ in pixels:
        if max(r, g, b) > 18:
            non_background += 1
        if r > 180 and 55 <= g <= 150 and b < 70:
            hot_center += 1
        if max(r, g, b) < 45:
            dark_rim += 1
    return {
        "nonBackgroundRatio": non_background / total,
        "hotCenterRatio": hot_center / total,
        "darkRimRatio": dark_rim / total,
    }


def output_metrics(path):
    image = Image.open(path).convert("RGB")
    pixels = list(image.getdata())
    total = max(1, len(pixels))
    luminance_sum = 0.0
    luminance_sum_sq = 0.0
    color_pixels = 0
    extrema = [[255, 0], [255, 0], [255, 0]]
    for r, g, b in pixels:
        for channel, value in enumerate((r, g, b)):
            extrema[channel][0] = min(extrema[channel][0], value)
            extrema[channel][1] = max(extrema[channel][1], value)
        lum = (r + g + b) / 3.0
        luminance_sum += lum
        luminance_sum_sq += lum * lum
        if max(r, g, b) - min(r, g, b) > 18:
            color_pixels += 1
    mean = luminance_sum / total
    variance = max(0.0, luminance_sum_sq / total - mean * mean)
    stddev = math.sqrt(variance)
    channel_ranges = [high - low for low, high in extrema]
    blank = stddev < 1.5 and max(channel_ranges) < 4
    return {
        "width": image.width,
        "height": image.height,
        "extrema": extrema,
        "meanLuminance": mean,
        "luminanceStddev": stddev,
        "colorPixelRatio": color_pixels / total,
        "blank": blank,
    }


def draw_radial_guide(width, height, adapter):
    rng = random.Random(0xE11C0DE)
    image = Image.new("RGB", (width, height), (2, 3, 4))
    draw = ImageDraw.Draw(image)
    cx = width / 2
    cy = height / 2
    radius = min(width, height) * 0.47

    # Dark contained socket mass and outer occlusion.
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=(24, 28, 30),
        width=max(2, width // 48),
    )
    draw.ellipse(
        [cx - radius * 0.92, cy - radius * 0.92, cx + radius * 0.92, cy + radius * 0.92],
        fill=(8, 9, 10),
        outline=(58, 50, 42),
        width=max(1, width // 96),
    )

    # Nested hard rings.
    for scale, color, w in [
        (0.78, (210, 112, 26), 4),
        (0.62, (232, 146, 34), 3),
        (0.47, (128, 78, 38), 3),
        (0.31, (245, 180, 62), 2),
    ]:
        rr = radius * scale
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color, width=max(1, int(w * width / 512)))

    # Radial ribs and broken shutter wedges.
    rib_count = 18
    for i in range(rib_count):
        a = (i / rib_count) * math.tau
        jitter = (rng.random() - 0.5) * 0.025
        inner = radius * (0.23 + 0.05 * (i % 3))
        outer = radius * (0.82 - 0.04 * (i % 4 == 0))
        x0 = cx + math.cos(a + jitter) * inner
        y0 = cy + math.sin(a + jitter) * inner
        x1 = cx + math.cos(a + jitter) * outer
        y1 = cy + math.sin(a + jitter) * outer
        color = (236, 128, 24) if i % 3 else (78, 54, 40)
        draw.line([x0, y0, x1, y1], fill=color, width=max(1, width // 96))

        if i % 2 == 0:
            a2 = a + math.tau / rib_count * 0.58
            p0 = (cx + math.cos(a) * radius * 0.70, cy + math.sin(a) * radius * 0.70)
            p1 = (cx + math.cos(a2) * radius * 0.86, cy + math.sin(a2) * radius * 0.86)
            p2 = (cx + math.cos(a2) * radius * 0.56, cy + math.sin(a2) * radius * 0.56)
            draw.polygon([p0, p1, p2], fill=(14, 15, 16), outline=(68, 49, 35))

    # Bounded emissive channels, deliberately not full-disk glow.
    for i in range(9):
        a = (i / 9) * math.tau + 0.08
        length = radius * 0.20
        mid = radius * 0.52
        x0 = cx + math.cos(a) * (mid - length * 0.5)
        y0 = cy + math.sin(a) * (mid - length * 0.5)
        x1 = cx + math.cos(a) * (mid + length * 0.5)
        y1 = cy + math.sin(a) * (mid + length * 0.5)
        draw.line([x0, y0, x1, y1], fill=(255, 122, 20), width=max(2, width // 64))

    # Hot center with a dark mechanical collar.
    collar = radius * 0.20
    core = radius * 0.105
    draw.ellipse([cx - collar, cy - collar, cx + collar, cy + collar], fill=(18, 15, 12), outline=(246, 124, 24), width=max(1, width // 96))
    draw.ellipse([cx - core, cy - core, cx + core, cy + core], fill=(255, 116, 22), outline=(255, 206, 88), width=max(1, width // 128))

    if adapter == "lineart":
        # Lineart adapter likes cleaner contrast; preserve the orange center as a route identity marker.
        line = Image.new("RGB", (width, height), (0, 0, 0))
        line_draw = ImageDraw.Draw(line)
        for x in range(width):
            for y in range(height):
                r, g, b = image.getpixel((x, y))
                if max(r, g, b) > 45 and not (r > 180 and g > 55 and b < 80):
                    line.putpixel((x, y), (235, 235, 235))
                elif r > 180 and g > 55 and b < 80:
                    line.putpixel((x, y), (255, 116, 22))
        line_draw.ellipse([cx - core, cy - core, cx + core, cy + core], fill=(255, 116, 22))
        image = line

    return image


def make_prompt():
    return (
        "contained radial engine visible through a socket aperture, hard surface black ceramic and gunmetal machinery, "
        "nested rings, radial ribs, segmented shutter occluders, bounded amber orange emissive channels, hot central well, "
        "dark occluded outer rim, orthographic concept asset, high detail, no outer shell redesign"
    )


def make_negative_prompt():
    return (
        "camera lens, optical glass, clean lens flare, flat orange disk, generic fireball, soft bloom ball, "
        "unbounded magic aura, new outer shell, face, text, logo, smoke plume"
    )


def build_receipt(args, status, ok, started_at, ended_at, guide_path, output_path, error=None):
    adapter_repo = args.adapter_model or DEFAULT_ADAPTERS[args.adapter]
    return {
        "ok": ok,
        "identity": IDENTITY,
        "status": status,
        "routeId": f"local-image.sdxl-t2i-adapter.{args.adapter}",
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": int((time.time() - args._start_time) * 1000),
        "seed": args.seed,
        "numericSeed": numeric_seed(args.seed),
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "guidanceScale": args.guidance_scale,
        "adapterConditioningScale": args.adapter_conditioning_scale,
        "device": args.device,
        "dtype": args.dtype,
        "liveGeneratorInvoked": status not in ("dry-run", "failed-before-generation"),
        "prompt": args.prompt,
        "negativePrompt": args.negative_prompt,
        "models": {
            "base": args.base_model,
            "adapter": adapter_repo,
        },
        "modelPaths": {
            "base": str(args._base_path) if args._base_path else None,
            "adapter": str(args._adapter_path) if args._adapter_path else None,
        },
        "outputs": {
            "outDir": str(args.out_dir),
            "requestPath": str(args.out_dir / "request.json"),
            "receiptPath": str(args.out_dir / "receipt.json"),
            "guidePath": str(guide_path),
            "outputImagePath": str(output_path) if output_path else None,
        },
        "guideMetrics": args._guide_metrics,
        "outputMetrics": getattr(args, "_output_metrics", None),
        "failure": error,
    }


def parse_args():
    parser = argparse.ArgumentParser(description="Run a local SDXL T2I-Adapter smoke for the Evil Orb inner engine.")
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--seed", default="molten-heartfucker-sdxl-smoke-v0")
    parser.add_argument("--adapter", choices=["canny", "lineart"], default="canny")
    parser.add_argument("--base-model", default=DEFAULT_BASE)
    parser.add_argument("--adapter-model", default=None)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--guidance-scale", type=float, default=5.0)
    parser.add_argument("--adapter-conditioning-scale", type=float, default=0.85)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", choices=["float16", "float32", "bfloat16"], default="float16")
    parser.add_argument("--prompt", default=make_prompt())
    parser.add_argument("--negative-prompt", default=make_negative_prompt())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--validate-output", default=None, type=Path)
    return parser.parse_args()


def main():
    args = parse_args()
    args._start_time = time.time()
    started_at = now_iso()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    guide_path = args.out_dir / f"radial-guide-{args.adapter}.png"
    output_path = args.out_dir / f"sdxl-t2i-adapter-{args.adapter}.png"

    guide = draw_radial_guide(args.width, args.height, args.adapter)
    guide.save(guide_path)
    args._guide_metrics = guide_metrics(guide)
    adapter_repo = args.adapter_model or DEFAULT_ADAPTERS[args.adapter]
    args._base_path = latest_snapshot(args.base_model)
    args._adapter_path = latest_snapshot(adapter_repo)

    request = {
        "identity": f"{IDENTITY}-request",
        "requestedAt": started_at,
        "routeId": f"local-image.sdxl-t2i-adapter.{args.adapter}",
        "seed": args.seed,
        "models": {
            "base": args.base_model,
            "adapter": adapter_repo,
        },
        "modelPaths": {
            "base": str(args._base_path) if args._base_path else None,
            "adapter": str(args._adapter_path) if args._adapter_path else None,
        },
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "prompt": args.prompt,
        "negativePrompt": args.negative_prompt,
        "guidePath": str(guide_path),
        "dryRun": bool(args.dry_run),
    }
    write_json(args.out_dir / "request.json", request)

    if args.validate_output:
        args._output_metrics = output_metrics(args.validate_output)
        if args._output_metrics["blank"]:
            receipt = build_receipt(
                args,
                "failed-output-validation",
                False,
                started_at,
                now_iso(),
                guide_path,
                args.validate_output,
                {"phase": "output-validation", "reason": "generated output is blank or near-blank"},
            )
            write_json(args.out_dir / "receipt.json", receipt)
            print(json.dumps(receipt, indent=2))
            return 5

    if args.dry_run:
        receipt = build_receipt(args, "dry-run", True, started_at, now_iso(), guide_path, None)
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 0

    if args._base_path is None or args._adapter_path is None:
        missing = []
        if args._base_path is None:
            missing.append(args.base_model)
        if args._adapter_path is None:
            missing.append(adapter_repo)
        receipt = build_receipt(
            args,
            "failed-before-generation",
            False,
            started_at,
            now_iso(),
            guide_path,
            None,
            {"phase": "model-cache", "reason": f"missing local snapshot(s): {', '.join(missing)}"},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 2

    try:
        import torch
        from diffusers import StableDiffusionXLAdapterPipeline, T2IAdapter
    except Exception as exc:
        receipt = build_receipt(
            args,
            "failed-before-generation",
            False,
            started_at,
            now_iso(),
            guide_path,
            None,
            {"phase": "import", "reason": repr(exc)},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 3

    torch_dtype = {
        "float16": torch.float16,
        "float32": torch.float32,
        "bfloat16": torch.bfloat16,
    }[args.dtype]
    weight_variant = "fp16" if args.dtype in ("float16", "float32") else None

    try:
        adapter = T2IAdapter.from_pretrained(
            str(args._adapter_path),
            torch_dtype=torch_dtype,
            variant=weight_variant,
            local_files_only=True,
        )
        pipe = StableDiffusionXLAdapterPipeline.from_pretrained(
            str(args._base_path),
            adapter=adapter,
            torch_dtype=torch_dtype,
            variant=weight_variant,
            use_safetensors=True,
            local_files_only=True,
        )
        if hasattr(pipe, "enable_attention_slicing"):
            pipe.enable_attention_slicing()
        if args.device != "cpu":
            pipe = pipe.to(args.device)
        if args.device == "mps" and args.dtype == "float16":
            # Diffusers SDXL VAE decode can produce NaNs on MPS fp16; keep the
            # denoiser fp16 but upcast decode so a black frame cannot masquerade
            # as a valid smoke artifact.
            pipe.vae.to(dtype=torch.float32)
        generator_device = args.device if args.device != "mps" else "cpu"
        generator = torch.Generator(device=generator_device).manual_seed(numeric_seed(args.seed))
        result = pipe(
            prompt=args.prompt,
            negative_prompt=args.negative_prompt,
            image=guide,
            num_inference_steps=args.steps,
            guidance_scale=args.guidance_scale,
            adapter_conditioning_scale=args.adapter_conditioning_scale,
            generator=generator,
            width=args.width,
            height=args.height,
        )
        result.images[0].save(output_path)
        args._output_metrics = output_metrics(output_path)
        if args._output_metrics["blank"]:
            receipt = build_receipt(
                args,
                "failed-output-validation",
                False,
                started_at,
                now_iso(),
                guide_path,
                output_path,
                {"phase": "output-validation", "reason": "generated output is blank or near-blank"},
            )
            write_json(args.out_dir / "receipt.json", receipt)
            print(json.dumps(receipt, indent=2))
            return 5
        receipt = build_receipt(args, "complete", True, started_at, now_iso(), guide_path, output_path)
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 0
    except Exception as exc:
        receipt = build_receipt(
            args,
            "failed",
            False,
            started_at,
            now_iso(),
            guide_path,
            output_path if output_path.exists() else None,
            {"phase": "generation", "reason": repr(exc)},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 4


if __name__ == "__main__":
    sys.exit(main())
