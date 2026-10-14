import {createSimulationTransport,mountSimulationTransport} from '../../simulation-transport.mjs';
import {exportLiveFluidSequence} from '../../live-fluid-sequence.mjs';
import {mountInitialSamplingPreview} from '../../fluid-sampling-preview.mjs';
import {describeLazarusFiniteSetup,lazarusFiniteSetup,updateLazarusFiniteControls,lazarusFiniteReplayURL} from './contributions.mjs';
import {targetStep} from '../../finger-fluid-box-clock.mjs';
export default {
 id:'lazarus/finite-pbf',title:'PBF · drop, dam break and puddle',
 async create({host,inputs,record}){
  let setup=lazarusFiniteSetup(inputs),water=await host.fluid.open(setup,{restoreReplay:false}),node=null,timer=null,scrubs=[],transportUI=null,previewUI=null;
  const read=()=>{const state=water.read(),v=state.controls?.effective;if(v){const keys=['particleRepulsionStrength','densityIterations','capillaryStrength','freeFlightViscosityBoost'];if(keys.some(k=>v[k]!==setup.inputs[k]))setup=updateLazarusFiniteControls(setup,Object.fromEntries(keys.map(k=>[k,v[k]])));}return {settings:{...setup.inputs},sampling:setup.sampling,water:state};};
  const recorded=async(name,input,action)=>{record({kind:'lazarus.'+name,phase:'requested',target:'fluid',requested:input});try{const result=await action();record({kind:'lazarus.'+name,phase:'applied',target:'fluid',requested:input,effective:read()});return result;}catch(e){record({kind:'lazarus.'+name,phase:'failed',target:'fluid',requested:input,error:e.message});throw e;}};
  const operations={
   playback:rate=>recorded('playback',rate,()=>{const next=updateLazarusFiniteControls(setup,{rate});water.setPlaybackRate(rate);setup=next;return read();}),
   cadence:mode=>recorded('cadence',mode,()=>{const next=updateLazarusFiniteControls(setup,{playbackMode:mode});water.setPlaybackMode(mode);setup=next;return read();}),
   paused:value=>recorded('paused',value,()=>{water.setPaused(value);return read();}),
   material:patch=>recorded('material',patch,()=>{const next=updateLazarusFiniteControls(setup,patch);const receipt=water.applyMaterial(patch);setup=next;return receipt;}),
   advance:seconds=>recorded('advance',seconds,()=>{water.setPaused(true);const n=targetStep(seconds,setup.dt,water.read().clock.step);if(n>water.read().clock.step)water.advanceTo(n);return read();}),
   reset:patch=>recorded('reset',patch??{},async()=>{read();const next=lazarusFiniteSetup({...setup.inputs,...patch});if(JSON.stringify(next.inputs)===JSON.stringify(setup.inputs))await water.restart();else water=await host.fluid.open(next,{restoreReplay:false});setup=next;return read();}),
  };
  const transport=createSimulationTransport({
   read:()=>{const c=water.read().clock;return {step:c.step,dt:setup.dt,paused:c.paused,rate:c.playbackRate,cadence:c.playbackMode};},
   pause:value=>operations.paused(value),rate:value=>operations.playback(value),cadence:mode=>operations.cadence(mode),restart:()=>operations.reset(),advance:step=>operations.advance(step*setup.dt),
  });
  operations.transport=({action,value})=>{if(!['toggle','rate','cadence','step','seek','replay'].includes(action))throw Error('Unknown transport action');return transport[action](value);};
  return {read,operations,
   mount({root,document,invoke}){
    node=document.createElement('section');node.className='lazarus-finite-controls';root.append(node);
    node.innerHTML=`<style>.lazarus-finite-controls label{display:block;margin:10px 0 5px}.lazarus-finite-controls select{width:100%;background:#292b30;color:#e1e4e9;border:1px solid #43464e;border-radius:4px;padding:6px}.lazarus-finite-controls input{width:100%;box-sizing:border-box}.lazarus-finite-controls pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace}.lazarus-finite-controls .help{font-size:11px;color:#a9bec5;line-height:1.5}</style>
    <p class="help">${setup.guide.tryThis}</p><label>Initial water<select data-setting="scene"><option value="block_drop">Block drop</option><option value="dam_break">Dam break</option><option value="block_flop">Block onto shallow puddle</option></select></label>
    <label>Samples per world unit<input type="number" min="1" step="8" data-setting="resolution"></label><label>Block width (world units)<input type="number" min="0" step="any" data-setting="blockWidth"></label><p class="help">At fixed width, more samples shrink spacing and all sample radii. At fixed samples per unit, a smaller block uses fewer particles with the same spacing/radii. Width must contain a whole number of samples. Puddle adds its own fixed 3 × 1/8 × 1 volume.</p><pre data-preview></pre><div data-support-preview></div>
    <label>Viscosity scaling<select data-setting="scaling"><option value="nominal_diffusion">Preserve nominal diffusion</option><option value="legacy">Previous per-step blend</option></select></label>
    <button class="btn" data-action="setup">Apply setup and reset</button><p class="help">Proposed setup above; active water below. Apply starts new water. Existing water and view stay unchanged while you edit.</p>
<div data-material></div><p class="help">Playback and fixed-tick stepping are below the viewport. Backwards seeks restart using current settings; no particle history is retained.</p>
    <details><summary>Numerical experiment settings</summary><label>Physics timestep<select data-setting="dt"><option value="0.004166666666666667">1/240 s</option><option value="0.008333333333333333">1/120 s</option><option value="0.016666666666666666">1/60 s</option></select></label><p class="help">Changing this changes the simulation. Apply setup and reset to use it.</p></details>
    <pre data-status></pre><p role="alert"></p><a data-share>Open these settings</a>`;
    const $=key=>node.querySelector(`[data-setting="${key}"]`),error=node.querySelector('[role=alert]');
    const call=(name,arg)=>Promise.resolve(invoke(name,arg)).then(()=>{error.textContent='';update();}).catch(e=>{error.textContent=e.message;});
    for(const key of ['scene','resolution','blockWidth','scaling','dt'])$(key).value=setup.inputs[key];
    const wireNumber=(input,key,step,operation=null)=>{
      let active=false,before=null;
      const begin=()=>{if(!active){before=operation==='material'?read().settings[key]:operation==='playback'?water.read().clock.playbackRate:input.value;active=true;}};
      input.addEventListener('focusin',begin);input.addEventListener('beforeinput',begin);
      input.addEventListener('pointercancel',()=>{if(!active)return;active=false;input.value=before;if(operation)call(operation,operation==='material'?{[key]:Number(before)}:Number(before));else preview();});
      input.addEventListener('change',()=>{active=false;});input.addEventListener('blur',()=>{active=false;});
      scrubs.push(host.controls.installNumberDrag({input,step,onStart:begin,onEnd:()=>{active=false;}}));
    };
    const fields=[['particleRepulsionStrength','Particle repulsion',.01],['densityIterations','Density passes',1],['capillaryStrength','Surface cohesion',.01],['freeFlightViscosityBoost','Flight smoothing boost',.01]];
    for(const [key,label,step]of fields){const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type='number';input.step=step;input.min=key==='densityIterations'?1:0;input.dataset.setting=key;input.value=setup.inputs[key];row.append(input);node.querySelector('[data-material]').append(row);input.addEventListener('input',()=>call('material',{[key]:Number(input.value)}));wireNumber(input,key,step,'material');}
    wireNumber($('resolution'),'resolution',8);$('blockWidth').step=String(1/setup.inputs.resolution);
    const proposed=()=>Object.fromEntries(['scene','resolution','blockWidth','scaling','dt'].map(k=>[k,['resolution','blockWidth','dt'].includes(k)?Number($(k).value):$(k).value]));
    previewUI=mountInitialSamplingPreview({document,root:node.querySelector('[data-support-preview]')});
    const preview=()=>{const resolution=Number($('resolution').value);if(resolution>0)$('blockWidth').step=String(1/resolution);try{const p=describeLazarusFiniteSetup({...setup.inputs,...proposed()}).sampling;node.querySelector('[data-preview]').textContent=`Proposed: ${p.particleCount.toLocaleString()} particles · ${p.blockSamples}³ in block\nWidth ${p.blockWidth} · total volume ${p.worldVolume.toPrecision(5)} (block ${p.blockVolume.toPrecision(5)}, puddle ${p.puddleVolume})\nSpacing ${p.spacing.toPrecision(5)} · sample volume ${p.particleVolume.toPrecision(5)}\nDensity support h ${p.supportRadius.toPrecision(5)} · h/spacing ${p.supportRatio.toPrecision(5)}\nCollision radius ${p.collisionRadius.toPrecision(5)}\nBase render radius ${p.baseGlyphRadius.toPrecision(5)} (surface/density modify it)\nViscosity blend scale ${p.viscosityFactor.toPrecision(5)}\nPhysics dt ${$("dt").value} s; gravity, box and material gains unchanged.`;previewUI.draw(p);}catch(e){node.querySelector('[data-preview]').textContent='Proposed setup invalid: '+e.message;previewUI.invalid(e.message);}};
    for(const key of ['scene','resolution','blockWidth','scaling','dt'])$(key).addEventListener('input',preview);preview();
    node.querySelector('[data-action=setup]').onclick=()=>call('reset',proposed());

    const publishedSettings={...setup.inputs};
    const update=()=>{if(transport.state().busy)return;try{const current=read();let proposalChanged=false;for(const [key,value]of Object.entries(setup.inputs)){if(publishedSettings[key]!==value){const input=$(key);if(input&&document.activeElement!==input){input.value=value;if(['scene','resolution','blockWidth','scaling','dt'].includes(key))proposalChanged=true;}publishedSettings[key]=value;}}if(proposalChanged)preview();const r=current.water;node.querySelector('[data-status]').textContent=`${r.clock.paused?'Paused':'Playing'} · ${r.clock.playbackRate} ${r.clock.playbackMode==='render_cadence'?'ticks/drawn frame':'× simulated/wall time'}\nStep ${r.clock.step} · ${r.clock.timeSeconds.toFixed(6)} simulated s\nPhysics dt ${r.clock.frameTimeStepSeconds} s\n${r.runtime.particleCount.toLocaleString()} particles · volume ${setup.sampling.worldVolume.toPrecision(5)}\nPBF support ${r.runtime.viscosityScaling.supportRadius.toPrecision(5)}`;node.querySelector('[data-share]').href=lazarusFiniteReplayURL(location.href,setup.inputs);}catch(e){error.textContent=e.message;}};
    // Provisional composition with the existing shared host slot; own nodes only.
    const runRoot=document.getElementById('experiment-run-controls');
    if(!runRoot)throw Error('Shared simulation run slot unavailable');
    transportUI=mountSimulationTransport({document,root:runRoot,transport,exportSequence:options=>exportLiveFluidSequence({window:document.defaultView,transport,...options,hold:()=>operations.paused(true),advance:step=>operations.advance(step*setup.dt)})});
    update();timer=setInterval(update,250);
   },
   async dispose(){await transportUI?.dispose();await transport.dispose();clearInterval(timer);previewUI?.dispose();for(const scrub of scrubs)scrub?.stop?.();node?.remove();await water.dispose();}
  };
 }
};
