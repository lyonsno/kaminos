// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeComposition, compositionRestoreUrl, forwardCompositionHash} from '../scene-authoring.mjs';
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
test('explicit kiln collision on and off survive saved-scene and preset-launch routing',()=>{
 for(const setting of ['kiln','off']) {
  const saved=normalizeComposition({...composition,route:{...composition.route,volume_collision:setting}});
  const restore=new URL(compositionRestoreUrl(saved,'kiln.kaminos.json','http://localhost'));
  const viewer=new URL(forwardCompositionHash('http://localhost/',restore.hash));
  assert.equal(new URLSearchParams(viewer.hash.slice(1)).get('volume_collision'),setting);
 }
 assert.equal(normalizeComposition(composition).route.volume_collision,undefined,'legacy scenes stay valid');
 assert.throws(()=>normalizeComposition({...composition,route:{...composition.route,volume_collision:'all'}}),/collision/);
});
test('live collision request updates only its route value and does not reload or clear the simulation',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('function writeKilnCollisionState(');
 assert.ok(start>=0,'a shared live collision setter is required');
 const location={href:'http://localhost/#authoring=1&scene=kiln.kaminos.json&volume_light_field=1',hash:'#authoring=1&scene=kiln.kaminos.json&volume_light_field=1'};
 const context={URL,URLSearchParams,location,history:{state:null,replaceState(_s,_t,url){location.href=url.href;location.hash=url.hash;}},activeSceneComposition:structuredClone(composition),syncKilnCollisionControl(){},window:{_kaminosDirty(){}},isFireLightFieldRoute:()=>true};
 vm.createContext(context);vm.runInContext(html.slice(start,html.indexOf('\n}\n',start)+3),context);
 context.writeKilnCollisionState({enabled:true});assert.equal(new URLSearchParams(location.hash.slice(1)).get('volume_collision'),'kiln');assert.equal(context.activeSceneComposition.route.volume_collision,'kiln');
 context.writeKilnCollisionState({enabled:false});assert.equal(context.activeSceneComposition.route.volume_collision,'off');assert.equal(new URL(location.href).hash.includes('scene=kiln.kaminos.json'),true);
 assert.throws(()=>context.writeKilnCollisionState({enabled:'yes'}),/boolean/);
});
