import {ipbfBetaForRadius,ipbfPressureReplayURL} from './finger-fluid-pressure-controls.mjs';

/** A small bench consumer; the solver owns parameter application and water. */
export function createIPBFPressureCockpit({root,getSolver,getStatus,isPaused,setPaused,restart,onRequest=()=>{}}) {
  root.hidden=false;
  root.innerHTML=`
    <h3>Fluid envelope</h3>
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
    <details><summary>Damping</summary><label for="ipbf-beta">Beta</label>
      <input id="ipbf-beta" type="number" min="0" step="1">
      <div id="ipbf-damping-readout" class="ipbf-help"></div></details>
    <div class="ipbf-actions">
      <button type="button" class="btn" id="ipbf-pause">Pause</button>
      <button type="button" class="btn" id="ipbf-reset">Reset water</button>
    </div>
    <div id="ipbf-control-status" role="status"></div>
    <div id="ipbf-control-error" role="alert"></div>
    <p class="ipbf-help">Particle count and represented volume stay fixed. Edits apply on the next step.</p>
    <a id="ipbf-replay" target="_blank" rel="noopener">Open these settings in a fresh tab</a>
  `;
  // Retain node identity when the workspace mounts run controls elsewhere.
  const nodes=new Map();
  const find=id=>{if(!nodes.has(id))nodes.set(id,root.querySelector('#'+id));return nodes.get(id);};
  for(const id of ['ipbf-pause','ipbf-reset','ipbf-control-status'])find(id);
  const linked=find('ipbf-link-damping');
  linked.checked=new URL(location.href).searchParams.get('finger_fluid_pressure_cockpit_linked')!=='0';
  let baseRadius=null,resetting=false,error='';
  const numberText=value=>Number(value.toPrecision(10)).toString();
  function source() {
    const solver=getSolver(),state=solver?.getPressureControls?.();
    return state?.available?{solver,runtime:{particleCount:state.particleCount,ipbfSettings:{damping:state.damping}},state}:null;
  }
  function update() {
    const current=source();
    for(const el of [...root.querySelectorAll('input,button'),find('ipbf-pause'),find('ipbf-reset')])el.disabled=!current||resetting;
    if(!current){
      const status=getStatus?.();
      find('ipbf-control-status').textContent=resetting?'Resetting water…':status?.status==='error'
        ?'Fluid unavailable: '+(status.runtime?.configError||status.runtime?.reason||'see bench status')
        :getSolver()?.available?'Live controls unavailable on this route':'Loading fluid…';
      return;
    }
    const {runtime,state}=current,values=state.requested;
    baseRadius=values.radius/values.pressureRadiusScale;
    for(const [name,value] of [['radius',values.radius],['cohesion',values.capillaryStrength],['passes',values.densityIterations]]) {
      for(const suffix of ['','-number']){
        const el=find('ipbf-'+name+suffix);
        if(el.type==='range'){el.min=String(Math.min(Number(el.min),value));el.max=String(Math.max(Number(el.max),value));}
        if(el!==root.ownerDocument.activeElement)el.value=numberText(value);
      }
    }
    if(find('ipbf-beta')!==root.ownerDocument.activeElement)find('ipbf-beta').value=numberText(values.beta);
    if(state.cohesionModel==='ipbf_free_surface')find('ipbf-cohesion-number').removeAttribute('max');
    find('ipbf-cohesion-help').textContent=state.cohesionModel==='ipbf_free_surface'
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
      } else patch={[{cohesion:'capillaryStrength',passes:'densityIterations',beta:'beta'}[name]]:value};
      apply(patch,persist);
    }catch(e){error=e.message||String(e);update();}
  }
  for(const name of ['radius','cohesion','passes']){
    find('ipbf-'+name).addEventListener('input',e=>change(name,Number(e.target.value),false));
    find('ipbf-'+name).addEventListener('change',()=>{const current=source();if(current)persistURL(current.state.requested);});
    find('ipbf-'+name+'-number').addEventListener('change',e=>change(name,e.target.valueAsNumber));
  }
  find('ipbf-beta').addEventListener('change',e=>change('beta',e.target.valueAsNumber));
  linked.addEventListener('change',()=>{try{apply({});}catch{}});
  find('ipbf-pause').addEventListener('click',()=>{setPaused(!isPaused());update();});
  find('ipbf-reset').addEventListener('click',async()=>{
    if(resetting)return;resetting=true;update();
    try {await restart();error='';}catch(e){error=e.message||String(e);}
    finally{resetting=false;update();}
  });
  update();
  return {update,apply,read:()=>source()?.state??null};
}
