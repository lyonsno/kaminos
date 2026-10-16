import assert from 'node:assert/strict';
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
