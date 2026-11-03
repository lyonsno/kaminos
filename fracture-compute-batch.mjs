// Preserve compute order and per-dispatch uniform values while sharing passes.
// All renderer/device hooks are scoped to this synchronous engine submission.
const captures = new WeakMap();
export function batchCoarseCompute(renderer, action) {
 const backend=renderer.backend,device=backend.device,queue=device.queue;
 if(backend.trackTimestamp)throw Error('Fracture compute batching requires timestamp tracking disabled');
 let capture=captures.get(device);
 if(!capture){
  const descriptors=new WeakMap(),shadows=new WeakMap();
  const track=(buffer,offset,data,dataOffset=0,size)=>{
   const view=ArrayBuffer.isView(data),unit=view?(data.BYTES_PER_ELEMENT??1):1;
   const start=(view?data.byteOffset:0)+dataOffset*unit,length=size===undefined?data.byteLength-dataOffset*unit:size*unit;
   const src=new Uint8Array(view?data.buffer:data,start,length);
   if(buffer.usage&GPUBufferUsage.UNIFORM){
    let s=shadows.get(buffer);
    if(!s){const bytes=new Uint8Array(buffer.size);s={bytes,u32:buffer.size%4===0?new Uint32Array(bytes.buffer):null,version:0};shadows.set(buffer,s);}
    let changed=s.version===0;
    for(let i=0;i<length;i++)if(s.bytes[offset+i]!==src[i]){s.bytes[offset+i]=src[i];changed=true;}
    if(changed)s.version++;
    return null;
   }
   return src.slice();
  };
  capture={descriptors,shadows,bindings:new WeakMap(),uniformBuffer:null,uniformScratch:new Uint8Array(65536),uploadBuffer:null,uploadScratch:new Uint8Array(4096),track};
  captures.set(device,capture);
 }
 const begin=backend.beginCompute,finish=backend.finishCompute,write=queue.writeBuffer,submit=queue.submit,create=device.createBindGroup;
 device.createBindGroup=function(desc){const group=create.call(device,desc);capture.descriptors.set(group,{...desc,entries:desc.entries.map(e=>({...e,resource:e.resource?.buffer?{...e.resource}:e.resource}))});return group;};
 const operations=[],groups=new Map(),snapshots=new Map(),dirtyUniforms=new Set();
 let uploadBytes=0,uniformBytes=0;
 const alignment=device.limits.minUniformBufferOffsetAlignment;
 const snapshot=buffer=>{
  const shadow=capture.shadows.get(buffer);if(!shadow)throw Error('Uniform data was not observed');
  let state=snapshots.get(buffer);if(!state){state={lastVersion:-1,lastSnap:null,byContent:new Map()};snapshots.set(buffer,state);}
  if(state.lastVersion===shadow.version)return state.lastSnap;
  const key=shadow.u32?shadow.u32.join(','):shadow.bytes.join(',');
  let snap=state.byContent.get(key);
  if(!snap){
   uniformBytes=Math.ceil(uniformBytes/alignment)*alignment;
   const end=uniformBytes+buffer.size;
   if(end>capture.uniformScratch.byteLength){const next=new Uint8Array(Math.max(end,capture.uniformScratch.byteLength*2));next.set(capture.uniformScratch.subarray(0,uniformBytes));capture.uniformScratch=next;}
   capture.uniformScratch.set(shadow.bytes,uniformBytes);
   snap={offset:uniformBytes};uniformBytes=end;state.byContent.set(key,snap);
  }
  state.lastVersion=shadow.version;state.lastSnap=snap;return snap;
 };
 backend.beginCompute=function(group){if(groups.has(group))throw Error('Nested compute group');const commands=[];groups.set(group,commands);const pass={};for(const method of ['setPipeline','setBindGroup','dispatchWorkgroups','dispatchWorkgroupsIndirect'])pass[method]=(...args)=>commands.push({method,args});backend.get(group).passEncoderGPU=pass;};
 backend.finishCompute=function(group){
  const commands=groups.get(group);if(!commands)throw Error('Unknown compute group');
  // A baseline compute group submits after all writes made while encoding it.
  for(const command of commands)if(command.method==='setBindGroup'){
   const descriptor=capture.descriptors.get(command.args[1]);if(!descriptor)throw Error('Unobserved compute bind group');
   command.descriptor=descriptor;command.uniforms=descriptor.entries.map(entry=>entry.resource?.buffer?.usage&GPUBufferUsage.UNIFORM?snapshot(entry.resource.buffer):null);
  }
  operations.push({commands});groups.delete(group);
 };
 queue.writeBuffer=function(buffer,bufferOffset,data,dataOffset=0,size){const copy=capture.track(buffer,bufferOffset,data,dataOffset,size);if(buffer.usage&GPUBufferUsage.UNIFORM){dirtyUniforms.add(buffer);return;}if(copy.byteLength%4||bufferOffset%4)throw Error('Unaligned storage upload');operations.push({buffer,bufferOffset,copy,offset:uploadBytes});uploadBytes+=copy.byteLength;};
 queue.submit=()=>{throw Error('Unexpected GPU submission inside fracture batch');};
 try{
  const value=action();if(value?.then)throw Error('Fracture compute action must be synchronous');if(groups.size)throw Error('Unfinished compute group');
  const copyDst=GPUBufferUsage.COPY_DST??8;
  if(uniformBytes){
   if(!capture.uniformBuffer||capture.uniformBuffer.size<uniformBytes){
    capture.uniformBuffer?.destroy();
    const cap=Math.max(uniformBytes,capture.uniformScratch.byteLength);
    capture.uniformBuffer=device.createBuffer({size:cap,usage:GPUBufferUsage.UNIFORM|copyDst,label:'Fracture immutable per-dispatch uniforms'});
    capture.bindings=new WeakMap();
   }
   write.call(queue,capture.uniformBuffer,0,capture.uniformScratch.subarray(0,uniformBytes));
  }
  if(uploadBytes){
   if(uploadBytes>capture.uploadScratch.byteLength)capture.uploadScratch=new Uint8Array(Math.max(uploadBytes,capture.uploadScratch.byteLength*2));
   for(const op of operations)if(op.copy)capture.uploadScratch.set(op.copy,op.offset);
   if(!capture.uploadBuffer||capture.uploadBuffer.size<uploadBytes){
    capture.uploadBuffer?.destroy();
    capture.uploadBuffer=device.createBuffer({size:capture.uploadScratch.byteLength,usage:GPUBufferUsage.COPY_SRC|copyDst,label:'Fracture ordered storage uploads'});
   }
   write.call(queue,capture.uploadBuffer,0,capture.uploadScratch.subarray(0,uploadBytes));
  }
  // Preserve native buffers for consumers outside the batch and the next step.
  for(const buffer of dirtyUniforms)write.call(queue,buffer,0,capture.shadows.get(buffer).bytes);
  const encoder=device.createCommandEncoder({label:'Fracture shared compute passes'});let pass=null;
  for(const op of operations){
   if(op.copy){if(pass){pass.end();pass=null;}encoder.copyBufferToBuffer(capture.uploadBuffer,op.offset,op.buffer,op.bufferOffset,op.copy.byteLength);continue;}
   if(!pass){pass=encoder.beginComputePass();}
   for(const c of op.commands){const args=[...c.args];if(c.method==='setBindGroup'){
    let bySignature=capture.bindings.get(args[1]);if(!bySignature){bySignature=new Map();capture.bindings.set(args[1],bySignature);}const key=c.uniforms.map(s=>s?.offset??'-').join(',');let group=bySignature.get(key);
    if(!group){group=create.call(device,{...c.descriptor,entries:c.descriptor.entries.map((entry,i)=>c.uniforms[i]?{...entry,resource:{...entry.resource,buffer:capture.uniformBuffer,offset:c.uniforms[i].offset+(entry.resource.offset??0),size:entry.resource.size??entry.resource.buffer.size-(entry.resource.offset??0)}}:entry)});bySignature.set(key,group);}args[1]=group;
   }pass[c.method](...args);}
  }
  if(pass)pass.end();submit.call(queue,[encoder.finish()]);
  return value;
 }finally{device.createBindGroup=create;backend.beginCompute=begin;backend.finishCompute=finish;queue.writeBuffer=write;queue.submit=submit;}
}
