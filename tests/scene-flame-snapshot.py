import io, json, runpy, tempfile, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve
fixture=runpy.run_path(str(Path(__file__).with_name('volume-settings-store-contracts.py')))
root=Path(__file__).resolve().parents[1]
schema=json.loads((root/'volume-settings-preset-schema-v2.json').read_text())
payload,_=serve.normalize_volume_settings_preset_payload(json.loads((root/'artifacts/default-basin/cheap-blast-furnace.json').read_text())['preset'],schema)
class Request:
 def __init__(self,body):
  raw=json.dumps(body).encode();self.rfile=io.BytesIO(raw);self.headers={'Content-Length':str(len(raw))};self.result=None
 def send_json(self,body,status=200):self.result=(status,body)
with tempfile.TemporaryDirectory() as temp:
 serve.VOLUME_SETTINGS_STORE=Path(temp)
 original=serve.write_volume_settings_preset(temp,'Original basin',payload,{},schema)
 alias=Path(temp)/'aliases'/f"{original['effective']['alias']}.json";before=alias.read_bytes()
 changed=fixture['set_control'](payload,'volume-density',5.25)
 request=Request({'label':'Original basin','preset':changed,'publishAlias':False})
 serve.KaminosHandler.handle_volume_settings_presets_post(request)
 status,result=request.result
 assert status==200,(status,result)
 assert result['effective']['alias'] is None
 assert result['effective']['publishAlias'] is False
 assert alias.read_bytes()==before,'scene save must not repoint library alias'
 assert len(serve.list_volume_settings_presets(temp,schema)['entries'])==1
 loaded=serve.read_volume_settings_preset(temp,result['effective']['presetId'],schema)
 assert loaded['preset']['domControls']['volume-density']['value']==5.25
 request=Request({'label':'Bad','preset':changed,'publishAlias':'false'})
 serve.KaminosHandler.handle_volume_settings_presets_post(request)
 assert request.result[0]==400,'ambiguous publication mode must fail before writing'
 print('scene snapshots preserve library identity and reopen exact settings: pass')
