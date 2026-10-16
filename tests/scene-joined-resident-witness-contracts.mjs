// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResidentMotion,sampleAcceptedCollision} from '../tools/joined-resident-witness.mjs';
const state=()=>({simStepCount:10,sceneCollision:{effective:'mesh-voxel-solid',backend:'gpu',geometryRevision:'a'},
 joinedBoundary:{admitted:true},joinedRendering:{enabled:true},joinedEditing:{held:false,pending:false},
 joinedExterior:{admitted:true,pressureTopology:'fixed-resident-mask',generation:1,topologyGeneration:1,steps:10,solids:{fine:'a'}}});
test('resident motion witness refuses fallback, stale motion, rebuild and held exterior',()=>{
 const before=state(),after=state();after.simStepCount=13;after.joinedExterior.steps=13;after.joinedExterior.solids.fine='b';after.sceneCollision.geometryRevision='b';
 assert.doesNotThrow(()=>assertResidentMotion(before,after));
 for(const mutate of [s=>s.sceneCollision.backend='cpu',s=>s.joinedBoundary.admitted=false,s=>s.joinedRendering.enabled=false,
  s=>s.joinedExterior.pressureTopology='compact-cpu-mask',s=>s.joinedExterior.topologyGeneration++,s=>s.joinedExterior.generation++,
  s=>s.joinedExterior.steps=10,s=>s.simStepCount=10,s=>s.joinedEditing.held=true,s=>s.joinedEditing.pending=true,
  s=>s.joinedExterior.solids.fine='a',s=>delete s.joinedExterior.solids]){
  const bad=structuredClone(after);mutate(bad);assert.throws(()=>assertResidentMotion(before,bad));
 }
});
test('snapshot admission rejects stale, rejected and replaced GPU collision evidence',async()=>{
 const accepted={effective:'mesh-voxel-solid',backend:'gpu',validation:'explicit-gpu-snapshot',geometryRevision:3};
 const api={sampleSceneCollisionMask:async()=>({status:'sampled',runtime:accepted}),debugState:()=>({sceneCollision:accepted})};
 assert.equal((await sampleAcceptedCollision(api)).sceneCollision,accepted);
 for(const result of [{status:'stale'},{status:'sampled',runtime:{...accepted,effective:'off'}},{status:'sampled',runtime:{...accepted,backend:'cpu'}}])
  await assert.rejects(sampleAcceptedCollision({...api,sampleSceneCollisionMask:async()=>result}),/not accepted/);
 for(const changed of [{...accepted,effective:'submitted-unverified'},{...accepted,geometryRevision:4}])
  await assert.rejects(sampleAcceptedCollision({...api,debugState:()=>({sceneCollision:changed})}),/changed/);
});
