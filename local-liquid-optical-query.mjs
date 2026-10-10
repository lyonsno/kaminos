/** Host scene depth is metric view depth, not the private toy G-buffer. */
export function localLiquidOpticalQueryControls(camera,hostFrame=false) {
 if(!hostFrame)return [0,0,0,0];
 const near=camera?.near,far=camera?.far;
 if(!Number.isFinite(near)||!Number.isFinite(far)||near<0||far<=near)throw Error('Host optical query requires a valid camera depth interval');
 return [1,far,near,0];
}

export const LOCAL_LIQUID_HOST_OPTICAL_QUERY_ROUTE='wgsl-host-camera-depth-radiance-query-v1';
export function localLiquidHostOpticalInputs(frame,extent) {
 if(!frame)return null;
 return {
  linearDepthObject:{attachmentId:frame.sceneDepthAttachmentId,format:'r32float',encoding:'linear_view_depth_meters',extent},
  sceneRadiance:{attachmentId:frame.sceneColorAttachmentId,format:'rgba16float',colorSpace:'linear_hdr',extent},
  worldNormalRoughness:null,albedoMetallic:null,objectIdentity:null,
 };
}
