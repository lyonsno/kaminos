import test from 'node:test';import assert from 'node:assert/strict';import * as host from '../fluid-viewport-host.mjs';
test('offscreen viewport accepts the caller extent and refuses partial or invalid dimensions',()=>{
 assert.equal(typeof host.fluidViewportExtent,'function');
 assert.deepEqual(host.fluidViewportExtent({width:601,height:480},{x:1202,y:480}),{width:601,height:480});
 assert.deepEqual(host.fluidViewportExtent(null,{x:1203,y:480}),{width:1203,height:480});
 for(const extent of [{width:0,height:480},{width:601},{width:1.5,height:480}])assert.throws(()=>host.fluidViewportExtent(extent,{x:1202,y:480}),/positive integers/);
});
