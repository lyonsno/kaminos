#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

from PIL import Image

IDENTITY = "orb-inner-engine-local-generator-smoke-v0"
HF_HUB = Path("/Users/noahlyons/.cache/huggingface/hub")
ROUTES = {
    "z-image-turbo": {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "pipelineClass": "ZImagePipeline",
        "defaultSteps": 9,
        "defaultGuidance": 0.0,
        "defaultDtype": "bfloat16",
        "supportsPlainNegativePrompt": True,
        "supportsImageConditioning": False,
    },
    "flux2-klein": {
        "model": "black-forest-labs/FLUX.2-klein-9B",
        "pipelineClass": "Flux2KleinPipeline",
        "defaultSteps": 4,
        "defaultGuidance": 1.0,
        "defaultDtype": "bfloat16",
        "supportsPlainNegativePrompt": False,
        "supportsImageConditioning": True,
    },
}


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


def default_prompt():
    return (
        "contained radial engine core, black ceramic and gunmetal mechanical socket, nested rings, "
        "segmented shutter ribs, hard occluder blades, bounded amber orange emissive channels, hot small central well, "
        "dark outer machinery rim, opaque machined material, orthographic hard surface concept asset, black background"
    )


PROMPT_PROFILES = {
    "tag-soup": {
        "source": "built-in",
        "prompt": default_prompt(),
    },
    "cinematic-macro": {
        "source": "built-in",
        "prompt": (
            "A dark cinematic macro photograph looking straight into the interior of a sealed industrial plasma reactor. "
            "The foreground aperture rim is almost black and partially blocks the machinery behind it. Deep nested blackened "
            "metal rings recede inward. Radial graphite ribs cross over narrow amber-orange coolant channels. The center "
            "contains a small white-hot ignition well behind a bolted inner plate. Orange light is trapped under metal and "
            "leaks only through thin physical slots. Soot-dark ceramic, machined titanium, worn edges, high-frequency "
            "mechanical detail, heavy inner occlusion, faint volumetric haze inside the chamber."
        ),
    },
    "cutaway-mechanical": {
        "source": "built-in",
        "prompt": (
            "A production-quality hard-surface concept render of a tight cutaway into a contained radial engine interior, "
            "not an exterior shell. The view peers into a dark socket with nested annular plates, overlapping occluder "
            "shutters, radial support ribs, recessed orange emissive conduits, a small hot central combustion well, and "
            "dark outer machinery in shadow. The orange emission is trapped under metal, bounded by physical channels, "
            "and partially hidden by black metal ribs. Industrial reactor internals, precise machining, layered depth, "
            "asymmetric soot-dark details, no clean speaker grille composition."
        ),
    },
    "reference-conditioned": {
        "source": "built-in",
        "prompt": (
            "Reinterpret the reference image as the interior of a dark contained radial engine socket. Preserve the "
            "reference's radial structure only as a layout guide, then replace any clean product-token or lens-like "
            "reading with nested blackened machinery, overlapping occluder shutters, radial graphite ribs, recessed "
            "amber-orange emissive conduits, a small hot central well, and deep rim shadow. Orange light should feel "
            "trapped behind physical metal slots rather than painted on top."
        ),
    },
    "model-card-sanity": {
        "source": "built-in",
        "prompt": (
            "A weathered astronaut stands in a lush alien jungle at dawn, wearing a scratched orange exploration suit. "
            "Towering translucent blue plants glow softly behind them, mist hangs between the leaves, tiny airborne "
            "particles catch warm sunlight, and every surface has crisp cinematic detail."
        ),
    },
}


def default_negative_prompt():
    return (
        "camera lens, optical glass, transparent glass, convex optic, clean lens flare, flat orange disk, "
        "generic fireball, bloom ball, unbounded magic aura, face, text, logo, white plastic, outer shell redesign"
    )


def output_metrics(path):
    image = Image.open(path).convert("RGB")
    pixels = list(image.getdata())
    total = max(1, len(pixels))
    luminance_sum = 0.0
    luminance_sum_sq = 0.0
    color_pixels = 0
    orange_pixels = 0
    dark_pixels = 0
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
        if r > 120 and g > 35 and g < 190 and b < 90:
            orange_pixels += 1
        if max(r, g, b) < 35:
            dark_pixels += 1
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
        "orangePixelRatio": orange_pixels / total,
        "darkPixelRatio": dark_pixels / total,
        "blank": blank,
    }


def effective_prompt_controls(args):
    route = ROUTES[args.route]
    negative_requested = bool(args.negative_prompt)
    if not negative_requested:
        negative_mode = "none"
        negative_passed = False
        negative_reason = "no negative prompt requested"
    elif route["supportsPlainNegativePrompt"]:
        negative_mode = "plain-negative"
        negative_passed = True
        negative_reason = "pipeline exposes negative_prompt"
    else:
        negative_mode = "unsupported"
        negative_passed = False
        negative_reason = "pipeline does not expose plain negative_prompt"

    image_requested = args.conditioning_image is not None
    if not image_requested:
        image_mode = "none"
        image_passed = False
        image_reason = "no conditioning image requested"
    elif route["supportsImageConditioning"]:
        image_mode = "image-arg"
        image_passed = True
        image_reason = "pipeline exposes image conditioning"
    else:
        image_mode = "unsupported"
        image_passed = False
        image_reason = "route does not support image conditioning"

    return {
        "promptProfile": args.prompt_profile,
        "promptProfileSource": args.prompt_profile_source,
        "negativePromptRequested": negative_requested,
        "negativePromptMode": negative_mode,
        "negativePromptPassed": negative_passed,
        "negativePromptReason": negative_reason,
        "imageConditioningRequested": image_requested,
        "imageConditioningMode": image_mode,
        "imageConditioningPassed": image_passed,
        "imageConditioningReason": image_reason,
        "conditioningImagePath": str(args.conditioning_image) if args.conditioning_image else None,
    }


def build_receipt(args, status, ok, started_at, ended_at, output_path=None, error=None):
    route = ROUTES[args.route]
    return {
        "ok": ok,
        "identity": IDENTITY,
        "status": status,
        "route": args.route,
        "model": route["model"],
        "modelPath": str(args._model_path) if args._model_path else None,
        "pipelineClass": route["pipelineClass"],
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": int((time.time() - args._start_time) * 1000),
        "seed": args.seed,
        "numericSeed": numeric_seed(args.seed),
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "guidanceScale": args.guidance_scale,
        "device": args.device,
        "dtype": args.dtype,
        "liveGeneratorInvoked": status not in ("dry-run", "load-only", "failed-before-generation"),
        "promptProfile": args.prompt_profile,
        "promptProfileSource": args.prompt_profile_source,
        "prompt": args.prompt,
        "negativePrompt": args.negative_prompt,
        "conditioningImagePath": str(args.conditioning_image) if args.conditioning_image else None,
        "effectivePromptControls": effective_prompt_controls(args),
        "outputs": {
            "outDir": str(args.out_dir),
            "requestPath": str(args.out_dir / "request.json"),
            "receiptPath": str(args.out_dir / "receipt.json"),
            "outputImagePath": str(output_path) if output_path else None,
        },
        "outputMetrics": getattr(args, "_output_metrics", None),
        "failure": error,
    }


def parse_args():
    parser = argparse.ArgumentParser(description="Smoke local Evil Orb concept generators.")
    parser.add_argument("--route", choices=sorted(ROUTES), required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--seed", default="molten-heartfucker-local-generator-smoke-v0")
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--steps", type=int, default=None)
    parser.add_argument("--guidance-scale", type=float, default=None)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", choices=["float16", "float32", "bfloat16"], default=None)
    parser.add_argument("--prompt-profile", choices=sorted(PROMPT_PROFILES), default="tag-soup")
    parser.add_argument("--prompt", default=None)
    parser.add_argument("--negative-prompt", default=default_negative_prompt())
    parser.add_argument("--conditioning-image", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--load-only", action="store_true")
    parser.add_argument("--validate-output", type=Path, default=None)
    return parser.parse_args()


def resolve_args(args):
    route = ROUTES[args.route]
    args.steps = int(args.steps if args.steps is not None else route["defaultSteps"])
    args.guidance_scale = float(args.guidance_scale if args.guidance_scale is not None else route["defaultGuidance"])
    args.dtype = args.dtype or route["defaultDtype"]
    if args.prompt is None:
        profile = PROMPT_PROFILES[args.prompt_profile]
        args.prompt = profile["prompt"]
        args.prompt_profile_source = profile["source"]
    else:
        args.prompt_profile = "custom"
        args.prompt_profile_source = "cli"
    args._model_path = latest_snapshot(route["model"])
    return args


def load_pipeline(args):
    import torch
    import diffusers

    route = ROUTES[args.route]
    pipeline_class = getattr(diffusers, route["pipelineClass"])
    torch_dtype = {
        "float16": torch.float16,
        "float32": torch.float32,
        "bfloat16": torch.bfloat16,
    }[args.dtype]
    pipe = pipeline_class.from_pretrained(
        str(args._model_path),
        torch_dtype=torch_dtype,
        local_files_only=True,
    )
    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()
    if args.device == "cpu" and hasattr(pipe, "to"):
        pipe = pipe.to("cpu")
    elif args.device != "cpu" and hasattr(pipe, "to"):
        pipe = pipe.to(args.device)
    return pipe, torch


def main():
    args = resolve_args(parse_args())
    args._start_time = time.time()
    started_at = now_iso()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.out_dir / f"{args.route}.png"

    request = {
        "identity": f"{IDENTITY}-request",
        "requestedAt": started_at,
        "route": args.route,
        "model": ROUTES[args.route]["model"],
        "modelPath": str(args._model_path) if args._model_path else None,
        "pipelineClass": ROUTES[args.route]["pipelineClass"],
        "seed": args.seed,
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "guidanceScale": args.guidance_scale,
        "device": args.device,
        "dtype": args.dtype,
        "promptProfile": args.prompt_profile,
        "promptProfileSource": args.prompt_profile_source,
        "prompt": args.prompt,
        "negativePrompt": args.negative_prompt,
        "conditioningImagePath": str(args.conditioning_image) if args.conditioning_image else None,
        "effectivePromptControls": effective_prompt_controls(args),
        "dryRun": args.dry_run,
        "loadOnly": args.load_only,
    }
    write_json(args.out_dir / "request.json", request)

    if args.conditioning_image and not args.conditioning_image.exists():
        receipt = build_receipt(
            args,
            "failed-before-generation",
            False,
            started_at,
            now_iso(),
            None,
            {"phase": "conditioning-image", "reason": f"missing conditioning image: {args.conditioning_image}"},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 2

    controls = effective_prompt_controls(args)
    if args.conditioning_image and not controls["imageConditioningPassed"] and not args.dry_run:
        receipt = build_receipt(
            args,
            "failed-before-generation",
            False,
            started_at,
            now_iso(),
            None,
            {"phase": "conditioning-image", "reason": controls["imageConditioningReason"]},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 2

    if args.validate_output:
        args._output_metrics = output_metrics(args.validate_output)
        if args._output_metrics["blank"]:
            receipt = build_receipt(
                args,
                "failed-output-validation",
                False,
                started_at,
                now_iso(),
                args.validate_output,
                {"phase": "output-validation", "reason": "generated output is blank or near-blank"},
            )
            write_json(args.out_dir / "receipt.json", receipt)
            print(json.dumps(receipt, indent=2))
            return 5

    if args.dry_run:
        receipt = build_receipt(args, "dry-run", True, started_at, now_iso(), None)
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 0

    if args._model_path is None:
        receipt = build_receipt(
            args,
            "failed-before-generation",
            False,
            started_at,
            now_iso(),
            None,
            {"phase": "model-cache", "reason": f"missing local snapshot for {ROUTES[args.route]['model']}"},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 2

    try:
        pipe, torch = load_pipeline(args)
    except Exception as exc:
        receipt = build_receipt(
            args,
            "failed-before-generation",
            False,
            started_at,
            now_iso(),
            None,
            {"phase": "pipeline-load", "reason": repr(exc)},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 3

    if args.load_only:
        receipt = build_receipt(args, "load-only", True, started_at, now_iso(), None)
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 0

    try:
        generator_device = args.device if args.device != "mps" else "cpu"
        generator = torch.Generator(device=generator_device).manual_seed(numeric_seed(args.seed))
        kwargs = {
            "prompt": args.prompt,
            "height": args.height,
            "width": args.width,
            "guidance_scale": args.guidance_scale,
            "num_inference_steps": args.steps,
            "generator": generator,
        }
        controls = effective_prompt_controls(args)
        if controls["negativePromptPassed"]:
            kwargs["negative_prompt"] = args.negative_prompt
        if controls["imageConditioningPassed"]:
            kwargs["image"] = Image.open(args.conditioning_image).convert("RGB")
        result = pipe(**kwargs)
        result.images[0].save(output_path)
        args._output_metrics = output_metrics(output_path)
        if args._output_metrics["blank"]:
            receipt = build_receipt(
                args,
                "failed-output-validation",
                False,
                started_at,
                now_iso(),
                output_path,
                {"phase": "output-validation", "reason": "generated output is blank or near-blank"},
            )
            write_json(args.out_dir / "receipt.json", receipt)
            print(json.dumps(receipt, indent=2))
            return 5
        receipt = build_receipt(args, "complete", True, started_at, now_iso(), output_path)
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
            output_path if output_path.exists() else None,
            {"phase": "generation", "reason": repr(exc)},
        )
        write_json(args.out_dir / "receipt.json", receipt)
        print(json.dumps(receipt, indent=2))
        return 4


if __name__ == "__main__":
    sys.exit(main())
