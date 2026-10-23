// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeFlameEmitterPose,immersedControlsForFlamePose,immersedRadiusBounds,defaultFlameEmitterPose} from '../scene-flame-emitter.mjs';
import {flameSourceInputs} from '../scene-fire-domain.mjs';
const pose=scale=>({...defaultFlameEmitterPose(),scale:[scale,scale,scale]});
test('uniform emitter scale stops at zero and has no upper bound',()=>{
 for(const value of [-3,0,.00001,1,1e5])assert.deepEqual(normalizeFlameEmitterPose(pose(value)).scale,[Math.max(0,value),Math.max(0,value),Math.max(0,value)]);
 assert.throws(()=>normalizeFlameEmitterPose({...pose(1),scale:[1,2,1]}),/uniform/);
});
test('zero radius or zero scale stops new supply without changing authored enable state',()=>{
 for(const [scale,radius] of [[0,.2],[1,0]]){
  const record={id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame',transform:pose(scale),emissionEnabled:true,emission:{domainId:'flame-field',settings:{'volume-immersed-radius':{value:radius}}}};
  const [input]=flameSourceInputs([record],{controls:{emitterSourceLaw:'immersed-source'}});
  assert.equal(input.controls.immersedSourceEnabled,false);
  assert.equal(record.emissionEnabled,true);
  assert.deepEqual(immersedRadiusBounds(pose(scale)),{min:0,max:null});
 }
 assert.equal(immersedControlsForFlamePose({immersedRadius:.1},pose(1e5)).immersedRadius,1e4);
});

import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {portableFlamePreset,flamePresetForLocalControls} from '../flame-authoring.mjs';
test('a clamped gesture keeps its baseline for regrowth, cancel and history',()=>{
 let current=pose(1);const edits=createSceneEdits({read:()=>current,write:(_id,next)=>{current=normalizeFlameEmitterPose(next);}});
 edits.begin('source');const base=edits.state().active.before;
 edits.preview(transformPose(base,{operation:'scale',amount:-5}));assert.deepEqual(current.scale,[0,0,0]);assert.ok(edits.state().active);
 edits.preview(transformPose(base,{operation:'scale',amount:20}));assert.deepEqual(current.scale,[20,20,20]);edits.commit();
 edits.undo();assert.deepEqual(current.scale,[1,1,1]);edits.redo();assert.deepEqual(current.scale,[20,20,20]);
 edits.begin('source');edits.preview(transformPose(current,{operation:'scale',amount:0}));edits.cancel();assert.deepEqual(current.scale,[20,20,20]);
});
test('a collapsed source reopens and portable preset display remains finite',()=>{
 const source={id:'source',type:'flame-emitter',source:'kaminos:analytic-flame',label:'Zero source',transform:pose(0)};
 const restored=planSceneRestore(buildSceneDocument({objects:[source],activeObjectId:source.id,composition:{schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}}}));assert.deepEqual(restored.objects[0].transform.scale,[0,0,0]);
 const preset={route:'http://localhost/',domControls:{'volume-emitter-source-law':{value:'immersed-source'},'volume-immersed-radius':{value:.2}}};
 const saved=portableFlamePreset(preset,0);assert.equal(saved.domControls['volume-immersed-radius'].value,0);
 assert.equal(flamePresetForLocalControls(saved,0).domControls['volume-immersed-radius'].value,0);
});
