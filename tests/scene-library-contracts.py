import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def call(method, params):
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
    handler.client_address = ("127.0.0.1", 50000)
    replies = []
    handler.send_json = lambda value, *args: replies.append((value, args[0] if args else 200))
    getattr(handler, method)(params)
    return replies[0]


with TemporaryDirectory() as directory:
    root = Path(directory)
    own = root / "own" / "scenes"
    other = root / "beaming" / "scenes"
    empty = root / "empty" / "scenes"
    for folder in (own, other, empty):
        folder.mkdir(parents=True)
    (own / "here.kaminos.json").write_text(json.dumps({"label": "Here", "timestamp": "2026-10-08T10:00:00Z"}))
    (other / "tuned-kiln.kaminos.json").write_text(json.dumps({"label": "Unified lighting", "timestamp": "2026-10-08T17:37:04Z", "objects": [1, 2, 3]}))
    (other / "broken.kaminos.json").write_text("{not json")
    (root / "secret.kaminos.json").write_text(json.dumps({"label": "outside"}))
    serve.SCENES_DIR = own
    os.environ["KAMINOS_SCENE_LIBRARY_GLOBS"] = os.pathsep.join([str(root / "*" / "scenes")])

    stores = {path.parent.name: store_id for store_id, path in serve.scene_library_stores().items()}
    assert "beaming" in stores and "own" not in stores, "other servers' folders are stores; this server's own is not"
    store_id = stores["beaming"]

    scene, status = call("handle_scene_library_read", {"store": [store_id], "name": ["tuned-kiln.kaminos.json"]})
    assert status == 200 and scene["label"] == "Unified lighting"

    for bad in ({"store": [store_id], "name": ["../../secret.kaminos.json"]}, {"store": ["nope"], "name": ["tuned-kiln.kaminos.json"]}, {"store": [store_id], "name": ["tuned-kiln.json"]}):
        reply, status = call("handle_scene_library_read", bad)
        assert status in (400, 404), (bad, reply, status)
    assert (other / "tuned-kiln.kaminos.json").read_text().startswith("{"), "reading never writes to another server's store"
print("scene library contracts passed")
