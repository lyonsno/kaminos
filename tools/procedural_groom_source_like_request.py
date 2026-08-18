"""Pure request resolution for source-like procedural-groom renders."""

from __future__ import annotations

import math
from typing import Any


BASELINE_LENGTHS = {
    "short": 0.065,
    "puffy": 0.19,
    "ruff": 0.34,
}


def _multiplier_token(value: float) -> str:
    return format(value, "g").replace(".", "p")


def resolve_groom_request(request: dict[str, Any]) -> dict[str, Any]:
    density = request.get("densityMultiplier")
    if isinstance(density, bool) or not isinstance(density, int) or density < 1:
        raise ValueError("densityMultiplier must be a positive integer")
    ruff_multiplier = request.get("ruffLengthMultiplier", 1.0)
    if (
        isinstance(ruff_multiplier, bool)
        or not isinstance(ruff_multiplier, (int, float))
        or not math.isfinite(float(ruff_multiplier))
        or float(ruff_multiplier) <= 0
    ):
        raise ValueError("ruffLengthMultiplier must be a positive finite number")
    ruff_multiplier = float(ruff_multiplier)
    effective = dict(BASELINE_LENGTHS)
    effective["ruff"] *= ruff_multiplier
    suffix = f"density-{density}x"
    if not math.isclose(ruff_multiplier, 1.0):
        suffix += f"-ruff-length-{_multiplier_token(ruff_multiplier)}x"
    return {
        "densityMultiplier": density,
        "ruffLengthMultiplier": ruff_multiplier,
        "baselineLengths": dict(BASELINE_LENGTHS),
        "effectiveLengths": effective,
        "observationSuffix": suffix,
    }
