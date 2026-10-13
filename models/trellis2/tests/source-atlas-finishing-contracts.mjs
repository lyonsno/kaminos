import assert from 'node:assert/strict';
import {test} from 'node:test';
import {finishTrellisMesh} from '../trellis-material.js';
const mesh={vertices:new Float32Array([-.25,-.25,0,.25,-.25,0,0,.25,0]),triangles:new Uint32Array([0,1,2])};
const materialFields={features:new Float32Array(6),coordinates:new Int32Array([0,0,0]),resolution:2};
class ForbiddenWorker{constructor(){throw Error('explicit source atlas was ignored for a different UV route');}}
const atlas=()=>({...mesh,normals:new Float32Array([0,0,1,0,0,1,0,0,1]),
  uvs:new Float32Array([0,0,1,0,0,1]),uvMetadata:{route:'synthetic-source-atlas-policy-test'}});
test('explicit atlas provider reaches the actual material/GLB consumer without worker fallback',async()=>{
  let called=0;
  const result=await finishTrellisMesh(mesh,{materialFields,textureSize:4,WorkerClass:ForbiddenWorker,
    unwrapMesh:async input=>{called++;assert.deepEqual(input.vertices,mesh.vertices);return atlas();}});
  assert.equal(called,1);assert.ok(result.glb.byteLength>0);
  assert.equal(result.mesh.uvMetadata.route,'synthetic-source-atlas-policy-test');
});
test('failed, partial, changed, or collapsed atlas cannot become a finished GLB',async()=>{
  for(const unwrapMesh of [async()=>{throw Error('atlas backend failed');},
    async()=>({...atlas(),normals:new Float32Array(1)}),
    async()=>({...atlas(),vertices:new Float32Array([1,1,1,1,1,1,1,1,1])}),
    async()=>({...atlas(),uvs:new Float32Array(6)}),async()=>({...atlas(),uvMetadata:undefined})])
    await assert.rejects(finishTrellisMesh(mesh,{materialFields,textureSize:4,WorkerClass:ForbiddenWorker,unwrapMesh}),
      /atlas backend failed|normal|geometry|collapsed UV|route receipt/);
});
