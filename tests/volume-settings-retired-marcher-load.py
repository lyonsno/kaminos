# kaminos-test: python
"""Replay a saved basin from production revision 3eaf1a1 after adaptive rays retired."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import parse_qs, urlparse
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import serve

observed = json.loads((ROOT / "tests/fixtures/retired-adaptive-rays-basin.json").read_text())
assert observed["source"]["commit"] == "3eaf1a1aa4d5393e3b6c6fb8e5ada8682e1fc9a0"
assert "volume-adaptive-rays" not in observed["preset"]["domControls"]
assert observed["preset"]["rendererControls"]["volume-raymarch-mode"]["value"] == "history"
with tempfile.TemporaryDirectory() as tmp:
    store = Path(tmp)
    (store / "presets").mkdir()
    path = store / "presets" / (observed["presetId"] + ".json")
    path.write_text(json.dumps(observed))
    before = path.read_bytes()
    result = serve.read_volume_settings_preset(store, observed["presetId"])
    assert result["presetId"] == observed["presetId"]
    assert path.read_bytes() == before, "loading must preserve the content-addressed artifact"
    assert result["schemaProjection"]["defaultsApplied"] == ["volume-adaptive-rays"]
    preset = result["preset"]
    assert preset["domControls"]["volume-adaptive-rays"]["value"] == 0.65
    for key, descriptor in observed["preset"]["domControls"].items():
        if any(entry["key"] == key for entry in serve._load_volume_settings_preset_schema()["retiredControls"]):
            assert key not in preset["domControls"]
        elif key == "volume-appearance-model":
            assert preset["domControls"][key]["value"] == "shred-only"
        else:
            assert preset["domControls"][key] == descriptor, key
    assert preset["rendererControls"]["volume-raymarch-mode"]["value"] == "history"
    assert preset["domControls"]["volume-steps"]["value"] == 4
    assert preset["domControls"]["volume-adaptive-budget"]["value"] == 20
    assert preset["domControls"]["volume-render-scale"]["value"] == 0.73678515625
    route = parse_qs(urlparse(preset["route"]).query, keep_blank_values=True)
    assert route["volume_raymarch_mode"] == ["history"]
    assert route["volume_adaptive_rays"] == ["0.65"]
    # A basin that did author this control must keep its exact tuning.
    authored = copy.deepcopy(preset)
    authored["domControls"]["volume-adaptive-rays"]["value"] = 0.27
    from urllib.parse import urlencode
    route["volume_adaptive_rays"] = ["0.27"]
    parsed = urlparse(authored["route"])
    authored["route"] = parsed._replace(query=urlencode(route,doseq=True)).geturl()
    normalized, projection = serve.normalize_volume_settings_preset_payload(authored, tolerate_foreign_controls=True)
    assert normalized["domControls"]["volume-adaptive-rays"]["value"] == 0.27
    assert "volume-adaptive-rays" not in projection["defaultsApplied"]
print("retired marcher basin loads without changing authored settings")
