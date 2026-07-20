#!/usr/bin/env python3

import copy
import json
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
        {"key": "volume-flow-kernel-strength", "param": "volume_flow_kernel_strength", "tagName": "INPUT", "type": "range"},
    ],
    "routeExtraParams": ["volume_quality_reason"],
    "activationParam": {"key": "kaminos_volume_smoke", "value": "1"},
    "excludedStateFields": ["fluidField", "frontField", "historyBuffers"],
    "forbiddenPresetFields": ["fluidField", "frontField", "historyBuffers"],
    "allowedNativePresetFields": [
        "identity", "kind", "schemaIdentity", "savedAt", "route", "domControls", "controlCount",
        "rendererControls", "rendererControlCount", "stateExclusions", "note",
    ],
}


def preset_payload():
    return {
        "identity": "kaminos-volume-settings-preset-v2",
        "kind": "settings-preset",
        "schemaIdentity": SCHEMA["identity"],
        "savedAt": "2026-07-20T07:00:00Z",
        "route": "http://127.0.0.1:18782/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_flow_kernel_strength=0.56&volume_quality_reason=api-contract",
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
        "rendererControls": {
            "volume-flow-kernel-strength": {
                "id": "volume-flow-kernel-strength",
                "param": "volume_flow_kernel_strength",
                "tagName": "INPUT",
                "type": "range",
                "value": 0.56,
            },
        },
        "rendererControlCount": 1,
        "stateExclusions": {"fluidField": True, "frontField": True, "historyBuffers": True},
        "note": "fixture settings only",
    }


def effective_state():
    return {
        "schema": "kaminos.volume.effective-basin-state.v0",
        "simulator": {"identity": "coefficient-state-120-f120-s120", "grid": 160, "simStepCount": 120},
        "renderer": {"identity": "native-3d-compute-fluid-raymarch-v0", "backend": "WebGPU:apple"},
        "presentation": {"volumePresentation": "beauty", "raymarchSmoke": "on"},
        "source": {"requestedSource": "learned-flow", "effectiveSource": "learned-flow"},
        "initialization": {"authority": "shared-volume-settings-preset-v2"},
        "route": {"requestedPath": "/", "effectivePath": "/", "targetOrigin": "http://127.0.0.1:18782"},
        "composition": {"requested": "smoke-raymarch-under-splats-v0", "effective": "smoke-raymarch-under-splats-v0"},
        "backend": {"requested": "WebGPU", "effective": "WebGPU:apple"},
        "schemaIdentity": SCHEMA["identity"],
    }


def main():
    with tempfile.TemporaryDirectory(prefix="kaminos-basin-promotion-api-") as temporary:
        root = Path(temporary)
        store = root / "settings-store"
        package_path = root / "packages" / "api-basin.json"
        channel_path = root / "channels" / "api-current.json"
        old_schema_path = serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH
        old_store = serve.VOLUME_SETTINGS_STORE
        try:
            schema_path = root / "schema.json"
            schema_path.write_text(json.dumps(SCHEMA, indent=2) + "\n")
            serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH = schema_path
            serve.VOLUME_SETTINGS_STORE = store
            receipt = serve.write_volume_basin_promotion_package({
                "label": "API Basin",
                "handle": "API Basin",
                "packagePath": str(package_path),
                "channelPath": str(channel_path),
                "preset": preset_payload(),
                "effectiveState": effective_state(),
                "sourceCommit": "91374fa8297119d6513a927b00892bdbda7c9a45",
            })

            bad = copy.deepcopy(preset_payload())
            del bad["stateExclusions"]["fluidField"]
            try:
                serve.write_volume_basin_promotion_package({
                    "label": "Bad Basin",
                    "handle": "Bad Basin",
                    "packagePath": str(root / "bad.json"),
                    "preset": bad,
                    "effectiveState": effective_state(),
                    "sourceCommit": "91374fa8297119d6513a927b00892bdbda7c9a45",
            })
            except ValueError as error:
                assert "exclude runtime and replay state" in str(error)
            else:
                raise AssertionError("server helper must reject a cockpit package whose preset fails the real loader")
        finally:
            serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH = old_schema_path
            serve.VOLUME_SETTINGS_STORE = old_store

        assert receipt["identity"] == "kaminos.volume.basin-promotion-write-receipt.v0"
        assert receipt["promotion"]["status"] == "written"
        assert receipt["promotion"]["packagePath"] == str(package_path)
        assert receipt["promotion"]["channelPath"] == str(channel_path)
        package = json.loads(package_path.read_text())
        channel = json.loads(channel_path.read_text())
        assert package["schema"] == "kaminos.volume.basin-promotion-package.v0"
        assert package["handle"] == "api-basin"
        assert package["revision"] == channel["current"]["revision"]
        assert package["settingsPreset"]["presetId"] == receipt["settingsPreset"]["presetId"]
        assert package["sourceCommit"] == "91374fa8297119d6513a927b00892bdbda7c9a45"

    print("volume basin promotion API contracts passed")


if __name__ == "__main__":
    main()
