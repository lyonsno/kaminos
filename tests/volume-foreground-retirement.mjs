// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createWebGpuForegroundService} from '../webgpu-inference-kit/src/foreground-opportunity.js';

// Execute the production renderer lifecycle against the exact kit service used
// by Generate. GPU encoding is replaced; admission and callback ordering are real.
const source=readFileSync(process.env.KAMINOS_LIFECYCLE_SOURCE || new URL('../volume-core.js',import.meta.url),'utf8');
const scheduling=source.slice(source.indexOf('  let foregroundRequester = null;'),source.indexOf('  function invalidateRaymarchReadouts('));
const activation=source.slice(source.indexOf('    async setActive(active) {'),source.indexOf('    setForegroundOpportunityRequester,'));
const disposal=source.slice(source.lastIndexOf('\n    async dispose() {')>=0 ? source.lastIndexOf('\n    async dispose() {') : source.lastIndexOf('\n    dispose() {'),source.lastIndexOf('\n  };'));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function fixture({gate=null,failure=null}={}){
 const submissions=[],scheduled=new Map(),events=[],destroyed=[];let nextRaf=0;
 const device={queue:{submit:commands=>submissions.push(...commands)}};
 const service=createWebGpuForegroundService({routeId:'retirement-test',device,queue:device.queue});
 const run=await service.beginRun('image-generation');
 const scope={state:{active:true,frameCount:0,simStepCount:0,error:null},device,raf:0,
  productFrameOwner:'prototype',selectiveHeadLiveCapturePaused:false,
  boundarySplatRequested:()=>false,browserResidualCanApply:()=>false,
  ensureGpu:async()=>{},ensureBrowserResidualModel:async()=>{},invalidateRaymarchReadouts:()=>{},
  requestAnimationFrame:fn=>{scheduled.set(++nextRaf,fn);return nextRaf;},cancelAnimationFrame:id=>scheduled.delete(id),
  canvas:{classList:{add(){},remove(){}},remove:()=>destroyed.push('canvas')},emitStatus:event=>events.push(event),performance};
 for(const name of ['sceneTransportConsumer','sceneTransport','rayStepTelemetry','scenePointBindings','persistentSparseCohortGpuState','fourArmHeldStateRuntimeState','fourArmHeldStateResidualGrid','frameTexture','rayStartNoiseTexture','ordinarySceneDepthFallback','boundarySplatHdrTexture','boundarySplatOpticalTexture','fourArmHeldStateLinearTexture','fourArmHeldStateResidualTexture','fourArmHeldStateResidualParamsBuffer','browserResidualFeatureTexture','externalEmitterBuffer','analyticEmitterInjectionUniformBuffer','volumePresentationControlsBuffer','boundarySplatCameraBuffer'])scope[name]=null;
 scope.frameTexture={destroy:()=>destroyed.push('frameTexture')};
 scope.clearBoundarySplatLiveUnionCoefficientOverlay=()=>{};
 scope.destroyLiquidFireContactConsumer=()=>destroyed.push('liquidContact');
 scope.destroyFluidState=()=>destroyed.push('fluid');
 scope.renderOrdinaryFrame=(_,ctx)=>{
  if(failure)throw Error(failure);
  assert.equal(scope.state.active,true,'an admitted frame retains its active renderer');
  ctx.submit(['frame']);scope.state.frameCount++;scope.state.simStepCount++;
  return {status:'submitted'};
 };
 vm.createContext(scope);
 vm.runInContext(scheduling+'\nglobalThis.api={'+activation+disposal+'setForegroundOpportunityRequester,render,drain:()=>foregroundDrain};',scope);
 scope.api.setForegroundOpportunityRequester(request=>service.request({...request,async run(ctx){
  if(gate){gate.entered.resolve();await gate.release.promise;}
  return request.run(ctx);
 }}));
 let boundary=0;
 return {scope,api:scope.api,submissions,scheduled,events,destroyed,
  boundary:()=>run.foregroundOpportunities.serviceAtBoundary({invocationId:'image-generation',boundaryId:'boundary-'+(++boundary),dutyId:'denoise-'+boundary,phase:'denoise',position:'before-encode'}),
  async close(){await run.finish().catch(()=>{});try{await service.dispose();}catch{}}
 };
}

for(const when of ['before-admission','queued'])test('retire '+when+' without aborting the model boundary',async()=>{
 const f=await fixture();try{
  f.api.render(0);if(when==='queued')await turn();
  const stopped=f.api.setActive(false);await turn();
  const boundary=await f.boundary();
  assert.deepEqual(boundary.failures,[],'hiding the kiln must not fail image generation');
  await stopped;await f.api.drain();
  assert.deepEqual(f.submissions,['frame']);assert.equal(f.scope.state.active,false);
  assert.equal(f.scope.state.error,null);assert.equal(f.scheduled.size,0,'retirement cannot schedule another frame');
  assert.deepEqual((await f.boundary()).failures,[],'later model duties remain usable');
  await f.api.setActive(true);assert.equal(f.scheduled.size,1);
  const [id,callback]=f.scheduled.entries().next().value;f.scheduled.delete(id);callback(1);await turn();
  await f.boundary();await f.api.drain();assert.equal(f.submissions.length,2,'the same renderer can resume');
 }finally{await f.close();}
});

test('retirement drains a callback already admitted by the host',async()=>{
 const gate={entered:deferred(),release:deferred()},f=await fixture({gate});try{
  f.api.render(0);await turn();const boundary=f.boundary();await gate.entered.promise;
  let stopped=false;const retirement=f.api.setActive(false).then(()=>stopped=true);
  await turn();assert.equal(stopped,false,'resource retirement waits for admitted host work');
  gate.release.resolve();assert.deepEqual((await boundary).failures,[]);await retirement;
  assert.equal(f.scope.state.active,false);assert.equal(f.scope.state.error,null);assert.deepEqual(f.submissions,['frame']);
 }finally{gate.release.resolve();await f.close();}
});

test('retirement does not suppress a real render failure',async()=>{
 const f=await fixture({failure:'render sentinel'});try{
  f.api.render(0);await turn();const retirement=f.api.setActive(false);
  const boundary=await f.boundary();await retirement;
  assert.equal(boundary.failures.length,1);assert.match(boundary.failures[0].failure.error.message,/render sentinel/);
  assert.match(f.scope.state.error,/failed-before-submission/);assert.equal(f.submissions.length,0);
 }finally{await f.close();}
});

test('dispose keeps GPU resources alive until queued foreground work settles',async()=>{
 const f=await fixture();try{
  f.api.render(0);await turn();const disposed=f.api.dispose();await turn();
  assert.deepEqual(f.destroyed,[],'a queued frame still owns the renderer resources');
  assert.deepEqual((await f.boundary()).failures,[]);await disposed;
  assert.deepEqual(f.submissions,['frame']);assert.equal(f.scope.state.active,false);
  assert.deepEqual(f.destroyed,['frameTexture','liquidContact','fluid','canvas']);
  assert.equal(f.scheduled.size,0);
 }finally{await f.close();}
});
