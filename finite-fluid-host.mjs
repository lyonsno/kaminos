import {createFixedStepPlayback} from './finger-fluid-box-clock.mjs';
import {createOwnerWaterCapability,applyFluidOwnerSetup} from './fluid-owner-host.mjs';

/** One producer lifetime on the application's existing draw loop. Presentation
 * is supplied by the shared optical owner; no private canvas or frame pump. */
export async function createFiniteFluidHost({setup,device,createSolver,createPresentation,redraw=()=>{},isCurrent=()=>true}) {
 applyFluidOwnerSetup({},setup);
 let currentSetup=setup,solver=null,presentation=null,closed=false,generation=0,step=0,paused=true;
 const lifetime={},clock=createFixedStepPlayback({dt:setup.dt,rate:setup.playbackRate??1,mode:setup.playbackMode??'render_cadence'});
 async function install(next) {
  applyFluidOwnerSetup({},next);
  const candidate=await createSolver({...next.solver,simulationStepSeconds:next.dt,webgpuDevice:device,hostFrameComposition:true,hostFramePipelineIdentity:'kaminos/local-liquid-authoring-v0',presentationMode:'local_analytic_consumer'});
  if(closed||!isCurrent()){candidate.destroy?.();throw Error('Finite water lifetime changed during allocation');}
  if(!candidate.available){candidate.destroy?.();throw Error(candidate.reason??'Finite water solver unavailable');}
  let view;
  try{view=createPresentation(candidate);}
  catch(e){candidate.destroy?.();throw e;}
  const previousPresentation=presentation,previousSolver=solver;
  solver=candidate;presentation=view;currentSetup=next;generation++;step=0;paused=true;clock.reset();previousPresentation?.dispose();previousSolver?.destroy();redraw();
 }
 await install(setup);
 const assertActive=()=>{if(closed||!isCurrent())throw Error('Finite water lifetime changed');};
 const state=()=>({available:!closed&&isCurrent(),generation,step,timeSeconds:step*currentSetup.dt,frameTimeStepSeconds:currentSetup.dt,paused,playbackRate:clock.state().rate,playbackMode:clock.state().mode});
 const host={
  render({advance=true,timestampMs=performance.now()}={}){assertActive();const tick=clock.advance(timestampMs,{paused:paused||!advance});for(let i=0;i<tick.steps;i++){solver.step(currentSetup.dt);step++;}presentation.render();},
  setPaused(value){assertActive();paused=Boolean(value);clock.reset();redraw();return paused;},
  get paused(){return paused;},
  setPlaybackRate(value){assertActive();clock.setRate(value);redraw();return state();},
  setPlaybackMode(value){assertActive();clock.setMode(value);redraw();return state();},
  async advanceTo(target){assertActive();if(!Number.isSafeInteger(target)||target<step)throw Error('Reset before advancing backwards');paused=true;clock.reset();for(;step<target;step++)solver.step(currentSetup.dt);await device.queue.onSubmittedWorkDone();assertActive();redraw();return state();},
  restart:()=>install(currentSetup),
  state:()=>({...presentation.state(),clock:state(),setup:currentSetup,solver:solver.getDebugState()}),
  getMaterialControls:()=>solver.getMaterialControls?.()??{available:false},
  setMaterialControls(patch){assertActive();const receipt=solver.setMaterialControls(patch);currentSetup={...currentSetup,solver:{...currentSetup.solver,...receipt.effective}};redraw();return receipt;},
  readSceneColor:region=>presentation.readSceneColor(region),
  requestDiagnostics(options){assertActive();return solver.requestDiagnostics(options);},
  dispose(){if(closed)return;closed=true;presentation.dispose();solver.destroy();},
 };
 host.capability=createOwnerWaterCapability({state,debug:()=>solver.getDebugState(),pressure:()=>solver.getPressureControls?.()??{available:false},apply:patch=>solver.setPressureControls(patch),pause:host.setPaused,advance:host.advanceTo,restart:host.restart,dispose:host.dispose,identity:()=>lifetime,material:host.getMaterialControls,applyMaterial:host.setMaterialControls,setPlaybackRate:host.setPlaybackRate,setPlaybackMode:host.setPlaybackMode});
 return host;
}
