import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

export function validateHindquarterState(state,expected){
  assert.equal(state?.schema,'kaminos.hindquarter-binding-browser.v1','wrong assay schema');
  assert.equal(state.status,'loaded','case did not load');
  assert.equal(state.effectiveRoute,'dedicated-kaminos-independent-cast-replay','wrong replay route');
  assert.equal(state.rendererBackend,'WebGPUBackend','fallback renderer');
  assert.equal(state.expectedManifestSha256,expected.manifest,'wrong requested case');
  assert.equal(state.effectiveManifestSha256,expected.manifest,'wrong effective case');
  assert.equal(state.sourceSha256,expected.source,'wrong Blender source');
  assert.equal(state.sourceCast,'CAT_CAST_MANNEQUIN_80413_STRONG','wrong cast');
  assert.equal(state.candidatePaintedWeights,false,'candidate inherited painted weights');
  assert.equal(state.vertices,50501,'partial source geometry');
  assert.equal(state.frames,39,'partial recorded motion');
  assert.deepEqual(state.modes.map(row=>row.mode),['support-bound','automatic-transport','painted-reference'],'wrong comparison modes');
  assert.equal(new Set(state.modes.map(row=>row.id)).size,3,'duplicate registered mesh');
  assert.ok(state.modes.every(row=>row.vertices===state.vertices),'partial comparison mesh');
  assert.ok(Number.isInteger(state.frame)&&state.frame>=0&&state.frame<state.frames,'invalid frame');
  assert.ok(Number.isFinite(state.metrics?.fieldErrorMean),'missing finite diagnostics');
  return state;
}
export async function runHindquarterWitness({evaluate,capture,ws,out,delay,expected,progress}){
  let state;
  for(let i=0;i<240;i++){
    state=await evaluate(ws,'window.kaminosHindquarterAssay?.snapshot() ?? window.kaminosHindquarterAssayFailure ?? null');
    if(state?.status==='loaded')break;if(state?.phase==='failed')throw Error(state.failurePhase+': '+state.message);await delay(100);
  }
  validateHindquarterState(state,expected);progress({stage:'loaded',state});
  const neutral=await capture(ws,out.replace(/\.png$/,'-neutral.png'));
  const peaks=[];
  for(const frame of [6,19,32]){
    await evaluate(ws,`window.kaminosHindquarterAssay.seek(${frame},'witness-peak'); true`);await delay(200);
    const peak=validateHindquarterState(await evaluate(ws,'window.kaminosHindquarterAssay.snapshot()'),expected);
    assert.equal(peak.frame,frame);const shot=await capture(ws,out.replace(/\.png$/,`-peak-${frame}.png`));
    peaks.push({state:peak,shot});progress({stage:'peak-captured',frame,shot});
  }
  await evaluate(ws,'document.querySelector("#rest").click(); document.querySelector("#play").click(); true');
  const start=await evaluate(ws,'window.kaminosHindquarterAssay.snapshot().events.filter(event=>event.type==="play-start").at(-1)');
  for(let i=0;i<200;i++){
    const done=await evaluate(ws,`window.kaminosHindquarterAssay.snapshot().events.some(event=>event.type==='play-end'&&event.id===${JSON.stringify(start.id)})`);
    if(done)break;await delay(100);
  }
  state=validateHindquarterState(await evaluate(ws,'window.kaminosHindquarterAssay.snapshot()'),expected);
  assert.ok(state.events.some(event=>event.type==='play-end'&&event.id===start.id),'requested replay did not finish');
  const begin=state.events.findIndex(event=>event.type==='play-start'&&event.id===start.id);
  const displayed=state.events.slice(begin+1).filter(event=>event.type==='frame'&&event.origin==='playback').map(event=>event.frame);
  assert.deepEqual(displayed,Array.from({length:39},(_,i)=>i),'missing or skipped recorded frame');
  const rawPath=out.replace(/\.png$/,'-input-events.json');writeFileSync(rawPath,JSON.stringify({expected,start,state,peaks},null,2));
  progress({stage:'replay-preserved',rawPath});
  return {neutral,peaks,rawPath,state,qualityVerdict:'awaiting visual interpretation; replay completion is not deformation quality'};
}
