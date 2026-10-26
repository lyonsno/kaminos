# kaminos-test: python
"""Optional malformed sidecars cannot remove valid basins from the actual index."""
import ast, json, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from basin_cover_store import read_cover
source=ast.parse((ROOT/'serve.py').read_text());function=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='list_volume_settings_presets_layered')
preset='vsp-'+'a'*64
with tempfile.TemporaryDirectory() as temporary:
 store=Path(temporary);sidecar=store/'covers'/preset/'current.json';sidecar.parent.mkdir(parents=True)
 fixture={'storePath':str(store),'entries':[{'alias':'flame','label':'Valid flame','presetId':preset}],'earlierVersions':[],'unavailableEntries':[]}
 scope={'read_cover':read_cover,'list_volume_settings_presets':lambda *_:fixture,'_volume_settings_timestamp':lambda _:0,'json':json}
 exec(compile(ast.Module(body=[function],type_ignores=[]),str(ROOT/'serve.py'),'exec'),scope)
 listing=lambda:scope['list_volume_settings_presets_layered']([('shared',store)],{'schema':'fixture'})
 assert len(listing()['entries'])==1
 for malformed in [{'schema':'kaminos.basin-cover.v1','presetId':preset,'imageHash':None},{'schema':'kaminos.basin-cover.v1','presetId':preset,'imageHash':[]},None,[],7,'wrong']:
  sidecar.write_text(json.dumps(malformed));result=listing();assert len(result['entries'])==1
  entry=result['entries'][0];assert entry['presetId']==preset;assert entry['cover'] is None;assert entry['coverError'];assert result['unavailableEntries']==[]
print('Malformed optional cover hashes and roots degrade per entry; valid basin settings remain listed')
