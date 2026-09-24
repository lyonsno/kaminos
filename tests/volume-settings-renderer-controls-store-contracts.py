#!/usr/bin/env python3

import copy
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve


SCHEMA = {
    "identity": "kaminos-volume-settings-preset-schema-v2",
    "controlCount": 1,
    "controls": [
        {"key": "volume-scene", "param": "volume_scene", "tagName": "SELECT", "type": "select-one"},
    ],
    "rendererControls": [
        {"key": "volume-flow-kernel-strength", "param": "volume_flow_kernel_strength", "tagName": "INPUT", "type": "range", "additiveDefault": 0},
        {"key": "volume-flow-kernel-radius", "param": "volume_flow_kernel_radius", "tagName": "INPUT", "type": "range", "additiveDefault": 0.03},
        {"key": "volume-flow-kernel-coherence", "param": "volume_flow_kernel_coherence", "tagName": "INPUT", "type": "range", "additiveDefault": 1},
    ],
    "routeExtraParams": ["volume_quality_reason"],
    "activationParam": {"key": "kaminos_volume_smoke", "value": "1"},
    "excludedStateFields": ["fluidField"],
    "forbiddenPresetFields": ["fluidField"],
    "allowedNativePresetFields": [
        "identity", "kind", "schemaIdentity", "savedAt", "route", "domControls", "controlCount",
        "rendererControls", "rendererControlCount", "stateExclusions", "note",
    ],
}


def base_payload():
    return {
        "identity": "kaminos-volume-settings-preset-v2",
        "kind": "settings-preset",
        "schemaIdentity": SCHEMA["identity"],
        "savedAt": "2026-07-16T00:00:00Z",
        "route": "http://kaminos.invalid/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_quality_reason=renderer-control-store-contract",
        "domControls": {
            "volume-scene": {
                "id": "volume-scene",
                "param": "volume_scene",
                "tagName": "SELECT",
                "type": "select-one",
                "value": "tall_plume",
            },
        },
        "controlCount": 1,
        "stateExclusions": {"fluidField": True},
        "note": "settings only",
    }


def composed_payload():
    payload = copy.deepcopy(base_payload())
    payload["rendererControls"] = {
        descriptor["key"]: {
            "id": descriptor["key"],
            "param": descriptor["param"],
            "tagName": descriptor["tagName"],
            "type": descriptor["type"],
            "value": 0.03 if descriptor["param"] == "volume_flow_kernel_radius" else 1,
        }
        for descriptor in SCHEMA["rendererControls"]
    }
    payload["rendererControlCount"] = len(payload["rendererControls"])
    payload["route"] += "&volume_flow_kernel_strength=1&volume_flow_kernel_radius=0.03&volume_flow_kernel_coherence=1"
    return payload


def main():
    old_payload = base_payload()
    new_payload = composed_payload()
    try:
        serve.validate_volume_settings_preset_payload(old_payload, SCHEMA)
    except ValueError as error:
        assert "requires exactly 3 renderer controls" in str(error)
    else:
        raise AssertionError("current writes admitted a missing renderer axis")
    assert serve.validate_volume_settings_preset_payload(new_payload, SCHEMA) is True
    assert serve._volume_settings_content_hash(old_payload, SCHEMA) != serve._volume_settings_content_hash(new_payload, SCHEMA)

    with tempfile.TemporaryDirectory() as temporary:
        store = Path(temporary)
        new_receipt = serve.write_volume_settings_preset(store, "Composed basin", new_payload, {}, SCHEMA)
        assert new_receipt["effective"]["rendererControlCount"] == 3
        new_document = serve.read_volume_settings_preset(store, new_receipt["effective"]["presetId"], SCHEMA)
        assert new_document["preset"]["rendererControls"]["volume-flow-kernel-radius"]["value"] == 0.03
        index = serve.list_volume_settings_presets(store, SCHEMA)
        assert [entry["rendererControlCount"] for entry in index["entries"]] == [3]

    print("volume settings renderer controls store contracts passed")


if __name__ == "__main__":
    main()
