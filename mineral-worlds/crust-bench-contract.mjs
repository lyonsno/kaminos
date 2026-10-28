export function validateCrustRoute(value,root){
 if(value?.experiment!=='mineral-crust'||value.model!=='capillary-crust-strips-v1'||value.rendererBackend!=='webgpu'||value.source?.repoRoot!==root||value.registered!==true||typeof value.objectId!=='string'||!value.objectId)throw Error('Crust timing requires the requested registered WebGPU experiment and exact source root');return value;
}
export function validateCrustFrames(records){
 if(!Array.isArray(records)||!records.length)throw Error('No scene frames measured');let previous=-1;
 for(const r of records){if(r.drawn!==true||!Number.isSafeInteger(r.frame)||r.frame<=previous||!Number.isFinite(r.cpuMs)||r.cpuMs<0||!(r.gpuMs===null||Number.isFinite(r.gpuMs)&&r.gpuMs>=0))throw Error('Missing, stale or malformed scene timing');previous=r.frame;}return records;
}
