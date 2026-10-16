// kaminos-test: node
import assert from 'node:assert/strict';
import {resolveJoinedExteriorGeometry, JOINED_EXTERIOR_ROUTE} from '../volume-joined-exterior.mjs';
import {outerDonorBounds} from '../volume-outer-smoke.mjs';
assert.equal(JOINED_EXTERIOR_ROUTE,'joined-exterior-transport-pressure-v1','cockpit must consume transported exterior, not pressure-only placeholder');
for(const f of [24,28,32,48]){
  const g=resolveJoinedExteriorGeometry({fineDims:[f,f,f],pitch:2/f,coarseResolution:32,size:2});
  assert.equal(g.admitted,true,g.reason);
  assert.deepEqual(g.shape,[32,64,32]);
  assert.deepEqual(g.geometry.min,[-2,-2,-2]);
  assert.deepEqual(g.geometry.fine.min,[-1,-1,-1]);
  assert.deepEqual(g.geometry.fine.max,[1,1,1]);
  assert.equal(g.cellWidth,.125);
  assert.equal(g.ghosts.cellWidthFine,f/16);
  assert.deepEqual(outerDonorBounds(g.config),{min:[-1,-1,-1],max:[1,1,1]},
    'joined restriction must reach the interface: covered coarse velocities are removed by shared projection, so an inset donor leaves a stagnant material moat');
}
assert.equal(resolveJoinedExteriorGeometry({fineDims:[32,32,32],pitch:2/32,coarseResolution:2,size:4}).admitted,false,'unresolved donor must refuse');
console.log('joined transport geometry passed');
