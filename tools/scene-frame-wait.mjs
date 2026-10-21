export async function waitSceneFrame(page,after){
  const handle=await page.waitForFunction(after=>{
    const fluid=window.__kaminosVolumePrototype?.debugState();
    const error=fluid?.error||window.kaminosWorkbenchExperimentError;
    const frame=window.kaminosSceneGIDebugState?.().sceneFrames;
    return error?{error:String(error),frame,fluid}:frame>after?{frame}:false;
  },after);
  const observation=await handle.jsonValue();await handle.dispose();
  if(observation.error)throw Error('Volume runtime failed while awaiting scene frame: '+observation.error);
  return observation;
}
