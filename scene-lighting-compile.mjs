import {TSL} from './lib/three.webgpu.js';

// Match this bundled Three version's PassNode.updateBefore context. Its
// compileAsync alone carries target/MRT, but omits AO/GI context and draw flags.
// Caller holds scene submission for the complete asynchronous interval.
export async function compileSceneLighting(renderer, passes) {
  for (const pass of passes) {
    const {scene,camera}=pass;
    const prior={target:renderer.getRenderTarget(),mrt:renderer.getMRT(),context:renderer.contextNode,
      transparent:renderer.transparent,opaque:renderer.opaque,autoClear:renderer.autoClear,
      material:scene.overrideMaterial,mask:camera.layers.mask,name:scene.name};
    let receivingContext, receivingValue;
    try {
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
      await renderer.compileAsync(scene,camera);
    } finally {
      if(receivingContext)receivingContext.value=receivingValue;
      renderer.setRenderTarget(prior.target);renderer.setMRT(prior.mrt);renderer.contextNode=prior.context;
      renderer.transparent=prior.transparent;renderer.opaque=prior.opaque;renderer.autoClear=prior.autoClear;
      scene.overrideMaterial=prior.material;camera.layers.mask=prior.mask;scene.name=prior.name;
    }
  }
}

// One owner for renderer state across asynchronous lighting preparation. A
// flame graph replacement queues with ordinary light edits, before compiling.
export function createLightingPreparation({compile,hold,recover,onStatus=()=>{}}) {
  let task=null,revision=0,completed=0,compiling=false,external=false,held=false,error=null;
  const changes=[];
  let drain;
  const state=()=>({held,compiling,pending:completed!==revision,error,revision,completed});
  const publish=()=>onStatus(state());
  const syncHold=()=>{
    const next=external||completed!==revision||error!==null;
    if(next===held)return drain;
    held=next;drain=hold(next);return drain;
  };
  function request(change) {
    if(change)changes.push(change);
    revision++;error=null;
    const quiescent=syncHold();publish();
    if(task)return task;
    task=Promise.resolve().then(async()=>{
      await quiescent;
      compiling=true;publish();
      while(completed!==revision){
        const current=revision;
        for(const apply of changes.splice(0))await apply();
        await compile();
        completed=current;
      }
    }).catch(cause=>{error=String(cause.message??cause);throw cause;})
      .finally(()=>{compiling=false;task=null;syncHold();publish();});
    task.catch(()=>{}); // UI callers surface failure through onStatus.
    return task;
  }
  return {request,state,retry:()=>recover?.()??request(),whenIdle:()=>task??(error?Promise.reject(Error(error)):Promise.resolve()),
    setExternalHold(value){external=Boolean(value);const result=syncHold();publish();return result;}};
}
