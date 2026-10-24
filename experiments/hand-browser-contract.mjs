export const BROWSER_HAND_ROUTE='kaminos.browser-hand-mesh.webgpu-local.v0';
export const JOINT_REGRESSOR_SHA='8de28f843240f88c836cd45104ae3203b0e8660180202ec8c44f926da42624bf';
const order=[0,13,14,15,20,1,2,3,16,4,5,6,17,10,11,12,19,7,8,9,18];
export function regressMeshJoints(vertices,regressor){
  if(vertices.length!==778*3||!vertices.every(Number.isFinite))throw Error('invalid mesh vertices');
  if(regressor?.length!==21||regressor.some(row=>row.length!==778||!row.every(Number.isFinite)))throw Error('invalid joint regressor');
  return order.map(j=>{
    const joint=[0,0,0];
    for(let v=0;v<778;v++)for(let axis=0;axis<3;axis++)joint[axis]+=regressor[j][v]*vertices[3*v+axis];
    return joint;
  });
}
export function browserIdentity(identity,regressorSha){
  if(identity?.routeId!==BROWSER_HAND_ROUTE||identity.backend!=='webgpu-local'||identity.device!=='browser-gpu'||
     identity.interactionAuthority!==false||identity.mobrecon?.modelId!=='mobrecon.densestack-spiralconv'||!identity.detector)throw Error('unexpected browser hand route');
  return {...identity,...identity.mobrecon.provenance,model:'mobrecon_densestack_spiralconv',jointRegressorSha256:regressorSha};
}
export function browserHandFrame(result,capture,regressor,regressorSha){
  const identity=browserIdentity(result.identity,regressorSha);
  if(result.authority!=='browser_webgpu_diagnostic_not_interaction'||result.interactionAuthority!==false||result.hasHand!==true)throw Error('unexpected browser prediction authority');
  const triples=values=>Array.from({length:values.length/3},(_,i)=>Array.from(values.slice(i*3,i*3+3)));
  const acquisitionDetails={...result.acquisition,captureId:capture.captureId,captureEpochMs:capture.captureEpochMs,
    cropPadding:result.acquisition.padding,detectorThreshold:result.acquisition.threshold};
  return {...capture,available:true,source:identity.model,identity,handedness:result.handedness,
    authority:result.authority,interactionAuthority:false,pixelBasis:'unmirrored_camera',completedEpochMs:Date.now(),
    verticesMeters:triples(result.verticesMeters),meshJointsMeters:regressMeshJoints(result.verticesMeters,regressor),
    jointBasis:'upstream_j_reg_mano_to_mpii',nativeVertices:triples(result.nativeVertices),nativeUV:Array.from(result.nativeUV),cropUV:Array.from(result.cropUV),
    acquisition:result.acquisition.source,acquisitionDetails,cropBox:result.cropBox,timings:result.timings};
}
