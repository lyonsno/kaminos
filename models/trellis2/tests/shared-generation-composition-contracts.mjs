import assert from 'node:assert/strict';
import fs from 'node:fs';
const file=new URL('../shared-generation-smoke.js',import.meta.url);
assert.ok(fs.existsSync(file),'full generation must have an actual authored-scene composition entry');
const {judgeTrellisSharedComposition}=await import(file);
const state={sameDevice:true,result:{status:'succeeded',deviceTopology:'same-device',
  sharedRelease:{status:'released',gpuSettled:true,foreground:{receipts:[
    {status:'completed',runId:'actual',phase:'model-phase',submissionCount:1,result:{renderer:'ordinary-volume',status:'submitted'}},
  ]}}},before:{frameCount:2,simStepCount:3},after:{frameCount:4,simStepCount:5},
  afterRelease:{frameCount:6},presentation:{status:'registered',objectId:'new',sha256:'a'.repeat(64),runId:'actual'},
  asset:{sha256:'a'.repeat(64),byteLength:100},runId:'actual'};
assert.deepEqual(judgeTrellisSharedComposition(state),[]);
for(const alter of [
  s=>s.sameDevice=false,s=>s.result.status='failed',s=>s.result.deviceTopology='isolated-device',
  s=>s.result.sharedRelease.gpuSettled=false,s=>s.result.sharedRelease.foreground.receipts[0].phase='foreground-run-finish',
  s=>s.result.sharedRelease.foreground.receipts[0].runId='stale',s=>s.after.simStepCount=3,
  s=>s.afterRelease.frameCount=4,s=>s.presentation.sha256='b'.repeat(64),s=>s.presentation.status='cached',
]){
  const s=structuredClone(state);alter(s);assert.ok(judgeTrellisSharedComposition(s).length,'wrong/failed/stale/finish-only evidence must reject');
}
console.log('Shared composition verdict rejects isolated, failed, stale, settlement-only and absent presentation evidence; synthetic state is not native generation.');
