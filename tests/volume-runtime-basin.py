# kaminos-test: python
import copy
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

schema = json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
source = json.loads((serve.ROOT / "artifacts/default-basin/reactant-preview-source.json").read_text())

def stored(layers, **values):
    payload, _ = serve.normalize_volume_settings_preset_payload(source["preset"], schema, tolerate_foreign_controls=True)
    from urllib.parse import urlparse, parse_qsl, urlencode
    route = urlparse(payload["route"])
    params = dict(parse_qsl(route.query, keep_blank_values=True))
    for key, value in values.items():
        entry = payload["domControls"][key]
        entry.pop("rawValue", None)
        entry["value"] = value
        params[entry["param"]] = serve._settings_preset_route_value(value)
    payload["route"] = route._replace(query=urlencode(params)).geturl()
    return serve.write_volume_settings_preset(layers[0][1], "Runtime fixture", payload, {}, schema)["effective"]

with tempfile.TemporaryDirectory() as directory:
    layers = [("local", Path(directory))]
    # Missing historical recipes must not stop a scene's flame from mounting.
    result = serve.read_runtime_volume_settings_preset(layers, "missing-summer-basin", schema)
    assert result["runtimeFallback"]["requestedPresetRef"] == "missing-summer-basin"
    assert result["runtimeFallback"]["warning"]
    controls = result["preset"]["domControls"]
    assert controls["volume-reaction-law"]["value"] == "reactant-v0"
    assert controls["volume-appearance-model"]["value"] == "shred-only"
    assert int(controls["volume-resolution"]["value"]) == 32
    assert int(controls["volume-steps"]["value"]) == 8
    serve.validate_volume_settings_preset_payload(result["preset"], schema)
    # The runtime fallback is ephemeral, never a repair/write of the source library.
    assert list(Path(directory).iterdir()) == []

with tempfile.TemporaryDirectory() as directory:
    layers = [("local", Path(directory))]
    saved = stored(layers)
    result = serve.read_runtime_volume_settings_preset(layers, saved["presetId"], schema)
    assert result["presetId"] == saved["presetId"]
    assert "runtimeFallback" not in result, "current Reactant settings must not be replaced"
    unsupported = stored(layers, **{"volume-advection-scheme": "legacy", "volume-common-gas-transport": False})
    result = serve.read_runtime_volume_settings_preset(layers, unsupported["presetId"], schema)
    assert result.get("runtimeFallback"), "separate gas characteristics cannot feed Reactant combustion"
    # A Reactant label alone is insufficient: old source laws cannot feed it.
    invalid = stored(layers, **{"volume-emitter-source-law": "legacy-volume"})
    result = serve.read_runtime_volume_settings_preset(layers, invalid["presetId"], schema)
    assert result.get("runtimeFallback"), "unsupported source must load a preview, not an unlit scene"
    assert result["runtimeFallback"]["historicalLookPreserved"] is False
    # Deliberate corruption remains visible without mutating the archive.
    artifact = Path(directory) / "presets" / (saved["presetId"] + ".json")
    artifact.write_text("{broken")
    original = artifact.read_bytes()
    result = serve.read_runtime_volume_settings_preset(layers, saved["presetId"], schema)
    assert result["runtimeFallback"]["sourceModified"] is False
    assert artifact.read_bytes() == original
