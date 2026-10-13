// kaminos-test: node
// Browser mesh finishing must reproduce the accepted source finisher
// (postprocess-retained-mesh.py --cleanup-mode mlx-surface-preserving at the
// fixture's recorded source commit) exactly, then compose through the real
// finishTrellisMesh postprocess admission.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cleanupAndSimplifyPreservingSurface,createBrowserMeshPostprocess,MESH_POSTPROCESS_ROUTE} from '../mesh-cleanup.js';
import {fma,simplifyMesh} from '../mesh-simplify.js';
import {finishTrellisMesh} from '../trellis-material.js';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';
import {NodeTrellisUVWorker} from '../node-uv-worker.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/mesh-finishing-source.json',import.meta.url)));
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');

// Single-rounding multiply-add, as the native simplifier's contracted sites compute it.
for(const row of fixture.fma.cases){
  const [a,b,c,want]=row.map(h=>new Float64Array(new Uint8Array(Buffer.from(h,'hex')).buffer)[0]);
  assert.ok(Object.is(fma(a,b,c),want),`fma(${a},${b},${c}) must round once like std::fma`);
}

for(const [name,spec] of Object.entries(MESH_FINISHING_CASES)){
  const expected=fixture.cases[name],{vertices,triangles}=spec.build();
  assert.equal(sha(vertices),expected.input.verticesSha256,name+': generated input positions drifted from the recorded source input');
  assert.equal(sha(triangles),expected.input.trianglesSha256,name+': generated input triangles drifted from the recorded source input');
  if(expected.simplifyPass0){
    const first=simplifyMesh(vertices,triangles,{targetReduction:expected.simplifyPass0.targetReduction});
    assert.equal(sha(first.points),expected.simplifyPass0.pointsSha256,name+': F64 simplifier positions must equal the native wheel (contracted multiply-adds)');
    assert.equal(sha(first.triangles),expected.simplifyPass0.trianglesSha256,name+': simplifier collapses must equal the native wheel');
  }
  const result=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:expected.targetFaces});
  assert.equal(result.faces.length/3,expected.output.faces,name+': cleaned face count');
  assert.equal(result.vertices.length/3,expected.output.vertices,name+': cleaned vertex count');
  assert.equal(sha(result.vertices),expected.output.verticesSha256,name+': cleaned positions must equal the source finisher bytes');
  assert.equal(sha(result.faces),expected.output.trianglesSha256,name+': cleaned triangles (order and winding) must equal the source finisher bytes');
}

// Provider composes through the live finishing admission and carries its receipt.
const {vertices,triangles}=MESH_FINISHING_CASES['simplify-route'].build(),target=MESH_FINISHING_CASES['simplify-route'].targetFaces;
const provider=createBrowserMeshPostprocess({targetFaces:target});
const processed=await provider({vertices,triangles,metadata:{source:'fixture'}});
const receipt=processed.metadata.postprocess;
assert.equal(receipt.schema,'trellis2.mesh-postprocess.v0');
assert.equal(receipt.status,'succeeded');
assert.equal(receipt.effectiveRoute,MESH_POSTPROCESS_ROUTE);
assert.equal(receipt.modelCalls,0);
assert.equal(receipt.targetFaces,target);
assert.deepEqual([receipt.inputVertices,receipt.inputFaces,receipt.outputVertices,receipt.outputFaces],
  [vertices.length/3,triangles.length/3,processed.vertices.length/3,processed.triangles.length/3]);
assert.equal(processed.metadata.source,'fixture','provider keeps caller metadata');
assert.equal(sha(processed.triangles),fixture.cases['simplify-route'].output.trianglesSha256);
let unwrapInput;
const finished=await finishTrellisMesh({vertices,triangles,metadata:{}},{postprocessMesh:provider,textureSize:8,
  unwrapMesh:async mesh=>{unwrapInput=mesh;const n=mesh.vertices.length/3,uvs=new Float32Array(n*2);
    for(let i=0;i<n;i++){uvs[i*2]=(i%97)/97;uvs[i*2+1]=Math.floor(i/97)%97/97;}
    return {...mesh,uvs,normals:new Float32Array(n*3).fill(1/Math.sqrt(3)),uvMetadata:{route:'contract-test-grid'}};},
  materialFields:{features:new Float32Array(6),coordinates:new Int32Array(3),resolution:1}}).catch(error=>({error}));
assert.ok(unwrapInput,'finishing must hand the browser-cleaned surface to UV: '+(finished.error?.message??''));
assert.equal(sha(unwrapInput.triangles),fixture.cases['simplify-route'].output.trianglesSha256,'UV receives the cleaned triangles, not raw geometry');
assert.equal(unwrapInput.metadata.postprocess.effectiveRoute,MESH_POSTPROCESS_ROUTE);
assert.throws(()=>createBrowserMeshPostprocess({}),/targetFaces/);

// Off-thread execution returns the same bytes and leaves the caller's arrays attached.
const workerProvider=createBrowserMeshPostprocess({targetFaces:target,WorkerClass:NodeTrellisUVWorker});
const fromWorker=await workerProvider({vertices,triangles,metadata:{}});
assert.equal(fromWorker.metadata.postprocess.execution,'module-worker');
assert.equal(sha(fromWorker.vertices),fixture.cases['simplify-route'].output.verticesSha256,'worker positions must equal the source finisher bytes');
assert.equal(sha(fromWorker.triangles),fixture.cases['simplify-route'].output.trianglesSha256,'worker triangles must equal the source finisher bytes');
assert.equal(vertices.length,MESH_FINISHING_CASES['simplify-route'].build().vertices.length,'caller vertices stay attached');
const failing=createBrowserMeshPostprocess({targetFaces:target,WorkerClass:NodeTrellisUVWorker});
await assert.rejects(failing({vertices:new Float32Array(9),triangles:new Uint32Array([0,1,7]),metadata:{}}),/mesh finisher worker failed/);
