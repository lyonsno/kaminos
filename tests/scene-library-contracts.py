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

# Exercise the shop's actual nested consumer-store topology using defaults.
with TemporaryDirectory() as directory:
    root = Path(directory)
    nested = root / '.local' / 'state' / 'kaminos' / 'modal-domain-selection-1012' / 'consumer' / 'scenes'
    nested.mkdir(parents=True)
    (nested / 'dj-with-a-kiln-pretty.kaminos.json').write_text('{"label":"Immersed source authoring"}')
    prior_home = os.environ.get('HOME')
    prior_globs = os.environ.pop('KAMINOS_SCENE_LIBRARY_GLOBS', None)
    os.environ['HOME'] = str(root)
    serve.SCENES_DIR = root / 'own-scenes'
    try:
        assert nested.resolve() in serve.scene_library_stores().values(), 'default discovery must include lane/consumer/scenes'
    finally:
        if prior_home is not None: os.environ['HOME'] = prior_home
        else: os.environ.pop('HOME', None)
        if prior_globs is not None: os.environ['KAMINOS_SCENE_LIBRARY_GLOBS'] = prior_globs

# Actual newer Modal host layout: saves succeed here, but old discovery skipped it.
with TemporaryDirectory() as directory:
    root = Path(directory)
    state_store = root / '.local/state/kaminos/modal-show-hide-1016/state/scenes'
    host_store = root / '.local/state/kaminos/modal-emitters-main-composition-1013/human-authoring-look-1015/state/scenes'
    for folder in (state_store, host_store):
        folder.mkdir(parents=True)
        (folder / 'my-tuned-scene.kaminos.json').write_text('{"label":"My tuned scene"}')
    prior_home = os.environ.get('HOME')
    prior_globs = os.environ.pop('KAMINOS_SCENE_LIBRARY_GLOBS', None)
    os.environ['HOME'] = str(root)
    serve.SCENES_DIR = root / 'current/scenes'
    try:
        discovered = serve.scene_library_stores()
        assert state_store.resolve() in discovered.values(), 'default discovery must include the effective state/scenes save directory'
        assert host_store.resolve() in discovered.values(), 'retained human authoring host saves must remain discoverable'
        listing, status = call('handle_scene_library', {})
        assert status == 200
        listing['stores'] = [store for store in listing['stores'] if Path(store['path']) in (state_store.resolve(), host_store.resolve())]
        assert len(listing['stores']) == 2
        for store in listing['stores']:
            saved, status = call('handle_scene_library_read', {'store':[store['id']], 'name':['my-tuned-scene.kaminos.json']})
            assert status == 200 and saved['label'] == 'My tuned scene'
    finally:
        if prior_home is not None: os.environ['HOME'] = prior_home
        else: os.environ.pop('HOME', None)
        if prior_globs is not None: os.environ['KAMINOS_SCENE_LIBRARY_GLOBS'] = prior_globs
