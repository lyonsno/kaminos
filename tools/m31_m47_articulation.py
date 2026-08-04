"""Deterministic geometry helpers for the bounded M31/M47 articulation witness."""

from __future__ import annotations

import copy
import math
from typing import Any, Iterable, Sequence


EPSILON = 1e-12


class EligibilityError(ValueError):
    """The selected route is outside the canonical procedural witness class."""


def advance_failure_receipt(
    receipt: dict[str, Any],
    *,
    phase: str | None,
    evidence: str,
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Advance a failure receipt without discarding previously established facts."""

    receipt["failurePhase"] = phase
    receipt["lastTrustworthyEvidence"] = evidence
    if identity:
        receipt.update(copy.deepcopy(identity))
    return receipt


def _truthy_manual_marker(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    marker_names = {
        "manualOffset",
        "manual_offset",
        "manuallyDisplaced",
        "manually_displaced",
        "operatorDisplaced",
        "operator_displaced",
    }
    for key, item in value.items():
        if key in marker_names and bool(item):
            return True
        if isinstance(item, dict) and _truthy_manual_marker(item):
            return True
        if isinstance(item, list) and any(_truthy_manual_marker(entry) for entry in item):
            return True
    return False


def route_eligibility(
    fixture: dict[str, Any],
    construction_ids: Sequence[str],
) -> dict[str, Any]:
    """Admit only complete source-mesh-to-source-mesh procedural routes."""

    routes = {
        route.get("constructionId"): route
        for route in fixture.get("conditions", {}).get("correct", {}).get("routes", [])
    }
    selected: list[dict[str, Any]] = []
    for construction_id in construction_ids:
        route = routes.get(construction_id)
        if route is None:
            raise EligibilityError(f"selected construction {construction_id} is missing")
        if route.get("endpointRoute") != "draw_muscle":
            raise EligibilityError(f"{construction_id} is not a draw_muscle construction")
        if route.get("completenessAuthority") != "declared_components_present":
            raise EligibilityError(f"{construction_id} is not component-complete")
        if _truthy_manual_marker(route):
            raise EligibilityError(f"{construction_id} carries a manual offset marker")
        for endpoint_name in ("origin", "insertion"):
            endpoint = route.get(endpoint_name, {})
            if endpoint.get("sourceAuthority") != "source_mesh":
                raise EligibilityError(
                    f"{construction_id} {endpoint_name} must have source_mesh authority"
                )
            source_name = str(endpoint.get("sourceName", ""))
            if not source_name or source_name.lower().startswith("muscle "):
                raise EligibilityError(
                    f"{construction_id} {endpoint_name} cannot depend on a muscle surface"
                )
        selected.append(route)

    support_families = [
        [route["origin"]["sourceName"], route["insertion"]["sourceName"]]
        for route in selected
    ]
    if not support_families or any(family != support_families[0] for family in support_families[1:]):
        raise EligibilityError("selected routes do not share one ordered support family")
    if support_families[0][0] == support_families[0][1]:
        raise EligibilityError("selected routes are same-support nulls, not articulation routes")

    return {
        "status": "eligible",
        "constructionIds": list(construction_ids),
        "supportFamily": support_families[0],
        "authority": "canonical-support-to-support-procedural-route-v0",
    }


def _add(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [float(a[index]) + float(b[index]) for index in range(3)]


def _sub(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [float(a[index]) - float(b[index]) for index in range(3)]


def _mul(a: Sequence[float], scalar: float) -> list[float]:
    return [float(value) * scalar for value in a]


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(float(a[index]) * float(b[index]) for index in range(3))


def _cross(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def _length(a: Sequence[float]) -> float:
    return math.sqrt(_dot(a, a))


def _normalize(a: Sequence[float]) -> list[float]:
    magnitude = _length(a)
    if magnitude <= EPSILON:
        raise ValueError("axis or tangent cannot be zero length")
    return [float(value) / magnitude for value in a]


def _smoothstep(value: float) -> float:
    bounded = min(1.0, max(0.0, value))
    return bounded * bounded * (3.0 - 2.0 * bounded)


def _rotate_vector(vector: Sequence[float], axis: Sequence[float], angle: float) -> list[float]:
    unit = _normalize(axis)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    return _add(
        _add(_mul(vector, cosine), _mul(_cross(unit, vector), sine)),
        _mul(unit, _dot(unit, vector) * (1.0 - cosine)),
    )


def rotate_about_axis(
    point: Sequence[float],
    *,
    pivot: Sequence[float],
    axis: Sequence[float],
    angle_radians: float,
) -> list[float]:
    """Rotate a point around an explicit caller-authored world-space hinge."""

    if abs(angle_radians) <= EPSILON:
        return [float(value) for value in point]
    return _add(pivot, _rotate_vector(_sub(point, pivot), axis, angle_radians))


def _center(section: Sequence[Sequence[float]]) -> list[float]:
    if not section:
        raise ValueError("ring section cannot be empty")
    return [sum(float(point[axis]) for point in section) / len(section) for axis in range(3)]


def _tangents(centers: Sequence[Sequence[float]]) -> list[list[float]]:
    if len(centers) < 2:
        raise ValueError("at least two ring sections are required")
    result = []
    for index in range(len(centers)):
        if index == 0:
            delta = _sub(centers[1], centers[0])
        elif index == len(centers) - 1:
            delta = _sub(centers[-1], centers[-2])
        else:
            delta = _sub(centers[index + 1], centers[index - 1])
        result.append(_normalize(delta))
    return result


def _rotation_between(vector_from: Sequence[float], vector_to: Sequence[float]) -> tuple[list[float], float]:
    first = _normalize(vector_from)
    second = _normalize(vector_to)
    cosine = min(1.0, max(-1.0, _dot(first, second)))
    if cosine > 1.0 - EPSILON:
        return [1.0, 0.0, 0.0], 0.0
    if cosine < -1.0 + EPSILON:
        candidate = _cross(first, [1.0, 0.0, 0.0])
        if _length(candidate) <= EPSILON:
            candidate = _cross(first, [0.0, 1.0, 0.0])
        return _normalize(candidate), math.pi
    axis = _normalize(_cross(first, second))
    return axis, math.acos(cosine)


def _path_length(centers: Sequence[Sequence[float]]) -> float:
    return sum(_length(_sub(current, previous)) for previous, current in zip(centers, centers[1:]))


def _volume_proxy(sections: Sequence[Sequence[Sequence[float]]]) -> float:
    centers = [_center(section) for section in sections]
    mean_radius_squared = sum(
        _dot(_sub(point, center), _sub(point, center))
        for section, center in zip(sections, centers)
        for point in section
    ) / sum(len(section) for section in sections)
    return math.pi * mean_radius_squared * _path_length(centers)


def deform_ring_sections(
    sections: Sequence[Sequence[Sequence[float]]],
    *,
    origin: Sequence[float],
    insertion: Sequence[float],
    posed_insertion: Sequence[float],
) -> dict[str, Any]:
    """Transport a constant-topology muscle from a fixed to moving support.

    The neutral centerline and cross-section profiles are retained. A smooth
    displacement field carries the insertion end, tangent frames rotate with
    the changed centerline, and radial scale compensates for path-length change.
    Endpoint rings stay unscaled so attachment footprints remain stable.
    """

    source_sections = [
        [[float(coordinate) for coordinate in point] for point in section]
        for section in sections
    ]
    if len(source_sections) < 2 or any(not section for section in source_sections):
        raise ValueError("at least two non-empty ring sections are required")
    if any(len(section) != len(source_sections[0]) for section in source_sections):
        raise ValueError("all ring sections must have equal profile counts")

    neutral_insertion = [float(value) for value in insertion]
    moving_insertion = [float(value) for value in posed_insertion]
    fixed_origin = [float(value) for value in origin]
    insertion_delta = _sub(moving_insertion, neutral_insertion)
    if _length(insertion_delta) <= EPSILON:
        return {
            "sections": copy.deepcopy(source_sections),
            "origin": fixed_origin,
            "insertion": moving_insertion,
            "radialScale": 1.0,
            "neutralPathLength": _path_length([_center(section) for section in source_sections]),
            "posedPathLength": _path_length([_center(section) for section in source_sections]),
            "volumeProxy": _volume_proxy(source_sections),
        }

    neutral_centers = [_center(section) for section in source_sections]
    last_index = len(neutral_centers) - 1
    posed_centers = [
        _add(center, _mul(insertion_delta, _smoothstep(index / last_index)))
        for index, center in enumerate(neutral_centers)
    ]
    neutral_length = _path_length(neutral_centers)
    posed_length = _path_length(posed_centers)
    if neutral_length <= EPSILON or posed_length <= EPSILON:
        raise ValueError("muscle centerline length must remain positive")
    neutral_tangents = _tangents(neutral_centers)
    posed_tangents = _tangents(posed_centers)
    neutral_volume = _volume_proxy(source_sections)

    def build_sections(interior_scale: float) -> list[list[list[float]]]:
        result: list[list[list[float]]] = []
        for index, (section, neutral_center, posed_center) in enumerate(
            zip(source_sections, neutral_centers, posed_centers)
        ):
            if index == 0:
                result.append(copy.deepcopy(section))
                continue
            axis, angle = _rotation_between(neutral_tangents[index], posed_tangents[index])
            attachment_weight = math.sin(math.pi * index / last_index) ** 2
            section_scale = 1.0 + attachment_weight * (interior_scale - 1.0)
            posed_section = []
            for point in section:
                offset = _sub(point, neutral_center)
                rotated = _rotate_vector(offset, axis, angle) if angle else offset
                posed_section.append(_add(posed_center, _mul(rotated, section_scale)))
            result.append(posed_section)
        return result

    lower_scale = 0.2
    upper_scale = 3.0
    lower_sections = build_sections(lower_scale)
    upper_sections = build_sections(upper_scale)
    if _volume_proxy(lower_sections) >= neutral_volume:
        radial_scale = lower_scale
        posed_sections = lower_sections
    elif _volume_proxy(upper_sections) <= neutral_volume:
        radial_scale = upper_scale
        posed_sections = upper_sections
    else:
        posed_sections = upper_sections
        radial_scale = upper_scale
        for _ in range(36):
            candidate_scale = (lower_scale + upper_scale) * 0.5
            candidate_sections = build_sections(candidate_scale)
            if _volume_proxy(candidate_sections) < neutral_volume:
                lower_scale = candidate_scale
            else:
                upper_scale = candidate_scale
                radial_scale = candidate_scale
                posed_sections = candidate_sections

    return {
        "sections": posed_sections,
        "origin": fixed_origin,
        "insertion": moving_insertion,
        "radialScale": radial_scale,
        "neutralPathLength": neutral_length,
        "posedPathLength": posed_length,
        "volumeProxy": _volume_proxy(posed_sections),
    }
