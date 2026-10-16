import assert from 'node:assert/strict';
export function assertSmokeServerIdentity(runtime,source,stores){
 assert.equal(runtime?.source?.repoRoot,source.root,'smoke server root mismatch');
 assert.equal(runtime?.source?.commit,source.rev,'smoke server revision mismatch');
 if(stores)for(const [field,dir] of Object.entries({volumeSettingsStore:'settings',volumeBasinSessionStore:'basins',volumeCockpitLayoutStore:'layouts'}))
  assert.equal(runtime[field],stores+'/'+dir,'smoke server store mismatch: '+field);
}
export function assertSmokeServerAlive(server,error,log=''){
 if(error)throw error;
 if(server&&(server.exitCode!==null||server.signalCode!==null))throw Error('witness server exited: '+log);
}
// Self-contained so the same function executes inside the browser witness.
export async function sampleAcceptedCollision(api){
 const sample=await api.sampleSceneCollisionMask();
 if(sample.status!=='sampled'||sample.runtime?.backend!=='gpu'||sample.runtime?.effective!=='mesh-voxel-solid')
  throw Error('collision snapshot not accepted: '+sample.status+' '+sample.runtime?.reason);
 const state=api.debugState();
 if(state.sceneCollision?.effective!=='mesh-voxel-solid'||state.sceneCollision?.validation!=='explicit-gpu-snapshot'||
    state.sceneCollision?.geometryRevision!==sample.runtime.geometryRevision)
  throw Error('collision changed after validation');
 return state;
}
export function assertResidentMotion(before,after){
 for(const s of [before,after]){
  assert.equal(s.sceneCollision?.effective,'mesh-voxel-solid');
  assert.equal(s.sceneCollision?.backend,'gpu','resident scene GPU route required');
  assert.equal(s.joinedBoundary?.admitted,true);assert.equal(s.joinedExterior?.admitted,true);
  assert.equal(s.joinedRendering?.enabled,true);assert.equal(s.joinedExterior?.pressureTopology,'fixed-resident-mask');
  assert.equal(s.joinedEditing?.held,false);assert.equal(s.joinedEditing?.pending,false);
  assert(s.joinedExterior?.solids?.fine,'missing collision revision');
 }
 assert(after.simStepCount>before.simStepCount,'fine simulation did not advance');
 assert(after.joinedExterior.steps>before.joinedExterior.steps,'exterior simulation did not advance');
 assert.equal(after.joinedExterior.generation,before.joinedExterior.generation,'exterior allocation changed');
 assert.equal(after.joinedExterior.topologyGeneration,before.joinedExterior.topologyGeneration,'pressure topology rebuilt');
 assert.notEqual(after.joinedExterior.solids.fine,before.joinedExterior.solids.fine,'collision update was not consumed');
}
