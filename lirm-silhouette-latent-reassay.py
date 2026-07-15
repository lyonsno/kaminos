#!/usr/bin/env python3

import argparse
import importlib.util
import json
import shutil
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_PATH = SCRIPT_DIR / "lirm-silhouette-latent-model.py"
SCHEMA = "kaminos.lirm-silhouette-latent-reassay.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-latent-reassay-v0"
EFFECTIVE_ROUTE = "positive-inside-sdf-reassay-v0"


def load_model_module():
    spec = importlib.util.spec_from_file_location("lirm_silhouette_latent_model", MODEL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser(description="Reassay saved silhouette latent fields using the canonical positive-inside SDF convention.")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--columns", type=int, default=8)
    return parser.parse_args()


def initial_receipt(run_dir: Path) -> dict:
    return {
        "schema": SCHEMA,
        "status": "running",
        "phase": "source_validation",
        "routeIdentity": {
            "requestedRoute": REQUESTED_ROUTE,
            "effectiveRoute": EFFECTIVE_ROUTE,
        },
        "sourceRun": {"path": str(run_dir.resolve()), "receiptHash": None},
        "falseClosureGuards": {
            "sourceRunValidated": False,
            "sourceFieldsReused": 0,
            "sourceRunMutated": False,
            "contactSheetRasterWritten": False,
        },
    }


def main():
    args = parse_args()
    run_dir = Path(args.run_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    generated_dir = out_dir / "generated"
    generated_dir.mkdir(exist_ok=True)
    model = load_model_module()
    receipt = initial_receipt(run_dir)
    model.write_json(out_dir / "receipt.json", receipt)

    try:
        source_receipt_path = run_dir / "receipt.json"
        source_receipt = json.loads(source_receipt_path.read_text())
        receipt["sourceRun"]["receiptHash"] = model.sha256_bytes(source_receipt_path.read_bytes())
        if source_receipt.get("schema") != model.SCHEMA:
            raise ValueError(f"unexpected source schema {source_receipt.get('schema')!r}")
        if source_receipt.get("status") != "complete" or source_receipt.get("phase") != "witness_written":
            raise ValueError("source run must be complete at witness_written")
        source_route = source_receipt.get("routeIdentity", {}).get("effectiveRoute")
        if source_route != model.MLX_ROUTE:
            raise ValueError(f"unexpected source effective route {source_route!r}")
        dimensions = source_receipt.get("effectiveConfig", {}).get("inputShape")
        if not isinstance(dimensions, list) or len(dimensions) != 3 or dimensions[2] != 1:
            raise ValueError(f"invalid source input shape {dimensions!r}")
        height, width, _channels = map(int, dimensions)
        requested = source_receipt.get("requestedConfig", {})
        validation_fraction = float(requested.get("validationFraction", 0.1))
        seed = int(requested.get("seed", 713))
        copy_threshold = float(requested.get("copyThreshold", 0.94))
        corpus_dirs = [Path(item["path"]) for item in source_receipt.get("corpora", [])]
        samples, _corpora, _manifest, loaded_dimensions = model.load_dataset(corpus_dirs, validation_fraction, seed)
        if loaded_dimensions != (height, width):
            raise ValueError(f"source/corpus dimensions differ: {(height, width)} versus {loaded_dimensions}")
        training_masks = model.np.stack([sample["mask"] for sample in samples])
        receipt["falseClosureGuards"]["sourceRunValidated"] = True
        receipt["phase"] = "field_reassay"
        model.write_json(out_dir / "receipt.json", receipt)

        generations = []
        masks = []
        for source_generation in source_receipt.get("generations", []):
            generation_id = str(source_generation["generationId"])
            relative_field_path = Path(source_generation["signedDistancePath"])
            source_field_path = run_dir / relative_field_path
            if not source_field_path.is_file():
                raise FileNotFoundError(f"missing source field {source_field_path}")
            field = model.read_sdf(source_field_path, width, height)
            mask = model.decode_sdf_mask(field)
            novelty = model.novelty_assay(mask, training_masks, copy_threshold)
            usability = model.mask_usability_assay(mask)
            output_field_path = generated_dir / f"{generation_id}.f32"
            output_mask_path = generated_dir / f"{generation_id}.pgm"
            shutil.copyfile(source_field_path, output_field_path)
            model.write_pgm(output_mask_path, mask)
            generation = {
                "generationId": generation_id,
                "mode": source_generation.get("mode"),
                "parameters": source_generation.get("parameters", {}),
                "parentTensorHashes": source_generation.get("parentTensorHashes", []),
                "maskHash": model.sha256_bytes(mask.tobytes()),
                "foregroundOccupancy": usability["foregroundOccupancy"],
                "noveltyAssay": novelty,
                "usabilityAssay": usability,
                "acceptedForDownstream": bool(usability["usable"] and not novelty["copied"]),
                "maskPath": f"generated/{generation_id}.pgm",
                "signedDistancePath": f"generated/{generation_id}.f32",
                "sourceSignedDistancePath": str(relative_field_path),
            }
            generations.append(generation)
            masks.append(mask)
            receipt["falseClosureGuards"]["sourceFieldsReused"] += 1

        contact_sheet = model.render_contact_sheet(
            generations,
            masks,
            args.columns,
            requested_route=REQUESTED_ROUTE,
            effective_route=EFFECTIVE_ROUTE,
        )
        (out_dir / "contact-sheet.svg").write_text(contact_sheet)
        model.rasterize_svg(out_dir / "contact-sheet.svg", out_dir / "contact-sheet.png")
        receipt.update({
            "status": "complete",
            "phase": "witness_written",
            "generatedSampleCount": len(generations),
            "acceptedSampleCount": sum(item["acceptedForDownstream"] for item in generations),
            "generations": generations,
        })
        receipt["falseClosureGuards"]["contactSheetRasterWritten"] = True
        model.write_json(out_dir / "receipt.json", receipt)
        print(json.dumps({"status": "complete", "receipt": str(out_dir / "receipt.json")}))
    except Exception as error:
        receipt.update({
            "status": "failed",
            "failurePhase": receipt.get("phase", "source_validation"),
            "errorMessage": str(error),
            "lastTrustworthyEvidence": {
                "sourceRunValidated": receipt["falseClosureGuards"]["sourceRunValidated"],
                "sourceFieldsReused": receipt["falseClosureGuards"]["sourceFieldsReused"],
            },
        })
        model.write_json(out_dir / "receipt.json", receipt)
        raise


if __name__ == "__main__":
    main()
