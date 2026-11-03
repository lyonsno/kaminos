// kaminos-test: node
import assert from 'node:assert/strict';
import {residentHandRayBytes} from '../fracture-resident-hand.mjs';
const ray={origin:[1,2,3],direction:[0,0,-1],normal:[0,0,-1],maxDistance:Infinity};
const packed=residentHandRayBytes(ray,7);assert.deepEqual(Array.from(packed.slice(0,3)),[1,2,3]);assert.ok(Number.isFinite(packed[3])&&packed[3]>1e30);assert.equal(packed[7],7);assert.deepEqual(Array.from(packed.slice(8,11)),[0,0,-1]);
assert.throws(()=>residentHandRayBytes({...ray,direction:[0,0,-2]}),/unit/);assert.throws(()=>residentHandRayBytes({...ray,origin:[NaN,0,0]}),/finite/);assert.throws(()=>residentHandRayBytes({...ray,maxDistance:-1}),/positive/);assert.equal(residentHandRayBytes({...ray,maxDistance:4})[3],4);
