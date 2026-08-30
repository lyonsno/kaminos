#!/usr/bin/env python3

import hashlib
import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
assert schema["controlCount"] == 192, "emitter family and macro-motion switches must enter the strict canonical preset inventory"
assert {
    "key": "emitter-assay-family",
    "param": "volume_emitter_family",
    "tagName": "SELECT",
    "type": "select-one",
} in schema["controls"]
for expected in (
    {
        "key": "volume-artistic-swirl",
        "param": "volume_artistic_swirl",
        "tagName": "INPUT",
        "type": "checkbox",
    },
    {
        "key": "volume-phased-sway",
        "param": "volume_phased_sway",
        "tagName": "INPUT",
        "type": "checkbox",
    },
):
    assert expected in schema["controls"]

import serve
import volume_settings_preset_migrate as migrate


MIGRATION_DEFAULTS = {
    "emitter-assay-family": "cluster",
    "volume-exposure": 1,
    "volume-reaction-boundary-fire-clean-color": "#4a86ff",
    "volume-reaction-boundary-fire-soot-color": "#ffc460",
    "volume-artistic-swirl": True,
    "volume-phased-sway": True,
}


def route_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return "" if value is None else str(value)


def legacy_payload(missing_keys):
    controls = {}
    route_entries = [("kaminos_volume_smoke", "1")]
    for descriptor in schema["controls"]:
        key = descriptor["key"]
        if key in missing_keys:
            continue
        value = "tall_plume" if key == "volume-scene" else MIGRATION_DEFAULTS.get(key, 0)
        controls[key] = {
            "id": key,
            "param": descriptor["param"],
            "tagName": descriptor["tagName"],
            "type": descriptor["type"],
            "value": value,
        }
        route_entries.append((descriptor["param"], route_value(value)))
    route_entries.append(("volume_quality_reason", "emitter-migration-contract"))
    return {
        "identity": "kaminos-volume-settings-preset-v2",
        "kind": "settings-preset",
        "schemaIdentity": schema["identity"],
        "savedAt": "2026-08-30T20:00:00Z",
        "route": f"http://127.0.0.1:18412/?{urlencode(route_entries)}",
        "domControls": controls,
        "controlCount": len(controls),
        "stateExclusions": {field: True for field in schema["excludedStateFields"]},
        "note": "settings only",
    }


def legacy_content_hash(payload):
    canonical = {
        "schemaIdentity": payload["schemaIdentity"],
        "controls": {
            key: descriptor.get("rawValue", descriptor.get("value"))
            for key, descriptor in payload["domControls"].items()
        },
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def write_legacy_store(store, alias, label, payload):
    content_hash = legacy_content_hash(payload)
    preset_id = f"vsp-{content_hash}"
    artifact = {
        "identity": "kaminos-volume-settings-preset-artifact-v2",
        "presetId": preset_id,
        "contentHash": f"sha256:{content_hash}",
        "schemaIdentity": payload["schemaIdentity"],
        "controlCount": payload["controlCount"],
        "initialLabel": label,
        "writtenAt": "2026-08-30T20:00:00Z",
        "source": {"branch": "legacy-source"},
        "preset": payload,
    }
    alias_document = {
        "identity": "kaminos-volume-settings-preset-alias-v1",
        "alias": alias,
        "label": label,
        "presetId": preset_id,
        "contentHash": artifact["contentHash"],
        "schemaIdentity": payload["schemaIdentity"],
        "updatedAt": artifact["writtenAt"],
        "source": artifact["source"],
    }
    (store / "presets").mkdir(parents=True, exist_ok=True)
    (store / "aliases").mkdir(parents=True, exist_ok=True)
    (store / "presets" / f"{preset_id}.json").write_text(json.dumps(artifact, indent=2) + "\n")
    (store / "aliases" / f"{alias}.json").write_text(json.dumps(alias_document, indent=2) + "\n")


def tree_digest(root):
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def main():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        historical = root / "historical-186"
        current = root / "current-189"
        target = root / "migrated-192"

        write_legacy_store(
            historical,
            "operator-basin",
            "Operator basin",
            legacy_payload(set(MIGRATION_DEFAULTS)),
        )
        write_legacy_store(
            current,
            "flame-fan",
            "flame-fan",
            legacy_payload({"emitter-assay-family", "volume-artistic-swirl", "volume-phased-sway"}),
        )
        source_digests = {path: tree_digest(path) for path in (historical, current)}

        receipt = migrate.migrate_volume_settings_preset_stores(
            [historical, current], target, schema=schema
        )
        assert receipt["identity"] == "kaminos-volume-settings-preset-migration-receipt-v1"
        assert receipt["sourceAliasCount"] == 2
        assert receipt["effectiveAliasCount"] == 2
        assert {entry["profile"] for entry in receipt["entries"]} == {
            "historical-186-to-192",
            "emitter-and-motion-189-to-192",
        }
        assert source_digests == {path: tree_digest(path) for path in (historical, current)}, (
            "migration must not mutate content-addressed source stores"
        )

        index = serve.list_volume_settings_presets(target, schema)
        assert index["controlCount"] == 192
        assert {entry["alias"] for entry in index["entries"]} == {"operator-basin", "flame-fan"}
        for alias in ("operator-basin", "flame-fan"):
            preset = serve.read_volume_settings_preset(target, alias, schema)["preset"]
            assert preset["controlCount"] == 192
            assert preset["domControls"]["emitter-assay-family"]["value"] == "cluster"
            assert preset["domControls"]["volume-exposure"]["value"] == 1
            assert preset["domControls"]["volume-reaction-boundary-fire-clean-color"]["value"] == "#4a86ff"
            assert preset["domControls"]["volume-reaction-boundary-fire-soot-color"]["value"] == "#ffc460"
            assert preset["domControls"]["volume-artistic-swirl"]["value"] is True
            assert preset["domControls"]["volume-phased-sway"]["value"] is True
            assert "volume_emitter_family=cluster" in preset["route"]

        repeated = migrate.migrate_volume_settings_preset_stores(
            [historical, current], target, schema=schema
        )
        assert repeated["effectiveAliasCount"] == 2
        assert len(serve.list_volume_settings_presets(target, schema)["entries"]) == 2

        malformed = root / "malformed-189"
        write_legacy_store(
            malformed,
            "missing-real-control",
            "Missing real control",
            legacy_payload({"volume-density"}),
        )
        before = tree_digest(target)
        try:
            migrate.migrate_volume_settings_preset_stores([malformed], target, schema=schema)
        except ValueError as error:
            assert "unsupported migration profile" in str(error)
        else:
            raise AssertionError("migration default-filled a missing non-additive control")
        assert tree_digest(target) == before

    print("volume settings emitter-family migration contracts passed")


if __name__ == "__main__":
    main()
