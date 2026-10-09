import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as evidence from '../structural-material-shard-release-evidence.mjs';
const report=process.argv[2];
assert.ok(report,'Observed native camera report required');
const sample=JSON.parse(fs.readFileSync(report,'utf8')).cameraInterval;
assert.equal(typeof evidence.inspectCameraPresentation,'function','Camera admission must compare semantic camera values');
assert.deepEqual(evidence.inspectCameraPresentation(sample),[]);
for(const mutate of [s=>s.completed=true,s=>s.presentation.materialBusy=false,s=>s.presentation.frame=s.beforeFrame,s=>s.presentation.camera.position[0]+=.01,s=>s.presentation.camera.position[0]=NaN,s=>s.presentation.camera.fov+=1]){
 const bad=structuredClone(sample);mutate(bad);assert.ok(evidence.inspectCameraPresentation(bad).length);
}
assert.ok(evidence.inspectCameraPresentation(null).length);
console.log('Observed native camera roundoff accepted; absent, late, idle and different camera frames rejected.');
