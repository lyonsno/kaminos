export const sceneDepthCameraKey=camera=>JSON.stringify([...camera.projectionMatrix.elements,...camera.matrixWorldInverse.elements].map(Math.fround));

// Reuse preserves the dedicated override-depth semantics only in this class.
// Other scenes retain their existing depth draw and an explicit reason.
export function sceneWaterDepthReuseReason({scene,camera,source,beforeCapture,width,height,device,renderer}) {
  if(!source?.capture)return 'scene_depth_not_captured';
  if(source.scene!==scene||source.camera!==camera)return 'scene_or_camera_mismatch';
  if(source.capture.count<=beforeCapture)return 'scene_depth_not_fresh';
  if(source.capture.cameraKey!==sceneDepthCameraKey(camera))return 'scene_depth_camera_changed';
  if(source.target.width!==width||source.target.height!==height)return 'scene_depth_extent_mismatch';
  if(renderer.reversedDepthBuffer)return 'reversed_depth_unsupported';
  if(renderer.xr?.isPresenting)return 'xr_depth_unsupported';
  if(scene.overrideMaterial)return 'scene_override_material';
  const native=renderer.backend.get(source.texture)?.texture;
  if(!native||native.sampleCount!==1)return 'scene_depth_not_single_sample';
  if(renderer.backend.device!==device)return 'scene_depth_device_mismatch';
  let reason=null;
  scene.traverseVisible(object=>{
    if(reason||!object.layers.test(camera.layers))return;
    if(object.isSprite||object.isLine||object.isPoints){reason='non_mesh_depth_semantics';return;}
    if(!object.isMesh)return;
    for(const material of [].concat(object.material||[])){
      if(material.visible===false)continue;
      if(material.transparent||material.alphaTest>0||material.alphaToCoverage){reason='transparent_or_cutout_material';break;}
      if(material.depthWrite===false||material.depthTest===false||material.depthFunc!==3||material.polygonOffset){reason='modified_material_depth';break;}
      if(material.displacementMap||material.displacementNode||material.positionNode||material.vertexNode||material.depthNode||material.fragmentNode){reason='custom_vertex_or_depth';break;}
      if(material.clippingPlanes?.length||material.clippingNode){reason='material_clipping';break;}
    }
  });
  return reason;
}
