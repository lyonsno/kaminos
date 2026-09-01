#!/usr/bin/env python3
"""Kaminos dev server with directory browsing API."""

import http.server
import copy
from decimal import Decimal, InvalidOperation
import fcntl
import hashlib
import json
import math
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse, parse_qs, parse_qsl, urlencode

PORT = 8090
ROOT = Path(__file__).parent.resolve()
VOLUME_CAPTURE_DIR = ROOT / "artifacts" / "volume-captures"
VOLUME_SETTINGS_PRESET_SCHEMA_PATH = ROOT / "volume-settings-preset-schema-v2.json"
VOLUME_SETTINGS_STORE_DEFAULT = Path(os.environ.get(
    "KAMINOS_VOLUME_SETTINGS_STORE",
    os.path.expanduser("~/.local/share/kaminos/volume-settings-presets"),
)).expanduser().resolve()
VOLUME_SETTINGS_STORE = VOLUME_SETTINGS_STORE_DEFAULT
VOLUME_BASIN_SESSION_STORE_DEFAULT = Path(os.environ.get(
    "KAMINOS_VOLUME_BASIN_SESSION_STORE",
    os.path.expanduser("~/.local/share/kaminos/volume-basin-drive-sessions"),
)).expanduser().resolve()
VOLUME_BASIN_SESSION_STORE = VOLUME_BASIN_SESSION_STORE_DEFAULT
VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT = Path(os.environ.get(
    "KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE",
    os.path.expanduser("~/.local/share/kaminos/volume-cockpit-layouts"),
)).expanduser().resolve()
VOLUME_COCKPIT_LAYOUT_STORE = VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT
VOLUME_SETTINGS_PRESET_IDENTITY = "kaminos-volume-settings-preset-v2"
VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY = "kaminos-volume-settings-preset-artifact-v2"
VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY = "kaminos-volume-settings-preset-schema-v2"
VOLUME_SETTINGS_PRESET_PROJECTION_RECEIPT_IDENTITY = "kaminos-volume-settings-preset-projection-receipt-v1"
VOLUME_SETTINGS_PRESET_PROJECTION_LINEAGE_IDENTITY = "kaminos-volume-settings-preset-projection-lineage-v1"
VOLUME_BASIN_PROMOTION_CLI = ROOT / "volume-basin-promotion-package.mjs"
VOLUME_BASIN_DRIVE_SESSION_CLI = ROOT / "volume-basin-drive-session-cli.mjs"


def write_volume_basin_drive_session(store_path, session):
    store = _volume_settings_store_path(store_path)
    normalized = _normalize_volume_basin_drive_session(session)
    if normalized["runtime"]["effectiveStorePath"] != str(store):
        raise ValueError("volume basin drive session effective store path mismatch")
    content_hash = _volume_basin_drive_session_content_hash(normalized)
    artifact_id = f"vds-{content_hash}"
    written_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    document = {
        "identity": "kaminos.volume.basin-drive-session-artifact.v0",
        "artifactId": artifact_id,
        "contentHash": f"sha256:{content_hash}",
        "writtenAt": written_at,
        "source": volume_settings_server_source(),
        "session": normalized,
    }
    artifact_path = store / "sessions" / f"{artifact_id}.json"
    with _volume_settings_store_lock(store):
        created = _atomic_create_json(artifact_path, document)
        idempotent = not created
        if idempotent:
            existing = read_volume_basin_drive_session(store, artifact_id)
            if existing.get("contentHash") != document["contentHash"]:
                raise ValueError("volume basin drive session content identity collision")
    return {
        "ok": True,
        "identity": "kaminos.volume.basin-drive-session-write-receipt.v0",
        "requested": {
            "storePath": str(store),
            "sessionId": normalized["sessionId"],
            "eventCount": normalized["eventCount"],
            "sourceCommit": normalized["source"]["commit"],
        },
        "effective": {
            "storePath": str(store),
            "artifactPath": str(artifact_path),
            "artifactId": artifact_id,
            "contentHash": document["contentHash"],
            "sessionId": normalized["sessionId"],
            "eventCount": normalized["eventCount"],
            "controlEventCount": normalized["controlEventCount"],
            "markCount": normalized["markCount"],
            "sourceCommit": normalized["source"]["commit"],
            "idempotent": idempotent,
        },
        "sessionUrl": f"/api/volume-basin-drive-session?id={artifact_id}",
    }


def read_volume_basin_drive_session(store_path, session_ref):
    store = _volume_settings_store_path(store_path)
    artifact_id = str(session_ref or "").strip()
    if not re.fullmatch(r"vds-[0-9a-f]{64}", artifact_id):
        raise ValueError("volume basin drive session artifact id is invalid")
    artifact_path = store / "sessions" / f"{artifact_id}.json"
    try:
        document = _read_json_object(artifact_path, "basin drive session artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume basin drive session not found: {artifact_id}") from error
    if (
        document.get("identity") != "kaminos.volume.basin-drive-session-artifact.v0"
        or document.get("artifactId") != artifact_id
    ):
        raise ValueError("volume basin drive session artifact identity mismatch")
    normalized = _normalize_volume_basin_drive_session(document.get("session"))
    content_hash = _volume_basin_drive_session_content_hash(normalized)
    if document.get("contentHash") != f"sha256:{content_hash}" or artifact_id != f"vds-{content_hash}":
        raise ValueError("volume basin drive session artifact content hash mismatch")
    return {
        **document,
        "session": normalized,
        "artifactPath": str(artifact_path),
        "storePath": str(store),
    }


def list_volume_basin_drive_sessions(store_path):
    store = _volume_settings_store_path(store_path)
    sessions_dir = store / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for artifact_path in sessions_dir.glob("vds-*.json"):
        document = read_volume_basin_drive_session(store, artifact_path.stem)
        session = document["session"]
        entries.append({
            "artifactId": document["artifactId"],
            "contentHash": document["contentHash"],
            "artifactPath": document["artifactPath"],
            "sessionId": session["sessionId"],
            "startedAt": session["startedAt"],
            "endedAt": session["endedAt"],
            "eventCount": session["eventCount"],
            "controlEventCount": session["controlEventCount"],
            "markCount": session["markCount"],
            "sourceCommit": session["source"]["commit"],
            "writtenAt": document.get("writtenAt"),
        })
    entries.sort(key=lambda entry: (entry.get("writtenAt") or "", entry["artifactId"]), reverse=True)
    return {
        "identity": "kaminos.volume.basin-drive-session-index.v0",
        "storePath": str(store),
        "entries": entries,
    }


def _normalize_volume_basin_drive_session(session):
    if not isinstance(session, dict):
        raise ValueError("volume basin drive session must be a JSON object")
    result = subprocess.run(
        ["node", str(VOLUME_BASIN_DRIVE_SESSION_CLI), "normalize"],
        cwd=ROOT,
        text=True,
        input=json.dumps(session, ensure_ascii=True),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip().splitlines()
        detail = next((line.removeprefix("Error: ") for line in message if "Error:" in line), None)
        raise ValueError(detail or "volume basin drive session validation failed")
    try:
        normalized = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"volume basin drive session validator returned invalid JSON: {error}") from error
    if not isinstance(normalized, dict):
        raise ValueError("volume basin drive session validator returned a non-object")
    canonical_schema = _canonical_volume_basin_drive_control_schema()
    authored_schema = normalized.get("controlSchema") or {}
    for field in (
        "identity", "sha256", "basinControlCount", "rendererControlCount",
        "presentationControlCount", "inventory",
    ):
        if authored_schema.get(field) != canonical_schema.get(field):
            raise ValueError(f"volume basin drive session canonical control schema mismatch: {field}")
    server_source = volume_settings_server_source()
    if server_source.get("dirty") is not False:
        raise ValueError("volume basin drive session server source is dirty")
    if normalized.get("source", {}).get("commit") != server_source.get("commit"):
        raise ValueError("volume basin drive session source commit does not match the effective server")
    return normalized


def _canonical_volume_basin_drive_control_schema():
    schema_bytes = VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_bytes()
    schema = json.loads(schema_bytes)
    inventory = []
    for axis, field in (
        ("basin", "controls"),
        ("renderer", "rendererControls"),
        ("presentation", "presentationControls"),
    ):
        inventory.extend({
            "axis": axis,
            "id": descriptor["key"],
            "param": descriptor["param"],
            "type": descriptor["type"],
        } for descriptor in schema.get(field) or [])
    return {
        "identity": schema["identity"],
        "sha256": hashlib.sha256(schema_bytes).hexdigest(),
        "basinControlCount": len(schema.get("controls") or []),
        "rendererControlCount": len(schema.get("rendererControls") or []),
        "presentationControlCount": len(schema.get("presentationControls") or []),
        "inventory": inventory,
    }


def _volume_basin_drive_session_content_hash(session):
    canonical = json.dumps(session, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def _settings_preset_route_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    return str(value)


def _settings_preset_descriptor_value(descriptor):
    return descriptor.get("rawValue") if "rawValue" in descriptor else descriptor.get("value")


def _settings_preset_descriptor_for_default(descriptor):
    return {
        "id": descriptor["key"],
        "param": descriptor["param"],
        "tagName": descriptor["tagName"],
        "type": descriptor["type"],
        "value": descriptor["additiveDefault"],
    }


def _validate_settings_preset_descriptor(key, descriptor, expected):
    if not isinstance(descriptor, dict):
        raise ValueError(f"settings preset control descriptor is invalid: {key}")
    if descriptor.get("id") != key:
        raise ValueError(f"settings preset control descriptor id mismatch for {key}")
    if (
        descriptor.get("param") != expected.get("param")
        or str(descriptor.get("tagName") or "").upper() != str(expected.get("tagName") or "").upper()
        or str(descriptor.get("type") or "").lower() != str(expected.get("type") or "").lower()
    ):
        raise ValueError(f"settings preset control inventory mismatch for {key}")
    stored_value_fields = [field for field in ("value", "rawValue") if field in descriptor]
    if len(stored_value_fields) != 1:
        raise ValueError(f"settings preset control stored value is invalid for {key}")
    value = descriptor[stored_value_fields[0]]
    control_type = str(expected.get("type") or "").lower()
    value_type_valid = True
    if control_type == "range":
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            value_type_valid = False
        else:
            try:
                value_type_valid = math.isfinite(float(value))
            except (TypeError, ValueError):
                value_type_valid = False
    elif control_type == "checkbox":
        value_type_valid = isinstance(value, bool)
    elif control_type in {"color", "text", "select-one", "button-state"}:
        value_type_valid = isinstance(value, str)
    if not value_type_valid:
        raise ValueError(f"settings preset control stored value type mismatch for {key}")
    allowed_values = expected.get("allowedValues")
    if allowed_values is not None and value not in allowed_values:
        raise ValueError(f"settings preset control has unsupported value for {key}")


def _validate_settings_preset_schema(schema):
    if schema.get("identity") != VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY:
        raise ValueError("settings preset canonical schema identity mismatch")
    controls = schema.get("controls") or []
    if schema.get("controlCount") != len(controls):
        raise ValueError("settings preset canonical schema control count mismatch")
    axes = [controls, schema.get("rendererControls") or [], schema.get("presentationControls") or []]
    all_controls = [descriptor for axis in axes for descriptor in axis]
    if (
        any(not isinstance(descriptor, dict) for descriptor in all_controls)
        or len({descriptor.get("key") for descriptor in all_controls}) != len(all_controls)
        or len({descriptor.get("param") for descriptor in all_controls}) != len(all_controls)
    ):
        raise ValueError("settings preset canonical schema inventory is invalid")
    retired_controls = schema.get("retiredControls") or []
    if not isinstance(retired_controls, list) or any(
        not isinstance(descriptor, dict)
        or descriptor.get("axis") not in {"domControls", "rendererControls", "presentationControls"}
        or any(
            not isinstance(descriptor.get(field), str) or not descriptor[field].strip()
            for field in ("key", "param", "tagName", "type")
        )
        or (
            "allowedValues" in descriptor
            and (
                not isinstance(descriptor["allowedValues"], list)
                or not descriptor["allowedValues"]
                or len(set(map(str, descriptor["allowedValues"]))) != len(descriptor["allowedValues"])
            )
        )
        for descriptor in retired_controls
    ):
        raise ValueError("settings preset retired control inventory is invalid")
    combined_controls = [*all_controls, *retired_controls]
    if (
        len({descriptor.get("key") for descriptor in combined_controls}) != len(combined_controls)
        or len({descriptor.get("param") for descriptor in combined_controls}) != len(combined_controls)
    ):
        raise ValueError("settings preset retired controls overlap the canonical inventory")
    return schema


def normalize_volume_settings_preset_payload(payload, schema=None):
    """Project a compatible older payload through schema-owned additive defaults."""
    schema = _validate_settings_preset_schema(
        schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    )
    if not isinstance(payload, dict):
        raise ValueError("settings preset additive projection source is invalid")
    if payload.get("identity") != VOLUME_SETTINGS_PRESET_IDENTITY or payload.get("kind") != "settings-preset":
        raise ValueError("settings preset identity mismatch")
    if payload.get("schemaIdentity") != schema.get("identity"):
        raise ValueError("settings preset schema identity mismatch")
    allowed_fields = set(schema.get("allowedNativePresetFields") or [])
    unexpected_fields = sorted(set(payload) - allowed_fields)
    if unexpected_fields:
        raise ValueError(f"settings preset contains fields outside its canonical schema: {','.join(unexpected_fields)}")

    normalized = copy.deepcopy(payload)
    defaults_applied = []
    retired_controls_stripped = []
    routed_source_values = {}
    routed_default_values = {}
    routed_retired_values = {}
    retired_by_axis = {
        "domControls": {},
        "rendererControls": {},
        "presentationControls": {},
    }
    for descriptor in schema.get("retiredControls") or []:
        retired_by_axis[descriptor["axis"]][descriptor["key"]] = descriptor
    axis_specs = (
        ("domControls", "controlCount", schema.get("controls") or [], True, "basin"),
        ("rendererControls", "rendererControlCount", schema.get("rendererControls") or [], False, "renderer"),
        ("presentationControls", "presentationControlCount", schema.get("presentationControls") or [], True, "presentation"),
    )
    for field, count_field, expected_descriptors, default_missing_axis, axis_name in axis_specs:
        source_controls = copy.deepcopy(payload.get(field))
        axis_authored = source_controls is not None
        if source_controls is None:
            source_controls = {}
        if not isinstance(source_controls, dict):
            raise ValueError(f"settings preset {field} are invalid")
        source_count = payload.get(count_field)
        if source_count not in (None, len(source_controls)):
            raise ValueError(f"settings preset {count_field} does not match its authored inventory")
        expected_by_key = {descriptor["key"]: descriptor for descriptor in expected_descriptors}
        retired_by_key = retired_by_axis[field]
        unknown = sorted(set(source_controls) - set(expected_by_key) - set(retired_by_key))
        if unknown:
            raise ValueError(f"settings preset {field} contain unknown controls: {','.join(unknown)}")
        for key in sorted(set(source_controls) & set(retired_by_key)):
            descriptor = source_controls.pop(key)
            expected = retired_by_key[key]
            _validate_settings_preset_descriptor(key, descriptor, expected)
            value = _settings_preset_descriptor_value(descriptor)
            routed_retired_values[expected["param"]] = _settings_preset_route_value(value)
            retired_controls_stripped.append({
                "axis": axis_name,
                "id": key,
                "param": expected["param"],
                "value": value,
            })
        for key, descriptor in source_controls.items():
            expected = expected_by_key[key]
            _validate_settings_preset_descriptor(key, descriptor, expected)
            routed_source_values[expected["param"]] = _settings_preset_route_value(
                _settings_preset_descriptor_value(descriptor)
            )

        missing = [descriptor for descriptor in expected_descriptors if descriptor["key"] not in source_controls]
        missing_axis_is_fully_additive = bool(missing) and all(
            "additiveDefault" in descriptor for descriptor in missing
        )
        if missing and not axis_authored and not default_missing_axis and not missing_axis_is_fully_additive:
            missing_nonadditive = next(
                descriptor for descriptor in missing if "additiveDefault" not in descriptor
            )
            raise ValueError(
                f"settings preset is missing non-additive control: {missing_nonadditive['key']}"
            )
        if missing and (axis_authored or default_missing_axis or missing_axis_is_fully_additive):
            for descriptor in missing:
                if "additiveDefault" not in descriptor:
                    raise ValueError(f"settings preset is missing non-additive control: {descriptor['key']}")
                default_descriptor = _settings_preset_descriptor_for_default(descriptor)
                source_controls[descriptor["key"]] = default_descriptor
                routed_default_values[descriptor["param"]] = _settings_preset_route_value(
                    descriptor["additiveDefault"]
                )
                defaults_applied.append(descriptor["key"])
        if axis_authored or source_controls or (default_missing_axis and expected_descriptors):
            normalized[field] = source_controls
            normalized[count_field] = len(source_controls)
        else:
            normalized.pop(field, None)
            normalized.pop(count_field, None)

    exclusions = payload.get("stateExclusions") or {}
    if any(exclusions.get(field) is not True for field in schema.get("excludedStateFields") or []):
        raise ValueError("settings preset must explicitly exclude runtime and replay state")
    if any(field in payload for field in schema.get("forbiddenPresetFields") or []):
        raise ValueError("settings preset must not contain runtime, renderer, camera, or replay state")

    route = payload.get("route")
    if not isinstance(route, str) or not route:
        raise ValueError("settings preset requires an exact control route")
    parsed = urlparse(route)
    route_entries = parse_qsl(parsed.query, keep_blank_values=True)
    route_values = {}
    for key, value in route_entries:
        if key in route_values:
            raise ValueError(f"settings preset route duplicates parameter {key}")
        route_values[key] = value
    activation = schema.get("activationParam") or {}
    if route_values.pop(activation.get("key"), None) != activation.get("value"):
        raise ValueError("settings preset route omitted the native volume activation gate")
    for key, expected_value in routed_source_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset route/control mismatch for {key}")
    for key, expected_value in routed_retired_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset retired route/control mismatch for {key}")
    if routed_retired_values:
        route_entries = [
            (key, value) for key, value in route_entries
            if key not in routed_retired_values
        ]
    for key, default_value in routed_default_values.items():
        if key in route_values:
            raise ValueError(f"settings preset route contains unowned additive parameter {key}")
        route_entries.append((key, default_value))
    for key in schema.get("routeExtraParams") or []:
        if key not in route_values:
            raise ValueError(f"settings preset route omitted metadata parameter {key}")
        route_values.pop(key)
    if route_values:
        raise ValueError(f"settings preset route contains unexpected parameters: {','.join(sorted(route_values))}")
    normalized["route"] = parsed._replace(query=urlencode(route_entries)).geturl()
    return normalized, {
        "identity": "kaminos-volume-settings-schema-projection-v1",
        "sourceControlCount": payload.get("controlCount"),
        "effectiveControlCount": normalized.get("controlCount"),
        "sourceRendererControlCount": payload.get("rendererControlCount", 0),
        "effectiveRendererControlCount": normalized.get("rendererControlCount", 0),
        "sourcePresentationControlCount": payload.get("presentationControlCount", 0),
        "effectivePresentationControlCount": normalized.get("presentationControlCount", 0),
        "defaultsApplied": defaults_applied,
        "retiredControlsStripped": retired_controls_stripped,
    }


def validate_volume_settings_preset_payload(payload, schema=None):
    schema = _validate_settings_preset_schema(
        schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    )
    if payload.get("identity") != VOLUME_SETTINGS_PRESET_IDENTITY or payload.get("kind") != "settings-preset":
        raise ValueError("settings preset identity mismatch")
    if payload.get("schemaIdentity") != schema.get("identity"):
        raise ValueError("settings preset schema identity mismatch")

    allowed_fields = set(schema.get("allowedNativePresetFields") or [])
    unexpected_fields = sorted(set(payload) - allowed_fields)
    if unexpected_fields:
        raise ValueError(f"settings preset contains fields outside its canonical schema: {','.join(unexpected_fields)}")

    dom_controls = payload.get("domControls")
    expected_controls = schema.get("controls") or []
    if not isinstance(dom_controls, dict) or payload.get("controlCount") != len(expected_controls) or len(dom_controls) != len(expected_controls):
        raise ValueError(f"settings preset requires exactly {len(expected_controls)} canonical controls")
    expected_by_key = {entry["key"]: entry for entry in expected_controls}
    if set(dom_controls) != set(expected_by_key):
        raise ValueError("settings preset control inventory does not match the canonical schema")

    expected_renderer_controls = schema.get("rendererControls") or []
    renderer_controls = payload.get("rendererControls")
    if renderer_controls is None and not expected_renderer_controls:
        if payload.get("rendererControlCount") not in (None, 0):
            raise ValueError("settings preset renderer control count is invalid")
        renderer_controls = {}
    elif (
        not isinstance(renderer_controls, dict)
        or payload.get("rendererControlCount") != len(expected_renderer_controls)
        or len(renderer_controls) != len(expected_renderer_controls)
    ):
        raise ValueError(
            f"settings preset requires exactly {len(expected_renderer_controls)} renderer controls"
        )
    expected_renderer_by_key = {entry["key"]: entry for entry in expected_renderer_controls}
    if renderer_controls and set(renderer_controls) != set(expected_renderer_by_key):
        raise ValueError("settings preset renderer control inventory does not match the canonical schema")

    expected_presentation_controls = schema.get("presentationControls") or []
    presentation_controls = payload.get("presentationControls")
    if presentation_controls is None and not expected_presentation_controls:
        if payload.get("presentationControlCount") not in (None, 0):
            raise ValueError("settings preset presentation control count is invalid")
        presentation_controls = {}
    elif (
        not isinstance(presentation_controls, dict)
        or payload.get("presentationControlCount") != len(expected_presentation_controls)
        or len(presentation_controls) != len(expected_presentation_controls)
    ):
        raise ValueError(
            f"settings preset requires exactly {len(expected_presentation_controls)} presentation controls"
        )
    expected_presentation_by_key = {entry["key"]: entry for entry in expected_presentation_controls}
    if set(presentation_controls) != set(expected_presentation_by_key):
        raise ValueError("settings preset presentation control inventory does not match the canonical schema")

    routed_values = {}
    for key, descriptor in {**dom_controls, **renderer_controls, **presentation_controls}.items():
        expected = expected_by_key.get(key) or expected_renderer_by_key.get(key) or expected_presentation_by_key.get(key)
        _validate_settings_preset_descriptor(key, descriptor, expected)
        routed_values[expected["param"]] = _settings_preset_route_value(
            _settings_preset_descriptor_value(descriptor)
        )

    exclusions = payload.get("stateExclusions") or {}
    if any(exclusions.get(field) is not True for field in schema.get("excludedStateFields") or []):
        raise ValueError("settings preset must explicitly exclude runtime and replay state")
    if any(field in payload for field in schema.get("forbiddenPresetFields") or []):
        raise ValueError("settings preset must not contain runtime, renderer, camera, or replay state")

    route = payload.get("route")
    if not isinstance(route, str) or not route:
        raise ValueError("settings preset requires an exact control route")
    route_entries = parse_qsl(urlparse(route).query, keep_blank_values=True)
    route_values = {}
    for key, value in route_entries:
        if key in route_values:
            raise ValueError(f"settings preset route duplicates parameter {key}")
        route_values[key] = value
    activation = schema.get("activationParam") or {}
    if route_values.pop(activation.get("key"), None) != activation.get("value"):
        raise ValueError("settings preset route omitted the native volume activation gate")
    for key, expected_value in routed_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset route/control mismatch for {key}")
    for key in schema.get("routeExtraParams") or []:
        if key not in route_values:
            raise ValueError(f"settings preset route omitted metadata parameter {key}")
        route_values.pop(key)
    if route_values:
        raise ValueError(f"settings preset route contains unexpected parameters: {','.join(sorted(route_values))}")
    return True


def _volume_settings_store_path(store_path):
    return Path(store_path).expanduser().resolve()


def _volume_settings_alias_slug(label):
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(label or "").strip()).strip(".-").lower()[:96]
    return slug or "unnamed-preset"


def _volume_settings_control_values(payload, schema):
    return {
        key: _settings_preset_descriptor_value(descriptor)
        for key, descriptor in (payload.get("domControls") or {}).items()
    }


def _volume_settings_renderer_control_values(payload, schema):
    controls = payload.get("rendererControls")
    if not controls:
        return None
    return {
        key: _settings_preset_descriptor_value(descriptor)
        for key, descriptor in controls.items()
    }


def _volume_settings_presentation_control_values(payload, schema):
    controls = payload.get("presentationControls")
    if not controls:
        return None
    return {
        key: _settings_preset_descriptor_value(descriptor)
        for key, descriptor in controls.items()
    }


def _volume_settings_content_hash(payload, schema):
    canonical = {
        "schemaIdentity": schema["identity"],
        "controls": _volume_settings_control_values(payload, schema),
    }
    renderer_controls = _volume_settings_renderer_control_values(payload, schema)
    if renderer_controls is not None:
        canonical["rendererControls"] = renderer_controls
    presentation_controls = _volume_settings_presentation_control_values(payload, schema)
    if presentation_controls is not None:
        canonical["presentationControls"] = presentation_controls
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _atomic_write_json(path, document):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(document, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def _atomic_create_json(path, document):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(document, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError:
            return False
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
        return True
    finally:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass


@contextmanager
def _volume_settings_store_lock(store):
    store = _volume_settings_store_path(store)
    store.mkdir(parents=True, exist_ok=True)
    lock_path = store / ".write.lock"
    with lock_path.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield store
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _read_json_object(path, role):
    try:
        document = json.loads(Path(path).read_text())
    except FileNotFoundError:
        raise
    except Exception as error:
        raise ValueError(f"volume settings preset {role} is unreadable: {error}") from error
    if not isinstance(document, dict):
        raise ValueError(f"volume settings preset {role} is not a JSON object")
    return document


def _project_volume_cockpit_layout(layout, schema=None, *, allow_declared_retired=False):
    if not isinstance(layout, dict):
        raise ValueError("volume cockpit layout must be a JSON object")
    if set(layout) != {"identity", "layoutId", "label", "groups"}:
        raise ValueError("volume cockpit layout fields do not match the v1 contract")
    if layout.get("identity") != "kaminos.volume.cockpit-layout.v1":
        raise ValueError("volume cockpit layout identity mismatch")
    layout_id = layout.get("layoutId")
    if not isinstance(layout_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", layout_id):
        raise ValueError("volume cockpit layout id is invalid")
    label = layout.get("label")
    if not isinstance(label, str) or not label.strip():
        raise ValueError("volume cockpit layout label is required")
    groups = layout.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("volume cockpit layout groups are required")

    schema = _validate_settings_preset_schema(
        schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    )
    known_control_ids = {
        descriptor["key"]
        for descriptor in [*schema.get("controls", []), *schema.get("rendererControls", [])]
    }
    retired_control_ids = {
        descriptor["key"]
        for descriptor in schema.get("retiredControls") or []
        if descriptor.get("axis") in {"domControls", "rendererControls"}
    }
    group_ids = set()
    placed_control_ids = set()
    normalized_groups = []
    retired_controls_stripped = []
    for group in groups:
        if not isinstance(group, dict) or set(group) != {"id", "label", "surface", "collapsed", "controlIds"}:
            raise ValueError("volume cockpit layout group fields do not match the v1 contract")
        group_id = group.get("id")
        if not isinstance(group_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", group_id):
            raise ValueError("volume cockpit layout group id is invalid")
        if group_id in group_ids:
            raise ValueError(f"volume cockpit layout duplicate group: {group_id}")
        group_ids.add(group_id)
        group_label = group.get("label")
        if not isinstance(group_label, str) or not group_label.strip():
            raise ValueError(f"volume cockpit layout group label is required: {group_id}")
        if group.get("surface") not in {"primary", "authored-mix"}:
            raise ValueError(f"volume cockpit layout group surface is invalid: {group_id}")
        if not isinstance(group.get("collapsed"), bool):
            raise ValueError(f"volume cockpit layout group collapse state is invalid: {group_id}")
        control_ids = group.get("controlIds")
        if not isinstance(control_ids, list) or any(not isinstance(control_id, str) for control_id in control_ids):
            raise ValueError(f"volume cockpit layout group control ids are invalid: {group_id}")
        admitted_control_ids = known_control_ids | (retired_control_ids if allow_declared_retired else set())
        unknown = sorted(set(control_ids) - admitted_control_ids)
        if unknown:
            raise ValueError(f"volume cockpit layout contains unknown controls: {','.join(unknown)}")
        duplicates = sorted(placed_control_ids.intersection(control_ids))
        if duplicates or len(set(control_ids)) != len(control_ids):
            duplicates = duplicates or sorted(control_id for control_id in set(control_ids) if control_ids.count(control_id) > 1)
            raise ValueError(f"volume cockpit layout contains duplicate controls: {','.join(duplicates)}")
        placed_control_ids.update(control_ids)
        retained_control_ids = []
        for control_id in control_ids:
            if control_id in retired_control_ids:
                retired_controls_stripped.append({"groupId": group_id, "id": control_id})
            else:
                retained_control_ids.append(control_id)
        normalized_groups.append({
            "id": group_id,
            "label": group_label.strip(),
            "surface": group["surface"],
            "collapsed": group["collapsed"],
            "controlIds": retained_control_ids,
        })
    return {
        "identity": "kaminos.volume.cockpit-layout.v1",
        "layoutId": layout_id,
        "label": label.strip(),
        "groups": normalized_groups,
    }, {
        "identity": "kaminos.volume.cockpit-layout-schema-projection.v1",
        "retiredControlsStripped": retired_controls_stripped,
    }


def _normalize_volume_cockpit_layout(layout, schema=None):
    normalized, _ = _project_volume_cockpit_layout(layout, schema)
    return normalized


def _volume_cockpit_layout_hash(layout):
    canonical = json.dumps(layout, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def write_volume_cockpit_layout(store_path, layout, activate=True, schema=None):
    store = _volume_settings_store_path(store_path)
    normalized = _normalize_volume_cockpit_layout(layout, schema)
    content_hash = _volume_cockpit_layout_hash(normalized)
    layout_path = store / "layouts" / f"{normalized['layoutId']}.json"
    written_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    artifact = {
        "identity": "kaminos.volume.cockpit-layout-artifact.v1",
        "layoutId": normalized["layoutId"],
        "contentHash": f"sha256:{content_hash}",
        "writtenAt": written_at,
        "source": volume_settings_server_source(),
        "layout": normalized,
    }
    with _volume_settings_store_lock(store):
        _atomic_write_json(layout_path, artifact)
        if activate:
            _atomic_write_json(store / "active.json", {
                "identity": "kaminos.volume.cockpit-layout-active.v1",
                "layoutId": normalized["layoutId"],
                "contentHash": artifact["contentHash"],
                "updatedAt": written_at,
            })
    return {
        "ok": True,
        "identity": "kaminos.volume.cockpit-layout-write-receipt.v1",
        "requested": {
            "storePath": str(store),
            "layoutId": normalized["layoutId"],
            "activate": bool(activate),
        },
        "effective": {
            "storePath": str(store),
            "layoutPath": str(layout_path),
            "layoutId": normalized["layoutId"],
            "label": normalized["label"],
            "contentHash": artifact["contentHash"],
            "active": bool(activate),
        },
        "layoutUrl": f"/api/volume-cockpit-layout?id={normalized['layoutId']}",
    }


def activate_volume_cockpit_layout(store_path, layout_id, schema=None):
    store = _volume_settings_store_path(store_path)
    with _volume_settings_store_lock(store):
        artifact = read_volume_cockpit_layout(store, layout_id, schema)
        content_hash = artifact["contentHash"]
        activated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _atomic_write_json(store / "active.json", {
            "identity": "kaminos.volume.cockpit-layout-active.v1",
            "layoutId": layout_id,
            "contentHash": content_hash,
            "updatedAt": activated_at,
        })
    return {
        "ok": True,
        "identity": "kaminos.volume.cockpit-layout-activation-receipt.v1",
        "requested": {
            "storePath": str(store),
            "layoutId": layout_id,
        },
        "effective": {
            "storePath": str(store),
            "layoutPath": artifact["layoutPath"],
            "layoutId": layout_id,
            "contentHash": content_hash,
            "active": True,
        },
    }


def read_volume_cockpit_layout(store_path, layout_id, schema=None):
    store = _volume_settings_store_path(store_path)
    if not isinstance(layout_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", layout_id):
        raise ValueError("volume cockpit layout id is invalid")
    layout_path = store / "layouts" / f"{layout_id}.json"
    try:
        artifact = _read_json_object(layout_path, "cockpit layout artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume cockpit layout not found: {layout_id}") from error
    if artifact.get("identity") != "kaminos.volume.cockpit-layout-artifact.v1" or artifact.get("layoutId") != layout_id:
        raise ValueError("volume cockpit layout artifact identity mismatch")
    source_layout = artifact.get("layout")
    content_hash = f"sha256:{_volume_cockpit_layout_hash(source_layout)}"
    if artifact.get("contentHash") != content_hash:
        raise ValueError("volume cockpit layout artifact content hash mismatch")
    normalized, schema_projection = _project_volume_cockpit_layout(
        source_layout,
        schema,
        allow_declared_retired=True,
    )
    return {
        **artifact,
        "layout": normalized,
        "schemaProjection": schema_projection,
        "layoutPath": str(layout_path),
        "storePath": str(store),
    }


def list_volume_cockpit_layouts(store_path, schema=None):
    store = _volume_settings_store_path(store_path)
    layouts_dir = store / "layouts"
    layouts_dir.mkdir(parents=True, exist_ok=True)
    active_path = store / "active.json"
    active_layout_id = None
    active_content_hash = None
    if active_path.exists():
        active = _read_json_object(active_path, "cockpit layout active pointer")
        if set(active) != {"identity", "layoutId", "contentHash", "updatedAt"}:
            raise ValueError("volume cockpit layout active pointer fields do not match the v1 contract")
        if active.get("identity") != "kaminos.volume.cockpit-layout-active.v1":
            raise ValueError("volume cockpit layout active pointer identity mismatch")
        active_layout_id = active.get("layoutId")
        active_content_hash = active.get("contentHash")
    entries = []
    for layout_path in layouts_dir.glob("*.json"):
        artifact = read_volume_cockpit_layout(store, layout_path.stem, schema)
        entries.append({
            "layoutId": artifact["layoutId"],
            "label": artifact["layout"]["label"],
            "contentHash": artifact["contentHash"],
            "writtenAt": artifact.get("writtenAt"),
            "groupCount": len(artifact["layout"]["groups"]),
            "retiredControlsStripped": (artifact.get("schemaProjection") or {}).get("retiredControlsStripped") or [],
        })
    entries.sort(key=lambda entry: (entry.get("writtenAt") or "", entry["layoutId"]), reverse=True)
    if active_layout_id and active_layout_id not in {entry["layoutId"] for entry in entries}:
        raise ValueError("volume cockpit layout active pointer names a missing layout")
    if active_layout_id:
        active_entry = next(entry for entry in entries if entry["layoutId"] == active_layout_id)
        if active_entry["contentHash"] != active_content_hash:
            raise ValueError("volume cockpit layout active pointer content hash mismatch")
    return {
        "identity": "kaminos.volume.cockpit-layout-index.v1",
        "storePath": str(store),
        "activeLayoutId": active_layout_id,
        "entries": entries,
    }


def _volume_settings_alias_for_label(store, label):
    base = _volume_settings_alias_slug(label)

    def existing_label(alias):
        path = store / "aliases" / f"{alias}.json"
        if not path.exists():
            return None
        document = _read_json_object(path, "alias")
        if document.get("identity") != "kaminos-volume-settings-preset-alias-v1" or document.get("alias") != alias:
            raise ValueError(f"volume settings preset alias identity mismatch: {alias}")
        current_label = document.get("label")
        if not isinstance(current_label, str) or not current_label.strip():
            raise ValueError(f"volume settings preset alias label is invalid: {alias}")
        return current_label

    current_label = existing_label(base)
    if current_label is None or current_label == label:
        return base
    suffix = hashlib.sha256(label.encode("utf-8")).hexdigest()[:12]
    disambiguated = f"{base[:81].rstrip('.-')}--{suffix}"
    current_label = existing_label(disambiguated)
    if current_label is not None and current_label != label:
        raise ValueError("volume settings preset alias hash collision")
    return disambiguated


def _validate_volume_settings_projection_lineage(lineage, schema):
    if lineage is None:
        return None
    expected_fields = {
        "identity",
        "parentPresetId",
        "parentContentHash",
        "profile",
    }
    if not isinstance(lineage, dict) or set(lineage) != expected_fields:
        raise ValueError("volume settings preset projection lineage fields mismatch")
    if lineage.get("identity") != VOLUME_SETTINGS_PRESET_PROJECTION_LINEAGE_IDENTITY:
        raise ValueError("volume settings preset projection lineage identity mismatch")
    parent_id = lineage.get("parentPresetId")
    if not isinstance(parent_id, str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", parent_id):
        raise ValueError("volume settings preset projection parent identity is invalid")
    if lineage.get("parentContentHash") != f"sha256:{parent_id[4:]}":
        raise ValueError("volume settings preset projection parent content hash mismatch")
    profile = lineage.get("profile")
    if not isinstance(profile, dict) or set(profile) != {
        "simulationResolution",
        "raySteps",
        "adaptiveRays",
        "renderScale",
    }:
        raise ValueError("volume settings preset projection lineage profile mismatch")
    resolution = profile["simulationResolution"]
    resolution_schema = next(
        (entry for entry in schema.get("controls") or [] if entry.get("key") == "volume-resolution"),
        None,
    )
    if (
        isinstance(resolution, bool)
        or not isinstance(resolution, int)
        or resolution not in {int(value) for value in (resolution_schema or {}).get("allowedValues") or []}
    ):
        raise ValueError("volume settings preset projection lineage profile mismatch")
    ray_steps = profile["raySteps"]
    if isinstance(ray_steps, bool) or not isinstance(ray_steps, int) or not 24 <= ray_steps <= 160:
        raise ValueError("volume settings preset projection lineage profile mismatch")
    try:
        adaptive_rays = _exact_profile_tick(
            profile["adaptiveRays"], Decimal("0"), Decimal("1"), Decimal("0.05"), "adaptiveRays"
        )
        render_scale = _exact_profile_tick(
            profile["renderScale"], Decimal("0.1"), Decimal("0.3"), Decimal("0.001"), "renderScale"
        )
    except ValueError as error:
        raise ValueError("volume settings preset projection lineage profile mismatch") from error
    if profile["adaptiveRays"] != adaptive_rays or profile["renderScale"] != render_scale:
        raise ValueError("volume settings preset projection lineage profile mismatch")
    return copy.deepcopy(lineage)


def write_volume_settings_preset(
    store_path,
    label,
    payload,
    source,
    schema=None,
    *,
    preserve_existing_alias=False,
    projection_lineage=None,
):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    validate_volume_settings_preset_payload(payload, schema)
    store = _volume_settings_store_path(store_path)
    effective_label = str(label or "").strip() or "Unnamed preset"
    projection_lineage = _validate_volume_settings_projection_lineage(projection_lineage, schema)
    content_hash = _volume_settings_content_hash(payload, schema)
    preset_id = f"vsp-{content_hash}"
    written_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    document = {
        "identity": VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY,
        "presetId": preset_id,
        "contentHash": f"sha256:{content_hash}",
        "schemaIdentity": schema["identity"],
        "controlCount": schema["controlCount"],
        "initialLabel": effective_label,
        "writtenAt": written_at,
        "source": dict(source or {}),
        "preset": payload,
    }
    if projection_lineage is not None:
        document["projectionLineage"] = projection_lineage
    with _volume_settings_store_lock(store):
        alias = _volume_settings_alias_for_label(store, effective_label)
        preset_path = store / "presets" / f"{preset_id}.json"
        alias_path = store / "aliases" / f"{alias}.json"
        if preserve_existing_alias and alias_path.exists():
            existing_alias = _read_json_object(alias_path, "alias")
            if (
                existing_alias.get("identity") != "kaminos-volume-settings-preset-alias-v1"
                or existing_alias.get("alias") != alias
            ):
                raise ValueError(f"volume settings preset alias identity mismatch: {alias}")
            if existing_alias.get("presetId") != preset_id:
                raise ValueError(f"projection would repoint existing alias: {alias}")
        created = _atomic_create_json(preset_path, document)
        idempotent = not created
        if idempotent:
            existing = _read_json_object(preset_path, "artifact")
            read_volume_settings_preset(store, preset_id, schema)
            if existing.get("preset") != payload:
                raise ValueError(
                    "volume settings preset content identity resolves to a different canonical payload"
                )
            if existing.get("projectionLineage") != projection_lineage:
                raise ValueError(
                    "volume settings preset content identity resolves to different parent lineage"
                )

        alias_document = {
            "identity": "kaminos-volume-settings-preset-alias-v1",
            "alias": alias,
            "label": effective_label,
            "presetId": preset_id,
            "contentHash": document["contentHash"],
            "schemaIdentity": schema["identity"],
            "updatedAt": written_at,
            "source": dict(source or {}),
        }
        _atomic_write_json(alias_path, alias_document)
    preset_url = f"/volume-settings-preset.html?preset={preset_id}"
    return {
        "ok": True,
        "identity": "kaminos-volume-settings-preset-write-receipt-v1",
        "requested": {
            "label": label,
            "storePath": str(store),
            "schemaIdentity": payload.get("schemaIdentity"),
            "controlCount": payload.get("controlCount"),
        },
        "effective": {
            "alias": alias,
            "label": effective_label,
            "presetId": preset_id,
            "contentHash": document["contentHash"],
            "storePath": str(store),
            "schemaIdentity": schema["identity"],
            "controlCount": schema["controlCount"],
            "rendererControlCount": len(payload.get("rendererControls") or {}),
            "presentationControlCount": len(payload.get("presentationControls") or {}),
            "idempotent": idempotent,
        },
        "presetUrl": preset_url,
        "presetViewUrls": {
            view: f"{preset_url}&view={view}"
            for view in ("splat-only", "raymarch-only", "smoke-hybrid", "full-hybrid-diagnostic")
        },
    }


def _exact_profile_tick(value, minimum, maximum, quantum, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    try:
        decimal_value = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"{label} must be a finite number") from error
    if decimal_value < minimum or decimal_value > maximum:
        raise ValueError(
            f"{label} must be from {minimum} through {maximum} in exact {quantum} increments"
        )
    ticks = decimal_value / quantum
    if ticks != ticks.to_integral_value():
        raise ValueError(
            f"{label} must be from {minimum} through {maximum} in exact {quantum} increments"
        )
    canonical = decimal_value.quantize(quantum)
    if canonical == canonical.to_integral_value():
        return int(canonical)
    return float(canonical)


def project_volume_settings_preset(store_path, preset_ref, label, profile, source, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    expected_profile_fields = {
        "simulationResolution",
        "raySteps",
        "adaptiveRays",
        "renderScale",
    }
    if not isinstance(profile, dict) or set(profile) != expected_profile_fields:
        raise ValueError(
            "projection profile requires exactly adaptiveRays, raySteps, renderScale, and simulationResolution"
        )

    resolution = profile["simulationResolution"]
    if isinstance(resolution, bool) or not isinstance(resolution, int):
        raise ValueError("simulation resolution must be an integer")
    resolution_schema = next(
        (entry for entry in schema.get("controls") or [] if entry.get("key") == "volume-resolution"),
        None,
    )
    allowed_resolutions = {
        int(value) for value in (resolution_schema or {}).get("allowedValues") or []
    }
    if resolution not in allowed_resolutions:
        raise ValueError(f"unsupported simulation resolution: {resolution}")

    ray_steps = profile["raySteps"]
    if isinstance(ray_steps, bool) or not isinstance(ray_steps, int) or not 24 <= ray_steps <= 160:
        raise ValueError("raySteps must be an integer from 24 through 160")
    adaptive_rays = _exact_profile_tick(
        profile["adaptiveRays"], Decimal("0"), Decimal("1"), Decimal("0.05"), "adaptiveRays"
    )
    render_scale = _exact_profile_tick(
        profile["renderScale"], Decimal("0.1"), Decimal("0.3"), Decimal("0.001"), "renderScale"
    )

    normalized_profile = {
        "simulationResolution": resolution,
        "raySteps": ray_steps,
        "adaptiveRays": adaptive_rays,
        "renderScale": render_scale,
    }
    parent = read_volume_settings_preset(store_path, preset_ref, schema)
    schema_projection = parent.get("schemaProjection") or {}
    if schema_projection.get("defaultsApplied") or schema_projection.get("retiredControlsStripped"):
        raise ValueError(
            "projection source requires schema normalization outside the four-control profile contract"
        )
    projected = copy.deepcopy(parent["preset"])
    updates = {
        "volume-resolution": str(resolution),
        "volume-steps": ray_steps,
        "volume-adaptive-rays": normalized_profile["adaptiveRays"],
        "volume-render-scale": normalized_profile["renderScale"],
    }
    route = urlparse(projected["route"])
    route_entries = parse_qsl(route.query, keep_blank_values=True)
    route_indices = {key: index for index, (key, _) in enumerate(route_entries)}
    changed_controls = []
    for key, value in updates.items():
        descriptor = projected["domControls"].get(key)
        if not isinstance(descriptor, dict):
            raise ValueError(f"projection source is missing canonical control: {key}")
        parameter = descriptor.get("param")
        if parameter not in route_indices:
            raise ValueError(f"projection source route is missing canonical parameter: {parameter}")
        before = descriptor.get("rawValue") if "rawValue" in descriptor else descriptor.get("value")
        value_field = "rawValue" if "rawValue" in descriptor else "value"
        descriptor[value_field] = value
        route_index = route_indices[parameter]
        route_entries[route_index] = (parameter, _settings_preset_route_value(value))
        changed_controls.append({
            "key": key,
            "param": parameter,
            "before": before,
            "requested": value,
            "effective": value,
        })
    projected["route"] = route._replace(query=urlencode(route_entries)).geturl()
    validate_volume_settings_preset_payload(projected, schema)

    projected_preset_id = f"vsp-{_volume_settings_content_hash(projected, schema)}"
    if projected_preset_id == parent["presetId"]:
        raise ValueError("projection does not create a distinct child preset")

    projection_lineage = {
        "identity": VOLUME_SETTINGS_PRESET_PROJECTION_LINEAGE_IDENTITY,
        "parentPresetId": parent["presetId"],
        "parentContentHash": parent["contentHash"],
        "profile": dict(normalized_profile),
    }
    derived = write_volume_settings_preset(
        store_path,
        label,
        projected,
        source,
        schema,
        preserve_existing_alias=True,
        projection_lineage=projection_lineage,
    )
    store = _volume_settings_store_path(store_path)
    return {
        "ok": True,
        "identity": VOLUME_SETTINGS_PRESET_PROJECTION_RECEIPT_IDENTITY,
        "parent": {
            "requestedPresetRef": str(preset_ref),
            "alias": parent.get("alias"),
            "label": parent.get("label"),
            "presetId": parent["presetId"],
            "contentHash": parent["contentHash"],
            "artifactPath": str(store / "presets" / f"{parent['presetId']}.json"),
        },
        "requested": {
            "label": label,
            "storePath": str(store),
            "profile": dict(profile),
        },
        "effective": {
            **derived["effective"],
            "artifactPath": str(store / "presets" / f"{derived['effective']['presetId']}.json"),
            "profile": normalized_profile,
            "changedControls": changed_controls,
            "sourcePresetAuthority": "shared-volume-settings-preset-v2",
            "projectionLineage": projection_lineage,
        },
        "presetUrl": derived["presetUrl"],
        "presetViewUrls": derived["presetViewUrls"],
    }


def read_volume_settings_preset(store_path, preset_ref, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    store = _volume_settings_store_path(store_path)
    requested = str(preset_ref or "").strip()
    if not requested:
        raise ValueError("volume settings preset id or alias is required")
    alias_document = None
    if requested.startswith("vsp-"):
        if not re.fullmatch(r"vsp-[0-9a-f]{64}", requested):
            raise ValueError("volume settings preset content id is invalid")
        preset_id = requested
    else:
        alias = _volume_settings_alias_slug(requested)
        if alias != requested:
            raise ValueError("volume settings preset alias is invalid")
        alias_path = store / "aliases" / f"{alias}.json"
        try:
            alias_document = _read_json_object(alias_path, "alias")
        except FileNotFoundError as error:
            raise FileNotFoundError(f"volume settings preset alias not found: {alias}") from error
        if alias_document.get("identity") != "kaminos-volume-settings-preset-alias-v1" or alias_document.get("alias") != alias:
            raise ValueError("volume settings preset alias identity mismatch")
        if alias_document.get("schemaIdentity") != schema.get("identity"):
            raise ValueError("volume settings preset alias schema mismatch")
        if not isinstance(alias_document.get("label"), str) or not alias_document["label"].strip():
            raise ValueError("volume settings preset alias label is invalid")
        preset_id = alias_document.get("presetId")
        if not isinstance(preset_id, str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", preset_id):
            raise ValueError("volume settings preset alias target is invalid")

    preset_path = store / "presets" / f"{preset_id}.json"
    try:
        document = _read_json_object(preset_path, "artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume settings preset not found: {preset_id}") from error
    if document.get("identity") != VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY or document.get("presetId") != preset_id:
        raise ValueError("volume settings preset artifact identity mismatch")
    raw_payload = document.get("preset") or {}
    if (
        document.get("schemaIdentity") != schema.get("identity")
        or document.get("controlCount") != raw_payload.get("controlCount")
    ):
        raise ValueError("volume settings preset artifact schema mismatch")
    content_hash = _volume_settings_content_hash(raw_payload, schema)
    if document.get("contentHash") != f"sha256:{content_hash}" or preset_id != f"vsp-{content_hash}":
        raise ValueError("volume settings preset artifact content hash mismatch")
    _validate_volume_settings_projection_lineage(document.get("projectionLineage"), schema)
    if alias_document and alias_document.get("contentHash") != document.get("contentHash"):
        raise ValueError("volume settings preset alias content hash mismatch")
    normalized_payload, schema_projection = normalize_volume_settings_preset_payload(raw_payload, schema)
    validate_volume_settings_preset_payload(normalized_payload, schema)
    return {
        **document,
        "sourceControlCount": raw_payload.get("controlCount"),
        "sourceRendererControlCount": raw_payload.get("rendererControlCount", 0),
        "sourcePresentationControlCount": raw_payload.get("presentationControlCount", 0),
        "controlCount": normalized_payload.get("controlCount"),
        "preset": normalized_payload,
        "schemaProjection": schema_projection,
        "requestedPresetRef": requested,
        "alias": alias_document.get("alias") if alias_document else None,
        "label": alias_document.get("label") if alias_document else document.get("initialLabel"),
        "storePath": str(store),
    }


def list_volume_settings_presets(store_path, schema=None):
    schema = schema or json.loads(VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    store = _volume_settings_store_path(store_path)
    aliases_dir = store / "aliases"
    aliases_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for alias_path in aliases_dir.glob("*.json"):
        try:
            alias_document = _read_json_object(alias_path, "alias")
        except ValueError as error:
            raise ValueError(f"volume settings preset alias index is corrupt at {alias_path.name}: {error}") from error
        alias = alias_document.get("alias")
        if alias_path.stem != alias:
            raise ValueError(f"volume settings preset alias filename mismatch: {alias_path.name}")
        document = read_volume_settings_preset(store, alias, schema)
        entries.append({
            "alias": alias,
            "label": document["label"],
            "presetId": document["presetId"],
            "contentHash": document["contentHash"],
            "schemaIdentity": document["schemaIdentity"],
            "controlCount": document["controlCount"],
            "rendererControlCount": len((document.get("preset") or {}).get("rendererControls") or {}),
            "presentationControlCount": len((document.get("preset") or {}).get("presentationControls") or {}),
            "defaultsApplied": (document.get("schemaProjection") or {}).get("defaultsApplied") or [],
            "retiredControlsStripped": (document.get("schemaProjection") or {}).get("retiredControlsStripped") or [],
            "updatedAt": alias_document.get("updatedAt"),
            "source": alias_document.get("source") or {},
        })
    entries.sort(key=lambda entry: (entry.get("updatedAt") or "", entry["alias"]), reverse=True)
    return {
        "identity": "kaminos-volume-settings-preset-index-v1",
        "storePath": str(store),
        "schemaIdentity": schema["identity"],
        "controlCount": schema["controlCount"],
        "rendererControlCount": len(schema.get("rendererControls") or []),
        "presentationControlCount": len(schema.get("presentationControls") or []),
        "entries": entries,
    }


def volume_settings_server_source():
    source = {"repoRoot": str(ROOT), "serverPort": PORT}
    for field, command in (
        ("branch", ["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        ("commit", ["git", "rev-parse", "HEAD"]),
    ):
        try:
            source[field] = subprocess.check_output(command, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.SubprocessError):
            source[field] = "unavailable"
    try:
        source["dirty"] = bool(subprocess.check_output(
            ["git", "status", "--porcelain", "--untracked-files=normal"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip())
    except (OSError, subprocess.SubprocessError):
        source["dirty"] = None
    return source


def current_kaminos_source_commit():
    commit = volume_settings_server_source().get("commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError(f"invalid Kaminos source commit: {commit}")
    return commit


def write_volume_basin_promotion_package(request):
    if not isinstance(request, dict):
        raise ValueError("basin promotion request must be a JSON object")
    label = request.get("label")
    handle = request.get("handle")
    promotion_root = request.get("promotionRoot")
    preset = request.get("preset")
    effective_state = request.get("effectiveState")
    if not isinstance(label, str) or not label.strip():
        raise ValueError("basin promotion label is required")
    if not isinstance(handle, str) or not handle.strip():
        raise ValueError("basin promotion handle is required")
    if not isinstance(promotion_root, str) or not promotion_root.strip():
        raise ValueError("caller-selected basin promotionRoot is required")
    if not isinstance(preset, dict):
        raise ValueError("basin promotion preset must be a JSON object")
    if not isinstance(effective_state, dict):
        raise ValueError("basin promotion effectiveState must be a JSON object")

    source = {
        **volume_settings_server_source(),
        "promotionRoot": str(Path(promotion_root).expanduser()),
    }
    preset_receipt = write_volume_settings_preset(VOLUME_SETTINGS_STORE, label, preset, source)
    preset_path = VOLUME_SETTINGS_STORE / "presets" / f"{preset_receipt['effective']['presetId']}.json"
    if not preset_path.exists():
        raise FileNotFoundError(f"settings preset artifact was not written: {preset_path}")

    with tempfile.TemporaryDirectory(prefix="kaminos-basin-promotion-") as temporary:
        effective_state_path = Path(temporary) / "effective-state.json"
        effective_state_path.write_text(json.dumps(effective_state, indent=2) + "\n")
        command = [
            "node",
            str(VOLUME_BASIN_PROMOTION_CLI),
            "promote",
            "--handle", handle,
            "--label", label,
            "--root", str(Path(promotion_root).expanduser()),
            "--settings-preset", str(preset_path),
            "--settings-schema", str(VOLUME_SETTINGS_PRESET_SCHEMA_PATH),
            "--effective-state", str(effective_state_path),
            "--source-commit", str(request.get("sourceCommit") or current_kaminos_source_commit()),
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    if result.returncode != 0:
        raise ValueError(f"basin promotion package export failed: {result.stderr.strip() or result.stdout.strip()}")
    try:
        promotion_receipt = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"basin promotion exporter returned invalid JSON: {error}") from error
    return {
        "ok": True,
        "identity": "kaminos.volume.basin-promotion-write-receipt.v1",
        "settingsPreset": preset_receipt["effective"],
        "promotion": promotion_receipt,
    }


def parse_server_arguments(argv):
    port = 8090
    store = VOLUME_SETTINGS_STORE_DEFAULT
    basin_session_store = VOLUME_BASIN_SESSION_STORE_DEFAULT
    cockpit_layout_store = VOLUME_COCKPIT_LAYOUT_STORE_DEFAULT
    arguments = list(argv)
    if arguments and not arguments[0].startswith("-"):
        try:
            port = int(arguments.pop(0))
        except ValueError as error:
            raise ValueError("server port must be an integer") from error
    while arguments:
        argument = arguments.pop(0)
        if argument not in {
            "--volume-settings-store",
            "--volume-basin-session-store",
            "--volume-cockpit-layout-store",
        } or not arguments:
            raise ValueError(f"unsupported server argument: {argument}")
        path = _volume_settings_store_path(arguments.pop(0))
        if argument == "--volume-settings-store":
            store = path
        elif argument == "--volume-basin-session-store":
            basin_session_store = path
        else:
            cockpit_layout_store = path
    return port, store, basin_session_store, cockpit_layout_store

# Directories the browse API can access
SCENES_DIR = ROOT / "scenes"
SCENES_DIR.mkdir(exist_ok=True)
KAMINOS_ASSETS_DIR = Path(os.environ.get(
    "KAMINOS_ASSETS_DIR",
    os.path.expanduser("~/.local/state/kaminos/assets"),
)).expanduser()
KAMINOS_SPLAT_INBOX_DIR = Path(os.environ.get(
    "KAMINOS_SPLAT_INBOX_DIR",
    str(KAMINOS_ASSETS_DIR / "splats" / "inbox"),
)).expanduser()
KAMINOS_SPLAT_PRODUCTION_DIR = Path(os.environ.get(
    "KAMINOS_SPLAT_PRODUCTION_DIR",
    str(KAMINOS_ASSETS_DIR / "splats" / "production"),
)).expanduser()
KAMINOS_PIPELINE_RUNS_DIR = Path(os.environ.get(
    "KAMINOS_PIPELINE_RUNS_DIR",
    str(KAMINOS_ASSETS_DIR / "pipeline-runs"),
)).expanduser()
KAMINOS_IMAGE_INBOX_DIR = Path(os.environ.get(
    "KAMINOS_IMAGE_INBOX_DIR",
    str(KAMINOS_ASSETS_DIR / "images" / "inbox"),
)).expanduser()
KAMINOS_RECONSTRUCTIONS_DIR = Path(os.environ.get(
    "KAMINOS_RECONSTRUCTIONS_DIR",
    str(KAMINOS_ASSETS_DIR / "reconstructions"),
)).expanduser()

BROWSE_ROOTS = {
    "scratch": ROOT / "scratch",
    "scenes": SCENES_DIR,
    "splat-inbox": KAMINOS_SPLAT_INBOX_DIR,
    "splat-production": KAMINOS_SPLAT_PRODUCTION_DIR,
    "image-inbox": KAMINOS_IMAGE_INBOX_DIR,
    "reconstructions": KAMINOS_RECONSTRUCTIONS_DIR,
    "pipeline-runs": KAMINOS_PIPELINE_RUNS_DIR,
    "greenroom": Path(os.environ.get(
        "GPU_GREENROOM_DIR",
        os.path.expanduser("~/.local/state/gpu-greenroom"),
    )),
    "lerms-preview": Path(os.environ.get(
        "KAMINOS_LERMS_PREVIEW_ROOT",
        "/private/tmp",
    )),
    "pixal3d": Path(os.path.expanduser("~/dev/pixal3d-mlx/outputs")),
    "trellis2mlx": Path(os.path.expanduser("~/dev/trellis2mlx/assets/outputs")),
}
PIPELINE_SOURCE_ROOT_EXCLUSIONS = {
    "lerms-preview",
}

GREENROOM_STATUS_DIRS = ("done", "failed", "running", "pending", "cancelled")
MESH_EXTENSIONS = {".glb", ".gltf", ".obj", ".ply", ".spz"}
SPLAT_EXTENSIONS = {".ply", ".spz"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SPLAT_CORRECTION_SCHEMA = "kaminos.splat-correction.v0"
HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV = "KAMINOS_HYBRID_SPLAT_OVERLAY_MODULE_URL"
HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV_LEGACY = "KAMINOS_HYBRID_SPLAT_MODULE_URL"
FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA = "kaminos.forge-host.registry-snapshot.v0"
FORGE_HOST_ENDPOINT_REGISTRY_PATH = Path(os.environ.get(
    "KAMINOS_FORGE_HOST_ENDPOINT_REGISTRY",
    os.path.expanduser("~/.local/state/epistaxis/directive-alert-endpoints.json"),
)).expanduser()
FORGE_HOST_DIAULOS_REGISTRY_PATH = Path(os.environ.get(
    "KAMINOS_FORGE_HOST_DIAULOS_REGISTRY",
    os.path.expanduser("~/.local/state/epistaxis/directive-state/epistaxis/metadosis/diaulos-registry/diauloi.json"),
)).expanduser()
ASSET_ROOTS = [
    {
        "id": "splat-inbox",
        "label": "Experimental Splat Inbox",
        "kind": "splat",
        "stage": "experimental",
        "path": KAMINOS_SPLAT_INBOX_DIR,
    },
    {
        "id": "splat-production",
        "label": "Production Splats",
        "kind": "splat",
        "stage": "production",
        "path": KAMINOS_SPLAT_PRODUCTION_DIR,
    },
    {
        "id": "image-inbox",
        "label": "Local Image Inbox",
        "kind": "image",
        "stage": "working",
        "path": KAMINOS_IMAGE_INBOX_DIR,
    },
]
for index, extra_root in enumerate(filter(None, os.environ.get("KAMINOS_SPLAT_ASSET_ROOTS", "").split(os.pathsep)), 1):
    root_id = f"splat-extra-{index}"
    root_path = Path(extra_root).expanduser()
    BROWSE_ROOTS[root_id] = root_path
    ASSET_ROOTS.append({
        "id": root_id,
        "label": f"Experimental Splat Root {index}",
        "kind": "splat",
        "stage": "experimental",
        "path": root_path,
    })
JOB_OUTPUT_EVENTS = []
JOB_OUTPUT_EVENTS_LOCK = threading.Lock()
PIPELINE_MANIFEST_PATH = ROOT / "pipelines" / "asset-pipelines.json"
PIPELINE_WITNESS_PATH = ROOT / "pipeline-witness.mjs"


def runtime_config():
    """Return runtime-only browser defaults for this dev server instance."""
    module_url = (
        os.environ.get(HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV)
        or os.environ.get(HYBRID_SPLAT_OVERLAY_MODULE_URL_ENV_LEGACY)
        or ""
    ).strip()
    return {
        "schema": "kaminos.runtime-config.v0",
        "hybridSplatOverlayModuleUrl": module_url or None,
        "volumeBasinSessionStore": str(VOLUME_BASIN_SESSION_STORE),
        "volumeCockpitLayoutStore": str(VOLUME_COCKPIT_LAYOUT_STORE),
        "source": volume_settings_server_source(),
    }


def _read_json_file(path):
    with Path(path).expanduser().open() as handle:
        return json.load(handle)


def _registry_file_status(path):
    resolved = Path(path).expanduser()
    return {
        "path": str(resolved),
        "exists": resolved.exists(),
        "loaded": False,
        "schema": None,
    }


def _diaulos_registry_index(diaulos_registry):
    rows = diaulos_registry.get("diauloi") if isinstance(diaulos_registry, dict) else None
    index = {}
    for row in rows or []:
        handle = row.get("handle")
        if handle:
            index[str(handle)] = row
        for alias in row.get("aliases") or []:
            index[str(alias)] = row
    return index


def build_forge_host_registry_snapshot(
    endpoint_registry_path=FORGE_HOST_ENDPOINT_REGISTRY_PATH,
    diaulos_registry_path=FORGE_HOST_DIAULOS_REGISTRY_PATH,
):
    """Build a source-honest Forge Host view over live Epistaxis registries."""
    loaded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    warnings = []
    endpoint_status = _registry_file_status(endpoint_registry_path)
    diaulos_status = _registry_file_status(diaulos_registry_path)
    endpoint_registry = None
    diaulos_registry = None

    try:
        endpoint_registry = _read_json_file(endpoint_registry_path)
        endpoint_status["loaded"] = True
        endpoint_status["schema"] = endpoint_registry.get("schema")
    except FileNotFoundError:
        warnings.append(f"endpoint registry missing: {endpoint_status['path']}")
    except json.JSONDecodeError as error:
        warnings.append(f"endpoint registry invalid JSON: {endpoint_status['path']}: {error}")

    try:
        diaulos_registry = _read_json_file(diaulos_registry_path)
        diaulos_status["loaded"] = True
        diaulos_status["schema"] = diaulos_registry.get("schema")
    except FileNotFoundError:
        warnings.append(f"diaulos registry missing: {diaulos_status['path']}")
    except json.JSONDecodeError as error:
        warnings.append(f"diaulos registry invalid JSON: {diaulos_status['path']}: {error}")

    diauloi = _diaulos_registry_index(diaulos_registry or {})
    endpoints = []
    for row in (endpoint_registry or {}).get("endpoints", []):
        if row.get("status") != "active":
            continue
        diaulos = str(row.get("diaulos") or "").strip()
        if not diaulos:
            warnings.append("active endpoint row missing diaulos handle")
            continue
        registry_row = diauloi.get(diaulos) or {}
        endpoints.append({
            "diaulos": diaulos,
            "diaulosId": registry_row.get("id"),
            "status": row.get("status"),
            "observedAt": row.get("observed_at"),
            "endpoint": row.get("endpoint") or {},
            "registryStatus": registry_row.get("status"),
            "sourceTopoi": registry_row.get("source_topoi") or [],
        })

    source_authority = "live_registry" if endpoint_status["loaded"] else "fallback"
    return {
        "schema": FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA,
        "sourceAuthority": source_authority,
        "loadedAt": loaded_at,
        "endpointRegistry": endpoint_status,
        "diaulosRegistry": diaulos_status,
        "endpoints": endpoints,
        "warnings": warnings,
    }


def splat_asset_root_allows_pointer(root_name):
    return any(root.get("id") == root_name and root.get("kind") == "splat" for root in ASSET_ROOTS)


def _sha256_file(path):
    import hashlib
    digest = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pipeline_manifest_payload():
    document = json.loads(PIPELINE_MANIFEST_PATH.read_text())
    return {
        **document,
        "manifestPath": str(PIPELINE_MANIFEST_PATH),
        "manifestSha256": _sha256_file(PIPELINE_MANIFEST_PATH),
    }


def _declared_read_roots():
    roots = [ROOT]
    roots.extend(Path(path).expanduser() for path in BROWSE_ROOTS.values())
    return [root.resolve() for root in roots if root.exists()]


def _declared_pipeline_source_roots():
    roots = [ROOT]
    roots.extend(
        Path(path).expanduser()
        for root_id, path in BROWSE_ROOTS.items()
        if root_id not in PIPELINE_SOURCE_ROOT_EXCLUSIONS
    )
    return [root.resolve() for root in roots if root.exists()]


def _resolve_api_read_source(source):
    parsed = urlparse(source)
    if parsed.path != "/api/read":
        raise ValueError("source route must use /api/read")
    params = parse_qs(parsed.query)
    root_name = params.get("root", [""])[0]
    rel_path = params.get("path", [""])[0]
    root = BROWSE_ROOTS.get(root_name)
    if not root:
        raise ValueError(f"Unknown root: {root_name}")
    lexical_target = Path(root).expanduser() / rel_path
    target = lexical_target.resolve()
    if not target.is_relative_to(Path(root).expanduser().resolve()):
        if splat_asset_root_allows_pointer(root_name) and lexical_target.suffix.lower() in SPLAT_EXTENSIONS:
            target = lexical_target
        else:
            raise PermissionError("Path traversal")
    if not target.is_file():
        raise FileNotFoundError(str(target))
    return target.resolve()


def _api_read_source_root(source):
    parsed = urlparse(source)
    if parsed.path != "/api/read":
        raise ValueError("source route must use /api/read")
    params = parse_qs(parsed.query)
    return params.get("root", [""])[0]


def resolve_pipeline_source(payload):
    source = str(payload.get("source") or "").strip()
    source_path = str(payload.get("sourcePath") or "").strip()
    if source.startswith("/api/read"):
        if _api_read_source_root(source) in PIPELINE_SOURCE_ROOT_EXCLUSIONS:
            raise PermissionError("pipeline source must live under declared Kaminos roots")
        target = _resolve_api_read_source(source)
        return {"source": source, "path": str(target)}
    if source_path:
        candidate = Path(source_path).expanduser()
    elif source:
        candidate = Path(source).expanduser()
    else:
        raise ValueError("source or sourcePath required")
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    target = candidate.resolve()
    if not target.is_file():
        raise FileNotFoundError(str(target))
    if not any(target.is_relative_to(root) for root in _declared_pipeline_source_roots()):
        raise PermissionError("pipeline source must live under declared Kaminos roots")
    return {"source": source or source_path, "path": str(target)}


def _default_pipeline_out_dir(pipeline_id):
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", pipeline_id or "pipeline").strip("-") or "pipeline"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return (KAMINOS_PIPELINE_RUNS_DIR / f"{stamp}-{os.getpid()}-{safe}").resolve()


def run_pipeline_witness(payload):
    pipeline_id = str(payload.get("pipelineId") or payload.get("pipeline_id") or "").strip()
    if not pipeline_id:
        raise ValueError("pipelineId required")
    source = resolve_pipeline_source(payload)
    out_dir_raw = str(payload.get("outDir") or payload.get("out_dir") or "").strip()
    out_dir = Path(out_dir_raw).expanduser() if out_dir_raw else _default_pipeline_out_dir(pipeline_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "pipeline-witness.json"
    command = [
        os.environ.get("KAMINOS_NODE", "node"),
        str(PIPELINE_WITNESS_PATH),
        "--manifest", str(PIPELINE_MANIFEST_PATH),
        "--pipeline-id", pipeline_id,
        "--input", source["path"],
        "--out-dir", str(out_dir),
        "--report", str(report_path),
    ]
    timeout = int(os.environ.get("KAMINOS_PIPELINE_WITNESS_TIMEOUT", "360"))
    proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    report = json.loads(report_path.read_text()) if report_path.exists() else None
    bundle_path = Path(report["bundleIndex"]["path"]) if report and report.get("bundleIndex") else None
    bundle = json.loads(bundle_path.read_text()) if bundle_path and bundle_path.exists() else None
    return {
        "schema": "kaminos.pipeline-run-result.v0",
        "ok": proc.returncode == 0 and bool(report and report.get("ok")),
        "pipelineId": pipeline_id,
        "source": source,
        "command": command,
        "exitCode": proc.returncode,
        "stdoutTail": proc.stdout[-4000:],
        "stderrTail": proc.stderr[-4000:],
        "report": {
            "path": str(report_path),
            "document": report,
        },
        "bundle": {
            "path": str(bundle_path) if bundle_path else None,
            "document": bundle,
        },
    }


def _pipeline_progress_event_from_line(line, stream_name):
    text = str(line or "").strip()
    if not text:
        return None
    try:
        event = json.loads(text)
    except json.JSONDecodeError:
        return None
    if event.get("schema") != "kaminos.pipeline-progress.v0":
        return None
    return {
        **event,
        "schema": "kaminos.pipeline-progress.v0",
        "kind": event.get("kind") or "pipeline-progress",
        "stream": stream_name,
    }


def _write_pipeline_stream_event(handler, event):
    body = (json.dumps(event, separators=(",", ":")) + "\n").encode()
    handler.wfile.write(body)
    handler.wfile.flush()


def run_pipeline_witness_stream(handler, payload):
    pipeline_id = str(payload.get("pipelineId") or payload.get("pipeline_id") or "").strip()
    if not pipeline_id:
        raise ValueError("pipelineId required")
    source = resolve_pipeline_source(payload)
    out_dir_raw = str(payload.get("outDir") or payload.get("out_dir") or "").strip()
    out_dir = Path(out_dir_raw).expanduser() if out_dir_raw else _default_pipeline_out_dir(pipeline_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "pipeline-witness.json"
    command = [
        os.environ.get("KAMINOS_NODE", "node"),
        str(PIPELINE_WITNESS_PATH),
        "--manifest", str(PIPELINE_MANIFEST_PATH),
        "--pipeline-id", pipeline_id,
        "--input", source["path"],
        "--out-dir", str(out_dir),
        "--report", str(report_path),
    ]
    timeout = int(os.environ.get("KAMINOS_PIPELINE_WITNESS_TIMEOUT", "360"))
    proc = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "KAMINOS_PIPELINE_PROGRESS_STREAM": "1"},
    )
    events = queue.Queue()
    stdout_chunks = []
    stderr_chunks = []

    def reader(pipe, stream_name, chunks):
        try:
            for line in iter(pipe.readline, ""):
                chunks.append(line)
                event = _pipeline_progress_event_from_line(line, stream_name)
                if event:
                    events.put(event)
        finally:
            pipe.close()

    threads = [
        threading.Thread(target=reader, args=(proc.stdout, "stdout", stdout_chunks), daemon=True),
        threading.Thread(target=reader, args=(proc.stderr, "stderr", stderr_chunks), daemon=True),
    ]
    for thread in threads:
        thread.start()
    started = time.monotonic()
    while proc.poll() is None:
        if time.monotonic() - started > timeout:
            proc.kill()
            raise subprocess.TimeoutExpired(command, timeout)
        try:
            _write_pipeline_stream_event(handler, events.get(timeout=0.05))
        except queue.Empty:
            pass
    for thread in threads:
        thread.join(timeout=1)
    while True:
        try:
            _write_pipeline_stream_event(handler, events.get_nowait())
        except queue.Empty:
            break

    report = json.loads(report_path.read_text()) if report_path.exists() else None
    bundle_path = Path(report["bundleIndex"]["path"]) if report and report.get("bundleIndex") else None
    bundle = json.loads(bundle_path.read_text()) if bundle_path and bundle_path.exists() else None
    result = {
        "schema": "kaminos.pipeline-run-result.v0",
        "kind": "pipeline-result",
        "ok": proc.returncode == 0 and bool(report and report.get("ok")),
        "pipelineId": pipeline_id,
        "source": source,
        "command": command,
        "exitCode": proc.returncode,
        "stdoutTail": "".join(stdout_chunks)[-4000:],
        "stderrTail": "".join(stderr_chunks)[-4000:],
        "report": {
            "path": str(report_path),
            "document": report,
        },
        "bundle": {
            "path": str(bundle_path) if bundle_path else None,
            "document": bundle,
        },
    }
    _write_pipeline_stream_event(handler, result)
    return result


def _clean_label(value, fallback="Untitled"):
    text = str(value or "").strip()
    if not text:
        return fallback
    stem = Path(text).stem if ("/" in text or "\\" in text or "." in Path(text).name) else text
    words = []
    for token in stem.replace("-", " ").replace("_", " ").split():
        if token.isupper() and len(token) <= 4:
            words.append(token)
        elif token.lower() in {"mlx", "qem", "glb", "obj", "vs3d"}:
            words.append(token.upper() if token.lower() in {"mlx", "glb", "obj"} else token.capitalize())
        else:
            words.append(token.capitalize())
    return " ".join(words) or fallback


def _receipt_params(receipt):
    params = receipt.get("params") if isinstance(receipt, dict) else None
    return params if isinstance(params, dict) else {}


def _first_present(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _count_mesh_outputs(output_files):
    return len([
        name for name in (output_files or [])
        if Path(str(name)).suffix.lower() in MESH_EXTENSIONS
    ])


def _output_count_label(count):
    if count == 1:
        return "1 output"
    return f"{count} outputs"


def build_display_metadata(entry_name, *, entry_type, receipt=None, output_files=None, size=None):
    """Build deterministic human-facing labels while preserving raw identity."""
    receipt = receipt if isinstance(receipt, dict) else {}
    params = _receipt_params(receipt)
    input_value = _first_present(
        receipt.get("input_name"),
        receipt.get("input_path"),
        receipt.get("prompt"),
        receipt.get("name"),
        receipt.get("output_dir"),
        entry_name,
    )
    job_type = receipt.get("job_type")
    job_type_label = _clean_label(job_type, "Job") if job_type else None
    title = _clean_label(input_value, _clean_label(entry_name, "Untitled"))
    seed = _first_present(params.get("seed"), receipt.get("seed"))
    timestamp = _first_present(receipt.get("finished_at"), receipt.get("created_at"), receipt.get("started_at"))
    output_count = len(output_files or [])

    subtitle_parts = []
    if job_type_label:
        subtitle_parts.append(job_type_label)
    if seed is not None:
        subtitle_parts.append(f"seed {seed}")
    if output_count:
        subtitle_parts.append(_output_count_label(output_count))
    if timestamp:
        subtitle_parts.append(str(timestamp)[:19].replace("T", " "))
    if size is not None and entry_type == "file":
        subtitle_parts.append(str(size))

    mesh_count = _count_mesh_outputs(output_files)
    return {
        "title": title,
        "subtitle": " / ".join(subtitle_parts),
        "meta": f"raw {entry_name}",
        "raw_name": entry_name,
        "job_type": job_type,
        "job_type_label": job_type_label,
        "input_label": _clean_label(input_value, ""),
        "seed": str(seed) if seed is not None else None,
        "output_count": output_count,
        "mesh_output_count": mesh_count,
        "load_label": "Load mesh" if mesh_count or Path(entry_name).suffix.lower() in MESH_EXTENSIONS else "Open",
    }


def build_output_display_metadata(entry_name, *, job_display=None, size=None):
    job_display = job_display if isinstance(job_display, dict) else {}
    ext = Path(entry_name).suffix.lower().lstrip(".").upper() or "FILE"
    seed = job_display.get("seed")
    title_root = job_display.get("title") or _clean_label(entry_name)
    is_mesh = Path(entry_name).suffix.lower() in MESH_EXTENSIONS
    if is_mesh and Path(entry_name).stem.lower().startswith("seed-") and title_root:
        title = f"{title_root} Mesh"
    else:
        title = _clean_label(entry_name)
    subtitle_parts = [ext]
    if seed:
        subtitle_parts.append(f"seed {seed}")
    if size is not None:
        subtitle_parts.append(_format_size(size))
    return {
        "title": title,
        "subtitle": " / ".join(subtitle_parts),
        "meta": f"raw {entry_name}",
        "raw_name": entry_name,
        "load_label": "Load mesh" if is_mesh else "Open",
    }


def build_asset_display_metadata(path, *, root_label, stage, size=None):
    ext = path.suffix.lower().lstrip(".").upper() or "FILE"
    subtitle_parts = [ext, stage, root_label]
    size_label = _format_size(size)
    if size_label:
        subtitle_parts.append(size_label)
    return {
        "title": _clean_label(path.name, "Untitled Splat"),
        "subtitle": " / ".join(subtitle_parts),
        "meta": f"raw {path.name}",
        "raw_name": path.name,
        "load_label": "Import Splat",
        "stage": stage,
        "root_label": root_label,
    }


def inspect_splat_renderability(path):
    suffix = Path(path).suffix.lower()
    if suffix == ".spz":
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "likely-splat",
            "previewState": "not-rendered",
            "reason": "SPZ files are treated as splat assets; no thumbnail preview has been rendered.",
        }
    if suffix != ".ply":
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "unknown",
            "previewState": "not-rendered",
            "reason": f"{suffix or 'unknown'} files are indexed but not inspected as PLY splats.",
        }
    try:
        header = Path(path).read_bytes()[:32768].decode("utf-8", errors="ignore").lower()
    except OSError as error:
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "unknown",
            "previewState": "not-rendered",
            "reason": f"Could not inspect PLY header: {error}",
        }
    gaussian_markers = ("property float opacity", "property float scale_0", "property float rot_0")
    color_markers = ("property float f_dc_0", "property uchar red")
    if all(marker in header for marker in gaussian_markers) and any(marker in header for marker in color_markers):
        return {
            "schema": "kaminos.splat-renderability.v0",
            "status": "splat-header-like",
            "previewState": "not-rendered",
            "reason": "PLY header contains common gaussian splat properties; this is not a verified render and no thumbnail preview has been rendered.",
        }
    return {
        "schema": "kaminos.splat-renderability.v0",
        "status": "not-splat-like",
        "previewState": "not-rendered",
        "reason": "PLY header does not contain common gaussian splat properties; it may be a mesh stub or non-renderable fixture.",
    }


def _format_size(size):
    try:
        size = int(size)
    except (TypeError, ValueError):
        return ""
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def list_asset_entries(kind="splat"):
    """List declared Kaminos asset roots without scanning outside them."""
    entries = []
    for root in ASSET_ROOTS:
        if kind not in ("all", root.get("kind")):
            continue
        root_id = root["id"]
        root_path = Path(root["path"]).expanduser()
        if not root_path.is_dir():
            continue
        if root.get("kind") == "splat":
            suffixes = SPLAT_EXTENSIONS
        elif root.get("kind") == "image":
            suffixes = IMAGE_EXTENSIONS
        else:
            suffixes = MESH_EXTENSIONS
        for path in sorted(root_path.rglob("*")):
            if any(part.startswith(".") for part in path.relative_to(root_path).parts):
                continue
            if not path.is_file() or path.suffix.lower() not in suffixes:
                continue
            entries.append(build_asset_entry(root, path))
    return entries


def build_asset_entry(root, path):
    root_id = root["id"]
    root_path = Path(root["path"]).expanduser()
    path = Path(path)
    try:
        rel_path = path.relative_to(root_path).as_posix()
    except ValueError:
        rel_path = path.relative_to(root_path.resolve()).as_posix()
    size = path.stat().st_size
    kind = root.get("kind")
    correction_document = load_splat_asset_correction(root_id, rel_path) if kind == "splat" else None
    display = build_asset_display_metadata(
        path,
        root_label=root.get("label") or root_id,
        stage=root.get("stage", "experimental"),
        size=size,
    )
    if kind == "image":
        display["load_label"] = "Use Image"
    return {
        "id": f"{root_id}:{rel_path}",
        "kind": kind,
        "stage": root.get("stage", "experimental"),
        "root_id": root_id,
        "root_label": root.get("label") or root_id,
        "name": path.name,
        "path": rel_path,
        "size": size,
        "mtime": path.stat().st_mtime,
        "source": "/api/read?" + urlencode({"root": root_id, "path": rel_path}),
        "correction": correction_document.get("correction") if correction_document else None,
        "display": display,
        "renderability": inspect_splat_renderability(path) if kind == "splat" else {
            "schema": "kaminos.image-preview.v0",
            "status": "image",
            "previewState": "direct-read",
            "reason": "Local image asset served through /api/read for graph input.",
        },
    }


def splat_asset_root(root_id):
    for root in ASSET_ROOTS:
        if root.get("id") == root_id and root.get("kind") == "splat":
            return root
    return None


def _asset_relative_path(rel_path):
    rel = Path(str(rel_path or ""))
    if rel.is_absolute() or any(part == ".." for part in rel.parts):
        raise PermissionError("Path traversal")
    return rel


def resolve_splat_asset_path(root_id, rel_path):
    root = splat_asset_root(root_id)
    if not root:
        raise FileNotFoundError(f"splat asset root not configured: {root_id}")
    root_path = Path(root["path"]).expanduser().resolve()
    target = root_path / _asset_relative_path(rel_path)
    if target.suffix.lower() not in SPLAT_EXTENSIONS:
        raise ValueError(f"Unsupported splat asset extension: {target.suffix or 'missing'}")
    if not target.is_file():
        raise FileNotFoundError("splat asset not found")
    return root, root_path, target


def splat_correction_sidecar_path(asset_path):
    return asset_path.with_name(asset_path.name + ".kaminos-splat.json")


def _number_list(value, *, length, fallback):
    if not isinstance(value, list) or len(value) != length:
        return list(fallback)
    try:
        parsed = [float(item) for item in value]
    except (TypeError, ValueError):
        return list(fallback)
    return parsed if all(item == item and item not in (float("inf"), float("-inf")) for item in parsed) else list(fallback)


def _axis_flips(value):
    return [-1 if item < 0 else 1 for item in _number_list(value, length=3, fallback=[1, 1, 1])]


def normalize_splat_asset_correction(payload):
    source = payload if isinstance(payload, dict) else {}
    orientation = source.get("orientation") if isinstance(source.get("orientation"), dict) else {}
    crop = source.get("crop") if isinstance(source.get("crop"), dict) else {}
    return {
        "orientation": {
            "rotation": _number_list(orientation.get("rotation"), length=3, fallback=[0, 0, 0]),
        },
        "axisFlips": _axis_flips(source.get("axisFlips")),
        "centroidOffset": _number_list(source.get("centroidOffset"), length=3, fallback=[0, 0, 0]),
        "crop": {
            "enabled": bool(crop.get("enabled", False)),
            "min": _number_list(crop.get("min"), length=3, fallback=[-0.5, -0.5, -0.5]),
            "max": _number_list(crop.get("max"), length=3, fallback=[0.5, 0.5, 0.5]),
        },
    }


def load_splat_asset_correction(root_id, rel_path):
    try:
        root, root_path, asset_path = resolve_splat_asset_path(root_id, rel_path)
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    sidecar = splat_correction_sidecar_path(asset_path)
    if not sidecar.is_file():
        return None
    try:
        document = json.loads(sidecar.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if document.get("schema") != SPLAT_CORRECTION_SCHEMA:
        return None
    correction = normalize_splat_asset_correction(document.get("correction"))
    return {
        "schema": SPLAT_CORRECTION_SCHEMA,
        "root_id": root.get("id") or root_id,
        "path": asset_path.relative_to(root_path).as_posix(),
        "source": "/api/read?" + urlencode({"root": root.get("id") or root_id, "path": asset_path.relative_to(root_path).as_posix()}),
        "correction": correction,
        "updatedAt": document.get("updatedAt"),
    }


def save_splat_asset_correction(root_id, rel_path, payload):
    root, root_path, asset_path = resolve_splat_asset_path(root_id, rel_path)
    rel = asset_path.relative_to(root_path).as_posix()
    document = {
        "schema": SPLAT_CORRECTION_SCHEMA,
        "root_id": root.get("id") or root_id,
        "path": rel,
        "source": "/api/read?" + urlencode({"root": root.get("id") or root_id, "path": rel}),
        "correction": normalize_splat_asset_correction(payload),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    splat_correction_sidecar_path(asset_path).write_text(json.dumps(document, indent=2))
    return document


def splat_inbox_root():
    for root in ASSET_ROOTS:
        if root.get("id") == "splat-inbox" and root.get("kind") == "splat":
            return root
    return None


def sanitize_splat_filename(filename):
    raw_name = Path(str(filename or "splat.ply")).name
    ext = Path(raw_name).suffix.lower()
    if ext not in SPLAT_EXTENSIONS:
        raise ValueError(f"Unsupported splat asset extension: {ext or 'missing'}")
    stem = Path(raw_name).stem.strip() or "splat"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_") or "splat"
    return f"{stem.lower()}{ext}"


def ingest_splat_asset(filename, content):
    root = splat_inbox_root()
    if not root:
        raise FileNotFoundError("splat-inbox root is not configured")
    root_path = Path(root["path"]).expanduser()
    root_path.mkdir(parents=True, exist_ok=True)
    safe_name = sanitize_splat_filename(filename)
    target = (root_path / safe_name).resolve()
    if not target.is_relative_to(root_path.resolve()):
        raise PermissionError("Path traversal")
    target.write_bytes(content)
    sidecar = splat_correction_sidecar_path(target)
    if sidecar.exists():
        sidecar.unlink()
    return build_asset_entry(root, target)


def greenroom_output_roots():
    """Roots that can lawfully serve receipt output_dir files."""
    roots = [Path.home().resolve()]
    greenroom = BROWSE_ROOTS.get("greenroom")
    if greenroom:
        roots.append(greenroom.resolve())
    return roots


def resolve_greenroom_output_dir(output_dir):
    """Resolve a receipt output_dir only if it is under a serving root."""
    if not output_dir:
        return None
    output_resolved = Path(output_dir).resolve()
    if not output_resolved.is_dir():
        return None
    if any(output_resolved.is_relative_to(root) for root in greenroom_output_roots()):
        return output_resolved
    return None


def list_greenroom_output_files(receipt):
    output_dir = resolve_greenroom_output_dir((receipt or {}).get("output_dir"))
    if not output_dir:
        return []
    return [
        f.name for f in sorted(output_dir.iterdir())
        if f.is_file() and not f.name.startswith(".")
    ]


def find_greenroom_receipt(job_id):
    greenroom = BROWSE_ROOTS.get("greenroom")
    if not greenroom or not greenroom.exists():
        return None
    for status_dir in GREENROOM_STATUS_DIRS:
        receipt_path = (greenroom / status_dir / job_id / "receipt.json").resolve()
        status_root = (greenroom / status_dir).resolve()
        if not receipt_path.is_relative_to(status_root):
            continue
        if receipt_path.exists():
            return json.loads(receipt_path.read_text())
    return None


def greenroom_job_output_delay_seconds(job_id, filename):
    config = os.environ.get("KAMINOS_JOB_OUTPUT_DELAY_MS_BY_JOB", "")
    for item in config.split(","):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        key = key.strip()
        if key not in {job_id, filename, f"{job_id}/{filename}"}:
            continue
        try:
            return max(0.0, float(value.strip()) / 1000.0)
        except ValueError:
            return 0.0
    return 0.0


def record_job_output_event(event):
    with JOB_OUTPUT_EVENTS_LOCK:
        JOB_OUTPUT_EVENTS.append(event)


class KaminosHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/runtime-config":
            self.handle_runtime_config()
        elif parsed.path == "/api/pipeline-manifest":
            self.handle_pipeline_manifest()
        elif parsed.path == "/api/browse":
            self.handle_browse(parse_qs(parsed.query))
        elif parsed.path == "/api/assets":
            self.handle_assets(parse_qs(parsed.query))
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_get(parse_qs(parsed.query))
        elif parsed.path == "/api/forge-host/registry":
            self.handle_forge_host_registry()
        elif parsed.path == "/api/volume-capture":
            self.handle_volume_capture_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-captures":
            self.handle_volume_captures()
        elif parsed.path == "/api/volume-settings-preset":
            self.handle_volume_settings_preset_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-settings-presets":
            self.handle_volume_settings_presets_get()
        elif parsed.path == "/api/volume-basin-drive-session":
            self.handle_volume_basin_drive_session_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-basin-drive-sessions":
            self.handle_volume_basin_drive_sessions_get()
        elif parsed.path == "/api/volume-cockpit-layout":
            self.handle_volume_cockpit_layout_get(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-cockpit-layouts":
            self.handle_volume_cockpit_layouts_get()
        elif parsed.path == "/api/roots":
            self.handle_roots()
        elif parsed.path.startswith("/api/read"):
            self.handle_read(parse_qs(parsed.query))
        elif parsed.path == "/api/job-output-events":
            self.handle_job_output_events(parse_qs(parsed.query))
        elif parsed.path == "/api/job-outputs":
            self.handle_job_outputs(parse_qs(parsed.query))
        elif parsed.path.startswith("/api/job-output"):
            self.handle_job_output(parse_qs(parsed.query))
        elif parsed.path == "/api/delete-scene":
            self.handle_delete_scene(parse_qs(parsed.query))
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/save-scene":
            self.handle_save_scene()
        elif parsed.path == "/api/run-pipeline":
            self.handle_run_pipeline()
        elif parsed.path == "/api/ingest-splat":
            self.handle_ingest_splat(parse_qs(parsed.query))
        elif parsed.path == "/api/splat-correction":
            self.handle_splat_correction_post(parse_qs(parsed.query))
        elif parsed.path == "/api/volume-capture":
            self.handle_volume_capture()
        elif parsed.path == "/api/volume-settings-presets":
            self.handle_volume_settings_presets_post()
        elif parsed.path == "/api/volume-settings-preset-projections":
            self.handle_volume_settings_preset_projections_post()
        elif parsed.path == "/api/volume-basin-promotions":
            self.handle_volume_basin_promotions_post()
        elif parsed.path == "/api/volume-basin-drive-sessions":
            self.handle_volume_basin_drive_sessions_post()
        elif parsed.path == "/api/volume-cockpit-layouts":
            self.handle_volume_cockpit_layouts_post()
        elif parsed.path == "/api/volume-cockpit-layout-activation":
            self.handle_volume_cockpit_layout_activation_post()
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_runtime_config(self):
        self.send_json(runtime_config())

    def handle_forge_host_registry(self):
        self.send_json(build_forge_host_registry_snapshot())

    def handle_pipeline_manifest(self):
        try:
            self.send_json(pipeline_manifest_payload())
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
        except Exception as error:
            self.send_json({"error": str(error)}, 500)

    def volume_capture_slug(self, payload):
        requested = str(payload.get("name") or payload.get("captureId") or payload.get("kind") or "volume-capture")
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", requested).strip(".-").lower()[:72] or "volume-capture"
        stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 1_000_000:06d}"
        return f"{stamp}-{slug}"

    def volume_capture_path_for_id(self, capture_id):
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(capture_id or "")).strip(".-")
        if not safe:
            raise ValueError("capture id required")
        if not safe.endswith(".json"):
            safe = f"{safe}.json"
        path = (VOLUME_CAPTURE_DIR / safe).resolve()
        if VOLUME_CAPTURE_DIR.resolve() not in path.parents:
            raise ValueError("capture path traversal")
        return path

    def handle_volume_captures(self):
        VOLUME_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        entries = []
        for path in sorted(VOLUME_CAPTURE_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            stat = path.stat()
            entries.append({
                "id": path.stem,
                "relativePath": str(path.relative_to(ROOT)),
                "bytes": stat.st_size,
                "mtimeMs": int(stat.st_mtime * 1000),
            })
        self.send_json({
            "identity": "kaminos-volume-captures-index-v1",
            "root": str(VOLUME_CAPTURE_DIR.relative_to(ROOT)),
            "entries": entries,
        })

    def handle_volume_capture_get(self, query):
        capture_id = (query.get("id") or query.get("capture") or [""])[0]
        try:
            path = self.volume_capture_path_for_id(capture_id)
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        if not path.exists():
            self.send_json({"error": "capture not found", "id": capture_id}, 404)
            return
        try:
            document = json.loads(path.read_text())
        except Exception as error:
            self.send_json({"error": f"failed to read capture: {error}"}, 500)
            return
        self.send_json(document)

    def handle_volume_settings_presets_get(self):
        try:
            self.send_json(list_volume_settings_presets(VOLUME_SETTINGS_STORE))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "failurePhase": "shared-preset-index",
            }, 500)

    def handle_volume_settings_preset_get(self, query):
        preset_ref = (query.get("id") or query.get("preset") or [""])[0]
        try:
            document = read_volume_settings_preset(VOLUME_SETTINGS_STORE, preset_ref)
        except FileNotFoundError as error:
            self.send_json({
                "error": str(error),
                "requestedPresetRef": preset_ref,
                "storePath": str(VOLUME_SETTINGS_STORE),
                "failurePhase": "shared-preset-read",
            }, 404)
            return
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedPresetRef": preset_ref,
                "storePath": str(VOLUME_SETTINGS_STORE),
                "failurePhase": "shared-preset-read",
            }, 400)
            return
        self.send_json(document)

    def handle_volume_settings_presets_post(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"label", "preset"}:
            self.send_json({"error": "settings preset write requires exactly label and preset inputs"}, 400)
            return
        if not isinstance(request.get("label"), str) or not request["label"].strip():
            self.send_json({"error": "settings preset label is required"}, 400)
            return
        if not isinstance(request.get("preset"), dict):
            self.send_json({"error": "settings preset payload must be a JSON object"}, 400)
            return
        try:
            receipt = write_volume_settings_preset(
                VOLUME_SETTINGS_STORE,
                request["label"],
                request["preset"],
                volume_settings_server_source(),
            )
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedLabel": request.get("label"),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "failurePhase": "shared-preset-write",
            }, 400)
            return
        self.send_json(receipt)

    def handle_volume_settings_preset_projections_post(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"label", "sourcePreset", "profile"}:
            self.send_json({
                "error": "settings preset projection requires exactly label, sourcePreset, and profile inputs",
                "failurePhase": "settings-preset-projection-request",
            }, 400)
            return
        if not isinstance(request.get("label"), str) or not request["label"].strip():
            self.send_json({"error": "settings preset projection label is required"}, 400)
            return
        if not isinstance(request.get("sourcePreset"), str) or not request["sourcePreset"].strip():
            self.send_json({"error": "settings preset projection sourcePreset is required"}, 400)
            return
        try:
            receipt = project_volume_settings_preset(
                VOLUME_SETTINGS_STORE,
                request["sourcePreset"],
                request["label"],
                request["profile"],
                volume_settings_server_source(),
            )
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedLabel": request.get("label"),
                "sourcePreset": request.get("sourcePreset"),
                "storePath": str(VOLUME_SETTINGS_STORE),
                "failurePhase": "settings-preset-projection",
            }, 400)
            return
        self.send_json(receipt)

    def handle_volume_basin_drive_sessions_get(self):
        try:
            self.send_json(list_volume_basin_drive_sessions(VOLUME_BASIN_SESSION_STORE))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "storePath": str(VOLUME_BASIN_SESSION_STORE),
                "failurePhase": "basin-drive-session-index",
            }, 500)

    def handle_volume_cockpit_layouts_get(self):
        try:
            self.send_json(list_volume_cockpit_layouts(VOLUME_COCKPIT_LAYOUT_STORE))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
                "failurePhase": "cockpit-layout-index",
            }, 500)

    def handle_volume_cockpit_layout_get(self, query):
        layout_id = (query.get("id") or query.get("layout") or [""])[0]
        try:
            self.send_json(read_volume_cockpit_layout(VOLUME_COCKPIT_LAYOUT_STORE, layout_id))
        except FileNotFoundError as error:
            self.send_json({
                "error": str(error),
                "requestedLayoutId": layout_id,
                "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
                "failurePhase": "cockpit-layout-read",
            }, 404)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedLayoutId": layout_id,
                "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
                "failurePhase": "cockpit-layout-read",
            }, 400)

    def handle_volume_cockpit_layouts_post(self):
        failure = {
            "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
            "failurePhase": "cockpit-layout-write",
        }
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({**failure, "error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({**failure, "error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"layout", "activate"}:
            self.send_json({**failure, "error": "cockpit layout write requires exactly layout and activate inputs"}, 400)
            return
        if not isinstance(request.get("activate"), bool):
            self.send_json({**failure, "error": "cockpit layout activate must be boolean"}, 400)
            return
        try:
            receipt = write_volume_cockpit_layout(
                VOLUME_COCKPIT_LAYOUT_STORE,
                request.get("layout"),
                activate=request["activate"],
            )
        except OSError as error:
            self.send_json({**failure, "error": str(error)}, 500)
            return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({**failure, "error": str(error)}, 400)
            return
        self.send_json(receipt)

    def handle_volume_cockpit_layout_activation_post(self):
        failure = {
            "storePath": str(VOLUME_COCKPIT_LAYOUT_STORE),
            "failurePhase": "cockpit-layout-activation",
        }
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({**failure, "error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({**failure, "error": "Invalid JSON"}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"layoutId"}:
            self.send_json({**failure, "error": "cockpit layout activation requires exactly layoutId"}, 400)
            return
        try:
            receipt = activate_volume_cockpit_layout(
                VOLUME_COCKPIT_LAYOUT_STORE,
                request.get("layoutId"),
            )
        except FileNotFoundError as error:
            self.send_json({**failure, "error": str(error)}, 404)
            return
        except OSError as error:
            self.send_json({**failure, "error": str(error)}, 500)
            return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({**failure, "error": str(error)}, 400)
            return
        self.send_json(receipt)

    def handle_volume_basin_drive_session_get(self, query):
        session_ref = (query.get("id") or query.get("session") or [""])[0]
        try:
            document = read_volume_basin_drive_session(VOLUME_BASIN_SESSION_STORE, session_ref)
        except FileNotFoundError as error:
            self.send_json({
                "error": str(error),
                "requestedSessionRef": session_ref,
                "storePath": str(VOLUME_BASIN_SESSION_STORE),
                "failurePhase": "basin-drive-session-read",
            }, 404)
            return
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json({
                "error": str(error),
                "requestedSessionRef": session_ref,
                "storePath": str(VOLUME_BASIN_SESSION_STORE),
                "failurePhase": "basin-drive-session-read",
            }, 400)
            return
        self.send_json(document)

    def handle_volume_basin_drive_sessions_post(self):
        failure_base = {
            "storePath": str(VOLUME_BASIN_SESSION_STORE),
            "failurePhase": "basin-drive-session-write",
        }
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({**failure_base, "error": "Invalid Content-Length", "requestedSessionId": None}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({**failure_base, "error": "Invalid JSON", "requestedSessionId": None}, 400)
            return
        if not isinstance(request, dict) or set(request) != {"session"}:
            self.send_json({
                "error": "basin drive session write requires exactly session input",
                **failure_base,
            }, 400)
            return
        try:
            receipt = write_volume_basin_drive_session(VOLUME_BASIN_SESSION_STORE, request.get("session"))
        except OSError as error:
            self.send_json({
                **failure_base,
                "error": str(error),
                "requestedSessionId": (request.get("session") or {}).get("sessionId")
                if isinstance(request.get("session"), dict) else None,
            }, 500)
            return
        except (ValueError, json.JSONDecodeError, subprocess.SubprocessError) as error:
            self.send_json({
                "error": str(error),
                "requestedSessionId": (request.get("session") or {}).get("sessionId")
                if isinstance(request.get("session"), dict) else None,
                **failure_base,
            }, 400)
            return
        self.send_json(receipt)

    def handle_volume_basin_promotions_post(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        try:
            receipt = write_volume_basin_promotion_package(request)
        except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as error:
            self.send_json({
                "error": str(error),
                "requestedHandle": request.get("handle") if isinstance(request, dict) else None,
                "requestedPromotionRoot": request.get("promotionRoot") if isinstance(request, dict) else None,
                "failurePhase": "basin-promotion-write",
            }, 400)
            return
        self.send_json(receipt)

    def handle_volume_capture(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        if not isinstance(payload, dict):
            self.send_json({"error": "capture payload must be a JSON object"}, 400)
            return

        if payload.get("kind") == "settings-preset":
            self.send_json({"error": "settings presets must use the shared /api/volume-settings-presets store"}, 410)
            return

        if payload.get("kind") == "prototype-basin":
            scene_authority = payload.get("sceneAuthority") or {}
            requested_smoke = payload.get("requestedSmoke") or {}
            exclusions = payload.get("stateExclusions") or {}
            forbidden_runtime_fields = ("href", "camera", "volumeDebugState", "viewport")
            excluded_fields = (
                "fluidField", "frontField", "boundarySidecar", "splatInstances",
                "historyBuffers", "pressureState", "replayState",
            )
            if scene_authority.get("status") != "prototype" or scene_authority.get("effective") != "tall_plume":
                self.send_json({"error": "prototype-basin capture requires tall_plume prototype authority"}, 400)
                return
            if requested_smoke.get("role") != "truthHigh" or requested_smoke.get("composition") != "splat-only-v0" or requested_smoke.get("warmupSteps") != 0:
                self.send_json({"error": "prototype-basin capture requires explicit truthHigh splat-only fresh-smoke identity"}, 400)
                return
            if ((payload.get("domControls") or {}).get("boundarySplatMode", {}).get("value") != "learned"):
                self.send_json({"error": "prototype-basin splat-only smoke requires learned boundary splats"}, 400)
                return
            if str(((payload.get("domControls") or {}).get("resolution", {}).get("value"))) != "160":
                self.send_json({"error": "prototype-basin selective-head smoke requires resolution 160"}, 400)
                return
            if any(exclusions.get(field) is not True for field in excluded_fields):
                self.send_json({"error": "prototype-basin capture must explicitly exclude runtime and replay state"}, 400)
                return
            if any(field in payload for field in forbidden_runtime_fields):
                self.send_json({"error": "prototype-basin capture must not contain runtime, camera, or viewport state"}, 400)
                return

        VOLUME_CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        capture_id = self.volume_capture_slug(payload)
        path = self.volume_capture_path_for_id(capture_id)
        relative_path = str(path.relative_to(ROOT))
        smoke_url = f"/volume-basin-smoke.html?capture={capture_id}" if payload.get("kind") == "prototype-basin" else None
        preset_url = f"/volume-settings-preset.html?preset={capture_id}" if payload.get("kind") == "settings-preset" else None
        witness_command = (
            f"node volume-settings-preset-witness.mjs --url "
            f"http://127.0.0.1:{PORT}{preset_url}"
            if preset_url else
            f"node volume-witness.mjs --capture {relative_path}"
        )
        document = {
            "identity": "kaminos-volume-agent-capture-artifact-v1",
            "captureId": capture_id,
            "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "artifactRelativePath": relative_path,
            "witnessCommand": witness_command,
            "capture": payload,
        }
        if smoke_url:
            document["smokeUrl"] = smoke_url
        if preset_url:
            document["presetUrl"] = preset_url
        path.write_text(json.dumps(document, indent=2))
        self.send_json({
            "ok": True,
            "captureId": capture_id,
            "relativePath": relative_path,
            "path": str(path),
            "witnessCommand": document["witnessCommand"],
            "smokeUrl": smoke_url,
            "presetUrl": preset_url,
            "document": document,
        })

    def handle_run_pipeline(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        wants_stream = bool(payload.get("streamProgress")) or "application/x-ndjson" in self.headers.get("Accept", "")
        if wants_stream:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                run_pipeline_witness_stream(self, payload)
            except ValueError as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            except PermissionError as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            except FileNotFoundError as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            except subprocess.TimeoutExpired:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": "pipeline witness timed out"})
            except Exception as error:
                _write_pipeline_stream_event(self, {"schema": "kaminos.pipeline-run-result.v0", "kind": "pipeline-result", "ok": False, "error": str(error)})
            return
        try:
            result = run_pipeline_witness(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError as error:
            self.send_json({"error": str(error)}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        except subprocess.TimeoutExpired:
            self.send_json({"error": "pipeline witness timed out"}, 504)
            return
        except Exception as error:
            self.send_json({"error": str(error)}, 500)
            return
        self.send_json(result, 200 if result.get("ok") else 500)

    def handle_save_scene(self):
        """Save a scene JSON to the scenes directory.

        If _filename is provided and exists, overwrites that file (Save).
        Otherwise creates a new file (Save As).
        """
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except Exception:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        # Check for overwrite hint
        hint = data.pop("_filename", None)
        if hint:
            safe_hint = "".join(c for c in hint if c.isalnum() or c in "._-")
            if safe_hint and (SCENES_DIR / safe_hint).exists():
                filename = safe_hint
            else:
                hint = None  # fall through to new file

        if not hint:
            # Generate new filename from model name and timestamp
            model_name = (data.get("model") or {}).get("fileName", "scene")
            model_name = Path(model_name).stem
            timestamp = data.get("timestamp", "")[:19].replace(":", "-").replace("T", "_")
            filename = f"{model_name}_{timestamp}.kaminos.json"
            filename = "".join(c for c in filename if c.isalnum() or c in "._-")
            if not filename:
                filename = "scene.kaminos.json"

        scene_path = SCENES_DIR / filename
        # Security: ensure under SCENES_DIR
        if not scene_path.resolve().is_relative_to(SCENES_DIR.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return

        scene_path.write_text(json.dumps(data, indent=2))
        self.send_json({"saved": filename, "path": str(scene_path)})

    def handle_ingest_splat(self, params):
        """Write a dropped PLY/SPZ into the experimental splat inbox."""
        filename = params.get("name", [""])[0]
        if not filename:
            self.send_json({"error": "name required"}, 400)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            entry = ingest_splat_asset(filename, self.rfile.read(length))
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError:
            self.send_json({"error": "Path traversal"}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        self.send_json({
            "schema": "kaminos.asset-ingest.v0",
            "kind": "splat",
            "entry": entry,
        })

    def handle_splat_correction_get(self, params):
        root_id = params.get("root", [""])[0]
        rel_path = params.get("path", [""])[0]
        try:
            document = load_splat_asset_correction(root_id, rel_path)
            if document is None:
                resolve_splat_asset_path(root_id, rel_path)
                document = {
                    "schema": SPLAT_CORRECTION_SCHEMA,
                    "root_id": root_id,
                    "path": rel_path,
                    "source": "/api/read?" + urlencode({"root": root_id, "path": rel_path}),
                    "correction": None,
                }
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError:
            self.send_json({"error": "Path traversal"}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        self.send_json(document)

    def handle_splat_correction_post(self, params):
        root_id = params.get("root", [""])[0]
        rel_path = params.get("path", [""])[0]
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length"}, 400)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        try:
            document = save_splat_asset_correction(root_id, rel_path, payload.get("correction", payload))
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except PermissionError:
            self.send_json({"error": "Path traversal"}, 403)
            return
        except FileNotFoundError as error:
            self.send_json({"error": str(error)}, 404)
            return
        self.send_json(document)

    def handle_delete_scene(self, params):
        """Delete a scene file."""
        name = params.get("name", [""])[0]
        if not name:
            self.send_json({"error": "name required"}, 400)
            return
        target = (SCENES_DIR / name).resolve()
        if not target.is_relative_to(SCENES_DIR.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return
        if not target.is_file():
            self.send_json({"error": "Not found"}, 404)
            return
        target.unlink()
        self.send_json({"deleted": name})

    def handle_roots(self):
        """List available browse roots and their existence."""
        roots = {}
        for name, path in BROWSE_ROOTS.items():
            roots[name] = {
                "path": str(path.resolve()),
                "exists": path.exists(),
            }
        self.send_json(roots)

    def handle_browse(self, params):
        """List directory contents. ?root=scratch&path=subdir"""
        root_name = params.get("root", ["scratch"])[0]
        sub_path = params.get("path", [""])[0]

        root = BROWSE_ROOTS.get(root_name)
        if not root:
            self.send_json({"error": f"Unknown root: {root_name}"}, 400)
            return

        target = (root / sub_path).resolve()
        # Security: ensure target is under root
        if not target.is_relative_to(root.resolve()):
            self.send_json({"error": "Path traversal"}, 403)
            return

        if not target.exists():
            self.send_json({"error": "Not found"}, 404)
            return

        if target.is_file():
            # Return file info
            self.send_json({
                "type": "file",
                "name": target.name,
                "size": target.stat().st_size,
                "path": str(target),
            })
            return

        entries = []
        for entry in sorted(target.iterdir()):
            if entry.name.startswith("."):
                continue
            info = {
                "name": entry.name,
                "type": "dir" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else None,
            }
            # For greenroom job dirs, include status
            status_file = entry / "status.json" if entry.is_dir() else None
            if status_file and status_file.exists():
                try:
                    status = json.loads(status_file.read_text())
                    info["job_status"] = status.get("status")
                    info["job_type"] = status.get("job_type")
                    info["input_path"] = status.get("input_path")
                except Exception:
                    pass
            # For output dirs with metadata sidecar (from greenroom)
            metadata_file = entry / "metadata.json" if entry.is_dir() else None
            if metadata_file and metadata_file.exists():
                try:
                    meta = json.loads(metadata_file.read_text())
                    info["metadata"] = meta
                except Exception:
                    pass
            # For receipt dirs, include receipt summary
            receipt_file = entry / "receipt.json" if entry.is_dir() else None
            if receipt_file and receipt_file.exists():
                try:
                    receipt = json.loads(receipt_file.read_text())
                    info["receipt"] = {
                        k: receipt.get(k) for k in [
                            "status", "job_type", "exit_code",
                            "started_at", "finished_at", "failure_phase",
                            "output_dir", "input_path", "input_name",
                        ]
                    }
                    output_files = list_greenroom_output_files(receipt)
                    if output_files:
                        info["output_files"] = output_files
                    info["display"] = build_display_metadata(
                        entry.name,
                        entry_type=info["type"],
                        receipt=receipt,
                        output_files=output_files,
                        size=info["size"],
                    )
                except Exception:
                    pass
            if "display" not in info:
                status_receipt = None
                if info.get("job_type") or info.get("input_path") or info.get("job_status"):
                    status_receipt = {
                        "status": info.get("job_status"),
                        "job_type": info.get("job_type"),
                        "input_path": info.get("input_path"),
                    }
                info["display"] = build_display_metadata(
                    entry.name,
                    entry_type=info["type"],
                    receipt=status_receipt,
                    size=info["size"],
                )
            entries.append(info)

        self.send_json({
            "type": "dir",
            "root": root_name,
            "path": sub_path,
            "entries": entries,
        })

    def handle_assets(self, params):
        """List declared asset roots."""
        kind = params.get("kind", ["splat"])[0]
        if kind not in {"splat", "image", "all"}:
            self.send_json({"error": f"Unsupported asset kind: {kind}"}, 400)
            return
        roots = [
            {
                "id": root["id"],
                "label": root.get("label") or root["id"],
                "kind": root.get("kind"),
                "stage": root.get("stage", "experimental"),
                "path": str(Path(root["path"]).expanduser().resolve()),
                "exists": Path(root["path"]).expanduser().exists(),
            }
            for root in ASSET_ROOTS
            if kind in {"all", root.get("kind")}
        ]
        self.send_json({
            "schema": "kaminos.asset-index.v0",
            "kind": kind,
            "roots": roots,
            "entries": list_asset_entries(kind=kind),
        })

    def handle_read(self, params):
        """Read a file's content. ?root=scratch&path=file.json"""
        root_name = params.get("root", ["scratch"])[0]
        sub_path = params.get("path", [""])[0]

        root = BROWSE_ROOTS.get(root_name)
        if not root:
            self.send_json({"error": f"Unknown root: {root_name}"}, 400)
            return

        lexical_target = root / sub_path
        target = lexical_target.resolve()
        if not target.is_relative_to(root.resolve()):
            if splat_asset_root_allows_pointer(root_name) and lexical_target.suffix.lower() in SPLAT_EXTENSIONS:
                target = lexical_target
            else:
                self.send_json({"error": "Path traversal"}, 403)
                return

        if not target.is_file():
            self.send_json({"error": "Not a file"}, 404)
            return

        # For images, serve directly
        ext = target.suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".exr", ".glb", ".gltf", ".ply", ".spz"):
            self.send_response(200)
            content_types = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                ".exr": "application/octet-stream", ".ply": "application/octet-stream", ".spz": "application/octet-stream",
            }
            self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))

            self.end_headers()
            self.wfile.write(target.read_bytes())
            return

        # For text/json, return as JSON-wrapped text
        try:
            text = target.read_text()
            if ext == ".json":
                self.send_json(json.loads(text))
            else:
                self.send_json({"content": text})
        except Exception:
            self.send_json({"error": "Failed to read file"}, 500)

    def handle_job_outputs(self, params):
        """List files in a job's output_dir. ?job_id=xxx"""
        job_id = params.get("job_id", [""])[0]
        if not job_id:
            self.send_json({"error": "job_id required"}, 400)
            return

        greenroom = BROWSE_ROOTS.get("greenroom")
        if not greenroom or not greenroom.exists():
            self.send_json({"error": "Greenroom not available"}, 404)
            return

        receipt_data = find_greenroom_receipt(job_id)

        if not receipt_data:
            self.send_json({"error": f"Job {job_id} not found"}, 404)
            return

        output_dir = receipt_data.get("output_dir")
        if not output_dir:
            self.send_json({"entries": [], "output_dir": output_dir})
            return

        output_resolved = resolve_greenroom_output_dir(output_dir)
        if not output_resolved:
            self.send_json({"error": "output_dir outside serving roots"}, 403)
            return

        output_files = list_greenroom_output_files(receipt_data)
        job_display = build_display_metadata(
            job_id,
            entry_type="dir",
            receipt=receipt_data,
            output_files=output_files,
        )
        entries = []
        for f in sorted(output_resolved.iterdir()):
            if f.name.startswith("."):
                continue
            size = f.stat().st_size if f.is_file() else None
            entries.append({
                "name": f.name,
                "type": "dir" if f.is_dir() else "file",
                "size": size,
                "display": build_output_display_metadata(f.name, job_display=job_display, size=size),
            })
        self.send_json({"entries": entries, "output_dir": output_dir, "job_display": job_display})

    def handle_job_output_events(self, params):
        """Expose job-output route timing for local witness runs."""
        should_clear = params.get("clear", ["0"])[0] == "1"
        with JOB_OUTPUT_EVENTS_LOCK:
            if should_clear:
                JOB_OUTPUT_EVENTS.clear()
            events = list(JOB_OUTPUT_EVENTS)
        self.send_json({"events": events, "cleared": should_clear})

    def handle_job_output(self, params):
        """Serve files from a completed job's output_dir. ?job_id=xxx&file=output.glb

        Security: only serves from output_dir paths recorded in greenroom receipts.
        """
        job_id = params.get("job_id", [""])[0]
        filename = params.get("file", [""])[0]
        if not job_id or not filename:
            self.send_json({"error": "job_id and file required"}, 400)
            return

        greenroom = BROWSE_ROOTS.get("greenroom")
        if not greenroom or not greenroom.exists():
            self.send_json({"error": "Greenroom not available"}, 404)
            return

        receipt_data = find_greenroom_receipt(job_id)

        if not receipt_data:
            self.send_json({"error": f"Job {job_id} not found"}, 404)
            return

        output_dir = receipt_data.get("output_dir")
        if not output_dir:
            self.send_json({"error": "No output_dir in receipt"}, 404)
            return

        output_resolved = resolve_greenroom_output_dir(output_dir)
        if not output_resolved:
            self.send_json({"error": "output_dir outside serving roots"}, 403)
            return

        target = (output_resolved / filename).resolve()
        # Security: must be under the receipt's output_dir
        if not target.is_relative_to(output_resolved):
            self.send_json({"error": "Path traversal"}, 403)
            return

        if not target.is_file():
            self.send_json({"error": f"File not found: {filename}"}, 404)
            return

        delay_seconds = greenroom_job_output_delay_seconds(job_id, filename)
        delay_ms = int(delay_seconds * 1000)
        started_at_ms = int(time.time() * 1000)
        body = target.read_bytes()
        if delay_seconds:
            time.sleep(delay_seconds)
        ended_at_ms = int(time.time() * 1000)
        record_job_output_event({
            "job_id": job_id,
            "file": filename,
            "path": f"/api/job-output?job_id={job_id}&file={filename}",
            "delay_ms": delay_ms,
            "started_at_ms": started_at_ms,
            "ended_at_ms": ended_at_ms,
            "duration_ms": ended_at_ms - started_at_ms,
            "content_length": len(body),
        })

        ext = target.suffix.lower()
        content_types = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
            ".exr": "application/octet-stream", ".ply": "application/octet-stream", ".spz": "application/octet-stream",
            ".json": "application/json", ".txt": "text/plain", ".log": "text/plain",
        }
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format, *args):
        rendered = format % args if args else format
        if "/api/" in rendered:
            return  # quiet API spam
        super().log_message(format, *args)


if __name__ == "__main__":
    try:
        PORT, VOLUME_SETTINGS_STORE, VOLUME_BASIN_SESSION_STORE, VOLUME_COCKPIT_LAYOUT_STORE = parse_server_arguments(sys.argv[1:])
    except ValueError as error:
        print(f"serve.py: {error}", file=sys.stderr)
        raise SystemExit(2)
    for path in (BROWSE_ROOTS.get("splat-inbox"), BROWSE_ROOTS.get("splat-production")):
        if path:
            path.mkdir(parents=True, exist_ok=True)
    print(f"Kaminos server at http://localhost:{PORT}")
    print(f"  Scratch: {BROWSE_ROOTS['scratch']}")
    print(f"  Greenroom: {BROWSE_ROOTS['greenroom']}")
    print(f"  Splat inbox: {BROWSE_ROOTS['splat-inbox']}")
    print(f"  Production splats: {BROWSE_ROOTS['splat-production']}")
    print(f"  Volume settings store: {VOLUME_SETTINGS_STORE}")
    print(f"  Volume basin session store: {VOLUME_BASIN_SESSION_STORE}")
    print(f"  Volume cockpit layout store: {VOLUME_COCKPIT_LAYOUT_STORE}")
    server = http.server.ThreadingHTTPServer(("", PORT), KaminosHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
