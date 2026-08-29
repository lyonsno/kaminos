import hashlib
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlparse


VOLUME_SETTINGS_PRESET_IDENTITY = "kaminos-volume-settings-preset-v2"
VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY = "kaminos-volume-settings-preset-artifact-v2"
VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY = "kaminos-volume-settings-preset-schema-v2"


def _route_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    return str(value)


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


def _alias_slug(value):
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(value or "").strip()).strip(".-").lower()[:96]
    return slug or "unnamed-preset"


def _control_value(entry):
    return entry.get("rawValue") if "rawValue" in entry else entry.get("value")


def validate_volume_settings_preset_payload(payload, schema):
    if schema.get("identity") != VOLUME_SETTINGS_PRESET_SCHEMA_IDENTITY:
        raise ValueError("settings preset canonical schema identity mismatch")
    if payload.get("identity") != VOLUME_SETTINGS_PRESET_IDENTITY or payload.get("kind") != "settings-preset":
        raise ValueError("settings preset identity mismatch")
    if payload.get("schemaIdentity") != schema["identity"]:
        raise ValueError("settings preset schema identity mismatch")

    allowed_fields = set(schema.get("allowedNativePresetFields") or [])
    unexpected_fields = sorted(set(payload) - allowed_fields)
    if unexpected_fields:
        raise ValueError(f"settings preset contains fields outside its canonical schema: {','.join(unexpected_fields)}")
    for field in schema.get("forbiddenPresetFields") or []:
        if field in payload:
            raise ValueError(f"settings preset contains forbidden runtime or replay state: {field}")

    expected_controls = schema.get("controls") or []
    expected_by_key = {entry["key"]: entry for entry in expected_controls}
    dom_controls = payload.get("domControls")
    if (
        not isinstance(dom_controls, dict)
        or payload.get("controlCount") != len(expected_controls)
        or set(dom_controls) != set(expected_by_key)
    ):
        raise ValueError(f"settings preset requires exactly {len(expected_controls)} canonical controls")

    expected_renderer_controls = schema.get("rendererControls") or []
    expected_renderer_by_key = {entry["key"]: entry for entry in expected_renderer_controls}
    renderer_controls = payload.get("rendererControls")
    if renderer_controls is None:
        if payload.get("rendererControlCount") not in (None, 0):
            raise ValueError("settings preset renderer control count is invalid")
        renderer_controls = {}
    elif (
        not isinstance(renderer_controls, dict)
        or payload.get("rendererControlCount") != len(expected_renderer_controls)
        or set(renderer_controls) != set(expected_renderer_by_key)
    ):
        raise ValueError(
            f"settings preset requires exactly {len(expected_renderer_controls)} renderer controls when that axis is authored"
        )

    routed_values = {}
    for key, descriptor in {**dom_controls, **renderer_controls}.items():
        expected = expected_by_key.get(key) or expected_renderer_by_key.get(key)
        if (
            not isinstance(descriptor, dict)
            or descriptor.get("param") != expected.get("param")
            or str(descriptor.get("tagName") or "").upper() != str(expected.get("tagName") or "").upper()
            or str(descriptor.get("type") or "").lower() != str(expected.get("type") or "").lower()
        ):
            raise ValueError(f"settings preset control inventory mismatch for {key}")
        routed_values[expected["param"]] = _route_value(_control_value(descriptor))

    exclusions = payload.get("stateExclusions") or {}
    if any(exclusions.get(field) is not True for field in schema.get("excludedStateFields") or []):
        raise ValueError("settings preset must explicitly exclude runtime and replay state")

    route = payload.get("route")
    if not isinstance(route, str) or not route:
        raise ValueError("settings preset requires an exact control route")
    route_values = {}
    for key, value in parse_qsl(urlparse(route).query, keep_blank_values=True):
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


def _content_hash(payload, schema):
    canonical = {
        "schemaIdentity": schema["identity"],
        "controls": {
            descriptor["key"]: _control_value(payload["domControls"][descriptor["key"]])
            for descriptor in schema["controls"]
        },
    }
    renderer_controls = payload.get("rendererControls")
    if renderer_controls is not None:
        canonical["rendererControls"] = {
            descriptor["key"]: _control_value(renderer_controls[descriptor["key"]])
            for descriptor in schema.get("rendererControls") or []
        }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def read_volume_settings_preset(store_path, preset_ref, schema):
    store = Path(store_path).expanduser().resolve()
    requested = str(preset_ref or "").strip()
    if not requested:
        raise ValueError("volume settings preset id or alias is required")

    alias_document = None
    if requested.startswith("vsp-"):
        if not re.fullmatch(r"vsp-[0-9a-f]{64}", requested):
            raise ValueError("volume settings preset content id is invalid")
        preset_id = requested
    else:
        alias = _alias_slug(requested)
        if alias != requested:
            raise ValueError("volume settings preset alias is invalid")
        try:
            alias_document = _read_json_object(store / "aliases" / f"{alias}.json", "alias")
        except FileNotFoundError as error:
            raise FileNotFoundError(f"volume settings preset alias not found: {alias}") from error
        if alias_document.get("identity") != "kaminos-volume-settings-preset-alias-v1" or alias_document.get("alias") != alias:
            raise ValueError("volume settings preset alias identity mismatch")
        if alias_document.get("schemaIdentity") != schema.get("identity"):
            raise ValueError("volume settings preset alias schema mismatch")
        preset_id = alias_document.get("presetId")
        if not isinstance(preset_id, str) or not re.fullmatch(r"vsp-[0-9a-f]{64}", preset_id):
            raise ValueError("volume settings preset alias target is invalid")

    try:
        document = _read_json_object(store / "presets" / f"{preset_id}.json", "artifact")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"volume settings preset not found: {preset_id}") from error
    if document.get("identity") != VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY or document.get("presetId") != preset_id:
        raise ValueError("volume settings preset artifact identity mismatch")
    if document.get("schemaIdentity") != schema.get("identity") or document.get("controlCount") != schema.get("controlCount"):
        raise ValueError("volume settings preset artifact schema mismatch")
    validate_volume_settings_preset_payload(document.get("preset") or {}, schema)
    content_hash = _content_hash(document["preset"], schema)
    if document.get("contentHash") != f"sha256:{content_hash}" or preset_id != f"vsp-{content_hash}":
        raise ValueError("volume settings preset artifact content hash mismatch")
    if alias_document and alias_document.get("contentHash") != document.get("contentHash"):
        raise ValueError("volume settings preset alias content hash mismatch")
    return {
        **document,
        "requestedPresetRef": requested,
        "alias": alias_document.get("alias") if alias_document else None,
        "label": alias_document.get("label") if alias_document else document.get("initialLabel"),
        "storePath": str(store),
    }
