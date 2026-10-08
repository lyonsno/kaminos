// Observe only this caller-owned device. Bytes are API-visible allocation sizes,
// not driver/private staging memory or a unified physical-memory measurement.
export function observeDeviceMemory(device,{maxLiveBytes}={}){
  if(typeof device?.createBuffer!=='function'||typeof device.destroy!=='function')throw TypeError('owned device createBuffer/destroy methods required');
  if(maxLiveBytes!==undefined&&(!Number.isSafeInteger(maxLiveBytes)||maxLiveBytes<1))
    throw TypeError('positive safe-integer caller-selected GPU memory budget required');
  const originalCreate=device.createBuffer,originalDestroy=device.destroy,buffers=new Map(),events=[];
  let refusal=null;
  let liveBytes=0,peakLiveBytes=0,liveBufferCount=0,peakLiveBufferCount=0,totalAllocatedBytes=0,phase='new',nextId=0,restored=false,peakPhase='new';
  const emit=(kind,details={})=>events.push({kind,phase,atMs:performance.now(),liveBytes,peakLiveBytes,...details});
  const release=(row,reason)=>{if(!row.live)return;row.live=false;liveBytes-=row.bytes;liveBufferCount--;emit('destroy-requested',{id:row.id,bytes:row.bytes,reason});};
  const wrappedCreate=function(...args){
    if(this!==device)return Reflect.apply(originalCreate,this,args);
    if(maxLiveBytes!==undefined){
      const requestedBytes=args[0]?.size;
      if(!Number.isSafeInteger(requestedBytes)||requestedBytes<0)throw TypeError('budgeted GPUBuffer size must be a nonnegative safe integer');
      if(requestedBytes>maxLiveBytes-liveBytes){
        refusal={phase,requestedBytes,liveBytes,maxLiveBytes,label:args[0]?.label??null};
        emit('allocation-refused',refusal);
        const error=Error('TRELLIS GPU memory budget exceeded before allocation: '+(liveBytes+requestedBytes)+' > '+maxLiveBytes);
        error.name='TrellisMemoryBudgetError';error.memoryBudget=refusal;throw error;
      }
    }
    const buffer=Reflect.apply(originalCreate,this,args),bytes=buffer.size;
    if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('observed GPUBuffer.size must be a nonnegative safe integer');
    if(buffers.has(buffer))return buffer;
    const row={id:++nextId,bytes,label:args[0]?.label??null,live:true,originalDestroy:buffer.destroy};
    if(typeof row.originalDestroy!=='function')throw Error('observed GPUBuffer.destroy required');
    buffer.destroy=function(...values){const result=Reflect.apply(row.originalDestroy,this,values);const receiver=buffers.get(this);if(receiver)release(receiver,'buffer.destroy');return result;};
    buffers.set(buffer,row);liveBytes+=bytes;liveBufferCount++;totalAllocatedBytes+=bytes;
    if(liveBytes>peakLiveBytes){peakLiveBytes=liveBytes;peakPhase=phase;}
    peakLiveBufferCount=Math.max(peakLiveBufferCount,liveBufferCount);emit('allocated',{id:row.id,bytes,label:row.label});return buffer;
  };
  const wrappedDestroy=function(...args){const result=Reflect.apply(originalDestroy,this,args);if(this===device)for(const row of buffers.values())release(row,'device.destroy');return result;};
  device.createBuffer=wrappedCreate;device.destroy=wrappedDestroy;
  if(device.createBuffer!==wrappedCreate||device.destroy!==wrappedDestroy)throw Error('owned device observation could not be installed');
  return Object.freeze({events,setPhase(value){phase=String(value);},snapshot(){return{
    schema:'trellis2.device-memory.v0',status:'observed',liveBytes,peakLiveBytes,peakPhase,liveBufferCount,peakLiveBufferCount,
    totalAllocatedBytes,...(maxLiveBytes!==undefined?{budget:{maxLiveBytes,refusal,scope:'new API-visible buffers on this device; not physical RAM'}}:{}),
    physicalMemoryMeasured:false,meaning:'unique API-visible GPUBuffer sizes; destroy-request accounting, excludes driver/upload-private memory'};},
    restore(){if(restored)return;restored=true;device.createBuffer=originalCreate;device.destroy=originalDestroy;
      for(const [buffer,row]of buffers)buffer.destroy=row.originalDestroy;buffers.clear();}});
}
