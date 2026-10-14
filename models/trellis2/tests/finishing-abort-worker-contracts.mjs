// kaminos-test: node
// The page's Stop reaches browser finishing: both providers take an AbortSignal,
// a worker-backed run is terminated and rejects with AbortError, an already
// aborted signal starts no work, and off-thread UV returns the same bytes as
// the calling thread.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cleanupAndSimplifyPreservingSurface,createBrowserMeshPostprocess} from '../mesh-cleanup.js';
import {createWasmXatlasUnwrapper} from '../wasm-xatlas.js';
import {NodeTrellisUVWorker} from '../node-uv-worker.mjs';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build();
const clean=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:spec.targetFaces});
const cleaned={vertices:clean.vertices,triangles:clean.faces,metadata:{source:'fixture'}};

// A worker that never answers, so only Stop can end the run.
let constructed=0,terminated=0;
class SilentWorker{constructor(){constructed++;}postMessage(){}terminate(){terminated++;}}
const isAbort=e=>e?.name==='AbortError';

for(const [name,make]of [
  ['cleanup',o=>createBrowserMeshPostprocess({targetFaces:spec.targetFaces,...o})],
  ['uv',o=>createWasmXatlasUnwrapper(o)]]){
  const input=name==='cleanup'?{vertices,triangles,metadata:{}}:cleaned;
  // Already aborted: refuse before any worker exists.
  constructed=0;
  await assert.rejects(make({WorkerClass:SilentWorker,signal:AbortSignal.abort()})(input),isAbort,name+': aborted signal must reject with AbortError');
  assert.equal(constructed,0,name+': no worker for an already-aborted run');
  await assert.rejects(make({signal:AbortSignal.abort()})(input),isAbort,name+': caller-thread path also honours an aborted signal');
  // Stop during a worker run terminates it and rejects promptly.
  constructed=0;terminated=0;
  const stop=new AbortController(),run=make({WorkerClass:SilentWorker,signal:stop.signal})(input);
  setTimeout(()=>stop.abort(),20);
  await assert.rejects(run,isAbort,name+': Stop must reject the running finish with AbortError');
  assert.equal(constructed,1);assert.equal(terminated,1,name+': Stop must terminate the worker');
  assert.throws(()=>make({signal:'stop'}),/AbortSignal/,name+': signal must be an AbortSignal');
}

// Off-thread UV equals the calling thread, and a late abort changes nothing.
const here=await createWasmXatlasUnwrapper()(cleaned);
const late=new AbortController();
const there=await createWasmXatlasUnwrapper({WorkerClass:NodeTrellisUVWorker,signal:late.signal})(cleaned);
late.abort();
for(const key of ['vertices','triangles','normals','uvs'])assert.equal(sha(there[key]),sha(here[key]),'worker UV '+key+' must equal the calling thread');
assert.equal(there.uvMetadata.execution,'module-worker');assert.equal(here.uvMetadata.execution,'caller-thread');
assert.equal(there.metadata.source,'fixture','caller metadata carried through the worker');
assert.equal(cleaned.vertices.length,clean.vertices.length,'caller arrays stay attached');
