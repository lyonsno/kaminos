export function admitContactState(state,{steps=null,caseSha256,preparedSha256,presented=false}={}){
 if(!state||state.error||state.deformer?.backend!=='webgpu-dense-dq'||state.deformer?.physicalBackend!=='cpu-tetrahedral-local-energy'||state.deformer?.allInfluences!==true||!Number.isSafeInteger(state.deformer.dispatches)||state.deformer.dispatches<1)throw Error('Missing actual GPU/physical owner or fallback backend');
 if(!Number.isSafeInteger(state.steps)||state.steps<0||!Number.isSafeInteger(state.volume?.steps)||state.volume.steps!==state.steps||(steps!==null&&state.steps!==steps))throw Error('Missing or stale physical steps');
 if(!Number.isSafeInteger(state.body?.vertices)||state.body.vertices<1||!Number.isSafeInteger(state.body?.triangles)||state.body.triangles<1||!(Number.isFinite(state.volume.minJ)&&state.volume.minJ>0)||!Number.isFinite(state.volume.volumeRatio))throw Error('Partial or invalid physical/skin output');
 if(caseSha256&&state.source?.caseSha256!==caseSha256||preparedSha256&&state.preparedSha256!==preparedSha256)throw Error('Wrong source case or physical preparation');
 if(presented&&state.deformer.pending!==false)throw Error('Physical step has no matching presented skin');
 return true;
}
