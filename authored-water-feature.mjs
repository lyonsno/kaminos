import {normalizeLocalLiquidSetup} from './local-liquid-setup.mjs';
import {resolveAuthoredWaterSampling} from './authored-water-drop.mjs';

// The application lends scene/render services. This feature owns only its water
// runtime and authored setup; factory disposal must preserve those borrowed services.
export function createAuthoredWaterFeature({services,emitters,enabledEmitters=emitters,runtimeEmitters=emitters,
  visible=()=>true,viewerPaused=()=>null,preview=()=>{},refresh=()=>{},report=()=>{},
  loadHost=()=>import('./authored-water-host.mjs'),
  loadExperiment=async options=>{
   const [{createFiniteFluidHost},{createFluidViewportHost},{createWebGPUFingerFluidSolver}]=await Promise.all([import('./finite-fluid-host.mjs'),import('./fluid-viewport-host.mjs'),import('./finger-fluid-webgpu-core.js')]);
   return createFiniteFluidHost({...options,createSolver:createWebGPUFingerFluidSolver,createPresentation:solver=>createFluidViewportHost({...options,solver})});
  }}) {
 let setup=null,host=null,failure=null,paused=false,generation=0,request=0,admitted=null,pending=null;
 const superseded=()=>Error('Water release superseded or scene changed');
 function retire(){
  generation++;request++;pending=null;admitted=null;
  const previous=host;host=null;previous?.dispose();
 }
 async function acquire({replace=false,experiment=null}={}){
  if(!setup&&!experiment)return false;
  if(!replace&&host)return true;
  if(!replace&&pending)return pending.promise;
  const ticket={generation,request:++request};
  const isCurrent=()=>ticket.generation===generation&&(admitted===ticket||ticket.request===request);
  const inputs={setup:structuredClone(experiment??setup),emitters:experiment?[]:structuredClone((replace?enabledEmitters:emitters)())};
  if(replace&&!experiment&&!inputs.emitters.length)throw Error('Show a water emitter before releasing water');
  const run=async()=>{
   let candidate=null,published=false;
   try{
    if(experiment)candidate=await loadExperiment({...services(),...inputs,isCurrent});
    else {
     const {createAuthoredWaterHost}=await loadHost();
     if(!isCurrent())throw superseded();
     candidate=await createAuthoredWaterHost({...services(),...inputs,isCurrent});
    }
    if(!isCurrent())throw superseded();
    if(!candidate){if(replace)throw Error('Water replacement did not create an available host');return false;}
    if(!replace)candidate.setEmitters(runtimeEmitters());
    const nextPaused=experiment?true:replace?false:candidate.state().mode==='finite_drop'?true:viewerPaused()??paused;
    candidate.setPaused(nextPaused||(!replace&&!visible()));
    if(!isCurrent())throw superseded();
    const previous=host;host=candidate;admitted=ticket;published=true;failure=null;paused=nextPaused;
    previous?.dispose();
    if(!experiment&&(replace||candidate.state().mode==='finite_drop'))preview(false);
    return experiment?candidate:true;
   }catch(error){
    if(!published)candidate?.dispose();
    if(replace)throw error;
    if(isCurrent()){failure=error.message||String(error);report(`Water emitter saved in the scene; host water unavailable: ${failure}`);}
    return false;
   }finally{if(pending?.ticket===ticket)pending=null;}
  };
  const promise=Promise.resolve().then(run);pending={ticket,promise};return promise;
 }
 const feature={
  get setup(){return setup;},set setup(value){setup=value;},
  get host(){return host;},get failure(){return failure;},get generation(){return generation;},
  get paused(){return paused;},
  isLoading:()=>pending!==null,
  async restore(){
   if(!setup)return false;if(host)return true;failure=null;
   if(emitters().some(r=>r.localLiquidEmitter?.mode==='finite_drop')){
    setup=normalizeLocalLiquidSetup({...setup,waterSampling:resolveAuthoredWaterSampling(emitters(),setup)});
    paused=true;preview(true);refresh();
    report('Initial water preview restored. Place or edit it, then Release water.');return true;
   }
   const mounting=acquire();refresh();const mounted=await mounting;refresh();
   if(mounted)report('Local water mounted on the retained analytical basin. The solver restarts from its saved authored setup.');
   return mounted;
  },
  release:()=>acquire({replace:true}),
  async openExperiment(value){
   if(setup)throw Error('Close authored water before opening a numerical experiment');
   const candidate=await acquire({replace:true,experiment:value});
   const capability=candidate.capability;
   return {...capability,async dispose(){
    if(host===candidate){
     // The capability closes its own operation admission before disposal.
     generation++;request++;pending=null;admitted=null;host=null;
     try{await capability.dispose();}finally{services().redraw?.();refresh();}
    }
   }};
  },
  reset(){retire();paused=true;failure=null;preview(true);},
  clear(){retire();setup=null;failure=null;paused=false;},
  restart(next){retire();setup=next;failure=null;return generation;},
  fail(error){retire();failure=String(error?.message||error);},
  setPaused(value){paused=Boolean(value);host?.setPaused(paused);return paused;},
  sync(){if(host&&setup){host.setEmitters(runtimeEmitters());host.setSetup?.(setup);}},
  render(options){return host?.render(options);},
  get active(){return !!host&&!host.paused;},
 };
 return Object.freeze(feature);
}
