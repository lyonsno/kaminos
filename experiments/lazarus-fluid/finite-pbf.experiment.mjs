import {lazarusFiniteSetup} from './contributions.mjs';
import {targetStep} from '../../finger-fluid-box-clock.mjs';
export default {
 id:'lazarus/finite-pbf',title:'PBF · drop, dam break and puddle',
 async create({host,inputs,record}){
  let setup=lazarusFiniteSetup(inputs),water=await host.fluid.open(setup),node=null,timer=null;
  const read=()=>({settings:{...setup.inputs},sampling:setup.sampling,water:water.read()});
  const recorded=async(name,input,action)=>{record({kind:'lazarus.'+name,phase:'requested',target:'fluid',requested:input});try{const result=await action();record({kind:'lazarus.'+name,phase:'applied',target:'fluid',requested:input,effective:read()});return result;}catch(e){record({kind:'lazarus.'+name,phase:'failed',target:'fluid',requested:input,error:e.message});throw e;}};
  const operations={
   playback:rate=>recorded('playback',rate,()=>{const next=lazarusFiniteSetup({...setup.inputs,rate});water.setPlaybackRate(rate);setup=next;return read();}),
   paused:value=>recorded('paused',value,()=>{water.setPaused(value);return read();}),
   material:patch=>recorded('material',patch,()=>{const next=lazarusFiniteSetup({...setup.inputs,...patch});const receipt=water.applyMaterial(patch);setup=next;return receipt;}),
   advance:seconds=>recorded('advance',seconds,()=>{water.setPaused(true);const n=targetStep(seconds,setup.dt,water.read().clock.step);if(n>water.read().clock.step)water.advanceTo(n);return read();}),
   reset:patch=>recorded('reset',patch??{},async()=>{const next=lazarusFiniteSetup({...setup.inputs,...patch});if(JSON.stringify(next.inputs)===JSON.stringify(setup.inputs))await water.restart();else water=await host.fluid.open(next);setup=next;return read();}),
  };
  return {read,operations,
   mount({root,document,invoke}){
    node=document.createElement('section');node.className='lazarus-finite-controls';root.append(node);
    node.innerHTML=`<style>.lazarus-finite-controls label{display:block;margin:10px 0 5px}.lazarus-finite-controls select{width:100%;background:#292b30;color:#e1e4e9;border:1px solid #43464e;border-radius:4px;padding:6px}.lazarus-finite-controls input{width:100%;box-sizing:border-box}.lazarus-finite-controls pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace}.lazarus-finite-controls .help{font-size:11px;color:#a9bec5;line-height:1.5}</style>
    <p class="help">${setup.guide.tryThis}</p><label>Initial water<select data-setting="scene"><option value="block_drop">Block drop</option><option value="dam_break">Dam break</option><option value="block_flop">Block onto shallow puddle</option></select></label>
    <label>Samples across block<input type="number" min="16" step="8" data-setting="resolution"></label>
    <label>Viscosity scaling<select data-setting="scaling"><option value="nominal_diffusion">Preserve nominal diffusion</option><option value="legacy">Previous per-step blend</option></select></label>
    <button class="btn" data-action="setup">Apply setup and reset</button><p class="help">Same volume under refinement. Setup edits start new water.</p>
    <label>Playback speed<input type="number" min="0" step=".25" data-setting="rate"></label><p class="help">Viewing cadence only. Every physics step keeps its fixed timestep.</p>
    <div data-material></div><button class="btn" data-action="pause">Play</button><button class="btn" data-action="reset">Replay water</button>
    <label>Advance to simulated seconds<input type="number" min="0" step=".1" data-setting="time" value="1"></label><button class="btn" data-action="advance">Advance exactly</button>
    <details><summary>Numerical experiment settings</summary><label>Physics timestep<select data-setting="dt"><option value="0.004166666666666667">1/240 s</option><option value="0.008333333333333333">1/120 s</option><option value="0.016666666666666666">1/60 s</option></select></label><p class="help">Changing this changes the simulation. Apply setup and reset to use it.</p></details>
    <pre data-status></pre><p role="alert"></p><a data-share>Open these settings</a>`;
    const $=key=>node.querySelector(`[data-setting="${key}"]`),error=node.querySelector('[role=alert]');
    const call=(name,arg)=>Promise.resolve(invoke(name,arg)).then(()=>{error.textContent='';update();}).catch(e=>{error.textContent=e.message;});
    for(const key of ['scene','resolution','scaling','dt','rate'])$(key).value=setup.inputs[key];
    const fields=[['particleRepulsionStrength','Particle repulsion',.01],['densityIterations','Density passes',1],['capillaryStrength','Surface cohesion',.01],['freeFlightViscosityBoost','Flight smoothing boost',.01]];
    for(const [key,label,step]of fields){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.step=step;input.min=key==='densityIterations'?1:0;input.dataset.setting=key;input.value=setup.inputs[key];row.append(input);node.querySelector('[data-material]').append(row);input.addEventListener('input',()=>call('material',{[key]:Number(input.value)}));host.controls.installNumberDrag({input,step});}
    $('rate').addEventListener('input',()=>call('playback',Number($('rate').value)));
    for(const key of ['resolution','rate','time'])host.controls.installNumberDrag({input:$(key),step:key==='resolution'?8:.01});
    node.querySelector('[data-action=setup]').onclick=()=>call('reset',Object.fromEntries(['scene','resolution','scaling','dt'].map(k=>[k,['resolution','dt'].includes(k)?Number($(k).value):$(k).value])));
    node.querySelector('[data-action=pause]').onclick=()=>call('paused',!water.read().clock.paused);
    node.querySelector('[data-action=reset]').onclick=()=>call('reset');
    node.querySelector('[data-action=advance]').onclick=()=>call('advance',Number($('time').value));
    const update=()=>{try{const r=water.read();node.querySelector('[data-status]').textContent=`${r.clock.paused?'Paused':'Playing'} · ${r.clock.playbackRate}× playback\nStep ${r.clock.step} · ${r.clock.timeSeconds.toFixed(6)} simulated s\nPhysics dt ${r.clock.frameTimeStepSeconds} s\n${r.runtime.particleCount.toLocaleString()} particles · volume ${setup.sampling.worldVolume.toPrecision(5)}\nPBF support ${r.runtime.viscosityScaling.supportRadius.toPrecision(5)}`;node.querySelector('[data-action=pause]').textContent=r.clock.paused?'Play':'Pause';const u=new URL(location.href);u.searchParams.set('experiment','lazarus/finite-pbf');u.searchParams.set('experiment_inputs',JSON.stringify(setup.inputs));node.querySelector('[data-share]').href=u.href;}catch(e){error.textContent=e.message;}};
    update();timer=setInterval(update,250);
   },
   async dispose(){clearInterval(timer);node?.remove();await water.dispose();}
  };
 }
};
