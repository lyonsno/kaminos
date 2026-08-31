#!/usr/bin/env python3

import copy
import hashlib
import json
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve


SCHEMA = {
    "identity": "kaminos-volume-settings-preset-schema-v2",
    "controlCount": 2,
    "controls": [
        {"key": "volume-scene", "param": "volume_scene", "tagName": "SELECT", "type": "select-one"},
        {
            "key": "volume-new-detail",
            "param": "volume_new_detail",
            "tagName": "INPUT",
            "type": "range",
            "additiveDefault": 0.25,
        },
    ],
    "rendererControls": [
        {
            "key": "volume-renderer-detail",
            "param": "volume_renderer_detail",
            "tagName": "INPUT",
            "type": "range",
            "additiveDefault": 0.5,
        },
    ],
    "presentationControls": [
        {
            "key": "raymarch-smoke-presentation",
            "param": "volume_raymarch_smoke",
            "tagName": "BUTTON",
            "type": "button-state",
            "allowedValues": ["on", "off"],
            "additiveDefault": "on",
        },
    ],
    "retiredControls": [
        {
            "axis": "domControls",
            "key": "volume-retired-raymarch",
            "param": "volume_retired_raymarch",
            "tagName": "INPUT",
            "type": "range",
        },
    ],
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


def legacy_payload():
    return {
        "identity": "kaminos-volume-settings-preset-v2",
        "kind": "settings-preset",
        "schemaIdentity": SCHEMA["identity"],
        "savedAt": "2026-08-30T21:00:00Z",
        "route": (
            "http://kaminos.invalid/?kaminos_volume_smoke=1&volume_scene=tall_plume"
            "&volume_quality_reason=schema-evolution-contract"
        ),
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
        "note": "legacy settings only",
    }


def raw_content_hash(payload):
    canonical = {
        "schemaIdentity": payload["schemaIdentity"],
        "controls": {
            key: descriptor.get("rawValue", descriptor.get("value"))
            for key, descriptor in payload["domControls"].items()
        },
    }
    if payload.get("rendererControls"):
        canonical["rendererControls"] = {
            key: descriptor.get("rawValue", descriptor.get("value"))
            for key, descriptor in payload["rendererControls"].items()
        }
    if payload.get("presentationControls"):
        canonical["presentationControls"] = {
            key: descriptor.get("rawValue", descriptor.get("value"))
            for key, descriptor in payload["presentationControls"].items()
        }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def write_legacy_alias(store, payload):
    content_hash = raw_content_hash(payload)
    preset_id = f"vsp-{content_hash}"
    artifact = {
        "identity": "kaminos-volume-settings-preset-artifact-v2",
        "presetId": preset_id,
        "contentHash": f"sha256:{content_hash}",
        "schemaIdentity": payload["schemaIdentity"],
        "controlCount": payload["controlCount"],
        "initialLabel": "Legacy additive preset",
        "writtenAt": "2026-08-30T21:00:00Z",
        "source": {"kind": "contract"},
        "preset": payload,
    }
    alias = {
        "identity": "kaminos-volume-settings-preset-alias-v1",
        "alias": "legacy-additive-preset",
        "label": "Legacy additive preset",
        "presetId": preset_id,
        "contentHash": artifact["contentHash"],
        "schemaIdentity": payload["schemaIdentity"],
        "updatedAt": artifact["writtenAt"],
        "source": artifact["source"],
    }
    (store / "presets").mkdir(parents=True)
    (store / "aliases").mkdir(parents=True)
    (store / "presets" / f"{preset_id}.json").write_text(json.dumps(artifact, indent=2) + "\n")
    (store / "aliases" / "legacy-additive-preset.json").write_text(json.dumps(alias, indent=2) + "\n")
    return preset_id


def presentation_descriptor(value):
    descriptor = SCHEMA["presentationControls"][0]
    return {
        "id": descriptor["key"],
        "param": descriptor["param"],
        "tagName": descriptor["tagName"],
        "type": descriptor["type"],
        "value": value,
    }


def main():
    source = legacy_payload()
    normalized, projection = serve.normalize_volume_settings_preset_payload(source, SCHEMA)
    assert source["controlCount"] == 1, "normalization mutated the immutable source payload"
    assert normalized["controlCount"] == SCHEMA["controlCount"]
    assert normalized["domControls"]["volume-new-detail"]["value"] == 0.25
    assert normalized["rendererControls"]["volume-renderer-detail"]["value"] == 0.5
    assert normalized["rendererControlCount"] == 1
    assert normalized["presentationControls"]["raymarch-smoke-presentation"]["value"] == "on"
    assert normalized["presentationControlCount"] == 1
    assert "volume_new_detail=0.25" in normalized["route"]
    assert "volume_renderer_detail=0.5" in normalized["route"]
    assert "volume_raymarch_smoke=on" in normalized["route"]
    assert projection["defaultsApplied"] == [
        "volume-new-detail", "volume-renderer-detail", "raymarch-smoke-presentation",
    ]

    retired = legacy_payload()
    retired["domControls"]["volume-retired-raymarch"] = {
        "id": "volume-retired-raymarch",
        "param": "volume_retired_raymarch",
        "tagName": "INPUT",
        "type": "range",
        "value": 0.625,
    }
    retired["controlCount"] = 2
    retired["route"] += "&volume_retired_raymarch=0.625"
    projected_retired, retirement = serve.normalize_volume_settings_preset_payload(retired, SCHEMA)
    assert "volume-retired-raymarch" not in projected_retired["domControls"]
    assert projected_retired["controlCount"] == SCHEMA["controlCount"]
    assert "volume_retired_raymarch=" not in projected_retired["route"]
    assert retirement["retiredControlsStripped"] == [{
        "axis": "basin",
        "id": "volume-retired-raymarch",
        "param": "volume_retired_raymarch",
        "value": 0.625,
    }]

    mismatched_retired_route = copy.deepcopy(retired)
    mismatched_retired_route["route"] = mismatched_retired_route["route"].replace(
        "volume_retired_raymarch=0.625", "volume_retired_raymarch=0.5",
    )
    try:
        serve.normalize_volume_settings_preset_payload(mismatched_retired_route, SCHEMA)
    except ValueError as error:
        assert "retired route/control mismatch" in str(error)
    else:
        raise AssertionError("retirement projection accepted a route value that disagreed with the stored descriptor")

    overlapping_retirement_schema = copy.deepcopy(SCHEMA)
    overlapping_retirement_schema["retiredControls"].append({
        "axis": "domControls",
        **SCHEMA["controls"][0],
    })
    try:
        serve.normalize_volume_settings_preset_payload(source, overlapping_retirement_schema)
    except ValueError as error:
        assert "retired controls overlap" in str(error)
    else:
        raise AssertionError("schema admitted one control as both active and retired")

    incompatible_schema = copy.deepcopy(SCHEMA)
    incompatible_schema["controls"].append({
        "key": "volume-required-without-default",
        "param": "volume_required_without_default",
        "tagName": "INPUT",
        "type": "range",
    })
    incompatible_schema["controlCount"] = 3
    try:
        serve.normalize_volume_settings_preset_payload(source, incompatible_schema)
    except ValueError as error:
        assert "missing non-additive control" in str(error)
    else:
        raise AssertionError("normalization silently invented a missing control without a schema default")

    nonadditive_renderer_schema = copy.deepcopy(SCHEMA)
    del nonadditive_renderer_schema["rendererControls"][0]["additiveDefault"]
    try:
        serve.normalize_volume_settings_preset_payload(source, nonadditive_renderer_schema)
    except ValueError as error:
        assert "missing non-additive control: volume-renderer-detail" in str(error)
    else:
        raise AssertionError("normalization silently admitted a missing non-additive renderer axis")

    unknown = copy.deepcopy(source)
    unknown["domControls"]["volume-unknown"] = {
        "id": "volume-unknown", "param": "volume_unknown", "tagName": "INPUT", "type": "range", "value": 1,
    }
    unknown["controlCount"] = 2
    try:
        serve.normalize_volume_settings_preset_payload(unknown, SCHEMA)
    except ValueError as error:
        assert "unknown controls" in str(error)
    else:
        raise AssertionError("normalization admitted an unknown control")

    with tempfile.TemporaryDirectory() as temporary:
        store = Path(temporary)
        source_preset_id = write_legacy_alias(store, source)
        document = serve.read_volume_settings_preset(store, "legacy-additive-preset", SCHEMA)
        assert document["presetId"] == source_preset_id
        assert document["sourceControlCount"] == 1
        assert document["controlCount"] == 2
        assert document["sourceRendererControlCount"] == 0
        assert document["preset"]["rendererControls"]["volume-renderer-detail"]["value"] == 0.5
        assert document["preset"]["rendererControlCount"] == 1
        assert document["preset"]["presentationControls"]["raymarch-smoke-presentation"]["value"] == "on"
        assert document["schemaProjection"]["defaultsApplied"] == [
            "volume-new-detail", "volume-renderer-detail", "raymarch-smoke-presentation",
        ]
        index = serve.list_volume_settings_presets(store, SCHEMA)
        assert index["entries"][0]["controlCount"] == 2
        assert index["entries"][0]["rendererControlCount"] == 1
        assert index["entries"][0]["presentationControlCount"] == 1

        off_payload = copy.deepcopy(document["preset"])
        off_payload["presentationControls"]["raymarch-smoke-presentation"] = presentation_descriptor("off")
        off_payload["route"] = off_payload["route"].replace("volume_raymarch_smoke=on", "volume_raymarch_smoke=off")
        off_receipt = serve.write_volume_settings_preset(store, "Smoke off", off_payload, {}, SCHEMA)
        assert off_receipt["effective"]["presentationControlCount"] == 1
        assert off_receipt["effective"]["presetId"] != source_preset_id
        off_document = serve.read_volume_settings_preset(store, off_receipt["effective"]["presetId"], SCHEMA)
        assert off_document["preset"]["presentationControls"]["raymarch-smoke-presentation"]["value"] == "off"

        invalid = copy.deepcopy(off_payload)
        invalid["presentationControls"]["raymarch-smoke-presentation"]["value"] = "maybe"
        invalid["route"] = invalid["route"].replace("volume_raymarch_smoke=off", "volume_raymarch_smoke=maybe")
        try:
            serve.validate_volume_settings_preset_payload(invalid, SCHEMA)
        except ValueError as error:
            assert "unsupported value" in str(error)
        else:
            raise AssertionError("strict write validation admitted an unsupported smoke state")

    print("volume settings additive schema evolution contracts passed")


if __name__ == "__main__":
    main()
