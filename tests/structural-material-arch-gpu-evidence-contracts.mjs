import assert from 'node:assert/strict';
import * as evidence from '../structural-material-arch-gpu-evidence.mjs';
import { inspectGpuConformance, conformanceChecks } from '../structural-material-arch-gpu-evidence.mjs';

const valid = { status:'passed', phase:'complete', identity:{ backend:'webgpu', adapterFallback:false, description:'Apple M4', engineRevision:'96b043c88dc2a4af5367820caf1e1e9f458d5560' },
  checks:conformanceChecks.map(name=>({name,passed:true})), errors:[], samples:{'half-second':{bodies:[{}]},'three-seconds':{bodies:[{}]},weightForce:19.62} };
for (const patch of [{identity:null},{status:'running'},{phase:'adapter'},{checks:[]},{errors:['validation']},{samples:{}},
  {identity:{...valid.identity,backend:'webgl'}},{identity:{...valid.identity,adapterFallback:true}},
  {identity:{...valid.identity,description:'SwiftShader'}},{identity:{...valid.identity,engineRevision:'old'}}]) {
  assert.ok(inspectGpuConformance({...valid,...patch}).length>0, `must reject ${JSON.stringify(patch)}`);
}
assert.deepEqual(inspectGpuConformance({...valid, additiveField:'compatible'}), []);
console.log('GPU evidence rejects incomplete, fallback and stale engine reports');

assert.equal(typeof evidence.inspectGpuArchRendererLifetime, 'function', 'Reset evidence must reject missing or accumulating renderer registrations');
const lifetime = { source: 'three-0.183.0-renderer-compute-cache', computePipelines: 23, computePrograms: 23 };
for (const patch of [null, {}, { ...lifetime, source: 'projection' }, { ...lifetime, computePipelines: 46 },
  { ...lifetime, computePrograms: 46 }, { ...lifetime, computePipelines: 0 }, { ...lifetime, computePrograms: '23' }]) {
  assert.ok(evidence.inspectGpuArchRendererLifetime(patch, lifetime).length > 0);
  assert.ok(evidence.inspectGpuArchRendererLifetime(lifetime, patch).length > 0);
}
assert.deepEqual(evidence.inspectGpuArchRendererLifetime({ ...lifetime, additiveField: true }, lifetime), []);
