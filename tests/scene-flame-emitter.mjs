import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSceneDocument, planSceneRestore, isReloadableSceneObjectRecord } from '../scene-persistence-core.js';
import { createSceneEdits } from '../scene-edit-session.mjs';
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

test('a legacy cluster composition reopens without placing an analytic source', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  activeSceneComposition = restorePlan.composition;', html.indexOf('async function loadSceneFile'));
  const end=html.indexOf("  setInfo('Loading scene...');",start);
  assert.ok(start>0 && end>start);
  let sourceWrites=0;
  const context={restorePlan:{composition:{flame:{stationary:true}}},objectRecords:[],
    window:{__kaminosVolumeEmitterReceipt:{effective:{sourceMode:'cluster'}}},
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
  const context={FLAME_EMITTER_TYPE:'flame-emitter',scenePlacementTools:null,sceneMutationToken:0,sceneObjects:[flame],
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
    applyFlameEmitterPose:()=>{},window:{__kaminosVolumeEmitterReceipt:{effective:{sourceMode:'cluster'}}},
    sceneObjects:[flame],FLAME_EMITTER_ID:'flame-emitter',activeSceneObjectId:null,
    scenePlacementTools:{finish:()=>{},edits:{discard:()=>{}}},
    disposeObjectTree:()=>{},renderSceneObjectList:()=>{}};
  vm.runInNewContext(html.slice(start,end)+'\nensureAuthoredFlameEmitter();',context);
  assert.equal(context.sceneObjects.length,0);
  assert.deepEqual(removed,[flame.object]);
});
