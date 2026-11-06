import {CUMESH_SIMPLIFY_WGSL} from './original-remesh-simplify-wgsl.js';
import {abortError} from './finishing-worker.js';
const U={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128};

// The supplied device belongs to the app. Each stage crosses Kit admission;
// all temporary buffers are owned by this step and released on every exit.
export async function createCuMeshReducerGpu({device,signal,withGpu=(_phase,work)=>work(),onProgress=()=>{}}){
  const check=()=>{if(signal?.aborted)throw abortError(signal);};check();
  const layout=device.createBindGroupLayout({entries:Array.from({length:9},(_,binding)=>({binding,visibility:4,
    buffer:{type:binding===8?'uniform':binding===2||binding===3?'read-only-storage':'storage'}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines={};
  device.pushErrorScope('validation');
  try{
    const module=device.createShaderModule({code:CUMESH_SIMPLIFY_WGSL,label:'CuMesh parallel QEM'});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error('CuMesh QEM compilation: '+errors.map(m=>m.message).join('\n'));
    for(const entryPoint of ['get_qem','edge_cost','propagate','select_edges','collapse'])
      pipelines[entryPoint]=await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint},label:'CuMesh '+entryPoint});
  }finally{const error=await device.popErrorScope();if(error)throw Error('CuMesh QEM validation: '+error.message);}

  return async function step(vertices,triangles,topology,{threshold,lambdaLength=.01,lambdaSkinny=.001}={}){
    check();const {V,F,E,packed,edges,offsets}=topology;
    if(V!==vertices.length/3||F!==triangles.length/3||!E)throw Error('CuMesh QEM topology identity mismatch or no edges');
    if(!(threshold>=0)||!Number.isFinite(lambdaLength)||!Number.isFinite(lambdaSkinny))throw RangeError('invalid CuMesh reduction costs');
    const limit=Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize),owned=[];
    const sizes=[vertices.byteLength,triangles.byteLength,edges.byteLength,packed.byteLength,V*40,E*4,F*8,(V+F+E)*4];
    for(const size of sizes)if(size>limit)throw RangeError(`CuMesh reduction storage exceeds effective device capacity (${size} > ${limit})`);
    const make=(size,usage,label,data)=>{
      const b=device.createBuffer({size:Math.max(4,size),usage,mappedAtCreation:!!data,label:'CuMesh '+label});owned.push(b);
      if(data){new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));b.unmap();}return b;
    };
    device.pushErrorScope('validation');
    try{
      const flags=new Uint32Array(V+F+E);flags.fill(1,0,V+F);
      const inputs=[vertices,triangles,edges,packed,null,null,null,flags];
      const buffers=sizes.map((size,i)=>make(size,U.STORAGE|U.COPY_SRC,'storage '+i,inputs[i]));
      const params=new ArrayBuffer(48),uint=new Uint32Array(params),float=new Float32Array(params);
      uint.set([V,F,E,0,offsets.faceOffsets,offsets.faceIds,offsets.edgeOffsets,offsets.edgeIds,offsets.boundary]);float.set([threshold,lambdaLength,lambdaSkinny],9);
      const uniform=make(48,U.UNIFORM|U.COPY_DST,'parameters');
      const bind=device.createBindGroup({layout,entries:[...buffers,uniform].map((buffer,binding)=>({binding,resource:{buffer}}))});
      const capacity=device.limits.maxComputeWorkgroupsPerDimension*64;
      for(const [name,count] of [['get_qem',V],['edge_cost',E],['propagate',F],['select_edges',E],['collapse',E]]){
        for(let start=0;start<count;start+=capacity){
          check();uint[3]=start;
          await withGpu('original-remesh QEM '+name,async onEncoded=>{
            check();device.queue.writeBuffer(uniform,0,params);
            const encoder=device.createCommandEncoder({label:'CuMesh '+name}),pass=encoder.beginComputePass();
            pass.setPipeline(pipelines[name]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(Math.min(capacity,count-start)/64));pass.end();
            const command=encoder.finish();onEncoded?.();device.queue.submit([command]);await device.queue.onSubmittedWorkDone();check();
          });
        }
        onProgress({kind:'original-remesh-qem-stage',stage:name,vertices:V,faces:F,edges:E,threshold});
      }
      return await withGpu('original-remesh QEM readback',async onEncoded=>{
        check();const reads=[0,1,7].map(i=>make(sizes[i],U.MAP_READ|U.COPY_DST,'read '+i));
        const encoder=device.createCommandEncoder();for(const [j,i] of [0,1,7].entries())encoder.copyBufferToBuffer(buffers[i],0,reads[j],0,sizes[i]);
        const command=encoder.finish();onEncoded?.();device.queue.submit([command]);
        const values=[];for(const b of reads){await b.mapAsync(1);try{values.push(b.getMappedRange().slice(0));}finally{b.unmap();}}
        check();return {vertices:new Float32Array(values[0]),triangles:new Uint32Array(values[1]),flags:new Uint32Array(values[2])};
      });
    }finally{owned.forEach(b=>b.destroy());const error=await device.popErrorScope();if(error)throw Error('CuMesh QEM step validation: '+error.message);}
  };
}
