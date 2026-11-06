// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserMeshPostprocess} from '../models/trellis2/mesh-cleanup.js';
import {prefillRemeshHoles} from '../models/trellis2/original-remesh-prefill.js';
import {readFileSync} from 'node:fs';

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
