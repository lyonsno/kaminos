import assert from 'node:assert/strict';
import {writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const modes=['transport-field','bone-blend','field-only'];
function validateMetrics(metrics){
  assert.equal(metrics.length,3,'partial comparison metrics');
  assert.deepEqual(metrics.map(row=>row.mode),modes,'wrong comparison metric modes');
  for(const row of metrics)for(const key of ['steps','fieldErrorMax','fieldErrorMean','edgeRatioMin','edgeRatioMax','displacementRms','displacementMax'])assert.ok(Number.isFinite(row[key]),`missing finite metric ${key}`);
}
export function validateSupportSnapshot(state,{geometry=true}={}) {
  assert.equal(state?.schema,'kaminos-muscle-support-assay-v1','wrong or missing assay schema');
  assert.equal(state.status,'loaded','assay did not load');
  assert.equal(state.effectiveRoute,'dedicated-kaminos-procedural-assay','wrong effective assay route');
  assert.equal(state.rendererBackend,'WebGPUBackend','requested WebGPU route was not effective');
  assert.equal(state.registeredObjects.length,3,'missing registered comparison views');
  assert.equal(new Set(state.registeredObjects.map(row=>row.id)).size,3,'duplicate view registration');
  assert.deepEqual(state.registeredObjects.map(row=>row.mode),modes,'wrong comparison view modes');
  assert.equal(state.selectedBone,'fixture-hinge-bone','gizmo is not attached to the actual hinge bone');
  validateMetrics(state.metrics);
  const count=state.fixture.vertices;
  assert.ok(Number.isInteger(count)&&count>0,'missing geometry');
  assert.ok(Number.isInteger(state.sampleCount)&&state.sampleCount>0,'missing retained sample count');
  if(geometry){assert.ok(state.samples.length>0,'missing geometry samples');assert.equal(state.samples.length,state.sampleCount,'sample count mismatch');}
  for(const sample of state.samples){
    validateMetrics(sample.metrics);
    assert.equal(sample.positions.length,3,'partial comparison sample');
    for(const positions of sample.positions){assert.equal(positions.length,count*3,'partial skin sample');assert.ok(positions.every(Number.isFinite),'invalid skin sample');}
  }
  return state;
}
export function validateCycle(state,cycleId){
  const start=state.events.find(event=>event.type==='cycle-start'&&event.cycleId===cycleId);
  const end=state.events.find(event=>event.type==='cycle-end'&&event.cycleId===cycleId);
  assert.ok(start&&end,'requested cycle did not finish');
  assert.equal(end.startSampleIndex,start.sampleIndex,'wrong cycle start');
  assert.equal(end.endSampleIndex-start.sampleIndex,start.inputSteps,'incomplete requested cycle');
  const samples=state.samples.slice(start.sampleIndex,end.endSampleIndex);
  assert.equal(samples.length,start.inputSteps,'missing requested cycle samples');
  assert.ok(samples.every(sample=>sample.cycleId===cycleId),'stale or foreign cycle sample');
  assert.ok(samples.some(sample=>Math.abs(sample.pose.quaternion[2])>0.3),'no bent input in requested cycle');
  assert.ok(Math.abs(samples.at(-1).pose.quaternion[2])<1e-12,'requested cycle did not return');
}
export async function runSupportAssayWitness({evaluate,capture,ws,out,delay,progress=()=>{}}) {
  progress({stage:'loading'});
  const stagesPath=out.replace(/\.png$/,'-stages.jsonl');
  const preserve=(stage,snapshot)=>appendFileSync(stagesPath,JSON.stringify({stage,snapshot})+'\n');
  let state;
  for(let i=0;i<100;i++){
    state=await evaluate(ws,'window.kaminosSupportAssay?.snapshot() ?? window.kaminosSupportAssayFailure ?? null');
    if(state?.status==='loaded')break;
    if(state?.message)throw new Error(state.message);
    await delay(100);
  }
  validateSupportSnapshot(state);
  preserve('neutral',state);
  progress({stage:'neutral-capture',backend:state.rendererBackend});
  const before=await capture(ws,out.replace(/\.png$/,'-neutral.png'));
  await evaluate(ws,'document.querySelector("#bulge").click(); true');
  await delay(250);
  const bulge=validateSupportSnapshot(await evaluate(ws,'window.kaminosSupportAssay.snapshot()'));
  preserve('bulge',bulge);
  assert.equal(bulge.pose.bulge,0.35,'bulge button did not reach its requested input');
  const bulgeShot=await capture(ws,out.replace(/\.png$/,'-bulge.png'));
  progress({stage:'bent-input',bulgeMetrics:bulge.metrics});
  await evaluate(ws,'window.kaminosSupportAssay.reset(); window.kaminosSupportAssay.applyPose(window.kaminosSupportAssay.cyclePose(0.5)); true');
  await delay(250);
  const bent=validateSupportSnapshot(await evaluate(ws,'window.kaminosSupportAssay.snapshot()'));
  preserve('bent',bent);
  const bentShot=await capture(ws,out.replace(/\.png$/,'-bent.png'));
  progress({stage:'cycle-click',bentMetrics:bent.metrics});
  await evaluate(ws,'window.kaminosSupportAssay.reset(); document.querySelector("#cycle").click(); true');
  const cycleId=await evaluate(ws,'window.kaminosSupportAssay.snapshot({includeSamples:false}).events.filter(event=>event.type==="cycle-start").at(-1).cycleId');
  appendFileSync(stagesPath,JSON.stringify({stage:'cycle-request',cycleId})+'\n');
  progress({stage:'waiting-cycle'});
  for(let i=0;i<100;i++){
    const complete=await evaluate(ws,`window.kaminosSupportAssay.snapshot({includeSamples:false}).events.some(event=>event.type==="cycle-end" && event.cycleId===${JSON.stringify(cycleId)})`,{timeoutMs:45000});
    if(complete)break;
    await delay(100);
  }
  progress({stage:'raw-export'});
  const evidence=JSON.parse(await evaluate(ws,'JSON.stringify(window.kaminosSupportAssay.exportHeader())',{timeoutMs:45000}));
  validateSupportSnapshot(evidence.snapshot,{geometry:false});
  preserve('cycle-header',evidence.snapshot);
  const samplePath=out.replace(/\.png$/,'-samples.jsonl');
  for(let index=0;index<evidence.snapshot.sampleCount;index++){
    const sample=JSON.parse(await evaluate(ws,`JSON.stringify(window.kaminosSupportAssay.exportSample(${index}))`,{timeoutMs:45000}));
    appendFileSync(samplePath,JSON.stringify({index,sample})+'\n');
    evidence.snapshot.samples.push(sample);
    progress({stage:'raw-export',sample:index,retained:evidence.snapshot.sampleCount,samplePath,stagesPath});
  }
  validateSupportSnapshot(evidence.snapshot);
  validateCycle(evidence.snapshot,cycleId);
  const rawPath=out.replace(/\.png$/,'-raw.json'),raw=JSON.stringify(evidence);
  writeFileSync(rawPath,raw);
  progress({stage:'raw-preserved',rawPath});
  return {before,bulgeShot,bentShot,rawPath,stagesPath,samplePath,cycleId,rawSha256:createHash('sha256').update(raw).digest('hex'),
    route:evidence.snapshot.effectiveRoute,backend:evidence.snapshot.rendererBackend,
    registeredObjects:evidence.snapshot.registeredObjects,fixture:evidence.snapshot.fixture,
    bulgeMetrics:bulge.metrics,bentMetrics:bent.metrics,returnedMetrics:evidence.snapshot.metrics,
    samples:evidence.snapshot.samples.length,qualityVerdict:'unadjudicated; inspect motion and residuals'};
}
