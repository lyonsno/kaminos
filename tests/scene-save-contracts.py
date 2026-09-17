import io
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def save(data):
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
    payload = json.dumps(data).encode()
    handler.headers = {"Content-Length": str(len(payload))}
    handler.rfile = io.BytesIO(payload)
    replies = []
    handler.send_json = lambda value, *args: replies.append(value)
    handler.handle_save_scene()
    return replies[0]


with TemporaryDirectory() as directory:
    serve.SCENES_DIR = Path(directory)
    original = {"timestamp": "2026-09-17T10:00:00Z", "label": "Shot A", "objects": []}
    first = save(original)
    second = save({**original, "label": "Shot B"})
    assert first["saved"] != second["saved"], "two captures in the same second must not overwrite"
    assert json.loads(Path(first["path"]).read_text())["label"] == "Shot A"
    revised = save({**original, "label": "Revised", "_filename": first["saved"]})
    assert revised["saved"] == first["saved"], "explicit Save keeps its identity"
    assert json.loads(Path(first["path"]).read_text())["label"] == "Revised"
    assert len(list(Path(directory).glob("*.json"))) == 2
mounted_store = Path(__file__).resolve().parents[1] / "artifacts/basin-mounts/settings-store"
preset_id = "vsp-6209fc3bc3c625da302e6f01c23a8687c40c0c4575f774df1f28b036e173586b"
observed = json.loads((mounted_store / "presets" / f"{preset_id}.json").read_text())
resolved = serve.read_volume_settings_preset(mounted_store, preset_id)
assert resolved["label"] == observed["label"], "mounted basin label survives immutable-ID lookup"
print("scene save contracts passed")
