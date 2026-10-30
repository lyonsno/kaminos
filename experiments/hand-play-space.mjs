export const PLAY_SPACE_DEFAULTS=Object.freeze({reachX:7,reachY:3,height:1.2,depth:1.8,pitchDegrees:65,mirror:true});

export function playSpaceConfig(input={}){
  const config={...PLAY_SPACE_DEFAULTS,...input};
  for(const key of ['reachX','reachY','height','depth','pitchDegrees'])
    if(!Number.isFinite(config[key]))throw Error(`Invalid play space ${key}`);
  if(config.reachX<=0||config.reachY<=0||typeof config.mirror!=='boolean')throw Error('Invalid play space reach or mirror');
  return config;
}

// Crop UV is already unflipped by the browser route. Mirror the entire avatar,
// not only translation, so a wrist turn and a sideways move agree on direction.
export function handPlayPlacement(result,{width,height},config){
  if(result.pixelBasis!=='unmirrored_camera')throw Error('Unsupported play space pixel basis');
  const box=result.cropBox,uv=result.cropUV,wrist=result.meshJointsMeters?.[0];
  if(![width,height].every(v=>Number.isFinite(v)&&v>0)||!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||
    box[2]<=box[0]||box[3]<=box[1]||uv?.length!==42||!Array.from(uv).every(Number.isFinite)||
    !Array.isArray(wrist)||wrist.length!==3||!wrist.every(Number.isFinite))throw Error('Invalid play space observation');
  const imageWrist=[(box[0]+uv[0]*(box[2]-box[0]))/width,(box[1]+uv[1]*(box[3]-box[1]))/height];
  return {mode:'camera_plane_authored_depth',source:'mobrecon_crop_uv_wrist',captureId:result.captureId,
    acquisition:result.acquisition,fallback:result.acquisitionDetails?.fallback===true,
    imageWrist,center:[...wrist],position:[(imageWrist[0]-.5)*config.reachX*(config.mirror?-1:1),config.height+(.65-imageWrist[1])*config.reachY,config.depth],
    rotation:[-config.pitchDegrees*Math.PI/180,0,0],scale:[config.mirror?-5:5,5,5],
    authority:'authored_game_mapping_not_metric_camera_registration'};
}

export function applyHandPlayPlacement(mesh,placement){
  mesh.position.fromArray(placement.position);mesh.rotation.fromArray(placement.rotation);
  mesh.scale.fromArray(placement.scale);mesh.updateWorldMatrix(true,false);
}
