import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createInferenceCache,photoCacheKey,retainedGeometry} from './inference-cache.js';

test('pixel content and dimensions identify an image rather than its file name',async()=>{
  const image={width:2,height:1,data:new Uint8Array([1,2,3,255,4,5,6,255])};
  const key=await photoCacheKey(image);
  assert.equal(await photoCacheKey({...image,data:image.data.slice()}),key);
  assert.notEqual(await photoCacheKey({...image,width:1,height:2}),key);
  assert.notEqual(await photoCacheKey({...image,data:new Uint8Array(8)}),key);
});
test('unavailable storage is an explicit nonfatal miss and failed write, with later retries',async()=>{
  const errors=[],cache=createInferenceCache({indexedDB:null,onError:error=>errors.push(error.message)});
  assert.equal(await cache.get('image:512'),null);assert.equal(await cache.put('image:512',{output:1}),false);
  assert.equal(errors.length,2);assert.match(errors[0],/unavailable/);
});
test('retained geometry preserves all render input arrays without retaining runtime objects',()=>{
  const depth={width:1,height:1,depth:new Float32Array([1]),points:new Float32Array([0,0,1]),normals:new Float32Array([0,0,-1]),colors:new Uint8Array([2,3,4]),metricScale:1,routeResult:{device:{}}};
  const retained=retainedGeometry(depth);
  assert.equal(retained.points,depth.points);assert.equal(retained.depth,depth.depth);assert.equal(retained.colors,depth.colors);
  assert.equal(retained.routeResult,undefined);
});
