#!/usr/bin/env python3

import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_PATH = SCRIPT_DIR / "lirm-silhouette-latent-model.py"
SCHEMA = "kaminos.lirm-silhouette-latent-sample.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-latent-sample-v0"
EFFECTIVE_ROUTE = "mlx-sdf-vae-prior-sample-v0"


def load_model_module():
    spec = importlib.util.spec_from_file_location("lirm_silhouette_latent_model", MODEL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser(description="Sample organism silhouettes directly from a trained MLX SDF VAE prior.")
    parser.add_argument("--model-run-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--samples", type=int, required=True)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--copy-threshold", type=float)
    parser.add_argument("--columns", type=int, default=8)
    return parser.parse_args()


def initial_receipt(args, model_run_dir: Path) -> dict:
    return {
        "schema": SCHEMA,
        "status": "running",
        "phase": "source_validation",
        "routeIdentity": {
            "requestedRoute": REQUESTED_ROUTE,
            "effectiveRoute": EFFECTIVE_ROUTE,
        },
        "requestedConfig": {
            "samples": args.samples,
            "seed": args.seed,
            "temperature": args.temperature,
            "batchSize": args.batch_size,
            "copyThreshold": args.copy_threshold,
        },
        "sourceModel": {
            "path": str(model_run_dir.resolve()),
            "receiptHash": None,
            "checkpointHash": None,
            "receiptMaskDecode": None,
        },
        "falseClosureGuards": {
            "sourceCheckpointValidated": False,
            "sourceModelRouteValidated": False,
            "generatedFieldCount": 0,
            "contactSheetRasterWritten": False,
        },
    }


def main():
    args = parse_args()
    if args.samples <= 0:
        raise ValueError("samples must be positive")
    if args.batch_size <= 0:
        raise ValueError("batch-size must be positive")
    model_run_dir = Path(args.model_run_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    generated_dir = out_dir / "generated"
    generated_dir.mkdir(exist_ok=True)
    support = load_model_module()
    receipt = initial_receipt(args, model_run_dir)
    support.write_json(out_dir / "receipt.json", receipt)

    try:
        source_receipt_path = model_run_dir / "receipt.json"
        source_receipt = json.loads(source_receipt_path.read_text())
        receipt["sourceModel"]["receiptHash"] = support.sha256_bytes(source_receipt_path.read_bytes())
        if source_receipt.get("schema") != support.SCHEMA:
            raise ValueError(f"unexpected source schema {source_receipt.get('schema')!r}")
        if source_receipt.get("status") != "complete" or source_receipt.get("phase") != "witness_written":
            raise ValueError("source model must be complete at witness_written")
        if source_receipt.get("routeIdentity", {}).get("effectiveRoute") != support.MLX_ROUTE:
            raise ValueError("source model effective route is not the MLX convolutional SDF VAE")
        receipt["falseClosureGuards"]["sourceModelRouteValidated"] = True

        checkpoint_path = model_run_dir / "checkpoint" / "model.safetensors"
        if not checkpoint_path.is_file():
            raise FileNotFoundError(f"missing source checkpoint: {checkpoint_path}")
        receipt["sourceModel"]["checkpointHash"] = support.sha256_bytes(checkpoint_path.read_bytes())
        receipt["falseClosureGuards"]["sourceCheckpointValidated"] = True

        config = source_receipt.get("effectiveConfig", {})
        receipt["sourceModel"]["receiptMaskDecode"] = config.get("maskDecode")
        dimensions = config.get("inputShape")
        channels = [int(value) for value in config.get("channels", [])]
        latent_dim = int(config.get("latentDim", 0))
        if not isinstance(dimensions, list) or len(dimensions) != 3 or dimensions[2] != 1 or dimensions[0] != dimensions[1]:
            raise ValueError(f"invalid model input shape {dimensions!r}")
        height, width, _channels = map(int, dimensions)
        source_requested = source_receipt.get("requestedConfig", {})
        copy_threshold = args.copy_threshold
        if copy_threshold is None:
            copy_threshold = float(source_requested.get("copyThreshold", 0.94))
        corpus_dirs = [Path(item["path"]) for item in source_receipt.get("corpora", [])]
        samples, _corpora, _manifest, loaded_dimensions = support.load_dataset(
            corpus_dirs,
            float(source_requested.get("validationFraction", 0.1)),
            int(source_requested.get("seed", 713)),
        )
        if loaded_dimensions != (height, width):
            raise ValueError(f"source/corpus dimensions differ: {(height, width)} versus {loaded_dimensions}")
        training_masks = np.stack([sample["mask"] for sample in samples])

        receipt["phase"] = "mlx_sampling"
        receipt["effectiveConfig"] = {
            "samples": args.samples,
            "seed": args.seed,
            "temperature": args.temperature,
            "batchSize": args.batch_size,
            "copyThreshold": copy_threshold,
            "inputShape": dimensions,
            "latentDim": latent_dim,
            "channels": channels,
            "maskDecode": "normalized_sdf > 0",
        }
        support.write_json(out_dir / "receipt.json", receipt)

        import mlx.core as mx

        vae = support.build_mlx_vae(height, latent_dim, channels)
        vae.load_weights(str(checkpoint_path))
        mx.eval(vae.parameters())
        rng = np.random.default_rng(args.seed)
        generations = []
        masks = []
        for start in range(0, args.samples, args.batch_size):
            batch_count = min(args.batch_size, args.samples - start)
            latents = rng.normal(0, args.temperature, size=(batch_count, latent_dim)).astype(np.float32)
            decoded = vae.decode(mx.array(latents))
            mx.eval(decoded)
            fields = np.array(decoded)[..., 0]
            for offset, field in enumerate(fields):
                index = start + offset
                generation_id = f"prior-shape-{index:04d}"
                mask = support.decode_sdf_mask(field)
                novelty = support.novelty_assay(mask, training_masks, copy_threshold)
                usability = support.mask_usability_assay(mask)
                mask_path = generated_dir / f"{generation_id}.pgm"
                field_path = generated_dir / f"{generation_id}.f32"
                support.write_pgm(mask_path, mask)
                field.astype("<f4").tofile(field_path)
                generations.append({
                    "generationId": generation_id,
                    "mode": "prior-sample",
                    "parameters": {"temperature": args.temperature},
                    "parentTensorHashes": [],
                    "latentHash": support.tensor_hash(latents[offset]),
                    "maskHash": support.sha256_bytes(mask.tobytes()),
                    "foregroundOccupancy": usability["foregroundOccupancy"],
                    "noveltyAssay": novelty,
                    "usabilityAssay": usability,
                    "acceptedForDownstream": bool(usability["usable"] and not novelty["copied"]),
                    "maskPath": f"generated/{generation_id}.pgm",
                    "signedDistancePath": f"generated/{generation_id}.f32",
                })
                masks.append(mask)
                receipt["falseClosureGuards"]["generatedFieldCount"] += 1

        contact_sheet = support.render_contact_sheet(
            generations,
            masks,
            args.columns,
            requested_route=REQUESTED_ROUTE,
            effective_route=EFFECTIVE_ROUTE,
        )
        (out_dir / "contact-sheet.svg").write_text(contact_sheet)
        support.rasterize_svg(out_dir / "contact-sheet.svg", out_dir / "contact-sheet.png")
        receipt.update({
            "status": "complete",
            "phase": "witness_written",
            "generatedSampleCount": len(generations),
            "acceptedSampleCount": sum(item["acceptedForDownstream"] for item in generations),
            "generations": generations,
        })
        receipt["falseClosureGuards"]["contactSheetRasterWritten"] = True
        support.write_json(out_dir / "receipt.json", receipt)
        print(json.dumps({"status": "complete", "receipt": str(out_dir / "receipt.json")}))
    except Exception as error:
        receipt.update({
            "status": "failed",
            "failurePhase": receipt.get("phase", "source_validation"),
            "errorMessage": str(error),
            "lastTrustworthyEvidence": {
                "sourceModelRouteValidated": receipt["falseClosureGuards"]["sourceModelRouteValidated"],
                "sourceCheckpointValidated": receipt["falseClosureGuards"]["sourceCheckpointValidated"],
                "generatedFieldCount": receipt["falseClosureGuards"]["generatedFieldCount"],
            },
        })
        support.write_json(out_dir / "receipt.json", receipt)
        raise


if __name__ == "__main__":
    main()
