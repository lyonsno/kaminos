#!/usr/bin/env python3

import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve


REMOVED_PERSISTENCE_CONTROLS = {
    "volume-basin-slot",
    "volume-look-library-kind",
    "volume-look-library-entry",
    "volume-look-library-name",
    "volume-look-library-json",
}


def require_store_api():
    for name in (
        "_atomic_create_json",
        "write_volume_settings_preset",
        "read_volume_settings_preset",
        "list_volume_settings_presets",
    ):
        assert callable(getattr(serve, name, None)), f"shared preset store API is missing: {name}"


def v2_fixture():
    schema_path = ROOT / "volume-settings-preset-schema-v2.json"
    assert schema_path.exists(), "schema v2 must exclude removed persistence widgets"
    schema = json.loads(schema_path.read_text())
    assert schema["identity"] == "kaminos-volume-settings-preset-schema-v2"
    assert schema["controlCount"] == 186
    assert not REMOVED_PERSISTENCE_CONTROLS.intersection(entry["key"] for entry in schema["controls"])

    legacy_document = json.loads((
        ROOT / "artifacts/volume-captures/20260715-082845-operator-original-live-basin-settings.json"
    ).read_text())
    legacy = legacy_document["capture"]
    controls = {
        key: {
            "id": entry["id"],
            "param": entry["param"],
            "tagName": entry["tagName"],
            "type": entry["type"],
            "value": entry["value"],
        }
        for key, entry in legacy["domControls"].items()
        if key not in REMOVED_PERSISTENCE_CONTROLS
    }
    accepted_params = {entry["param"] for entry in schema["controls"]}
    route = urlparse(legacy["route"])
    route_entries = [
        (key, value)
        for key, value in parse_qsl(route.query, keep_blank_values=True)
        if key in accepted_params or key in {"kaminos_volume_smoke", "volume_quality_reason"}
    ]
    return {
        "identity": "kaminos-volume-settings-preset-v2",
        "kind": "settings-preset",
        "schemaIdentity": schema["identity"],
        "savedAt": legacy["savedAt"],
        "route": route._replace(query=urlencode(route_entries)).geturl(),
        "domControls": controls,
        "controlCount": len(controls),
        "stateExclusions": legacy["exclusions"],
        "note": "settings only",
    }, schema


def set_control(payload, key, value):
    payload = json.loads(json.dumps(payload))
    descriptor = payload["domControls"][key]
    descriptor["value"] = value
    route = urlparse(payload["route"])
    entries = dict(parse_qsl(route.query, keep_blank_values=True))
    entries[descriptor["param"]] = str(value)
    payload["route"] = route._replace(query=urlencode(list(entries.items()))).geturl()
    return payload


def main():
    require_store_api()
    payload, schema = v2_fixture()
    with tempfile.TemporaryDirectory() as temporary:
        store = Path(temporary) / "shared-volume-settings"
        source_a = {"repoRoot": "/tmp/worktree-a", "branch": "branch-a", "commit": "a" * 40}
        source_b = {"repoRoot": "/tmp/worktree-b", "branch": "branch-b", "commit": "b" * 40}

        first = serve.write_volume_settings_preset(store, "Operator Basin", payload, source_a, schema)
        assert first["identity"] == "kaminos-volume-settings-preset-write-receipt-v1"
        assert first["requested"]["label"] == "Operator Basin"
        assert first["effective"]["storePath"] == str(store.resolve())
        assert first["effective"]["schemaIdentity"] == schema["identity"]
        assert first["effective"]["controlCount"] == 186
        assert first["effective"]["idempotent"] is False
        assert first["effective"]["presetId"].startswith("vsp-")

        repeated = serve.write_volume_settings_preset(store, "Operator Basin", payload, source_b, schema)
        assert repeated["effective"]["presetId"] == first["effective"]["presetId"]
        assert repeated["effective"]["idempotent"] is True
        assert repeated["presetUrl"] == (
            f"/volume-settings-preset.html?preset={first['effective']['presetId']}&view=splat-only"
        )

        create_once_path = store / "create-once-contract.json"
        assert serve._atomic_create_json(create_once_path, {"owner": "first"}) is True
        assert serve._atomic_create_json(create_once_path, {"owner": "second"}) is False
        assert json.loads(create_once_path.read_text()) == {"owner": "first"}

        colliding_label = serve.write_volume_settings_preset(
            store,
            "Operator/Basin",
            set_control(payload, "volume-density", 5.1),
            source_b,
            schema,
        )
        assert colliding_label["effective"]["alias"] != first["effective"]["alias"]
        assert serve.read_volume_settings_preset(
            store, colliding_label["effective"]["alias"], schema
        )["label"] == "Operator/Basin"

        index = serve.list_volume_settings_presets(store, schema)
        assert index["identity"] == "kaminos-volume-settings-preset-index-v1"
        assert index["storePath"] == str(store.resolve())
        assert index["schemaIdentity"] == schema["identity"]
        assert len(index["entries"]) == 2
        alias = first["effective"]["alias"]
        assert {entry["alias"] for entry in index["entries"]} == {
            first["effective"]["alias"],
            colliding_label["effective"]["alias"],
        }

        by_alias = serve.read_volume_settings_preset(store, alias, schema)
        by_id = serve.read_volume_settings_preset(store, first["effective"]["presetId"], schema)
        assert by_alias["presetId"] == by_id["presetId"]
        assert by_alias["label"] == "Operator Basin"
        assert by_alias["preset"]["controlCount"] == 186
        assert by_alias["source"]["repoRoot"] == source_a["repoRoot"]

        changed = set_control(payload, "volume-density", 5.25)
        replacement = serve.write_volume_settings_preset(store, "Operator Basin", changed, source_b, schema)
        assert replacement["effective"]["presetId"] != first["effective"]["presetId"]
        assert serve.read_volume_settings_preset(store, alias, schema)["presetId"] == replacement["effective"]["presetId"]
        assert serve.read_volume_settings_preset(store, first["effective"]["presetId"], schema)["presetId"] == first["effective"]["presetId"]

        before = sorted(path.relative_to(store) for path in store.rglob("*.json"))
        partial = json.loads(json.dumps(payload))
        partial["domControls"].pop("volume-density")
        partial["controlCount"] -= 1
        try:
            serve.write_volume_settings_preset(store, "Partial", partial, source_a, schema)
        except ValueError as error:
            assert "186" in str(error) or "inventory" in str(error)
        else:
            raise AssertionError("shared store accepted a partial preset")
        assert sorted(path.relative_to(store) for path in store.rglob("*.json")) == before

        smuggled = json.loads(json.dumps(payload))
        smuggled["camera"] = {"forged": True}
        try:
            serve.write_volume_settings_preset(store, "Smuggled", smuggled, source_a, schema)
        except ValueError as error:
            assert "schema" in str(error) or "runtime" in str(error)
        else:
            raise AssertionError("shared store accepted runtime state")
        assert sorted(path.relative_to(store) for path in store.rglob("*.json")) == before

        alias_path = next((store / "aliases").glob("*.json"))
        alias_document = json.loads(alias_path.read_text())
        wrong_schema_alias = {**alias_document, "schemaIdentity": "forged-schema"}
        alias_path.write_text(json.dumps(wrong_schema_alias))
        try:
            serve.list_volume_settings_presets(store, schema)
        except ValueError as error:
            assert "alias schema mismatch" in str(error)
        else:
            raise AssertionError("shared store listed an alias with the wrong schema")
        alias_path.write_text(json.dumps(alias_document))

        alias_path.write_text("{not json")
        try:
            serve.list_volume_settings_presets(store, schema)
        except ValueError as error:
            assert "alias" in str(error).lower()
        else:
            raise AssertionError("shared store hid a corrupt alias from its operator index")

    print("volume settings store contracts passed")


if __name__ == "__main__":
    main()
