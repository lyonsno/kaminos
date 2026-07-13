from pathlib import Path

import mlx.core as mx

from mlx_vlm.utils import get_model_path, load_model as load_mlx_vlm_model


def flatten(obj, prefix=""):
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield from flatten(value, f"{prefix}.{key}" if prefix else key)
    elif isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            yield from flatten(value, f"{prefix}.{index}" if prefix else str(index))
    else:
        yield prefix, obj


def checkpoint_parameter_audit(model, checkpoint: dict) -> dict:
    parameters = dict(flatten(model.parameters()))
    matched = set(checkpoint).intersection(parameters)
    shape_matches = {
        key for key in matched if tuple(checkpoint[key].shape) == tuple(parameters[key].shape)
    }
    checkpoint_dtypes = {}
    for value in checkpoint.values():
        dtype = str(value.dtype)
        checkpoint_dtypes[dtype] = checkpoint_dtypes.get(dtype, 0) + 1
    audit = {
        "schema": "kaminos.sam3-mlx-checkpoint-parameter-audit.v0",
        "checkpointTensorCount": len(checkpoint),
        "modelParameterCount": len(parameters),
        "exactNameMatchCount": len(matched),
        "shapeMatchCount": len(shape_matches),
        "checkpointCoverage": len(shape_matches) / max(len(checkpoint), 1),
        "modelCoverage": len(shape_matches) / max(len(parameters), 1),
        "checkpointDtypes": checkpoint_dtypes,
        "effectiveComputeDtype": "float32",
    }
    if len(shape_matches) != len(checkpoint) or len(shape_matches) != len(parameters):
        raise ValueError(
            "SAM3 checkpointParameterAudit failed: "
            f"checkpoint={len(checkpoint)} model={len(parameters)} exact={len(matched)} shape={len(shape_matches)}"
        )
    return audit


def load_sam3_model(model_id: str):
    model_path = Path(get_model_path(model_id))
    config_path = model_path / "config.json"
    if not config_path.exists():
        raise FileNotFoundError(f"SAM3 model config not found: {config_path}")
    weights_path = model_path / "model.safetensors"
    if not weights_path.exists():
        raise FileNotFoundError(f"SAM3 model weights not found: {weights_path}")
    checkpoint = mx.load(str(weights_path))
    model = load_mlx_vlm_model(model_path)
    audit = checkpoint_parameter_audit(model, checkpoint)
    model.set_dtype(mx.float32)
    mx.eval(model.parameters())
    return model, model_path, weights_path, audit
