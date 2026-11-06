// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWasmXatlasUnwrapper} from '../models/trellis2/wasm-xatlas.js';
import {NodeTrellisUVWorker} from '../models/trellis2/node-uv-worker.mjs';
const observed=JSON.parse(readFileSync(new URL('./fixtures/trellis-original-reducer-metal.json',import.meta.url))).normals;
for(const WorkerClass of [undefined,NodeTrellisUVWorker])test('source original normals transfer before UV seams: '+(WorkerClass?'worker':'caller'),async()=>{
 const mesh={vertices:Float32Array.from(observed.vertices.flat()),triangles:Uint32Array.from(observed.faces.flat())};
 const out=await createWasmXatlasUnwrapper({WorkerClass,normalMode:'source-original'})(mesh);
 for(let i=0;i<mesh.triangles.length;i++)for(let a=0;a<3;a++){
  assert.equal(out.vertices[out.triangles[i]*3+a],mesh.vertices[mesh.triangles[i]*3+a]);
  assert.ok(Math.abs(out.normals[out.triangles[i]*3+a]-observed.normals[mesh.triangles[i]][a])<3e-6,`native pre-UV normal at corner ${i}, axis ${a}`);
 }
 assert.equal(out.uvMetadata.normalBasis.rule,'CuMesh area-weighted pre-UV');
});
test('an unknown normal law cannot silently select legacy post-UV normals',()=>{
 assert.throws(()=>createWasmXatlasUnwrapper({normalMode:'unknown-normal-law'}),/normal.*mode/i);
});
