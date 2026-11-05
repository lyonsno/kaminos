// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {planSceneRestore,sceneDocumentIsLoadable,getSceneObjectRecords,SCENE_VERSION} from '../scene-persistence-core.js';
import {defaultAshSettings} from '../ash/scene-record.mjs';

function savedAsh() {
  return {version:SCENE_VERSION,objects:[{
    id:'ash',type:'retained-ash',source:'kaminos:retained-ash',
    transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},
    ash:{...defaultAshSettings(),checkpoint:{schema:'kaminos.tiled-ash.v1',values:[1,2,3]}},
  }]};
}

test('planning validates and detaches saved ash without normalizing its checkpoint twice',()=>{
  const document=savedAsh(),before=structuredClone(document);
  const expected=getSceneObjectRecords(document);
  const clone=globalThis.structuredClone;
  let checkpointCopies=0,plan;
  globalThis.structuredClone=(value,...options)=>{
    if(value?.checkpoint?.schema==='kaminos.tiled-ash.v1'||value?.ash?.checkpoint?.schema==='kaminos.tiled-ash.v1')checkpointCopies++;
    return clone(value,...options);
  };
  try {plan=planSceneRestore(document);} finally {globalThis.structuredClone=clone;}
  assert.ok(checkpointCopies<=3,`one normalization currently needs three checkpoint copies; planning made ${checkpointCopies}`);
  assert.deepEqual(plan.authoredObjects,expected);
  assert.deepEqual(plan.objects,expected);
  assert.deepEqual(document,before);
  assert.notEqual(plan.objects[0].ash.checkpoint,document.objects[0].ash.checkpoint);
  plan.objects[0].ash.checkpoint.values[0]=99;
  assert.deepEqual(document,before,'planned checkpoint mutations must not change saved history');
  document.objects[0].ash.checkpoint.values[1]=77;
  assert.deepEqual(plan.objects[0].ash.checkpoint.values,[99,2,3],'saved input mutations must not change the plan');
});

test('normalization reuse preserves invalid-document refusal and version precedence',()=>{
  const malformed=savedAsh();malformed.objects[0].ash.width=-1;
  assert.throws(()=>planSceneRestore(malformed),/Invalid ash width/);
  assert.throws(()=>planSceneRestore({...malformed,version:SCENE_VERSION+1}),/newer authoring client/);
  delete malformed.version;
  assert.equal(sceneDocumentIsLoadable(malformed),false);
  assert.throws(()=>planSceneRestore(malformed),/Invalid scene format/);
  const checkpoint=savedAsh();checkpoint.objects[0].ash.checkpoint.schema='unknown';
  assert.throws(()=>planSceneRestore(checkpoint),/Invalid retained ash checkpoint schema/);
  const collision={version:SCENE_VERSION,objects:[{id:'mesh',type:'glb',source:'/mesh.glb',collision:{domainId:'flame-field',enabled:true}}]};
  assert.throws(()=>planSceneRestore(collision),/domain.*reference|domain.*missing|missing.*domain/i);
});

test('legacy, primitive-only and explicit empty plans keep their admission behavior',()=>{
  const legacy={version:5,model:{type:'glb',source:'/legacy.glb'}};
  assert.equal(sceneDocumentIsLoadable(legacy),true);
  assert.deepEqual(planSceneRestore(legacy).objects,getSceneObjectRecords(legacy));
  const primitive={version:SCENE_VERSION,volumePrimitives:{primitives:[{id:'volume'}]}};
  assert.equal(sceneDocumentIsLoadable(primitive),true);
  assert.deepEqual(planSceneRestore(primitive).volumePrimitives.primitives,[{id:'volume'}]);
  const empty={version:SCENE_VERSION,objects:[]};
  assert.equal(sceneDocumentIsLoadable(empty),false);
  assert.throws(()=>planSceneRestore(empty),/Invalid scene format/);
  assert.deepEqual(planSceneRestore(empty,{allowEmpty:true}).objects,[]);
  assert.throws(()=>planSceneRestore({...empty,version:0},{allowEmpty:true}),/Invalid scene format/);
});
