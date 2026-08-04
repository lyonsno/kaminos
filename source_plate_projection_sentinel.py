"""Matched carrier-topology contract for the FLUX.2 projection sentinel."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


PLAN_SCHEMA = "kaminos.source-plate-projection-sentinel-plan.v0"
CARRIER_TOPOLOGIES = {
    "clay": ("clay",),
    "depth": ("depth",),
    "normal": ("normal",),
    "depth-plus-normal": ("depth", "normal"),
}


class ProjectionSentinelError(ValueError):
    """Contract failure carrying a stable evidence phase."""

    def __init__(self, message: str, *, phase: str):
        super().__init__(message)
        self.phase = phase


def _fail(message: str, phase: str) -> None:
    raise ProjectionSentinelError(message, phase=phase)


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return _sha256_bytes(payload)


def _valid_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value.lower())
    )


def _verified_file(path_value: Any, sha256: Any, *, label: str) -> Path:
    if not isinstance(path_value, str) or not path_value.strip() or not _valid_sha256(sha256):
        _fail(f"{label} requires a path and SHA-256 identity", "source-freshness")
    path = Path(path_value)
    if not path.is_file():
        _fail(f"{label} is missing at {path}", "source-freshness")
    measured = _sha256_bytes(path.read_bytes())
    if measured != sha256:
        _fail(
            f"{label} SHA-256 mismatch: expected {sha256}, measured {measured}",
            "source-freshness",
        )
    return path


def _projection_from_descriptor(descriptor: dict[str, Any]) -> dict[str, Any]:
    effective = descriptor.get("effectiveConfig")
    if not isinstance(effective, dict):
        _fail("source descriptor lacks effective projection config", "projection-identity")
    evidence = descriptor.get("projectionEvidence")
    evidence = evidence if isinstance(evidence, dict) else {}
    projection = {
        "mode": effective.get("projection"),
        "view": effective.get("view"),
        "cameraYawRadians": evidence.get(
            "cameraYawRadians", effective.get("cameraYawRadians")
        ),
    }
    if projection["mode"] not in {"orthographic", "perspective"}:
        _fail("source descriptor has unsupported projection mode", "projection-identity")
    if not isinstance(projection["view"], str) or not projection["view"].strip():
        _fail("source descriptor lacks view identity", "projection-identity")
    if not isinstance(projection["cameraYawRadians"], (int, float)) or isinstance(
        projection["cameraYawRadians"], bool
    ):
        _fail("source descriptor lacks camera yaw identity", "projection-identity")
    return projection


def plan_sha256(plan: dict[str, Any]) -> str:
    payload = copy.deepcopy(plan)
    payload.pop("planSha256", None)
    return _canonical_sha256(payload)


def validate_projection_sentinel_plan(
    plan: dict[str, Any], *, verify_files: bool = True
) -> dict[str, Any]:
    """Validate a matched four-cell plan before any generator submission."""

    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        _fail("unsupported projection sentinel plan schema", "plan-schema")
    if plan.get("status") not in {"planned", "running", "complete", "failed"}:
        _fail("projection sentinel has unknown status", "plan-schema")

    source = plan.get("source")
    if not isinstance(source, dict) or not isinstance(source.get("commit"), str):
        _fail("projection sentinel lacks source commit identity", "source-freshness")
    descriptor_record = {
        "path": source.get("descriptorPath"),
        "sha256": source.get("descriptorSha256"),
    }
    images = source.get("images")
    if not isinstance(images, dict) or set(images) != {"clay", "depth", "normal", "mask"}:
        _fail("source image inventory must be clay/depth/normal/mask", "source-freshness")
    if verify_files:
        descriptor_path = _verified_file(
            descriptor_record["path"], descriptor_record["sha256"], label="source descriptor"
        )
        try:
            descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            _fail(f"source descriptor is unreadable: {exc}", "source-freshness")
        for role, record in images.items():
            if not isinstance(record, dict):
                _fail(f"source image {role} lacks identity record", "source-freshness")
            _verified_file(record.get("path"), record.get("sha256"), label=f"source image {role}")
    else:
        if not _valid_sha256(descriptor_record["sha256"]):
            _fail("source descriptor lacks SHA-256 identity", "source-freshness")
        if any(not isinstance(record, dict) or not _valid_sha256(record.get("sha256")) for record in images.values()):
            _fail("source image inventory lacks SHA-256 identity", "source-freshness")
        descriptor = source.get("descriptorSnapshot")
        if not isinstance(descriptor, dict):
            _fail("unverified plan requires descriptorSnapshot", "source-freshness")

    descriptor_projection = _projection_from_descriptor(descriptor)
    projection = source.get("projection")
    if not isinstance(projection, dict):
        _fail("plan lacks source projection identity", "projection-identity")
    for key, value in descriptor_projection.items():
        if projection.get(key) != value:
            _fail(
                f"projection identity {key} disagrees with source descriptor: "
                f"expected {value!r}, got {projection.get(key)!r}",
                "projection-identity",
            )
    if projection.get("cameraSha256") != _canonical_sha256(descriptor_projection):
        _fail("projection identity camera SHA-256 is not descriptor-derived", "projection-identity")
    if projection.get("silhouetteSha256") != images["mask"].get("sha256"):
        _fail("projection identity silhouette SHA-256 is not the source mask", "projection-identity")

    fixed = plan.get("fixedGenerator")
    required_fixed = {
        "runnerFamily",
        "model",
        "modelRevision",
        "quantize",
        "width",
        "height",
        "steps",
        "guidance",
        "seed",
        "promptPath",
        "promptSha256",
    }
    if not isinstance(fixed, dict) or set(fixed) != required_fixed:
        _fail("fixed generator contract is incomplete or contains hidden factors", "matched-controls")
    if fixed["model"] in {"flux2-klein-4b", "flux2-klein-9b"} and fixed["guidance"] != 1.0:
        _fail("distilled FLUX.2 Klein guidance must stay fixed at 1.0", "matched-controls")
    for key in ("width", "height", "steps", "seed"):
        if not isinstance(fixed[key], int) or isinstance(fixed[key], bool) or fixed[key] <= 0:
            _fail(f"fixed generator {key} must be a positive integer", "matched-controls")
    if verify_files:
        _verified_file(fixed["promptPath"], fixed["promptSha256"], label="prompt")
    elif not _valid_sha256(fixed["promptSha256"]):
        _fail("prompt lacks SHA-256 identity", "source-freshness")

    cells = plan.get("cells")
    if not isinstance(cells, list) or len(cells) != len(CARRIER_TOPOLOGIES):
        _fail("projection sentinel requires exactly four carrier topology cells", "carrier-topology")
    by_id = {
        cell.get("id"): cell
        for cell in cells
        if isinstance(cell, dict) and isinstance(cell.get("id"), str)
    }
    if set(by_id) != set(CARRIER_TOPOLOGIES) or len(by_id) != len(cells):
        _fail("projection sentinel has missing, duplicate, or extra carrier topology", "carrier-topology")
    for cell_id, expected_roles in CARRIER_TOPOLOGIES.items():
        cell = by_id[cell_id]
        if tuple(cell.get("carrierRoles", ())) != expected_roles:
            _fail(f"cell {cell_id} has incorrect carrier topology", "carrier-topology")
        expected_route = (
            "gpu-greenroom/mflux_flux2_edit_promptfile_2ref"
            if len(expected_roles) == 2
            else "gpu-greenroom/mflux_flux2_edit_promptfile"
        )
        if cell.get("requestedRoute") != expected_route:
            _fail(f"cell {cell_id} route does not match carrier topology", "carrier-topology")
        settings = cell.get("settings")
        if not isinstance(settings, dict):
            _fail(f"cell {cell_id} lacks matched settings", "matched-controls")
        for key, expected in fixed.items():
            if settings.get(key) != expected:
                _fail(
                    f"cell {cell_id} changed fixed non-carrier setting {key}: "
                    f"expected {expected!r}, got {settings.get(key)!r}",
                    "matched-controls",
                )
        if set(settings) != set(fixed):
            _fail(f"cell {cell_id} carries hidden non-carrier settings", "matched-controls")

    expected_identity = plan_sha256(plan)
    if plan.get("planSha256") != expected_identity:
        _fail("plan SHA-256 does not bind the projection sentinel", "plan-identity")
    return {
        "ok": True,
        "schema": plan["schema"],
        "status": plan["status"],
        "planSha256": expected_identity,
        "cellIds": list(CARRIER_TOPOLOGIES),
    }


def build_projection_sentinel_plan(
    artifact_root: Path | str,
    *,
    source_commit: str,
    model_revision: str,
    seed: int = 80401,
) -> dict[str, Any]:
    """Build the four-cell plan from Molten's immutable baseline package."""

    root = Path(artifact_root)
    source_root = root / "controls" / "baseline" / "baseline"
    descriptor_path = source_root / "bundle.json"
    descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    descriptor_projection = _projection_from_descriptor(descriptor)
    images = {
        role: {
            "path": str((source_root / f"{role}-implicit.png").resolve()),
            "sha256": _sha256_bytes((source_root / f"{role}-implicit.png").read_bytes()),
        }
        for role in ("clay", "depth", "normal", "mask")
    }
    prompt_path = root / "prompt.txt"
    fixed = {
        "runnerFamily": "mflux-generate-flux2-edit",
        "model": "flux2-klein-9b",
        "modelRevision": model_revision,
        "quantize": 4,
        "width": 512,
        "height": 512,
        "steps": 8,
        "guidance": 1.0,
        "seed": seed,
        "promptPath": str(prompt_path.resolve()),
        "promptSha256": _sha256_bytes(prompt_path.read_bytes()),
    }
    plan = {
        "schema": PLAN_SCHEMA,
        "status": "planned",
        "source": {
            "commit": source_commit,
            "descriptorPath": str(descriptor_path.resolve()),
            "descriptorSha256": _sha256_bytes(descriptor_path.read_bytes()),
            "projection": {
                **descriptor_projection,
                "cameraSha256": _canonical_sha256(descriptor_projection),
                "silhouetteSha256": images["mask"]["sha256"],
            },
            "images": images,
        },
        "fixedGenerator": fixed,
        "cells": [
            {
                "id": cell_id,
                "carrierRoles": list(roles),
                "requestedRoute": (
                    "gpu-greenroom/mflux_flux2_edit_promptfile_2ref"
                    if len(roles) == 2
                    else "gpu-greenroom/mflux_flux2_edit_promptfile"
                ),
                "settings": copy.deepcopy(fixed),
            }
            for cell_id, roles in CARRIER_TOPOLOGIES.items()
        ],
    }
    plan["planSha256"] = plan_sha256(plan)
    validate_projection_sentinel_plan(plan)
    return plan


def build_greenroom_submissions(
    plan: dict[str, Any], *, output_root: Path | str
) -> list[dict[str, Any]]:
    """Compile validated sentinel cells into explicit Greenroom submissions."""

    validate_projection_sentinel_plan(plan)
    root = Path(output_root).resolve()
    fixed = plan["fixedGenerator"]
    images = plan["source"]["images"]
    submissions = []
    for cell in plan["cells"]:
        roles = cell["carrierRoles"]
        requested_route = cell["requestedRoute"]
        job_type = requested_route.removeprefix("gpu-greenroom/")
        input_paths = [images[role]["path"] for role in roles]
        submissions.append({
            "cellId": cell["id"],
            "planSha256": plan["planSha256"],
            "requestedRoute": requested_route,
            "jobType": job_type,
            "effectiveCwd": "/Users/noahlyons/dev/mlx-openai-server",
            "inputPaths": input_paths,
            "outputDir": str((root / cell["id"]).resolve()),
            "params": {
                "prompt_file": fixed["promptPath"],
                "model": str(fixed["model"]),
                "quantize": str(fixed["quantize"]),
                "width": str(fixed["width"]),
                "height": str(fixed["height"]),
                "steps": str(fixed["steps"]),
                "guidance": f"{fixed['guidance']:.1f}",
                "seed": str(fixed["seed"]),
                "mlx_cache_limit_gb": "48",
            },
        })
    return submissions
