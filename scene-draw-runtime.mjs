// The ordinary scene's synchronous draw transaction. Providers and GPU objects
// are worker-local; settings/status are plain values supplied by its adapter.
export function createSceneDrawRuntime({THREE,readSettings,readResources,operations,
  onCameraStatus=()=>{},onWaterFrame=()=>{},onWaterError=error=>{throw error;},afterDraw,now=()=>performance.now()}){
  return function drawSceneFrame(){
    const settings=readSettings();
    if(settings.held)return;
    const {renderer,renderPipeline,sceneEmissiveCamera,waterFeature,fireLightFieldPass,
      sceneBeautyLods,sceneExposureControls,outlinedSceneOutput,outlinedCameraOutput,
      transportFrame,rawSceneOutput,sceneEmissionSource,activeSceneDepth}=readResources();
    renderer.toneMapping=settings.customToneMapping?THREE.ACESFilmicToneMapping:THREE.AgXToneMapping;
    const t0=now();
    operations.beforeDraw(t0);
    fireLightFieldPass?.renderShadows();
    sceneBeautyLods?.setPreparation(settings.assetPreparationActive);
    sceneExposureControls?.sync();
    let matchedCameraEffective=false;
    if(sceneEmissiveCamera&&(settings.giMode==='gtao'||settings.giView==='scene')){
      const physical=operations.readPhysicalCamera();
      const state=sceneEmissiveCamera.update(settings.matchFlameCamera,physical);
      matchedCameraEffective=state.effective;
      operations.applyCamera(renderPipeline,outlinedSceneOutput,outlinedCameraOutput,state.effective,{linearIntermediate:typeof waterFeature.host?.setSceneCamera==='function'});
      waterFeature.host?.setSceneCamera?.(settings.matchFlameCamera,physical);
      onCameraStatus({...state,requested:settings.matchFlameCamera,diagnostic:false});
    }else if(sceneEmissiveCamera){
      operations.applyCamera(renderPipeline,outlinedSceneOutput,outlinedSceneOutput,false,{linearIntermediate:typeof waterFeature.host?.setSceneCamera==='function'});
      waterFeature.host?.setSceneCamera?.(false);
      onCameraStatus({requested:settings.matchFlameCamera,effective:false,diagnostic:true});
    }else waterFeature.host?.setSceneCamera?.(false);
    operations.syncProxies();
    const shadingReceipt=operations.withBeautyFrame(settings.beautyFrameOptions,()=>{
      const fallback=()=>{operations.applyCamera(renderPipeline,outlinedSceneOutput,outlinedCameraOutput,matchedCameraEffective);renderPipeline.render();};
      if(waterFeature.host){
        if(!settings.waterVisible)fallback();
        else try{
          const waterPlan=operations.planFrame(t0)?.water;
          waterFeature.render({advance:!settings.capturing&&waterPlan?.advance!==false,maxSteps:waterPlan?.maxSteps,volumeTransport:transportFrame});
          operations.refreshWaterStatus?.();
          onWaterFrame(waterFeature.host.state());
        }catch(error){
          if(settings.capturing)throw error;
          onWaterError(error,fallback);
        }
      }else if(settings.flameHDRActive&&transportFrame){
        operations.renderFlameHDR({frame:transportFrame,input:rawSceneOutput,emissionInput:sceneEmissionSource,depthInput:activeSceneDepth,matched:settings.matchFlameCamera});
      }else renderPipeline.render();
    });
    if(shadingReceipt&&typeof shadingReceipt.then==='function'){
      Promise.resolve(shadingReceipt).catch(()=>{});
      throw Error('Scene beauty frame transaction must be synchronous');
    }
    afterDraw(shadingReceipt,t0);
  };
}
