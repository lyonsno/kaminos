// kaminos-test: node
import assert from 'node:assert/strict';
import {dragVelocity} from '../viewport-impulse-gesture.mjs';
assert.deepEqual(dragVelocity([1,2,3],[1,2,3]),[0,0,0]);
const x=dragVelocity([2,3,4],[3,3,4]);assert.ok(Math.abs(x[0]-2*Math.log(2))<1e-12);assert.deepEqual(x.slice(1),[0,0]);
assert.ok(Math.abs(dragVelocity([0,0,0],[0,3,4])[1]/dragVelocity([0,0,0],[0,3,4])[2]-.75)<1e-12);
assert.ok(dragVelocity([0,0,0],[2,0,0])[0]>x[0]);assert.ok(dragVelocity([0,0,0],[2,0,0])[0]<2*x[0]);
assert.throws(()=>dragVelocity([NaN,0,0],[1,0,0]),/Invalid/);
