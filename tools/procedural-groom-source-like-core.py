"""Pure evidence contracts for the paired procedural-groom observation assay."""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any


OBSERVATION_SCHEMA = "kaminos.procedural-groom-source-like-observation.v0"
REPORT_SCHEMA = "kaminos.procedural-groom-source-like-preflight.v0"
EXPECTED_VIEWS = {
    "front": ([0.0, 0.6, 3.0], [0.0, 0.0, 0.0]),
    "left-three-quarter": ([-2.1, 0.6, 2.1], [0.0, 0.0, 0.0]),
    "right-three-quarter": ([2.1, 0.6, 2.1], [0.0, 0.0, 0.0]),
}
REQUIRED_CONSTANTS = {
    "authored-carrier",
    "groom-system-membership",
    "guide-field",
    "camera-poses",
    "vlm-prompt",
    "vlm-model",
    "sam-model",
    "truth-scoring",
}


def _report(state: str, failures: list[str], last: str | None = None) -> dict[str, Any]:
    return {
        "schema": REPORT_SCHEMA,
        "state": state,
        "failures": failures,
        "visualAdmission": False,
        "scientificAdmission": False,
        "lastTrustworthyEvidence": last,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _vectors_close(left: Any, right: list[float], tolerance: float = 1e-7) -> bool:
    return (
        isinstance(left, list)
        and len(left) == len(right)
        and all(isinstance(value, (int, float)) and math.isfinite(value) for value in left)
        and all(abs(float(value) - expected) <= tolerance for value, expected in zip(left, right))
    )


def _bound_file_failures(path: Path, record: dict[str, Any], label: str) -> list[str]:
    failures: list[str] = []
    if not path.is_file():
        return [f"{label}: bound file is missing"]
    size = path.stat().st_size
    if size <= 0:
        failures.append(f"{label}: bound file is blank")
    if record.get("byteLength") != size:
        failures.append(f"{label}: byte length mismatch")
    digest = record.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64 or _sha256(path) != digest:
        failures.append(f"{label}: sha256 mismatch")
    return failures


def evaluate_source_like_observation(
    observation: dict[str, Any],
    *,
    observation_dir: Path,
    repo_root: Path,
) -> dict[str, Any]:
    """Validate a complete source-like/diagnostic presentation pair."""
    if observation.get("schema") != OBSERVATION_SCHEMA:
        return _report("invalid_schema", [f"expected schema {OBSERVATION_SCHEMA}"])
    if observation.get("visualAdmission") is not False or observation.get("scientificAdmission") is not False:
        return _report("invalid_admission_claim", ["the observation cannot admit itself"])
    if observation.get("requestedRoute") != observation.get("effectiveRoute"):
        return _report("invalid_route", ["requested and effective routes must match"])
    if observation.get("presentationVariable") != "diagnostic-viewer-vs-source-like-groom":
        return _report("invalid_presentation_pair", ["presentation variable is not isolated"])

    held = set(observation.get("heldConstant") or [])
    missing_constants = sorted(REQUIRED_CONSTANTS - held)
    if missing_constants:
        return _report(
            "invalid_presentation_pair",
            [f"missing held-constant declaration {value}" for value in missing_constants],
        )

    approximation = observation.get("targetDistributionApproximation") or {}
    approximation_failures = []
    for field in ["integratedFiberField", "naturalShading", "recognizableCarrierLandmarks"]:
        if approximation.get(field) is not True:
            approximation_failures.append(f"target-distribution approximation requires {field}")
    if approximation.get("membershipColorEncoding") is not False:
        approximation_failures.append("source-like arm must not encode membership by color")
    if not isinstance(approximation.get("renderer"), str) or not approximation.get("renderer"):
        approximation_failures.append("target-distribution approximation must identify the effective renderer")
    if not isinstance(approximation.get("blenderVersion"), str) or not approximation.get("blenderVersion"):
        approximation_failures.append("target-distribution approximation must identify the Blender version")
    if not isinstance(approximation.get("fiberCurveCount"), int) or approximation.get("fiberCurveCount", 0) <= 0:
        approximation_failures.append("target-distribution approximation must report a positive fiber curve count")
    density_fields = {
        "baselineCoatFiberCurveCount",
        "coatFiberCurveCount",
        "requestedDensityMultiplier",
        "effectiveDensityMultiplier",
    }
    if density_fields & set(approximation):
        baseline_count = approximation.get("baselineCoatFiberCurveCount")
        coat_count = approximation.get("coatFiberCurveCount")
        requested_multiplier = approximation.get("requestedDensityMultiplier")
        effective_multiplier = approximation.get("effectiveDensityMultiplier")
        if (
            not isinstance(requested_multiplier, int)
            or requested_multiplier < 1
            or not isinstance(effective_multiplier, int)
            or effective_multiplier < 1
            or requested_multiplier != effective_multiplier
        ):
            approximation_failures.append("requested and effective density multiplier must match as positive integers")
        if not isinstance(baseline_count, int) or baseline_count <= 0:
            approximation_failures.append("baseline coat fiber count must be positive")
        if not isinstance(coat_count, int) or coat_count <= 0:
            approximation_failures.append("effective coat fiber count must be positive")
        if (
            isinstance(baseline_count, int)
            and isinstance(coat_count, int)
            and isinstance(effective_multiplier, int)
            and baseline_count > 0
            and effective_multiplier > 0
            and coat_count != baseline_count * effective_multiplier
        ):
            approximation_failures.append("effective coat fiber count does not equal baseline times density multiplier")
    if not isinstance(observation.get("claimCeiling"), str) or not observation.get("claimCeiling"):
        approximation_failures.append("source-like observation requires an explicit claim ceiling")
    if approximation_failures:
        return _report("invalid_presentation_pair", approximation_failures)

    artifact_failures: list[str] = []
    source = observation.get("source") or {}
    for key, digest_key, label in [
        ("manifestPath", "manifestSha256", "source manifest"),
        ("blendPath", "blendSha256", "source blend"),
    ]:
        relative = source.get(key)
        if not isinstance(relative, str) or not relative:
            artifact_failures.append(f"{label}: path is missing")
            continue
        path = (repo_root / relative).resolve()
        try:
            path.relative_to(repo_root.resolve())
        except ValueError:
            artifact_failures.append(f"{label}: path escapes repo root")
            continue
        record = {"sha256": source.get(digest_key), "byteLength": path.stat().st_size if path.is_file() else 0}
        artifact_failures.extend(_bound_file_failures(path, record, label))

    views = observation.get("views") or []
    view_ids = [view.get("id") for view in views]
    pair_failures: list[str] = []
    if len(views) != len(EXPECTED_VIEWS) or set(view_ids) != set(EXPECTED_VIEWS):
        pair_failures.append("views must contain exactly the three sealed camera identities")
    if len(view_ids) != len(set(view_ids)):
        pair_failures.append("view identities must be unique")

    for view in views:
        view_id = view.get("id", "unknown")
        expected = EXPECTED_VIEWS.get(view_id)
        if expected and (
            not _vectors_close(view.get("cameraPosition"), expected[0])
            or not _vectors_close(view.get("cameraTarget"), expected[1])
        ):
            pair_failures.append(f"{view_id}: camera drift from sealed observation pose")
        if any(view.get(field) is not False for field in [
            "membershipColorsVisible", "labelsVisible", "gizmoVisible",
        ]):
            pair_failures.append(f"{view_id}: membership colors, labels, and gizmos must remain hidden")
        diagnostic = view.get("diagnostic") or {}
        source_like = view.get("sourceLike") or {}
        if diagnostic.get("sha256") and diagnostic.get("sha256") == source_like.get("sha256"):
            pair_failures.append(f"{view_id}: diagnostic and source-like arms resolve to the same image")
        for arm_name, record in [("diagnostic", diagnostic), ("source-like", source_like)]:
            relative = record.get("path")
            if not isinstance(relative, str) or not relative:
                artifact_failures.append(f"{view_id} {arm_name}: path is missing")
                continue
            path = (observation_dir / relative).resolve()
            try:
                path.relative_to(observation_dir.resolve())
            except ValueError:
                artifact_failures.append(f"{view_id} {arm_name}: path escapes observation directory")
                continue
            artifact_failures.extend(_bound_file_failures(path, record, f"{view_id} {arm_name}"))

    if artifact_failures:
        return _report("invalid_bound_artifacts", artifact_failures)
    if pair_failures:
        return _report("invalid_presentation_pair", pair_failures, "digest-bound-presentation-artifacts")
    return _report(
        "presentation_pair_bound_for_visual_inspection",
        [],
        "digest-bound-diagnostic-and-source-like-views",
    )
