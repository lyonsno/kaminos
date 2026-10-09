import assert from 'node:assert/strict';
import fs from 'node:fs';
const file=new URL('../shared-generation-smoke.js',import.meta.url);
assert.ok(fs.existsSync(file),'full generation must have an actual authored-scene composition entry');
const {judgeTrellisSharedComposition}=await import(file);
const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/shared-foreground-receipts.json',import.meta.url)));
const during=observed.receipts.find(r=>r.boundary.phase!=='foreground-run-finish');
const finishOnly=observed.receipts.find(r=>r.boundary.phase==='foreground-run-finish');
const state={sameDevice:true,result:{status:'succeeded',deviceTopology:'same-device',
  jobCompletion:{jobId:during.boundary.invocationId},
  sharedRelease:{status:'released',gpuSettled:true,foreground:{receipts:[during]}}},
  before:{frameCount:2,simStepCount:3},after:{frameCount:4,simStepCount:5},
  afterRelease:{frameCount:6},presentation:{status:'registered',objectId:'new',sha256:'a'.repeat(64),runId:'actual'},
  asset:{sha256:'a'.repeat(64),byteLength:100},runId:during.runId};
state.presentation.runId=state.runId;
assert.deepEqual(judgeTrellisSharedComposition(state),[]);
for(const alter of [
  s=>s.sameDevice=false,s=>s.result.status='failed',s=>s.result.deviceTopology='isolated-device',
  s=>s.result.sharedRelease.gpuSettled=false,s=>s.result.sharedRelease.foreground.receipts=[finishOnly],
  s=>s.result.sharedRelease.foreground.receipts[0].boundary={},
  s=>s.result.sharedRelease.foreground.receipts[0].boundary.invocationId='independent-post-model-readback',
  s=>s.result.sharedRelease.foreground.receipts[0].runId='stale',s=>s.after.simStepCount=3,
  s=>s.afterRelease.frameCount=4,s=>s.presentation.sha256='b'.repeat(64),s=>s.presentation.status='cached',
]){
  const s=structuredClone(state);alter(s);assert.ok(judgeTrellisSharedComposition(s).length,'wrong/failed/stale/finish-only evidence must reject');
}
console.log('Shared composition verdict rejects isolated, failed, stale, settlement-only and absent presentation evidence; synthetic state is not native generation.');

// Observed preset-loader rewriting removes unrelated fragment parameters.
// The module query itself survives because it is the import's identity.
const mounted=await import(new URL('../shared-generation-smoke.js?manifest_sha='+'a'.repeat(64),import.meta.url));
globalThis.window={location:{hash:'#composition_module_url=%2Fmodels%2Ftrellis2%2Fshared-generation-smoke.js'},
  kaminosSceneObjectDebugState:()=>[]};
const stopped=await mounted.mountComposition({sharedGpu:{},host:{},
  prototype:{debugState:()=>({error:'controlled scene admission refusal'}),foregroundGpuContext:()=>({active:false})}});
assert.equal(stopped.error.message,'authored kiln/ordinary renderer failed',
  'import-owned manifest query must survive the observed redirect instead of relying on unrelated page fragment parameters');
delete globalThis.window;
