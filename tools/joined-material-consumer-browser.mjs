// Controlled transport conformance, not a flame look or pressure witness.
import * as THREE from '/fine/lib/three.core.js';
import {createKaminosVolumePrototype} from '/fine/volume-core.js';
import {createOuterSmoke} from '/outer/volume-outer-smoke.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
async function retain(name,a){const r=await fetch('/raw/'+name,{method:'POST',body:new Uint8Array(a.buffer,a.byteOffset,a.byteLength)});check(r.ok,'raw evidence upload failed');return {file:name,bytes:a.byteLength};}
window.runConsumer = async function(fault='') {
  const result={phase:'initialize',arms:[],gpuErrors:[],fixture:'uniform leftward flow, empty fine material, exterior raw soot/heat/passive fuel',claim:'actual fine transport consumes outer snapshot; no shared pressure or authored look'};
  window.consumerResult=result;
  // No uncontrolled simulation frames: only explicit sampleFrame advances.
  window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};
  const camera=new THREE.PerspectiveCamera(45,1,.01,100);camera.position.set(0,1,6);camera.lookAt(0,0,0);
  const controls={resolution:32,gridHeightRatio:1,domainShape:'cube',emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',projection:1,pressureSolverIterations:32,advectionScheme:'maccormack',commonGasTransport:true,timeStep:'uniform',speed:1,velocityStaggering:'staggered',confinement:'off',windStrength:0,windModel:'off',renderScale:1,steps:32,physicalMode:0,lookFreeze:0,residualMode:'off',boundarySplatMode:'off',immersedSpeed:0};
  Object.assign(controls,{raySteps:32,density:1,fire:0,smoke:0,curl:0,flowRate:0,volumeScene:'tall_plume',microdetail:0,interfaceShred:0,fireLicks:0,artisticSwirl:false,phasedSway:false,proceduralDetailForces:false});
  if(fault==='missing-control')delete controls.curl;
  for(const key of ['raySteps','density','fire','smoke','curl','speed'])check(Number.isFinite(controls[key]),'missing/nonfinite required control: '+key);
  result.requestedControls={...controls};
  const p=createKaminosVolumePrototype({THREE,viewport:document.querySelector('#viewport'),camera,controls:{target:new THREE.Vector3()},getControls:()=>controls,onStatus:s=>{window.consumerStatus=s;void fetch('/checkpoint',{method:'POST',body:JSON.stringify({phase:result.phase,status:s})});}});
  window.consumerPrototype=p;
  p.setCoreEmitterSourceMode('analytic-only');
  check(p.setJoinedBoundary({enabled:true}).admitted,'fine joined mode refused');
  const geometry={originFine:[-16,-16,-16],cellWidthFine:4,dims:[16,32,16],finePitchLocal:2/32};
  p.setJoinedGhosts(geometry);await p.setActive(true);
  const {device}=p.foregroundGpuContext();
  device.addEventListener('uncapturederror',e=>result.gpuErrors.push(e.error.message));
  result.backend=p.debugState().backend;check(/WebGPU:apple/i.test(result.backend),'actual Apple WebGPU required');
  async function read(buffer){const b=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,b.size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange().slice(0));b.unmap();return a;}finally{b.destroy();}}
  for(const material of [false,true]){
    result.phase=material?'material-arm':'empty-arm';
    p.setJoinedGhosts(null);p.setJoinedGhosts(geometry);
    let fine=p.joinedProducerState();check(fine.dims.join(',')==='32,32,32','fine dimensions differ');
    const initial=new Float32Array(fine.fluidBuffer.size/4);
    for(let i=0;i<initial.length;i+=16)initial[i]=-.2;
    device.queue.writeBuffer(fine.fluidBuffer,0,initial);
    const outer=createOuterSmoke(device,{grid:16,extent:2,nearHeightRatio:1,pressureIterations:1,materialMode:'authored-raw'},32,[fine.fluidBuffer,fine.fluidBuffer]);
    let fixtureBuffer;
    try{
      const padded=[17,33,17],raw=new Float32Array(padded.reduce((a,b)=>a*b)*8);
      for(let z=0;z<17;z++)for(let y=0;y<33;y++)for(let x=0;x<17;x++){
        const i=(x+17*(y+33*z))*8;raw[i]=-.2*2/32;
        if(x<16&&y<32&&z<16&&material)raw.set([.3,.9,.4,.2,0],i+3);
      }
      fixtureBuffer=device.createBuffer({size:raw.byteLength,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(fixtureBuffer,0,raw);
      let e=device.createCommandEncoder();outer.encodeExternalProjection(e,0,{dtScale:1,backtraceScale:3.1},(enc,state)=>enc.copyBufferToBuffer(fixtureBuffer,0,state,0,raw.byteLength),0);device.queue.submit([e.finish()]);
      // The second step exercises actual exterior transport/material evolution.
      e=device.createCommandEncoder();outer.encodeExternalProjection(e,0,{dtScale:1,backtraceScale:3.1},()=>{},0);
      const snapshot=outer.encodeGhostSnapshot(e,fine.ghosts.textures);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
      const exterior=await outer.readState();
      p.bindJoinedGhostGeneration(fault==='stale-generation'?fine.simStepCount-1:fine.simStepCount);
      const before=fine.simStepCount;
      const frame=await p.sampleFrame({advanceSim:true,includeRgba:false,now:1000});
      check(frame.ok,'fine sample failed: '+JSON.stringify(frame));
      fine=p.joinedProducerState();check(fine.simStepCount===before+1,'fine did not advance exactly once');
      check(fine.ghosts.bound&&!fine.ghosts.synthetic,'actual exterior ghosts not bound');
      const values=await read(fine.fluidBuffer),at=(x,y,z)=>Array.from(values.slice((x+32*(y+32*z))*16,(x+32*(y+32*z)+1)*16));
      const label=material?'loaded':'empty';
      const retained={fine:await retain(label+'-fine.f32',values),outer:await retain(label+'-outer.f32',exterior)};
      const arm={material,before,after:fine.simStepCount,snapshot,outer:outer.receipt(),timeStep:fine.timeStep,scheme:fine.transportScheme,probe:at(31,8,16),interior:at(16,8,16),raw:retained};
      result.arms.push(arm);check(result.gpuErrors.length===0,result.gpuErrors.join('\n'));
      check(values.every(Number.isFinite)&&exterior.every(Number.isFinite),'nonfinite raw field');
      const effective=p.debugState();arm.effective={controls:effective.controls,source:effective.coreEmitterSourceReceipt,immersed:effective.immersedSource,joined:fine.joined,ghosts:{bound:fine.ghosts.bound,generation:fine.ghosts.generation,geometry:fine.ghosts.geometry}};
    }finally{fixtureBuffer?.destroy();outer.destroy();}
  }
  result.phase='comparison';
  const [empty,loaded]=result.arms;
  check(loaded.probe[4]>empty.probe[4]+.01,'raw soot did not enter fine boundary');
  check(loaded.probe[5]>empty.probe[5]+.01,'heat did not enter fine boundary');
  check(loaded.probe[6]>empty.probe[6]+.01,'passive fuel did not enter fine boundary');
  check(loaded.interior.every((v,i)=>Math.abs(v-empty.interior[i])<1e-6),'unreached interior changed');
  result.phase='complete';return result;
};
