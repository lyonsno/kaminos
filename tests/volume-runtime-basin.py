# kaminos-test: python
import copy
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

schema = json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
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
