// Replay retained observations without opening a browser or using the GPU.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {geometryBudget} from './geometry.mjs';
const [destination,...arms]=process.argv.slice(2);
assert.ok(destination&&arms.length,'usage: summarize.mjs OUTPUT_JSON ARM_DIRECTORY...');
const summary={claim:'preliminary representation counts and observed cadence; no GI quality or full GPU headroom conclusion',arms:[]};
for(const arm of arms){
 const r=JSON.parse(await fs.readFile(path.join(arm,'report.json'),'utf8'));
 assert.equal(r.status,'complete');assert.deepEqual(r.errors,[]);
 assert.equal(r.final.fire.backend,'WebGPU:apple');
 assert.equal(r.final.receiver.shadow.effective,true);
 assert.equal(r.final.fire.ordinarySceneDepth.effective,true);
 assert.ok(r.afterTiming.fire.simStepCount>r.beforeTiming.fire.simStepCount,'not live simulation');
 assert.equal(r.frameIntervalsMs.length,r.frames);
 assert.ok(r.frameIntervalsMs.every(n=>Number.isFinite(n)&&n>0));
 const raw=await fs.readFile(path.join(arm,'world-triangles.f32'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),r.geometry.positionsSha256);
 const geometry=geometryBudget(new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4),r.pitches);
 const a=r.frameIntervalsMs.toSorted((a,b)=>a-b),MiB=b=>b/1048576;
 summary.arms.push({arm,sceneSha256:r.sceneSha256,geometrySha256:r.geometry.positionsSha256,
  timestampInstrumentation:r.timing??'on',camera:r.loaded.camera,backend:r.final.fire.backend,
  intervals:{count:a.length,meanMs:a.reduce((s,v)=>s+v,0)/a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]},
  geometry:{triangles:geometry.triangles,area:geometry.area,bounds:geometry.bounds},
  estimates:geometry.rows.map(row=>({pitch:row.pitch,equalAreaSamples:row.areaQuota,
   denseSurfaceScalarMiB:MiB(row.denseAreaQuotaFloat32Bytes),uniformProbeCandidates:row.probeCandidates,
   assumed128DirectionSurfaceHitMiB:MiB(row.areaQuota*128*32),
   assumed128DirectionProbeHitMiB:MiB(row.probeCandidates*128*32),
   occupiedCentroidCells:row.occupiedCentroidCells,opposedNormalCells:row.cellsWithOpposingNormals})),
  gpuProfiles:r.gpuProfiles});
}
if(summary.arms.length>1){
 const base=summary.arms[0];
 for(const arm of summary.arms.slice(1)){assert.equal(arm.sceneSha256,base.sceneSha256);assert.equal(arm.geometrySha256,base.geometrySha256);assert.deepEqual(arm.camera,base.camera);}
 summary.comparison='same saved scene, world triangle bytes and camera; separate live fluid histories and uncontrolled shared workstation load';
}
await fs.writeFile(destination,JSON.stringify(summary,null,2));
console.log(JSON.stringify({output:destination,arms:summary.arms.length}));
