// This encloses a synchronous host depth draw, never the color presentation.
export function withLocalLiquidDepthBackground(scene,draw) {
  const background=scene.background,backgroundNode=scene.backgroundNode;
  scene.background=null;scene.backgroundNode=null;
  try{return draw();}
  finally{scene.background=background;scene.backgroundNode=backgroundNode;}
}

// The renderer submits its copy before awaiting mapping. Snapshot the metadata
// of that depth draw before yielding to later rendering or edits.
export async function readLocalLiquidDepthFrame(renderer,target,drawFrame) {
  if(!drawFrame?.frameId || !Number.isFinite(drawFrame.cameraFar)) throw Error('No current liquid depth draw');
  const observation={...drawFrame};
  const values=await renderer.readRenderTargetPixelsAsync(target,0,0,1,1);
  const pixel=Array.from(values);
  if(pixel.length!==1 || !pixel.every(Number.isFinite))throw Error('Invalid liquid depth pixel readback');
  return {...observation,pixel};
}
