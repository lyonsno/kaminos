import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSceneDocument, planSceneRestore, isReloadableSceneObjectRecord } from '../scene-persistence-core.js';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { flamePoseInDomain } from '../scene-flame-emitter.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('a placed flame source is an authored, reloadable scene object', () => {
  const source = { id: 'flame-emitter', type: 'flame-emitter', source: 'kaminos:analytic-flame',
    label: 'Flame source', transform: {position:[.3,-.45,.1],rotation:[0,0,.2],scale:[1,1,1]} };
  assert.equal(isReloadableSceneObjectRecord(source), true,
    'the built-in flame source must reopen without an external mesh asset');
  const composition = {schema:'kaminos.stationary-flame-composition.v1',
    flame:{presetId:'vsp-'+ 'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
  const plan = planSceneRestore(buildSceneDocument({objects:[source],activeObjectId:source.id,composition}));
  assert.deepEqual(plan.objects[0].transform, source.transform);
  assert.equal(plan.activeObjectId, source.id);
});

test('a rejected agent placement leaves no active transaction and preserves an existing gesture', () => {
  let pose={position:[0,-.76,0],rotation:[0,0,0],scale:[1,1,1]};
  const edits=createSceneEdits({read:()=>pose,write:(_id,next)=>{
    if(next.position[0]===99)throw Error('source out of bounds');
    pose=structuredClone(next);
  }});
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('window.kaminosSetSceneObjectTransform =');
  const source=html.slice(start,html.indexOf('window.kaminosSetSplatCorrectionDebug',start));
  const context={scenePlacementTools:{edits},window:{kaminosSceneObjectDebugState:()=>[]}};
  vm.runInNewContext(source,context);
  const before=edits.state();
  assert.throws(()=>context.window.kaminosSetSceneObjectTransform('flame-emitter',{position:[99,0,0]}),/bounds/);
  assert.deepEqual(edits.state(),before,'failed source admission must roll back its own transaction');
  edits.begin('flame-emitter');const active=edits.state();
  assert.throws(()=>context.window.kaminosSetSceneObjectTransform('flame-emitter',{position:[.1,0,0]}),/active/);
  assert.deepEqual(edits.state(),active,'a competing agent edit must not cancel the human gesture');
});

test('moving flame beyond analytic support keeps the authored pose and suspends injection', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function writeAuthoredFlameEmitterPose(value) {');
  const end=html.indexOf('window.kaminosFlameEmitterState =',start);
  assert.ok(start>0 && end>start);
  let pose={position:[0,-.76,0],rotation:[0,0,0],scale:[1,1,1]};
  let suspended=false;
  const calls=[];
  const context={normalizeFlameEmitterPose:value=>structuredClone(value), flamePoseInDomain,
    flameDomainTranslation:[0,0,0],
    applyFlameEmitterPose:(next,{sourceEnabled=true}={})=>{
      calls.push({x:next.position[0],sourceEnabled});
      if(sourceEnabled && next.position[0]>1.5)throw Error('generated emitter support exceeds volume-local analytic bounds [-1.5, 1.5]');
    },
    window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring',sourceMode:'analytic-fixed'}}},
    ensureAuthoredFlameEmitter:()=>{},setInfo:()=>{},renderSceneObjectList:()=>{},
    get flameEmitterPose(){return pose;},set flameEmitterPose(next){pose=next;},
    get flameEmitterInjectionSuspended(){return suspended;},set flameEmitterInjectionSuspended(next){suspended=next;}};
  vm.runInNewContext(html.slice(start,end)+'\nthis.writeFlame=writeAuthoredFlameEmitterPose;',context);
  const far={...pose,position:[2,-.76,0]};
  assert.doesNotThrow(()=>context.writeFlame(far));
  assert.equal(pose.position[0],2);
  assert.equal(suspended,true);
  assert.deepEqual(calls.map(call=>[call.x,call.sourceEnabled]),[[2,false]]);
  context.writeFlame({...pose,position:[0,-.76,0]});
  assert.equal(suspended,false);
  assert.equal(calls.at(-1).sourceEnabled,true);
  context.writeFlame({...pose,position:[1.1,-.76,0]});
  assert.equal(suspended,true,'crossing the actual x/z grid edge must pause before analytic ±1.5 validation');
  assert.equal(calls.at(-1).sourceEnabled,false);
  context.writeFlame({...pose,position:[0,-1.3,0]});
  assert.equal(suspended,true,'crossing the lower grid face must pause even though analytic validation accepts it');
  assert.equal(calls.at(-1).sourceEnabled,false);
});

test('a legacy cluster composition reopens without placing an analytic source', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  activeSceneComposition = restorePlan.composition;', html.indexOf('async function loadSceneFile'));
  const end=html.indexOf("  setInfo('Loading scene...');",start);
  assert.ok(start>0 && end>start);
  let sourceWrites=0;
  const context={restorePlan:{composition:{flame:{stationary:true}}},objectRecords:[],
    window:{__kaminosVolumeEmitterReceipt:{effective:{family:'cluster',sourceMode:'cluster'}}},
    defaultFlameEmitterPose:()=>({position:[0,0,0]}),
    writeAuthoredFlameEmitterPose:()=>{sourceWrites++;throw Error('analytic source not mounted');},
    setAnnularBurner:()=>{}};
  assert.doesNotThrow(()=>vm.runInNewContext(html.slice(start,end),context));
  assert.equal(sourceWrites,0);
});

test('clearing a scene removes its old flame member before the next scene saves', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function clearScene() {');
  const end=html.indexOf('function loadTexture(file)',start);
  assert.ok(start>0 && end>start);
  const flame={id:'flame-emitter',type:'flame-emitter',object:{}};
  const removed=[];
  const context={FLAME_EMITTER_TYPE:'flame-emitter',scenePlacementTools:null,sceneMutationToken:0,sceneObjects:[flame],flameDomainGuide:null,
    scene:{remove:object=>removed.push(object)},disposeObjectTree:()=>{},
    greenroomPreviewState:null,currentMesh:null,sceneGroups:[],activeSceneObjectId:flame.id,
    activeSceneGroupId:null,glbSourceScene:null,transformControls:null,
    document:{getElementById:()=>({classList:{remove:()=>{}}})},
    renderSceneObjectList:()=>{},updateTransformInspector:()=>{}};
  vm.runInNewContext(html.slice(start,end)+'\nclearScene();',context);
  assert.equal(context.sceneObjects.length,0);
  assert.deepEqual(removed,[flame.object]);
});

test('switching to cluster removes the analytic member from scene membership', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function ensureAuthoredFlameEmitter(metadata = {}) {');
  const end=html.indexOf('function writeAuthoredFlameEmitterPose(value)',start);
  assert.ok(start>0 && end>start);
  const flame={id:'flame-emitter',type:'flame-emitter',object:{}};
  const removed=[];
  const context={scene:{remove:object=>removed.push(object)},isFireLightFieldRoute:()=>true,
    applyFlameEmitterPose:()=>{},window:{__kaminosVolumeEmitterReceipt:{effective:{family:'cluster',sourceMode:'cluster'}}},
    sceneObjects:[flame],FLAME_EMITTER_ID:'flame-emitter',activeSceneObjectId:null,flameDomainGuide:null,
    scenePlacementTools:{finish:()=>{},edits:{discard:()=>{}}},
    disposeObjectTree:()=>{},renderSceneObjectList:()=>{}};
  vm.runInNewContext(html.slice(start,end)+'\nensureAuthoredFlameEmitter();',context);
  assert.equal(context.sceneObjects.length,0);
  assert.deepEqual(removed,[flame.object]);
});

test('a source-free analytic family retains the flame handle for editing and saving', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function ensureAuthoredFlameEmitter(metadata = {}) {');
  const end=html.indexOf('function writeAuthoredFlameEmitterPose(value)',start);
  const flame={id:'flame-emitter',type:'flame-emitter',object:{}};
  let removed=0,updated=0;
  const context={scene:{remove:()=>removed++},isFireLightFieldRoute:()=>true,
    applyFlameEmitterPose:()=>{},window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring',sourceMode:'off'}}},
    sceneObjects:[flame],FLAME_EMITTER_ID:'flame-emitter',activeSceneObjectId:'flame-emitter',flameDomainGuide:{visible:false,box:{set:()=>{}}},
    flameDomainTranslation:[0,0,0],
    flameEmitterPose:{position:[2,0,0],rotation:[0,0,0],scale:[1,1,1]},
    applySceneObjectTransformState:()=>updated++,updateFlameEmitterSupportOutline:()=>{},
    THREE:{Vector3:class {add(){return this;}}}};
  vm.runInNewContext(html.slice(start,end)+'\nensureAuthoredFlameEmitter();',context);
  assert.equal(removed,0);
  assert.equal(updated,1);
  assert.equal(context.flameDomainGuide.visible,true);
});
