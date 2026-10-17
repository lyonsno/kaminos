// kaminos-test: node
// The browser finisher's simplifier runs as Wasm where the engine fuses
// relaxed-SIMD multiply-adds, with output equal to the native wheel (the
// recorded source fixtures), and otherwise keeps the JS port. Either way the
// receipt names the simplifier that actually ran.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cleanupAndSimplifyPreservingSurface,createBrowserMeshPostprocess} from '../mesh-cleanup.js';
import {simplifyMesh} from '../mesh-simplify.js';
import {loadSimplifier,probeRelaxedFma,wasmSimplifierEngine,WASM_SIMPLIFY_ROUTE,JS_SIMPLIFY_ROUTE} from '../wasm-simplify.js';
import factory from '../vendor/fast-simplification/fast-simplification-0.2.0.mjs';
import {NodeTrellisUVWorker as NodeModuleWorker} from '../node-uv-worker.mjs';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/mesh-finishing-source.json',import.meta.url)));
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');

const probe=probeRelaxedFma();
assert.equal(typeof probe.fused,'boolean');
const auto=await loadSimplifier();
assert.equal(auto.route,probe.fused?WASM_SIMPLIFY_ROUTE:JS_SIMPLIFY_ROUTE,'auto selects Wasm exactly when the engine fuses');
assert.equal(auto.engine===null,!probe.fused);
const js=await loadSimplifier({prefer:'js'});
assert.equal(js.engine,null);assert.equal(js.route,JS_SIMPLIFY_ROUTE);
assert.throws(()=>loadSimplifier({prefer:'native'}),/auto|js/);

if(auto.engine){
  // Count calls so a path that silently runs the JS port cannot pass as Wasm.
  let calls=0;const engine=(...args)=>{calls++;return auto.engine(...args);};
  // Wasm equals the native wheel: first simplify pass and the whole finisher, on every recorded fixture.
  for(const [name,spec] of Object.entries(MESH_FINISHING_CASES)){
    const expected=fixture.cases[name],{vertices,triangles}=spec.build();
    if(expected.simplifyPass0){
      const first=simplifyMesh(vertices,triangles,{targetReduction:expected.simplifyPass0.targetReduction,engine});
      assert.equal(sha(first.points),expected.simplifyPass0.pointsSha256,name+': Wasm simplifier positions must equal the native wheel');
      assert.equal(sha(first.triangles),expected.simplifyPass0.trianglesSha256,name+': Wasm simplifier collapses must equal the native wheel');
    }
    const result=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:expected.targetFaces,simplifier:engine});
    assert.equal(sha(result.vertices),expected.output.verticesSha256,name+': Wasm finisher positions must equal the source finisher');
    assert.equal(sha(result.faces),expected.output.trianglesSha256,name+': Wasm finisher triangles must equal the source finisher');
  }
  assert.ok(calls>0,'the Wasm engine actually ran');calls=0;
  // Iteration progress still arrives from the Wasm loop.
  const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build(),seen=[];
  simplifyMesh(vertices,triangles,{targetCount:spec.targetFaces,engine,onIteration:(i,f)=>seen.push([i,f])});
  assert.equal(calls,1,'iteration events came from the Wasm run');
  assert.ok(seen.length>0&&seen[0][0]===0&&seen[0][1]===triangles.length/3,'Wasm reports iteration 0 with the input face count');
  // Addresses above 2 GiB (a multi-million-face surface reaches them) must still
  // index the right heap bytes: Wasm pointers are unsigned.
  {const M=await factory(),pad=M._malloc(2**31);
    assert.ok(pad>0,'reserve 2 GiB so later buffers sit above the signed range');
    const e=fixture.cases['simplify-route'],high=wasmSimplifierEngine(M);
    const first=simplifyMesh(vertices,triangles,{targetReduction:e.simplifyPass0.targetReduction,engine:high});
    assert.equal(sha(first.points),e.simplifyPass0.pointsSha256,'positions read back correctly from above 2 GiB');
    assert.equal(sha(first.triangles),e.simplifyPass0.trianglesSha256,'triangles read back correctly from above 2 GiB');}
}

// The provider records the simplifier that ran, on the calling thread and in the worker.
const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build(),want=fixture.cases['simplify-route'].output;
for(const [label,WorkerClass] of [['caller-thread',undefined],['module-worker',NodeModuleWorker]]){
  for(const simplifier of ['auto','js']){
    const out=await createBrowserMeshPostprocess({targetFaces:spec.targetFaces,WorkerClass,simplifier})({vertices,triangles,metadata:{}});
    const r=out.metadata.postprocess.simplifier;
    assert.equal(r.route,simplifier==='js'||!probe.fused?JS_SIMPLIFY_ROUTE:WASM_SIMPLIFY_ROUTE,`${label} ${simplifier}: receipt names the simplifier that ran`);
    assert.equal(sha(out.triangles),want.trianglesSha256,`${label} ${simplifier}: finished bytes equal the source finisher`);
    assert.equal(sha(out.vertices),want.verticesSha256,`${label} ${simplifier}: finished positions equal the source finisher`);
  }
}
assert.throws(()=>createBrowserMeshPostprocess({targetFaces:10,simplifier:'fast'}),/simplifier/);
