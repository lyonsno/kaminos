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
EMITTER_LIFECYCLE_CONDITION_RANGES = {
    "inputRadius": (0.08, 0.7),
    "flowRate": (0.0, 2.5),
    "fireScale": (0.35, 1.3),
    "reactionFuelScale": (0.0, 1.5),
    "lifecycleT": (0.0, 1.0),
    "quenchVapor": (0.0, 2.0),
}


def _normalized(value, lower, upper, label):
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < lower or numeric > upper:
        raise ValueError(f"{label} must be finite within {lower}..{upper}")
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
        name: _normalized(values.get(name), *bounds, f"{label} {name}")
        for name, bounds in EMITTER_LIFECYCLE_CONDITION_RANGES.items()
    }
    normalized["lifecycleSnuff"] = 1.0 if lifecycle_effect == "snuff" else 0.0
    return tuple(normalized[name] for name in EMITTER_LIFECYCLE_CONDITION_ORDER)
