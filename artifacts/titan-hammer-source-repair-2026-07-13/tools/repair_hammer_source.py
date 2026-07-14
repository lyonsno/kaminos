#!/usr/bin/env python3
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
KAMINOS_ROOT = ROOT.parents[1]
SOURCE = KAMINOS_ROOT / "artifacts/titan-hammer-source-cleanup-2026-07-13/source-cleanup/hammer-square-white.png"
MASK = KAMINOS_ROOT / "artifacts/titan-hammer-source-cleanup-2026-07-13/source-cleanup/hammer-mask-square.png"
OUT_DIR = ROOT / "source-repair"
RECEIPT = ROOT / "source-repair-receipt.json"
CONTACT = ROOT / "titan-hammer-source-repair-contact-sheet.png"


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def material_median(rgb, selector, fallback):
    pixels = rgb[selector]
    if pixels.size == 0:
        return np.array(fallback, dtype=np.float32)
    return np.median(pixels, axis=0).astype(np.float32)


def repair_variant(rgb, mask, strength):
    h, w, _ = rgb.shape
    y_grid = np.repeat(np.arange(h)[:, None], w, axis=1)
    obj = mask > 64
    eroded = np.array(Image.fromarray((obj * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9))) > 128

    rgb_f = rgb.astype(np.float32)
    lum = rgb_f[..., 0] * 0.299 + rgb_f[..., 1] * 0.587 + rgb_f[..., 2] * 0.114
    head_region = obj & (y_grid < 255)
    handle_region = obj & (y_grid >= 255)
    non_dark = obj & (lum > 92)
    head_med = material_median(rgb_f, head_region & non_dark, [128, 136, 134])
    handle_med = material_median(rgb_f, handle_region & non_dark, [156, 130, 92])

    target = np.zeros_like(rgb_f)
    target[head_region] = head_med
    target[handle_region] = handle_med

    dark = obj & (lum < 96)
    severe = obj & (lum < 70)
    interior_dark = dark & eroded
    boundary_dark = dark & ~eroded

    blend = np.zeros((h, w), dtype=np.float32)
    blend[interior_dark] = strength
    blend[severe & eroded] = np.maximum(blend[severe & eroded], min(0.95, strength + 0.12))
    blend[boundary_dark] = strength * 0.36

    out = rgb_f.copy()
    out = out * (1.0 - blend[..., None]) + target * blend[..., None]

    # Reintroduce a little broad material variation so the repaired source does not become a flat icon.
    smooth = np.array(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
    texture_blend = (obj & (lum >= 96)).astype(np.float32) * 0.08
    out = out * (1.0 - texture_blend[..., None]) + smooth * texture_blend[..., None]

    out[~obj] = 255
    return np.clip(out, 0, 255).astype(np.uint8), {
        "head_median_rgb": [round(float(x), 2) for x in head_med],
        "handle_median_rgb": [round(float(x), 2) for x in handle_med],
        "dark_pixels": int(dark.sum()),
        "interior_dark_pixels": int(interior_dark.sum()),
        "boundary_dark_pixels": int(boundary_dark.sum()),
        "strength": strength,
    }


def rebuild_neutral(mask):
    h, w = mask.shape
    obj = mask > 64
    out = np.full((h, w, 3), 255, dtype=np.float32)
    y_grid = np.repeat(np.arange(h)[:, None], w, axis=1)
    x_grid = np.repeat(np.arange(w)[None, :], h, axis=0)

    centers = np.full(h, w / 2.0, dtype=np.float32)
    radii = np.full(h, 1.0, dtype=np.float32)
    for y in range(h):
        xs = np.where(obj[y])[0]
        if xs.size:
            centers[y] = (xs.min() + xs.max()) / 2.0
            radii[y] = max(1.0, (xs.max() - xs.min()) / 2.0)

    rx = np.clip((x_grid - centers[:, None]) / radii[:, None], -1, 1)
    edge = np.clip(np.abs(rx), 0, 1)
    head = obj & (y_grid < 255)
    handle = obj & (y_grid >= 255)

    head_base = np.array([132, 140, 139], dtype=np.float32)
    head_high = np.array([178, 185, 181], dtype=np.float32)
    head_shadow = np.array([84, 91, 91], dtype=np.float32)
    handle_base = np.array([156, 124, 84], dtype=np.float32)
    handle_high = np.array([202, 174, 124], dtype=np.float32)
    handle_shadow = np.array([105, 77, 52], dtype=np.float32)

    head_mix = (1.0 - edge[..., None]) * head_high + edge[..., None] * head_shadow
    handle_mix = (1.0 - edge[..., None]) * handle_high + edge[..., None] * handle_shadow
    out[head] = (0.58 * head_base + 0.42 * head_mix)[head]
    out[handle] = (0.58 * handle_base + 0.42 * handle_mix)[handle]

    # Deterministic faint grain, intentionally bounded away from black.
    grain = (np.sin(x_grid * 0.27 + y_grid * 0.11) + np.sin(x_grid * 0.07 - y_grid * 0.19)) * 5.0
    out[obj] += grain[obj, None]
    out = np.clip(out, 42, 238)
    out[~obj] = 255

    # Keep the silhouette crisp but not jagged.
    img = Image.fromarray(out.astype(np.uint8), mode="RGB").filter(ImageFilter.GaussianBlur(0.25))
    arr = np.array(img).astype(np.float32)
    arr[~obj] = 255
    return np.clip(arr, 0, 255).astype(np.uint8), {
        "head_rgb": [132, 140, 139],
        "handle_rgb": [156, 124, 84],
        "method": "procedural neutral-material repaint from mask silhouette; no source texture retained",
    }


def make_contact(paths):
    labels = [
        ("original", SOURCE),
        ("mask", MASK),
        ("soft repair", paths["soft"]),
        ("strong repair", paths["strong"]),
        ("max repair", paths["max"]),
        ("neutral rebuild", paths["neutral_rebuild"]),
    ]
    thumb_w = 280
    label_h = 26
    sheet = Image.new("RGB", (thumb_w * len(labels), thumb_w + label_h), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (label, path) in enumerate(labels):
        img = Image.open(path).convert("RGB")
        img.thumbnail((thumb_w, thumb_w), Image.Resampling.LANCZOS)
        x = i * thumb_w + (thumb_w - img.width) // 2
        y = label_h + (thumb_w - img.height) // 2
        sheet.paste(img, (x, y))
        draw.text((i * thumb_w + 8, 6), label, fill=(20, 20, 20))
    sheet.save(CONTACT)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rgb = np.array(Image.open(SOURCE).convert("RGB"))
    mask = np.array(Image.open(MASK).convert("L"))

    variants = {
        "soft": ("hammer-square-repaired-soft.png", 0.48),
        "strong": ("hammer-square-repaired-strong.png", 0.72),
        "max": ("hammer-square-repaired-max.png", 0.88),
    }
    outputs = {}
    diagnostics = {}
    for name, (filename, strength) in variants.items():
        repaired, diag = repair_variant(rgb, mask, strength)
        path = OUT_DIR / filename
        Image.fromarray(repaired, mode="RGB").save(path)
        outputs[name] = path
        diagnostics[name] = diag

    rebuilt, rebuilt_diag = rebuild_neutral(mask)
    rebuilt_path = OUT_DIR / "hammer-square-neutral-rebuild.png"
    Image.fromarray(rebuilt, mode="RGB").save(rebuilt_path)
    outputs["neutral_rebuild"] = rebuilt_path
    diagnostics["neutral_rebuild"] = rebuilt_diag

    make_contact(outputs)
    receipt = {
        "schema": "kaminos.titan-hammer-source-repair.v0",
        "created_at": created_at,
        "source": str(SOURCE.relative_to(KAMINOS_ROOT)),
        "mask": str(MASK.relative_to(KAMINOS_ROOT)),
        "method": "deterministic masked dark-artifact attenuation using head/handle material medians; no generative pixels",
        "outputs": {
            name: {
                "path": str(path.relative_to(KAMINOS_ROOT)),
                "sha256": sha256(path),
                "diagnostics": diagnostics[name],
            }
            for name, path in outputs.items()
        },
        "contact_sheet": {
            "path": str(CONTACT.relative_to(KAMINOS_ROOT)),
            "sha256": sha256(CONTACT),
        },
        "truth_boundary": "Source repair only. It preserves the source mask silhouette and attenuates dark interior artifacts; it is not a new mesh, not image generation, and not proof of reconstruction improvement until a backend refire and viewer witness pass.",
    }
    RECEIPT.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
