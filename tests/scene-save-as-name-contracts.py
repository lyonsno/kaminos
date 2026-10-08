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
    handler.send_json = lambda value, *args: replies.append((value, args[0] if args else 200))
    handler.handle_save_scene()
    return replies[0]


with TemporaryDirectory() as directory:
    serve.SCENES_DIR = Path(directory)
    scene = {"timestamp": "2026-10-07T10:00:00Z", "label": "Kiln study", "objects": []}

    reply, status = save({**scene, "_saveAsName": "My Kiln Scene!"})
    assert status == 200 and reply["saved"] == "My-Kiln-Scene.kaminos.json", (reply, status)
    stored = json.loads((Path(directory) / reply["saved"]).read_text())
    assert "_saveAsName" not in stored and "_overwrite" not in stored, "save-as controls are not scene data"

    reply, status = save({**scene, "label": "Second", "_saveAsName": "My-Kiln-Scene.kaminos.json"})
    assert status == 409 and reply.get("exists") == "My-Kiln-Scene.kaminos.json", "an existing name is not silently replaced"
    assert json.loads((Path(directory) / "My-Kiln-Scene.kaminos.json").read_text())["label"] == "Kiln study"

    reply, status = save({**scene, "label": "Replaced", "_saveAsName": "My-Kiln-Scene", "_overwrite": True})
    assert status == 200 and reply["saved"] == "My-Kiln-Scene.kaminos.json"
    assert json.loads((Path(directory) / "My-Kiln-Scene.kaminos.json").read_text())["label"] == "Replaced"

    reply, status = save({**scene, "_saveAsName": "../../escape"})
    assert status == 200 and reply["saved"] == "escape.kaminos.json", (reply, status)
    assert (Path(directory) / "escape.kaminos.json").exists()

    reply, status = save({**scene, "_saveAsName": "///"})
    assert status == 400, (reply, status)

    reply, status = save(scene)
    assert status == 200 and reply["saved"].endswith(".kaminos.json") and reply["saved"] != "My-Kiln-Scene.kaminos.json", "unnamed Save As keeps generated names"
print("scene save-as name contracts passed")
