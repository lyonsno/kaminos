# kaminos-test: python
"""Importing another server's scene finds its fire basin in the machine's
basin library even when this server runs a private store without the shared
library. Basins are content-addressed: only the verified artifact is copied
into this server's own store; aliases stay untouched, and a tampered or
absent basin still refuses the import with a clear reason.
"""

import io
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import serve

OBSERVED = ROOT / "artifacts/basin-mounts/settings-store/presets/vsp-6209fc3bc3c625da302e6f01c23a8687c40c0c4575f774df1f28b036e173586b.json"
ARTIFACT = json.loads(OBSERVED.read_text())
PRESET_ID = ARTIFACT["presetId"]


def post(body):
    instance = serve.KaminosHandler.__new__(serve.KaminosHandler)
    instance.client_address = ("127.0.0.1", 50000)
    replies = []
    instance.send_json = lambda value, *args: replies.append((value, args[0] if args else 200))
    payload = json.dumps(body).encode()
    instance.headers = {"Content-Length": str(len(payload))}
    instance.rfile = io.BytesIO(payload)
    instance.handle_scene_library_import()
    return replies[0]


def arrange(root, *, library_artifact=None, default_store_artifact=None):
    own = root / "lane" / "private"
    other_scenes = root / "bench" / "scenes"
    library = root / "share" / "basins"
    default_store = root / "share" / "volume-settings-presets"
    for folder in (own / "scenes", other_scenes, library, default_store):
        folder.mkdir(parents=True, exist_ok=True)
    if library_artifact is not None:
        (library / "presets").mkdir(parents=True, exist_ok=True)
        (library / "presets" / OBSERVED.name).write_text(library_artifact)
    if default_store_artifact is not None:
        (default_store / "presets").mkdir(parents=True, exist_ok=True)
        (default_store / "presets" / OBSERVED.name).write_text(default_store_artifact)
    # A lane server: private store, shared library switched off.
    serve.SCENES_DIR = own / "scenes"
    serve.VOLUME_SETTINGS_STORE = own / "basins"
    serve.SHARED_BASIN_STORE = None
    serve.SHARED_BASIN_STORE_DEFAULT = library
    serve.VOLUME_SETTINGS_STORE_DEFAULT = default_store
    document = {"label": "Flame carousel", "composition": {"flame": {"presetId": PRESET_ID}}, "objects": []}
    (other_scenes / "carousel.kaminos.json").write_text(json.dumps(document))
    os.environ["KAMINOS_SCENE_LIBRARY_GLOBS"] = str(root / "bench" / "scenes")
    store_id = next(iter(serve.scene_library_stores()))
    return own, store_id


# 1. The basin is only in the machine's shared basin library.
with TemporaryDirectory() as directory:
    own, store_id = arrange(Path(directory), library_artifact=OBSERVED.read_text())
    reply, status = post({"store": store_id, "name": "carousel.kaminos.json"})
    assert status == 200, (reply, status)
    copied = own / "basins" / "presets" / OBSERVED.name
    assert copied.exists(), "the verified basin artifact is copied into this server's own store"
    assert serve.read_volume_settings_preset(own / "basins", PRESET_ID)["presetId"] == PRESET_ID
    assert not (own / "basins" / "aliases").exists() or not any((own / "basins" / "aliases").iterdir()), "aliases are not imported"
    assert reply["basin"]["from"].endswith("share/basins"), reply["basin"]

# 2. The basin is only in the machine's default preset store.
with TemporaryDirectory() as directory:
    own, store_id = arrange(Path(directory), default_store_artifact=OBSERVED.read_text())
    reply, status = post({"store": store_id, "name": "carousel.kaminos.json"})
    assert status == 200, (reply, status)
    assert serve.read_volume_settings_preset(own / "basins", PRESET_ID)["presetId"] == PRESET_ID

# 3. A library artifact whose content does not match its id is not copied.
with TemporaryDirectory() as directory:
    tampered = json.loads(OBSERVED.read_text())
    control = next(iter(tampered["preset"]["domControls"].values()))
    control["value"] = "tampered-after-hashing"
    control.pop("rawValue", None)
    own, store_id = arrange(Path(directory), library_artifact=json.dumps(tampered))
    reply, status = post({"store": store_id, "name": "carousel.kaminos.json"})
    assert status == 400, (reply, status)
    assert not (own / "basins" / "presets" / OBSERVED.name).exists(), "a tampered basin is never copied"
    assert "content hash mismatch" in reply["error"], reply

# 4. Nowhere on the machine: the import refuses and says where it looked.
with TemporaryDirectory() as directory:
    own, store_id = arrange(Path(directory))
    reply, status = post({"store": store_id, "name": "carousel.kaminos.json"})
    assert status == 400, (reply, status)
    assert "not found" in reply["error"] and "basins" in reply["error"], reply

# 5. A corrupt copy beside the scene does not block the verified library copy.
with TemporaryDirectory() as directory:
    root = Path(directory)
    own, store_id = arrange(root, library_artifact=OBSERVED.read_text())
    sibling = root / "bench" / "basins" / "presets"
    sibling.mkdir(parents=True)
    tampered = json.loads(OBSERVED.read_text())
    control = next(iter(tampered["preset"]["domControls"].values()))
    control["value"] = "tampered-after-hashing"
    control.pop("rawValue", None)
    (sibling / OBSERVED.name).write_text(json.dumps(tampered))
    reply, status = post({"store": store_id, "name": "carousel.kaminos.json"})
    assert status == 200, (reply, status)
    assert reply["basin"]["from"].endswith("share/basins"), reply["basin"]
    assert serve.read_volume_settings_preset(own / "basins", PRESET_ID)["presetId"] == PRESET_ID

# 6. The bytes copied are the bytes verified: a source that changes after it
#    is read cannot put unverified content into this server's store.
with TemporaryDirectory() as directory:
    root = Path(directory)
    own, store_id = arrange(root, library_artifact=OBSERVED.read_text())
    source = root / "share" / "basins" / "presets" / OBSERVED.name
    swapped = json.loads(OBSERVED.read_text())
    control = next(iter(swapped["preset"]["domControls"].values()))
    control["value"] = "swapped-after-verification"
    control.pop("rawValue", None)
    # Verification that opens the file sees the original; any later
    # read_text/read_bytes of the source sees swapped content.
    real_read_bytes, real_read_text = Path.read_bytes, Path.read_text
    swapped_text = json.dumps(swapped)
    def racing_read_bytes(self):
        return swapped_text.encode() if self == source else real_read_bytes(self)
    def racing_read_text(self, *args, **kwargs):
        return swapped_text if self == source else real_read_text(self, *args, **kwargs)
    Path.read_bytes, Path.read_text = racing_read_bytes, racing_read_text
    try:
        reply, status = post({"store": store_id, "name": "carousel.kaminos.json"})
    finally:
        Path.read_bytes, Path.read_text = real_read_bytes, real_read_text
    copied = own / "basins" / "presets" / OBSERVED.name
    if copied.exists():
        assert serve.read_volume_settings_preset(own / "basins", PRESET_ID)["presetId"] == PRESET_ID, "only verified bytes may be stored"

print("scene library import basin library contracts passed")
