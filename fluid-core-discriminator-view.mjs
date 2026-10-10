import {createWebGPUFingerFluidSolver,createFingerFluidDiscriminatorPopulation} from './finger-fluid-webgpu-core.js';
export const DISCRIMINATOR_ARMS=Object.freeze(['assembled','reduced','fine']);
export const BASE_VOLUME=(64*Math.PI/315)*.185**3/24.3;
export const DISCRIMINATOR_DT=1/60;
export function discriminatorConfiguration({arm='assembled',fixture='basin',coefficient=.19}={}) {
  if(!DISCRIMINATOR_ARMS.includes(arm))throw new RangeError('Unknown discriminator arm');
  const population=createFingerFluidDiscriminatorPopulation({fixture,refinement:arm==='fine'?2:1});
  return {particleCount:population.particleCount,diagnosticPopulation:population,
    diagnosticDynamics:arm==='assembled'?'assembled':'pressure_surface',
    pressureSolver:'ipbf',cohesionModel:'akinci_2013',capillaryStrength:coefficient,
    ipbfPressureRadiusScale:.125/(.185*Math.cbrt(population.particleVolumeScale)),
    akinciSupportRadius:2*Math.cbrt(BASE_VOLUME),densityIterations:4,ipbfDampingBeta:.0113,
    livePressureControls:true,energyDiagnosticsMode:'disabled',adaptiveDensity:false,
    rendererMode:'screen_space_refraction',truthScene:'multi_regime_playground',
    unsupportedSheetStrength:0,particleShiftStrength:0,chemistryDiffusion:0};
}
if(typeof document!=='undefined'&&document.getElementById('water')) {
  const params=new URLSearchParams(location.search),canvas=document.getElementById('water'),status=document.getElementById('status'),button=document.getElementById('play'),view=document.getElementById('view');
  let running=false,yaw=-.55,pitch=.45,distance=5.5,solver,failures=[],device;
  const fail=e=>{running=false;window.discriminatorError=String(e.stack??e);document.getElementById('error').textContent=window.discriminatorError;button.disabled=true;};
  const render=(mode=view.value)=>{solver.render({rendererMode:mode,width:canvas.clientWidth,height:canvas.clientHeight,pixelRatio:1,yaw,pitch,distance,target:[0,-.05,0]});};
  window.discriminatorBoot=(async()=>{
    const config=discriminatorConfiguration({arm:params.get('arm')??'assembled',fixture:params.get('fixture')??'basin',coefficient:params.has('gamma')?Number(params.get('gamma')):.19});
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter||adapter.info?.vendor!=='apple'||adapter.info?.isFallbackAdapter!==false)throw Error('Native Apple WebGPU required for this experiment');
    device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:adapter.limits.maxStorageBuffersPerShaderStage}});
    device.addEventListener('uncapturederror',e=>{failures.push(e.error.message);fail(e.error);});device.lost.then(x=>fail(Error('Device lost: '+x.message)));
    solver=await createWebGPUFingerFluidSolver({...config,canvas,webgpuDevice:device});
    if(!solver.available)throw Error('Solver unavailable: '+JSON.stringify(solver));
    window.discriminator={config:{...config,diagnosticPopulation:{...config.diagnosticPopulation,particleData:undefined}},adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,fallback:adapter.info.isFallbackAdapter},errors:failures,
      debug:()=>solver.getDebugState(),snapshot:()=>solver.requestDiagnostics({captureParticleState:true}),
      advance:async n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid step count');running=false;for(let i=0;i<n;i++)solver.step(DISCRIMINATOR_DT);await device.queue.onSubmittedWorkDone();if(failures.length)throw Error(failures.join('\n'));},
      render:async mode=>{running=false;render(mode);await device.queue.onSubmittedWorkDone();if(failures.length)throw Error(failures.join('\n'));},
      stop:()=>{running=false;},destroy:()=>{running=false;solver.destroy();device.destroy();}};
    render();button.disabled=false;running=params.get('auto')==='1';
    const frame=()=>{try{if(running)solver.step(DISCRIMINATOR_DT);render();const d=solver.getDebugState();status.textContent=`${config.diagnosticDynamics} · ${config.particleCount.toLocaleString()} samples · finite initial water\nStep ${d.stepCount} · pressure radius ${d.ipbfSettings.radius.toFixed(3)} · surface support ${d.cohesionSettings.neighborhoodRadius.toFixed(3)} · γ ${config.capillaryStrength}\nSame physical water and supports in all arms. Drag to orbit; scroll to zoom. ${running?'Running':'Paused'}`;button.textContent=running?'Pause':'Play';requestAnimationFrame(frame);}catch(e){fail(e);}};
    // Harness mode has no animation loop: rendering cannot race a state capture.
    if(params.get('harness')!=='1')requestAnimationFrame(frame);
    button.onclick=()=>{running=!running;};document.getElementById('reset').onclick=()=>location.reload();
    let anchor;canvas.onpointerdown=e=>{anchor=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=()=>{anchor=null;};canvas.onpointermove=e=>{if(anchor){yaw+=(e.clientX-anchor[0])*.006;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-anchor[1])*.006));anchor=[e.clientX,e.clientY];}};canvas.onwheel=e=>{e.preventDefault();distance=Math.max(1,Math.min(14,distance*Math.exp(e.deltaY*.001)));};
    return {config:window.discriminator.config,adapter:window.discriminator.adapter};
  })();window.discriminatorBoot.catch(fail);
}
