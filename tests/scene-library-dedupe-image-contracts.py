import base64
import json
import os
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


class Capture:
    def __init__(self, client="127.0.0.1"):
        self.client_address = (client, 50000)
        self.status, self.headers_sent, self.body, self.json = None, {}, b"", None


def call(method, params, client="127.0.0.1"):
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
    out = Capture(client)
    handler.client_address = out.client_address
    handler.send_json = lambda value, *args: (setattr(out, "json", value), setattr(out, "status", args[0] if args else 200))
    handler.send_response = lambda status, *args: setattr(out, "status", status)
    handler.send_header = lambda key, value: out.headers_sent.__setitem__(key, value)
    handler.end_headers = lambda: None
    handler.wfile = type("W", (), {"write": lambda self, data: setattr(out, "body", out.body + data)})()
    getattr(handler, method)(params)
    return out


jpeg = b"\xff\xd8\xff\xe0fakejpeg"
thumb = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
with TemporaryDirectory() as directory:
    root = Path(directory)
    stores = {name: root / name / "scenes" for name in ("here", "copy-a", "copy-b", "own")}
    for folder in stores.values():
        folder.mkdir(parents=True)
    shared = json.dumps({"label": "Seed scene", "timestamp": "2026-10-01T00:00:00Z"})
    (stores["copy-a"] / "seed.kaminos.json").write_text(shared)
    time.sleep(0.02)
    (stores["copy-b"] / "seed.kaminos.json").write_text(shared)
    (stores["copy-b"] / "tuned.kaminos.json").write_text(json.dumps({"label": "Tuned", "thumbnail": thumb}))
    (stores["copy-a"] / "local-twin.kaminos.json").write_text(json.dumps({"label": "Twin"}))
    (stores["here"] / "twin.kaminos.json").write_text(json.dumps({"label": "Twin"}))
    (stores["here"] / "mine.kaminos.json").write_text(json.dumps({"label": "Mine", "capture": {"image": "data:image/png;base64," + base64.b64encode(b"\x89PNGfake").decode()}}))
    serve.SCENES_DIR = stores["here"]
    os.environ["KAMINOS_SCENE_LIBRARY_GLOBS"] = str(root / "*" / "scenes")

    listing = call("handle_scene_library", {}).json
    entries = [(store["label"], scene["name"], scene.get("copies", 0), scene.get("hasImage")) for store in listing["stores"] for scene in store["scenes"]]
    seeds = [entry for entry in entries if entry[1] == "seed.kaminos.json"]
    assert len(seeds) == 1 and seeds[0][0] == "copy-b" and seeds[0][2] == 1, f"identical scenes collapse to the newest copy: {entries}"
    twins = [scene for store in listing["stores"] for scene in store["scenes"] if scene["name"] == "local-twin.kaminos.json"]
    assert len(twins) == 1 and twins[0].get("alsoHere") == "twin.kaminos.json", "a scene identical to one here names its local twin so Load can show it once and still recover its meshes"
    assert ("copy-b", "tuned.kaminos.json", 0, True) in entries

    copy_b = next(store["id"] for store in listing["stores"] if store["label"] == "copy-b")
    image = call("handle_scene_image", {"store": [copy_b], "name": ["tuned.kaminos.json"]})
    assert image.status == 200 and image.body == jpeg and image.headers_sent["Content-Type"] == "image/jpeg"
    local = call("handle_scene_image", {"store": [""], "name": ["mine.kaminos.json"]})
    assert local.status == 200 and local.body == b"\x89PNGfake" and local.headers_sent["Content-Type"] == "image/png", "older scenes fall back to their Capture image"
    assert call("handle_scene_image", {"store": [""], "name": ["twin.kaminos.json"]}).status == 404
    assert call("handle_scene_image", {"store": [copy_b], "name": ["tuned.kaminos.json"]}, client="10.0.0.5").status == 403
    assert call("handle_scene_image", {"store": [""], "name": ["../escape.kaminos.json"]}).status == 400
print("scene library dedupe and image contracts passed")
