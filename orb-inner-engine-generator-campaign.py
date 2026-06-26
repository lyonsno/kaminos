#!/usr/bin/env python3
import argparse
import fcntl
import json
import math
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

IDENTITY = "orb-inner-engine-generator-campaign-v0"
GPU_LOCK_POLICY = "per-live-candidate-flock"
ROOT = Path(__file__).resolve().parent
SMOKE_SCRIPT = ROOT / "orb-inner-engine-local-generator-smoke.py"
PYTHON = Path("/Users/noahlyons/dev/SuperMat/.venv/bin/python")
OUTPUT_ROOT = Path("/Users/noahlyons/.local/state/gpu-greenroom/outputs")
DEFAULT_GPU_LOCK = OUTPUT_ROOT.parent / "gpu.lock"

KNOWN_SOURCE_IMAGES = {
    "guide": OUTPUT_ROOT / "kaminos-evil-orb-inner-engine-guide-substrate-witness-20260626T201000Z/orb-inner-engine-guide-substrate.png",
    "z-cutaway": OUTPUT_ROOT / "kaminos-evil-orb-inner-engine-z-image-cutaway-20260626T212714Z/z-image-turbo.png",
    "z-off-axis": OUTPUT_ROOT / "kaminos-evil-orb-inner-engine-z-image-off-axis-interior-20260626T214442Z/z-image-turbo.png",
    "z-channel": OUTPUT_ROOT / "kaminos-evil-orb-inner-engine-z-image-occluded-channel-20260626T214246Z/z-image-turbo.png",
}


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def safe_id(value):
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in value).strip("-")


def placeholder_image(path, label, size=(1024, 1024)):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", size, (18, 18, 18))
    draw = ImageDraw.Draw(image)
    draw.rectangle((48, 48, size[0] - 48, size[1] - 48), outline=(230, 136, 32), width=8)
    draw.text((80, 88), label[:120], fill=(230, 136, 32))
    image.save(path)
    return path


def crop_source(source_path, target_path, box_name):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if not source_path or not source_path.exists():
        return placeholder_image(target_path, f"missing reference: {box_name}")
    image = Image.open(source_path).convert("RGB")
    w, h = image.size
    boxes = {
        "left-rim": (0, 0, int(w * 0.58), h),
        "right-channel": (int(w * 0.42), 0, w, h),
        "upper-arc": (0, 0, w, int(h * 0.58)),
        "lower-arc": (0, int(h * 0.42), w, h),
        "center-well": (int(w * 0.22), int(h * 0.22), int(w * 0.78), int(h * 0.78)),
        "diagonal-material": (int(w * 0.08), int(h * 0.08), int(w * 0.92), int(h * 0.92)),
    }
    crop = image.crop(boxes.get(box_name, (0, 0, w, h)))
    crop = crop.resize((1024, 1024), Image.Resampling.LANCZOS)
    crop.save(target_path)
    return target_path


def make_references(out_dir):
    refs = out_dir / "references"
    return {
        "guide": crop_source(KNOWN_SOURCE_IMAGES["guide"], refs / "guide-substrate.png", "center-well"),
        "cutaway-left-rim": crop_source(KNOWN_SOURCE_IMAGES["z-cutaway"], refs / "cutaway-left-rim.png", "left-rim"),
        "cutaway-center": crop_source(KNOWN_SOURCE_IMAGES["z-cutaway"], refs / "cutaway-center.png", "center-well"),
        "off-axis-right-channel": crop_source(KNOWN_SOURCE_IMAGES["z-off-axis"], refs / "off-axis-right-channel.png", "right-channel"),
        "channel-material": crop_source(KNOWN_SOURCE_IMAGES["z-channel"], refs / "channel-material.png", "diagonal-material"),
    }


PROMPTS = {
    "aperture-slit": (
        "View through a narrow irregular shell aperture into a dark contained radial engine interior. The opening covers "
        "only part of the frame; black shell lips occlude the view from left and right. Behind the aperture are staggered "
        "graphite ribs, broken annular machinery fragments, small fasteners, soot-dark ceramic, and thin amber-orange "
        "emission strips mostly hidden behind metal. Partial asymmetric interior, not a full circular object."
    ),
    "quadrant-crop": (
        "Only one cropped quadrant of a contained radial engine interior is visible. The full circle is outside the frame. "
        "Layered black ceramic plates, offset radial ribs, overlapping baffles, dark rim wall, small machined details, and "
        "narrow orange heat channels recede into shadow. Industrial macro cutaway, asymmetric, partial, shell-occluded."
    ),
    "inside-bore": (
        "Macro camera inside a dark mechanical bore looking along the inner wall of a radial engine socket. Curved black "
        "foreground rim fills the edges. Broken annular rails and staggered ribs recede diagonally, with orange heat leaks "
        "appearing as thin hidden strips under metal lips. No front-facing complete circle, no spherical exterior."
    ),
    "three-openings": (
        "Contained inner engine glimpsed through three separated shell openings. Each opening reveals a different depth "
        "layer: black radial ribs, nested occluder plates, tiny bolts, dark ceramic, and amber-orange channels behind metal. "
        "Most of the machinery is blocked by opaque shell matter. Fragmented view, not a centered product render."
    ),
    "hot-well": (
        "Small hot central ignition well seen behind bolted black occluder plates. The hot orange-white core is mostly "
        "blocked by dark circular hardware, graphite ribs, and nested shadowed rings. Bounded emission, heavy rim occlusion, "
        "worn metal, soot, precise tiny fasteners, no flat glowing disk."
    ),
    "dark-rim": (
        "Material plate for the dark inner rim of a contained engine socket: matte black ceramic wall, heat staining, "
        "scratched gunmetal lips, embedded fasteners, shadowed cavities, and faint orange light spill from hidden channels. "
        "Close cropped texture reference, no whole object."
    ),
    "rib-edge": (
        "Close material study of soot-dark graphite radial rib edges crossing over recessed amber-orange slots. Chipped "
        "black ceramic, worn gunmetal bevels, small screws, occluded glow under overlapping shutter plates, dense hard "
        "surface details for shader reference, no complete engine."
    ),
    "orange-spill": (
        "Trapped amber-orange engine light spilling onto nearby black metal inside a sealed socket. The light is indirect "
        "and partially blocked by baffles, lips, and ribs. Heat-stained ceramic, dark occlusion, subtle smoke haze, narrow "
        "bounded channels, close cropped material reference."
    ),
    "reference-reinterpret": (
        "Reinterpret the reference as a dark contained Evil Orb inner engine detail. Preserve only its useful layout rhythm, "
        "then make it more cropped, more occluded, less product-like, and more layered: black ceramic ribs, nested baffles, "
        "tiny bolts, amber-orange strips behind metal lips, deep rim shadow, no clean lens or speaker grille."
    ),
}


def build_candidates(references):
    return [
        {
            "id": "z-comp-cropped-aperture-a",
            "series": "composition-break",
            "route": "z-image-turbo",
            "promptProfile": "cropped-aperture-interior",
            "seed": "molten-campaign-z-comp-cropped-aperture-a",
        },
        {
            "id": "z-comp-aperture-slit-a",
            "series": "composition-break",
            "route": "z-image-turbo",
            "prompt": PROMPTS["aperture-slit"],
            "seed": "molten-campaign-z-comp-aperture-slit-a",
        },
        {
            "id": "z-comp-quadrant-crop-a",
            "series": "composition-break",
            "route": "z-image-turbo",
            "prompt": PROMPTS["quadrant-crop"],
            "seed": "molten-campaign-z-comp-quadrant-crop-a",
        },
        {
            "id": "z-comp-inside-bore-a",
            "series": "composition-break",
            "route": "z-image-turbo",
            "prompt": PROMPTS["inside-bore"],
            "seed": "molten-campaign-z-comp-inside-bore-a",
        },
        {
            "id": "z-comp-three-openings-a",
            "series": "composition-break",
            "route": "z-image-turbo",
            "prompt": PROMPTS["three-openings"],
            "seed": "molten-campaign-z-comp-three-openings-a",
        },
        {
            "id": "z-comp-hot-well-a",
            "series": "composition-break",
            "route": "z-image-turbo",
            "prompt": PROMPTS["hot-well"],
            "seed": "molten-campaign-z-comp-hot-well-a",
        },
        {
            "id": "z-vocab-occluded-channel-a",
            "series": "vocabulary-harvest",
            "route": "z-image-turbo",
            "promptProfile": "occluded-channel-material",
            "seed": "molten-campaign-z-vocab-occluded-channel-a",
        },
        {
            "id": "z-vocab-dark-rim-a",
            "series": "vocabulary-harvest",
            "route": "z-image-turbo",
            "prompt": PROMPTS["dark-rim"],
            "seed": "molten-campaign-z-vocab-dark-rim-a",
        },
        {
            "id": "z-vocab-rib-edge-a",
            "series": "vocabulary-harvest",
            "route": "z-image-turbo",
            "prompt": PROMPTS["rib-edge"],
            "seed": "molten-campaign-z-vocab-rib-edge-a",
        },
        {
            "id": "z-vocab-orange-spill-a",
            "series": "vocabulary-harvest",
            "route": "z-image-turbo",
            "prompt": PROMPTS["orange-spill"],
            "seed": "molten-campaign-z-vocab-orange-spill-a",
        },
        {
            "id": "flux-ref-guide-a",
            "series": "reference-conditioning",
            "route": "flux2-klein",
            "prompt": PROMPTS["reference-reinterpret"],
            "conditioningImagePath": str(references["guide"]),
            "seed": "molten-campaign-flux-ref-guide-a",
        },
        {
            "id": "flux-ref-cutaway-left-rim-a",
            "series": "reference-conditioning",
            "route": "flux2-klein",
            "prompt": PROMPTS["reference-reinterpret"],
            "conditioningImagePath": str(references["cutaway-left-rim"]),
            "seed": "molten-campaign-flux-ref-cutaway-left-rim-a",
        },
        {
            "id": "flux-ref-off-axis-channel-a",
            "series": "reference-conditioning",
            "route": "flux2-klein",
            "prompt": PROMPTS["reference-reinterpret"],
            "conditioningImagePath": str(references["off-axis-right-channel"]),
            "seed": "molten-campaign-flux-ref-off-axis-channel-a",
        },
        {
            "id": "flux-ref-channel-material-a",
            "series": "reference-conditioning",
            "route": "flux2-klein",
            "prompt": PROMPTS["reference-reinterpret"],
            "conditioningImagePath": str(references["channel-material"]),
            "seed": "molten-campaign-flux-ref-channel-material-a",
        },
    ]


def candidate_command(candidate, out_dir, args):
    cmd = [
        str(PYTHON),
        str(SMOKE_SCRIPT),
        "--route",
        candidate["route"],
        "--out-dir",
        str(out_dir),
        "--seed",
        candidate["seed"],
        "--width",
        str(args.width),
        "--height",
        str(args.height),
    ]
    if candidate.get("promptProfile"):
        cmd.extend(["--prompt-profile", candidate["promptProfile"]])
    if candidate.get("prompt"):
        cmd.extend(["--prompt", candidate["prompt"]])
    if candidate.get("conditioningImagePath"):
        cmd.extend(["--conditioning-image", candidate["conditioningImagePath"]])
    if args.dry_run:
        cmd.append("--dry-run")
    return cmd


def gpu_lock_manifest(args):
    return {
        "path": str(args.gpu_lock),
        "policy": GPU_LOCK_POLICY,
        "dryRunAcquisition": False,
    }


def dry_run_gpu_lock(args):
    return {
        **gpu_lock_manifest(args),
        "acquired": False,
        "skippedReason": "dry-run",
        "waitStartedAt": None,
        "acquiredAt": None,
        "releasedAt": None,
    }


def run_candidate_process(command, args):
    if args.dry_run:
        return subprocess.run(
            command,
            cwd=str(ROOT),
            text=True,
            capture_output=True,
        ), dry_run_gpu_lock(args)

    lock_info = {
        **gpu_lock_manifest(args),
        "acquired": False,
        "skippedReason": None,
        "waitStartedAt": now_iso(),
        "acquiredAt": None,
        "releasedAt": None,
    }
    args.gpu_lock.parent.mkdir(parents=True, exist_ok=True)
    with args.gpu_lock.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        lock_info["acquired"] = True
        lock_info["acquiredAt"] = now_iso()
        try:
            proc = subprocess.run(
                command,
                cwd=str(ROOT),
                text=True,
                capture_output=True,
            )
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_info["releasedAt"] = now_iso()
    return proc, lock_info


def run_candidate(candidate, args):
    candidate_dir = args.out_dir / "runs" / candidate["id"]
    started_at = now_iso()
    proc, gpu_lock = run_candidate_process(candidate_command(candidate, candidate_dir, args), args)
    ended_at = now_iso()
    stdout_path = candidate_dir / "stdout.log"
    stderr_path = candidate_dir / "stderr.log"
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stdout_path.write_text(proc.stdout, encoding="utf-8")
    stderr_path.write_text(proc.stderr, encoding="utf-8")
    receipt_path = candidate_dir / "receipt.json"
    route_receipt = None
    if receipt_path.exists():
        route_receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    else:
        try:
            route_receipt = json.loads(proc.stdout)
        except json.JSONDecodeError:
            route_receipt = {
                "ok": False,
                "status": "missing-route-receipt",
                "failure": {"phase": "route-receipt", "reason": "route did not write parseable receipt"},
            }
    output_path = route_receipt.get("outputs", {}).get("outputImagePath") if isinstance(route_receipt, dict) else None
    review_path = None
    if output_path and Path(output_path).exists():
        review_path = args.review_dir / f"{candidate['id']}.png"
        review_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output_path, review_path)
    return {
        "id": candidate["id"],
        "series": candidate["series"],
        "route": candidate["route"],
        "seed": candidate["seed"],
        "promptProfile": candidate.get("promptProfile", "custom" if candidate.get("prompt") else None),
        "conditioningImagePath": candidate.get("conditioningImagePath"),
        "status": route_receipt.get("status", "unknown"),
        "ok": proc.returncode == 0 and bool(route_receipt.get("ok")),
        "exitCode": proc.returncode,
        "startedAt": started_at,
        "endedAt": ended_at,
        "gpuLock": gpu_lock,
        "stdoutPath": str(stdout_path),
        "stderrPath": str(stderr_path),
        "routeReceiptPath": str(receipt_path),
        "routeReceipt": route_receipt,
        "reviewImagePath": str(review_path) if review_path else None,
        "agentReview": {
            "status": "pending-agent-inspection",
            "visualOutputsInspected": False,
            "verdict": None,
        },
    }


def draw_wrapped(draw, position, text, fill, width_chars=32):
    x, y = position
    for line in textwrap.wrap(text, width_chars)[:4]:
        draw.text((x, y), line, fill=fill)
        y += 16
    return y


def make_contact_sheet(results, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tile_w, tile_h = 280, 340
    cols = 4
    rows = max(1, math.ceil(len(results) / cols))
    sheet = Image.new("RGB", (cols * tile_w, rows * tile_h), (16, 16, 16))
    draw = ImageDraw.Draw(sheet)
    for index, result in enumerate(results):
        x = (index % cols) * tile_w
        y = (index // cols) * tile_h
        image_path = result.get("reviewImagePath")
        if image_path and Path(image_path).exists():
            thumb = Image.open(image_path).convert("RGB")
        else:
            thumb = Image.new("RGB", (1024, 1024), (42, 36, 28))
            ImageDraw.Draw(thumb).text((80, 80), result["status"], fill=(230, 136, 32))
        thumb.thumbnail((tile_w - 16, tile_w - 16), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x + 8, y + 8))
        text_y = y + tile_w
        draw_wrapped(draw, (x + 8, text_y), f"{index + 1:02d} {result['id']}", (235, 235, 235), 31)
        draw.text((x + 8, y + tile_h - 42), result["series"], fill=(230, 136, 32))
        draw.text((x + 8, y + tile_h - 24), f"{result['route']} / {result['status']}", fill=(180, 180, 180))
    sheet.save(path)


def parse_args():
    parser = argparse.ArgumentParser(description="Run Evil Orb local generator campaigns with receipts.")
    parser.add_argument("--campaign", default="molten-campaign-v0")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--candidate", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--gpu-lock", type=Path, default=DEFAULT_GPU_LOCK)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    return parser.parse_args()


def main():
    args = parse_args()
    started_at = now_iso()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.review_dir = args.out_dir / "review"
    args.review_dir.mkdir(parents=True, exist_ok=True)
    references = make_references(args.out_dir)
    candidates = build_candidates(references)
    if args.candidate:
        selected = set(args.candidate)
        candidates = [candidate for candidate in candidates if candidate["id"] in selected]
        missing = sorted(selected - {candidate["id"] for candidate in candidates})
        if missing:
            receipt = {
                "ok": False,
                "identity": IDENTITY,
                "status": "failed-before-campaign",
                "campaign": args.campaign,
                "failure": {"phase": "candidate-selection", "reason": f"unknown candidates: {', '.join(missing)}"},
            }
            write_json(args.out_dir / "receipt.json", receipt)
            print(json.dumps(receipt, indent=2))
            return 2

    manifest = {
        "identity": f"{IDENTITY}-manifest",
        "campaign": args.campaign,
        "createdAt": started_at,
        "dryRun": args.dry_run,
        "width": args.width,
        "height": args.height,
        "gpuLock": gpu_lock_manifest(args),
        "references": {key: str(path) for key, path in references.items()},
        "candidates": candidates,
    }
    write_json(args.out_dir / "manifest.json", manifest)

    results = []
    for candidate in candidates:
        results.append(run_candidate(candidate, args))
        write_json(args.out_dir / "receipt.json", build_receipt(args, started_at, results, status="running"))

    contact_sheet_path = args.out_dir / "contact-sheet.png"
    make_contact_sheet(results, contact_sheet_path)
    receipt = build_receipt(args, started_at, results, status="dry-run" if args.dry_run else "complete")
    write_json(args.out_dir / "receipt.json", receipt)
    print(json.dumps(receipt, indent=2))
    return 0 if receipt["ok"] else 1


def build_receipt(args, started_at, results, status):
    ok = all(result["ok"] for result in results)
    return {
        "ok": ok,
        "identity": IDENTITY,
        "status": status,
        "campaign": args.campaign,
        "startedAt": started_at,
        "endedAt": now_iso(),
        "dryRun": args.dry_run,
        "liveGeneratorInvoked": not args.dry_run,
        "gpuLock": {
            **gpu_lock_manifest(args),
            "acquiredCount": sum(1 for result in results if result.get("gpuLock", {}).get("acquired")),
        },
        "candidateCount": len(results),
        "completedCount": sum(1 for result in results if result.get("ok")),
        "outputs": {
            "outDir": str(args.out_dir),
            "manifestPath": str(args.out_dir / "manifest.json"),
            "receiptPath": str(args.out_dir / "receipt.json"),
            "contactSheetPath": str(args.out_dir / "contact-sheet.png"),
            "reviewDir": str(args.review_dir),
        },
        "agentReview": {
            "status": "pending-agent-inspection",
            "visualOutputsInspected": False,
            "summary": None,
        },
        "visualSummary": {
            "status": "pending-agent-inspection",
            "rankedCandidates": [],
            "failureModes": [],
        },
        "candidates": results,
    }


if __name__ == "__main__":
    sys.exit(main())
