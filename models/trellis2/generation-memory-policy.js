import {validateGenerationInputs,generationRoles} from './generation-inputs.js';

export function memoryBudgetBytes(value,name){
  if(value===undefined)return undefined;
  const bytes=Number(value)*1048576;
  if(typeof value==='boolean'||String(value).trim()===''||!Number.isSafeInteger(bytes)||bytes<1)
    throw TypeError(name+' must be an explicit positive MiB value resolving to whole bytes');
  return bytes;
}

// Caller policy, not hardware-capacity discovery. The declared F32 checkpoint
// arrays for one staged role must fit the selected GPU-buffer allowance.
// Activations, staging, driver-private memory and process footprints are
// guarded/measured separately; a pass here is not proof that the model fits.
export function admitGenerationGpuBudget(manifest,maxLiveBytes){
  validateGenerationInputs(manifest);
  if(maxLiveBytes!==undefined&&(!Number.isSafeInteger(maxLiveBytes)||maxLiveBytes<1))
    throw TypeError('positive caller-selected GPU memory budget required');
  const roles=generationRoles(manifest),checkpointBytes={};
  for(const role of roles){
    const keys=new Set(Object.values(manifest.models[role].tensors));
    checkpointBytes[role]=[...keys].reduce((n,key)=>n+manifest.tensors[key].byteLength,0);
  }
  const plan={schema:'trellis2.gpu-memory-admission.v0',maxLiveBytes:maxLiveBytes??null,checkpointBytes,
    meaning:'declared F32 checkpoint bytes per staged role; excludes activations, staging and driver-private memory; not whole-machine fit'};
  if(maxLiveBytes!==undefined){
    const rejected=Object.entries(checkpointBytes).find(([,bytes])=>bytes>maxLiveBytes);
    if(rejected){
      const error=Error('TRELLIS GPU memory budget cannot admit declared checkpoint '+rejected[0]+': '+rejected[1]+' > '+maxLiveBytes);
      error.name='TrellisMemoryBudgetError';error.memoryBudget={...plan,refusedRole:rejected[0],refusedBytes:rejected[1]};throw error;
    }
  }
  return plan;
}
