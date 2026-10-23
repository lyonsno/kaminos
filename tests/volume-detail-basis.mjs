// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as detail from '../volume-continuous-detail.mjs';
import * as wavelet from '../volume-wavelet-turbulence.mjs';

test('continuous detail has a reusable basis independent of the simulation grid',()=>{
  assert.equal(typeof detail.createContinuousDetailBasis,'function','GPU basis producer exists');
  assert.equal(detail.CONTINUOUS_DETAIL_BASIS.size,64);
  assert.equal(detail.CONTINUOUS_DETAIL_BASIS.period,8);
  assert.match(detail.CONTINUOUS_DETAIL_WGSL,/textureSampleLevel\(continuousDetailBasis, continuousDetailSampler/);
  assert.match(detail.CONTINUOUS_DETAIL_WGSL,/override CONTINUOUS_DETAIL_ANALYTIC/,'original analytic comparison remains available');
});

test('periodic curl closes at positive and negative texture seams',()=>{
  assert.equal(typeof wavelet.waveletTurbulenceWgsl,'function','periodic producer shares the existing basis implementation');
  for(const p of [[.137,2.71,6.41],[-.001,8.001,-16.31],[0,0,0]]){
    const a=wavelet.waveletCurlUnit(p,8);
    for(let axis=0;axis<3;axis++){
      const q=[...p];q[axis]+=8;
      const b=wavelet.waveletCurlUnit(q,8);
      assert.ok(Math.hypot(...a.map((v,k)=>v-b[k]))<1e-10);
    }
  }
  assert.throws(()=>wavelet.waveletTurbulenceWgsl({latticePeriod:-1}),/period/);
});

test('eight texels per noise cell preserve the periodic basis without cell locking',()=>{
  const {size,period}=detail.CONTINUOUS_DETAIL_BASIS;
  const sample=p=>{
    const q=p.map(v=>v*size/period-.5),base=q.map(Math.floor),f=q.map((v,i)=>v-base[i]);
    const sum=[0,0,0];
    for(let c=0;c<8;c++){
      const corner=[c&1,(c>>1)&1,(c>>2)&1];
      const v=wavelet.waveletCurlUnit(base.map((b,i)=>(b+corner[i]+.5)*period/size),period);
      const w=corner.reduce((w,on,i)=>w*(on?f[i]:1-f[i]),1);
      v.forEach((v,i)=>sum[i]+=w*v);
    }
    return sum;
  };
  let error=0,energy=0;
  for(let i=0;i<40;i++){
    const p=[i*.131-2.7,i*.713+.017,i*.373-8.1];
    const a=wavelet.waveletCurlUnit(p,period),b=sample(p);
    a.forEach((v,k)=>{error+=(v-b[k])**2;energy+=v*v;});
    assert.ok(sample(p.map((v,k)=>v+(k===0?1e-4:0))).some((v,k)=>v!==b[k]),'subcell positions are not quantized');
  }
  assert.ok(Math.sqrt(error/energy)<.08,'basis interpolation relative RMS error stays below eight percent on fixed signed probes');
});

test('basis producer is single-submit and disposes owned texture on compilation failure',async()=>{
  const calls=[],texture={createView:()=> 'basis-view',destroy:()=>calls.push('destroy')};
  const pass={setPipeline(){},setBindGroup(){},dispatchWorkgroups:(...v)=>calls.push(v),end(){}};
  const device={createTexture:descriptor=>(calls.push(descriptor),texture),
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
    createComputePipelineAsync:async()=>({getBindGroupLayout:()=> 'layout'}),createBindGroup:()=> 'group',
    createCommandEncoder:()=>({beginComputePass:()=>pass,finish:()=> 'commands'}),
    queue:{submit:()=>calls.push('submit')},createSampler:descriptor=>(calls.push(descriptor),'sampler')};
  globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
  try{
    const basis=await detail.createContinuousDetailBasis(device);
    assert.equal(calls.filter(v=>v==='submit').length,1);assert.equal(basis.receipt.materialBaked,false);
    assert.deepEqual(calls.find(Array.isArray),[16,16,16]);
    assert.equal(calls.find(v=>v.addressModeU)?.minFilter,'linear');
    basis.dispose();assert.equal(calls.filter(v=>v==='destroy').length,1);
    calls.length=0;device.createShaderModule=()=>({getCompilationInfo:async()=>({messages:[{type:'error',message:'bad basis'}]})});
    await assert.rejects(detail.createContinuousDetailBasis(device),/bad basis/);
    assert.deepEqual(calls.filter(v=>typeof v==='string'),['destroy']);
  }finally{delete globalThis.GPUTextureUsage;}
});

test('pause pins render time and stochastic frame but permits resume and re-pause',()=>{
  const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
  const start=core.indexOf('function updateRenderPhaseState(');
  const source=core.slice(start,core.indexOf('\n}',start)+2);
  const update=vm.runInNewContext(`(${source})`);
  const state={frameCount:13};
  update(100,state,false,true);
  const held=[state.renderPhaseTimeMs,state.renderPhaseFrame];
  state.frameCount=14;update(200,state,false,true);
  assert.deepEqual([state.renderPhaseTimeMs,state.renderPhaseFrame],held,'paused draws retain sample phase');
  assert.equal(state.renderPhaseAuthority,'paused-pinned-render-phase');
  update(300,state,false,false);assert.equal(state.renderPhaseTimeMs,300);
  assert.equal(state.renderPhaseFrame,14);
  state.frameCount=20;update(400,state,false,true);
  assert.deepEqual([state.renderPhaseTimeMs,state.renderPhaseFrame],[400,20]);
  assert.match(core,/updateRenderPhaseState\(now, state, lookFreeze, simulationPaused\)/);
  assert.match(core,/controlsSnapshot\.rayNoiseFrame \?\? renderPhaseFrame/,'ray noise consumes the held phase, retaining explicit assay override');
});
