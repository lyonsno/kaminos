// Actual next-fine-step wall response; synthetic flow, not an authored flame.
import * as THREE from '/fine/lib/three.core.js';
import {createKaminosVolumePrototype} from '/fine/volume-core.js';
import {createOuterSmoke} from '/outer/volume-outer-smoke.mjs';
import {createCompositeProducerLayout} from '/outer/volume-composite-producer.mjs';
import {createCompositeProducerGPU} from '/outer/volume-composite-producer-gpu.mjs';
import {createCompositeStorageLayout} from '/outer/volume-composite-storage.mjs';
import {createCompositeStorageGPU,createCompositeLowerFaceGPU} from '/outer/volume-composite-storage-gpu.mjs';
import {createCompositePCGGPU} from '/outer/volume-composite-pcg-gpu.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
async function retain(name,a){const r=await fetch('/raw/'+name,{method:'POST',body:new Uint8Array(a.buffer,a.byteOffset,a.byteLength)});check(r.ok,'raw upload failed');return {file:name,bytes:a.byteLength};}
window.runConsumer=async function(fault='',sequence=false,warmIterations=32){
  const result={phase:'initialize',arms:[],gpuErrors:[],fixture:'upward initial flow and passive soot; roof wholly outside fine box',claim:'exterior wall changes shared correction and actual following fine step; no authored flame or timing admission'};
  window.consumerResult=result;window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};
  check(Number.isInteger(warmIterations)&&warmIterations>0,'invalid warm iteration budget');
  result.sequence=sequence?{steps:8,warmIterations,tolerance:1e-3,authority:'finite functional sequence; no timing or production admission'}:null;
  const camera=new THREE.PerspectiveCamera(45,1,.01,100);camera.position.set(0,1,6);camera.lookAt(0,0,0);
  const controls={resolution:32,gridHeightRatio:1,domainShape:'cube',emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',projection:1,pressureSolverIterations:32,advectionScheme:'maccormack',commonGasTransport:true,timeStep:'uniform',speed:1,velocityStaggering:'staggered',confinement:'off',windStrength:0,windModel:'off',renderScale:1,physicalMode:0,lookFreeze:0,residualMode:'off',boundarySplatMode:'off',immersedSpeed:0,raySteps:32,density:1,fire:0,smoke:0,curl:0,flowRate:0,volumeScene:'tall_plume',microdetail:0,interfaceShred:0,fireLicks:0,artisticSwirl:false,phasedSway:false,proceduralDetailForces:false};
  result.requestedControls=controls;
  const p=createKaminosVolumePrototype({THREE,viewport:document.querySelector('#viewport'),camera,controls:{target:new THREE.Vector3()},getControls:()=>controls,onStatus:s=>{window.consumerStatus=s;}});
  window.consumerPrototype=p;p.setCoreEmitterSourceMode('analytic-only');check(p.setJoinedBoundary({enabled:true}).admitted,'joined refused');
  const ghostGeometry={originFine:[-16,-16,-16],cellWidthFine:4,dims:[16,32,16],finePitchLocal:1/16};
  p.setJoinedGhosts(ghostGeometry);await p.setActive(true);
  const {device}=p.foregroundGpuContext();device.addEventListener('uncapturederror',e=>result.gpuErrors.push(e.error.message));
  result.backend=p.debugState().backend;check(/WebGPU:apple/i.test(result.backend),'actual Apple WebGPU required');
  const alloc=(size)=>device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  async function read(b){const s=device.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,s,0,b.size);device.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);const a=new Float32Array(s.getMappedRange().slice(0));s.unmap();return a;}finally{s.destroy();}}
  const nextFields=[],projectedFields=[],predictedFields=[];
  for(const wall of [false,true]){
    const label=wall?'wall':'open';result.phase=label+'-initialize';
    p.setJoinedGhosts(null);p.setJoinedGhosts(ghostGeometry);
    // Obtain both actual ping-pong resources without exposing private internals.
    let fine=p.joinedProducerState();const buffers=[];buffers[fine.fluidReadIndex]=fine.fluidBuffer;
    p.bindJoinedGhostGeneration(fine.simStepCount);
    check((await p.sampleFrame({advanceSim:true,includeRgba:false,now:1000})).ok,'buffer discovery step failed');
    fine=p.joinedProducerState();buffers[fine.fluidReadIndex]=fine.fluidBuffer;
    check(buffers.length===2&&buffers.every(Boolean)&&buffers[0]!==buffers[1],'actual ping-pong discovery failed');
    const initial=new Float32Array(fine.fluidBuffer.size/4);
    for(let z=0;z<32;z++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(x+32*(y+32*z))*16;initial[i+1]=.2;initial[i+4]=.1*Math.exp(-((x-15.5)**2+(y-15.5)**2+(z-15.5)**2)/50);}
    for(const b of buffers)device.queue.writeBuffer(b,0,initial);
    const outer=createOuterSmoke(device,{grid:16,extent:2,nearHeightRatio:1,pressureIterations:1,materialMode:'authored-raw'},32,buffers);
    const coarseCells=new Uint8Array(16*32*16);
    // y=1.5..1.75; fine top y=1.0. Open side boundaries permit lateral outflow.
    if(wall)for(let z=0;z<16;z++)for(let x=0;x<16;x++)coarseCells[x+16*(14+32*z)]=1;
    const packed=new Uint8Array(256*32*16);for(let z=0;z<16;z++)for(let y=0;y<32;y++)packed.set(coarseCells.subarray(16*(y+32*z),16*(y+32*z+1)),256*(y+32*z));
    outer.setSolids({data:packed,bytesPerRow:256,rowsPerImage:32},label);
    const fineMask=fine.solidMask;
    const producer=createCompositeProducerLayout({geometry:{shape:[16,32,16],min:[-2,-2,-2],cellWidth:.25,fine:{min:[-1,-1,-1],max:[1,1,1],ratio:4}},fineSolids:{cells:fineMask?.cells??new Uint8Array(32**3),shape:[32,32,32],revision:fineMask?.revision||'disabled'},coarseSolids:{cells:coarseCells,shape:[16,32,16],revision:label}});
    const layout=createCompositeStorageLayout(producer.grid),lower=alloc(layout.lowerLength*4),raw=new Float32Array(layout.coarseLength),seed=alloc(raw.byteLength);
    const lowerValues=new Float32Array(layout.lowerLength);lowerValues.fill(.2,layout.lowerOffsets[1],layout.lowerOffsets[2]);device.queue.writeBuffer(lower,0,lowerValues);
    const lowerExport=createCompositeLowerFaceGPU(device,{dims:fine.dims,lowerBuffer:lower,lowerFaceTexture:fine.lowerFaceTexture});
    for(let i=0;i<raw.length;i+=8)raw[i+1]=.2/16;device.queue.writeBuffer(seed,0,raw);
    const target=createCompositeProducerGPU(device,producer),solver=createCompositePCGGPU(device,producer.grid,{tolerance:sequence?1e-3:1e-5});let bridge;
    try{
      let e=device.createCommandEncoder();outer.encodeExternalProjection(e,fine.fluidReadIndex,fine.timeStep,(enc,state)=>enc.copyBufferToBuffer(seed,0,state,0,raw.byteLength),0);
      lowerExport.encode(e);outer.encodeGhostSnapshot(e,fine.ghosts.textures);device.queue.submit([e.finish()]);
      p.bindJoinedGhostGeneration(fine.simStepCount);const before=fine.simStepCount;
      check((await p.sampleFrame({advanceSim:true,includeRgba:false,now:1100})).ok,'predictor failed');fine=p.joinedProducerState();check(fine.simStepCount===before+1,'predictor did not advance');
      const predicted=await read(fine.fluidBuffer);predictedFields.push(predicted);
      result.phase=label+'-projection';
      e=device.createCommandEncoder();outer.encodeExternalProjection(e,fine.fluidReadIndex,fine.timeStep,(enc,state)=>{
        bridge=createCompositeStorageGPU(device,layout,{fine:fine.fluidBuffer,coarse:state,lower,flux:solver.fluxBuffer});
        bridge.encodeGather(enc,{interfaceSource:'fine'});target.encode(enc,{targetTexture:fine.burnRateTexture,solidRevisions:producer.solidRevisions});
        solver.encodeGPU(enc,{targetBuffer:target.targetBuffer,iterations:256,reset:true});
        if(fault!=='no-scatter'){bridge.encodeScatter(enc);lowerExport.encode(enc);}
      },0);outer.encodeGhostSnapshot(e,fine.ghosts.textures);device.queue.submit([e.finish()]);
      const pressure=await solver.readback(),projected=await read(fine.fluidBuffer),exterior=await outer.readState();projectedFields.push(projected);
      const arm={wall,before,pressure:pressure.receipt,outer:outer.receipt(),solidRevisions:producer.solidRevisions,geometry:producer.grid.geometry,raw:{}};result.arms.push(arm);
      for(const [kind,a]of Object.entries({predicted,projected,outer:exterior,flux:pressure.flux,pressure:pressure.pressure,target:pressure.target,mask:Float32Array.from(coarseCells)}))arm.raw[kind]=await retain(label+'-'+kind+'.f32',a);
      // A functional feedback witness may retain a near-converged correction;
      // it must not re-label that result as meeting the solver's 1e-5 target.
      arm.pressureAdmission={kind:'provisional-functional-only',strictConverged:pressure.converged,diagnosticResidualCeiling:1e-3,productionAccepted:false};
      check(!pressure.receipt.breakdown,'pressure breakdown');check(pressure.receipt.maxDivergenceError<=1e-3,'pressure too inaccurate for functional diagnostic');
      p.bindJoinedGhostGeneration(fine.simStepCount);const step=fine.simStepCount;
      result.phase=label+'-next-fine';check((await p.sampleFrame({advanceSim:true,includeRgba:false,now:1200})).ok,'next fine failed');fine=p.joinedProducerState();check(fine.simStepCount===step+1,'next fine did not advance');
      check(fine.ghosts.bound&&!fine.ghosts.synthetic,'next fine lacked actual exterior snapshot');
      const next=await read(fine.fluidBuffer);nextFields.push(next);arm.raw.next=await retain(label+'-next.f32',next);
      arm.effective={after:fine.simStepCount,timeStep:fine.timeStep,ghostGeneration:fine.ghosts.generation,source:p.debugState().coreEmitterSourceReceipt};
      check([predicted,projected,exterior,next].every(a=>a.every(Number.isFinite)),'nonfinite state');check(!result.gpuErrors.length,result.gpuErrors.join('\n'));
      if(sequence){
        arm.sequence=[];
        for(let step=1;step<=result.sequence.steps;step++){
          result.phase=label+'-warm-step-'+step;
          bridge.destroy();
          const encoder=device.createCommandEncoder();
          outer.encodeExternalProjection(encoder,fine.fluidReadIndex,fine.timeStep,(enc,state)=>{
            bridge=createCompositeStorageGPU(device,layout,{fine:fine.fluidBuffer,coarse:state,lower,flux:solver.fluxBuffer});
            bridge.encodeGather(enc,{interfaceSource:'fine'});
            target.encode(enc,{targetTexture:fine.burnRateTexture,solidRevisions:producer.solidRevisions});
            solver.encodeGPU(enc,{targetBuffer:target.targetBuffer,iterations:result.sequence.warmIterations,reset:false});
            bridge.encodeScatter(enc);lowerExport.encode(enc);
          },0);
          outer.encodeGhostSnapshot(encoder,fine.ghosts.textures);device.queue.submit([encoder.finish()]);
          const solved=await solver.readback();
          const n=String(step).padStart(2,'0');
          const row={step,before:fine.simStepCount,pressure:solved.receipt};arm.sequence.push(row);
          for(const [kind,a]of Object.entries({flux:solved.flux,pressure:solved.pressure,target:solved.target,projected:await read(fine.fluidBuffer),outer:await outer.readState()})){
            arm.raw[n+'-'+kind]=await retain(label+'-step-'+n+'-'+kind+'.f32',a);
          }
          check(!solved.receipt.breakdown,'warm pressure breakdown');
          check(solved.receipt.maxDivergenceError<=result.sequence.tolerance,'warm pressure missed diagnostic tolerance');
          if(fault!=='stale-generation'||step!==2)p.bindJoinedGhostGeneration(fine.simStepCount);
          const beforeStep=fine.simStepCount;
          check((await p.sampleFrame({advanceSim:true,includeRgba:false,now:1200+step*1000/60})).ok,'warm fine frame failed');
          fine=p.joinedProducerState();row.after=fine.simStepCount;
          check(fine.simStepCount===beforeStep+1,'warm fine did not advance exactly once');
          check(fine.ghosts.bound&&!fine.ghosts.synthetic,'warm fine lacked actual exterior snapshot');
          const evolved=await read(fine.fluidBuffer);check(evolved.every(Number.isFinite),'nonfinite warm fine state');
          arm.raw[n+'-next']=await retain(label+'-step-'+n+'-next.f32',evolved);
          nextFields[nextFields.length-1]=evolved;
          check(!result.gpuErrors.length,result.gpuErrors.join('\n'));
        }
      }
    }finally{bridge?.destroy();solver.destroy();target.destroy();seed.destroy();lower.destroy();outer.destroy();}
  }
  const delta=(arrays,slots)=>{let max=0,index=-1;for(let i=0;i<arrays[0].length;i++)if(slots.includes(i%16)){const d=Math.abs(arrays[0][i]-arrays[1][i]);if(d>max){max=d;index=i;}}return {max,index};};
  result.comparison={predicted:delta(predictedFields,Array.from({length:16},(_,i)=>i)),projectedVelocity:delta(projectedFields,[0,1,2]),nextVelocity:delta(nextFields,[0,1,2]),nextSoot:delta(nextFields,[4])};
  check(result.comparison.predicted.max===0,'wall changed the common predictor before shared solve');
  check(result.comparison.projectedVelocity.max>1e-5,'exterior wall did not change returned fine velocity');
  check(result.comparison.nextVelocity.max>1e-5,'next fine step did not consume wall-dependent correction');
  check(result.comparison.nextSoot.max>1e-8,'next fine material did not respond to changed airflow');
  result.phase='complete';return result;
};
