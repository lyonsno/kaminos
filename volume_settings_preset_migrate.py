#!/usr/bin/env python3
"""Materialize strict current-schema settings presets from admitted older stores."""

import argparse
import hashlib
import json
import time
from pathlib import Path

import serve


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
    presentation_controls = payload.get("presentationControls")
    if presentation_controls:
        canonical["presentationControls"] = {
            key: _control_value(descriptor)
            for key, descriptor in presentation_controls.items()
        }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def migrate_volume_settings_preset_payload(payload, schema=None):
    schema = schema or json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
    migrated, _projection = serve.normalize_volume_settings_preset_payload(payload, schema)
    serve.validate_volume_settings_preset_payload(migrated, schema)
    return migrated, "schema-additive-defaults"


def _defaults_applied(source_payload, migrated_payload):
    defaults = []
    for field in ("domControls", "rendererControls", "presentationControls"):
        source_keys = set((source_payload.get(field) or {}).keys())
        migrated_keys = set((migrated_payload.get(field) or {}).keys())
        defaults.extend(sorted(migrated_keys - source_keys))
    return defaults


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
        defaults_applied = _defaults_applied(payload, migrated)
        label = alias_document.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"settings preset migration alias label is invalid: {alias}")
        entries.append({
            "alias": alias,
            "label": label,
            "presetId": preset_id,
            "profile": profile,
            "defaultsApplied": defaults_applied,
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
            "defaultsApplied": entry["defaultsApplied"],
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
