// Provisional visible consumer of the reviewed joined-pressure sequence.
// Controlled-step readbacks deliberately make this unsuitable for timing claims.
import * as THREE from '/fine/lib/three.core.js';
import {createKaminosVolumePrototype} from '/fine/volume-core.js';
import {createOuterSmoke} from '/outer/volume-outer-smoke.mjs';
import {createCompositeProducerLayout} from '/outer/volume-composite-producer.mjs';
import {createCompositeProducerGPU} from '/outer/volume-composite-producer-gpu.mjs';
import {createCompositeStorageLayout} from '/outer/volume-composite-storage.mjs';
import {createCompositeStorageGPU,createCompositeLowerFaceGPU} from '/outer/volume-composite-storage-gpu.mjs';
import {createCompositePCGGPU} from '/outer/volume-composite-pcg-gpu.mjs';

const $=id=>document.getElementById(id), check=(v,m)=>{if(!v)throw Error(m);};
const nextFrame=window.requestAnimationFrame.bind(window);
// This dedicated page owns scheduling; the prototype's autonomous draw must not
// race the external correction between predictor and presentation.
window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};
let active=null, paused=false, rebuilding=false, inFlight=Promise.resolve(), generation=0;
const evidence=window.joinedPreview={phase:'initializing',generation:0,steps:0,gpuErrors:[],
  claim:'immersed authored-raw fine flame with actual exterior flow/material feedback; exterior not drawn; diagnostic scheduling, not timing evidence'};
async function checkpoint(){await fetch('/checkpoint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(evidence)});}
function fail(error){paused=true;evidence.phase='failed';evidence.error=String(error.stack||error);$('error').textContent=evidence.error;void checkpoint();}
window.addEventListener('error',e=>fail(e.error||e.message));
window.addEventListener('unhandledrejection',e=>fail(e.reason));
function liveControls(){return {immersedSpeed:Number($('inlet').value),immersedFuel:Number($('fuel').value),immersedTemperature:Number($('heat').value),physicalSmokeExtinction:Number($('extinction').value),physicalExposureEV:Number($('exposure').value)};}
function status(){const r=evidence.pressure;$('status').textContent=`${evidence.phase}\nFine ${evidence.fine?.join('×')} / coarse ${evidence.coarse?.join('×')}\nSource: immersed, authored-raw\nStep ${evidence.steps}; generation ${generation}\n${evidence.backend||''}\n${r?`Pressure error ${r.maxDivergenceError.toExponential(2)}; iterations ${r.iterations ?? r.iteration ?? '?'}\n`:''}Exterior roof: ${evidence.roof?'on':'off'}\n${paused?'Paused':'Running (diagnostic readbacks)'}`;}
async function dispose(){if(!active)return;await active.device.queue.onSubmittedWorkDone();for(const b of active.bridges)b.destroy();active.solver.destroy();active.target.destroy();active.lower.destroy();active.outer.destroy();active.p.dispose();active=null;}
async function rebuild(){
  if(rebuilding)return;rebuilding=true;$('apply').disabled=true;
  try{
    // loop already records the failed step; restart must await settlement,
    // not replay its rejection before it can dispose the failed generation.
    await inFlight.catch(()=>{});await dispose();generation++;paused=false;$('pause').textContent='Pause';$('error').textContent='';
    const F=Number($('fine').value),N=Number($('coarse').value),E=2,H=2*E/N,roof=$('roof').checked;
    Object.assign(evidence,{phase:'initializing',generation,steps:0,fine:[F,F,F],coarse:[N,2*N,N],roof,gpuErrors:[],error:null,pressure:null});status();
    const c={resolution:F,gridHeightRatio:1,domainShape:'cube',emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',projection:1,pressureSolverIterations:32,
      advectionScheme:'maccormack',commonGasTransport:true,timeStep:'uniform',speed:1,velocityStaggering:'staggered',confinement:'off',windStrength:0,windModel:'off',
      renderScale:1,raySteps:128,lookFreeze:0,residualMode:'off',boundarySplatMode:'off',volumeScene:'tall_plume',
      fireRenderMode:'inspect',shellInspectMode:'boundary_fire',physicalColorMode:2,physicalMaterialLaw:1,
      physicalTemperature:3039,physicalTemperatureSpread:4699,physicalThermalStrength:7.8,physicalCleanStrength:1.562,physicalHighlightKnee:.79,physicalWhiteBalance:3549,
      physicalSmokeAlbedo:.49,physicalAmbient:0,density:.45,fire:0,smoke:.1,curl:0,flowRate:0,exposure:1,radiance:0,glow:0,
      reactionBoundaryGradient:4,reactionBoundaryCut:0,reactionBoundarySoftness:.005,reactionBoundaryCoreReject:0,reactionBoundaryTopology:2.5,reactionBoundaryCurl:2,reactionBoundaryDivergence:1,
      reactionBoundarySupportThermal:2,reactionBoundarySupportReaction:.56,reactionBoundarySupportFront:.42,reactionBoundarySupportInterface:.56,
      reactionBoundaryContrast:.773,reactionBoundaryGamma:1.75,reactionBoundaryOpacity:1.7,reactionBoundaryFireSoot:.54,reactionBoundaryFireCleanBlue:.084,
      reactionBoundaryFireYellow:.278,reactionBoundaryFireWarmth:.23,reactionBoundaryFireLuma:11.366,reactionBoundaryFireRidge:1.8,reactionBoundaryFireRidgeCut:.445,reactionBoundaryFireTip:2,reactionBoundaryFireErosion:.54,
      boundarySidecarSource:'baked',boundarySidecarView:'off',boundarySidecarBlur:0,boundarySidecarWidth:0,boundarySidecarRidge:1.58,
      microdetail:0,interfaceShred:5,fireLicks:5,artisticSwirl:false,phasedSway:false,proceduralDetailForces:true,
      immersedCentreX:0,immersedCentreY:-.5,immersedCentreZ:0,immersedRadius:.2,immersedPitch:90,...liveControls()};
    evidence.controls={...c};
    const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(0,.25,4.6);camera.lookAt(0,0,0);
    const p=createKaminosVolumePrototype({THREE,viewport:$('viewport'),camera,controls:{target:new THREE.Vector3()},getControls:()=>c,onStatus:s=>{evidence.coreStatus=s;}});
    window.joinedPrototype=p;p.setCoreEmitterSourceMode('analytic-only');check(p.setJoinedBoundary({enabled:true}).admitted,'joined boundary refused');
    p.setJoinedGhosts({originFine:Array(3).fill((1-E)*F/2),cellWidthFine:E*F/N,dims:[N,2*N,N],finePitchLocal:2/F});
    await p.setActive(true);const {device}=p.foregroundGpuContext();check(device,'actual GPU unavailable');
    device.addEventListener('uncapturederror',e=>{evidence.gpuErrors.push(e.error.message);fail(e.error);});evidence.backend=p.debugState().backend;
    let fine=p.joinedProducerState();const buffers=[];buffers[fine.fluidReadIndex]=fine.fluidBuffer;
    p.bindJoinedGhostGeneration(fine.simStepCount);
    check((await p.sampleFrame({advanceSim:true,includeRgba:false,now:1000})).ok,'initial fine predictor failed');
    fine=p.joinedProducerState();buffers[fine.fluidReadIndex]=fine.fluidBuffer;
    check(buffers.length===2&&buffers.every(Boolean)&&buffers[0]!==buffers[1],'ping-pong discovery failed');
    const outer=createOuterSmoke(device,{grid:N,extent:E,nearHeightRatio:1,pressureIterations:1,materialMode:'authored-raw'},F,buffers);
    const coarseCells=new Uint8Array(N*2*N*N),row=Math.ceil(N/256)*256,packed=new Uint8Array(row*2*N*N);
    if(roof){const y=Math.floor((1.5+E)/H);for(let z=0;z<N;z++)for(let x=0;x<N;x++)coarseCells[x+N*(y+2*N*z)]=1;}
    for(let z=0;z<N;z++)for(let y=0;y<2*N;y++)packed.set(coarseCells.subarray(N*(y+2*N*z),N*(y+2*N*z+1)),row*(y+2*N*z));
    outer.setSolids({data:packed,bytesPerRow:row,rowsPerImage:2*N},roof?'roof':'open');
    const producer=createCompositeProducerLayout({geometry:{shape:[N,2*N,N],min:[-E,-E,-E],cellWidth:H,fine:{min:[-1,-1,-1],max:[1,1,1],ratio:H/(2/F)}},fineSolids:{cells:fine.solidMask?.cells??new Uint8Array(F**3),shape:[F,F,F],revision:fine.solidMask?.revision||'disabled'},coarseSolids:{cells:coarseCells,shape:[N,2*N,N],revision:roof?'roof':'open'}});
    const layout=createCompositeStorageLayout(producer.grid),lower=device.createBuffer({size:layout.lowerLength*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
    const lowerExport=createCompositeLowerFaceGPU(device,{dims:fine.dims,lowerBuffer:lower,lowerFaceTexture:fine.lowerFaceTexture});
    const target=createCompositeProducerGPU(device,producer),solver=createCompositePCGGPU(device,producer.grid,{tolerance:1e-3});
    active={p,c,camera,device,outer,producer,layout,lower,lowerExport,target,solver,bridges:[],bridgeKeys:[],bootstrap:true,predicted:true};
    evidence.phase='running';await checkpoint();
  }catch(e){fail(e);}finally{rebuilding=false;$('apply').disabled=false;status();}
}
async function step(){
  const a=active;if(!a)return;
  const rect=$('viewport').getBoundingClientRect();a.camera.aspect=rect.width/rect.height;a.camera.updateProjectionMatrix();
  Object.assign(a.c,liveControls());a.p.setControls(a.c);evidence.controls={...a.c};
  let fine=a.p.joinedProducerState();
  if(!a.predicted){a.p.bindJoinedGhostGeneration(fine.simStepCount);const before=fine.simStepCount;check((await a.p.sampleFrame({advanceSim:true,includeRgba:false,now:1000+before*1000/60})).ok,'fine predictor failed');fine=a.p.joinedProducerState();check(fine.simStepCount===before+1,'fine predictor did not advance exactly once');}
  a.predicted=false;
  const encoder=a.device.createCommandEncoder();
  a.outer.encodeExternalProjection(encoder,fine.fluidReadIndex,fine.timeStep,(enc,state)=>{
    let index=a.bridgeKeys.findIndex(k=>k[0]===fine.fluidBuffer&&k[1]===state);
    if(index<0){index=a.bridges.length;a.bridgeKeys.push([fine.fluidBuffer,state]);a.bridges.push(createCompositeStorageGPU(a.device,a.layout,{fine:fine.fluidBuffer,coarse:state,lower:a.lower,flux:a.solver.fluxBuffer}));}
    const bridge=a.bridges[index];bridge.encodeGather(enc,{interfaceSource:'fine'});a.target.encode(enc,{targetTexture:fine.burnRateTexture,solidRevisions:a.producer.solidRevisions});
    a.solver.encodeGPU(enc,{targetBuffer:a.target.targetBuffer,iterations:a.bootstrap?256:128,reset:a.bootstrap});bridge.encodeScatter(enc);a.lowerExport.encode(enc);
  });
  a.outer.encodeGhostSnapshot(encoder,fine.ghosts.textures);a.device.queue.submit([encoder.finish()]);
  const solved=await a.solver.readback();evidence.pressure=solved.receipt;
  check(!solved.receipt.breakdown,'shared pressure breakdown');check(solved.receipt.maxDivergenceError<=1e-3,'shared pressure exceeded diagnostic residual tolerance');
  a.bootstrap=false;a.p.bindJoinedGhostGeneration(fine.simStepCount);
  const frame=await a.p.sampleFrame({advanceSim:false,includeRgba:false,presentToCanvas:true,now:1000+fine.simStepCount*1000/60});
  check(frame.ok,'projected frame presentation failed');evidence.frame={meanLuma:frame.meanLuma,litPixels:frame.litPixels,fireLikePixels:frame.fireLikePixels,width:frame.width,height:frame.height};
  evidence.steps=fine.simStepCount;evidence.effective={fine:fine.dims,ghosts:a.p.joinedProducerState().ghosts.geometry,ghostGeneration:a.p.joinedProducerState().ghosts.generation,physicalColor:a.p.debugState().physicalColor,source:a.p.debugState().coreEmitterSourceReceipt};
  check(!evidence.gpuErrors.length,'GPU error');status();
}
async function loop(){if(!paused&&!rebuilding&&active){inFlight=step();try{await inFlight;}catch(e){fail(e);}}nextFrame(loop);}
$('apply').onclick=()=>void rebuild();$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';status();void checkpoint();};
window.joinedPreviewCheckpoint=checkpoint;
await rebuild();nextFrame(loop);
