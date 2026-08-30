#!/usr/bin/env python3
"""Materialize strict current-schema settings presets from admitted older stores."""

import argparse
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

import serve


MIGRATION_DEFAULTS = {
    "emitter-assay-family": "cluster",
    "volume-exposure": 1,
    "volume-reaction-boundary-fire-clean-color": "#4a86ff",
    "volume-reaction-boundary-fire-soot-color": "#ffc460",
    "volume-artistic-swirl": True,
    "volume-phased-sway": True,
}

MIGRATION_PROFILES = {
    frozenset(MIGRATION_DEFAULTS): "historical-186-to-192",
    frozenset({"emitter-assay-family", "volume-artistic-swirl", "volume-phased-sway"}):
        "emitter-and-motion-189-to-192",
}


def _read_object(path, role):
    try:
        document = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"settings preset migration could not read {role} {path}: {error}") from error
    if not isinstance(document, dict):
        raise ValueError(f"settings preset migration {role} is not an object: {path}")
    return document


def _control_value(descriptor):
    return descriptor.get("rawValue") if "rawValue" in descriptor else descriptor.get("value")


def _route_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    return str(value)


def _source_content_hash(payload):
    canonical = {
        "schemaIdentity": payload.get("schemaIdentity"),
        "controls": {
            key: _control_value(descriptor)
            for key, descriptor in (payload.get("domControls") or {}).items()
        },
    }
    renderer_controls = payload.get("rendererControls")
    if renderer_controls:
        canonical["rendererControls"] = {
            key: _control_value(descriptor)
            for key, descriptor in renderer_controls.items()
        }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _validate_source_payload(payload, schema):
    if payload.get("identity") != serve.VOLUME_SETTINGS_PRESET_IDENTITY or payload.get("kind") != "settings-preset":
        raise ValueError("settings preset migration source identity mismatch")
    if payload.get("schemaIdentity") != schema.get("identity"):
        raise ValueError("settings preset migration source schema identity mismatch")
    allowed_fields = set(schema.get("allowedNativePresetFields") or [])
    unexpected_fields = sorted(set(payload) - allowed_fields)
    if unexpected_fields:
        raise ValueError(f"settings preset migration source contains unsupported fields: {','.join(unexpected_fields)}")

    controls = payload.get("domControls")
    if not isinstance(controls, dict) or payload.get("controlCount") != len(controls):
        raise ValueError("settings preset migration source control count mismatch")
    expected_by_key = {descriptor["key"]: descriptor for descriptor in schema["controls"]}
    unexpected_controls = sorted(set(controls) - set(expected_by_key))
    if unexpected_controls:
        raise ValueError(f"settings preset migration source contains unknown controls: {','.join(unexpected_controls)}")
    missing = frozenset(set(expected_by_key) - set(controls))
    profile = MIGRATION_PROFILES.get(missing)
    if profile is None:
        raise ValueError(
            "unsupported migration profile; missing controls: "
            + (",".join(sorted(missing)) if missing else "none")
        )

    expected_renderer = {descriptor["key"]: descriptor for descriptor in schema.get("rendererControls") or []}
    renderer_controls = payload.get("rendererControls") or {}
    if not isinstance(renderer_controls, dict):
        raise ValueError("settings preset migration renderer controls are invalid")
    if renderer_controls and set(renderer_controls) != set(expected_renderer):
        raise ValueError("settings preset migration renderer control inventory mismatch")
    if payload.get("rendererControlCount") not in (None, 0, len(expected_renderer)):
        raise ValueError("settings preset migration renderer control count mismatch")

    routed_values = {}
    for key, descriptor in {**controls, **renderer_controls}.items():
        expected = expected_by_key.get(key) or expected_renderer.get(key)
        if not isinstance(descriptor, dict) or (
            descriptor.get("param") != expected.get("param")
            or str(descriptor.get("tagName") or "").upper() != str(expected.get("tagName") or "").upper()
            or str(descriptor.get("type") or "").lower() != str(expected.get("type") or "").lower()
        ):
            raise ValueError(f"settings preset migration control descriptor mismatch for {key}")
        routed_values[expected["param"]] = _route_value(_control_value(descriptor))

    exclusions = payload.get("stateExclusions") or {}
    if any(exclusions.get(field) is not True for field in schema.get("excludedStateFields") or []):
        raise ValueError("settings preset migration source does not exclude runtime state")
    if any(field in payload for field in schema.get("forbiddenPresetFields") or []):
        raise ValueError("settings preset migration source contains forbidden runtime state")

    route = payload.get("route")
    if not isinstance(route, str) or not route:
        raise ValueError("settings preset migration source route is missing")
    route_entries = parse_qsl(urlparse(route).query, keep_blank_values=True)
    route_values = {}
    for key, value in route_entries:
        if key in route_values:
            raise ValueError(f"settings preset migration source route duplicates {key}")
        route_values[key] = value
    activation = schema.get("activationParam") or {}
    if route_values.pop(activation.get("key"), None) != activation.get("value"):
        raise ValueError("settings preset migration source route omitted activation")
    for key, expected_value in routed_values.items():
        if route_values.pop(key, None) != expected_value:
            raise ValueError(f"settings preset migration source route/control mismatch for {key}")
    for key in schema.get("routeExtraParams") or []:
        if key not in route_values:
            raise ValueError(f"settings preset migration source route omitted {key}")
        route_values.pop(key)
    if route_values:
        raise ValueError(
            "settings preset migration source route contains unexpected parameters: "
            + ",".join(sorted(route_values))
        )
    return profile, missing


def migrate_volume_settings_preset_payload(payload, schema=None):
    schema = schema or json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    profile, missing = _validate_source_payload(payload, schema)
    migrated = json.loads(json.dumps(payload))
    expected_by_key = {descriptor["key"]: descriptor for descriptor in schema["controls"]}
    for descriptor in schema["controls"]:
        key = descriptor["key"]
        if key not in missing:
            continue
        value = MIGRATION_DEFAULTS[key]
        migrated["domControls"][key] = {
            "id": key,
            "param": descriptor["param"],
            "tagName": descriptor["tagName"],
            "type": descriptor["type"],
            "value": value,
        }

    parsed = urlparse(migrated["route"])
    route_entries = parse_qsl(parsed.query, keep_blank_values=True)
    for descriptor in schema["controls"]:
        if descriptor["key"] in missing:
            route_entries.append((descriptor["param"], _route_value(MIGRATION_DEFAULTS[descriptor["key"]])))
    migrated["route"] = parsed._replace(query=urlencode(route_entries)).geturl()
    migrated["controlCount"] = len(expected_by_key)
    serve.validate_volume_settings_preset_payload(migrated, schema)
    return migrated, profile


def _source_entries(source_store, schema):
    source_store = Path(source_store).expanduser().resolve()
    aliases_dir = source_store / "aliases"
    if not aliases_dir.is_dir():
        raise ValueError(f"settings preset migration source has no aliases directory: {source_store}")
    entries = []
    for alias_path in sorted(aliases_dir.glob("*.json")):
        alias_document = _read_object(alias_path, "alias")
        alias = alias_document.get("alias")
        if alias_path.stem != alias or alias_document.get("identity") != "kaminos-volume-settings-preset-alias-v1":
            raise ValueError(f"settings preset migration alias identity mismatch: {alias_path}")
        if alias_document.get("schemaIdentity") != schema.get("identity"):
            raise ValueError(f"settings preset migration alias schema mismatch: {alias}")
        preset_id = alias_document.get("presetId")
        artifact_path = source_store / "presets" / f"{preset_id}.json"
        artifact = _read_object(artifact_path, "artifact")
        if (
            artifact.get("identity") != serve.VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY
            or artifact.get("presetId") != preset_id
            or artifact.get("schemaIdentity") != schema.get("identity")
        ):
            raise ValueError(f"settings preset migration artifact identity mismatch: {preset_id}")
        payload = artifact.get("preset") or {}
        content_hash = _source_content_hash(payload)
        if (
            artifact.get("contentHash") != f"sha256:{content_hash}"
            or alias_document.get("contentHash") != artifact.get("contentHash")
            or preset_id != f"vsp-{content_hash}"
        ):
            raise ValueError(f"settings preset migration source content hash mismatch: {preset_id}")
        if artifact.get("controlCount") != payload.get("controlCount"):
            raise ValueError(f"settings preset migration artifact control count mismatch: {preset_id}")
        migrated, profile = migrate_volume_settings_preset_payload(payload, schema)
        label = alias_document.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"settings preset migration alias label is invalid: {alias}")
        entries.append({
            "alias": alias,
            "label": label,
            "presetId": preset_id,
            "profile": profile,
            "payload": migrated,
            "source": alias_document.get("source") or artifact.get("source") or {},
            "sourceStore": str(source_store),
        })
    return entries


def migrate_volume_settings_preset_stores(source_stores, target_store, schema=None):
    schema = schema or json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    sources = [Path(path).expanduser().resolve() for path in source_stores]
    target = Path(target_store).expanduser().resolve()
    if not sources:
        raise ValueError("settings preset migration requires at least one source store")
    if target in sources:
        raise ValueError("settings preset migration target must differ from every source store")
    migration_source = serve.volume_settings_server_source()

    prepared = []
    seen_aliases = {}
    for source in sources:
        for entry in _source_entries(source, schema):
            previous = seen_aliases.get(entry["alias"])
            if previous and previous["presetId"] != entry["presetId"]:
                raise ValueError(f"settings preset migration source alias collision: {entry['alias']}")
            if previous:
                continue
            seen_aliases[entry["alias"]] = entry
            prepared.append(entry)

    receipts = []
    for entry in prepared:
        source = {
            "migrationIdentity": "kaminos-volume-settings-preset-migration-v1",
            "migrationProfile": entry["profile"],
            "migrationSource": migration_source,
            "sourceStore": entry["sourceStore"],
            "sourcePresetId": entry["presetId"],
            "source": entry["source"],
        }
        receipt = serve.write_volume_settings_preset(
            target, entry["label"], entry["payload"], source, schema
        )
        receipts.append({
            "sourceAlias": entry["alias"],
            "sourcePresetId": entry["presetId"],
            "profile": entry["profile"],
            "effectiveAlias": receipt["effective"]["alias"],
            "effectivePresetId": receipt["effective"]["presetId"],
            "idempotent": receipt["effective"]["idempotent"],
        })

    effective_index = serve.list_volume_settings_presets(target, schema)
    return {
        "identity": "kaminos-volume-settings-preset-migration-receipt-v1",
        "migratedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceStores": [str(path) for path in sources],
        "targetStore": str(target),
        "schemaIdentity": schema["identity"],
        "controlCount": schema["controlCount"],
        "migrationSource": migration_source,
        "sourceAliasCount": len(prepared),
        "effectiveAliasCount": len(effective_index["entries"]),
        "entries": receipts,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-store", action="append", required=True)
    parser.add_argument("--target-store", required=True)
    parser.add_argument("--schema", default=str(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    schema = json.loads(Path(args.schema).read_text())
    receipt = migrate_volume_settings_preset_stores(
        args.source_store, args.target_store, schema=schema
    )
    if args.json:
        print(json.dumps(receipt, indent=2))
    else:
        print(
            f"migrated {receipt['sourceAliasCount']} aliases to "
            f"{receipt['targetStore']} ({receipt['controlCount']} controls)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
