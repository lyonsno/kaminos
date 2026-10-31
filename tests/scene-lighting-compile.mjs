// kaminos-test: node
import assert from 'node:assert/strict';
import {compileSceneLighting} from '../scene-lighting-compile.mjs';
import {TSL} from '../lib/three.webgpu.js';
const initial={target:{screen:true},mrt:{screen:true},contextNode:TSL.context({base:1}),transparent:true,opaque:false,autoClear:false};
const renderer={...initial,getRenderTarget(){return this.target;},getMRT(){return this.mrt;},setRenderTarget(v){this.target=v;},setMRT(v){this.mrt=v;}};
const scene={name:'authored',overrideMaterial:null},camera={layers:{mask:1}};
const pass={scene,camera,renderTarget:{scene:true},_mrt:{normal:true},transparent:false,opaque:true,overrideMaterial:{depth:true},_layers:{mask:2},name:'beauty',contextNode:TSL.context({ao:2}),version:0};
let release,calls=0;
renderer.compileAsync=async(s,c)=>{
  calls++;assert.equal(s,scene);assert.equal(c,camera);
  assert.equal(renderer.target,pass.renderTarget);assert.equal(renderer.mrt,pass._mrt);
  assert.equal(renderer.transparent,false);assert.equal(renderer.opaque,true);
  assert.deepEqual(renderer.contextNode.getFlowContextData(),{base:1,ao:2});
  assert.equal(scene.overrideMaterial,pass.overrideMaterial);assert.equal(camera.layers.mask,2);
  await new Promise(resolve=>release=resolve);
};
const compilation=compileSceneLighting(renderer,[pass]);
assert.equal(calls,1);assert.equal(renderer.target,pass.renderTarget,'matching pass context survives across async compilation');
release();await compilation;
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key]);
// Live rebuild of combined GI can compile the filter under the receiving AO
// context. A fullscreen producer must not sample the visibility it is writing.
pass.version++; // A new pass context invalidates the native cached context.
pass.contextNode=TSL.context({getAO:()=>TSL.float(.5)});
renderer.compileAsync=async()=>{
  const hook=renderer.contextNode.getFlowContextData().getAO,input=TSL.float(1);
  assert.equal(hook(input,{object:{isQuadMesh:true},material:{}}),input,'fullscreen producer must bypass receiving AO');
  assert.notEqual(hook(input,{object:{isMesh:true},material:{}}),input,'ordinary surface keeps receiving AO');
};
await compileSceneLighting(renderer,[pass]);
assert.equal(camera.layers.mask,1);assert.equal(scene.name,'authored');assert.equal(scene.overrideMaterial,null);
renderer.compileAsync=async()=>{throw Error('compile failed');};
await assert.rejects(compileSceneLighting(renderer,[pass]),/compile failed/);
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key],'failure restores renderer state');
console.log('PASS async compile matches MRT, draw flags, AO context and restores state on failure');

// Native GI repro: the receiving getOutput hook must not flatten producer MRTs
// while compileAsync builds their dependencies under the receiving context.
let receivingCalls=0;
pass.version++;
pass.contextNode=TSL.context({getOutput(node){receivingCalls++;return {received:node};}});
const nativeCache={version:pass.version,context:TSL.context({...initial.contextNode.getFlowContextData(),...pass.contextNode.getFlowContextData()})};
pass._contextNodeCache=nativeCache;
renderer.compileAsync=async()=>{
  assert.equal(renderer.contextNode,nativeCache.context,'prepare the same context identity the next native draw will use');
  const hook=renderer.contextNode.getFlowContextData().getOutput;
  const producer=TSL.outputStruct(TSL.vec4(1),TSL.vec4(2));
  assert.equal(hook(producer,{}),producer,'preserve producer output attachments during lighting compilation');
  const surface=TSL.vec4(1);assert.deepEqual(hook(surface,{}),{received:surface});
};
await compileSceneLighting(renderer,[pass]);assert.equal(receivingCalls,1);
assert.equal(pass._contextNodeCache,nativeCache,'compilation must not take custody of the native pass context cache');
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key]);

const originalValue=nativeCache.context.value;
renderer.compileAsync=async()=>{assert.equal(renderer.contextNode,nativeCache.context);throw Error('native compile failed');};
await assert.rejects(compileSceneLighting(renderer,[pass]),/native compile failed/);
assert.equal(nativeCache.context.value,originalValue,'failure restores exact native receiving hooks');
assert.equal(renderer.contextNode,initial.contextNode);
console.log('PASS preparation preserves native context identity and restores hooks after failure');

pass._renderCallDepths=new WeakMap([[renderer,2]]);
renderer.compileAsync=async(s,c,target,options)=>{assert.equal(options?.callDepth,2,'warm the native render context observed for this pass and renderer');};
await compileSceneLighting(renderer,[pass]);
console.log('PASS preparation carries observed pass nesting');

// Source and receiving passes prepare ordered graphs, but share one native
// completion barrier. Both must submit before either driver's wait finishes.
const batchReleases=[];let batchCalls=0;
renderer.compileAsync=async(s,c,target,options)=>{
  batchCalls++;
  const pending=new Promise(resolve=>batchReleases.push(resolve));
  if(options?.pipelineWork)options.pipelineWork.push(pending);
  else await pending;
};
let batchDone=false;
const batch=compileSceneLighting(renderer,[pass,pass]).then(()=>batchDone=true);
await new Promise(r=>setImmediate(r));
assert.equal(batchCalls,2,'submit both passes before waiting for native pipelines');
assert.equal(batchDone,false);
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key],'pass state restored during native wait');
batchReleases[0]([]);await Promise.resolve();assert.equal(batchDone,false);
batchReleases[1]([]);await batch;
console.log('PASS cross-pass driver overlap with complete settlement and restored state');

let failureRelease,failedCalls=0;
renderer.compileAsync=async(s,c,target,options)=>{
  if(++failedCalls===2)throw Error('second pass graph failed');
  options.pipelineWork.push(new Promise(resolve=>failureRelease=()=>resolve([{status:'fulfilled'}])));
};
let failureDone=false;
const failure=compileSceneLighting(renderer,[pass,pass]);
const checkedFailure=assert.rejects(failure,/second pass graph failed/).then(()=>failureDone=true);
await new Promise(r=>setImmediate(r));assert.equal(failureDone,false,'later graph failure must drain earlier driver work');
failureRelease();await checkedFailure;
renderer.compileAsync=async(s,c,target,options)=>{options.pipelineWork.push(Promise.resolve([{status:'rejected',reason:Error('native failed')}]))};
await assert.rejects(compileSceneLighting(renderer,[pass]),/native failed/);
console.log('PASS shared pass barrier propagates native failure and drains after graph failure');

// A live preparation yields with the exact active draw context restored, and
// promotes the pending light set only after every pass's native work settles.
let entered=0,committed=0,discarded=0,yielded=0,liveRelease;
renderer.beginLightingPreparation=()=>({node:{candidate:true},commit(){committed++;},discard(){discarded++;}});
renderer.compileAsync=async(s,c,target,options)=>{
  assert.equal(options.lightsNode?.candidate,true,'live compilation uses an isolated pending lighting node');
  assert.equal(renderer.target,pass.renderTarget);
  await options.yieldToMain(async()=>{
    yielded++;for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key],'drawing context restored while compiler yields');
    assert.equal(camera.layers.mask,1);assert.equal(scene.overrideMaterial,null);
  });
  entered++;assert.equal(renderer.target,pass.renderTarget,'compile context restored after yielding');
  options.pipelineWork.push(new Promise(r=>liveRelease=()=>r([])));
};
const live=compileSceneLighting(renderer,[pass],{live:true});
await new Promise(r=>setImmediate(r));
assert.equal(yielded,1);assert.equal(entered,1);assert.equal(committed,0);
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key]);
liveRelease();await live;assert.equal(committed,1);assert.equal(discarded,0);
renderer.compileAsync=async()=>{throw Error('pending failed');};
await assert.rejects(compileSceneLighting(renderer,[pass],{live:true}),/pending failed/);
assert.equal(committed,1);assert.equal(discarded,1);
console.log('PASS live preparation restores drawing context at yields and promotes only complete lighting');

// Exercise the effective renderer API, not only the pass-coordinator fake.
const {WebGPURenderer}=await import('../lib/three.webgpu.js');
assert.equal(typeof WebGPURenderer.prototype.beginLightingPreparation,'function','live preparation is an API on the native renderer');
const retired=[],activeNode={},candidateNode={};
const generation={node:candidateNode};
const nativeOwner={_lighting:{_retained:new Map([[scene,activeNode]]),prepare(s,retire){assert.equal(s,scene);retire(activeNode);return generation;}},_objects:{disposeLightsNode:n=>retired.push(n)}};
assert.equal(WebGPURenderer.prototype.beginLightingPreparation.call(nativeOwner,scene),generation);
assert.deepEqual(retired,[activeNode]);
WebGPURenderer.prototype.releaseRetainedLighting.call(nativeOwner,scene);assert.equal(nativeOwner._lighting._retained.has(scene),false);
