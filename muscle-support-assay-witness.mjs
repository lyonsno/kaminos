import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export function validateSupportSnapshot(state) {
  assert.equal(state?.schema,'kaminos-muscle-support-assay-v1','wrong or missing assay schema');
  assert.equal(state.status,'loaded','assay did not load');
  assert.equal(state.effectiveRoute,'dedicated-kaminos-procedural-assay','wrong effective assay route');
  assert.equal(state.rendererBackend,'WebGPUBackend','requested WebGPU route was not effective');
  assert.equal(state.registeredObjects.length,3,'missing registered comparison views');
  assert.equal(new Set(state.registeredObjects.map(row=>row.id)).size,3,'duplicate view registration');
  assert.equal(state.selectedBone,'fixture-hinge-bone','gizmo is not attached to the actual hinge bone');
  assert.equal(state.metrics.length,3,'partial comparison metrics');
  const count=state.fixture.vertices;
  assert.ok(Number.isInteger(count)&&count>0,'missing geometry');
  for(const sample of state.samples){
    assert.equal(sample.positions.length,3,'partial comparison sample');
    for(const positions of sample.positions){assert.equal(positions.length,count*3,'partial skin sample');assert.ok(positions.every(Number.isFinite),'invalid skin sample');}
  }
  return state;
}
export async function runSupportAssayWitness({evaluate,capture,ws,out,delay}) {
  let state;
  for(let i=0;i<100;i++){
    state=await evaluate(ws,'window.kaminosSupportAssay?.snapshot() ?? window.kaminosSupportAssayFailure ?? null');
    if(state?.status==='loaded')break;
    if(state?.message)throw new Error(state.message);
    await delay(100);
  }
  validateSupportSnapshot(state);
  const before=await capture(ws,out.replace(/\.png$/,'-neutral.png'));
  await evaluate(ws,'document.querySelector("#bulge").click(); true');
  await delay(250);
  const bulge=validateSupportSnapshot(await evaluate(ws,'window.kaminosSupportAssay.snapshot()'));
  assert.equal(bulge.pose.bulge,0.35,'bulge button did not reach its requested input');
  const bulgeShot=await capture(ws,out.replace(/\.png$/,'-bulge.png'));
  await evaluate(ws,'window.kaminosSupportAssay.reset(); window.kaminosSupportAssay.applyPose(window.kaminosSupportAssay.cyclePose(0.5)); true');
  await delay(250);
  const bent=validateSupportSnapshot(await evaluate(ws,'window.kaminosSupportAssay.snapshot()'));
  const bentShot=await capture(ws,out.replace(/\.png$/,'-bent.png'));
  await evaluate(ws,'window.kaminosSupportAssay.reset(); document.querySelector("#cycle").click(); true');
  for(let i=0;i<100;i++){
    const complete=await evaluate(ws,'window.kaminosSupportAssay.snapshot({includeSamples:false}).events.some(event=>event.type==="cycle-end")',{timeoutMs:45000});
    if(complete)break;
    await delay(100);
  }
  const evidence=JSON.parse(await evaluate(ws,'JSON.stringify(window.kaminosSupportAssay.exportEvidence())',{timeoutMs:45000}));
  validateSupportSnapshot(evidence.snapshot);
  assert.ok(evidence.snapshot.events.some(event=>event.type==='cycle-end'),'cycle did not finish');
  assert.ok(evidence.snapshot.samples.some(sample=>Math.abs(sample.pose.quaternion[2])>0.3),'no bent input retained');
  const rawPath=out.replace(/\.png$/,'-raw.json'),raw=JSON.stringify(evidence);
  writeFileSync(rawPath,raw);
  return {before,bulgeShot,bentShot,rawPath,rawSha256:createHash('sha256').update(raw).digest('hex'),
    route:evidence.snapshot.effectiveRoute,backend:evidence.snapshot.rendererBackend,
    registeredObjects:evidence.snapshot.registeredObjects,fixture:evidence.snapshot.fixture,
    bulgeMetrics:bulge.metrics,bentMetrics:bent.metrics,returnedMetrics:evidence.snapshot.metrics,
    samples:evidence.snapshot.samples.length,qualityVerdict:'unadjudicated; inspect motion and residuals'};
}
