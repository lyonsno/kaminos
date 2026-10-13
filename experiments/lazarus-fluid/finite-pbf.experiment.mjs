import {createSimulationTransport,mountSimulationTransport} from '../../simulation-transport.mjs';
import {exportLiveFluidSequence} from '../../live-fluid-sequence.mjs';
import {lazarusFiniteSetup,lazarusFiniteReplayURL} from './contributions.mjs';
import {targetStep} from '../../finger-fluid-box-clock.mjs';
export default {
 id:'lazarus/finite-pbf',title:'PBF · drop, dam break and puddle',
 async create({host,inputs,record}){
  let setup=lazarusFiniteSetup(inputs),water=await host.fluid.open(setup,{restoreReplay:false}),node=null,timer=null,scrubs=[],transportUI=null;
  const read=()=>{const state=water.read(),v=state.controls?.effective;if(v){const keys=['particleRepulsionStrength','densityIterations','capillaryStrength','freeFlightViscosityBoost'];if(keys.some(k=>v[k]!==setup.inputs[k]))setup=lazarusFiniteSetup({...setup.inputs,...Object.fromEntries(keys.map(k=>[k,v[k]]))});}return {settings:{...setup.inputs},sampling:setup.sampling,water:state};};
  const recorded=async(name,input,action)=>{record({kind:'lazarus.'+name,phase:'requested',target:'fluid',requested:input});try{const result=await action();record({kind:'lazarus.'+name,phase:'applied',target:'fluid',requested:input,effective:read()});return result;}catch(e){record({kind:'lazarus.'+name,phase:'failed',target:'fluid',requested:input,error:e.message});throw e;}};
  const operations={
   playback:rate=>recorded('playback',rate,()=>{const next=lazarusFiniteSetup({...setup.inputs,rate});water.setPlaybackRate(rate);setup=next;return read();}),
   paused:value=>recorded('paused',value,()=>{water.setPaused(value);return read();}),
   material:patch=>recorded('material',patch,()=>{const next=lazarusFiniteSetup({...setup.inputs,...patch});const receipt=water.applyMaterial(patch);setup=next;return receipt;}),
   advance:seconds=>recorded('advance',seconds,()=>{water.setPaused(true);const n=targetStep(seconds,setup.dt,water.read().clock.step);if(n>water.read().clock.step)water.advanceTo(n);return read();}),
   reset:patch=>recorded('reset',patch??{},async()=>{read();const next=lazarusFiniteSetup({...setup.inputs,...patch});if(JSON.stringify(next.inputs)===JSON.stringify(setup.inputs))await water.restart();else water=await host.fluid.open(next,{restoreReplay:false});setup=next;return read();}),
  };
  const transport=createSimulationTransport({
   read:()=>{const c=water.read().clock;return {step:c.step,dt:setup.dt,paused:c.paused,rate:c.playbackRate};},
   pause:value=>operations.paused(value),rate:value=>operations.playback(value),restart:()=>operations.reset(),advance:step=>operations.advance(step*setup.dt),
  });
  operations.transport=({action,value})=>{if(!['toggle','rate','step','seek','replay'].includes(action))throw Error('Unknown transport action');return transport[action](value);};
  return {read,operations,
   mount({root,document,invoke}){
    node=document.createElement('section');node.className='lazarus-finite-controls';root.append(node);
    node.innerHTML=`<style>.lazarus-finite-controls label{display:block;margin:10px 0 5px}.lazarus-finite-controls select{width:100%;background:#292b30;color:#e1e4e9;border:1px solid #43464e;border-radius:4px;padding:6px}.lazarus-finite-controls input{width:100%;box-sizing:border-box}.lazarus-finite-controls pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace}.lazarus-finite-controls .help{font-size:11px;color:#a9bec5;line-height:1.5}</style>
    <p class="help">${setup.guide.tryThis}</p><label>Initial water<select data-setting="scene"><option value="block_drop">Block drop</option><option value="dam_break">Dam break</option><option value="block_flop">Block onto shallow puddle</option></select></label>
    <label>Samples across block<input type="number" min="16" step="8" data-setting="resolution"></label>
    <label>Viscosity scaling<select data-setting="scaling"><option value="nominal_diffusion">Preserve nominal diffusion</option><option value="legacy">Previous per-step blend</option></select></label>
    <button class="btn" data-action="setup">Apply setup and reset</button><p class="help">Same volume under refinement. Setup edits start new water.</p>
<div data-material></div><p class="help">Playback and fixed-tick stepping are below the viewport. Backwards seeks restart using current settings; no particle history is retained.</p>
    <details><summary>Numerical experiment settings</summary><label>Physics timestep<select data-setting="dt"><option value="0.004166666666666667">1/240 s</option><option value="0.008333333333333333">1/120 s</option><option value="0.016666666666666666">1/60 s</option></select></label><p class="help">Changing this changes the simulation. Apply setup and reset to use it.</p></details>
    <pre data-status></pre><p role="alert"></p><a data-share>Open these settings</a>`;
    const $=key=>node.querySelector(`[data-setting="${key}"]`),error=node.querySelector('[role=alert]');
    const call=(name,arg)=>Promise.resolve(invoke(name,arg)).then(()=>{error.textContent='';update();}).catch(e=>{error.textContent=e.message;});
    for(const key of ['scene','resolution','scaling','dt'])$(key).value=setup.inputs[key];
    const wireNumber=(input,key,step,operation=null)=>{
      let active=false,before=null;
      const begin=()=>{if(!active){before=operation==='material'?read().settings[key]:operation==='playback'?water.read().clock.playbackRate:input.value;active=true;}};
      input.addEventListener('focusin',begin);input.addEventListener('beforeinput',begin);
      input.addEventListener('pointercancel',()=>{if(!active)return;active=false;input.value=before;if(operation)call(operation,operation==='material'?{[key]:Number(before)}:Number(before));});
      input.addEventListener('change',()=>{active=false;});input.addEventListener('blur',()=>{active=false;});
      scrubs.push(host.controls.installNumberDrag({input,step,onStart:begin,onEnd:()=>{active=false;}}));
    };
    const fields=[['particleRepulsionStrength','Particle repulsion',.01],['densityIterations','Density passes',1],['capillaryStrength','Surface cohesion',.01],['freeFlightViscosityBoost','Flight smoothing boost',.01]];
    for(const [key,label,step]of fields){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.step=step;input.min=key==='densityIterations'?1:0;input.dataset.setting=key;input.value=setup.inputs[key];row.append(input);node.querySelector('[data-material]').append(row);input.addEventListener('input',()=>call('material',{[key]:Number(input.value)}));wireNumber(input,key,step,'material');}
    wireNumber($('resolution'),'resolution',8);
    node.querySelector('[data-action=setup]').onclick=()=>call('reset',Object.fromEntries(['scene','resolution','scaling','dt'].map(k=>[k,['resolution','dt'].includes(k)?Number($(k).value):$(k).value])));

    const publishedSettings={...setup.inputs};
    const update=()=>{try{const current=read();for(const [key,value]of Object.entries(setup.inputs)){if(publishedSettings[key]!==value){const input=$(key);if(input&&document.activeElement!==input)input.value=value;publishedSettings[key]=value;}}const r=current.water;node.querySelector('[data-status]').textContent=`${r.clock.paused?'Paused':'Playing'} · ${r.clock.playbackRate}× playback\nStep ${r.clock.step} · ${r.clock.timeSeconds.toFixed(6)} simulated s\nPhysics dt ${r.clock.frameTimeStepSeconds} s\n${r.runtime.particleCount.toLocaleString()} particles · volume ${setup.sampling.worldVolume.toPrecision(5)}\nPBF support ${r.runtime.viscosityScaling.supportRadius.toPrecision(5)}`;node.querySelector('[data-share]').href=lazarusFiniteReplayURL(location.href,setup.inputs);}catch(e){error.textContent=e.message;}};
    // Provisional composition with the existing shared host slot; own nodes only.
    const runRoot=document.getElementById('experiment-run-controls');
    if(!runRoot)throw Error('Shared simulation run slot unavailable');
    transportUI=mountSimulationTransport({document,root:runRoot,transport,exportSequence:options=>exportLiveFluidSequence({window:document.defaultView,transport,...options,hold:()=>operations.paused(true),advance:step=>operations.advance(step*setup.dt)})});
    update();timer=setInterval(update,250);
   },
   async dispose(){await transportUI?.dispose();await transport.dispose();clearInterval(timer);for(const scrub of scrubs)scrub?.stop?.();node?.remove();await water.dispose();}
  };
 }
};
