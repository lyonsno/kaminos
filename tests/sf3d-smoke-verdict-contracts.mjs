import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as api from '../sf3d-host-device.mjs';
assert.equal(typeof api.judgeSf3dSmoke, 'function');
// Observed SF3D 0ff8dc4 bridge/kit receipt rows; CPU queue stub, not GPU evidence.
const observed = JSON.parse(readFileSync(new URL('./fixtures/sf3d-foreground-bridge-receipts.json', import.meta.url)));
const good = {deviceTopology:'same-device',foregroundScheduling:'producer-foreground-opportunities',receiptValidation:{ok:true},
  presentation:{status:'registered',objectId:'mesh-1',source:'/api/read?root=generated-meshes&path=mesh.glb',sha256:'hash',runId:'contract-replay'},
  glbBytes:100,glbSha256:'hash',runId:'contract-replay',flameProgress:{before:{frameCount:1,simStepCount:1},after:{frameCount:4,simStepCount:4}},
  foregroundFrames:observed.rows};
assert.deepEqual(api.judgeSf3dSmoke(good),[]);
for (const [key,value] of Object.entries({deviceTopology:'two-devices',foregroundScheduling:'independent-render-loops',receiptValidation:{ok:false},presentation:null,glbBytes:0,foregroundFrames:[],flameProgress:{before:{frameCount:1,simStepCount:1},after:{frameCount:1,simStepCount:1}}})) {
  assert.notEqual(api.judgeSf3dSmoke({...good,[key]:value}).length,0,key);
}
assert.notEqual(api.judgeSf3dSmoke({...good,runId:'stale'}).length,0);
assert.notEqual(api.judgeSf3dSmoke({...good,foregroundFrames:good.foregroundFrames.map(r=>({...r,result:{...r.result,renderer:'smoke-raymarch-under-splats'}}))}).length,0);
for (const submissions of [[], [{submissionStatus:'queue-submit-threw',commandBufferCount:1}]]) {
  assert.notEqual(api.judgeSf3dSmoke({...good,foregroundFrames:good.foregroundFrames.map(r=>({...r,submissionCount:submissions.length,submissions}))}).length,0);
}
console.log('SF3D smoke rejects wrong route, frozen flame, absent output, and stale evidence');
