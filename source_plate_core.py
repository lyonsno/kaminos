"""Pure-Python contracts shared by the source-plate editor and renderer."""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping


SCHEMA_ID = "kaminos.source-plate.v0"
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class SourcePlateContractError(ValueError):
    """A fail-loud source-plate contract violation."""

    def __init__(self, phase: str, message: str):
        super().__init__(message)
        self.phase = phase


def descriptor_sha256(descriptor: Mapping[str, Any]) -> str:
    if descriptor.get("schema") != SCHEMA_ID:
        raise SourcePlateContractError(
            "descriptor-validation", f"descriptor schema must be {SCHEMA_ID}"
        )
    canonical = copy.deepcopy(dict(descriptor))
    plate = canonical.get("plate")
    if (
        not isinstance(plate, dict)
        or not isinstance(plate.get("name"), str)
        or not plate["name"]
    ):
        raise SourcePlateContractError(
            "descriptor-validation", "descriptor plate.name must be a non-empty string"
        )
    plate.pop("descriptorSha256", None)
    try:
        payload = json.dumps(
            canonical,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise SourcePlateContractError(
            "descriptor-validation", f"descriptor is not canonical JSON: {error}"
        ) from error
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_length = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
            byte_length += len(block)
    return digest.hexdigest(), byte_length


def _descriptor_document(descriptor: Mapping[str, Any]) -> dict[str, Any]:
    document = copy.deepcopy(dict(descriptor))
    identity = descriptor_sha256(document)
    document["plate"]["descriptorSha256"] = identity
    return document


def write_descriptor(path: str | Path, descriptor: Mapping[str, Any]) -> dict[str, Any]:
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    document = _descriptor_document(descriptor)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(document, temporary, indent=2, sort_keys=True, allow_nan=False)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, target)
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise
    return document


def read_descriptor(path: str | Path) -> dict[str, Any]:
    source = Path(path).expanduser()
    try:
        document = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SourcePlateContractError(
            "descriptor-read", f"could not read descriptor {source}: {error}"
        ) from error
    if not isinstance(document, dict):
        raise SourcePlateContractError("descriptor-read", "descriptor root must be an object")
    plate = document.get("plate")
    embedded_identity = plate.get("descriptorSha256") if isinstance(plate, dict) else None
    effective_identity = descriptor_sha256(document)
    if embedded_identity != effective_identity:
        raise SourcePlateContractError(
            "descriptor-read",
            "descriptor identity does not match its canonical content",
        )
    return document


def verify_source_freshness(
    descriptor: Mapping[str, Any], effective_source_path: str | Path
) -> dict[str, Any]:
    source = descriptor.get("source")
    if not isinstance(source, Mapping):
        raise SourcePlateContractError("source-freshness", "descriptor source is missing")
    requested_path = source.get("requestedPath")
    expected_sha256 = source.get("expectedSha256")
    if not isinstance(requested_path, str) or not requested_path:
        raise SourcePlateContractError(
            "source-freshness", "descriptor source.requestedPath is missing"
        )
    if not isinstance(expected_sha256, str) or not _SHA256_PATTERN.fullmatch(expected_sha256):
        raise SourcePlateContractError(
            "source-freshness", "descriptor source.expectedSha256 must be lowercase SHA-256"
        )
    if source.get("loadPolicy") != "read_only":
        raise SourcePlateContractError(
            "source-freshness", "source loadPolicy must be read_only"
        )
    try:
        requested = Path(requested_path).expanduser().resolve(strict=True)
        effective = Path(effective_source_path).expanduser().resolve(strict=True)
    except OSError as error:
        raise SourcePlateContractError(
            "source-freshness", f"source path cannot be resolved: {error}"
        ) from error
    if effective != requested:
        raise SourcePlateContractError(
            "source-freshness",
            f"effective source path {effective} does not match requested source path {requested}",
        )
    effective_sha256, byte_length = _sha256_file(effective)
    if effective_sha256 != expected_sha256:
        raise SourcePlateContractError(
            "source-freshness",
            f"source SHA-256 mismatch: expected {expected_sha256}, got {effective_sha256}",
        )
    return {
        "status": "fresh",
        "requestedPath": requested_path,
        "effectivePath": str(effective),
        "expectedSha256": expected_sha256,
        "effectiveSha256": effective_sha256,
        "byteLength": byte_length,
        "loadPolicy": "read_only",
    }


def require_effective_renderer(
    descriptor: Mapping[str, Any], effective_renderer: str
) -> dict[str, str]:
    render = descriptor.get("render")
    if not isinstance(render, Mapping):
        raise SourcePlateContractError("renderer-identity", "descriptor render is missing")
    requested_renderer = render.get("requestedRenderer")
    fallback_policy = render.get("fallbackPolicy")
    if not isinstance(requested_renderer, str) or not requested_renderer:
        raise SourcePlateContractError(
            "renderer-identity", "render.requestedRenderer is missing"
        )
    if fallback_policy != "forbid":
        raise SourcePlateContractError(
            "renderer-identity", "renderer fallback policy must be forbid"
        )
    if effective_renderer != requested_renderer:
        raise SourcePlateContractError(
            "renderer-identity",
            f"renderer fallback rejected: requested {requested_renderer}, got {effective_renderer}",
        )
    return {
        "requestedRenderer": requested_renderer,
        "effectiveRenderer": effective_renderer,
        "fallbackPolicy": "forbid",
    }


def validate_complete_outputs(
    descriptor: Mapping[str, Any], outputs: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    requested_channels = descriptor.get("channels")
    render = descriptor.get("render")
    if not isinstance(requested_channels, list) or not isinstance(render, Mapping):
        raise SourcePlateContractError(
            "output-validation", "descriptor channels or render contract is missing"
        )
    channel_contracts: dict[str, Mapping[str, Any]] = {}
    ordered_names: list[str] = []
    for channel in requested_channels:
        if not isinstance(channel, Mapping):
            raise SourcePlateContractError(
                "output-validation", "each requested channel must be an object"
            )
        name = channel.get("name")
        encoding = channel.get("encoding")
        if not isinstance(name, str) or not name or not isinstance(encoding, str) or not encoding:
            raise SourcePlateContractError(
                "output-validation", "each requested channel needs name and encoding"
            )
        if name in channel_contracts:
            raise SourcePlateContractError(
                "output-validation", f"duplicate requested channel {name}"
            )
        ordered_names.append(name)
        channel_contracts[name] = channel

    supplied_names = set(outputs)
    missing = [name for name in ordered_names if name not in supplied_names]
    if missing:
        raise SourcePlateContractError(
            "output-validation", f"missing requested channels: {', '.join(missing)}"
        )
    extras = sorted(supplied_names - set(ordered_names))
    if extras:
        raise SourcePlateContractError(
            "output-validation", f"unexpected output channels: {', '.join(extras)}"
        )

    descriptor_identity = descriptor_sha256(descriptor)
    expected_width = render.get("width")
    expected_height = render.get("height")
    if (
        type(expected_width) is not int
        or expected_width <= 0
        or type(expected_height) is not int
        or expected_height <= 0
    ):
        raise SourcePlateContractError(
            "output-validation", "render requires positive integer dimensions"
        )
    validated: list[dict[str, Any]] = []
    artifact_owners: dict[Path, str] = {}
    for name in ordered_names:
        record = outputs[name]
        if not isinstance(record, Mapping):
            raise SourcePlateContractError(
                "output-validation", f"output record for {name} must be an object"
            )
        if record.get("status") != "complete":
            raise SourcePlateContractError(
                "output-validation", f"output {name} is not complete"
            )
        if record.get("descriptorSha256") != descriptor_identity:
            raise SourcePlateContractError(
                "output-validation", f"output {name} belongs to another descriptor"
            )
        if record.get("encoding") != channel_contracts[name]["encoding"]:
            raise SourcePlateContractError(
                "output-validation", f"output {name} has the wrong encoding"
            )
        expected_representation = channel_contracts[name].get("representation")
        if (
            expected_representation is not None
            and record.get("representation") != expected_representation
        ):
            raise SourcePlateContractError(
                "output-validation", f"output {name} has the wrong representation"
            )
        record_width = record.get("width")
        record_height = record.get("height")
        if (
            type(record_width) is not int
            or type(record_height) is not int
            or record_width != expected_width
            or record_height != expected_height
        ):
            raise SourcePlateContractError(
                "output-validation", f"output {name} has the wrong dimensions"
            )
        path_value = record.get("path")
        if not isinstance(path_value, str) or not path_value:
            raise SourcePlateContractError(
                "output-validation", f"output {name} has no path"
            )
        path = Path(path_value).expanduser()
        if not path.is_file():
            raise SourcePlateContractError(
                "output-validation", f"output {name} file is missing"
            )
        effective_path = path.resolve()
        previous_owner = artifact_owners.get(effective_path)
        if previous_owner is not None:
            raise SourcePlateContractError(
                "output-validation",
                f"outputs {previous_owner} and {name} share one artifact: {effective_path}",
            )
        artifact_owners[effective_path] = name
        effective_sha256, byte_length = _sha256_file(path)
        if byte_length == 0:
            raise SourcePlateContractError(
                "output-validation", f"output {name} is a zero-byte file"
            )
        if record.get("byteLength") != byte_length:
            raise SourcePlateContractError(
                "output-validation", f"output {name} byte length does not match its file"
            )
        if record.get("sha256") != effective_sha256:
            raise SourcePlateContractError(
                "output-validation", f"output {name} SHA-256 does not match its file"
            )
        validated_record = {
                "channel": name,
                "status": "complete",
                "path": str(effective_path),
                "encoding": record["encoding"],
                "width": record_width,
                "height": record_height,
                "byteLength": byte_length,
                "sha256": effective_sha256,
                "descriptorSha256": descriptor_identity,
            }
        if expected_representation is not None:
            validated_record["representation"] = expected_representation
        validated.append(validated_record)
    return {
        "status": "complete",
        "descriptorSha256": descriptor_identity,
        "requestedChannels": ordered_names,
        "outputs": validated,
    }
