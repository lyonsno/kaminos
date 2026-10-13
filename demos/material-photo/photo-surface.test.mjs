import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPhotoSurface} from './photo-surface.js';

test('a display cutout excludes background triangles without changing learned vertex values',()=>{
  const result={width:3,height:3,depth:new Float32Array(9).fill(1),normals:new Float32Array(27).fill(1)};
  const mask={width:3,height:3,data:new Uint8Array(36)};
  for(const i of [0,1,3,4])mask.data.set([255,255,255,255],i*4);
  const original=buildPhotoSurface(result),cutout=buildPhotoSurface(result,1,mask);
  assert.deepEqual([...cutout.indices],[0,3,1,1,3,4]);
  assert.deepEqual(cutout.position,original.position);assert.deepEqual(cutout.normal,original.normal);
  assert.deepEqual(result.depth,new Float32Array(9).fill(1));
});
test('an authored foreground point keeps its connected surface and excludes detached background islands',()=>{
  const result={width:5,height:2,depth:new Float32Array(10).fill(1),normals:new Float32Array(30).fill(1)};
  const cutout={width:5,height:2,data:new Uint8Array(40).fill(255),subjectPoint:[0,.5]};
  for(const i of [2,7])cutout.data.fill(0,i*4,i*4+4);
  assert.deepEqual([...buildPhotoSurface(result,1,cutout).indices],[0,5,1,1,5,6]);
});
