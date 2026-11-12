// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as api from '../surface-teacher.mjs';
test('analytical spheres keep exact bounds and radius in reordered visibility storage',()=>{assert.equal(typeof api.packSurfacePrimitives,'function','analytical primitive packer must exist');const p=api.packSurfacePrimitives([], [{center:[2,3,4],radius:.5,materialIndex:2}]);assert.equal(p.sphereCount,1);assert.equal(p.triangleCount,0);assert.deepEqual(Array.from(p.nodes.slice(0,3)),[1.5,2.5,3.5]);assert.deepEqual(Array.from(p.nodes.slice(4,7)),[2.5,3.5,4.5]);assert.deepEqual(Array.from(p.triangles.slice(0,8)),[2,3,4,2,.5,0,0,1]);assert.throws(()=>api.packSurfacePrimitives([], [{center:[0,0,0],radius:-1}]),/sphere/i);});
