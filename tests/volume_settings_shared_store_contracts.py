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
        ("newer-basin", "schema-skew", True), ("broken", "invalid-artifact", False)], unsupported

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
    assert [(entry["presetId"], entry["storeRole"]) for entry in own["entries"]] == [(second_id, "shared")], \
        "the library is the label authority, and a label present in both stores is listed once"

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


def test_label_versions_stay_selectable(tmp):
    """A label follows its newest save, but no version of it disappears from the picker."""
    lane_a = tmp / "lane-a"
    lane_b = tmp / "lane-b"
    shared = tmp / "library"
    older = serve.write_volume_settings_preset(lane_a, "roast", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    _age_alias(lane_a / "aliases" / "roast.json")
    newer = serve.write_volume_settings_preset(
        lane_b, "roast", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), {**SOURCE, "branch": "lane-b"}, BASE_SCHEMA)
    older_id = older["effective"]["presetId"]
    newer_id = newer["effective"]["presetId"]

    # Two stores disagree about a label: the newest is current, the other stays selectable.
    listing = serve.list_volume_settings_presets_layered([("local", lane_a), ("shared", lane_b)], BASE_SCHEMA)
    assert [(entry["presetId"], entry["storeRole"]) for entry in listing["entries"]] == [(newer_id, "shared")], listing
    assert [(entry["presetId"], entry["label"], entry["storeRole"], entry["reason"]) for entry in listing["earlierVersions"]] == [
        (older_id, "roast", "local", "other-store-label")], listing["earlierVersions"]

    # Re-pointing a label in one store keeps the earlier target selectable through its history.
    third = serve.write_volume_settings_preset(
        lane_b, "roast", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.125}), {**SOURCE, "branch": "lane-b"}, BASE_SCHEMA)
    third_id = third["effective"]["presetId"]
    own = serve.list_volume_settings_presets(lane_b, BASE_SCHEMA)
    assert [entry["presetId"] for entry in own["entries"]] == [third_id]
    assert [(entry["presetId"], entry["reason"], entry["source"]["branch"]) for entry in own["earlierVersions"]] == [
        (newer_id, "superseded-label", "lane-b")], own["earlierVersions"]
    assert serve.read_volume_settings_preset(lane_b, newer_id, BASE_SCHEMA)["presetId"] == newer_id

    # Importing both lanes keeps every version selectable and says how many are not current.
    report = serve.import_volume_settings_stores(shared, [lane_a, lane_b])
    library = serve.list_volume_settings_presets(shared, BASE_SCHEMA)
    assert [entry["presetId"] for entry in library["entries"]] == [third_id], library["entries"]
    assert sorted(entry["presetId"] for entry in library["earlierVersions"]) == sorted([older_id, newer_id]), library["earlierVersions"]
    assert report["presetsWithCurrentLabel"] == 1 and report["presetsOnlyInLabelHistory"] == 2, report
    assert report["presetsWithoutLabel"] == 0, report


def test_lagging_branch_save_holds_the_shared_label(tmp):
    """A branch that lacks some of a basin's controls cannot take its label in the library."""
    shared = tmp / "library"
    newer_local = tmp / "newer-branch"
    older_local = tmp / "older-branch"
    original = serve.write_volume_settings_preset_to_library(
        newer_local, shared, "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    original_id = original["effective"]["presetId"]
    loaded = serve.read_volume_settings_preset_layered([("local", older_local), ("shared", shared)], "kiln", BASE_SCHEMA)
    assert loaded["presetId"] == original_id
    resaved = serve.write_volume_settings_preset_to_library(
        older_local, shared, "kiln", loaded["preset"], {**SOURCE, "branch": "older"}, BASE_SCHEMA)
    lossy_id = resaved["effective"]["presetId"]
    assert lossy_id != original_id
    publication = resaved["sharedPublication"]
    assert publication["published"] is True and publication["aliasMoved"] is False, publication
    assert publication["aliasHeld"] == {
        "reason": "would-drop-controls", "controls": ["volume-new-knob"], "currentPresetId": original_id}, publication
    assert (shared / "presets" / f"{lossy_id}.json").exists(), "the lossy copy is still kept in the library"
    fresh = tmp / "fresh-newer-branch"
    assert serve.read_volume_settings_preset_layered([("local", fresh), ("shared", shared)], "kiln", NEWER_SCHEMA)["presetId"] == original_id
    listing = serve.list_volume_settings_presets_layered([("local", fresh), ("shared", shared)], NEWER_SCHEMA)
    assert [entry["presetId"] for entry in listing["entries"]] == [original_id], listing
    assert [entry["presetId"] for entry in listing["earlierVersions"]] == [lossy_id], "the held copy stays selectable by version"


def test_newest_unreadable_version_is_not_shadowed(tmp):
    """When a label's newest version cannot load here, the picker says so instead of offering an older one as current."""
    retiring = copy.deepcopy(BASE_SCHEMA)
    retiring["controls"] = [control for control in retiring["controls"] if control["key"] != "volume-scene"]
    retiring["retiredControls"] = [{"axis": "domControls", "key": "volume-scene", "param": "volume_scene",
                                    "tagName": "SELECT", "type": "select-one"}]
    retiring["controlCount"] = len(retiring["controls"])
    local = tmp / "older-branch"
    shared = tmp / "library"
    older = serve.write_volume_settings_preset(local, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    _age_alias(local / "aliases" / "kiln.json")
    retired_branch_payload = payload(retiring, {key: value for key, value in BASE_VALUES.items() if key != "volume-scene"})
    newer = serve.write_volume_settings_preset_to_library(
        tmp / "retiring-branch", shared, "kiln", retired_branch_payload, {**SOURCE, "branch": "retiring"}, retiring)
    # volume-scene has no additive default on BASE: the retiring branch's basin cannot load here.
    listing = serve.list_volume_settings_presets_layered([("local", local), ("shared", shared)], BASE_SCHEMA)
    assert listing["entries"] == [], listing["entries"]
    assert [(entry["presetId"], entry["reason"]) for entry in listing["unavailableEntries"]] == [
        (newer["effective"]["presetId"], "schema-skew")], listing["unavailableEntries"]
    assert [(entry["presetId"], entry["reason"]) for entry in listing["earlierVersions"]] == [
        (older["effective"]["presetId"], "other-store-label")], listing["earlierVersions"]


def test_malformed_alias_is_reported_alone(tmp):
    store = tmp / "store"
    good = serve.write_volume_settings_preset(store, "good", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    (store / "aliases" / "no-label.json").write_text(json.dumps({
        "identity": "kaminos-volume-settings-preset-alias-v1", "alias": "no-label", "presetId": good["effective"]["presetId"]}))
    (store / "aliases" / "bad-target.json").write_text(json.dumps({
        "identity": "kaminos-volume-settings-preset-alias-v1", "alias": "bad-target", "label": "bad target", "presetId": "not-an-id"}))
    (store / "aliases" / "not-json.json").write_text("{")
    other = serve.write_volume_settings_preset(store, "odd time", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    odd = json.loads((store / "aliases" / "odd-time.json").read_text())
    odd["updatedAt"] = 5
    (store / "aliases" / "odd-time.json").write_text(json.dumps(odd))
    listing = serve.list_volume_settings_presets(store, BASE_SCHEMA)
    assert sorted(entry["alias"] for entry in listing["entries"]) == ["good", "odd-time"], "a non-string timestamp does not break the index"
    listing = {**listing, "entries": [entry for entry in listing["entries"] if entry["alias"] == "good"]}
    assert [entry["alias"] for entry in listing["entries"]] == ["good"], listing
    assert all(entry.get("presetId", "").startswith("vsp-") and len(entry["presetId"]) == 68 for entry in listing["unavailableEntries"]), listing
    assert sorted(entry["alias"] for entry in listing["invalidAliases"]) == ["bad-target", "no-label", "not-json"], listing
    layered = serve.list_volume_settings_presets_layered([("local", store)], BASE_SCHEMA)
    assert sorted(entry["alias"] for entry in layered["invalidAliases"]) == ["bad-target", "no-label", "not-json"]


VALUE_ONLY_SCHEMA = copy.deepcopy(BASE_SCHEMA)
VALUE_ONLY_SCHEMA["controls"][2]["allowedValues"] = ["a", "b", "c"]


def _alias_target(store, alias):
    return json.loads((store / "aliases" / f"{alias}.json").read_text())["presetId"]


def test_every_writer_holds_a_label_it_cannot_represent(tmp):
    """No writer moves a label onto a copy that loses controls or values the current basin has."""
    shared = tmp / "library"
    original = serve.write_volume_settings_preset_to_library(
        tmp / "newer", shared, "kiln", payload(VALUE_ONLY_SCHEMA, {**BASE_VALUES, "volume-mode": "c"}), SOURCE, VALUE_ONLY_SCHEMA)
    original_id = original["effective"]["presetId"]
    loaded = serve.read_volume_settings_preset_layered([("local", tmp / "older"), ("shared", shared)], "kiln", BASE_SCHEMA)
    assert loaded["schemaProjection"]["unsupportedValuesDefaulted"], "the older branch replaces volume-mode c"
    # A headless save of only-replaced values (no dropped control) is held too.
    resaved = serve.write_volume_settings_preset_to_library(
        tmp / "older", shared, "kiln", loaded["preset"], {**SOURCE, "branch": "older"}, BASE_SCHEMA)
    assert resaved["sharedPublication"]["aliasHeld"] == {
        "reason": "would-replace-values", "controls": ["volume-mode"], "currentPresetId": original_id}, resaved["sharedPublication"]
    assert _alias_target(shared, "kiln") == original_id

    # A server whose own store is the library holds at its local write as well.
    newer_original = serve.write_volume_settings_preset_to_library(
        tmp / "newer-2", shared, "furnace", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    loaded = serve.read_volume_settings_preset_layered(serve.volume_settings_store_layers(shared, shared), "furnace", BASE_SCHEMA)
    same = serve.write_volume_settings_preset_to_library(shared, shared, "furnace", loaded["preset"], {**SOURCE, "branch": "older"}, BASE_SCHEMA)
    assert same["effective"]["aliasHeld"]["reason"] == "would-drop-controls", same["effective"]
    assert _alias_target(shared, "furnace") == newer_original["effective"]["presetId"]

    # The held copy is listed as held, not as an earlier version.
    listing = serve.list_volume_settings_presets(shared, VALUE_ONLY_SCHEMA)
    held = [entry for entry in listing["earlierVersions"]
            if entry["alias"] == "kiln" and entry["presetId"] == resaved["effective"]["presetId"]]
    assert [entry["reason"] for entry in held] == ["held-label"], listing["earlierVersions"]

    # An exact same-branch resave still moves the label.
    edited = serve.write_volume_settings_preset_to_library(
        tmp / "newer", shared, "kiln", payload(VALUE_ONLY_SCHEMA, {**BASE_VALUES, "volume-mode": "c", "volume-detail": 0.5}),
        SOURCE, VALUE_ONLY_SCHEMA)
    assert edited["sharedPublication"]["aliasMoved"] is True and edited["effective"]["aliasHeld"] is None
    assert _alias_target(shared, "kiln") == edited["effective"]["presetId"]


def test_import_keeps_live_labels(tmp):
    """Importing lane stores never moves a label a live save set, even onto a newer pointer."""
    shared = tmp / "library"
    original = serve.write_volume_settings_preset_to_library(
        tmp / "newer", shared, "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    original_id = original["effective"]["presetId"]
    loaded = serve.read_volume_settings_preset_layered([("local", tmp / "older"), ("shared", shared)], "kiln", BASE_SCHEMA)
    held = serve.write_volume_settings_preset_to_library(
        tmp / "older", shared, "kiln", loaded["preset"], {**SOURCE, "branch": "older"}, BASE_SCHEMA)
    assert held["effective"]["aliasHeld"] and not (tmp / "older" / "aliases" / "kiln.json").exists(), \
        "the lane's own label follows the library's hold"
    # A lane still on code without the library writes the same copy under
    # "kiln" into its own store, with a pointer newer than the library's.
    lagging = serve.write_volume_settings_preset(tmp / "old-code-lane", "kiln", loaded["preset"], {**SOURCE, "branch": "old"}, BASE_SCHEMA)
    _age_alias(shared / "aliases" / "kiln.json")
    report = serve.import_volume_settings_stores(shared, [tmp / "newer", tmp / "old-code-lane"], NEWER_SCHEMA)
    assert _alias_target(shared, "kiln") == original_id, report
    assert report["aliasesKeptLive"] == 1 and report["aliasesMoved"] == 0, report
    versions = serve.list_volume_settings_presets(shared, NEWER_SCHEMA)["earlierVersions"]
    assert lagging["effective"]["presetId"] in [entry["presetId"] for entry in versions]

    # Between imported pointers, a candidate that drops controls does not take the label.
    fresh = tmp / "fresh-library"
    lagging_alias = tmp / "old-code-lane" / "aliases" / "kiln.json"
    pointer = json.loads(lagging_alias.read_text())
    pointer["updatedAt"] = "2099-01-01T00:00:00Z"
    lagging_alias.write_text(json.dumps(pointer))
    report = serve.import_volume_settings_stores(fresh, [tmp / "newer", tmp / "old-code-lane"], NEWER_SCHEMA)
    assert _alias_target(fresh, "kiln") == original_id, report
    assert report["aliasesHeld"] == 1, report


def test_label_history_keeps_every_pointer(tmp):
    store = tmp / "store"
    a = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    # An older-code writer re-points the label without touching the history.
    b = serve.write_volume_settings_preset(tmp / "scratch", "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    (store / "presets" / f"{b['effective']['presetId']}.json").write_text(
        (tmp / "scratch" / "presets" / f"{b['effective']['presetId']}.json").read_text())
    alias = json.loads((store / "aliases" / "kiln.json").read_text())
    alias.update({"presetId": b["effective"]["presetId"], "contentHash": b["effective"]["contentHash"], "updatedAt": "2026-09-27T01:00:00Z"})
    (store / "aliases" / "kiln.json").write_text(json.dumps(alias))
    c = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.125}), SOURCE, BASE_SCHEMA)
    listing = serve.list_volume_settings_presets(store, BASE_SCHEMA)
    assert [entry["presetId"] for entry in listing["entries"]] == [c["effective"]["presetId"]]
    assert sorted(entry["presetId"] for entry in listing["earlierVersions"]) == sorted(
        [a["effective"]["presetId"], b["effective"]["presetId"]]), listing["earlierVersions"]


def test_bad_history_rows_are_skipped(tmp):
    store = tmp / "store"
    first = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    history = store / "alias-history" / "kiln.jsonl"
    with history.open("a") as handle:
        handle.write('{"presetId": "vsp-trunc\n')
        handle.write("null\n")
        handle.write(json.dumps({"presetId": "not-an-id", "label": "kiln"}) + "\n")
    listing = serve.list_volume_settings_presets(store, BASE_SCHEMA)
    assert [entry["presetId"] for entry in listing["entries"]] == [first["effective"]["presetId"]]
    assert all(entry["presetId"].startswith("vsp-") and len(entry["presetId"]) == 68 for entry in listing["unavailableEntries"])
    assert [row["line"] for row in listing["invalidHistoryRows"]] == [2, 3, 4], listing["invalidHistoryRows"]
    second = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    assert _alias_target(store, "kiln") == second["effective"]["presetId"], "a bad history row does not block saves"
    layered = serve.list_volume_settings_presets_layered([("local", store)], BASE_SCHEMA)
    assert [row["line"] for row in layered["invalidHistoryRows"]] == [2, 3, 4]


def test_library_is_the_label_authority(tmp):
    """With the library on, one decision per save, against the label readers resolve."""
    library = tmp / "library"
    default_local = tmp / "default-local"
    # X1: the default local store points "kiln" at an older basin W; a newer
    # branch publishes X to the library; an older branch opens "kiln" and saves.
    older_w = serve.write_volume_settings_preset(default_local, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    newer_x = serve.write_volume_settings_preset_to_library(
        tmp / "newer-local", library, "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    x_id = newer_x["effective"]["presetId"]
    loaded = serve.read_volume_settings_preset_layered([("local", default_local), ("shared", library)], "kiln", BASE_SCHEMA)
    assert loaded["presetId"] == x_id and loaded["storeRole"] == "shared", "the library's label wins over a local pointer"
    resaved = serve.write_volume_settings_preset_to_library(
        default_local, library, "kiln", loaded["preset"], {**SOURCE, "branch": "older"}, BASE_SCHEMA)
    assert resaved["effective"]["aliasHeld"] == resaved["sharedPublication"]["aliasHeld"] == {
        "reason": "would-drop-controls", "controls": ["volume-new-knob"], "currentPresetId": x_id}, resaved
    assert _alias_target(library, "kiln") == x_id
    assert _alias_target(default_local, "kiln") == older_w["effective"]["presetId"], "the local label follows the one decision"
    for layers in ([("local", default_local), ("shared", library)], [("local", tmp / "newer-local"), ("shared", library)]):
        assert serve.read_volume_settings_preset_layered(layers, "kiln", NEWER_SCHEMA)["presetId"] == x_id

    # X2: a server without the library saves a newer basin under "kiln" to the
    # default local store only; library readers still resolve the library's label.
    library_2 = tmp / "library-2"
    local_2 = tmp / "default-local-2"
    w = serve.write_volume_settings_preset_to_library(local_2, library_2, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    x = serve.write_volume_settings_preset(local_2, "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    assert _alias_target(local_2, "kiln") == x["effective"]["presetId"]
    listing = serve.list_volume_settings_presets_layered([("local", local_2), ("shared", library_2)], BASE_SCHEMA)
    assert [(entry["presetId"], entry["storeRole"]) for entry in listing["entries"]] == [(w["effective"]["presetId"], "shared")], listing
    assert (x["effective"]["presetId"], "other-store-label") in [(entry["presetId"], entry["reason"]) for entry in listing["earlierVersions"]]
    loaded = serve.read_volume_settings_preset_layered([("local", local_2), ("shared", library_2)], "kiln", BASE_SCHEMA)
    assert loaded["presetId"] == w["effective"]["presetId"]
    edited = serve.write_volume_settings_preset_to_library(
        local_2, library_2, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    assert edited["sharedPublication"]["aliasMoved"] is True and edited["sharedPublication"]["aliasHeld"] is None, "a truthful move is reported"
    assert _alias_target(library_2, "kiln") == edited["effective"]["presetId"]
    # The default local store's label points at a basin this branch cannot
    # hold; branches without the library still read it there, so it stays.
    assert _alias_target(local_2, "kiln") == x["effective"]["presetId"]
    assert edited["effective"]["aliasHeld"]["scope"] == "local-store", edited["effective"]

    # With the library off, the local store is the authority and decides alone.
    solo = tmp / "solo"
    serve.write_volume_settings_preset(solo, "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    loaded = serve.read_volume_settings_preset_layered([("local", solo)], "kiln", BASE_SCHEMA)
    held = serve.write_volume_settings_preset_to_library(solo, None, "kiln", loaded["preset"], SOURCE, BASE_SCHEMA)
    assert held["effective"]["aliasHeld"]["reason"] == "would-drop-controls" and held["sharedPublication"]["published"] is False


def test_damaged_label_state_does_not_block_saves(tmp):
    store = tmp / "store"
    first = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    (store / "presets" / f"{first['effective']['presetId']}.json").write_text("{")
    second = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    assert _alias_target(store, "kiln") == second["effective"]["presetId"], "an unreadable current target has nothing to protect"
    alias = json.loads((store / "aliases" / "kiln.json").read_text())
    del alias["presetId"]
    (store / "aliases" / "kiln.json").write_text(json.dumps(alias))
    third = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.125}), SOURCE, BASE_SCHEMA)
    assert _alias_target(store, "kiln") == third["effective"]["presetId"], "an alias without a target is repaired"


def test_history_rows_need_a_label_and_source_shape(tmp):
    store = tmp / "store"
    first = serve.write_volume_settings_preset(store, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    missing = "vsp-" + "a" * 64
    with (store / "alias-history" / "kiln.jsonl").open("a") as handle:
        handle.write(json.dumps({"presetId": missing, "label": 5, "publishedAt": "2026-09-27T00:00:00Z"}) + "\n")
        handle.write(json.dumps({"presetId": first["effective"]["presetId"], "label": "kiln", "source": "cli",
                                 "publishedAt": "2026-09-27T00:00:01Z"}) + "\n")
    listing = serve.list_volume_settings_presets(store, BASE_SCHEMA)
    assert [row["line"] for row in listing["invalidHistoryRows"]] == [2, 3], listing["invalidHistoryRows"]
    assert all(isinstance(entry["label"], str) for entry in listing["unavailableEntries"])
    report = serve.import_volume_settings_stores(tmp / "library", [store], BASE_SCHEMA)
    assert report["presetsImported"] == 1, report
    assert [(row["reason"], row["line"]) for row in report["skipped"]] == [("invalid-history-row", 2), ("invalid-history-row", 3)], report["skipped"]


def test_import_kept_beside_a_live_label_is_shown_as_held(tmp):
    shared = tmp / "library"
    live = serve.write_volume_settings_preset_to_library(tmp / "lane", shared, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    _age_alias(shared / "aliases" / "kiln.json")
    other = serve.write_volume_settings_preset(tmp / "old-lane", "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    report = serve.import_volume_settings_stores(shared, [tmp / "old-lane"], BASE_SCHEMA)
    assert report["aliasesKeptLive"] == 1 and _alias_target(shared, "kiln") == live["effective"]["presetId"]
    versions = serve.list_volume_settings_presets(shared, BASE_SCHEMA)["earlierVersions"]
    assert [(entry["presetId"], entry["reason"]) for entry in versions] == [(other["effective"]["presetId"], "held-label")], versions


def test_local_store_keeps_its_label_over_an_unrebased_pointer(tmp):
    """X9: a library-aware save moves the library label but not a local label a branch without the library still reads."""
    library = tmp / "library"
    default_local = tmp / "default-local"
    w = serve.write_volume_settings_preset_to_library(default_local, library, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    # A branch without the library, on a grown schema, saves its newest "kiln" to the default local store only.
    x = serve.write_volume_settings_preset(default_local, "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    x_id = x["effective"]["presetId"]
    assert _alias_target(default_local, "kiln") == x_id
    edited = serve.write_volume_settings_preset_to_library(
        default_local, library, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    edited_id = edited["effective"]["presetId"]
    assert edited["sharedPublication"]["aliasMoved"] is True and _alias_target(library, "kiln") == edited_id, "the library label follows"
    assert _alias_target(default_local, "kiln") == x_id, "the local label stays on the basin this branch cannot hold"
    assert serve.read_volume_settings_preset(default_local, "kiln", NEWER_SCHEMA)["presetId"] == x_id
    assert edited["effective"]["aliasHeld"] == {
        "reason": "would-drop-controls", "controls": ["volume-new-knob"], "currentPresetId": x_id, "scope": "local-store"}, edited["effective"]
    assert w["effective"]["presetId"] != edited_id


def test_library_decides_under_its_lock(tmp):
    """X8: a newer branch's publish landing just before the library write is seen by the decision."""
    library = tmp / "library"
    older_local = tmp / "older-local"
    serve.write_volume_settings_preset_to_library(older_local, library, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    newer = serve.write_volume_settings_preset(tmp / "newer-local", "kiln", payload(NEWER_SCHEMA, NEWER_VALUES), SOURCE, NEWER_SCHEMA)
    newer_document = json.loads((tmp / "newer-local" / "presets" / f"{newer['effective']['presetId']}.json").read_text())
    real_lock = serve._volume_settings_store_lock
    state = {"raced": False}

    def racing_lock(store):
        # The first time the saving call takes the library lock, a newer branch publishes first.
        if not state["raced"] and serve._volume_settings_store_path(store) == serve._volume_settings_store_path(library):
            state["raced"] = True
            serve.publish_volume_settings_preset(library, newer_document, "kiln", SOURCE, NEWER_SCHEMA)
        return real_lock(store)

    serve._volume_settings_store_lock = racing_lock
    try:
        resaved = serve.write_volume_settings_preset_to_library(
            older_local, library, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    finally:
        serve._volume_settings_store_lock = real_lock
    assert state["raced"]
    assert _alias_target(library, "kiln") == newer["effective"]["presetId"], "the library label stays on the newer basin"
    assert resaved["sharedPublication"]["aliasHeld"]["reason"] == "would-drop-controls", resaved["sharedPublication"]
    assert resaved["effective"]["aliasHeld"] == resaved["sharedPublication"]["aliasHeld"], "the local store follows the library's actual decision"


class _Request:
    def __init__(self, body):
        import io
        raw = json.dumps(body).encode()
        self.rfile = io.BytesIO(raw)
        self.headers = {"Content-Length": str(len(raw))}
        self.result = None

    def send_json(self, body, status=200):
        self.result = (status, body)


def test_partial_save_is_reported_truthfully(tmp):
    """The library publish can succeed and the local write fail; the save says exactly that."""
    import os
    library = tmp / "library"
    local = tmp / "local"
    first = serve.write_volume_settings_preset_to_library(local, library, "kiln", payload(BASE_SCHEMA, BASE_VALUES), SOURCE, BASE_SCHEMA)
    # A corrupt local label is a known precondition: it fails before anything is published.
    alias_path = local / "aliases" / "kiln.json"
    good_alias = alias_path.read_text()
    alias_path.write_text("{")
    try:
        serve.write_volume_settings_preset_to_library(
            local, library, "kiln", payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5}), SOURCE, BASE_SCHEMA)
    except serve.VolumeSettingsPartialSave as error:
        raise AssertionError(f"a local precondition failure must not publish first: {error}")
    except ValueError:
        pass
    else:
        raise AssertionError("a corrupt local label must fail the save")
    assert _alias_target(library, "kiln") == first["effective"]["presetId"], "nothing reached the library"
    # Over HTTP the failure names this server's store, not the library.
    serve.VOLUME_SETTINGS_STORE, serve.SHARED_BASIN_STORE = local, library
    original_schema = serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH
    (tmp / "schema.json").write_text(json.dumps(BASE_SCHEMA))
    serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH = tmp / "schema.json"
    try:
        request = _Request({"label": "kiln", "preset": payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.5})})
        serve.KaminosHandler.handle_volume_settings_presets_post(request)
    finally:
        serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH = original_schema
    assert request.result[0] == 400 and request.result[1]["failurePhase"] == "local-preset-precheck", request.result
    alias_path.write_text(good_alias)
    # A later local failure (an unwritable presets directory) after the library took the basin.
    os.chmod(local / "presets", 0o500)
    try:
        serve.VOLUME_SETTINGS_STORE, serve.SHARED_BASIN_STORE = local, library
        request = _Request({"label": "kiln", "preset": payload(BASE_SCHEMA, {**BASE_VALUES, "volume-detail": 0.125})})
        original_schema = serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH
        schema_path = tmp / "schema.json"
        schema_path.write_text(json.dumps(BASE_SCHEMA))
        serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH = schema_path
        try:
            serve.KaminosHandler.handle_volume_settings_presets_post(request)
        finally:
            serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH = original_schema
    finally:
        os.chmod(local / "presets", 0o700)
    status, body = request.result
    assert status == 500 and body["failurePhase"] == "local-preset-write", (status, body)
    publication = body["sharedPublication"]
    assert publication["published"] is True and publication["aliasMoved"] is True, publication
    assert _alias_target(library, "kiln") == publication["presetId"], "the library really has the new basin"
    assert body["partial"] is True and "not saved locally" in body["error"].lower(), body


def main():
    for test in (
        test_partial_save_is_reported_truthfully,
        test_local_store_keeps_its_label_over_an_unrebased_pointer,
        test_library_decides_under_its_lock,
        test_library_is_the_label_authority,
        test_damaged_label_state_does_not_block_saves,
        test_history_rows_need_a_label_and_source_shape,
        test_import_kept_beside_a_live_label_is_shown_as_held,
        test_every_writer_holds_a_label_it_cannot_represent,
        test_import_keeps_live_labels,
        test_label_history_keeps_every_pointer,
        test_bad_history_rows_are_skipped,
        test_lagging_branch_save_holds_the_shared_label,
        test_newest_unreadable_version_is_not_shadowed,
        test_malformed_alias_is_reported_alone,
        test_newer_branch_basin_loads_on_older_branch,
        test_shared_store_publication_read_through_and_alias_history,
        test_import_existing_stores_into_the_library,
        test_label_versions_stay_selectable,
    ):
        with tempfile.TemporaryDirectory() as directory:
            test(Path(directory))
    print("volume settings shared store contracts passed")


if __name__ == "__main__":
    main()
