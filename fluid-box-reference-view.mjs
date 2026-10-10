import {createWebGPUFingerFluidSolver} from './finger-fluid-webgpu-core.js';
import {createFingerFluidBoxReference} from './finger-fluid-discriminator.mjs';

export function boxReferenceConfiguration({scene='block_drop',resolution=24,radiusRatio=2,passes=2,gamma=0,beta=.0113,dt=1/240}={}){
  const fixture=createFingerFluidBoxReference({scene,resolution});
  if(!Number.isFinite(radiusRatio)||radiusRatio<=0||!Number.isSafeInteger(passes)||passes<1||!Number.isFinite(gamma)||gamma<0||!Number.isFinite(beta)||beta<=0||![1/240,1/120,1/60].includes(dt))throw new RangeError('Invalid box reference controls');
  return {fixture,dt,solver:{particleCount:fixture.particleCount,diagnosticPopulation:fixture.population,diagnosticBox:fixture.box,
    diagnosticDynamics:'pressure_surface',pressureSolver:'ipbf',cohesionModel:'akinci_2013',capillaryStrength:gamma,
    ipbfBoundaryMode:'tangent_plane',ipbfPressureRadiusScale:radiusRatio*fixture.spacing/(.185*Math.cbrt(fixture.population.particleVolumeScale)),
    akinciSupportRadius:fixture.surfaceRadius,densityIterations:passes,ipbfDampingBeta:beta,livePressureControls:true,
    energyDiagnosticsMode:'disabled',adaptiveDensity:false,rendererMode:'sphere_debug',truthScene:'multi_regime_playground',
    supportFriction:0,unsupportedSheetStrength:0,particleShiftStrength:0,chemistryDiffusion:0}};
}

if(typeof document!=='undefined'&&document.getElementById('water')){
  const $=id=>document.getElementById(id),q=new URLSearchParams(location.search),canvas=$('water');
  let running=false,solver,device,yaw=-.45,pitch=.38,distance=5.3,errors=[];
  const numeric=(key,fallback)=>q.has(key)?Number(q.get(key)):fallback;
  $('scene').value=q.get('scene')??'block_drop';$('resolution').value=numeric('resolution',24);
  $('ratio').value=$('ratioValue').value=numeric('ratio',2);$('passes').value=$('passesValue').value=numeric('passes',2);
  $('gamma').value=$('gammaValue').value=numeric('gamma',0);$('beta').value=numeric('beta',.0113);$('dt').value=numeric('dt',1/240);
  $('view').value=q.get('view')??'sphere_debug';
  const settings=()=>({scene:$('scene').value,resolution:Number($('resolution').value),radiusRatio:Number($('ratioValue').value),passes:Number($('passesValue').value),gamma:Number($('gammaValue').value),beta:Number($('beta').value),dt:Number($('dt').value)});
  const url=()=>{const next=new URL(location.href);const s=settings();for(const [k,v] of Object.entries({scene:s.scene,resolution:s.resolution,ratio:s.radiusRatio,passes:s.passes,gamma:s.gamma,beta:s.beta,dt:s.dt,view:$('view').value,auto:1}))next.searchParams.set(k,String(v));next.searchParams.delete('harness');return next.href;};
  const fail=e=>{running=false;window.discriminatorError=String(e.stack??e);$('error').textContent=window.discriminatorError;$('play').disabled=true;};
  const render=(mode=$('view').value)=>solver.render({rendererMode:mode,diagnosticGlyphScale:mode==='sphere_debug'?.3:1,width:canvas.clientWidth,height:canvas.clientHeight,pixelRatio:1,yaw,pitch,distance,target:[0,.25,0]});
  const status=()=>{const d=solver.getDebugState(),f=window.discriminator.fixture,c=d.livePressureControls;const time=d.stepCount*window.discriminator.dt;
    $('status').textContent=`${running?'Running':'Paused'} · ${f.particleCount.toLocaleString()} particles · simulated ${time.toFixed(3)} s\nSpacing ${f.spacing.toFixed(5)} · pressure R/d ${(d.ipbfSettings.radius/f.spacing).toFixed(3)} · surface R/d 2\n${d.densityIterations??c.effective.densityIterations} passes · dt ${window.discriminator.dt.toFixed(6)} s · volume ${f.representedVolume.toFixed(3)}\nNative ${d.adapterInfo.vendor}/${d.adapterInfo.architecture} · ${d.diagnosticDynamics.effective}\n${c.generation===c.effectiveGeneration?'Controls submitted':'Edits pending next step'} · six pressure/collision planes`;
    $('play').textContent=running?'Pause':'Play';$('share').href=url();};
  window.discriminatorBoot=(async()=>{
    const config=boxReferenceConfiguration(settings()),adapter=await navigator.gpu.requestAdapter();
    if(!adapter||adapter.info?.vendor!=='apple'||adapter.info?.isFallbackAdapter!==false)throw Error('Native Apple WebGPU required for this reference control');
    device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:adapter.limits.maxStorageBuffersPerShaderStage}});
    device.addEventListener('uncapturederror',e=>{errors.push(e.error.message);fail(e.error);});device.lost.then(x=>{if(x.reason!=='destroyed')fail(Error('Device lost: '+x.message));});
    solver=await createWebGPUFingerFluidSolver({...config.solver,canvas,webgpuDevice:device});
    if(!solver.available)throw Error('Solver unavailable: '+JSON.stringify(solver));
    const {population,...fixture}=config.fixture;
    window.discriminator={fixture,dt:config.dt,errors,config:{...config.solver,diagnosticPopulation:{...population,particleData:undefined}},
      debug:()=>solver.getDebugState(),snapshot:()=>solver.requestDiagnostics({captureParticleState:true}),
      advance:async n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid step count');running=false;for(let i=0;i<n;i++)solver.step(config.dt);await device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));status();},
      render:async mode=>{running=false;$('view').value=mode;render(mode);await device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));status();},
      controls:patch=>solver.setPressureControls(patch),stop:()=>{running=false;},destroy:()=>{running=false;solver.destroy();device.destroy();}};
    render();$('play').disabled=false;running=q.get('harness')!=='1'&&q.get('auto')!=='0';status();
    const frame=()=>{try{if(running)for(let i=0;i<4;i++)solver.step(config.dt);render();status();if(!window.discriminatorError)requestAnimationFrame(frame);}catch(e){fail(e);}};
    if(q.get('harness')!=='1')requestAnimationFrame(frame);
    return {fixture,config:window.discriminator.config,adapter:solver.getDebugState().adapterInfo,dt:config.dt};
  })();window.discriminatorBoot.catch(fail);
  $('play').onclick=()=>{running=!running;};$('reset').onclick=()=>location.assign(url());$('restart').onclick=()=>location.assign(url());
  const update=()=>{try{const s=settings();const f=window.discriminator.fixture;solver.setPressureControls({pressureRadiusScale:s.radiusRatio*f.spacing/(.185*Math.cbrt(solver.getDebugState().diagnosticDynamics.population.particleVolume/((64*Math.PI/315)*.185**3/24.3))),densityIterations:s.passes,capillaryStrength:s.gamma,beta:s.beta});$('share').href=url();}catch(e){$('error').textContent=String(e.message);}};
  for(const id of ['ratio','passes','gamma']){const range=$(id),number=$(id+'Value');range.oninput=()=>{number.value=range.value;update();};number.oninput=()=>{if(Number(number.value)>Number(range.max))range.max=number.value;range.value=number.value;update();};}
  $('beta').oninput=update;$('view').onchange=()=>{if(solver){render();status();}};
  let anchor;canvas.onpointerdown=e=>{anchor=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=()=>{anchor=null;};canvas.onpointermove=e=>{if(anchor){yaw+=(e.clientX-anchor[0])*.006;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-anchor[1])*.006));anchor=[e.clientX,e.clientY];}};canvas.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(1,Math.min(14,distance*Math.exp(e.deltaY*.001)));},{passive:false});
}
