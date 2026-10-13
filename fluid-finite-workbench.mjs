import {createFingerFluidBoxReference} from './finger-fluid-box-fixtures.mjs';
import {createFixedStepPlayback,targetStep} from './finger-fluid-box-clock.mjs';
import {mountMaterialCockpit} from './finger-fluid-material-cockpit.mjs';
export function finiteWorkbenchRoute(params) {
 const scene=params.get('finger_fluid_box_scene');if(!scene)return null;
 if(params.has('finger_fluid_pressure_solver')&&params.get('finger_fluid_pressure_solver')!=='pbf')throw new RangeError('Finite PBF fixture cannot substitute for another requested solver');
 const fixture=createFingerFluidBoxReference({scene,resolution:Number(params.get('finger_fluid_box_resolution')??24)});
 const dt=Number(params.get('finger_fluid_physics_dt')??1/240),rate=Number(params.get('finger_fluid_playback_rate')??1);
 if(![1/240,1/120,1/60].includes(dt))throw new RangeError('Unsupported physics timestep');
 const clock=createFixedStepPlayback({dt,rate});
 return {fixture,dt,rate,clock,scaling:params.get('finger_fluid_viscosity_scaling')??'nominal_diffusion'};
}
export function createFiniteWorkbenchControls({root,getSolver,isPaused,setPaused,restart,advance,getRoute,installNumberDrag,onRequest}) {
 const route=new Proxy({}, {get:(_,key)=>getRoute()[key],set:(_,key,value)=>{getRoute()[key]=value;return true;}});
 const doc=root.ownerDocument;root.hidden=false;root.replaceChildren();
 const apply=patch=>{const receipt=getSolver().setMaterialControls(patch);onRequest?.(receipt);return receipt;};
 const material=mountMaterialCockpit(root,{id:'finite-material',read:()=>getSolver()?.getMaterialControls?.(),
  apply,getPaused:isPaused,setPaused,onReplay:restart,installNumberDrag});
 const setup=doc.createElement('section');setup.className='ipbf-help';root.prepend(setup);
 setup.innerHTML=`<h3>Finite water experiment</h3><label>Initial water <select id="finite-scene"><option value="block_drop">Block drop</option><option value="dam_break">Dam break</option><option value="block_flop">Block onto puddle</option></select></label>
 <label>Samples across block <input id="finite-resolution" type="number" min="16" step="8"></label>
 <label>Viscosity scaling <select id="finite-scaling"><option value="nominal_diffusion">Preserve nominal diffusion</option><option value="legacy">Previous per-step blend</option></select></label>
 <button id="finite-apply" class="btn">Apply and reset water</button>
 <p>Refinement keeps water volume fixed. Setup edits start new water.</p>
 <label>Playback speed <input id="finite-rate" type="number" min="0" step=".25"></label>
 <p>1× = one simulated second per wall second when the box can keep up. Physics steps stay fixed.</p>
 <label>Advance to simulated seconds <input id="finite-time" type="number" min="0" step=".1" value="1"></label><button id="finite-advance" class="btn">Advance exactly</button>
 <details><summary>Numerical experiment settings</summary><label>Physics timestep <select id="finite-dt"><option value="0.004166666666666667">1/240 s</option><option value="0.008333333333333333">1/120 s</option><option value="0.016666666666666666">1/60 s</option></select></label><p>Changing timestep changes the simulation and requires Apply and reset water. This is separate from playback speed.</p></details>
 <pre id="finite-clock-status"></pre><p id="finite-error" role="alert"></p>`;
 const $=id=>setup.querySelector('#'+id);
 for(const [id,value]of [['scene',route.fixture.scene],['resolution',route.fixture.resolution],['scaling',route.scaling],['dt',route.dt],['rate',route.rate]])$('finite-'+id).value=value;
 const run=async action=>{try{$('finite-error').textContent='';await action();}catch(e){$('finite-error').textContent=e.message;}};
 $('finite-rate').addEventListener('input',()=>run(()=>{route.clock.setRate(Number($('finite-rate').value));route.rate=route.clock.state().rate;const u=new URL(location.href);u.searchParams.set('finger_fluid_playback_rate',route.rate);history.replaceState(history.state,'',u);onRequest?.({kind:'playback',rate:route.rate,dt:route.dt});}));
 $('finite-apply').onclick=()=>run(async()=>{const u=new URL(location.href);for(const [k,id]of [['finger_fluid_box_scene','scene'],['finger_fluid_box_resolution','resolution'],['finger_fluid_physics_dt','dt'],['finger_fluid_viscosity_scaling','scaling']])u.searchParams.set(k,$('finite-'+id).value);finiteWorkbenchRoute(u.searchParams);history.replaceState(history.state,'',u);await restart();});
 $('finite-advance').onclick=()=>run(async()=>{setPaused(true);const n=targetStep(Number($('finite-time').value),route.dt,getSolver().getDebugState().stepCount);if(n>getSolver().getDebugState().stepCount)await advance(n);});
 for(const id of ['finite-resolution','finite-rate','finite-time'])installNumberDrag?.({input:$(id),step:id==='finite-resolution'?8:.01});
 const status=doc.createElement('div');status.id='ipbf-control-status';root.append(status);
 const actions=root.querySelector('.fluid-material-actions');actions.classList.add('ipbf-actions');
 return {update(){material.refresh();const d=getSolver()?.getDebugState();if(!d)return;$('finite-clock-status').textContent=`${isPaused()?'Paused':'Playing'} · ${route.clock.state().rate}× playback\nStep ${d.stepCount} · simulated ${d.simulatedTimeSeconds.toFixed(6)} s\nPhysics dt ${route.dt} s · volume ${route.fixture.representedVolume.toPrecision(5)}\nSupport radius ${d.viscosityScaling.effectiveSupportRadius.toPrecision(5)}`;status.textContent=$('finite-clock-status').textContent;},apply,read:()=>getSolver()?.getMaterialControls?.(),destroy(){actions.remove();status.remove();material.destroy();root.replaceChildren();}};
}
