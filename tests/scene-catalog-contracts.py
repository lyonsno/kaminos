import base64
import json
import os
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def catalog(scope=None, client="127.0.0.1"):
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
    handler.client_address = (client, 50000)
    replies = []
    handler.send_json = lambda value, *args: replies.append((value, args[0] if args else 200))
    handler.handle_scene_catalog({"scope": [scope]} if scope else {})
    return replies[0]


thumb = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8jpeg").decode()
with TemporaryDirectory() as directory:
    root = Path(directory)
    here, lane_a, lane_b = (root / name / "scenes" for name in ("here", "lane-a", "lane-b"))
    for folder in (here, lane_a, lane_b):
        folder.mkdir(parents=True)
    kiln = {"label": "Kiln", "timestamp": "2026-10-08T10:00:00Z", "thumbnail": thumb, "objects": [{"id": "k", "source": "/api/read?root=generated-meshes&path=k.glb"}]}
    # The same scene three ways here (compact, indented, re-ordered keys) and once on each lane.
    (here / "kiln.kaminos.json").write_text(json.dumps(kiln, separators=(",", ":")))
    (here / "kiln_copy.kaminos.json").write_text(json.dumps(kiln, indent=2))
    (here / "kiln_again.kaminos.json").write_text(json.dumps(dict(reversed(list(kiln.items())))))
    (lane_a / "kiln-from-a.kaminos.json").write_text(json.dumps(kiln, indent=4))
    time.sleep(0.02)
    (lane_b / "kiln-from-b.kaminos.json").write_text(json.dumps(kiln))
    (lane_b / "tuned.kaminos.json").write_text(json.dumps({"label": "Tuned", "timestamp": "2026-10-08T12:00:00Z"}))
    (lane_a / "seed.kaminos.json").write_text(json.dumps({"label": "Seed"}))
    (lane_b / "seed.kaminos.json").write_text(json.dumps({"label": "Seed"}))
    (here / "broken.kaminos.json").write_text("{not json")
    (here / "broken-too.kaminos.json").write_text("{not json")
    serve.SCENES_DIR = here
    os.environ["KAMINOS_SCENE_LIBRARY_GLOBS"] = str(root / "*" / "scenes")

    reply, status = catalog()
    assert status == 200
    groups = reply["groups"]
    by_label = {}
    for group in groups:
        by_label.setdefault(group["label"], []).append(group)
    assert len(by_label["Kiln"]) == 1, "one scene, however it was formatted or wherever it was saved, is one entry"
    kiln_group = by_label["Kiln"][0]
    assert sorted(kiln_group["local"]) == ["kiln.kaminos.json", "kiln_again.kaminos.json", "kiln_copy.kaminos.json"]
    assert sorted((member["storeLabel"], member["name"]) for member in kiln_group["foreign"]) == [("lane-a", "kiln-from-a.kaminos.json"), ("lane-b", "kiln-from-b.kaminos.json")]
    assert kiln_group["image"] == {"store": "", "name": kiln_group["local"][0]}, "the image comes from a copy here when there is one"
    assert kiln_group["copies"] == 4
    tuned = by_label["Tuned"][0]
    assert tuned["local"] == [] and [m["name"] for m in tuned["foreign"]] == ["tuned.kaminos.json"] and tuned["image"] is None
    assert len(by_label["Seed"]) == 1 and len(by_label["Seed"][0]["foreign"]) == 2
    broken = [group for group in groups if group.get("error")]
    assert sorted(group["local"][0] for group in broken) == ["broken-too.kaminos.json", "broken.kaminos.json"], "unreadable scenes are listed separately, never merged"
    assert kiln_group["identity"] == serve.scene_identity(kiln)

    local_only, status = catalog(scope="local", client="10.0.0.5")
    assert status == 200 and all(not group["foreign"] for group in local_only["groups"]), "this server's own scenes need no other servers"
    assert catalog(client="10.0.0.5")[1] == 403, "other servers' scenes are only for this machine"
print("scene catalog contracts passed")
