import math


EMITTER_LIFECYCLE_CONDITION_IDENTITY = "boundary-splat-emitter-lifecycle-conditioning-v0"
EMITTER_LIFECYCLE_CONDITION_AUTHORITY = "effective-runtime-controls-frozen-sim-state-v0"
EMITTER_LIFECYCLE_CONDITION_ORDER = (
    "inputRadius",
    "flowRate",
    "fireScale",
    "reactionFuelScale",
    "lifecycleSnuff",
    "lifecycleT",
    "quenchVapor",
)
EMITTER_LIFECYCLE_CONDITION_NORMALIZATION = {
    "inputRadius": {"kind": "offset-rational", "lower": 0.04, "scale": 0.66},
    "flowRate": {"kind": "offset-rational", "lower": 0.0, "scale": 2.5},
    "fireScale": {"kind": "bounded-linear", "lower": 0.35, "upper": 1.3},
    "reactionFuelScale": {"kind": "bounded-linear", "lower": 0.0, "upper": 1.5},
    "lifecycleT": {"kind": "bounded-linear", "lower": 0.0, "upper": 1.0},
    "quenchVapor": {"kind": "bounded-linear", "lower": 0.0, "upper": 2.0},
}


def _normalized(value, specification, label):
    numeric = float(value)
    lower = specification["lower"]
    if not math.isfinite(numeric) or numeric < lower:
        raise ValueError(f"{label} must be finite and at least {lower}")
    if specification["kind"] == "offset-rational":
        shifted = numeric - lower
        return shifted / (shifted + specification["scale"])
    upper = specification["upper"]
    if numeric > upper:
        raise ValueError(f"{label} must be at most {upper}")
    return (numeric - lower) / (upper - lower)


def resolve_emitter_lifecycle_condition(frame, label):
    conditioning = frame.get("controlConditioning")
    if not isinstance(conditioning, dict):
        raise ValueError(f"{label} control conditioning is missing")
    if conditioning.get("identity") != EMITTER_LIFECYCLE_CONDITION_IDENTITY:
        raise ValueError(f"{label} control conditioning identity is invalid")
    if conditioning.get("authority") != EMITTER_LIFECYCLE_CONDITION_AUTHORITY:
        raise ValueError(f"{label} control conditioning authority is invalid")
    if conditioning.get("sameStateCaptureId") != frame.get("sameStateCaptureId"):
        raise ValueError(f"{label} control conditioning same-state identity does not match the frame")
    if conditioning.get("simStepCount") != frame.get("simStepCount"):
        raise ValueError(f"{label} control conditioning simulator step does not match the frame")
    values = conditioning.get("values")
    if not isinstance(values, dict):
        raise ValueError(f"{label} control conditioning values are missing")
    lifecycle_effect = values.get("lifecycleEffect")
    if lifecycle_effect not in ("none", "snuff"):
        raise ValueError(f"{label} lifecycleEffect must be none or snuff")
    normalized = {
        name: _normalized(values.get(name), specification, f"{label} {name}")
        for name, specification in EMITTER_LIFECYCLE_CONDITION_NORMALIZATION.items()
    }
    normalized["lifecycleSnuff"] = 1.0 if lifecycle_effect == "snuff" else 0.0
    return tuple(normalized[name] for name in EMITTER_LIFECYCLE_CONDITION_ORDER)
