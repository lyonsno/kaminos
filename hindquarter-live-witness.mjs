import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
export function validateLiveState(state,expected){
  assert.equal(state?.status,'loaded','live case did not load');
  assert.equal(state.schema,'kaminos.live-transport-browser.v1','wrong live schema');
  assert.equal(state.rendererBackend,'WebGPUBackend','fallback renderer');
  assert.equal(state.effectiveRoute,'index-scene-live-rear-transport','wrong live route');
  assert.equal(state.requestedSha256,expected.manifest,'wrong requested case');
  assert.equal(state.effectiveSha256,expected.manifest,'wrong effective case');
  assert.equal(state.sourceSha256,expected.source,'wrong source scene');
  assert.equal(state.candidatePaintedWeights,false,'candidate consumed painted fields');
  assert.equal(state.vertices,50501,'partial cast');assert.equal(state.triangles,86392,'partial topology');
  assert.equal(state.registeredIds?.length,8,'scene objects not registered');
  assert.equal(state.controls?.length,6,'independent rear controls missing');
  assert.equal(new Set(state.controls.map(b=>b.uuid)).size,6,'duplicate bone objects');
  return state;
}
export async function runLiveTransportWitness({evaluate,capture,ws,out,delay,expected,click,drag,progress}){
  let state;
  for(let i=0;i<240;i++){state=await evaluate(ws,'window.kaminosLiveTransport?.snapshot()??null');if(state?.status==='loaded')break;if(state?.status==='failed')throw Error(state.failurePhase+': '+state.error);await delay(125);}
  validateLiveState(state,expected);progress({stage:'loaded',state});
  const conformance=await evaluate(ws,'window.kaminosLiveTransport.conformance()', {timeoutMs:45000});
  assert.equal(conformance.length,10,'missing source pose conformance');
  assert.ok(conformance.every(row=>row.automaticMaxError<2e-5&&row.paintedMaxError<2e-5),'live geometry differs from its recorded source solve');
  const neutral=await capture(ws,out.replace(/\.png$/,'-neutral.png')),peaks=[];
  for(const name of ['accepted-left-hip','left-stifle','left-hock','left-chain','right-hip','right-stifle','right-hock','right-chain','both-chains']){
    await evaluate(ws,`window.kaminosLiveTransport.preset(${JSON.stringify(name)}); true`);await delay(200);
    peaks.push({name,state:validateLiveState(await evaluate(ws,'window.kaminosLiveTransport.snapshot()'),expected),shot:await capture(ws,out.replace(/\.png$/,`-${name}.png`))});
    progress({stage:'pose-captured',name});
  }
  await evaluate(ws,'window.kaminosLiveTransport.restore();true');
  const name='hindlimb-left-stifle',point=await evaluate(ws,`window.kaminosLiveTransport.point(${JSON.stringify(name)})`);
  await click(ws,point);await delay(150);
  const selected=validateLiveState(await evaluate(ws,'window.kaminosLiveTransport.snapshot()'),expected);
  assert.equal(selected.gizmo.bone,name,'click did not attach gizmo to actual selected bone');
  assert.equal(selected.gizmo.objectUuid,selected.controls.find(b=>b.name===name).uuid,'gizmo target is a proxy');
  assert.equal(selected.gizmo.mode,'rotate','ordinary rotation control not active');
  const ring=await evaluate(ws,'window.kaminosLiveTransport.gizmoPoints()');
  await drag(ws,ring.from,ring.to);await delay(200);
  const dragged=validateLiveState(await evaluate(ws,'window.kaminosLiveTransport.snapshot()'),expected);
  const before=selected.controls.find(b=>b.name===name).quaternion,after=dragged.controls.find(b=>b.name===name).quaternion;
  assert.ok(Math.hypot(...after.map((x,i)=>x-before[i]))>1e-4,'visible rotation-ring drag did not rotate selected bone');
  assert.ok(dragged.updateCount>selected.updateCount,'gizmo drag did not update live deformation');
  const dragShot=await capture(ws,out.replace(/\.png$/,'-gizmo-drag.png'));
  await evaluate(ws,'window.kaminosLiveTransport.restore();true');
  const restored=validateLiveState(await evaluate(ws,'window.kaminosLiveTransport.snapshot()'),expected);
  assert.deepEqual(restored.controls.map(b=>b.quaternion),selected.controls.map(b=>b.quaternion),'restoration changed rest rig');
  const rawPath=out.replace(/\.png$/,'-inputs.json');writeFileSync(rawPath,JSON.stringify({expected,conformance,point,ring,selected,dragged,restored,peaks},null,2));
  return {conformance,neutral,peaks,dragShot,rawPath,selected,dragged,restored,qualityVerdict:'live transport exercised; deformation quality requires inspection'};
}
