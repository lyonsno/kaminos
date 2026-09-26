#!/usr/bin/env python3
"""Shared basin library contracts.

Basins saved on any branch are published to one shared store, every server
reads through its own store to the shared one, and a basin written by a branch
with a different control inventory still loads: unknown controls are carried
and reported, unsupported option values fall back to their additive default
with a receipt, and nothing is silently rejected.
"""

import copy
import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve  # noqa: E402

BASE_SCHEMA = {
    "identity": "kaminos-volume-settings-preset-schema-v2",
    "controlCount": 3,
    "controls": [
        {"key": "volume-scene", "param": "volume_scene", "tagName": "SELECT", "type": "select-one"},
        {"key": "volume-detail", "param": "volume_detail", "tagName": "INPUT", "type": "range", "additiveDefault": 0.25},
        {"key": "volume-mode", "param": "volume_mode", "tagName": "SELECT", "type": "select-one",
         "additiveDefault": "a", "allowedValues": ["a", "b"]},
    ],
    "rendererControls": [],
    "presentationControls": [],
    "retiredControls": [],
    "routeExtraParams": ["volume_quality_reason"],
    "activationParam": {"key": "kaminos_volume_smoke", "value": "1"},
    "excludedStateFields": ["fluidField"],
    "forbiddenPresetFields": ["fluidField"],
    "allowedNativePresetFields": [
        "identity", "kind", "schemaIdentity", "savedAt", "route", "domControls", "controlCount",
        "rendererControls", "rendererControlCount", "presentationControls", "presentationControlCount",
        "stateExclusions", "note",
    ],
}

# A newer branch: one added control and one added option value.
NEWER_SCHEMA = copy.deepcopy(BASE_SCHEMA)
NEWER_SCHEMA["controls"].append(
    {"key": "volume-new-knob", "param": "volume_new_knob", "tagName": "INPUT", "type": "range", "additiveDefault": 1.0})
NEWER_SCHEMA["controls"][2]["allowedValues"] = ["a", "b", "c"]
NEWER_SCHEMA["controlCount"] = 4


def payload(schema, values):
    controls = {}
    route = [("kaminos_volume_smoke", "1")]
    for descriptor in schema["controls"]:
        value = values[descriptor["key"]]
        controls[descriptor["key"]] = {
            "id": descriptor["key"], "param": descriptor["param"],
            "tagName": descriptor["tagName"], "type": descriptor["type"], "value": value,
        }
        route.append((descriptor["param"], serve._settings_preset_route_value(value)))
    route.append(("volume_quality_reason", "shared-store-contract"))
    return {
        "identity": "kaminos-volume-settings-preset-v2", "kind": "settings-preset",
        "schemaIdentity": schema["identity"], "savedAt": "2026-09-26T10:00:00Z",
        "route": "http://kaminos.invalid/?" + urlencode(route),
        "domControls": controls, "controlCount": len(controls),
        "stateExclusions": {"fluidField": True},
    }


BASE_VALUES = {"volume-scene": "tall_plume", "volume-detail": 0.7727, "volume-mode": "b"}
NEWER_VALUES = {**BASE_VALUES, "volume-new-knob": 0.3, "volume-mode": "c"}
SOURCE = {"repoRoot": "/tmp/contract", "branch": "contract", "commit": "0" * 40, "dirty": False}


def _age_alias(path):
    document = json.loads(path.read_text())
    document["updatedAt"] = "2000-01-01T00:00:00Z"
    path.write_text(json.dumps(document))


def test_newer_branch_basin_loads_on_older_branch(tmp):
    store = tmp / "store"
    written = serve.write_volume_settings_preset(store, "newer basin", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    preset_id = written["effective"]["presetId"]

    read = serve.read_volume_settings_preset(store, preset_id, BASE_SCHEMA)
    assert read["presetId"] == preset_id, "content identity is the raw artifact's, unchanged by projection"
    projection = read["schemaProjection"]
    assert projection["carriedControls"] == [
        {"axis": "basin", "id": "volume-new-knob", "param": "volume_new_knob", "value": 0.3}], projection
    assert projection["unsupportedValuesDefaulted"] == [
        {"axis": "basin", "id": "volume-mode", "param": "volume_mode", "value": "c", "effective": "a"}], projection
    route = dict(parse_qsl(urlparse(read["preset"]["route"]).query))
    assert "volume_new_knob" not in route, "carried controls are not applied on a branch that lacks them"
    assert route["volume_mode"] == "a" and route["volume_detail"] == "0.7727", route
    assert read["preset"]["domControls"]["volume-detail"]["value"] == 0.7727, "known values stay exact"
    serve.validate_volume_settings_preset_payload(read["preset"], BASE_SCHEMA)

    listing = serve.list_volume_settings_presets(store, BASE_SCHEMA)
    assert [entry["presetId"] for entry in listing["entries"]] == [preset_id], listing
    entry = listing["entries"][0]
    assert [row["id"] for row in entry["carriedControls"]] == ["volume-new-knob"], entry
    assert [row["id"] for row in entry["unsupportedValuesDefaulted"]] == ["volume-mode"], entry
    assert listing["unavailableEntries"] == []

    # One unreadable artifact is reported per entry; it does not take down the picker.
    corrupt_id = "vsp-" + "e" * 64
    (store / "presets" / f"{corrupt_id}.json").write_text(json.dumps({
        "identity": "kaminos-volume-settings-preset-artifact-v2", "presetId": corrupt_id,
        "contentHash": "sha256:" + "e" * 64, "schemaIdentity": BASE_SCHEMA["identity"], "preset": {}}))
    (store / "aliases" / "broken.json").write_text(json.dumps({
        "identity": "kaminos-volume-settings-preset-alias-v1", "alias": "broken", "label": "broken", "presetId": corrupt_id,
        "contentHash": "sha256:" + "e" * 64, "schemaIdentity": BASE_SCHEMA["identity"], "updatedAt": "2026-09-26T10:00:00Z"}))
    listing = serve.list_volume_settings_presets(store, BASE_SCHEMA)
    assert [entry["presetId"] for entry in listing["entries"]] == [preset_id]
    assert [(entry["alias"], "content hash" in entry["error"]) for entry in listing["unavailableEntries"]] == [("broken", True)]

    # An option value this branch lacks, with no default to fall back to, is
    # reported as unsupported rather than silently replaced.
    no_default = copy.deepcopy(BASE_SCHEMA)
    del no_default["controls"][2]["additiveDefault"]
    unsupported = serve.list_volume_settings_presets(store, no_default)
    assert unsupported["entries"] == []
    assert [(entry["alias"], entry["reason"], "volume-mode" in entry["error"]) for entry in unsupported["unavailableEntries"]] == [
        ("newer-basin", "unsupported-controls", True), ("broken", "invalid-artifact", False)], unsupported

    # Writes stay strict: a page must never write controls its own branch lacks.
    try:
        serve.write_volume_settings_preset(store, "bad", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, BASE_SCHEMA)
    except ValueError as error:
        assert "unknown controls" in str(error), error
    else:
        raise AssertionError("writes must reject controls outside the writing branch's schema")


def test_shared_store_publication_read_through_and_alias_history(tmp):
    local = tmp / "local"
    shared = tmp / "shared"
    first = serve.write_volume_settings_preset_to_library(local, shared, "kiln flame", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    first_id = first["effective"]["presetId"]
    assert first["sharedPublication"]["storePath"] == str(shared.resolve()) and first["sharedPublication"]["published"] is True
    assert (shared / "presets" / f"{first_id}.json").exists()
    second = serve.write_volume_settings_preset_to_library(
        local, shared, "kiln flame", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    second_id = second["effective"]["presetId"]

    other_local = tmp / "other-branch-store"
    found = serve.read_volume_settings_preset_layered([("local", other_local), ("shared", shared)], first_id, BASE_SCHEMA)
    assert found["presetId"] == first_id and found["storeRole"] == "shared", "another branch reads the shared basin"
    by_label = serve.read_volume_settings_preset_layered([("local", other_local), ("shared", shared)], "kiln-flame", BASE_SCHEMA)
    assert by_label["presetId"] == second_id, "the shared label follows its latest publication"

    history = [json.loads(line) for line in (shared / "alias-history" / "kiln-flame.jsonl").read_text().splitlines()]
    assert [row["presetId"] for row in history] == [first_id, second_id], history
    assert all(row["source"]["branch"] == "contract" for row in history)

    listing = serve.list_volume_settings_presets_layered([("local", other_local), ("shared", shared)], BASE_SCHEMA)
    assert [(entry["presetId"], entry["storeRole"]) for entry in listing["entries"]] == [(second_id, "shared")], listing
    own = serve.list_volume_settings_presets_layered([("local", local), ("shared", shared)], BASE_SCHEMA)
    assert [(entry["presetId"], entry["storeRole"]) for entry in own["entries"]] == [(second_id, "local")], \
        "a label present locally is not listed twice"

    # Another branch re-points the shared label: every branch now sees it, the
    # older pointer survives in the label history.
    other = serve.write_volume_settings_preset_to_library(
        other_local, shared, "kiln flame", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.125}),
        {**SOURCE, "branch": "other"}, BASE_SCHEMA)
    other_id = other["effective"]["presetId"]
    _age_alias(local / "aliases" / "kiln-flame.json")
    assert serve.read_volume_settings_preset_layered([("local", local), ("shared", shared)], "kiln-flame", BASE_SCHEMA)["presetId"] == other_id
    relisted = serve.list_volume_settings_presets_layered([("local", local), ("shared", shared)], BASE_SCHEMA)
    assert [(entry["presetId"], entry["storeRole"]) for entry in relisted["entries"]] == [(other_id, "shared")], relisted
    history = [json.loads(line) for line in (shared / "alias-history" / "kiln-flame.jsonl").read_text().splitlines()]
    assert [row["presetId"] for row in history] == [first_id, second_id, other_id]

    # Disabled sharing still saves locally and says so.
    solo = serve.write_volume_settings_preset_to_library(tmp / "solo", None, "solo", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    assert solo["sharedPublication"]["published"] is False and solo["effective"]["presetId"] == first_id

    # A tampered artifact is never published.
    tampered = json.loads((local / "presets" / f"{first_id}.json").read_text())
    tampered["preset"]["domControls"]["volume-detail"]["value"] = 0.9
    try:
        serve.publish_volume_settings_preset(shared, tampered, "tampered", SOURCE, BASE_SCHEMA)
    except ValueError as error:
        assert "content hash" in str(error), error
    else:
        raise AssertionError("publication must verify the artifact content hash")


def test_import_existing_stores_into_the_library(tmp):
    store_a = tmp / "lane-a"
    store_b = tmp / "lane-b"
    shared = tmp / "library"
    a = serve.write_volume_settings_preset(store_a, "blast furnace", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    b = serve.write_volume_settings_preset(store_b, "blast furnace", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    c = serve.write_volume_settings_preset(store_b, "newer", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    corrupt = store_b / "presets" / ("vsp-" + "f" * 64 + ".json")
    corrupt.write_text(json.dumps({"identity": "kaminos-volume-settings-preset-artifact-v2", "presetId": "vsp-" + "f" * 64,
                                   "contentHash": "sha256:" + "f" * 64, "schemaIdentity": BASE_SCHEMA["identity"], "preset": {}}))

    report = serve.import_volume_settings_stores(shared, [store_a, store_b])
    assert a["effective"]["presetId"] == b["effective"]["presetId"]
    ids = sorted(path.stem for path in (shared / "presets").glob("vsp-*.json"))
    assert ids == sorted({a["effective"]["presetId"], c["effective"]["presetId"]}), ids
    assert report["presetsImported"] == 2 and report["presetsAlreadyPresent"] == 1, report
    assert [row["reason"] for row in report["skipped"]] == ["content-hash-mismatch"], report["skipped"]
    assert serve.read_volume_settings_preset(shared, "newer", BASE_SCHEMA)["schemaProjection"]["carriedControls"], \
        "imported newer-branch basins stay readable"
    history_before = (shared / "alias-history" / "blast-furnace.jsonl").read_text()
    again = serve.import_volume_settings_stores(shared, [store_a, store_b])
    assert again["presetsImported"] == 0 and again["aliasHistoryRowsAppended"] == 0, "import is idempotent"
    assert (shared / "alias-history" / "blast-furnace.jsonl").read_text() == history_before


def main():
    for test in (
        test_newer_branch_basin_loads_on_older_branch,
        test_shared_store_publication_read_through_and_alias_history,
        test_import_existing_stores_into_the_library,
    ):
        with tempfile.TemporaryDirectory() as directory:
            test(Path(directory))
    print("volume settings shared store contracts passed")


if __name__ == "__main__":
    main()
