// kaminos-test: node
import assert from 'node:assert/strict';
import * as core from '../volume-core.js';
import {positiveCubicWeights, displayReconstructionShapes, createDisplayReconstruction} from '../volume-display-reconstruction.mjs';
import * as display from '../volume-display-reconstruction.mjs';

assert.equal(typeof display.displayPreparationTiming,'function','timing handles overlapping native GPU pass timestamps');
const nativeTiming=display.displayPreparationTiming([173048775542444n,173048778190195n,173048775583485n,173048775609443n]);
assert.equal(nativeTiming.displayPreparationMs,0.025958);
assert.equal(nativeTiming.preparationAndCameraSpanMs,2.647751);
assert.equal(nativeTiming.passIntervalsOverlap,true);
assert.throws(()=>display.displayPreparationTiming([1n,4n,0n,3n]),/timestamp/);
assert.throws(()=>display.displayPreparationTiming([4n,1n,2n,3n]),/timestamp/);

assert.equal(typeof core.resolveDisplayReconstruction, 'function',
  'The camera must expose an opt-in display reconstruction configuration independent of simulation controls');
const {resolveDisplayReconstruction: resolve} = core;
assert.equal(resolve({}).mode, 'off');
assert.deepEqual(resolve({displayReconstruction:'material',displayGridScale:2,emissionSmoothing:0.25,smokeSmoothing:0.75}),
  {mode:'material',value:1,scale:2,emission:0.25,smoke:0.75,alignment:'cell-centred',emissionInterpolation:'positive',smokeInterpolation:'positive'});
assert.throws(()=>resolve({displayReconstruction:'invented'}), /reconstruction mode/);
for(const f of [0,0.1,0.5,0.9,1])for(const amount of [0,0.25,1]) {
  const w=positiveCubicWeights(f,amount);
  assert.ok(w.every(v=>v>=0));
  assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-14);
  const value=w.reduce((s,v,i)=>s+v*[0,3,1,2][i],0);
  assert.ok(value>=0&&value<=3,'positive filter cannot overshoot the local range');
  if(amount===0)assert.deepEqual(w,[0,1-f,f,0]);
}
assert.deepEqual(positiveCubicWeights(0),[1/6,4/6,1/6,0]);
assert.deepEqual(displayReconstructionShapes([32,72,32],2),[[32,72,32],[64,72,32],[64,144,32],[64,144,64]]);
assert.throws(()=>resolve({displayGridScale:3}),/grid scale/);
assert.throws(()=>resolve({emissionSmoothing:NaN}),/smoothing/);

// Resource/cache policy, not a substitute for native shader conformance.
globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2,STORAGE:4};
const allocations=[], dispatches=[], passes=[], writes=[];
const device={limits:{maxTextureDimension3D:256,maxStorageBufferBindingSize:134217728,maxBufferSize:268435456,maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(buffer,offset,data){writes.push({buffer,data:[...data]});}},
  createTexture(d){const t={...d,createView(){return {texture:t};},destroy(){t.destroyed=true;}};allocations.push(t);return t;},
  createBuffer(d){return {...d,destroy(){}};},createShaderModule:d=>d,
  createComputePipeline:d=>({...d,getBindGroupLayout:i=>i}),createBindGroup:d=>d};
const encoder={beginComputePass(descriptor){passes.push(descriptor);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(...v){dispatches.push(v);},end(){}};}};
const input={fluid:[{},{}],reactant:[device.createTexture({}),device.createTexture({})]};
const field=createDisplayReconstruction(device,{}, {},()=>input);
const config=resolve({displayReconstruction:'material'});
field.ensure([4,8,4],config);
const admittedView=field.view.texture;
const admittedState=field.read();
const allocationCount=allocations.length;
for(let repeat=0;repeat<2;repeat++) {
  assert.deepEqual(field.ensure([160,640,160],{...config,scale:4}),
    {changed:false,admitted:false,reason:'display-grid-exceeds-device-3d-texture-dimensions'});
  assert.deepEqual(field.read(),admittedState,'refusal preserves accepted configuration');
  assert.equal(field.view.texture,admittedView);
  assert.ok(!admittedView.destroyed,'refusal does not destroy accepted resources');
  assert.equal(allocations.length,allocationCount,'rejected shapes allocate nothing');
}
assert.equal(field.encode(encoder,0,[0,1]),true);
assert.deepEqual(dispatches,[[1,2,1],[2,2,1],[2,4,1],[2,4,2]]);
assert.deepEqual(field.ensure([4,8,4],config),{changed:false,admitted:true,reason:null});
assert.equal(field.encode(encoder,0,[0,1]),false,'held source does not rebuild');
assert.equal(field.encode(encoder,0,[0,2]),true,'new source step rebuilds');
field.ensure([4,8,4],{...config,smoke:0.25});
assert.equal(field.encode(encoder,0,[0,2]),true,'smoke edit rebuilds held source');
field.invalidate();assert.equal(field.encode(encoder,0,[0,2]),true);
field.invalidate();passes.length=0;
const timing={querySet:{},beginningOfPassWriteIndex:2,endOfPassWriteIndex:3};
assert.equal(field.encode(encoder,0,[0,2],timing),true);
assert.deepEqual(passes[0].timestampWrites,{querySet:timing.querySet,beginningOfPassWriteIndex:2},'preparation timing starts before seed');
assert.deepEqual(passes[3].timestampWrites,{querySet:timing.querySet,endOfPassWriteIndex:3},'preparation timing ends after classification');
field.ensure([4,8,4],resolve({}));
assert.equal(field.encode(encoder,0,[0,2]),false);
assert.equal(field.read().grid,null);
assert.equal(field.ensure([8,8,8],config).admitted,true,'valid request recovers after refusal and native fallback');
assert.equal(field.encode(encoder,0,[0,3]),true);
assert.deepEqual(field.read().grid,[16,16,16]);
const cubic=resolve({displayReconstruction:'material',displayAlignment:'aligned',emissionInterpolation:'interpolating'});
assert.equal(field.ensure([8,8,8],cubic).admitted,true);
assert.deepEqual(field.read().grid,[15,15,15]);
passes.length=0;
assert.equal(field.encode(encoder,0,[0,3]),true);
assert.equal(passes.filter(p=>p.label.startsWith('display spline coefficients')).length,3);
assert.equal(field.encode(encoder,0,[0,3]),false);
const before=field.read();
assert.equal(field.ensure([256,256,256],{...cubic,scale:1}).reason,'display-coefficients-exceed-device-buffer-size');
assert.deepEqual(field.read(),before,'buffer-size refusal preserves accepted state');
const monotone=resolve({displayReconstruction:'material',displayAlignment:'aligned',emissionInterpolation:'monotone',smokeInterpolation:'positive'});
assert.equal(field.ensure([8,8,8],monotone).admitted,true);
passes.length=0;writes.length=0;
assert.equal(field.encode(encoder,0,[0,3]),true,'kernel edit rebuilds held state');
assert.equal(passes.length,4,'local cubic does not dispatch coefficient solves');
assert.ok(writes.some(w=>w.data.length===8&&w.data[4]===2&&w.data[5]===0),'independent GPU kernel codes');
assert.equal(field.read().emissionInterpolation,'monotone');
assert.equal(field.encode(encoder,0,[0,3]),false,'local cubic caches held state');
field.ensure([8,8,8],{...monotone,smokeInterpolation:'interpolating'});
passes.length=0;writes.length=0;
assert.equal(field.encode(encoder,0,[0,3]),true);
assert.equal(passes.length,7,'mixed local/spline uses coefficients only for the spline channel');
assert.ok(writes.some(w=>w.data.length===8&&w.data[4]===2&&w.data[5]===1));
field.destroy();
assert.ok(allocations.filter(t=>t.label).every(t=>t.destroyed));
console.log('display reconstruction configuration: pass');
