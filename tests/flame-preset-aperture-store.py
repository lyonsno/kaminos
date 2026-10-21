# kaminos-test: python
import copy
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

schema = json.loads(serve.VOLUME_SETTINGS_PRESET_SCHEMA_PATH.read_text())
# Coordinate interpretation must participate in immutable identity. This is a
# hash-policy fixture; the native saved-preset route is exercised by the smoke.
legacy = {"domControls": {"volume-immersed-radius": {"value": .2}}}
expected = hashlib.sha256(json.dumps({"schemaIdentity": schema["identity"],
    "controls": {"volume-immersed-radius": .2}}, sort_keys=True,
    separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
assert serve._volume_settings_content_hash(legacy, schema) == expected
portable = copy.deepcopy(legacy)
portable["sourceRadiusSpace"] = "simulation-v1"
assert serve._volume_settings_content_hash(portable, schema) != expected
assert "sourceRadiusSpace" in schema["allowedNativePresetFields"]
bad = {"identity": serve.VOLUME_SETTINGS_PRESET_IDENTITY, "kind": "settings-preset",
       "schemaIdentity": schema["identity"], "sourceRadiusSpace": "unrecognized"}
try:
    serve.normalize_volume_settings_preset_payload(bad, schema)
except ValueError as error:
    assert str(error) == "Unknown preset source radius space"
else:
    raise AssertionError("Unknown coordinate interpretation was accepted")
print("preset aperture identity and unknown-space rejection passed")
