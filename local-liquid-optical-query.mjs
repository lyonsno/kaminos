export const DEFAULT_TRANSMISSION_MIN_CONTRIBUTION = 0.25;

export function normalizeTransmissionMinContribution(value = DEFAULT_TRANSMISSION_MIN_CONTRIBUTION) {
 const cutoff = value ?? DEFAULT_TRANSMISSION_MIN_CONTRIBUTION;
 if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1) {
  throw Error('transmissionMinContribution must be a finite number in [0, 1]');
 }
 return cutoff;
}

/** Host scene depth is metric view depth, not the private toy G-buffer. */
export function localLiquidOpticalQueryControls(camera,hostFrame=false,transmissionMinContribution=DEFAULT_TRANSMISSION_MIN_CONTRIBUTION) {
 const cutoff = normalizeTransmissionMinContribution(transmissionMinContribution);
 if(!hostFrame)return [0,0,0,cutoff];
 const near=camera?.near,far=camera?.far;
 if(!Number.isFinite(near)||!Number.isFinite(far)||near<0||far<=near)throw Error('Host optical query requires a valid camera depth interval');
 return [1,far,near,cutoff];
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
