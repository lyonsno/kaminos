import {opticalParticleSettings} from '../volume-optical-particles.mjs';
export default {
 id:'optical-particles',title:'Reactive optical particles',
 async create({host,inputs={},record,updateInputs}){
  let settings=opticalParticleSettings({enabled:true,...inputs.particles});
  await host.volume?.ready;const session=await host.scene.open(),win=host.controls.document.defaultView;
  let current=null,previous=null,panel,notice,error=null;const drags=[],fields=new Map(),stats=new Map();
  function source(){const next=win.__kaminosVolumePrototype;if(!next?.opticalParticleState)throw Error('This revision does not supply the particle controls');
   if(next!==current){if(current)try{current.setOpticalParticles(previous.particles);current.setSplitIntegral(previous.split);}catch{}current=next;previous={particles:next.opticalParticleSettings(),split:next.splitIntegralSettings()};next.setOpticalParticles(settings);}return current;
  }
  try{source();}catch(error){await session.dispose();throw error;}
  const read=()=>({settings,effective:source().opticalParticleState(),error});
  const value=(key,e)=>key==='verticalRadius'?settings.radius*settings.stretch:key==='radius'?settings.radius:e.simulationReaction&&['burnTime','cooling','heatRelease'].includes(key)?e.simulationReaction[key]:settings[key];
  const text=(el,next)=>{if(el.textContent!==next)el.textContent=next;};
  function sync(){if(!panel)return;let e;try{e=read().effective;}catch(err){error=err.message;e={};}
   text(notice,error??(e.effective==='world-optical-particles'?(e.simulationReaction?'':'This basin’s Reactant law is inactive; particle reaction uses prototype values.'):e.reason??'Waiting for the fire volume.'));
   const rows={target:e.width?`${e.width.toFixed(0)} × ${e.height.toFixed(0)}`:'—',slots:e.slots?.toFixed(0)??'—',memory:e.totalBytes?`${(e.totalBytes/1048576).toFixed(1)} MiB`:'—',step:e.step?.toFixed(0)??'—'};
   for(const [key,el] of stats)text(el,rows[key]);
   for(const [key,{input,digits}] of fields){if(host.controls.document.activeElement===input||input.classList.contains('scrubbing'))continue;const v=value(key,e);if(input.type==='checkbox'){input.checked=!!v;continue;}const next=Number.isFinite(v)?v.toFixed(digits):'';if(input.value!==next)input.value=next;}
  }
  function setReaction(patch){
   const runtime=source();runtime.setParticleSimulationReaction(patch);
   for(const [key,id] of [['burnTime','volume-reactant-mixing-time'],['cooling','volume-reactant-cooling-time']])if(key in patch){const el=host.controls.document.getElementById(id);if(el){el.value=String(patch[key]);el.dispatchEvent(new win.Event('input',{bubbles:true}));}}
   record({kind:'simulation.reaction',values:patch});session.redraw();sync();return read();
  }
  function setOptions(patch){const next=opticalParticleSettings({...settings,...patch});const reaction=Object.fromEntries(Object.entries(patch).filter(([key])=>['burnTime','cooling','heatRelease'].includes(key)));if(Object.keys(reaction).length)setReaction(reaction);source().setOpticalParticles(next);settings=next;updateInputs({particles:settings});record({kind:'optical-particles.settings',settings});session.redraw();sync();return read();}
  const operations={setOptions,setReaction,reset(){source().resetOpticalParticles();session.redraw();sync();return read();},
   setRadius({axis,value:v}){if(!['horizontal','vertical'].includes(axis))throw Error('Unknown radius axis');if(!Number.isFinite(v)||v<=0)throw Error('Radius must be positive');const vertical=settings.radius*settings.stretch;return axis==='vertical'?setOptions({stretch:v/settings.radius}):setOptions({radius:v,stretch:vertical/v});}
  };
  const stop=session.onFrame(sync);
  return {read,operations,mount({root,document,invoke}){panel=root;
   const intro=document.createElement('p');intro.textContent='Observed material becomes particles that follow the grid flow. Their emission cools and their finite reaction can produce smoke. Reaction timing and heat use the current simulation values.';root.append(intro);
   const status=document.createElement('div');status.setAttribute('aria-label','Particle allocation');status.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:4px 12px;font-variant-numeric:tabular-nums;margin:12px 0';
   for(const [key,label] of [['target','Fire target (px)'],['slots','Particle slots'],['memory','Optical buffers'],['step','Simulation step']]){const name=document.createElement('span'),v=document.createElement('span');name.textContent=label;v.dataset.particleStat=key;v.style.cssText='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;font-family:monospace;min-width:0';status.append(name,v);stats.set(key,v);}root.append(status);
   notice=document.createElement('p');notice.setAttribute('role','status');notice.style.cssText='min-height:1.4em;font-size:.85em';root.append(notice);
   function control(label,key,tooltip,{step=.1,digits=3,min=0,operation='setOptions'}={}){const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.className='transform-input';input.dataset.particle=key;input.setAttribute('aria-label',label);input.type=key==='enabled'?'checkbox':'number';
    if(input.type==='number'){input.step='any';input.min=String(min);drags.push(host.controls.installNumberDrag({input,grip,step}));}input.title=tooltip+' · Drag to adjust; click to type; Shift for fine; Esc to cancel.';grip.title=tooltip;row.title=tooltip;
    fields.set(key,{input,digits});input.addEventListener(input.type==='checkbox'?'change':'input',()=>{if(input.type==='number'&&!input.value.trim())return;const v=input.type==='checkbox'?input.checked:Number(input.value);const args=operation==='setRadius'?{axis:key==='verticalRadius'?'vertical':'horizontal',value:v}:{[key]:v};invoke(operation,args).then(()=>{error=null;sync();}).catch(e=>{error=e.message;sync();});});row.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 9rem;gap:10px;align-items:center;margin:8px 0';input.style.cssText='width:100%;min-width:0;font-variant-numeric:tabular-nums';row.append(grip,input);root.append(row);}
   control('Display particles','enabled','Show the particle rendering. Turning it off clears its population and returns to the ordinary marcher.');
   control('Particle spacing (source px)','spacing','1 keeps one particle slot per fire-target pixel. 2 keeps one per 2 × 2 block: about one quarter of the particle storage/update/draw work. Each update selects a source within its block. The one-evaluation source image stays full size. Changing this clears the pool; lower density can change brightness.',{step:1,digits:0,min:1});
   control('Maximum age (reference steps)','maxAge','Retire particles at this simulation reference-time age. 0 allows their optical lifetimes to decide. This reduces persistence and active work, not allocated slot memory. It counts simulation time, not rendered frames.',{step:1});
   control('Source refresh fraction','refresh','Chance per simulation update to replace an occupied slot when the selected current ray observation contains material. 0 preserves occupied slots; 1 replaces every eligible slot. Empty slots can be filled at any setting. This changes persistence, not the fresh material-evaluation count.',{step:.01});
   control('Source depth support (cells)','depthSupport','Ray interval represented by a source observation, in the local material grid’s cell units. It controls optical path length, separately from the particle’s spatial radius.',{step:.25});
   control('Horizontal radius (source cells)','radius','World X/Z Gaussian radius in the material-cell units recorded at birth. Fine and coarse observations use their own cell size. One radius is one standard deviation; the drawn footprint extends to 2.5 radii. Editing this preserves the vertical radius.',{step:.01,min:.00001,operation:'setRadius'});
   control('Vertical radius (source cells)','verticalRadius','World Y Gaussian radius in the same source-cell units as Horizontal radius. This is the old radius × vertical stretch, exposed in matching units. Editing it preserves the horizontal radius.',{step:.01,min:.00001,operation:'setRadius'});
   control('Emission gain','gain','Multiplier on particle self-emission. It does not add heat or alter the grid simulation.');
   control('Extinction gain','opacity','Multiplier on optical thickness from retained smoke and particle reaction soot. Higher darkens/obscures more; it does not create simulation material.');
   control('Burn / mixing time (reference steps)','burnTime','The simulation’s Reactant mixing time, shared with the particles. Lower burns colocated potential faster. Editing changes the simulation control too; this is not an offset.',{step:1,min:.01,operation:'setReaction'});
   control('Cooling time (reference steps)','cooling','The simulation’s cooling e-folding time, shared with the particles. A parcel retains exp(-dt / time) of its heat. Editing changes the simulation control too.',{step:1,min:5,operation:'setReaction'});
   control('Reaction heat (simulation units)','heatRelease','The simulation model’s heat of combustion per burned fuel unit, shared with the particle visual proxy. This is heat, not the separate pressure/divergence Heat release expansion control. Editing applies a shared runtime model override.',{step:.1,operation:'setReaction'});
   control('Particle smoke yield','sootYield','New particle soot per consumed visual reaction potential. Potential is bounded by observed emission, so faint hits cannot create a full smoke parcel. This is a particle rendering control.');
   control('Smoke lifetime (reference steps)','smokeLife','E-folding lifetime for carried smoke/illumination and generated soot. Longer keeps smoke visible longer. This does not allocate more frame history.',{step:1,min:.001});
   control('Grid flow transport','flow','Multiplier on current grid velocity used to move particles. 1 follows that flow; 0 leaves centers still except for Additional rise.');
   control('Additional rise','rise','Extra upward particle acceleration driven by its remaining heat, in Fine-normalized distance per reference-step squared. 0 adds no motion beyond the grid.',{step:.001,digits:5});
   control('Velocity relaxation (reference steps)','drag','Time for additional particle velocity to relax. This affects Additional rise, not the sampled grid velocity.',{step:1,min:.001});
   control('Reaction support expansion','expansion','Fractional growth of both radii as the particle consumes its initial potential. 0 holds size; 1 allows doubling after all potential burns. It changes footprint/optical amount without pushing the grid.');
   const reset=document.createElement('button');reset.textContent='Clear particle observations';reset.title='Clear the retained particle pool and begin collecting fresh observations. The simulation is preserved.';reset.addEventListener('click',()=>invoke('reset'));root.append(reset);
   const note=document.createElement('p');note.textContent='Particle reaction and motion use simulation reference time and freeze when paused. Radius and gains can be compared while paused. Camera movement preserves particles; resizing or changing source resets them. More support/density can add optical thickness. Internal depth ordering is approximate. Newly generated soot absorbs light; carried scattering retains its birth illumination. The particle reaction state remains a visual approximation.';root.append(note);sync();
  },async dispose(){stop();drags.forEach(x=>x?.dispose?.());try{if(current){current.setOpticalParticles(previous.particles);current.setSplitIntegral(previous.split);}}finally{await session.dispose();}}};
 }
};
