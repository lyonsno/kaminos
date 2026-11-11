# kaminos-test: python
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

schema = json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
with tempfile.TemporaryDirectory() as directory:
    store = Path(directory)
    (store / "presets").mkdir()
    identity = "vsp-" + "a" * 64
    artifact = {"identity": serve.VOLUME_SETTINGS_PRESET_ARTIFACT_IDENTITY,
                "schemaIdentity": schema["identity"], "presetId": identity,
                "preset": ["corrupt"]}
    path = store / "presets" / (identity + ".json")
    path.write_text(json.dumps(artifact))
    before = path.read_bytes()
    serve.VOLUME_SETTINGS_STORE = store
    serve.SHARED_BASIN_STORE = None
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
    replies = []
    handler.send_json = lambda value, status=200: replies.append((value, status))
    handler.handle_volume_settings_preset_get({"runtime": ["1"], "id": [identity]})
    reply, status = replies.pop()
    assert status == 200
    assert reply["runtimeFallback"]["requestedPresetRef"] == identity
    assert "payload" in reply["runtimeFallback"]["reason"]
    handler.handle_volume_settings_preset_get({"id": [identity]})
    reply, status = replies.pop()
    assert status == 400, "strict archive endpoint still reports corrupt source"
    assert path.read_bytes() == before
