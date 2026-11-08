import {opticalParticleSettings} from '../volume-optical-particles.mjs';
export default {
 id:'optical-particles',title:'Reactive optical particles',
 async create({host,inputs={},record,updateInputs}){
  await host.volume?.ready;const session=await host.scene.open();const source=host.controls.document.defaultView.__kaminosVolumePrototype;
  if(!source?.setOpticalParticles){await session.dispose();throw Error('This revision does not supply native optical particles');}
  const previous=source.splitIntegralSettings();let settings=opticalParticleSettings({enabled:true,...inputs.particles});let panel,status,error=null;const drags=[];
  try{source.setOpticalParticles(settings);}catch(error){await session.dispose();throw error;}
  const read=()=>({settings,effective:source.debugState()?.opticalParticles??null,error});
  const sync=()=>{if(!panel)return;for(const el of panel.querySelectorAll('[data-particle]')){if(host.controls.document.activeElement!==el&&!el.classList.contains('scrubbing')){if(el.type==='checkbox')el.checked=settings[el.dataset.particle];else el.value=String(settings[el.dataset.particle]);}}
   const e=read().effective;status.textContent=error?error:e?.effective==='world-optical-particles'?`${e.width} × ${e.height} · ${e.slots.toLocaleString()} world-space slots · ${(e.totalBytes/1048576).toFixed(1)} MiB including source observations · simulation step ${e.step}.`:`${e?.reason??'Waiting for the fire volume. Use Fixed evaluations with 1 evaluation and a World field.'}`;
  };
  const operations={setOptions(patch){const next=opticalParticleSettings({...settings,...patch});source.setOpticalParticles(next);settings=next;updateInputs({particles:settings});record({kind:'optical-particles.settings',settings});session.redraw();sync();return read();},reset(){source.resetOpticalParticles();session.redraw();return read();}};
  const stop=session.onFrame(sync);
  return {read,operations,mount({root,document,invoke}){panel=root;
   const intro=document.createElement('p');intro.textContent='Real material observations become spatial carriers. Each follows the current grid flow and evolves a finite visual reaction. Intrinsic emission and illuminated smoke are separate. No heat or force is fed back into the simulation.';root.append(intro);
   status=document.createElement('p');status.setAttribute('role','status');root.append(status);
   const control=(label,key,step=.1)=>{const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.className='transform-input';input.dataset.particle=key;input.setAttribute('aria-label',label);input.type=key==='enabled'?'checkbox':'number';
    if(input.type==='number'){input.step='any';input.min='0';drags.push(host.controls.installNumberDrag({input,grip,step}));}
    input.addEventListener(input.type==='checkbox'?'change':'input',()=>{if(input.type==='number'&&!input.value.trim())return;const value=input.type==='checkbox'?input.checked:Number(input.value);invoke('setOptions',{[key]:value}).then(()=>{error=null;sync();}).catch(e=>{error=e.message;sync();});});row.style.cssText='display:grid;grid-template-columns:1fr 8rem;gap:10px;align-items:center;margin:8px 0';input.style.width='100%';row.append(grip,input);root.append(row);};
   control('Display particles','enabled');control('Source refresh fraction','refresh',.01);control('Source depth support (cells)','depthSupport',.25);
   control('Material radius (cells)','radius',.05);control('Vertical stretch','stretch',.1);control('Emission gain','gain',.1);control('Extinction gain','opacity',.1);
   control('Reaction time (sim steps)','burnTime',1);control('Cooling time (sim steps)','cooling',1);control('Reaction heat','heatRelease',.05);control('Reaction smoke yield','sootYield',.05);control('Smoke lifetime (sim steps)','smokeLife',1);
   control('Grid flow transport','flow',.1);control('Additional rise','rise',.001);control('Velocity relaxation (steps)','drag',1);control('Reaction support expansion','expansion',.05);
   const reset=document.createElement('button');reset.textContent='Clear particle observations';reset.addEventListener('click',()=>invoke('reset'));root.append(reset);
   const note=document.createElement('p');note.textContent='Reaction and motion advance with simulation steps and freeze with the simulation. Radius, stretch and gains can be compared while paused. Camera movement preserves the world-space population; target resize and source changes clear it. Refresh controls replacement of observed slots. This first renderer adds overlapping optical moments; depth ordering within the material is approximate. Increasing support can add optical thickness. New reaction soot adds absorption; source scattering carries its birth illumination. The thermal/reactive state is a visual proxy, not measured fuel chemistry.';root.append(note);sync();
  },async dispose(){stop();drags.forEach(x=>x?.dispose?.());source.setOpticalParticles({enabled:false});source.setSplitIntegral(previous);await session.dispose();}};
 }
};
