import {installRelativeNumberDrag} from './scene-control-history.mjs';
export function mountFluidBudgetCockpit(root,{read,apply,requestFrame}) {
 const document=root.ownerDocument,panel=document.createElement('section');panel.id='fluid-budget-cockpit';panel.className='fluid-reflection-cockpit';
 const heading=document.createElement('h3');heading.textContent='Water frame budget';panel.append(heading);
 const label=document.createElement('label');label.textContent='Water render resolution (%)';panel.append(label);
 const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center';
 const slider=document.createElement('input');slider.type='range';slider.min=1;slider.max=100;slider.step=1;slider.value='100';slider.dataset.fluidBudget='resolution-slider';slider.setAttribute('aria-label','Water render resolution slider');slider.style.cssText='flex:1;min-width:0';
 const number=document.createElement('input');number.type='number';number.min=1;number.max=100;number.step=1;number.value='100';number.dataset.fluidBudget='resolution';number.setAttribute('aria-label','Water render resolution percent');number.style.width='68px';row.append(slider,number);panel.append(row);
 const scaleText=document.createElement('div');scaleText.className='hint';panel.append(scaleText);
 const tradeoff=document.createElement('div');tradeoff.className='hint';tradeoff.textContent='Scene stays full resolution. Lower water resolution softens detail and thin edges; particle count and physics settings stay the same.';panel.append(tradeoff);
 const check=(key,text)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.fluidBudget=key;input.style.cssText='width:auto;margin:0 5px 0 0';label.append(input,document.createTextNode(text));panel.append(label);return input;};
 const energy=check('energy','Energy diagnostics');const energyText=document.createElement('div');energyText.className='hint';panel.append(energyText);
 const timing=check('timing','GPU stage timings (1 frame/sec)');const gpuText=document.createElement('div');gpuText.style.cssText='white-space:pre-line;font:11px/1.5 ui-monospace,monospace';gpuText.dataset.fluidBudget='gpu-readout';panel.append(gpuText);
 const errorText=document.createElement('div');errorText.className='error';panel.append(errorText);let error=null,start=1;
 function update(){
  const current=read();for(const input of [slider,number,energy,timing])input.disabled=!current.clock.available;
  const scale=current.viewport?.renderScale??1;
  if(document.activeElement!==number||number.readOnly)number.value=String(scale*100);
  if(document.activeElement!==slider)slider.value=String(scale*100);
  energy.checked=current.solver?.energy.enabled??false;timing.checked=current.viewport?.timing.enabled??false;
  const effective=current.viewport?.lastFrame?.waterResolution;
  scaleText.textContent=effective?`${effective.width} × ${effective.height} water · ${effective.fullWidth} × ${effective.fullHeight} scene · ${(effective.pixelFraction*100).toFixed(1)}% of water pixels`: 'Awaiting rendered extent';
  energyText.textContent=energy.checked?`Four energy-recording passes per simulation step · last measured step ${current.solver.energy.measuredStep??'none yet'}`:'Energy recording off · physics settings unchanged';
  const t=current.viewport?.timing,sample=t?.sample,reflection=current.reflection?.effective;
  const cameraKey=c=>c?JSON.stringify([c.identity,c.projectionType,c.viewport,Array.from(c.viewProjection,v=>Math.fround(v))]):null;
  const matching=sample && sample.paused===current.clock.paused && cameraKey(sample.camera)===cameraKey(current.viewport.lastFrame?.camera) && effective && sample.waterResolution.requestedScale===scale && sample.energy===current.solver.energy.mode && sample.reflection?.mode===reflection?.mode && sample.reflection?.fresnelCutoff===reflection?.fresnelCutoff;
  if(!t?.enabled)gpuText.textContent='GPU timings off';
  else if(t.status==='failed')gpuText.textContent=`GPU timings unavailable: ${t.failure}`;
  else if(sample && matching){
   const ms=key=>(sample.stageCoverage[key]??0).toFixed(2);
   const alone=key=>(sample.stages[key]??0).toFixed(2);
   gpuText.textContent=`GPU timestamp spans (overlap)\nSimulation       ${sample.simulationAdvanced?`${ms('simulation')} ms`:sample.paused?'0.00 ms (paused)':'not advanced in sample'}\nParticle drawing ${ms('accumulation')} ms\nOptical shading  ${ms('optical')} ms\nHost / resolve   ${ms('host')} ms\nExclusive sim / draw / optics\n${alone('simulation')} / ${alone('accumulation')} / ${alone('optical')} ms\nStage overlap    ${sample.overlapMs.toFixed(2)} ms\nUnassigned gaps  ${sample.gapMs.toFixed(2)} ms\nFirst–last span  ${sample.frameSpanMs.toFixed(2)} ms\nFrame ${sample.hostFrameId} · step ${sample.step} · ${Math.max(0,(performance.now()-sample.measuredAt)/1000).toFixed(1)}s ago\nStage spans may overlap; they are not additive execution costs. Use first–last span for the frame interval. Ray counting skips timing frames.`;
  }else gpuText.textContent=sample?'Previous settings · awaiting GPU timing frame':'Awaiting actual GPU timestamps';
  errorText.textContent=error??'';
 }
 function act(patch){try{apply(patch);error=null;}catch(e){error=e.message;}update();}
 slider.addEventListener('input',()=>act({renderScale:Number(slider.value)/100}));
 const setNumber=()=>{if(number.value.trim()===''){error='Enter a water resolution';update();return;}act({renderScale:Number(number.value)/100});};
 number.addEventListener('focus',()=>{start=read().viewport.renderScale;});number.addEventListener('input',setNumber);number.addEventListener('change',setNumber);number.addEventListener('pointercancel',()=>{act({renderScale:start});number.value=String(start*100);});number.addEventListener('keydown',e=>{if(e.key==='Enter'){setNumber();number.blur();}});number.addEventListener('blur',()=>{number.value=String(read().viewport.renderScale*100);});
 const scrub=installRelativeNumberDrag({input:number,step:1,onStart:()=>{start=read().viewport.renderScale;}});
 if(number.parentElement?.classList.contains('authoring-number-wrap')){number.parentElement.style.cssText='position:relative;display:inline-flex;flex:0 0 68px;width:68px';number.style.width='100%';}
 energy.addEventListener('change',()=>act({energyDiagnosticsMode:energy.checked?'every_step':'disabled'}));timing.addEventListener('change',()=>act({timingEnabled:timing.checked}));
 let live=true;
 const timer=setInterval(()=>{update();if(read().viewport?.timing.enabled){requestFrame();if(read().clock.paused)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(live&&read().clock.paused&&read().viewport?.timing.enabled)requestFrame();}));}},1000);
 root.prepend(panel);update();return {update,read,apply:act,destroy(){live=false;clearInterval(timer);scrub.stop();panel.remove();}};
}
