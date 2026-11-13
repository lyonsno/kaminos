// Passive timestamps attach to the ordinary frame; they never drive a frame.
export function decodeParticleTiming(labels,values,identity){
 if(!labels.length||new Set(labels).size!==labels.length||values.length!==labels.length*2)return {ok:false,reason:'incomplete-or-duplicate-particle-timestamps',identity};
 const passes={};for(let i=0;i<labels.length;i++){const a=values[2*i],b=values[2*i+1];if(typeof a!=='bigint'||typeof b!=='bigint'||a===0n||b<a)return {ok:false,reason:'missing-or-invalid-particle-timestamps',identity};passes[labels[i]]=Number(b-a)/1e6;}
 return {ok:true,passes,identity,timestamps:Array.from(values,String),scope:'GPU particle pass intervals; include waits, are not additive exclusive costs and exclude simulation and shared preparation'};
}
export function createParticleTiming(device){
 let busy=false,disposed=false,enabledState=null,epoch=0,latest={ok:false,reason:'No ordinary particle frame sampled'};
 function setEnabled(enabled){if(enabled===enabledState)return;enabledState=enabled;epoch++;
  latest={ok:false,reason:enabled?'Waiting for a fresh particle frame':'Passive GPU intervals off'};}
 return {read:()=>latest,setEnabled,begin({enabled,every,frame,step,route,passNames}){
  setEnabled(enabled);
  if(!enabled||busy||disposed||frame%every!==0)return null;
  if(!device.features.has('timestamp-query')){latest={ok:false,reason:'GPU timestamps unavailable'};return null;}
  const identity={frame,step,route};if(!route){latest={ok:false,reason:'Missing effective route',identity};return null;}
  busy=true;const sampleEpoch=epoch;const current=()=>!disposed&&epoch===sampleEpoch;const labels=[],query=device.createQuerySet({type:'timestamp',count:2*passNames.length}),resolve=device.createBuffer({size:passNames.length*16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:passNames.length*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});let done=false;
  const close=()=>{if(done)return;done=true;query.destroy();resolve.destroy();read.unmap();read.destroy();busy=false;};
  return {writes(label){if(!passNames.includes(label)||labels.includes(label))throw Error('Unexpected or duplicate particle timing pass '+label);const i=labels.length*2;labels.push(label);return {timestampWrites:{querySet:query,beginningOfPassWriteIndex:i,endOfPassWriteIndex:i+1}};},finish(encoder){if(labels.length){encoder.resolveQuerySet(query,0,labels.length*2,resolve,0);encoder.copyBufferToBuffer(resolve,0,read,0,labels.length*16);}},async submitted(){try{if(!labels.length){if(current())latest={ok:false,reason:'No particle passes encoded',identity};return;}await read.mapAsync(GPUMapMode.READ);const result=decodeParticleTiming(labels,new BigUint64Array(read.getMappedRange().slice(0,labels.length*16)),identity);if(current())latest=result;}catch(error){if(current())latest={ok:false,reason:error.message,identity};}finally{close();}},abort(error){if(current())latest={ok:false,reason:error?.message??'Frame failed before submission',identity};close();}};
 },dispose(){disposed=true;}};
}
