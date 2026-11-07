import {TSL} from './lib/three.webgpu.js';
import {yieldToMain} from './lib/three.core.js';

// Match this bundled Three version's PassNode.updateBefore context. Its
// compileAsync alone carries target/MRT, but omits AO/GI context and draw flags.
// Held preparation owns submission; live preparation restores draw state at every yield.
export async function compileSceneLighting(renderer, passes, {live=false,visibility=()=>()=>{},isCurrent=()=>true}={}) {
  const generations=new Map();
  if(live)for(const {scene} of passes)if(!generations.has(scene))generations.set(scene,renderer.beginLightingPreparation(scene));
  if(!live)for(const {scene} of passes)renderer.releaseRetainedLighting?.(scene);
  const pipelineWork=[];
  try {
  try {
    for (const pass of passes) {
      const {scene,camera}=pass;
      let prior,restoreVisibility=()=>{};
      const enter=()=>{
      restoreVisibility=visibility();
      prior={target:renderer.getRenderTarget(),mrt:renderer.getMRT(),context:renderer.contextNode,
        transparent:renderer.transparent,opaque:renderer.opaque,autoClear:renderer.autoClear,
        material:scene.overrideMaterial,mask:camera.layers.mask,name:scene.name};

        renderer.setRenderTarget(pass.renderTarget);renderer.setMRT(pass._mrt);
        renderer.transparent=pass.transparent;renderer.opaque=pass.opaque;renderer.autoClear=true;
        if(pass._layers)camera.layers.mask=pass._layers.mask;
        if(pass.overrideMaterial!==null)scene.overrideMaterial=pass.overrideMaterial;
        if(pass.contextNode!==null){
          // Match PassNode's cache identity as well as its inputs. A temporary
          // context compiles a different RenderObject key from the next draw.
          if(!pass._contextNodeCache || pass._contextNodeCache.version!==pass.version){
            pass._contextNodeCache={version:pass.version,context:TSL.context({
              ...prior.context.getFlowContextData(),...pass.contextNode.getFlowContextData()})};
          }
          receivingContext=pass._contextNodeCache.context;
          receivingValue=receivingContext.value;
          const data={...receivingContext.getFlowContextData()};
          const receiveOutput=data.getOutput;
          const receiveAO=data.getAO;
          // compileAsync also builds dependent fullscreen producers under this
          // receiving context. Their MRT output structs are not surface colors:
          // a receiving hook would collapse GI/history attachments into vec4.
          if(receiveOutput)data.getOutput=function(node,...args){return node.isOutputStructNode?node:receiveOutput.call(this,node,...args);};
          // NodeMaterial sets up AO even for an unlit fullscreen material. A
          // producer compiled beneath the beauty context must not bind the very
          // visibility attachment it is about to write (WebGPU read/write alias).
          if(receiveAO)data.getAO=function(node,builder,...args){return builder.object?.isQuadMesh?node:receiveAO.call(this,node,builder,...args);};
          receivingContext.value=data;
          renderer.contextNode=receivingContext;
        }
        scene.name=pass.name||scene.name;
      };
      let receivingContext, receivingValue;
      const leave=()=>{
        if(receivingContext)receivingContext.value=receivingValue;
        renderer.setRenderTarget(prior.target);renderer.setMRT(prior.mrt);renderer.contextNode=prior.context;
        renderer.transparent=prior.transparent;renderer.opaque=prior.opaque;renderer.autoClear=prior.autoClear;
        scene.overrideMaterial=prior.material;camera.layers.mask=prior.mask;scene.name=prior.name;
        restoreVisibility();
      };
      enter();
      try {
        const cooperativeYield=async(wait=yieldToMain)=>{leave();try{await wait();}finally{enter();}};
        await renderer.compileAsync(scene,camera,null,{callDepth:pass._renderCallDepths?.get(renderer)??0,pipelineWork,
          yieldToMain:cooperativeYield,...(live?{lightsNode:generations.get(scene).node}:{})});
      } finally {leave();}
    }
  } finally {
    // Drain every submitted pass even if a later graph build fails. Driver
    // completion records are settled promises, so rejection is observed now.
    const results=await Promise.all(pipelineWork);
    for(const batch of results)for(const result of batch)if(result.status==='rejected')throw result.reason;
  }
  // A newer edit may arrive while native pipelines settle. Its predecessor
  // must never publish a mixture of source and beauty light topologies.
  const promote=isCurrent();
  for(const generation of generations.values())promote?generation.commit():generation.discard();
  }catch(error){for(const generation of generations.values())generation.discard();throw error;}
}

// One owner for renderer state across asynchronous lighting preparation. A
// flame graph replacement queues with ordinary light edits, before compiling.
export function createLightingPreparation({compile,liveCompile,hold,recover,onStatus=()=>{}}) {
  let task=null,revision=0,completed=0,compiling=false,external=false,held=false,error=null;
  const changes=[],disposals=[],kernelTasks=new Set();
  let rendererTask=Promise.resolve();
  const withRenderer=operation=>{const next=rendererTask.then(operation);rendererTask=next.catch(()=>{});return next;};
  let exclusive=!liveCompile,retained=false,kernelHolds=0,kernelFailure=null;
  let drain;
  const state=()=>({held,presentationHeld:held&&!retained&&!kernelHolds&&!kernelFailure,compiling:compiling||kernelHolds>0,pending:completed!==revision||kernelHolds>0,error,revision,completed});
  const publish=()=>onStatus(state());
  const syncHold=()=>{
    const next=external||kernelHolds>0||kernelFailure!==null||(exclusive&&(completed!==revision||error!==null));
    if(next===held)return drain;
    held=next;drain=hold(next);return drain;
  };
  function request(change) {
    if(change){changes.push(change);exclusive=true;}
    revision++;error=null;
    const quiescent=syncHold();publish();
    if(task)return task;
    task=Promise.resolve().then(async()=>{
      await quiescent;
      compiling=true;publish();
      while(completed!==revision){
        await drain; // A live edit can acquire an exclusive hold during its compile.
        const current=revision;
        await withRenderer(async()=>{
          const staged=[];let unstaged=false;
          try {
            for(const apply of changes.splice(0)){
              const result=await apply();
              if(result?.borrow&&result?.commit&&result?.discard)staged.push(result);
              else unstaged=true;
            }
            retained=staged.length>0&&!unstaged;publish();
            await Promise.all(staged.map(candidate=>candidate.prepare?.()));
            const visibility=staged.length?()=>{
              const restores=[];
              try {for(const candidate of staged)restores.push(candidate.borrow());}
              catch(cause){for(const restore of restores.reverse())restore();throw cause;}
              return ()=>{for(const restore of restores.reverse())restore();};
            }:undefined;
            const isCurrent=()=>revision===current;
            await (exclusive||external?compile:liveCompile)({isCurrent,visibility});
            for(const candidate of staged)isCurrent()?candidate.commit():candidate.discard();
          }catch(cause){for(const candidate of staged)candidate.discard();throw cause;}
        });
        completed=current;
      }
          for(const dispose of disposals.splice(0))dispose();
    }).catch(cause=>{error=String(cause.message??cause);throw cause;})
      .finally(()=>{compiling=false;task=null;syncHold();if(!error)exclusive=!liveCompile;publish();});
    task.catch(()=>{}); // UI callers surface failure through onStatus.
    return task;
  }
  function prepareKernels(operation){
    kernelHolds++;kernelFailure=null;error=null;
    const quiescent=syncHold();publish();
    const pending=(async()=>{
      try {await quiescent;return await withRenderer(operation);}
      catch(cause){kernelFailure=cause;error=String(cause.message??cause);throw cause;}
      finally{kernelHolds--;syncHold();publish();}
    })();
    kernelTasks.add(pending);pending.finally(()=>kernelTasks.delete(pending)).catch(()=>{});return pending;
  }

  return {request,prepareKernels,state,withRenderer,deferDisposal:dispose=>disposals.push(dispose),retry:()=>recover?.()??request(),whenIdle:()=>Promise.all([...(task?[task]:[]),...kernelTasks]).then(()=>{if(error)throw Error(error);}),
    setExternalHold(value){external=Boolean(value);const result=syncHold();publish();return result;}};
}
