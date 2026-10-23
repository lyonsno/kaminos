// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
const descriptor=value=>({value,rawValue:String(value)});
const settings={domControls:{'volume-immersed-fuel':descriptor(.7),'volume-immersed-speed':descriptor(.2),'volume-resolution':descriptor(32)},rendererControls:{},presentationControls:{}};
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
const source=(id,x,fuel,enabled=true)=>({id,type:'flame-emitter',source:'kaminos:analytic-flame',label:id,emissionEnabled:enabled,transform:{position:[x,-.5,0],rotation:[0,0,0],scale:[1,1,1]},emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':descriptor(fuel),'volume-immersed-speed':descriptor(.3)}}});
const save=objects=>buildSceneDocument({objects,composition,fireSettings:settings,flameDomainFollowSource:false});
test('two authored sources retain distinct identity, pose, supply and enabled state on save/reopen',()=>{
 const a=source('flame-emitter',-.4,.25),b=source('flame-source-second',.4,.85,false);
 assert.equal(isReloadableSceneObjectRecord(b),true,'another ordinary emitter is a reloadable source');
 const doc=save([a,b]),plan=planSceneRestore(doc);
 for(const original of [a,b]){
  const restored=plan.objects.find(o=>o.id===original.id);
  assert.deepEqual(restored.emission,original.emission,'save must not replace object supply with the global template');
  assert.deepEqual(restored.transform,original.transform);
  assert.equal(restored.emissionEnabled,original.emissionEnabled);
 }
 assert.equal(doc.objects.filter(o=>o.type==='simulation-domain').length,1);
 assert.equal(plan.fireSettings.domControls['volume-resolution'].value,32);
});
test('removing the original source preserves the remaining source supply',()=>{
 const b=source('flame-source-second',.4,.85),plan=planSceneRestore(save([b]));
 assert.equal(plan.flameSourcePresent,true);
 assert.equal(plan.objects.find(o=>o.id===b.id).emission.settings['volume-immersed-fuel'].value,.85);
 assert.equal(plan.fireSettings.domControls['volume-immersed-fuel'].value,.85,'legacy engine projection uses a real remaining source');
});
test('each source validates its own supply ownership and domain reference',()=>{
 const doc=save([source('flame-emitter',-.4,.25),source('flame-source-second',.4,.85)]);
 const wrongDomain=structuredClone(doc);wrongDomain.objects.find(o=>o.id==='flame-source-second').emission.domainId='absent';
 assert.throws(()=>planSceneRestore(wrongDomain),/domain.*reference/i);
 const wrongOwner=structuredClone(doc);wrongOwner.objects.find(o=>o.id==='flame-source-second').emission.settings['volume-resolution']=descriptor(128);
 assert.throws(()=>planSceneRestore(wrongOwner),/source.*owner|source.*control|control.*source/i);
 const wrongEnabled=structuredClone(doc);wrongEnabled.objects.find(o=>o.id==='flame-source-second').emissionEnabled='false';
 assert.throws(()=>planSceneRestore(wrongEnabled),/boolean/i);
});
test('legacy singleton scenes still seed source settings from their saved basin',()=>{
 const a=source('flame-emitter',0,.2);delete a.emission;
 const plan=planSceneRestore(save([a]));
 assert.deepEqual(plan.objects.find(o=>o.id===a.id).emission.settings,{'volume-immersed-fuel':descriptor(.7),'volume-immersed-speed':descriptor(.2)});
 assert.equal(planSceneRestore(save([])).flameSourcePresent,false);
});
