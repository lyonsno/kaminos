// kaminos-test: node
import assert from 'node:assert/strict';
import * as authoring from '../scene-authoring.mjs';
import {flamePropertyApplies} from '../flame-authoring.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

assert.equal(typeof authoring.resolveFlameLightingRoute,'function','ordinary flame routes share current lighting defaults');
const resolve=params=>authoring.resolveFlameLightingRoute(new URLSearchParams(params));
assert.equal(resolve('').has('volume_light_field_shared_source'),false,'no fire does not start lighting');
const old='volume_light_field=1&volume_light_field_scene_depth=1';
for(const key of ['shared_source','distributed','hybrid'])assert.equal(resolve(old).get('volume_light_field_'+key),'1');
assert.equal(resolve(old+'&volume_light_field_shared_source=0').get('volume_light_field_shared_source'),'0');
assert.equal(resolve(old+'&volume_light_field_distributed=0').get('volume_light_field_distributed'),'0');
assert.equal(resolve(old+'&volume_light_field_hybrid=0').get('volume_light_field_hybrid'),'0');
assert.equal(resolve(old+'&volume_light_field_hybrid_points=8').get('volume_light_field_hybrid_points'),'8');
const composition={schema:authoring.COMPOSITION_SCHEMA,flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:Object.fromEntries(new URLSearchParams(old))};
const copy=structuredClone(composition);
const url=new URL(authoring.compositionRestoreUrl(composition,'old.kaminos.json','http://localhost'));
assert.equal(new URLSearchParams(url.hash.slice(1)).get('volume_light_field_hybrid'),'1','saved old scenes restore current lighting');
assert.deepEqual(composition,copy,'migration does not mutate source document');
assert.equal(flamePropertyApplies('volume-physical-ambient',{sceneLighting:true}),false,'flat ambient has no control when scene illumination owns smoke');
assert.equal(flamePropertyApplies('volume-physical-ambient',{sceneLighting:false}),true);
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const predicate=source.match(/readSceneLighting:\(\)=>([^,\n]+),/)[1];
for(const [smokeMode,visible] of [['distributed',false],['legacy',true]]) {
  const window={__kaminosSceneRadianceSetup:{status:'mounted'},__kaminosSceneRadiance:{debugState:()=>({smokeMode})}};
  const effective=vm.runInNewContext(predicate,{window,fireLightFieldRouteParams:()=>new URLSearchParams('volume_light_field_distributed=1')});
  assert.equal(flamePropertyApplies('volume-physical-ambient',{sceneLighting:effective}),visible,smokeMode+' effective smoke mode governs ambient visibility');
}
console.log('ordinary and restored flame routes select shared scene lighting; explicit choices survive');
