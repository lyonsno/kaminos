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
const expectedScene = {file:'refractory-kiln.kaminos.json',presetId:'vsp-kiln',modelSource:'/api/read?root=splat-extra-1&path=kiln.glb'};
const sceneEvidence = {routeSceneFile:expectedScene.file,runtimePresetId:expectedScene.presetId,
  runtimeModelSources:[expectedScene.modelSource],runtimeStatus:'Kiln captured study | blublazeeerrrr'};
assert.deepEqual(api.judgeSf3dSmoke({...good,sceneEvidence}, {expectedScene}), []);
for (const wrong of [
  null,
  {...sceneEvidence,routeSceneFile:'other.kaminos.json'},
  {...sceneEvidence,runtimePresetId:'vsp-default'},
  {...sceneEvidence,runtimeModelSources:['/api/read?root=splat-extra-1&path=other.glb']},
  {...sceneEvidence,runtimeStatus:'Restore failed: missing scene'},
]) {
  assert.notEqual(api.judgeSf3dSmoke({...good,sceneEvidence:wrong}, {expectedScene}).length,0,
    'full kiln smoke must reject missing, stale, default, or failed scene evidence');
}
const generatedSource = '/api/read?root=generated-meshes&path=chair.glb';
const reopenEvidence = {savedSceneFile:'kiln-with-chair.kaminos.json',savedSources:[expectedScene.modelSource,generatedSource],
  savedPresetId:expectedScene.presetId,reopenedSources:[expectedScene.modelSource,generatedSource],
  reopenedPresetId:expectedScene.presetId,reopenedStatus:'Kiln with chair | blublazeeerrrr',
  flameBefore:4,flameAfter:8,sourceUnchanged:true,
  originalPosition:[0,0,0],editedPosition:[0.25,0,0],reopenedPosition:[0.25,0,0]};
assert.deepEqual(api.judgeSf3dSmoke({...good,sceneEvidence,reopenEvidence}, {expectedScene,expectedReopen:{generatedSource}}), []);
for (const wrong of [
  null,
  {...reopenEvidence,savedSources:[expectedScene.modelSource]},
  {...reopenEvidence,reopenedSources:[expectedScene.modelSource]},
  {...reopenEvidence,reopenedPresetId:'vsp-default'},
  {...reopenEvidence,savedPresetId:'vsp-default',reopenedPresetId:'vsp-default'},
  {...reopenEvidence,reopenedStatus:'Restore failed: missing mesh'},
  {...reopenEvidence,flameAfter:4},
  {...reopenEvidence,sourceUnchanged:false},
  {...reopenEvidence,reopenedPosition:[0,0,0]},
]) assert.notEqual(api.judgeSf3dSmoke({...good,sceneEvidence,reopenEvidence:wrong}, {expectedScene,expectedReopen:{generatedSource}}).length,0,
  'save/reopen proof must reject missing, stale, default, failed, or frozen results');
const stableKilnSource = '/api/read?root=generated-meshes&path=stable-kiln.glb';
assert.notEqual(api.judgeSf3dSmoke({...good,sceneEvidence,reopenEvidence},
  {expectedScene,expectedReopen:{generatedSource,kilnSource:stableKilnSource}}).length,0,
  'a stable-source composition must not silently reuse the old kiln mount');
console.log('SF3D smoke rejects wrong route, frozen flame, absent output, and stale evidence');
