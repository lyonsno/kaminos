// Ordinary Three scene/renderer construction shared by the page and its worker.
// The caller owns mounting and supplies applied viewport measurements.
function readViewport(viewport){
  const value=typeof viewport==='function'?viewport():viewport;
  if(!value||!Number.isFinite(value.width)||value.width<=0||!Number.isFinite(value.height)||value.height<=0||!Number.isFinite(value.pixelRatio)||value.pixelRatio<=0)throw Error('Scene viewport needs positive finite width, height and pixelRatio');
  return {width:value.width,height:value.height,pixelRatio:value.pixelRatio};
}

export function createSceneRenderObjects({THREE,viewport}){
  const size=readViewport(viewport);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(40,size.width/size.height,0.01,100);
  camera.position.set(0,0.6,3);
  return {scene,camera};
}

export async function createSceneRenderer({THREE,scene,camera,sharedGpu,canvas,viewport,exposure=1,
  trackTimestamp=false,allowIndependentDevice=false,updateStyle=false,onConstructed=()=>{}}){
  const size=readViewport(viewport),device=sharedGpu?.device;
  if(!device&&!allowIndependentDevice)throw Error('Scene renderer requires the shared GPU device');
  if(device&&sharedGpu.queue&&sharedGpu.queue!==device.queue)throw Error('Scene renderer shared queue mismatch');
  const renderer=new THREE.WebGPURenderer({antialias:true,...(device?{device}:{}),...(canvas?{canvas}:{}),trackTimestamp});
  let pmremGenerator;
  try{
    renderer.setSize(size.width,size.height,updateStyle);
    renderer.setPixelRatio(size.pixelRatio);
    renderer.toneMapping=THREE.AgXToneMapping;
    renderer.toneMappingExposure=exposure;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    onConstructed(renderer);
    await renderer.init();
    if(device&&renderer.backend?.device!==device)throw Error('Scene renderer did not retain the shared GPU device');
    pmremGenerator=new THREE.PMREMGenerator(renderer);
    return {scene,camera,renderer,pmremGenerator,
      resize(next=viewport){const value=readViewport(next);renderer.setPixelRatio(value.pixelRatio);renderer.setSize(value.width,value.height,updateStyle);return value;},
    };
  }catch(error){
    try{pmremGenerator?.dispose();renderer.dispose();}catch(cleanupError){error.cleanupError=cleanupError;}
    throw error;
  }
}
