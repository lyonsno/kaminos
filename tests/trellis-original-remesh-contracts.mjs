// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserMeshPostprocess} from '../models/trellis2/mesh-cleanup.js';
import {prefillRemeshHoles} from '../models/trellis2/original-remesh-prefill.js';
import {readFileSync} from 'node:fs';
import {NodeTrellisUVWorker} from '../models/trellis2/node-uv-worker.mjs';

test('an explicit source remesh request cannot silently become simplify-first without an app device',()=>{
  assert.throws(()=>createBrowserMeshPostprocess({targetFaces:2000,mode:'original-remesh'}),/original remesh.*GPU device/i);
});
test('unknown finishing selection is refused instead of changing the algorithm',()=>{
  assert.throws(()=>createBrowserMeshPostprocess({targetFaces:2000,mode:'unknown-remesh'}),/finishing mode/i);
});
test('prefill fan agrees with the observed native Metal edge orientation',()=>{
  const observed=JSON.parse(readFileSync(new URL('./fixtures/trellis-original-remesh-metal.json',import.meta.url))).prefill;
  const out=prefillRemeshHoles(Float32Array.from(observed.inputVertices.flat()),Uint32Array.from(observed.inputTriangles.flat()));
  assert.deepEqual([...out.vertices],observed.outputVertices.flat());
  assert.deepEqual([...out.triangles],observed.outputTriangles.flat());
});

const junctions=JSON.parse(readFileSync(new URL('./fixtures/trellis-original-remesh-prefill-metal.json',import.meta.url)));
for(const observed of junctions.cases)test('native boundary component contract: '+observed.name,()=>{
  const out=prefillRemeshHoles(Float32Array.from(observed.inputVertices.flat()),Uint32Array.from(observed.inputTriangles.flat()),observed.maxPerimeter);
  assert.deepEqual([...out.vertices],observed.outputVertices.flat());
  assert.deepEqual([...out.triangles],observed.outputTriangles.flat());
});

test('shipped prefill worker preserves each observed complete native surface',async()=>{
  for(const observed of junctions.cases){
    const worker=new NodeTrellisUVWorker(new URL('../models/trellis2/original-remesh-worker.js',import.meta.url));
    try{
      const output=await new Promise((resolve,reject)=>{
        worker.onmessage=({data})=>data.id===1&&data.ok===true?resolve(data):reject(Error(data.error??'worker identity mismatch'));
        worker.onerror=event=>reject(Error(event.message));worker.onmessageerror=()=>reject(Error('worker decoding failed'));
        worker.postMessage({id:1,operation:'initialize',settings:{resolution:8},vertices:Float32Array.from(observed.inputVertices.flat()).buffer,triangles:Uint32Array.from(observed.inputTriangles.flat()).buffer});
      });
      assert.deepEqual([...new Float32Array(output.vertices)],observed.outputVertices.flat(),observed.name);
      assert.deepEqual([...new Uint32Array(output.triangles)],observed.outputTriangles.flat(),observed.name);
    }finally{await worker.terminate();}
  }
});
