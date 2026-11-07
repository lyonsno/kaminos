import {CLOSEST_SURFACE_WGSL,DUAL_CONTOUR_WGSL} from './original-remesh-wgsl.js';
import {abortError} from './finishing-worker.js';
const U={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128};
const align=n=>Math.ceil(n/4)*4;
const nextTask=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);});

export async function createRemeshGpu({device,bvh,signal,onProgress=()=>{},withGpu=(_phase,work)=>work()}){
  if(!device?.createBuffer||!device?.queue)throw TypeError('original remesh requires the app GPU device');
  const owned=[],check=()=>{if(signal?.aborted)throw abortError(signal);},limit=Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize);
  function buffer(bytes,usage,label){
    if(bytes.byteLength>limit)throw RangeError(`${label} exceeds effective device storage capacity (${bytes.byteLength} > ${limit})`);
    const b=device.createBuffer({size:Math.max(4,align(bytes.byteLength)),usage,mappedAtCreation:true,label});
    new Uint8Array(b.getMappedRange()).set(new Uint8Array(bytes.buffer??bytes,bytes.byteOffset??0,bytes.byteLength));b.unmap();return b;
  }
  let queryPipeline,dcPipeline;
  device.pushErrorScope('validation');
  try{
    const compile=async(code,label,entryPoint)=>{
      const module=device.createShaderModule({code,label}),info=await module.getCompilationInfo();
      const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(label+': '+errors.map(m=>m.message).join('\n'));
      return device.createComputePipelineAsync({label,layout:'auto',compute:{module,entryPoint}});
    };
    queryPipeline=await compile(CLOSEST_SURFACE_WGSL,'original-remesh closest surface','closest_surface');
    dcPipeline=await compile(DUAL_CONTOUR_WGSL,'original-remesh dual contour','dual_contour');
  }finally{const error=await device.popErrorScope();if(error)throw Error('original remesh GPU validation: '+error.message);}
  try{for(const [name,data] of Object.entries(bvh))owned.push(buffer(data,U.STORAGE,`original-remesh BVH ${name}`));}
  catch(error){owned.forEach(b=>b.destroy());throw error;}
  // bvh insertion order is not an ABI; bind the four explicit buffers below.
  const source=Object.fromEntries(Object.keys(bvh).map((k,i)=>[k,owned[i]]));
  async function dispatch(pipeline,inputs,count,outputSizes,label){
    return withGpu(label,onEncoded=>dispatchAdmitted(pipeline,inputs,count,outputSizes,label,onEncoded));
  }
  async function dispatchAdmitted(pipeline,inputs,count,outputSizes,label,onEncoded){
    check();const allocated=[];device.pushErrorScope('validation');
    try{
      const outputs=outputSizes.map((size,i)=>{const b=device.createBuffer({size:Math.max(4,size),usage:U.STORAGE|U.COPY_SRC,label:label+' output '+i});allocated.push(b);return b;});
      const uniform=buffer(new Uint32Array([count,0,0,0]),U.UNIFORM,label+' count');allocated.push(uniform);
      const bindings=[...inputs,...outputs,uniform];
      const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map((b,binding)=>({binding,resource:{buffer:b}}))});
      const encoder=device.createCommandEncoder({label}),pass=encoder.beginComputePass({label});
      pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();
      const staging=outputs.map((out,i)=>{const b=device.createBuffer({size:Math.max(4,outputSizes[i]),usage:U.MAP_READ|U.COPY_DST,label:label+' read '+i});allocated.push(b);encoder.copyBufferToBuffer(out,0,b,0,outputSizes[i]);return b;});
      const command=encoder.finish();onEncoded?.();device.queue.submit([command]);
      const reads=[];for(const b of staging){await b.mapAsync(1);try{reads.push(b.getMappedRange().slice(0));}finally{b.unmap();}}
      check();return reads;
    }finally{allocated.forEach(b=>b.destroy());const error=await device.popErrorScope();if(error)throw Error(label+' validation: '+error.message);}
  }
  async function query(points){
    check();if(!(points instanceof Float32Array)||points.length%3||!points.every(Number.isFinite))throw TypeError('finite F32 query positions required');
    const n=points.length/3,packed=new Float32Array(n*8),faceIds=new Uint32Array(packed.buffer);
    const capacity=Math.min(Math.floor(limit/32),device.limits.maxComputeWorkgroupsPerDimension*64);
    for(let start=0;start<n;start+=capacity){
      const count=Math.min(capacity,n-start),input=buffer(points.subarray(start*3,(start+count)*3),U.STORAGE,'original-remesh queries');
      try{const [data]=await dispatch(queryPipeline,[source.nodes,source.vertices,source.triangles,source.order,input],count,[count*32],'original-remesh closest surface');packed.set(new Float32Array(data),start*8);}
      finally{input.destroy();}
      onProgress({kind:'closest-surface',completed:Math.min(n,start+count),total:n});await nextTask();
    }
    const distances=new Float32Array(n),positions=new Float32Array(n*3);
    for(let i=0;i<n;i++){
      if(faceIds[i*8+7]>=bvh.triangles.length/3||!Number.isFinite(packed[i*8+3])||!packed.subarray(i*8,i*8+7).every(Number.isFinite))throw Error('incomplete closest-surface GPU result');
      distances[i]=packed[i*8+3];positions.set(packed.subarray(i*8,i*8+3),i*3);
    }
    return {distances,positions,packed};
  }
  async function contour(coords,indices,sdf){
    const n=coords.length/3,dual=new Float32Array(coords.length),intersections=new Int32Array(coords.length);
    const capacity=Math.min(Math.floor(limit/32),device.limits.maxComputeWorkgroupsPerDimension*64);
    const distances=buffer(sdf,U.STORAGE,'original-remesh corner distances');
    try{for(let start=0;start<n;start+=capacity){
      const count=Math.min(capacity,n-start),cells=buffer(coords.subarray(start*3,(start+count)*3),U.STORAGE,'original-remesh cells'),corners=buffer(indices.subarray(start*8,(start+count)*8),U.STORAGE,'original-remesh corner indices');
      try{const [a,b]=await dispatch(dcPipeline,[cells,corners,distances],count,[count*12,count*12],'original-remesh dual contour');dual.set(new Float32Array(a),start*3);intersections.set(new Int32Array(b),start*3);}
      finally{cells.destroy();corners.destroy();}await nextTask();
    }}finally{distances.destroy();}
    return {dual,intersections};
  }
  return {query,contour,dispose(){owned.forEach(b=>b.destroy());}};
}
