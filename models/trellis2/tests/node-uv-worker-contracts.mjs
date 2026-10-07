import assert from 'node:assert/strict';
import {unwrapTrellisMesh} from '../trellis-material.js';
import {NodeTrellisUVWorker} from '../node-uv-worker.mjs';
const mesh={vertices:new Float32Array([-.25,-.25,-.25,-.25,-.25,.25,-.25,.25,.25,-.25,.25,-.25]),
  triangles:new Uint32Array([0,1,3,3,1,2])};
const before=mesh.vertices.slice();
const result=await unwrapTrellisMesh(mesh,{WorkerClass:NodeTrellisUVWorker});
assert.deepEqual(mesh.vertices,before);
assert.equal(result.triangles.length,mesh.triangles.length);
for(let i=0;i<mesh.triangles.length;i++)for(let a=0;a<3;a++)
  assert.equal(result.vertices[result.triangles[i]*3+a],mesh.vertices[mesh.triangles[i]*3+a]);
assert.ok(result.uvs.every(Number.isFinite));
console.log('Actual shipped UV worker executes in an owned Node thread and preserves complete triangle positions.');
