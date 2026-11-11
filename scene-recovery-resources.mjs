// Resource callbacks for the existing device recovery coordinator. State is a
// live resource owner (the page uses accessors; the worker uses its local shell).
// Acquisition, domain construction and admission remain with their owners.
export function createSceneRecoveryResourceCallbacks({state,readInputs,acquireDevice,discardDevice,replaceRenderer,releaseRenderer,
 waitForResources,releaseRadiance,retireModel,adoptRenderer,restoreFlame,rebuildOutput,restoreEnvironment,activateFlame}){
 for(const [name,value] of Object.entries({readInputs,acquireDevice,discardDevice,replaceRenderer,releaseRenderer,waitForResources,releaseRadiance,
  retireModel,adoptRenderer,restoreFlame,rebuildOutput,restoreEnvironment,activateFlame})){
  if(typeof value!=='function')throw Error(`Scene recovery requires ${name}`);
 }
 let snapshot=null;
 return {
  readSnapshot:()=>snapshot,
  clearSnapshot(){snapshot=null;},
  stop(){
   snapshot??={...readInputs()};
   state.environmentLoader.invalidateResources();
   state.transportPrototype?.setSceneTransportConsumer(null);state.transportPrototype=null;
   state.authoredWaterFlameTransportActive=false;state.authoredFlameHDRActive=false;
   state.frameComposition.setForegroundServiceActive(false);
   state.waterFeature.restart(state.waterFeature.setup);
   state.volumePrototype?.retireLostDevice();
   return state.volumePrototype?.setActive(false);
  },
  async rebuild(context){
   const {watch,assertCurrent}=context;
   if(!snapshot)throw Error('Scene recovery has no retained simulation inputs');
   const blocked=readInputs().unsupportedReason;
   if(blocked)throw Error(blocked);
   await waitForResources(context);assertCurrent();
   await releaseRadiance();assertCurrent();
   await retireModel();assertCurrent();
   state.waterFeature.restart(state.waterFeature.setup);
   if(state.collisionVoxelMesh){
    const mesh=state.collisionVoxelMesh;
    state.scene.remove(mesh);mesh.userData.disposeGpuSolid?.();mesh.geometry.dispose();mesh.material.dispose();state.collisionVoxelMesh=null;
   }
   state.collisionVoxelRevision=undefined;
   state.volumeBridge?.dispose?.();state.volumeBridge=null;
   await state.volumePrototype?.dispose();state.volumePrototype=null;assertCurrent();
   for(const graph of state.giOutputGraphs.values())graph.fireLightFieldPass?.dispose();
   state.giOutputGraphs.clear();state.fireLightFieldPass=null;
   state.sceneFlameHDR?.dispose();state.sceneFlameHDR=null;state.sceneBloom.dispose();
   state.neutralEnvironmentMap?.dispose();state.neutralEnvironmentMap=null;
   state.scene.environment=null;state.scene.background=null;
   const next=await acquireDevice(context);
   try{assertCurrent();}catch(error){await discardDevice(next);throw error;}
   let detachCandidate,created;
   try{
    detachCandidate=watch(next.device);
    created=await replaceRenderer(next,context);
    assertCurrent();
    state.renderer=created.renderer;state.sharedGpu=next;state.pmremGenerator=created.pmremGenerator;
    await adoptRenderer({sharedGpu:next,renderer:created.renderer,pmremGenerator:created.pmremGenerator},context);assertCurrent();
    state.sceneGI.reflections.setRenderer(created.renderer);
    state.renderPipeline.renderer=created.renderer;state.renderPipeline.needsUpdate=true;
    state.sceneGI.resetHistory('device-replaced');
    if(snapshot.flame){await restoreFlame(snapshot,context);assertCurrent();}
    await rebuildOutput();assertCurrent();
    await restoreEnvironment();assertCurrent();
    if(snapshot.water){
     const mounted=await state.waterFeature.recover(snapshot.waterPaused);assertCurrent();
     if(!mounted)throw Error(state.waterFeature.failure||'Water could not restart');
    }
    if(snapshot.active){await activateFlame(snapshot,context);assertCurrent();}
   }catch(error){
    detachCandidate?.();state.waterFeature.restart(state.waterFeature.setup);
    state.volumePrototype?.retireLostDevice();
    try{await state.volumePrototype?.setActive(false);}
    finally{
     await releaseRenderer();state.pmremGenerator=null;await discardDevice(next);
    }
    throw error;
   }
  },
 };
}
