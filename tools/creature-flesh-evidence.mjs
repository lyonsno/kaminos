export function admitContactState(state,{steps=null,caseSha256,preparedSha256,presented=false,mode=null,physical=true,solver='cpu-tetrahedral-local-energy'}={}){
 if(!['cpu-tetrahedral-local-energy','webgpu-tetrahedral-local-energy'].includes(solver)||!state||state.error||state.deformer?.backend!=='webgpu-dense-dq'||state.deformer?.physicalBackend!==solver||state.deformer?.allInfluences!==true||!Number.isSafeInteger(state.deformer.dispatches)||state.deformer.dispatches<1)throw Error('Missing actual GPU/physical owner or fallback backend');
 const gpu=solver==='webgpu-tetrahedral-local-energy',v=gpu?state.volume?.snapshot:state.volume;
 if(gpu&&(!state.gpuValidated||state.volume.backend!=='webgpu'||!v?.current||!Number.isSafeInteger(v.epoch)||v.epoch<0||v.epoch!==state.volume.epoch||!Number.isSafeInteger(v.gpuSteps)||v.gpuSteps!==state.steps||v.steps!==state.steps))throw Error('Missing, stale or unexecuted GPU physical snapshot');
 if(gpu&&(state.physical!==physical||state.volume.enabled!==physical))throw Error('Requested physical mode is not effective');
 if(!Number.isSafeInteger(state.steps)||state.steps<0||!Number.isSafeInteger(state.volume?.steps)||state.volume.steps!==((physical||gpu)?state.steps:0)||(steps!==null&&state.steps!==steps))throw Error('Missing or stale physical steps');
 if(!Number.isSafeInteger(state.body?.vertices)||state.body.vertices<1||!Number.isSafeInteger(state.body?.triangles)||state.body.triangles<1||!(Number.isFinite(v.minJ)&&v.minJ>0)||!Number.isFinite(v.volumeRatio))throw Error('Partial or invalid physical/skin output');
 if(caseSha256&&state.source?.caseSha256!==caseSha256||preparedSha256&&state.preparedSha256!==preparedSha256)throw Error('Wrong source case or physical preparation');
 if(presented&&state.deformer.pending!==false)throw Error('Physical step has no matching presented skin');
 if(!physical&&(state.physical!==false||v.maxDisplacement!==0))throw Error('Physics-off baseline contains physical displacement');
 if(mode){
  if(!['held','motion'].includes(mode)||state.motion!==(mode==='motion'))throw Error('Requested motion mode is not effective');
  const {fps,frames}=state.clip??{},dt=state.clock?.timeStep;
  if(!Number.isFinite(fps)||fps<=0||!Number.isSafeInteger(frames)||frames<2||!Number.isFinite(dt)||dt<=0)throw Error('Missing retained clip timing');
  const phase=state.steps*dt*fps,expected=mode==='motion'?Math.min(frames-1,Math.floor(phase+4*Number.EPSILON*Math.max(1,phase))):0;
  if(state.frame!==expected)throw Error(`Retained ${mode} frame mismatch: ${state.frame} != ${expected}`);
 }
 return true;
}
