#!/usr/bin/env python3

import copy
import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import serve


PROFILE = {
    "simulationResolution": 96,
    "raySteps": 160,
    "adaptiveRays": 1,
    "renderScale": 0.25,
}

BUDGET_CONTROLS = {
    "volume-resolution": 96,
    "volume-steps": 160,
    "volume-adaptive-rays": 1,
    "volume-render-scale": 0.25,
}


def descriptor_value(entry):
    if entry["key"] == "volume-resolution":
        return "160"
    if entry["key"] == "volume-steps":
        return 160
    if entry["key"] == "volume-adaptive-rays":
        return 1
    if entry["key"] == "volume-render-scale":
        return 0.278
    if entry["param"] == "volume_raymarch_smoke":
        return "off"
    if "additiveDefault" in entry:
        return entry["additiveDefault"]
    if entry.get("type") == "checkbox":
        return False
    if entry.get("allowedValues"):
        return entry["allowedValues"][0]
    if entry.get("type") == "color":
        return "#000000"
    if entry.get("type") == "text":
        return ""
    if entry.get("tagName") == "SELECT":
        return "off"
    return 0


def build_controls(entries):
    return {
        entry["key"]: {
            "id": entry["key"],
            "param": entry["param"],
            "tagName": entry["tagName"],
            "type": entry["type"],
            "value": descriptor_value(entry),
        }
        for entry in entries
    }


def build_payload(schema):
    dom_controls = build_controls(schema["controls"])
    renderer_controls = build_controls(schema.get("rendererControls") or [])
    presentation_controls = build_controls(schema.get("presentationControls") or [])
    all_controls = {**dom_controls, **renderer_controls, **presentation_controls}
    route_entries = [(schema["activationParam"]["key"], schema["activationParam"]["value"])]
    route_entries.extend(
        (descriptor["param"], str(descriptor["value"]).lower() if isinstance(descriptor["value"], bool) else str(descriptor["value"]))
        for descriptor in all_controls.values()
    )
    route_entries.extend((key, "projection-contract") for key in schema.get("routeExtraParams") or [])
    return {
        "identity": "kaminos-volume-settings-preset-v2",
        "kind": "settings-preset",
        "schemaIdentity": schema["identity"],
        "savedAt": "2026-09-01T00:00:00Z",
        "route": urlparse("http://kaminos.invalid/")._replace(query=urlencode(route_entries)).geturl(),
        "domControls": dom_controls,
        "controlCount": len(dom_controls),
        "rendererControls": renderer_controls,
        "rendererControlCount": len(renderer_controls),
        "presentationControls": presentation_controls,
        "presentationControlCount": len(presentation_controls),
        "stateExclusions": {field: True for field in schema["excludedStateFields"]},
        "note": "settings only",
    }


def route_values(document):
    return dict(parse_qsl(urlparse(document["preset"]["route"]).query, keep_blank_values=True))


def set_control(payload, key, value):
    updated = copy.deepcopy(payload)
    descriptor = updated["domControls"][key]
    descriptor["value"] = value
    route = urlparse(updated["route"])
    route_entries = parse_qsl(route.query, keep_blank_values=True)
    updated["route"] = route._replace(query=urlencode([
        (param, str(value) if param == descriptor["param"] else current)
        for param, current in route_entries
    ])).geturl()
    return updated


def set_quality_reason(payload, reason):
    updated = copy.deepcopy(payload)
    route = urlparse(updated["route"])
    route_entries = parse_qsl(route.query, keep_blank_values=True)
    updated["route"] = route._replace(query=urlencode([
        (param, reason if param == "volume_quality_reason" else current)
        for param, current in route_entries
    ])).geturl()
    return updated


def main():
    schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
    payload = build_payload(schema)
    assert serve.validate_volume_settings_preset_payload(payload, schema) is True

    with tempfile.TemporaryDirectory() as temporary:
        store = Path(temporary) / "presets"
        source = {
            "repoRoot": str(ROOT),
            "branch": "cc/handy-kiln-fire-composition-0901",
            "commit": "4" * 40,
            "dirty": False,
        }
        parent = serve.write_volume_settings_preset(
            store,
            "actually-looks-like-fire-FUCKAHHHHH",
            payload,
            source,
            schema,
        )
        parent_id = parent["effective"]["presetId"]
        parent_path = store / "presets" / f"{parent_id}.json"
        parent_bytes = parent_path.read_bytes()

        projection = serve.project_volume_settings_preset(
            store,
            parent_id,
            "actually-looks-like-fire-FUCKAHHHHH-kiln-96-rs025",
            PROFILE,
            source,
            schema,
        )
        assert projection["identity"] == "kaminos-volume-settings-preset-projection-receipt-v1"
        assert projection["parent"]["presetId"] == parent_id
        assert projection["parent"]["contentHash"] == parent["effective"]["contentHash"]
        assert projection["requested"]["profile"] == PROFILE
        assert projection["effective"]["profile"] == PROFILE
        assert projection["effective"]["presetId"] != parent_id
        assert parent_path.read_bytes() == parent_bytes

        derived = serve.read_volume_settings_preset(
            store,
            projection["effective"]["presetId"],
            schema,
        )
        derived_route = route_values(derived)
        parent_document = serve.read_volume_settings_preset(store, parent_id, schema)
        for key, expected in BUDGET_CONTROLS.items():
            descriptor = derived["preset"]["domControls"][key]
            assert descriptor["value"] == expected or str(descriptor["value"]) == str(expected)
            assert derived_route[descriptor["param"]] == str(expected)

        parent_controls = copy.deepcopy(parent_document["preset"]["domControls"])
        derived_controls = copy.deepcopy(derived["preset"]["domControls"])
        for key in BUDGET_CONTROLS:
            parent_controls.pop(key)
            derived_controls.pop(key)
        assert derived_controls == parent_controls
        assert derived["preset"]["rendererControls"] == parent_document["preset"]["rendererControls"]
        assert derived["preset"]["presentationControls"] == parent_document["preset"]["presentationControls"]
        assert serve.validate_volume_settings_preset_payload(derived["preset"], schema) is True

        repeated = serve.project_volume_settings_preset(
            store,
            parent_id,
            "actually-looks-like-fire-FUCKAHHHHH-kiln-96-rs025",
            PROFILE,
            source,
            schema,
        )
        assert repeated["effective"]["presetId"] == projection["effective"]["presetId"]
        assert repeated["effective"]["idempotent"] is True

        presets_before_alias_rejection = {
            path.name for path in (store / "presets").glob("*.json")
        }
        try:
            serve.project_volume_settings_preset(
                store,
                "actually-looks-like-fire-fuckahhhhh",
                "actually-looks-like-fire-FUCKAHHHHH",
                {**PROFILE, "renderScale": 0.251},
                source,
                schema,
            )
        except ValueError as error:
            assert "repoint existing alias" in str(error)
        else:
            raise AssertionError("projection silently repointed the source alias")
        source_alias = serve.read_volume_settings_preset(
            store,
            "actually-looks-like-fire-fuckahhhhh",
            schema,
        )
        assert source_alias["presetId"] == parent_id
        assert {
            path.name for path in (store / "presets").glob("*.json")
        } == presets_before_alias_rejection

        parent_profile = {
            "simulationResolution": 160,
            "raySteps": 160,
            "adaptiveRays": 1,
            "renderScale": 0.278,
        }
        try:
            serve.project_volume_settings_preset(
                store,
                parent_id,
                "no-op-profile",
                parent_profile,
                source,
                schema,
            )
        except ValueError as error:
            assert "does not create a distinct child" in str(error)
        else:
            raise AssertionError("no-op projection impersonated a distinct child")

        parent_b_payload = set_quality_reason(
            set_control(payload, "volume-resolution", "128"),
            "second-parent",
        )
        parent_b = serve.write_volume_settings_preset(
            store,
            "second-parent",
            parent_b_payload,
            source,
            schema,
        )
        try:
            serve.project_volume_settings_preset(
                store,
                parent_b["effective"]["presetId"],
                "colliding-child-route",
                PROFILE,
                source,
                schema,
            )
        except ValueError as error:
            assert "content identity resolves to a different canonical payload" in str(error)
        else:
            raise AssertionError("colliding child reused an older route payload")

        original_reader = serve.read_volume_settings_preset

        def legacy_reader(*args, **kwargs):
            document = original_reader(*args, **kwargs)
            document["schemaProjection"] = {
                "defaultsApplied": [{"key": "volume-flow-kernel-strength", "value": 0}],
                "retiredControlsStripped": [],
            }
            return document

        serve.read_volume_settings_preset = legacy_reader
        try:
            try:
                serve.project_volume_settings_preset(
                    store,
                    parent_id,
                    "legacy-normalized-parent",
                    PROFILE,
                    source,
                    schema,
                )
            except ValueError as error:
                assert "requires schema normalization" in str(error)
            else:
                raise AssertionError("legacy normalization escaped the four-control receipt")
        finally:
            serve.read_volume_settings_preset = original_reader

        for field, value in (
            ("adaptiveRays", 0.50000000002),
            ("renderScale", 0.2500000002),
        ):
            try:
                serve.project_volume_settings_preset(
                    store,
                    parent_id,
                    f"off-tick-{field}",
                    {**PROFILE, field: value},
                    source,
                    schema,
                )
            except ValueError as error:
                assert "exact" in str(error)
            else:
                raise AssertionError(f"off-tick {field} was silently admitted")

        try:
            serve.project_volume_settings_preset(
                store,
                parent_id,
                "illegal-grid-90",
                {**PROFILE, "simulationResolution": 90},
                source,
                schema,
            )
        except ValueError as error:
            assert "unsupported simulation resolution: 90" in str(error)
        else:
            raise AssertionError("Grid 90 projection did not fail loud")

        try:
            serve.project_volume_settings_preset(
                store,
                parent_id,
                "unknown-profile-field",
                {**PROFILE, "silentFallback": True},
                source,
                schema,
            )
        except ValueError as error:
            assert "projection profile requires exactly" in str(error)
        else:
            raise AssertionError("unknown projection field was silently accepted")

    print("volume settings preset projection contracts passed")


if __name__ == "__main__":
    main()
