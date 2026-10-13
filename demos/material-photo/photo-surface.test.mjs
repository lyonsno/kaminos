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
