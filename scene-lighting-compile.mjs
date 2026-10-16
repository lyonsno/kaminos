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
    try {
      renderer.setRenderTarget(pass.renderTarget);renderer.setMRT(pass._mrt);
      renderer.transparent=pass.transparent;renderer.opaque=pass.opaque;renderer.autoClear=true;
      if(pass._layers)camera.layers.mask=pass._layers.mask;
      if(pass.overrideMaterial!==null)scene.overrideMaterial=pass.overrideMaterial;
      if(pass.contextNode!==null){
        if(!pass._contextNodeCache||pass._contextNodeCache.version!==pass.version)
          pass._contextNodeCache={version:pass.version,context:TSL.context({...prior.context.getFlowContextData(),...pass.contextNode.getFlowContextData()})};
        renderer.contextNode=pass._contextNodeCache.context;
      }
      scene.name=pass.name||scene.name;
      await renderer.compileAsync(scene,camera);
    } finally {
      renderer.setRenderTarget(prior.target);renderer.setMRT(prior.mrt);renderer.contextNode=prior.context;
      renderer.transparent=prior.transparent;renderer.opaque=prior.opaque;renderer.autoClear=prior.autoClear;
      scene.overrideMaterial=prior.material;camera.layers.mask=prior.mask;scene.name=prior.name;
    }
  }
}
