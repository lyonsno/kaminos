import hashlib
import io
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def handler(client="127.0.0.1"):
    instance = serve.KaminosHandler.__new__(serve.KaminosHandler)
    instance.client_address = (client, 50000)
    replies = []
    instance.send_json = lambda value, *args: replies.append((value, args[0] if args else 200))
    return instance, replies


def post(body, client="127.0.0.1"):
    instance, replies = handler(client)
    payload = json.dumps(body).encode()
    instance.headers = {"Content-Length": str(len(payload))}
    instance.rfile = io.BytesIO(payload)
    instance.handle_scene_library_import()
    return replies[0]


def get(method, params, client="127.0.0.1"):
    instance, replies = handler(client)
    getattr(instance, method)(params)
    return replies[0]


with TemporaryDirectory() as directory:
    root = Path(directory)
    here_scenes, here_meshes = root / "here" / "scenes", root / "here" / "assets" / "generated-meshes"
    lane = root / "lane"
    there_scenes, there_meshes = lane / "scenes", lane / "assets" / "generated-meshes"
    for folder in (here_scenes, here_meshes, there_scenes, there_meshes):
        folder.mkdir(parents=True)
    glb = b"glTF" + bytes(range(64))
    digest = hashlib.sha256(glb).hexdigest()
    (there_meshes / f"{digest}.glb").write_bytes(glb)
    (there_meshes / f"{'0' * 64}.glb").write_bytes(b"glTF tampered")
    scene = {"label": "Chair study", "timestamp": "2026-10-08T12:00:00Z", "objects": [
        {"id": "a", "type": "glb", "source": f"/api/read?root=generated-meshes&path={digest}.glb"},
        {"id": "b", "type": "glb", "source": f"/api/read?root=generated-meshes&path={'0' * 64}.glb"},
        {"id": "c", "type": "glb", "source": "/api/read?root=pipeline-runs&path=elsewhere/model.glb"},
        {"id": "d", "type": "flame-emitter", "source": "kaminos:analytic-flame"},
    ]}
    (there_scenes / "study.kaminos.json").write_text(json.dumps(scene))
    (here_scenes / "study.kaminos.json").write_text(json.dumps({"label": "Unrelated local study"}))
    serve.SCENES_DIR = here_scenes
    serve.BROWSE_ROOTS["generated-meshes"] = here_meshes
    os.environ["KAMINOS_SCENE_LIBRARY_GLOBS"] = str(root / "*" / "scenes")
    store_id = next(store["id"] for store in get("handle_scene_library", {})[0]["stores"] if store["label"] == "lane")

    reply, status = post({"store": store_id, "name": "study.kaminos.json"})
    assert status == 200, (reply, status)
    assert reply["saved"] != "study.kaminos.json" and reply["saved"].endswith(".kaminos.json"), "an import never takes over a local scene's name"
    assert json.loads((here_scenes / "study.kaminos.json").read_text())["label"] == "Unrelated local study"
    assert json.loads((here_scenes / reply["saved"]).read_text())["label"] == "Chair study"
    deps = {dep["source"]: dep["status"] for dep in reply["dependencies"]}
    assert deps[f"/api/read?root=generated-meshes&path={digest}.glb"] == "imported"
    assert (here_meshes / f"{digest}.glb").read_bytes() == glb, "the mesh only the other server had is now here"
    assert deps[f"/api/read?root=generated-meshes&path={'0' * 64}.glb"] == "missing", "a mesh whose content does not match its name is not imported"
    assert not (here_meshes / f"{'0' * 64}.glb").exists()
    assert deps["/api/read?root=pipeline-runs&path=elsewhere/model.glb"] == "missing"
    assert "kaminos:analytic-flame" not in deps

    again, status = post({"store": store_id, "name": "study.kaminos.json"})
    assert again["saved"] != reply["saved"], "a second import is a second local copy"
    assert {d["source"]: d["status"] for d in again["dependencies"]}[f"/api/read?root=generated-meshes&path={digest}.glb"] == "present"

    for method, params in (("handle_scene_library", {}), ("handle_scene_library_read", {"store": [store_id], "name": ["study.kaminos.json"]})):
        assert get(method, params, client="192.168.1.20")[1] == 403, method
    assert post({"store": store_id, "name": "study.kaminos.json"}, client="192.168.1.20")[1] == 403
    assert get("handle_scene_library", {}, client="::1")[1] == 200
    # Dependencies only: bring the meshes over without writing another scene copy.
    before = sorted(here_scenes.glob("*.kaminos.json"))
    (here_meshes / f"{digest}.glb").unlink()
    reply, status = post({"store": store_id, "name": "study.kaminos.json", "dependenciesOnly": True})
    assert status == 200 and "saved" not in reply, (reply, status)
    assert {d["source"]: d["status"] for d in reply["dependencies"]}[f"/api/read?root=generated-meshes&path={digest}.glb"] == "imported"
    assert sorted(here_scenes.glob("*.kaminos.json")) == before, "no new scene file"

    # A symlink at the destination must not redirect the write outside the mesh root.
    victim = root / "victim.txt"
    victim.write_text("keep me")
    glb2 = b"glTF" + bytes(range(64, 160))
    digest2 = hashlib.sha256(glb2).hexdigest()
    (there_meshes / f"{digest2}.glb").write_bytes(glb2)
    (here_meshes / f"{digest2}.glb").symlink_to(victim)
    dep = serve.scene_library_import_dependency(f"/api/read?root=generated-meshes&path={digest2}.glb", there_scenes)
    assert dep["status"] == "missing", dep
    assert victim.read_text() == "keep me", "the import never writes through a symlink"
print("scene library import contracts passed")
