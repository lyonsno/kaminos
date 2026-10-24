// kaminos-test: node
import assert from 'node:assert/strict';
import {cropSurfaceField} from '../surface-field-crop.mjs';
const data=new Float32Array([
  0,0,0, 0,1,0, .1,.2,.3,.4,.5,.6,
  2,0,0, 0,1,0, .2,.3,.4,.5,.6,.7,
  0,0,2, 0,1,0, .3,.4,.5,.6,.7,.8,
  3,0,3, 0,1,0, .4,.5,.6,.7,.8,.9,
]);
const triangles=new Uint32Array([0,1,2,1,2,3]);
const bounds=[[-.1,-.1,-.1],[.1,.1,.1]];
const result=cropSurfaceField(data,triangles,bounds);
assert.deepEqual([...result.sourceIds],[0,1,2]);
assert.deepEqual([...result.triangleIds],[0]);
assert.deepEqual([...result.triangles],[0,1,2]);
assert.deepEqual(result.data,data.slice(0,36)); // all material channels and normals exact
assert.deepEqual(triangles,new Uint32Array([0,1,2,1,2,3]));
assert.throws(()=>cropSurfaceField(data,new Uint32Array([0,1,4]),bounds),/triangle/);
assert.throws(()=>cropSurfaceField(data,triangles,[[5,5,5],[6,6,6]]),/Empty/);
console.log('Exact rows, boundary triangles, source identities and rejection pass');
