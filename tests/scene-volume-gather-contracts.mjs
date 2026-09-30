import assert from 'node:assert/strict';
import { buildTriangleVisibility } from '../scene-light-visibility.mjs';
import { integrateVolumeRay, lightingDirections, receiverDispatch } from '../scene-volume-gather.mjs';

assert.deepEqual(receiverDispatch(65535*64+1,65535),[65535,2]);
assert.deepEqual(receiverDispatch(65,65535),[2,1]);

const bvh = buildTriangleVisibility([{a:[-2,-2,1],b:[2,-2,1],c:[0,2,1]}]);
const packed = bvh.packGpu();
assert.equal(packed.nodes.length,12);
assert.equal(packed.triangles.length,12);
assert.deepEqual(Array.from(new Uint32Array(packed.nodes.buffer).slice(8,11)),[1,0,1]);
const source = () => [2,1,.5,0];
assert.ok(integrateVolumeRay(source,2,.1).every((v,i)=>Math.abs(v-[4,2,1][i])<1e-12));
const attenuated = integrateVolumeRay(() => [2,1,.5,3],2,.1);
assert.ok(Math.abs(attenuated[0]-2*(1-Math.exp(-6))/3)<1e-12);
const blocked = integrateVolumeRay(source,bvh.trace([0,0,0],[0,0,1]).distance,.1);
assert.ok(blocked.every((v,i)=>Math.abs(v-[2,1,.5][i])<1e-12));
const behindWall = integrateVolumeRay(t => t>1 ? [100,0,0,0] : [0,0,0,0],1,.1);
assert.deepEqual(behindWall,[0,0,0]);
for(const count of [24,48,96]) {
  const dirs = lightingDirections(count);
  assert.equal(dirs.length,count);
  for(const d of dirs) assert.ok(Math.abs(Math.hypot(...d)-1)<1e-12);
  for(let axis=0;axis<3;axis++) assert.ok(Math.abs(dirs.reduce((s,d)=>s+d[axis],0))<1e-12);
}
console.log('distributed volume ray and static cache contracts passed');
