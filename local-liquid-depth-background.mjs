// This encloses a synchronous host depth draw, never the color presentation.
export function withLocalLiquidDepthBackground(scene,draw) {
  const background=scene.background,backgroundNode=scene.backgroundNode;
  scene.background=null;scene.backgroundNode=null;
  try{return draw();}
  finally{scene.background=background;scene.backgroundNode=backgroundNode;}
}
