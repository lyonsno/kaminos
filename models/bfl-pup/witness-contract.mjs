export function validateExpansion(result,referenceCount){
 const r=result;
 if(r?.backend!=='transformers.js/onnx-webgpu'||r?.modelRevision!=='3f3edb52b2c55de0d49feab28598b68f7f8e4830'||!r?.text?.trim()||r.partial||r.stopReason!=='eos')throw Error('Wrong route, empty or partial generation cannot satisfy this witness.');
 if(r.referenceCount!==referenceCount)throw Error('Requested image references were not consumed.');
 if(Object.values(r.sessions??{}).length!==3||Object.values(r.sessions).some(s=>s.device!=='webgpu'))throw Error('The three component sessions did not select WebGPU.');
}
