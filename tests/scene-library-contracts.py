import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def call(method, params):
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
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

    listing, status = call("handle_scene_library", {})
    assert status == 200
    stores = {store["label"]: store for store in listing["stores"]}
    assert set(stores) == {"beaming"}, "other stores with scenes are listed; this server's own and empty stores are not"
    scenes = {scene["name"]: scene for scene in stores["beaming"]["scenes"]}
    assert scenes["tuned-kiln.kaminos.json"]["label"] == "Unified lighting"
    assert scenes["tuned-kiln.kaminos.json"]["timestamp"] == "2026-10-08T17:37:04Z"
    assert scenes["broken.kaminos.json"]["label"] == "" and "error" in scenes["broken.kaminos.json"], "an unreadable scene is listed as unreadable, not dropped"
    store_id = stores["beaming"]["id"]

    scene, status = call("handle_scene_library_read", {"store": [store_id], "name": ["tuned-kiln.kaminos.json"]})
    assert status == 200 and scene["label"] == "Unified lighting"

    for bad in ({"store": [store_id], "name": ["../../secret.kaminos.json"]}, {"store": ["nope"], "name": ["tuned-kiln.kaminos.json"]}, {"store": [store_id], "name": ["tuned-kiln.json"]}):
        reply, status = call("handle_scene_library_read", bad)
        assert status in (400, 404), (bad, reply, status)
    assert (other / "tuned-kiln.kaminos.json").read_text().startswith("{"), "reading never writes to another server's store"
print("scene library contracts passed")
