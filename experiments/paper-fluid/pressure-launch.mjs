import {discriminatorConfiguration,BASE_VOLUME,DISCRIMINATOR_DT} from '../../fluid-core-discriminator-view.mjs';

export const DERIVED_MAIN_COMPLIANCE=6.151275623129607;
export function pressureLaunchSetup({compliance=0}={}){
 if(!Number.isFinite(compliance)||compliance<0||!Number.isFinite(Math.fround(compliance)))throw new RangeError('Main compliance must be finite, nonnegative and GPU representable');
 const solver=discriminatorConfiguration({arm:'reduced',fixture:'drop',coefficient:0});
 return {dt:DISCRIMINATOR_DT,support:{kind:'analytical',truthScene:'multi_regime_playground'},
  sampling:{basePressureRadius:.185,pressureRadius:.125,particleVolume:BASE_VOLUME,representedVolume:BASE_VOLUME*solver.particleCount},
  solver:{...solver,ipbfCompliance:compliance,ipbfDamping:false,livePressureControls:false,substeps:1},
  guide:{question:'Does finite main compliance suppress this drop’s pressure pulse?',
   tryThis:'Run a short interval, pause and reset to compare the hard solve with the derived finite-compliance link. The initial water, pressure radius, timestep and four passes stay fixed.',
   whyThisMatters:'This is the exact coarse drop used in the first-frame diagnosis. Surface force and artificial damping are disabled in both arms. Motion beyond the first frame is a provisional observation, not an accepted water preset.'}};
}

// Read the actual host configuration before advertising this fixed isolation.
// Adjustable contributions still own their ordinary URL replay semantics.
export function assertPressureLaunchState(setup,state){
 const actual=state?.runtime,ipbf=actual?.ipbfSettings;
 const fields=[['pressure solver',actual?.pressureSolver,setup.solver.pressureSolver],
  ['particle count',actual?.particleCount,setup.solver.particleCount],
  ['pressure passes',actual?.densityIterationsPerStep,setup.solver.densityIterations],
  ['surface force',actual?.capillaryStrength,setup.solver.capillaryStrength],
  ['substeps',actual?.substeps,setup.solver.substeps],
  ['main compliance',ipbf?.compliance,setup.solver.ipbfCompliance],
  ['artificial damping',ipbf?.damping,setup.solver.ipbfDamping],
  ['pressure radius',ipbf?.radius,setup.sampling.pressureRadius],
  ['particle volume',ipbf?.particleVolume,setup.sampling.particleVolume],
  ['timestep',state?.clock?.fixedTimeStepSeconds,setup.dt]];
 for(const [name,value,expected]of fields){
  if(value!==expected&&!(typeof expected==='number'&&value===Math.fround(expected)))
   throw Error(`Fixed pressure preview configuration mismatch: ${name} is ${String(value)}, expected ${String(expected)}. Open the clean experiment link without conflicting numerical replay settings.`);
 }
 return state;
}

/** Monitors the host clock; it never advances physics or owns a render loop. */
export function createObservedRunWindow({read,pause,record=()=>{},onState=()=>{},requestFrame,cancelFrame,setTimer,clearTimer}){
 let active=null,frame=null,timer=null,closed=false,last=null;
 const clear=()=>{if(frame!==null)cancelFrame(frame);if(timer!==null)clearTimer(timer);frame=timer=null;};
 function stop(reason='manual-pause'){
  if(!active)return last;
  const current=active;active=null;clear();
  try{const clock=read().clock;if(clock.generation!==current.generation)throw Error('Preview generation changed');
   pause(true);last={...current,endStep:clock.step,reason,complete:reason==='interval-complete'};onState(last);record({kind:'paper.pressure-preview.run',phase:'applied',target:'water',effective:last,clock:read().clock});
  }catch(error){last={...current,reason:'expired',error:error.message};record({kind:'paper.pressure-preview.run',phase:'failed',target:'water',effective:last});}
  return last;
 }
 function watch(){frame=null;if(!active)return;try{const clock=read().clock;
  if(clock.generation!==active.generation)throw Error('Preview generation changed');
  if(clock.step>=active.targetStep){stop('interval-complete');return;}
  if(clock.paused){stop('externally-paused');return;}
  frame=requestFrame(watch);
 }catch(error){stop('expired');}}
 return {run({steps,maxWallSeconds}){
  if(closed)throw Error('Preview run window is disposed');if(active)throw Error('A preview interval is already running');
  const clock=read().clock;
  if(!Number.isSafeInteger(steps)||steps<=0||!Number.isSafeInteger(clock.step+steps))throw new RangeError('Preview steps must be a positive safe integer');
  if(!Number.isFinite(maxWallSeconds)||maxWallSeconds<=0||maxWallSeconds*1000>2147483647)throw new RangeError('Preview wall budget is outside timer capacity');
  active={startStep:clock.step,targetStep:clock.step+steps,generation:clock.generation,steps,maxWallSeconds};
  try{timer=setTimer(()=>stop('wall-budget'),maxWallSeconds*1000);frame=requestFrame(watch);pause(false);
   onState({...active,reason:'running'});record({kind:'paper.pressure-preview.run',phase:'started',target:'water',requested:{steps,maxWallSeconds},effective:active,clock:read().clock});return {...active};
  }catch(error){stop('start-failed');throw error;}
 },stop,state:()=>active?{...active,reason:'running'}:last,dispose(){if(closed)return;stop('disposed');closed=true;clear();}};
}

export const pressureLaunchExperiment={id:'paper/pressure-launch',title:'IPBF pressure launch · main compliance',
 async create({host,inputs={},record}){
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||Object.keys(inputs).some(k=>k!=='compliance'))throw new TypeError('Pressure preview accepts only main compliance');
  const setup=pressureLaunchSetup(inputs),water=await host.fluid.open(setup);
  try{
  assertPressureLaunchState(setup,water.read());
  const win=host.controls?.document?.defaultView;
  if(!win||typeof win.requestAnimationFrame!=='function')throw Error('Shared browser lifecycle unavailable');
  let mounted=null;
  const run=createObservedRunWindow({read:water.read,pause:water.setPaused,record,onState:value=>mounted?.update(value),
   requestFrame:fn=>win.requestAnimationFrame(fn),cancelFrame:id=>win.cancelAnimationFrame(id),setTimer:(fn,ms)=>win.setTimeout(fn,ms),clearTimer:id=>win.clearTimeout(id)});
  const read=()=>({...assertPressureLaunchState(setup,water.read()),setup,runWindow:run.state()});
  const frame=()=>{const operation=win.kaminosFingerFluidBenchSetCameraForWitness;if(typeof operation!=='function')throw Error('Shared camera operation unavailable');return operation({yaw:-.55,pitch:.3,distance:5.5,target:[-1.4,.8,.45]});};
  return {read,operations:{
   run({seconds=2,maxWallSeconds=30}={}){if(!Number.isFinite(seconds)||seconds<=0)throw Error('Positive simulated interval required');assertPressureLaunchState(setup,water.read());win.kaminosFingerFluidBenchResumeAfterWitness();return run.run({steps:Math.ceil(seconds/setup.dt),maxWallSeconds});},
   pause(){return run.stop('manual-pause');},
   advance(steps=1){run.stop('manual-step');const clock=water.read().clock;if(!Number.isSafeInteger(steps)||steps<=0)throw Error('Positive frame count required');const result=water.advanceTo(clock.step+steps);win.kaminosFingerFluidBenchResumeAfterWitness();record({kind:'paper.pressure-preview.advance',phase:'applied',target:'water',requested:steps,effective:result,clock:water.read().clock});return result;},
   async restart(){run.stop('reset');const result=await water.restart();record({kind:'paper.pressure-preview.restart',phase:'applied',target:'water',effective:result});return result;},frame,
  },async mount({root,document,invoke}){
   const node=document.createElement('section');node.className='paper-pressure-preview';
   const title=document.createElement('h3');title.textContent=setup.guide.question;node.append(title);
   const description=document.createElement('p');description.textContent=`Main compliance ${setup.solver.ipbfCompliance.toPrecision(6)} · 1,209 particles · R 0.125 · four passes · dt 1/60 · surface and artificial damping off.`;node.append(description);
   const explanation=document.createElement('p');explanation.textContent=setup.guide.whyThisMatters;node.append(explanation);
   const label=document.createElement('label');label.textContent='Simulated seconds per run ';const seconds=document.createElement('input');seconds.type='number';seconds.value='2';seconds.min='0';seconds.step='.2';label.append(seconds);node.append(label);
   const budget=document.createElement('p');budget.textContent='Starts paused. Each click has a 30-second wall budget. Switching away pauses the water. Camera stays interactive; this does not claim Greenroom handoff.';node.append(budget);
   const status=document.createElement('output');status.setAttribute('aria-live','polite');node.append(status);
   const listeners=[];
   for(const [text,operation,input]of [['Run interval','run',()=>({seconds:Number(seconds.value),maxWallSeconds:30})],['Pause','pause',()=>undefined],['Step one frame','advance',()=>1],['Reset drop','restart',()=>undefined],['Frame drop','frame',()=>undefined]]){
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=text;node.append(button);
    const click=async()=>{try{const result=await invoke(operation,input());status.textContent=operation==='run'?'Running explicit interval; automatic pause armed.':JSON.stringify(result??{operation});}catch(error){status.textContent=error.message;}};button.addEventListener('click',click);listeners.push(()=>button.removeEventListener('click',click));
   }
   const inactive=()=>{const result=run.stop('inactive-window');if(result)status.textContent='Paused: '+result.reason;};
   const hidden=()=>{if(document.hidden)inactive();};win.addEventListener('blur',inactive);document.addEventListener('visibilitychange',hidden);
   root.append(node);
   mounted={update(value){status.textContent=value?.reason==='running'?`Running to frame ${value.targetStep}; ${value.maxWallSeconds}s wall budget.`:value?`Paused at frame ${value.endStep??'unknown'}: ${value.reason}.`:'Paused; choose an explicit interval.';},dispose(){win.removeEventListener('blur',inactive);document.removeEventListener('visibilitychange',hidden);for(const remove of listeners)remove();node.remove();}};
   mounted.update(run.state());await invoke('frame');return mounted;
  },async dispose(){run.dispose();mounted?.dispose();await water.dispose();}};
  }catch(error){await water.dispose();throw error;}
 }};
