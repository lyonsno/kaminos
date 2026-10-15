// kaminos-test: node
// The page can see where browser cleanup is: the provider reports entry, each
// simplify iteration, each cleanup step and each trace pass as they happen,
// from the shipped module worker and on the calling thread alike, without
// changing the finished bytes or the receipt trace.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBrowserMeshPostprocess} from '../mesh-cleanup.js';
import {NodeTrellisUVWorker as NodeModuleWorker} from '../node-uv-worker.mjs';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
for(const name of ['simplify-route','below-target']){
  const spec=MESH_FINISHING_CASES[name],{vertices,triangles}=spec.build();
  const plain=await createBrowserMeshPostprocess({targetFaces:spec.targetFaces})({vertices,triangles,metadata:{}});
  for(const [route,WorkerClass] of [['caller-thread',undefined],['module-worker',NodeModuleWorker]]){
    const events=[];
    const out=await createBrowserMeshPostprocess({targetFaces:spec.targetFaces,WorkerClass,onProgress:e=>events.push(e)})({vertices,triangles,metadata:{}});
    const label=`${name} ${route}`;
    assert.ok(events.length,`${label}: progress events expected`);
    assert.deepEqual(events[0],{kind:'entered',inputVertices:vertices.length/3,inputFaces:triangles.length/3,elapsedSeconds:events[0].elapsedSeconds},`${label}: entry first`);
    for(const e of events){assert.ok(Number.isFinite(e.elapsedSeconds)&&e.elapsedSeconds>=0,`${label}: elapsedSeconds`);
      assert.ok(['entered','simplify-iteration','cleanup-step','pass'].includes(e.kind),`${label}: kind ${e.kind}`);}
    // The pass events are the receipt trace, in order, as it is built.
    const trace=out.metadata.postprocess.operationTrace;
    assert.deepEqual(events.filter(e=>e.kind==='pass').map(({kind,elapsedSeconds,...row})=>row),trace,`${label}: pass events equal the trace`);
    assert.deepEqual(trace,plain.metadata.postprocess.operationTrace,`${label}: trace unchanged by observation`);
    const steps=events.filter(e=>e.kind==='cleanup-step');
    assert.ok(steps.some(e=>e.step==='fill_small_holes')&&steps.every(e=>Number.isSafeInteger(e.faces)),`${label}: cleanup steps with face counts`);
    if(name==='simplify-route')assert.ok(events.some(e=>e.kind==='simplify-iteration'&&Number.isSafeInteger(e.iteration)&&Number.isSafeInteger(e.faces)),`${label}: simplify iterations`);
    for(let i=1;i<events.length;i++)assert.ok(events[i].elapsedSeconds>=events[i-1].elapsedSeconds,`${label}: monotonic time`);
    for(const key of ['vertices','triangles'])assert.equal(sha(out[key]),sha(plain[key]),`${label}: ${key} unchanged by observation`);
  }
}
assert.throws(()=>createBrowserMeshPostprocess({targetFaces:10,onProgress:'log'}),/onProgress/,'onProgress must be a function');
// An observer that throws must not corrupt or stall the run.
{const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build();
  const out=await createBrowserMeshPostprocess({targetFaces:spec.targetFaces,WorkerClass:NodeModuleWorker,onProgress:()=>{throw Error('observer');}})({vertices,triangles,metadata:{}});
  assert.equal(out.metadata.postprocess.status,'succeeded');}
