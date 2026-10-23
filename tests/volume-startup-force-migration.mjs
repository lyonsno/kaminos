// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {migrateRetiredVolumeSettingsPresetDocument} from '../volume-retired-control-migration.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const start=html.indexOf('async function applyDefaultVolumeSmokeBasin(');
assert.ok(start>=0);
const loader=html.slice(start,html.indexOf('\n}\n',start)+2);
const ids=new Set([...html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]));
async function replay(name,query=''){
 const artifact=JSON.parse(readFileSync(new URL(`../artifacts/default-basin/${name}.json`,import.meta.url)));
 const before=JSON.stringify(artifact),values=new Map([['volume-swirl-jostle',1]]);
 const context=vm.createContext({URL,URLSearchParams,migrateRetiredVolumeSettingsPresetDocument,
  DEFAULT_VOLUME_SMOKE_BASIN_URL:'basin',fetch:async url=>({ok:true,status:200,json:async()=>url==='/volume-settings-preset-schema-v2.json'?schema:artifact}),
  document:{getElementById:id=>ids.has(id)?{}:null},
  applyVolumeScenePreset(){},setVolumeControlValue:(id,value)=>values.set(id,value),activeCanonicalVolumeMacroPreset:'',window:{}});
 vm.runInContext(loader+';this.load=applyDefaultVolumeSmokeBasin',context);
 const params=new URLSearchParams(query),receipt=await context.load(params);
 assert.equal(JSON.stringify(artifact),before,'the source artifact remains immutable');
 assert.equal(receipt.presetId,artifact.presetId);
 assert.equal(receipt.label,artifact.initialLabel);
 return {values,params};
}
for(const [name,expected] of [['cheap-blast-furnace',[0,5,0]],['semantic-flame',[0,0,0]]]){
 test(`${name}: actual startup loader preserves saved force-off states`,async()=>{
  const {values,params}=await replay(name);
  const fields=[['volume-microdetail','volume_microdetail'],['volume-interface-shred','volume_interface_shred'],['volume-swirl-jostle','volume_swirl_jostle']];
  assert.deepEqual(fields.map(([id])=>Number(values.get(id))),expected,'effective force amounts match the saved switches');
  assert.deepEqual(fields.map(([,param])=>Number(params.get(param))),expected,'the subsequent route parser sees the same migrated force amounts');
  assert.equal(params.has('volume_force_fine_breakup'),false,'retired route switches leave the effective startup route');
  assert.equal(params.has('volume_force_interface_shred'),false);
 });
}
test('an explicit startup jostle override still wins over the committed basin',async()=>{
 const {params}=await replay('semantic-flame','volume_swirl_jostle=2&volume_steps=8');
 assert.equal(params.get('volume_swirl_jostle'),'2');assert.equal(params.get('volume_steps'),'8');
 assert.equal(params.get('volume_interface_shred'),'0','unoverridden saved Shred stays off');
});
