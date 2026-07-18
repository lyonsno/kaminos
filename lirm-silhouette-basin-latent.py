#!/usr/bin/env python3

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_PATH = SCRIPT_DIR / "lirm-silhouette-latent-model.py"
ATLAS_PATH = SCRIPT_DIR / "lirm-silhouette-morphology-basin-atlas.py"
SCHEMA = "kaminos.lirm-silhouette-basin-latent.v0"
REQUESTED_ROUTE = "kaminos/lirm-speciation-armature/silhouette-basin-latent-v0"
EFFECTIVE_ROUTE = "mlx-sdf-vae-posterior-basin-perturbation-v0"
NORMALIZATION = "clip(sdf / (max(width,height)*0.25), -1, 1)"
MASK_DECODE = "normalized_sdf > 0"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    if spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    spec.loader.exec_module(module)
    return module


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def tensor_hash(value: np.ndarray) -> str:
    return sha256_bytes(np.asarray(value, dtype="<f4").tobytes())


def parse_strengths(text: str) -> list[float]:
    values = [float(part.strip()) for part in text.split(",") if part.strip()]
    if not values:
        raise ValueError("at least one posterior perturbation strength is required")
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("posterior perturbation strengths must be finite and nonnegative")
    if len(set(values)) != len(values):
        raise ValueError("posterior perturbation strengths must be unique")
    return values


def posterior_perturbations(
    mu: np.ndarray,
    std: np.ndarray,
    strengths: list[float],
    samples_per_strength: int,
    seed: int,
) -> list[dict]:
    mu = np.asarray(mu, dtype=np.float32)
    std = np.asarray(std, dtype=np.float32)
    if mu.shape != std.shape or mu.ndim != 1:
        raise ValueError(f"mu/std must be equal one-dimensional arrays, got {mu.shape} and {std.shape}")
    if samples_per_strength <= 0:
        raise ValueError("samples-per-strength must be positive")
    parsed = [float(value) for value in strengths]
    if 0.0 not in parsed:
        raise ValueError("strengths must include zero to preserve a reconstruction control")
    rng = np.random.default_rng(seed)
    results = [{
        "latent": mu.copy(),
        "strength": 0.0,
        "sampleIndex": 0,
        "latentHash": tensor_hash(mu),
    }]
    for strength in parsed:
        if strength == 0.0:
            continue
        for sample_index in range(samples_per_strength):
            epsilon = rng.normal(size=mu.shape).astype(np.float32)
            latent = (mu + np.float32(strength) * std * epsilon).astype(np.float32)
            results.append({
                "latent": latent,
                "strength": strength,
                "sampleIndex": sample_index,
                "latentHash": tensor_hash(latent),
            })
    return results


def classify_basin(vector: np.ndarray, representative_vectors: np.ndarray) -> dict:
    vector = np.asarray(vector, dtype=np.float64)
    representatives = np.asarray(representative_vectors, dtype=np.float64)
    if representatives.ndim != 2 or vector.shape != (representatives.shape[1],):
        raise ValueError(f"descriptor dimensions differ: {vector.shape} versus {representatives.shape}")
    distances = np.linalg.norm(representatives - vector[None, :], axis=1) / math.sqrt(max(1, vector.size))
    basin_index = int(np.argmin(distances))
    return {"basinIndex": basin_index, "distance": round(float(distances[basin_index]), 6)}


def mask_iou_vector(mask: np.ndarray, candidates: np.ndarray) -> np.ndarray:
    target = np.asarray(mask, dtype=bool)
    values = np.asarray(candidates, dtype=bool)
    if values.ndim == 2:
        values = values[None, ...]
    if values.ndim != 3 or values.shape[1:] != target.shape:
        raise ValueError(f"mask dimensions differ: {target.shape} versus {values.shape}")
    intersection = np.logical_and(values, target).sum(axis=(1, 2))
    union = np.logical_or(values, target).sum(axis=(1, 2))
    return np.divide(intersection, union, out=np.ones_like(intersection, dtype=np.float64), where=union != 0)


def source_escape_assay(
    mask: np.ndarray,
    source_mask: np.ndarray,
    training_masks: np.ndarray,
    copy_threshold: float,
) -> dict:
    if not 0 <= copy_threshold <= 1:
        raise ValueError("copy-threshold must be between zero and one")
    direct = mask_iou_vector(mask, training_masks)
    mirror = mask_iou_vector(mask, np.flip(training_masks, axis=2))
    direct_index = int(np.argmax(direct))
    mirror_index = int(np.argmax(mirror))
    if mirror[mirror_index] > direct[direct_index]:
        nearest_index = mirror_index
        nearest_similarity = float(mirror[mirror_index])
        nearest_transform = "mirror_x"
    else:
        nearest_index = direct_index
        nearest_similarity = float(direct[direct_index])
        nearest_transform = "direct"

    source_direct = float(mask_iou_vector(mask, source_mask)[0])
    source_mirror = float(mask_iou_vector(mask, np.fliplr(source_mask))[0])
    if source_mirror > source_direct:
        source_similarity = source_mirror
        source_transform = "mirror_x"
    else:
        source_similarity = source_direct
        source_transform = "direct"
    return {
        "schema": "kaminos.lirm-silhouette-source-escape-assay.v0",
        "metric": "canonical-mask-iou",
        "copyThreshold": copy_threshold,
        "escapedSource": source_similarity < copy_threshold,
        "source": {"similarity": round(source_similarity, 6), "transform": source_transform},
        "nearestTraining": {
            "index": nearest_index,
            "similarity": round(nearest_similarity, 6),
            "transform": nearest_transform,
            "copied": nearest_similarity >= copy_threshold,
        },
    }


def reference_similarity_assay(
    mask: np.ndarray,
    reference_mask: np.ndarray,
    escape_threshold: float,
) -> dict:
    if not 0 <= escape_threshold <= 1:
        raise ValueError("escape-threshold must be between zero and one")
    direct = float(mask_iou_vector(mask, reference_mask)[0])
    mirror = float(mask_iou_vector(mask, np.fliplr(reference_mask))[0])
    if mirror > direct:
        similarity = mirror
        transform = "mirror_x"
    else:
        similarity = direct
        transform = "direct"
    return {
        "metric": "canonical-mask-iou",
        "escapeThreshold": escape_threshold,
        "similarity": round(similarity, 6),
        "transform": transform,
        "escaped": similarity < escape_threshold,
    }


def parse_args():
    parser = argparse.ArgumentParser(description="Perturb reviewed morphology-basin medoids in a trained silhouette VAE posterior.")
    parser.add_argument("--model-run-dir", required=True)
    parser.add_argument("--atlas-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--strengths", default="0,0.2,0.5,0.9")
    parser.add_argument("--samples-per-strength", type=int, default=1)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--copy-threshold", type=float)
    parser.add_argument("--columns", type=int, default=8)
    return parser.parse_args()


def write_json(path: Path, value) -> None:
    path.write_text(f"{json.dumps(value, indent=2)}\n")


def validate_artifact(root: Path, artifact: dict) -> Path:
    path = root / str(artifact.get("path", ""))
    if not path.is_file():
        raise FileNotFoundError(f"missing declared artifact {path}")
    actual = sha256_bytes(path.read_bytes())
    if actual != artifact.get("sha256"):
        raise ValueError(f"artifact hash mismatch for {path}: {actual} versus {artifact.get('sha256')}")
    return path


def validate_corpus_source(corpus: dict) -> tuple[dict, list[dict]]:
    corpus_dir = Path(corpus["path"])
    receipt_path = corpus_dir / "receipt.json"
    index_path = corpus_dir / "training-index.jsonl"
    if not receipt_path.is_file() or not index_path.is_file():
        raise FileNotFoundError(f"missing atlas source receipt or training index beneath {corpus_dir}")
    if sha256_bytes(receipt_path.read_bytes()) != corpus.get("receiptHash"):
        raise ValueError(f"corpus receipt moved beneath atlas: {receipt_path}")
    if sha256_bytes(index_path.read_bytes()) != corpus.get("trainingIndexHash"):
        raise ValueError(f"training index moved beneath atlas: {index_path}")
    receipt = json.loads(receipt_path.read_text())
    rows = [json.loads(line) for line in index_path.read_text().splitlines() if line.strip()]
    if len(rows) != int(corpus["acceptedSourceCount"]):
        raise ValueError(f"training index count moved beneath atlas: {index_path}")
    return receipt, rows


def validate_model_atlas_corpora(model_corpora: list[dict], atlas_corpora: list[dict]) -> bool:
    def identities(corpora):
        return sorted((
            str(Path(item["path"]).resolve()),
            str(item.get("receiptHash", "")),
            str(item.get("trainingIndexHash", "")),
            int(item.get("acceptedSourceCount", item.get("acceptedSampleCount", -1))),
        ) for item in corpora)

    if identities(model_corpora) != identities(atlas_corpora):
        raise ValueError("model/atlas corpus identity mismatch")
    return True


def load_source_assets(corpora: list[dict], model_support) -> tuple[dict, np.ndarray, list[dict]]:
    by_shape = {}
    masks = []
    rows_out = []
    for corpus_index, corpus in enumerate(corpora):
        corpus_dir = Path(corpus["path"])
        _receipt, rows = validate_corpus_source(corpus)
        for row_index, row in enumerate(rows):
            mask_meta = row.get("mask", {})
            sdf_meta = row.get("signedDistance", {})
            width = int(sdf_meta.get("width", mask_meta.get("width", 0)))
            height = int(sdf_meta.get("height", mask_meta.get("height", 0)))
            mask_path = corpus_dir / str(mask_meta.get("path", ""))
            sdf_path = corpus_dir / str(sdf_meta.get("path", ""))
            mask = model_support.read_pgm(mask_path)
            if mask.shape != (height, width):
                raise ValueError(f"source dimensions disagree for {mask_path}")
            shape_id = str(row.get("shapeId", ""))
            source = {
                "shapeId": shape_id,
                "corpusIndex": corpus_index,
                "rowIndex": row_index,
                "maskPath": str(mask_path),
                "sdfPath": str(sdf_path),
                "width": width,
                "height": height,
                "mask": mask,
            }
            if shape_id in by_shape:
                previous = by_shape[shape_id]
                if not np.array_equal(previous["mask"], mask):
                    raise ValueError(f"shapeId {shape_id} has inconsistent source masks")
            else:
                by_shape[shape_id] = source
            masks.append(mask)
            rows_out.append({key: value for key, value in source.items() if key != "mask"})
    return by_shape, np.stack(masks), rows_out


def descriptor_standardizer(descriptors: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    values = np.stack([descriptor["vector"] for descriptor in descriptors]).astype(np.float64)
    mean = values.mean(axis=0)
    scale = values.std(axis=0)
    scale[scale < 1e-8] = 1.0
    return mean, scale


def render_contact_sheet(generations: list[dict], masks: list[np.ndarray], columns: int, atlas_support) -> str:
    cell_width, cell_height = 190, 215
    rows = max(1, math.ceil(len(generations) / columns))
    cells = []
    for index, (generation, mask) in enumerate(zip(generations, masks)):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        scale = min(154 / mask.shape[1], 154 / mask.shape[0])
        path = atlas_support.mask_svg_path(mask, x + 18, y + 8, scale)
        classification = generation.get("basinClassification")
        basin_text = "B--" if classification is None else f"B{classification['basinIndex']:02d}"
        retained = "hold" if generation.get("targetBasinRetained") else "shift"
        source_similarity = generation["sourceEscapeAssay"]["source"]["similarity"]
        cells.append(f'''<g data-generation="{generation['generationId']}">
  <rect x="{x + 2}" y="{y + 2}" width="{cell_width - 4}" height="{cell_height - 4}" fill="#0c110e" stroke="#39483e"/>
  <path d="{path}" fill="#d9edb6"/>
  <text x="{x + 8}" y="{y + 177}" fill="#f0c85f" font-family="Menlo, monospace" font-size="10">B{generation['sourceBasinIndex']:02d} s={generation['strength']:.2f} {basin_text}</text>
  <text x="{x + 8}" y="{y + 194}" fill="#9ca99e" font-family="Menlo, monospace" font-size="9">{retained} · source {source_similarity:.3f}</text>
  <text x="{x + 8}" y="{y + 208}" fill="#69766d" font-family="Menlo, monospace" font-size="8">{generation['generationId']}</text>
</g>''')
    width = columns * cell_width
    height = rows * cell_height
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" data-route="{REQUESTED_ROUTE}" data-effective-route="{EFFECTIVE_ROUTE}">
<rect width="100%" height="100%" fill="#050806"/>
{''.join(cells)}
</svg>'''


def initial_receipt(args, strengths: list[float], model_dir: Path, atlas_dir: Path) -> dict:
    return {
        "schema": SCHEMA,
        "status": "running",
        "phase": "source_validation",
        "lastTrustworthyEvidence": "receipt_initialized",
        "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
        "requestedConfig": {
            "modelRunDir": str(model_dir.resolve()),
            "atlasDir": str(atlas_dir.resolve()),
            "strengths": strengths,
            "samplesPerStrength": args.samples_per_strength,
            "seed": args.seed,
            "copyThreshold": args.copy_threshold,
            "columns": args.columns,
        },
        "sourceModel": {"receiptHash": None, "checkpointHash": None, "receiptMaskDecode": None},
        "sourceAtlas": {"receiptHash": None, "basinsHash": None, "assignmentsHash": None, "contactSheetHash": None},
        "falseClosureGuards": {
            "modelRouteValidated": False,
            "checkpointValidated": False,
            "atlasRouteValidated": False,
            "atlasArtifactsValidated": False,
            "corpusIndexesValidated": False,
            "modelAtlasCorporaAligned": False,
            "allBasinsConsumed": False,
            "generatedFieldCount": 0,
            "contactSheetRasterWritten": False,
            "historicalMaskDecodeDiscrepancyRecorded": False,
        },
    }


def main() -> int:
    args = parse_args()
    model_dir = Path(args.model_run_dir).resolve()
    atlas_dir = Path(args.atlas_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        strengths = parse_strengths(args.strengths)
        if 0.0 not in strengths:
            raise ValueError("strengths must include zero")
        if args.samples_per_strength <= 0 or args.columns <= 0:
            raise ValueError("samples-per-strength and columns must be positive")
    except Exception as error:
        write_json(out_dir / "receipt.json", {
            "schema": SCHEMA,
            "status": "failed",
            "phase": "invocation_validation",
            "failurePhase": "invocation_validation",
            "lastTrustworthyEvidence": "invocation_arguments_parsed",
            "routeIdentity": {"requestedRoute": REQUESTED_ROUTE, "effectiveRoute": EFFECTIVE_ROUTE},
            "requestedConfig": {
                "modelRunDir": str(model_dir),
                "atlasDir": str(atlas_dir),
                "strengths": args.strengths,
                "samplesPerStrength": args.samples_per_strength,
                "seed": args.seed,
                "copyThreshold": args.copy_threshold,
                "columns": args.columns,
            },
            "errorMessage": str(error),
        })
        print(str(error), file=sys.stderr)
        return 1
    generated_dir = out_dir / "generated"
    generated_dir.mkdir(exist_ok=True)
    receipt_path = out_dir / "receipt.json"
    receipt = initial_receipt(args, strengths, model_dir, atlas_dir)
    write_json(receipt_path, receipt)
    model_support = load_module("lirm_silhouette_latent_model", MODEL_PATH)
    atlas_support = load_module("lirm_silhouette_morphology_basin_atlas", ATLAS_PATH)

    try:
        model_receipt_path = model_dir / "receipt.json"
        model_receipt = json.loads(model_receipt_path.read_text())
        receipt["sourceModel"]["receiptHash"] = sha256_bytes(model_receipt_path.read_bytes())
        if model_receipt.get("schema") != model_support.SCHEMA or model_receipt.get("status") != "complete" or model_receipt.get("phase") != "witness_written":
            raise ValueError("source model is not a completed silhouette latent-model witness")
        if model_receipt.get("routeIdentity", {}).get("effectiveRoute") != model_support.MLX_ROUTE:
            raise ValueError("source model effective route is not the MLX convolutional SDF VAE")
        receipt["falseClosureGuards"]["modelRouteValidated"] = True
        model_config = model_receipt.get("effectiveConfig", {})
        if model_config.get("normalization") != NORMALIZATION:
            raise ValueError(f"unsupported model normalization {model_config.get('normalization')!r}")
        receipt["sourceModel"]["receiptMaskDecode"] = model_config.get("maskDecode")
        receipt["sourceModel"]["effectiveMaskDecode"] = MASK_DECODE
        receipt["sourceModel"]["maskDecodeDiscrepancy"] = {
            "present": model_config.get("maskDecode") != MASK_DECODE,
            "explanation": "The checkpoint receipt predates the corrected positive-inside SDF witness contract; this route decodes the corpus convention directly.",
        }
        receipt["falseClosureGuards"]["historicalMaskDecodeDiscrepancyRecorded"] = True

        checkpoint_path = model_dir / "checkpoint" / "model.safetensors"
        if not checkpoint_path.is_file():
            raise FileNotFoundError(f"missing source checkpoint {checkpoint_path}")
        receipt["sourceModel"]["checkpointHash"] = sha256_bytes(checkpoint_path.read_bytes())
        receipt["falseClosureGuards"]["checkpointValidated"] = True

        atlas_receipt_path = atlas_dir / "receipt.json"
        atlas_receipt = json.loads(atlas_receipt_path.read_text())
        receipt["sourceAtlas"]["receiptHash"] = sha256_bytes(atlas_receipt_path.read_bytes())
        if atlas_receipt.get("schema") != atlas_support.SCHEMA or atlas_receipt.get("status") != "complete" or atlas_receipt.get("phase") != "witness_written":
            raise ValueError("source atlas is not a completed morphology-basin witness")
        if atlas_receipt.get("routeIdentity", {}).get("effectiveRoute") != atlas_support.EFFECTIVE_ROUTE:
            raise ValueError("source atlas effective route is unexpected")
        receipt["falseClosureGuards"]["atlasRouteValidated"] = True
        artifacts = atlas_receipt.get("artifacts", {})
        basins_path = validate_artifact(atlas_dir, artifacts.get("basins", {}))
        assignments_path = validate_artifact(atlas_dir, artifacts.get("assignments", {}))
        contact_sheet_path = validate_artifact(atlas_dir, artifacts.get("contactSheet", {}))
        receipt["sourceAtlas"].update({
            "basinsHash": sha256_bytes(basins_path.read_bytes()),
            "assignmentsHash": sha256_bytes(assignments_path.read_bytes()),
            "contactSheetHash": sha256_bytes(contact_sheet_path.read_bytes()),
        })
        receipt["falseClosureGuards"]["atlasArtifactsValidated"] = True

        basins = json.loads(basins_path.read_text()).get("basins", [])
        if len(basins) != int(atlas_receipt.get("basinCount", -1)):
            raise ValueError("atlas basin count does not match basins artifact")
        atlas_corpora = atlas_receipt.get("sourceCorpora", [])
        validate_model_atlas_corpora(model_receipt.get("corpora", []), atlas_corpora)
        receipt["falseClosureGuards"]["modelAtlasCorporaAligned"] = True
        corpus_sources, training_masks, training_rows = load_source_assets(atlas_corpora, model_support)
        receipt["falseClosureGuards"]["corpusIndexesValidated"] = True
        if len(training_rows) != int(atlas_receipt.get("acceptedSourceRowCount", -1)):
            raise ValueError("atlas accepted source count does not match loaded corpus rows")

        records, _corpora, _source_rows = atlas_support.load_corpora([
            Path(item["path"]) for item in atlas_corpora
        ])
        descriptors = [record["descriptor"] for record in records]
        eligible_descriptors = [
            descriptor for descriptor in descriptors if descriptor["atlasEligibility"]["eligible"]
        ]
        mean, scale = descriptor_standardizer(eligible_descriptors)
        representative_vectors = []
        sources = []
        for basin in basins:
            shape_id = basin["medoidShapeId"]
            source = corpus_sources.get(shape_id)
            if source is None:
                raise ValueError(f"atlas medoid {shape_id} is absent from source corpora")
            descriptor = atlas_support.describe_silhouette(source["mask"])
            representative_vectors.append((descriptor["vector"] - mean) / scale)
            sources.append(source)
        representative_vectors = np.stack(representative_vectors)

        dimensions = model_config.get("inputShape")
        if not isinstance(dimensions, list) or len(dimensions) != 3 or int(dimensions[2]) != 1 or int(dimensions[0]) != int(dimensions[1]):
            raise ValueError(f"invalid source model input shape {dimensions!r}")
        height, width, _ = map(int, dimensions)
        latent_dim = int(model_config.get("latentDim", 0))
        channels = [int(value) for value in model_config.get("channels", [])]
        copy_threshold = float(args.copy_threshold if args.copy_threshold is not None else model_receipt.get("requestedConfig", {}).get("copyThreshold", 0.94))
        expected_generations = len(basins) * (1 + (len(strengths) - 1) * args.samples_per_strength)
        receipt["phase"] = "mlx_posterior_decode"
        receipt["effectiveConfig"] = {
            "strengths": strengths,
            "samplesPerStrength": args.samples_per_strength,
            "seed": args.seed,
            "copyThreshold": copy_threshold,
            "inputShape": dimensions,
            "latentDim": latent_dim,
            "channels": channels,
            "normalization": NORMALIZATION,
            "maskDecode": MASK_DECODE,
            "expectedGenerationCount": expected_generations,
        }
        receipt["lastTrustworthyEvidence"] = "model_atlas_and_corpus_sources_validated"
        write_json(receipt_path, receipt)

        import mlx.core as mx

        vae = model_support.build_mlx_vae(height, latent_dim, channels)
        vae.load_weights(str(checkpoint_path))
        mx.eval(vae.parameters())
        generations = []
        masks = []
        for basin, source in zip(basins, sources):
            if (source["height"], source["width"]) != (height, width):
                raise ValueError(f"basin source dimensions differ for {source['shapeId']}")
            sdf = model_support.read_sdf(Path(source["sdfPath"]), width, height)
            scale_factor = max(1.0, max(width, height) * 0.25)
            tensor = np.clip(sdf / scale_factor, -1.0, 1.0).astype(np.float32)
            mu_mx, logvar_mx = vae.encode(mx.array(tensor[None, ..., None]))
            mx.eval(mu_mx, logvar_mx)
            mu = np.array(mu_mx)[0].astype(np.float32)
            std = np.exp(0.5 * np.array(logvar_mx)[0]).astype(np.float32)
            perturbations = posterior_perturbations(
                mu,
                std,
                strengths,
                args.samples_per_strength,
                args.seed + int(basin["basinIndex"]) * 1009,
            )
            latent_batch = np.stack([item["latent"] for item in perturbations])
            decoded = vae.decode(mx.array(latent_batch))
            mx.eval(decoded)
            fields = np.array(decoded)[..., 0]
            reconstruction_mask = model_support.decode_sdf_mask(fields[0])
            for perturbation, field in zip(perturbations, fields):
                basin_index = int(basin["basinIndex"])
                strength_token = f"{perturbation['strength']:.2f}".replace(".", "p")
                generation_id = f"basin-{basin_index:02d}-s{strength_token}-n{perturbation['sampleIndex']:02d}"
                mask = model_support.decode_sdf_mask(field)
                usability = model_support.mask_usability_assay(mask)
                escape = source_escape_assay(mask, source["mask"], training_masks, copy_threshold)
                reconstruction_similarity = reference_similarity_assay(
                    mask,
                    reconstruction_mask,
                    copy_threshold,
                )
                latent_delta = perturbation["latent"] - mu
                standardized_delta = latent_delta / np.maximum(std, np.float32(1e-8))
                classification = None
                descriptor_error = None
                try:
                    generated_descriptor = atlas_support.describe_silhouette(mask)
                    standardized = (generated_descriptor["vector"] - mean) / scale
                    classification = classify_basin(standardized, representative_vectors)
                except ValueError as error:
                    descriptor_error = str(error)
                target_retained = classification is not None and classification["basinIndex"] == basin_index
                mask_path = generated_dir / f"{generation_id}.pgm"
                field_path = generated_dir / f"{generation_id}.f32"
                model_support.write_pgm(mask_path, mask)
                field.astype("<f4").tofile(field_path)
                nearest_index = escape["nearestTraining"]["index"]
                nearest_row = training_rows[nearest_index]
                generation = {
                    "generationId": generation_id,
                    "mode": "posterior-reconstruction" if perturbation["strength"] == 0 else "posterior-perturbation",
                    "sourceBasinIndex": basin_index,
                    "sourceShapeId": source["shapeId"],
                    "sourceCorpusIndex": source["corpusIndex"],
                    "sourceRowIndex": source["rowIndex"],
                    "strength": perturbation["strength"],
                    "sampleIndex": perturbation["sampleIndex"],
                    "sourceTensorHash": model_support.tensor_hash(tensor),
                    "posteriorMuHash": tensor_hash(mu),
                    "posteriorStdHash": tensor_hash(std),
                    "posteriorStd": {
                        "minimum": round(float(std.min()), 6),
                        "mean": round(float(std.mean()), 6),
                        "maximum": round(float(std.max()), 6),
                    },
                    "latentHash": perturbation["latentHash"],
                    "latentDeltaRms": round(float(np.sqrt(np.mean(np.square(latent_delta)))), 6),
                    "posteriorStandardizedDeltaRms": round(float(np.sqrt(np.mean(np.square(standardized_delta)))), 6),
                    "maskHash": sha256_bytes(mask.tobytes()),
                    "signedDistanceHash": tensor_hash(field),
                    "sourceEscapeAssay": escape,
                    "reconstructionSimilarityAssay": reconstruction_similarity,
                    "nearestTrainingSource": {
                        "shapeId": nearest_row["shapeId"],
                        "corpusIndex": nearest_row["corpusIndex"],
                        "rowIndex": nearest_row["rowIndex"],
                    },
                    "usabilityAssay": usability,
                    "basinClassification": classification,
                    "descriptorError": descriptor_error,
                    "targetBasinRetained": bool(target_retained),
                    "acceptedForDownstream": bool(usability["usable"] and not escape["nearestTraining"]["copied"]),
                    "maskPath": f"generated/{generation_id}.pgm",
                    "signedDistancePath": f"generated/{generation_id}.f32",
                }
                generations.append(generation)
                masks.append(mask)
                receipt["falseClosureGuards"]["generatedFieldCount"] += 1
            receipt["lastTrustworthyEvidence"] = f"decoded_through_basin_{int(basin['basinIndex']):02d}"
            write_json(receipt_path, receipt)

        svg_path = out_dir / "contact-sheet.svg"
        png_path = out_dir / "contact-sheet.png"
        svg_path.write_text(render_contact_sheet(generations, masks, args.columns, atlas_support))
        model_support.rasterize_svg(svg_path, png_path)
        nonzero_generations = [item for item in generations if item["strength"] > 0]
        strength_summaries = []
        for strength in strengths:
            cohort = [item for item in generations if item["strength"] == strength]
            strength_summaries.append({
                "strength": strength,
                "sampleCount": len(cohort),
                "targetBasinRetentionFraction": round(sum(item["targetBasinRetained"] for item in cohort) / max(1, len(cohort)), 6),
                "meanSourceSimilarity": round(float(np.mean([item["sourceEscapeAssay"]["source"]["similarity"] for item in cohort])), 6),
                "meanReconstructionSimilarity": round(float(np.mean([item["reconstructionSimilarityAssay"]["similarity"] for item in cohort])), 6),
                "reconstructionEscapeFraction": round(sum(item["reconstructionSimilarityAssay"]["escaped"] for item in cohort) / max(1, len(cohort)), 6),
                "usableFraction": round(sum(item["usabilityAssay"]["usable"] for item in cohort) / max(1, len(cohort)), 6),
                "acceptedFraction": round(sum(item["acceptedForDownstream"] for item in cohort) / max(1, len(cohort)), 6),
            })
        receipt.update({
            "status": "complete",
            "phase": "witness_written",
            "lastTrustworthyEvidence": "contact_sheet_raster_written",
            "sourceBasinCount": len(basins),
            "generatedSampleCount": len(generations),
            "acceptedSampleCount": sum(item["acceptedForDownstream"] for item in generations),
            "targetBasinRetention": {
                "all": round(sum(item["targetBasinRetained"] for item in generations) / max(1, len(generations)), 6),
                "perturbed": round(sum(item["targetBasinRetained"] for item in nonzero_generations) / max(1, len(nonzero_generations)), 6),
            },
            "sourceEscape": {
                "all": round(sum(item["sourceEscapeAssay"]["escapedSource"] for item in generations) / max(1, len(generations)), 6),
                "perturbed": round(sum(item["sourceEscapeAssay"]["escapedSource"] for item in nonzero_generations) / max(1, len(nonzero_generations)), 6),
            },
            "strengthSummaries": strength_summaries,
            "artifacts": {
                "contactSheet": {"path": "contact-sheet.png", "sha256": sha256_bytes(png_path.read_bytes()), "bytes": png_path.stat().st_size},
                "contactSheetSvg": {"path": "contact-sheet.svg", "sha256": sha256_bytes(svg_path.read_bytes())},
            },
            "generations": generations,
        })
        receipt["falseClosureGuards"].update({
            "allBasinsConsumed": len({item["sourceBasinIndex"] for item in generations}) == len(basins),
            "contactSheetRasterWritten": True,
        })
        write_json(receipt_path, receipt)
        print(json.dumps({"status": "complete", "receipt": str(receipt_path), "generated": len(generations)}), flush=True)
        return 0
    except Exception as error:
        receipt.update({
            "status": "failed",
            "failurePhase": receipt.get("phase"),
            "errorMessage": str(error),
            "lastTrustworthyEvidence": receipt.get("lastTrustworthyEvidence"),
        })
        write_json(receipt_path, receipt)
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
