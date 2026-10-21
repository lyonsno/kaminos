// kaminos-test: node
import assert from 'node:assert/strict';
import * as importer from '../models/unimate/unimate-rig-import.js';
import { skeletonConditioning } from '../models/unimate/unimate-rig-features.js';

assert.equal(typeof importer.reconditionSkeletonBundle, 'function', 'edited rest poses need a bundle-preserving preparation operation');
const { reconditionSkeletonBundle } = importer;
const jointNames = ['pelvis', 'left', 'right'], parents = [-1, 0, 0];
const positions = [[0,1,0],[-1,0,0],[1,0,0]];
const source = { b: { schema: 'kaminos.unimate.demo-bundle.v0', sha256: 'source-digest',
  skeleton: { name: 'source', jointNames, parents, joints: 3, frames: 60, fps: 30 },
  motionLength: 60, outputTimes: [0,1], prompts: [{ text: 'old', referenceNoise: 'noise0' }] },
  a: { ...skeletonConditioning({ rest: positions, parents }), jointNamesEmb: new Float32Array(3*768), noise0: new Float32Array([7]) } };
source.a.spectral.fill(.25); // The observed basis must survive, even when another valid basis exists.
const before = structuredClone(source);
const edited = [[0,2,0],[-1,0,0],[1,0,0]];
const result = reconditionSkeletonBundle(source, { jointNames, parents, positions: edited, name: 'edited' });
assert.deepEqual(source, before, 'preparation does not mutate the reference');
assert.deepEqual(result.a.spectral, source.a.spectral);
assert.deepEqual(result.a.jointNamesEmb, source.a.jointNamesEmb);
assert.notEqual(result.a.spectral, source.a.spectral, 'returned data owns its buffers');
assert.notDeepEqual(result.a.tpos, source.a.tpos, 'geometry changes reach conditioning');
assert.equal(result.b.skeleton.name, 'edited');
assert.deepEqual(result.b.skeleton.parents, parents);
assert.deepEqual(result.b.prompts, [], 'edited input cannot replay old reference noise or motion');
assert.equal(result.b.sha256, undefined, 'old binary digest is not asserted for the new bundle');
assert.equal(result.a.noise0, undefined);
// Transform metadata round-trips every edited head into its original local frame.
const { scale, yaw, offset: [rx, rz, minY] } = result.restFrame;
for (let j=0;j<3;j++) {
  const [x,y,z]=result.a.restPositions.subarray(j*3,j*3+3);
  const a=x/scale+rx,b=z/scale+rz;
  const back=[a*Math.cos(yaw)-b*Math.sin(yaw),(y+minY)/scale,a*Math.sin(yaw)+b*Math.cos(yaw)];
  back.forEach((v,k)=>assert(Math.abs(v-edited[j][k])<1e-6));
}
for (const bad of [
  { jointNames: ['pelvis','right','left'] }, { parents: [-1,0,1] },
  { positions: [[0,0,0],[0,0,0],[0,0,0]] }, { positions: [[0,1,0],[NaN,0,0],[1,0,0]] },
]) assert.throws(()=>reconditionSkeletonBundle(source,{jointNames,parents,positions:edited,...bad}));
console.log('edited rest conditioning: pass');
