# kaminos-test: python
import json, runpy, tempfile, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import serve
existing=runpy.run_path(str(ROOT/"tests/volume-settings-renderer-controls-store-contracts.py"))
schema=json.loads(json.dumps(existing["SCHEMA"]))
canonical=json.loads((ROOT/"volume-settings-preset-schema-v2.json").read_text())
spec=next(c for c in canonical["rendererControls"] if c["key"]=="volume-raymarch-mode")
schema["rendererControls"]=[spec]
assert spec["additiveDefault"]=="numerical"
with tempfile.TemporaryDirectory() as temp:
    for mode in ("current","numerical","fixed","budgeted","joins","history"):
        payload=existing["base_payload"]()
        payload["rendererControls"]={spec["key"]:{"id":spec["key"],"param":spec["param"],"tagName":spec["tagName"],"type":spec["type"],"value":mode}}
        payload["rendererControlCount"]=1
        payload["route"]+="&volume_raymarch_mode="+mode
        saved=serve.write_volume_settings_preset(Path(temp),"Allocation "+mode,payload,{},schema)
        loaded=serve.read_volume_settings_preset(Path(temp),saved["effective"]["presetId"],schema)
        assert loaded["preset"]["rendererControls"][spec["key"]]["value"]==mode
        assert "volume_raymarch_mode="+mode in loaded["preset"]["route"]
print("canonical allocation modes survive store write/read")
