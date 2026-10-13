"""Fit the linear latent-to-RGB map used for live previews.

Encodes images with the FLUX.2 VAE encoder (latent mean, the space the decoder reads after batch-norm
de-normalization), averages each image down 8x to latent resolution, and solves rgb = z @ W + b by
ridge-regularized least squares over every latent pixel. Every fifth distinct image is held out and
the PSNR of the linear preview against the 8x-downsampled image is reported for both sets.
Writes a JS module exporting the 32 x 3 weights (row-major, channel-major), the bias and provenance.
Usage: python fit-latent-preview.py --model-dir <FLUX.2-klein snapshot> --images <glob> [...] [--max-images 80] --out klein-latent-preview.js
"""
import argparse, glob, hashlib, json, os

import numpy as np
import torch
from PIL import Image
from diffusers import AutoencoderKLFlux2

ap = argparse.ArgumentParser()
ap.add_argument('--model-dir', required=True)
ap.add_argument('--images', nargs='+', required=True, help='glob patterns')
ap.add_argument('--exclude', nargs='*', default=['q1', 'desktop', 'mobile', 'screenshot', 'contact', 'sheet', 'grid', 'strip', '-vs-', 'preview'],
                help='skip paths containing any of these (1-bit flat colour, page screenshots, composites, live previews)')
ap.add_argument('--min-size', type=int, default=256, help='skip images smaller than this on either side')
ap.add_argument('--ridge', type=float, default=1e-3)
ap.add_argument('--max-images', type=int, default=80, help='evenly spaced sample of the distinct images')
ap.add_argument('--kernel', type=int, default=1, choices=[1, 3], help='latent neighbourhood each RGB pixel reads (edges clamp)')
ap.add_argument('--out', required=True)
args = ap.parse_args()

paths, seen = [], set()
for pattern in args.images:
    for p in sorted(glob.glob(pattern, recursive=True)):
        if any(x in p for x in args.exclude): continue
        with Image.open(p) as probe:
            if min(probe.size) < args.min_size: continue
        digest = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        if digest in seen: continue
        seen.add(digest); paths.append(p)
if len(paths) < 10: raise SystemExit(f'only {len(paths)} distinct images')
if len(paths) > args.max_images: paths = [paths[round(i * (len(paths) - 1) / (args.max_images - 1))] for i in range(args.max_images)]

vae = AutoencoderKLFlux2.from_pretrained(os.path.join(args.model_dir, 'vae'), torch_dtype=torch.float32).eval()
Z, Y, split = [], [], []
with torch.no_grad():
    for i, p in enumerate(paths):
        img = Image.open(p).convert('RGB')
        w, h = (img.width // 16) * 16, (img.height // 16) * 16
        x = torch.from_numpy(np.asarray(img.crop((0, 0, w, h)), dtype=np.float32) / 127.5 - 1).permute(2, 0, 1)[None]
        z = vae.encode(x).latent_dist.mean[0]                       # [32, h/8, w/8]
        target = torch.nn.functional.avg_pool2d(x, 8)[0]            # [3, h/8, w/8], -1..1
        if args.kernel == 3:  # features ordered [ky][kx][channel], neighbours clamped at the edges
            zp = torch.nn.functional.pad(z[None], (1, 1, 1, 1), mode='replicate')[0]
            z = torch.cat([zp[:, ky:ky + z.shape[1], kx:kx + z.shape[2]] for ky in range(3) for kx in range(3)])
        Z.append(z.reshape(z.shape[0], -1).T.numpy()); Y.append(target.reshape(3, -1).T.numpy())
        split.append(i % 5 == 4)
        print(f'{i + 1}/{len(paths)} {p}', flush=True)

def stack(hold): return (np.concatenate([z for z, s in zip(Z, split) if s == hold]), np.concatenate([y for y, s in zip(Y, split) if s == hold]))
Ztr, Ytr = stack(False); Zte, Yte = stack(True)
A = np.hstack([Ztr, np.ones((len(Ztr), 1))])
coef = np.linalg.solve(A.T @ A + args.ridge * np.eye(A.shape[1]), A.T @ Ytr)   # [33, 3]
W, b = coef[:-1], coef[-1]

def psnr(Zs, Ys):
    pred = np.clip(Zs @ W + b, -1, 1)
    return float(10 * np.log10(4 / np.mean((pred - Ys) ** 2)))   # range -1..1 => peak-to-peak 2
fit = {'kernel': args.kernel, 'images': len(paths), 'heldOut': int(sum(split)), 'latentPixels': len(Ztr) + len(Zte),
       'psnrTrain': round(psnr(Ztr, Ytr), 2), 'psnrHeldOut': round(psnr(Zte, Yte), 2), 'ridge': args.ridge}
print(json.dumps(fit))
with open(args.out, 'w') as f:
    f.write('// Linear map from FLUX.2 VAE latents (32 channels, de-normalized) to RGB in -1..1, fitted by\n')
    f.write('// fit-latent-preview.py: rgb = z . W + b over a kernel x kernel neighbourhood (edges clamped), with W\n')
    f.write('// row-major [ky][kx][channel][rgb]. Generated; do not edit.\n')
    f.write(f'export const LATENT_PREVIEW_FIT = {json.dumps(fit)};\n')
    f.write(f'export const LATENT_PREVIEW_WEIGHTS = {json.dumps([round(float(v), 6) for v in W.reshape(-1)])};\n')
    f.write(f'export const LATENT_PREVIEW_BIAS = {json.dumps([round(float(v), 6) for v in b])};\n')
