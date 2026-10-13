export function validateStoneViewportHost(host){
 if(!host?.renderer?.backend?.isWebGPUBackend||host.adapter?.info?.isFallbackAdapter!==false)throw Error('Stone requires a verified native viewport');
 if(!host.device||host.renderer.backend.device!==host.device)throw Error('Stone must borrow the effective viewport device');
 if(!host.scene?.isScene||!host.camera?.isCamera||host.controls?.domElement!==host.renderer.domElement)throw Error('Stone requires the shared scene, camera and canvas controls');
 if(typeof host.subscribeFrame!=='function')throw Error('Stone requires a host frame subscription');
 return host;
}
