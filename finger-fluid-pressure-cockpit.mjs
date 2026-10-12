import {deriveIPBFSoftnessReference} from './finger-fluid-ipbf-calibration.mjs';
import {ipbfBetaForRadius,ipbfPressureReplayURL} from './finger-fluid-pressure-controls.mjs';

/** A small bench consumer; the solver owns parameter application and water. */
export function createIPBFPressureCockpit({root,getSolver,getStatus,isPaused,setPaused,restart,restartParticles,installNumberDrag=null,onRequest=()=>{}}) {
  root.hidden=false;
  root.innerHTML=`
    <h3>Fluid envelope</h3>
    <div class="ipbf-control"><label for="ipbf-particles">Particles</label>
      <input id="ipbf-particles" type="number" min="1024" step="1" aria-label="Particle count">
      <button type="button" class="btn" id="ipbf-particles-apply">Apply and reset water</button></div>
    <p class="ipbf-help">Changing particle count starts new water. Camera and tuning settings are retained.</p>
    <div class="ipbf-control"><label for="ipbf-radius">Pressure radius</label><div>
      <input id="ipbf-radius" type="range" min=".06" max=".25" step=".001" aria-label="Pressure radius">
      <input id="ipbf-radius-number" type="number" min="0" step=".001" aria-label="Pressure radius value"></div></div>
    <div class="ipbf-control"><label for="ipbf-cohesion">Cohesion</label><div>
      <input id="ipbf-cohesion" type="range" min="0" max="2" step=".01" aria-label="Cohesion">
      <input id="ipbf-cohesion-number" type="number" min="0" max="2" step=".01" aria-label="Cohesion value"></div></div>
    <p id="ipbf-cohesion-help" class="ipbf-help"></p>
    <div class="ipbf-control"><label for="ipbf-passes">Pressure passes</label><div>
      <input id="ipbf-passes" type="range" min="1" max="8" step="1" aria-label="Pressure passes">
      <input id="ipbf-passes-number" type="number" min="1" step="1" aria-label="Pressure passes value"></div></div>
    <label class="ipbf-link"><input id="ipbf-link-damping" type="checkbox"> Link damping to radius</label>
    <p class="ipbf-help">Linked keeps the damping threshold constant as radius changes.</p>
    <div class="ipbf-control"><label for="ipbf-alternative">Alternate compliance</label><div>
      <input id="ipbf-alternative" type="range" step=".01" min="-3" max="4" aria-label="Alternate compliance logarithmic sweep">
      <input id="ipbf-alternative-number" type="number" min="0" step="any" aria-label="Alternate compliance value"></div></div>
    <p class="ipbf-help">Logarithmic sweep. Higher values soften the comparison solve; beta controls how much of its lower energy can be removed. Radius, population and timestep stay independent.</p>
    <button type="button" class="btn" id="ipbf-derive-softness">Derive range for current settings</button>
    <div id="ipbf-softness-reference" class="ipbf-help"></div>
    <details><summary>Damping</summary><label for="ipbf-beta">Beta</label>
      <input id="ipbf-beta" type="number" min="0" step="1">
      <div id="ipbf-damping-readout" class="ipbf-help"></div></details>
    <div class="ipbf-actions">
      <button type="button" class="btn" id="ipbf-pause">Pause</button>
      <button type="button" class="btn" id="ipbf-reset">Reset water</button>
    </div>
    <div id="ipbf-control-status" role="status"></div>
    <div id="ipbf-control-error" role="alert"></div>
    <p class="ipbf-help">Pressure, cohesion and damping edits apply on the next step.</p>
    <a id="ipbf-replay" target="_blank" rel="noopener">Open these settings in a fresh tab</a>
  `;
  // Retain node identity when the workspace mounts run controls elsewhere.
  const nodes=new Map();
  const find=id=>{if(!nodes.has(id))nodes.set(id,root.querySelector('#'+id));return nodes.get(id);};
  for(const id of ['ipbf-pause','ipbf-reset','ipbf-control-status'])find(id);
  const linked=find('ipbf-link-damping');
  linked.checked=new URL(location.href).searchParams.get('finger_fluid_pressure_cockpit_linked')!=='0';
  let baseRadius=null,resetting=false,error='',reference=null,lastParticleCount=null;
  const editing=new Set();
  const numberText=value=>Number(value.toPrecision(10)).toString();
  function source() {
    const solver=getSolver(),state=solver?.getPressureControls?.();
    return state?.available?{solver,runtime:{particleCount:state.particleCount,ipbfSettings:{damping:state.damping}},state}:null;
  }
  function update() {
    const current=source();
    for(const el of [...root.querySelectorAll('input,button'),find('ipbf-pause'),find('ipbf-reset')])el.disabled=!current||resetting;
    // Population correction remains usable if replacement allocation failed.
    find('ipbf-particles').disabled=resetting||!restartParticles;
    find('ipbf-particles-apply').disabled=resetting||!restartParticles;
    find('ipbf-control-error').textContent=error;
    if(!current){
      const status=getStatus?.();
      find('ipbf-control-status').textContent=resetting?'Resetting water…':status?.status==='error'
        ?'Fluid unavailable: '+(status.runtime?.configError||status.runtime?.reason||'see bench status')
        :getSolver()?.available?'Live controls unavailable on this route':'Loading fluid…';
      return;
    }
    const {runtime,state}=current,values=state.requested;
    if(lastParticleCount!==runtime.particleCount){find('ipbf-particles').value=String(runtime.particleCount);lastParticleCount=runtime.particleCount;}
    find('ipbf-particles-apply').disabled=resetting||!restartParticles;
    baseRadius=values.radius/values.pressureRadiusScale;
    for(const [name,value] of [['radius',values.radius],['cohesion',values.capillaryStrength],['passes',values.densityIterations]]) {
      for(const suffix of ['','-number']){
        const el=find('ipbf-'+name+suffix);
        if(el.type==='range'){el.min=String(Math.min(Number(el.min),value));el.max=String(Math.max(Number(el.max),value));}
        if(el!==root.ownerDocument.activeElement&&!editing.has(el))el.value=numberText(value);
      }
    }
    const alpha=values.alternativeCompliance;
    const range=find('ipbf-alternative'),number=find('ipbf-alternative-number');
    if(alpha>0){const logarithm=Math.log10(alpha);range.min=String(Math.min(Number(range.min),logarithm));range.max=String(Math.max(Number(range.max),logarithm));if(range!==root.ownerDocument.activeElement)range.value=String(logarithm);}
    if(number!==root.ownerDocument.activeElement&&!editing.has(number))number.value=numberText(alpha);
    const matches=reference&&reference.radius===values.radius&&reference.particleVolume===state.particleVolume&&reference.dt===state.dt;
    find('ipbf-softness-reference').textContent=reference
      ?(matches?'Current reference':'Earlier reference; derive again after radius, timestep or population edits')+' · '+reference.brackets.map(b=>`${numberText(b.alternativeCompliance)}: ${Math.round(b.updateFraction*100)}% of hard correction`).join(' · ')+' · finite compressed lattice, not a water preset.'
      :'Derive a local pressure-response range after the first simulation step. No settings change.';
    if(find('ipbf-beta')!==root.ownerDocument.activeElement&&!editing.has(find('ipbf-beta')))find('ipbf-beta').value=numberText(values.beta);
    if(state.cohesionModel!=='legacy')find('ipbf-cohesion-number').removeAttribute('max');
    root.querySelector('label[for=ipbf-cohesion]').textContent=state.cohesionModel==='akinci_2013'?'Surface coefficient':'Cohesion';
    find('ipbf-cohesion-help').textContent=state.cohesionModel==='akinci_2013'
      ?'Published Akinci surface force · model coefficient, not calibrated N/m. Surface radius follows particle spacing; pressure radius is independent.'
      :state.cohesionModel==='ipbf_free_surface'
      ?'Recovered attraction · strength is a fraction of gravity. Higher numeric values expand the slider.'

      :'Legacy attraction · density weighted · acceleration capped at 0.42';
    find('ipbf-damping-readout').textContent=runtime.ipbfSettings.damping
      ?'Threshold '+(values.beta*values.radius).toPrecision(3)
      :'Damping is disabled on this route.';
    find('ipbf-pause').textContent=isPaused()?'Resume':'Pause';
    const pending=state.generation!==state.effectiveGeneration;
    find('ipbf-control-status').textContent=(pending?'Awaiting next step':isPaused()?'Paused':'Live')
      +' · '+runtime.particleCount.toLocaleString()+' particles · '+state.effective.densityIterations+' passes';
    find('ipbf-control-error').textContent=error;
    find('ipbf-replay').href=ipbfPressureReplayURL(location.href,values,linked.checked);
  }
  function persistURL(values) {
    history.replaceState(history.state,'',ipbfPressureReplayURL(location.href,values,linked.checked));
  }
  function apply(patch,persist=true) {
    try {
      const current=source();if(!current)throw new Error('Fluid is still loading');
      const receipt=current.solver.setPressureControls(patch);
      onRequest(receipt);
      if(persist)persistURL(receipt.requested);
      error='';update();return receipt;
    } catch(e){error=e.message||String(e);update();throw e;}
  }
  function change(name,value,persist=true) {
    if(!Number.isFinite(value))return;
    const current=source();if(!current)return;
    try {
      let patch;
      if(name==='radius'){
        const old=current.state.requested;
        patch={pressureRadiusScale:value/baseRadius,beta:ipbfBetaForRadius({radius:value,previousRadius:old.radius,beta:old.beta,linked:linked.checked})};
      } else patch={[{cohesion:'capillaryStrength',passes:'densityIterations',beta:'beta',alternative:'alternativeCompliance'}[name]]:value};
      apply(patch,persist);
    }catch(e){error=e.message||String(e);update();}
  }
  for(const name of ['radius','cohesion','passes']){
    find('ipbf-'+name).addEventListener('input',e=>change(name,Number(e.target.value),false));
    find('ipbf-'+name).addEventListener('change',()=>{const current=source();if(current)persistURL(current.state.requested);});
    find('ipbf-'+name+'-number').addEventListener('change',e=>change(name,e.target.valueAsNumber));
  }
  find('ipbf-alternative').addEventListener('input',e=>change('alternative',10**Number(e.target.value),false));
  find('ipbf-alternative').addEventListener('change',()=>{const current=source();if(current)persistURL(current.state.requested);});
  find('ipbf-alternative-number').addEventListener('change',e=>change('alternative',e.target.valueAsNumber));
  find('ipbf-derive-softness').addEventListener('click',()=>{
    try{const current=source();if(!current)throw Error('Fluid is still loading');const {state}=current;
      reference=deriveIPBFSoftnessReference({particleVolume:state.particleVolume,radius:state.requested.radius,dt:state.dt});
      const highest=reference.brackets.at(-1).alternativeCompliance;find('ipbf-alternative').max=String(Math.log10(Math.max(highest,state.requested.alternativeCompliance,.001)));error='';update();
    }catch(e){reference=null;error=e.message;update();}
  });
  find('ipbf-beta').addEventListener('change',e=>change('beta',e.target.valueAsNumber));
  linked.addEventListener('change',()=>{try{apply({});}catch{}});
  find('ipbf-pause').addEventListener('click',()=>{setPaused(!isPaused());update();});
  find('ipbf-particles-apply').addEventListener('click',async()=>{
    if(resetting||!restartParticles)return;
    const count=Number(find('ipbf-particles').value);
    if(!Number.isSafeInteger(count)||count<1024){error='Particle count must be a whole number of at least 1024';update();return;}
    resetting=true;update();
    try{await restartParticles(count);error='';}catch(e){error=e.message||String(e);}
    finally{resetting=false;update();}
  });
  find('ipbf-reset').addEventListener('click',async()=>{
    if(resetting)return;resetting=true;update();
    try {await restart();error='';}catch(e){error=e.message||String(e);}
    finally{resetting=false;update();}
  });
  if(installNumberDrag){
    for(const [id,name,step] of [['ipbf-radius-number','radius',.001],['ipbf-cohesion-number','cohesion',.01],['ipbf-passes-number','passes',1],['ipbf-beta','beta',.001],['ipbf-particles',null,128]]){
      const input=find(id);let before=null;
      const begin=()=>{if(before)return;before={value:input.value,requested:source()?.state.requested};editing.add(input);};
      const end=()=>{editing.delete(input);before=null;};
      input.addEventListener('focusin',begin);
      input.addEventListener('beforeinput',begin);
      input.addEventListener('input',()=>{if(name&&input.readOnly)change(name,Number(input.value),false);});
      input.addEventListener('pointercancel',()=>{
        if(!before)return;
        const saved=before;end();input.value=saved.value;
        if(name&&saved.requested){const {pressureRadiusScale,beta,capillaryStrength,densityIterations}=saved.requested;try{apply({pressureRadiusScale,beta,capillaryStrength,densityIterations});}catch{}}
      });
      input.addEventListener('change',end);input.addEventListener('blur',end);
      input.addEventListener('keydown',event=>{if(event.key==='Enter')input.blur();});
      installNumberDrag({input,step,onStart:begin,...(!name?{format:value=>value}:{})});
    }
  }
  update();
  return {update,apply,read:()=>source()?.state??null};
}
