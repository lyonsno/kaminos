#!/usr/bin/env python3

import argparse
import copy
import hashlib
import json
import math
import os
import sys
from decimal import Decimal
from pathlib import Path


MODEL_SCHEMA = "kaminos-boundary-splat-phase-destination-state-model-v0"
REPORT_SCHEMA = "kaminos-boundary-splat-phase-destination-state-interpolation-v0"
INPUT_AUTHORITY = "exact-destination-local-grid-plus-selected-donor-state-and-displacement-v0"
OUTPUT_AUTHORITY = "candidate-16-plus-nonposition-splat-9-donor-residual-v0"
ARCHITECTURE_AUTHORITY = "offline-two-layer-relu-destination-state-residual-head-v0"
INTERPOLATION_AUTHORITY = "deterministic-linear-checkpoint-interpolation-v0"
CONSTRUCTION_ROUTE_AUTHORITY = "deterministic-python-checkpoint-interpolation-v0"
EXPECTED_LAYERS = (
    ("destination-state-trunk-a", "relu", 116, 128),
    ("destination-state-trunk-b", "relu", 128, 128),
    ("destination-state-residual-head", "linear", 128, 25),
)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Interpolate compatible deployed destination-state checkpoints."
    )
    parser.add_argument("--from-model", required=True)
    parser.add_argument("--to-model", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--alpha", action="append", required=True, type=float)
    return parser.parse_args(argv)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(document):
    return (json.dumps(
        document,
        indent=2,
        sort_keys=True,
        allow_nan=False,
        separators=(",", ": "),
    ) + "\n").encode("utf-8")


def write_json_atomic(path, document):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = canonical_json_bytes(document)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(data)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return data


def validate_alphas(alphas):
    values = [float(alpha) for alpha in alphas]
    if not values:
        raise ValueError("at least one interpolation alpha is required")
    if any(not math.isfinite(alpha) for alpha in values):
        raise ValueError("interpolation alphas must be finite")
    if any(alpha < 0.0 or alpha > 1.0 for alpha in values):
        raise ValueError("interpolation alphas must lie in the closed interval [0, 1]")
    if len(set(values)) != len(values):
        raise ValueError("interpolation alphas must be unique")
    return values


def receipt_alpha(alpha):
    try:
        numeric = float(alpha)
    except (TypeError, ValueError):
        return repr(alpha)
    return numeric if math.isfinite(numeric) else str(numeric).lower()


def resolve_source_path(path):
    return Path(path).expanduser().resolve()


def source_request(path):
    return {
        "requestedPath": str(path),
        "effectivePath": str(resolve_source_path(path)),
    }


def read_model(path):
    resolved = resolve_source_path(path)
    data = resolved.read_bytes()
    return {
        "path": str(resolved),
        "sha256": sha256_bytes(data),
        "byteCount": len(data),
        "document": json.loads(data),
    }


def require_finite_list(values, expected_count, label, positive=False):
    if not isinstance(values, list) or len(values) != expected_count:
        raise ValueError(f"{label} must contain exactly {expected_count} values")
    normalized = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{label} values must be numeric")
        numeric = float(value)
        if not math.isfinite(numeric):
            raise ValueError(f"{label} values must be finite")
        if positive and numeric <= 0.0:
            raise ValueError(f"{label} values must be positive")
        normalized.append(numeric)
    return normalized


def validate_model(document, label):
    if not isinstance(document, dict):
        raise ValueError(f"{label} model must be a JSON object")
    if document.get("schema") != MODEL_SCHEMA or document.get("status") != "completed":
        raise ValueError(f"{label} model schema/status mismatch")

    route = document.get("route", {})
    if route.get("backend") != "mlx" or route.get("fallbackReason") not in (None, ""):
        raise ValueError(f"{label} model route must be non-fallback MLX")

    input_document = document.get("input", {})
    if (
        input_document.get("authority") != INPUT_AUTHORITY
        or input_document.get("featureCount") != 116
        or input_document.get("destinationLocalGridFeatureCount") != 64
        or input_document.get("selectedDonorAttributeCount") != 25
        or input_document.get("selectedDonorDisplacementCount") != 27
    ):
        raise ValueError(f"{label} model input shape/authority mismatch")
    require_finite_list(input_document.get("mean"), 116, f"{label} input mean")
    require_finite_list(
        input_document.get("scale"), 116, f"{label} input scale", positive=True
    )

    output_document = document.get("output", {})
    if (
        output_document.get("authority") != OUTPUT_AUTHORITY
        or output_document.get("attributeCount") != 25
    ):
        raise ValueError(f"{label} model output shape/authority mismatch")
    require_finite_list(
        output_document.get("residualMean"), 25, f"{label} residual mean"
    )
    require_finite_list(
        output_document.get("residualScale"),
        25,
        f"{label} residual scale",
        positive=True,
    )

    architecture = document.get("architecture", {})
    if architecture.get("authority") != ARCHITECTURE_AUTHORITY:
        raise ValueError(f"{label} model architecture authority mismatch")
    layers = architecture.get("layers")
    if not isinstance(layers, list) or len(layers) != len(EXPECTED_LAYERS):
        raise ValueError(f"{label} model must contain exactly three deployed layers")

    parameter_count = 0
    for index, (layer, expected) in enumerate(zip(layers, EXPECTED_LAYERS)):
        role, activation, input_size, output_size = expected
        if (
            layer.get("role") != role
            or layer.get("activation") != activation
            or layer.get("inputSize") != input_size
            or layer.get("outputSize") != output_size
        ):
            raise ValueError(f"{label} model layer contract mismatch at index {index}")
        weights = require_finite_list(
            layer.get("weights"), input_size * output_size, f"{label} {role} weights"
        )
        bias = require_finite_list(layer.get("bias"), output_size, f"{label} {role} bias")
        parameter_count += len(weights) + len(bias)
    return {"parameterCount": parameter_count}


def layer_contract(layer):
    return {key: value for key, value in layer.items() if key not in ("weights", "bias")}


def validate_compatibility(from_source, to_source):
    if from_source["sha256"] == to_source["sha256"]:
        raise ValueError("checkpoint interpolation requires distinct source model hashes")
    from_document = from_source["document"]
    to_document = to_source["document"]
    for key, label in (
        ("input", "input contract"),
        ("output", "output contract"),
        ("route", "route identity"),
        ("trainingManifest", "training manifest"),
        ("evaluationManifest", "evaluation manifest"),
    ):
        if from_document.get(key) != to_document.get(key):
            raise ValueError(f"source model {label} mismatch")
    from_architecture = from_document["architecture"]
    to_architecture = to_document["architecture"]
    if from_architecture.get("authority") != to_architecture.get("authority"):
        raise ValueError("source model architecture authority mismatch")
    if [layer_contract(layer) for layer in from_architecture["layers"]] != [
        layer_contract(layer) for layer in to_architecture["layers"]
    ]:
        raise ValueError("source model layer contract mismatch")


def interpolate_values(from_values, to_values, alpha):
    if alpha == 0.0:
        return list(from_values)
    if alpha == 1.0:
        return list(to_values)
    complement = 1.0 - alpha
    return [float(from_value) * complement + float(to_value) * alpha
            for from_value, to_value in zip(from_values, to_values)]


def alpha_slug(alpha):
    rendered = format(Decimal(str(alpha)).normalize(), "f")
    return rendered.replace("-", "m").replace(".", "p")


def source_receipt(source):
    return {
        "path": source["path"],
        "sha256": source["sha256"],
        "byteCount": source["byteCount"],
        "schema": source["document"].get("schema"),
        "status": source["document"].get("status"),
    }


def build_interpolated_document(from_source, to_source, alpha, parameter_count):
    from_document = from_source["document"]
    to_document = to_source["document"]
    result = copy.deepcopy(from_document)
    for result_layer, from_layer, to_layer in zip(
        result["architecture"]["layers"],
        from_document["architecture"]["layers"],
        to_document["architecture"]["layers"],
    ):
        result_layer["weights"] = interpolate_values(
            from_layer["weights"], to_layer["weights"], alpha
        )
        result_layer["bias"] = interpolate_values(from_layer["bias"], to_layer["bias"], alpha)

    interpolation = {
        "authority": INTERPOLATION_AUTHORITY,
        "fromModelSha256": from_source["sha256"],
        "toModelSha256": to_source["sha256"],
        "effectiveAlpha": alpha,
        "formula": "from * (1 - alpha) + to * alpha",
        "parameterCount": parameter_count,
        "normalizationInterpolated": False,
        "outputScalingInterpolated": False,
    }
    result["interpolation"] = interpolation
    result["route"]["checkpointConstruction"] = construction_route()
    result["training"] = {
        "authority": INTERPOLATION_AUTHORITY,
        "method": "parameter-space-linear-interpolation",
        "effectiveAlpha": alpha,
        "parameterCount": parameter_count,
        "fromSourceTraining": from_document.get("training"),
        "toSourceTraining": to_document.get("training"),
    }
    result["evaluation"] = {
        "authority": "not-evaluated-checkpoint-interpolation-v0",
        "status": "pending",
    }
    result["claimBoundary"] = (
        "This checkpoint is a deterministic parameter-space interpolation between two "
        "compatible completed MLX destination-state models. It carries no inherited "
        "one-step, recurrent, energy, visual, or runtime acceptance claim."
    )
    return result


def construction_route():
    return {
        "authority": CONSTRUCTION_ROUTE_AUTHORITY,
        "backend": "python-cpu",
        "device": "host-cpu",
        "effectiveRunner": str(Path(sys.executable).resolve()),
        "pythonVersion": sys.version.split()[0],
        "fallbackReason": None,
    }


def endpoint_error(document, source_document):
    maximum = 0.0
    for layer, source_layer in zip(
        document["architecture"]["layers"], source_document["architecture"]["layers"]
    ):
        for key in ("weights", "bias"):
            for value, source_value in zip(layer[key], source_layer[key]):
                maximum = max(maximum, abs(float(value) - float(source_value)))
    return maximum


def run_interpolation(from_model, to_model, alphas, out_dir):
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    stale_outputs = sorted(out_dir.glob("destination-state-model-alpha-*.json"))

    report_path = out_dir / "interpolation-report.json"
    report = {
        "schema": REPORT_SCHEMA,
        "status": "running",
        "failurePhase": None,
        "requestedAlphas": [receipt_alpha(alpha) for alpha in alphas],
        "outputDirectory": str(out_dir),
        "constructionRoute": construction_route(),
        "sourceRequests": {
            "from": source_request(from_model),
            "to": source_request(to_model),
        },
        "staleOutputPaths": [str(path.resolve()) for path in stale_outputs],
        "staleOutputCountRemoved": 0,
        "lastTrustworthyEvidence": {
            "staleOutputCountObserved": len(stale_outputs),
        },
    }
    write_json_atomic(report_path, report)

    phase = "validate-request"
    written_output_paths = []
    try:
        effective_alphas = validate_alphas(alphas)
        report["requestedAlphas"] = effective_alphas

        phase = "remove-stale-outputs"
        for stale_output in stale_outputs:
            stale_output.unlink()
            report["staleOutputCountRemoved"] += 1
        write_json_atomic(report_path, report)

        phase = "read-from-source-model"
        from_source = read_model(from_model)
        report["lastTrustworthyEvidence"] = {
            "from": source_receipt(from_source),
        }
        write_json_atomic(report_path, report)

        phase = "read-to-source-model"
        to_source = read_model(to_model)
        report["lastTrustworthyEvidence"]["to"] = source_receipt(to_source)
        write_json_atomic(report_path, report)

        phase = "validate-source-models"
        from_validation = validate_model(from_source["document"], "from")
        to_validation = validate_model(to_source["document"], "to")
        if from_validation["parameterCount"] != to_validation["parameterCount"]:
            raise ValueError("source model parameter count mismatch")
        parameter_count = from_validation["parameterCount"]

        phase = "validate-source-compatibility"
        validate_compatibility(from_source, to_source)

        phase = "build-output-models"
        pending_outputs = []
        for alpha in effective_alphas:
            document = build_interpolated_document(
                from_source, to_source, alpha, parameter_count
            )
            validate_model(document, f"alpha {alpha}")
            endpoint_source = None
            if alpha == 0.0:
                endpoint_source = from_source["document"]
            elif alpha == 1.0:
                endpoint_source = to_source["document"]
            endpoint_max_error = (
                endpoint_error(document, endpoint_source) if endpoint_source is not None else None
            )
            if endpoint_max_error not in (None, 0.0):
                raise ValueError(f"alpha {alpha} failed exact endpoint parameter reproduction")
            pending_outputs.append((alpha, document, endpoint_max_error))

        phase = "write-output-models"
        outputs = []
        for alpha, document, endpoint_max_error in pending_outputs:
            output_path = out_dir / f"destination-state-model-alpha-{alpha_slug(alpha)}.json"
            data = write_json_atomic(output_path, document)
            written_output_paths.append(output_path)
            outputs.append({
                "alpha": alpha,
                "path": str(output_path),
                "sha256": sha256_bytes(data),
                "byteCount": len(data),
                "parameterCount": parameter_count,
                "maxAbsEndpointParameterError": endpoint_max_error,
            })

        report.update({
            "status": "completed",
            "failurePhase": None,
            "authority": INTERPOLATION_AUTHORITY,
            "sources": {
                "from": source_receipt(from_source),
                "to": source_receipt(to_source),
            },
            "parameterCount": parameter_count,
            "outputs": outputs,
            "lastTrustworthyEvidence": {
                "sourceCompatibility": "exact",
                "writtenOutputCount": len(outputs),
            },
        })
        write_json_atomic(report_path, report)
        return report
    except Exception as error:
        removed_partial_outputs = 0
        partial_cleanup_errors = []
        for output_path in written_output_paths:
            if output_path.exists():
                try:
                    output_path.unlink()
                    removed_partial_outputs += 1
                except OSError as cleanup_error:
                    partial_cleanup_errors.append({
                        "path": str(output_path),
                        "error": f"{type(cleanup_error).__name__}: {cleanup_error}",
                    })
        report.update({
            "status": "failed",
            "failurePhase": phase,
            "error": f"{type(error).__name__}: {error}",
            "removedPartialOutputCount": removed_partial_outputs,
            "partialCleanupErrors": partial_cleanup_errors,
        })
        write_json_atomic(report_path, report)
        raise


def main(argv=None):
    args = parse_args(argv)
    try:
        report = run_interpolation(
            args.from_model,
            args.to_model,
            args.alpha,
            args.out_dir,
        )
    except Exception as error:
        print(f"checkpoint interpolation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
