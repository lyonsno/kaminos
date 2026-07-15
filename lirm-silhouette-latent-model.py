#!/usr/bin/env python3

import argparse
import hashlib
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np


SCHEMA = "kaminos.lirm-silhouette-latent-model.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-latent-model-v0"
PROBE_ROUTE = "identity-free-sdf-dataset-probe-v0"
MLX_ROUTE = "mlx-convolutional-sdf-vae-v0"


def parse_args():
    parser = argparse.ArgumentParser(description="Train an identity-free latent model over silhouette signed-distance fields.")
    parser.add_argument("--corpus-dir", action="append", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--validation-fraction", type=float, default=0.1)
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--latent-dim", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--beta", type=float, default=0.001)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--copy-threshold", type=float, default=0.94)
    parser.add_argument("--columns", type=int, default=8)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def write_json(path: Path, value) -> None:
    path.write_text(f"{json.dumps(value, indent=2)}\n")


def write_jsonl(path: Path, values) -> None:
    path.write_text("".join(f"{json.dumps(value)}\n" for value in values))


def rasterize_svg(svg_path: Path, png_path: Path) -> None:
    result = subprocess.run(
        ["sips", "-s", "format", "png", str(svg_path), "--out", str(png_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not png_path.is_file() or png_path.stat().st_size == 0:
        detail = (result.stderr or result.stdout or "sips produced no PNG").strip()
        raise RuntimeError(f"contact-sheet rasterization failed: {detail}")


def read_pgm(path: Path) -> np.ndarray:
    with path.open("rb") as handle:
        if handle.readline().strip() != b"P5":
            raise ValueError(f"{path} is not a P5 PGM")
        dimensions = handle.readline().strip().split()
        while dimensions and dimensions[0].startswith(b"#"):
            dimensions = handle.readline().strip().split()
        width, height = map(int, dimensions)
        if int(handle.readline().strip()) != 255:
            raise ValueError(f"{path} does not use max value 255")
        pixels = np.frombuffer(handle.read(), dtype=np.uint8)
    if pixels.size != width * height:
        raise ValueError(f"{path} contains {pixels.size} of {width * height} pixels")
    return (pixels.reshape((height, width)) >= 128).astype(np.uint8)


def write_pgm(path: Path, mask: np.ndarray) -> None:
    height, width = mask.shape
    with path.open("wb") as handle:
        handle.write(f"P5\n{width} {height}\n255\n".encode("ascii"))
        handle.write((mask.astype(np.uint8) * 255).tobytes())


def read_sdf(path: Path, width: int, height: int) -> np.ndarray:
    values = np.fromfile(path, dtype="<f4")
    if values.size != width * height:
        raise ValueError(f"{path} contains {values.size} of {width * height} float32 values")
    return values.reshape((height, width))


def tensor_hash(tensor: np.ndarray) -> str:
    return sha256_bytes(np.asarray(tensor, dtype="<f4").tobytes())


def decode_sdf_mask(field: np.ndarray) -> np.ndarray:
    """Decode the corpus convention: positive signed distance is foreground."""
    return (np.asarray(field) > 0).astype(np.uint8)


def mask_usability_assay(mask: np.ndarray) -> dict:
    mask = np.asarray(mask, dtype=np.uint8)
    if mask.ndim != 2:
        raise ValueError(f"silhouette mask must be two-dimensional, got {mask.shape}")
    foreground = mask != 0
    foreground_count = int(foreground.sum())
    pixel_count = int(foreground.size)
    border = np.concatenate((foreground[0], foreground[-1], foreground[1:-1, 0], foreground[1:-1, -1]))
    border_count = int(border.sum())

    visited = np.zeros_like(foreground, dtype=bool)
    component_sizes = []
    height, width = foreground.shape
    for start_y, start_x in np.argwhere(foreground):
        if visited[start_y, start_x]:
            continue
        stack = [(int(start_y), int(start_x))]
        visited[start_y, start_x] = True
        size = 0
        while stack:
            y, x = stack.pop()
            size += 1
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= next_y < height and 0 <= next_x < width and foreground[next_y, next_x] and not visited[next_y, next_x]:
                    visited[next_y, next_x] = True
                    stack.append((next_y, next_x))
        component_sizes.append(size)

    nonempty = foreground_count > 0
    full = foreground_count == pixel_count
    touches_frame = border_count > 0
    largest_component = max(component_sizes, default=0)
    return {
        "schema": "kaminos.lirm-silhouette-mask-usability-assay.v0",
        "usable": bool(nonempty and not full and not touches_frame),
        "nonempty": nonempty,
        "full": full,
        "touchesFrame": touches_frame,
        "foregroundOccupancy": round(foreground_count / pixel_count, 6),
        "borderForegroundFraction": round(border_count / max(1, border.size), 6),
        "componentCount": len(component_sizes),
        "largestComponentFraction": round(largest_component / max(1, foreground_count), 6),
    }


def initial_receipt(args) -> dict:
    return {
        "schema": SCHEMA,
        "status": "running",
        "phase": "initializing",
        "routeIdentity": {
            "requestedRoute": REQUESTED_ROUTE,
            "effectiveRoute": PROBE_ROUTE if args.probe_only else MLX_ROUTE,
        },
        "requestedConfig": {
            "corpusCount": len(args.corpus_dir),
            "seed": args.seed,
            "validationFraction": args.validation_fraction,
            "probeOnly": args.probe_only,
            "epochs": args.epochs,
            "batchSize": args.batch_size,
            "latentDim": args.latent_dim,
            "learningRate": args.learning_rate,
            "beta": args.beta,
            "samples": args.samples,
            "temperature": args.temperature,
            "copyThreshold": args.copy_threshold,
        },
        "falseClosureGuards": {
            "sourceBytesConsumed": False,
            "identityLabelsConsumed": False,
            "missingSdfCount": None,
            "checkpointWritten": False,
            "contactSheetRasterWritten": False,
            "generatedSampleCount": 0,
            "acceptedCopiedSampleCount": 0,
        },
    }


def load_dataset(corpus_dirs: list[Path], validation_fraction: float, seed: int):
    if not 0 < validation_fraction < 1:
        raise ValueError("validation-fraction must be between zero and one")
    samples = []
    corpora = []
    dimensions = None
    for corpus_index, corpus_dir in enumerate(corpus_dirs):
        receipt_path = corpus_dir / "receipt.json"
        receipt = json.loads(receipt_path.read_text())
        corpus_status = receipt.get("status")
        if corpus_status not in ("complete", "partial"):
            raise ValueError(f"{receipt_path} has unusable corpus status {corpus_status!r}")
        effective_route = receipt.get("routeIdentity", {}).get("effectiveRoute")
        if effective_route != "kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0":
            raise ValueError(f"{receipt_path} has unexpected effective route {effective_route!r}")
        index_path = corpus_dir / "training-index.jsonl"
        rows = [json.loads(line) for line in index_path.read_text().splitlines() if line.strip()]
        accepted_count = int(receipt.get("acceptedSourceCount", len(rows)))
        failed_count = int(receipt.get("failedSourceCount", 0))
        requested_count = int(receipt.get("requestedSourceCount", accepted_count + failed_count))
        if accepted_count != len(rows):
            raise ValueError(f"{receipt_path} claims {accepted_count} accepted sources but index contains {len(rows)}")
        if corpus_status == "partial" and requested_count != accepted_count + failed_count:
            raise ValueError(f"{receipt_path} partial counts do not reconcile")
        corpora.append({
            "corpusIndex": corpus_index,
            "path": str(corpus_dir.resolve()),
            "status": corpus_status,
            "requestedSourceCount": requested_count,
            "acceptedSourceCount": accepted_count,
            "failedSourceCount": failed_count,
            "receiptHash": sha256_bytes(receipt_path.read_bytes()),
            "trainingIndexHash": sha256_bytes(index_path.read_bytes()),
            "acceptedSampleCount": len(rows),
            "effectiveRoute": effective_route,
        })
        for row in rows:
            mask_meta = row.get("mask", {})
            sdf_meta = row.get("signedDistance", {})
            width = int(sdf_meta.get("width", mask_meta.get("width", 0)))
            height = int(sdf_meta.get("height", mask_meta.get("height", 0)))
            sdf_path = corpus_dir / str(sdf_meta.get("path", ""))
            mask_path = corpus_dir / str(mask_meta.get("path", ""))
            if not sdf_path.is_file():
                raise FileNotFoundError(f"missing signed-distance field: {sdf_path}")
            if not mask_path.is_file():
                raise FileNotFoundError(f"missing silhouette mask: {mask_path}")
            if dimensions is None:
                dimensions = (height, width)
            if dimensions != (height, width):
                raise ValueError(f"mixed tensor dimensions: expected {dimensions}, got {(height, width)}")
            sdf = read_sdf(sdf_path, width, height)
            mask = read_pgm(mask_path)
            if mask.shape != sdf.shape:
                raise ValueError(f"mask/SDF shape mismatch for {sdf_path}")
            scale = max(1.0, max(width, height) * 0.25)
            tensor = np.clip(sdf / scale, -1.0, 1.0).astype(np.float32)
            samples.append({
                "corpusIndex": corpus_index,
                "shapeHash": str(row.get("shapeHash") or sha256_bytes(mask.tobytes())),
                "tensorHash": tensor_hash(tensor),
                "tensor": tensor,
                "mask": mask,
            })
    if len(samples) < 4:
        raise ValueError("latent model requires at least four silhouettes")
    samples.sort(key=lambda item: (item["tensorHash"], item["shapeHash"], item["corpusIndex"]))
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(samples))
    validation_count = max(1, min(len(samples) - 1, round(len(samples) * validation_fraction)))
    validation_positions = set(int(value) for value in order[:validation_count])
    manifest_samples = []
    for index, sample in enumerate(samples):
        sample["split"] = "validation" if index in validation_positions else "training"
        manifest_samples.append({
            "corpusIndex": sample["corpusIndex"],
            "shapeHash": sample["shapeHash"],
            "split": sample["split"],
            "tensorHash": sample["tensorHash"],
        })
    return samples, corpora, manifest_samples, dimensions


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return 1.0 if union == 0 else float(np.logical_and(a, b).sum() / union)


def novelty_assay(mask: np.ndarray, training_masks: np.ndarray, threshold: float) -> dict:
    nearest = {"index": -1, "similarity": 0.0, "transform": "direct"}
    for index, training in enumerate(training_masks):
        for transform, candidate in (("direct", training), ("mirror_x", np.fliplr(training))):
            similarity = mask_iou(mask, candidate)
            if similarity > nearest["similarity"]:
                nearest = {"index": index, "similarity": round(similarity, 6), "transform": transform}
    return {
        "schema": "kaminos.lirm-silhouette-novelty-assay.v0",
        "metric": "canonical-mask-iou",
        "copyThreshold": threshold,
        "includeMirror": True,
        "copied": nearest["similarity"] >= threshold,
        "nearest": nearest,
    }


def mask_path(mask: np.ndarray) -> str:
    commands = []
    height, width = mask.shape
    for y in range(height):
        x = 0
        while x < width:
            while x < width and not mask[y, x]:
                x += 1
            if x >= width:
                break
            start = x
            while x < width and mask[y, x]:
                x += 1
            commands.append(f"M{start} {y}h{x - start}v1h-{x - start}z")
    return "".join(commands)


def render_contact_sheet(
    generations: list[dict],
    masks: list[np.ndarray],
    columns: int,
    requested_route: str = REQUESTED_ROUTE,
    effective_route: str = MLX_ROUTE,
) -> str:
    cell_width = 180
    cell_height = 205
    rows = max(1, math.ceil(len(generations) / columns))
    cells = []
    for index, (generation, mask) in enumerate(zip(generations, masks)):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        scale = min(150 / mask.shape[1], 150 / mask.shape[0])
        nearest = generation["noveltyAssay"]["nearest"]
        cells.append(f'''<g transform="translate({x} {y})">
  <rect width="{cell_width - 2}" height="{cell_height - 2}" fill="#080b09" stroke="#303a32"/>
  <g transform="translate(15 8) scale({scale})"><path d="{mask_path(mask)}" fill="#e5eddc"/></g>
  <text x="8" y="170" fill="#efcc67" font-family="Menlo, monospace" font-size="10">{generation['generationId']} · {generation['mode']}</text>
  <text x="8" y="188" fill="#8e9a90" font-family="Menlo, monospace" font-size="9">nearest {nearest['similarity']:.3f} {nearest['transform']}</text>
</g>''')
    width = columns * cell_width
    height = rows * cell_height
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" data-route="{requested_route}" data-effective-route="{effective_route}">
<rect width="100%" height="100%" fill="#050706"/>
{''.join(cells)}
</svg>'''


def build_mlx_vae(input_size: int, latent_dim: int, channels: list[int]):
    import mlx.core as mx
    import mlx.nn as nn

    if input_size % 8:
        raise ValueError("MLX convolutional VAE input size must be divisible by eight")
    if len(channels) != 3:
        raise ValueError(f"MLX convolutional VAE requires three channel widths, got {channels}")
    feature_size = input_size // 8

    class SilhouetteVAE(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder1 = nn.Conv2d(1, channels[0], 4, stride=2, padding=1)
            self.encoder2 = nn.Conv2d(channels[0], channels[1], 4, stride=2, padding=1)
            self.encoder3 = nn.Conv2d(channels[1], channels[2], 4, stride=2, padding=1)
            self.mu = nn.Linear(feature_size * feature_size * channels[2], latent_dim)
            self.logvar = nn.Linear(feature_size * feature_size * channels[2], latent_dim)
            self.decoder_input = nn.Linear(latent_dim, feature_size * feature_size * channels[2])
            self.decoder1 = nn.ConvTranspose2d(channels[2], channels[1], 4, stride=2, padding=1)
            self.decoder2 = nn.ConvTranspose2d(channels[1], channels[0], 4, stride=2, padding=1)
            self.decoder3 = nn.ConvTranspose2d(channels[0], 1, 4, stride=2, padding=1)

        def encode(self, value):
            value = nn.relu(self.encoder1(value))
            value = nn.relu(self.encoder2(value))
            value = nn.relu(self.encoder3(value))
            value = value.reshape((value.shape[0], -1))
            return self.mu(value), mx.clip(self.logvar(value), -8.0, 8.0)

        def decode(self, value):
            value = nn.relu(self.decoder_input(value))
            value = value.reshape((value.shape[0], feature_size, feature_size, channels[2]))
            value = nn.relu(self.decoder1(value))
            value = nn.relu(self.decoder2(value))
            return mx.tanh(self.decoder3(value))

        def __call__(self, value):
            mu, logvar = self.encode(value)
            epsilon = mx.random.normal(mu.shape)
            latent = mu + mx.exp(0.5 * logvar) * epsilon
            return self.decode(latent), mu, logvar

    return SilhouetteVAE()


def train_mlx(args, samples, dimensions, out_dir: Path):
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim

    height, width = dimensions
    if height != width or height % 8:
        raise ValueError("MLX convolutional VAE requires square dimensions divisible by eight")
    train_data = np.stack([sample["tensor"] for sample in samples if sample["split"] == "training"])[..., None]
    validation_data = np.stack([sample["tensor"] for sample in samples if sample["split"] == "validation"])[..., None]
    model = build_mlx_vae(height, args.latent_dim, [16, 32, 64])
    optimizer = optim.Adam(learning_rate=args.learning_rate)
    mx.random.seed(args.seed)
    rng = np.random.default_rng(args.seed)

    def loss_fn(model, batch):
        reconstruction, mu, logvar = model(batch)
        reconstruction_loss = mx.mean(mx.square(reconstruction - batch))
        kl_loss = -0.5 * mx.mean(1.0 + logvar - mx.square(mu) - mx.exp(logvar))
        return reconstruction_loss + args.beta * kl_loss, (reconstruction_loss, kl_loss)

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    metrics = []
    started = time.time()
    for epoch in range(args.epochs):
        permutation = rng.permutation(len(train_data))
        losses = []
        reconstruction_losses = []
        kl_losses = []
        for start in range(0, len(train_data), args.batch_size):
            batch = mx.array(train_data[permutation[start:start + args.batch_size]])
            (loss, (reconstruction_loss, kl_loss)), gradients = loss_and_grad(model, batch)
            optimizer.update(model, gradients)
            mx.eval(model.parameters(), optimizer.state, loss, reconstruction_loss, kl_loss)
            losses.append(float(loss.item()))
            reconstruction_losses.append(float(reconstruction_loss.item()))
            kl_losses.append(float(kl_loss.item()))
        validation_batch = mx.array(validation_data)
        validation_reconstruction, validation_mu, _validation_logvar = model(validation_batch)
        validation_loss = mx.mean(mx.square(validation_reconstruction - validation_batch))
        mx.eval(validation_loss, validation_mu)
        metric = {
            "epoch": epoch + 1,
            "loss": round(float(np.mean(losses)), 8),
            "reconstructionLoss": round(float(np.mean(reconstruction_losses)), 8),
            "klLoss": round(float(np.mean(kl_losses)), 8),
            "validationReconstructionLoss": round(float(validation_loss.item()), 8),
        }
        metrics.append(metric)
        print(json.dumps(metric), flush=True)

    checkpoint_dir = out_dir / "checkpoint"
    checkpoint_dir.mkdir(exist_ok=True)
    model.save_weights(str(checkpoint_dir / "model.safetensors"))
    model_config = {
        "schema": "kaminos.lirm-silhouette-latent-model-config.v0",
        "architecture": MLX_ROUTE,
        "inputShape": [height, width, 1],
        "latentDim": args.latent_dim,
        "channels": [16, 32, 64],
        "beta": args.beta,
        "normalization": "clip(sdf / (max(width,height)*0.25), -1, 1)",
        "maskDecode": "normalized_sdf > 0",
    }
    write_json(checkpoint_dir / "model-config.json", model_config)
    write_jsonl(out_dir / "training-metrics.jsonl", metrics)

    all_data = np.stack([sample["tensor"] for sample in samples])[..., None]
    all_mu, _all_logvar = model.encode(mx.array(all_data))
    mx.eval(all_mu)
    posterior = np.array(all_mu)
    generated_masks = []
    generations = []
    generated_dir = out_dir / "generated"
    generated_dir.mkdir(exist_ok=True)
    training_masks = np.stack([sample["mask"] for sample in samples])
    for index in range(args.samples):
        mode_index = index % 3
        if mode_index == 0:
            parents = rng.choice(len(posterior), size=2, replace=False)
            amount = float(rng.uniform(0.25, 0.75))
            latent = posterior[parents[0]] * (1.0 - amount) + posterior[parents[1]] * amount
            mode = "posterior-interpolation"
            parameters = {"amount": round(amount, 6)}
        elif mode_index == 1:
            parents = rng.choice(len(posterior), size=1, replace=False)
            latent = posterior[parents[0]] + rng.normal(0, args.temperature, size=args.latent_dim)
            mode = "posterior-mutation"
            parameters = {"temperature": args.temperature}
        else:
            parents = np.array([], dtype=np.int64)
            latent = rng.normal(0, args.temperature, size=args.latent_dim)
            mode = "prior-sample"
            parameters = {"temperature": args.temperature}
        decoded = model.decode(mx.array(latent[None, :].astype(np.float32)))
        mx.eval(decoded)
        field = np.array(decoded)[0, ..., 0]
        mask = decode_sdf_mask(field)
        novelty = novelty_assay(mask, training_masks, args.copy_threshold)
        usability = mask_usability_assay(mask)
        generation_id = f"latent-shape-{index:03d}"
        write_pgm(generated_dir / f"{generation_id}.pgm", mask)
        field.astype("<f4").tofile(generated_dir / f"{generation_id}.f32")
        generations.append({
            "generationId": generation_id,
            "mode": mode,
            "parameters": parameters,
            "parentTensorHashes": [samples[int(parent)]["tensorHash"] for parent in parents],
            "maskHash": sha256_bytes(mask.tobytes()),
            "foregroundOccupancy": round(float(mask.mean()), 6),
            "noveltyAssay": novelty,
            "usabilityAssay": usability,
            "acceptedForDownstream": bool(usability["usable"] and not novelty["copied"]),
            "maskPath": f"generated/{generation_id}.pgm",
            "signedDistancePath": f"generated/{generation_id}.f32",
        })
        generated_masks.append(mask)

    contact_sheet_svg = render_contact_sheet(generations, generated_masks, args.columns)
    (out_dir / "contact-sheet.svg").write_text(contact_sheet_svg)
    rasterize_svg(out_dir / "contact-sheet.svg", out_dir / "contact-sheet.png")
    return model_config, metrics, generations, time.time() - started


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    receipt = initial_receipt(args)
    write_json(out_dir / "receipt.json", receipt)
    corpus_receipt_count = 0
    try:
        corpus_dirs = [Path(value) for value in args.corpus_dir]
        corpus_receipt_count = sum((path / "receipt.json").is_file() for path in corpus_dirs)
        receipt["phase"] = "dataset_load"
        write_json(out_dir / "receipt.json", receipt)
        samples, corpora, manifest_samples, dimensions = load_dataset(corpus_dirs, args.validation_fraction, args.seed)
        training_count = sum(sample["split"] == "training" for sample in samples)
        validation_count = len(samples) - training_count
        dataset_manifest = {
            "schema": "kaminos.lirm-silhouette-latent-dataset.v0",
            "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": receipt["routeIdentity"]["effectiveRoute"]},
            "inputShape": [dimensions[0], dimensions[1], 1],
            "seed": args.seed,
            "samples": manifest_samples,
        }
        write_json(out_dir / "dataset-manifest.json", dataset_manifest)
        receipt.update({
            "corpora": corpora,
            "trainingSampleCount": training_count,
            "validationSampleCount": validation_count,
            "inputShape": f"{dimensions[1]}x{dimensions[0]}x1",
        })
        receipt["falseClosureGuards"]["missingSdfCount"] = 0
        if args.probe_only:
            receipt.update({"status": "complete", "phase": "dataset_probe_complete"})
            write_json(out_dir / "receipt.json", receipt)
            print(json.dumps({"status": "complete", "receipt": str(out_dir / "receipt.json")}), flush=True)
            return

        receipt["phase"] = "mlx_training"
        write_json(out_dir / "receipt.json", receipt)
        model_config, metrics, generations, duration = train_mlx(args, samples, dimensions, out_dir)
        receipt.update({
            "status": "complete",
            "phase": "witness_written",
            "effectiveConfig": model_config,
            "trainingDurationSeconds": round(duration, 3),
            "trainingMetrics": {"first": metrics[0], "last": metrics[-1]},
            "generatedSampleCount": len(generations),
            "acceptedSampleCount": sum(item["acceptedForDownstream"] for item in generations),
            "generations": generations,
        })
        receipt["falseClosureGuards"].update({
            "checkpointWritten": (out_dir / "checkpoint/model.safetensors").is_file(),
            "contactSheetRasterWritten": (out_dir / "contact-sheet.png").is_file(),
            "generatedSampleCount": len(generations),
            "acceptedCopiedSampleCount": sum(item["acceptedForDownstream"] and item["noveltyAssay"]["copied"] for item in generations),
        })
        write_json(out_dir / "receipt.json", receipt)
        print(json.dumps({"status": "complete", "receipt": str(out_dir / "receipt.json")}), flush=True)
    except Exception as error:
        receipt.update({
            "status": "failed",
            "failurePhase": receipt.get("phase", "initializing"),
            "errorMessage": str(error),
            "lastTrustworthyEvidence": {"corpusReceiptCount": corpus_receipt_count},
        })
        write_json(out_dir / "receipt.json", receipt)
        raise


if __name__ == "__main__":
    main()
