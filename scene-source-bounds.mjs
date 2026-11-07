import {createLightingComputePipeline,prepareLightingComputePipelines} from './scene-lighting-compute.mjs';
const kernels=new WeakMap();
export function createLightingSourceBounds(device,{asynchronous=false}={}){
  const limit=device.limits.maxComputeWorkgroupsPerDimension;
  let kernel=kernels.get(device);
  if(!kernel){const module=device.createShaderModule({label:'occupied optical-source bounds',code:`const DISPATCH_WIDTH:u32=${limit*64}u;`+SOURCE_BOUNDS_WGSL});kernel=createLightingComputePipeline(device,{label:'occupied optical-source bounds',layout:'auto',compute:{module,entryPoint:'boundSource'}},asynchronous);kernels.set(device,kernel);}
  const storage=device.createBuffer({label:'occupied optical-source bounds reduction',size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
  const buffer=device.createBuffer({label:'occupied optical-source bounds',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  let texture=null,group=null;
  return {buffer,ready:()=>prepareLightingComputePipelines([kernel]),encode(encoder,source,dimensions,{enabled=true}={}){
    device.queue.writeBuffer(storage,0,new Uint32Array(enabled?[...dimensions,0,0,0,0,1]:[0,0,0,0,...dimensions,0]));
    if(!enabled){encoder.copyBufferToBuffer(storage,0,buffer,0,32);return;}
    const pipeline=kernel.get();
    if(texture!==source){texture=source;group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:{buffer:storage}}]});}
    const count=dimensions.reduce((a,b)=>a*b,1),groups=Math.ceil(count/64);
    const pass=encoder.beginComputePass({label:'bound current optical source'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.min(groups,limit),Math.ceil(groups/limit));pass.end();encoder.copyBufferToBuffer(storage,0,buffer,0,32);
  },destroy(){storage.destroy();buffer.destroy();}};
}
export const SOURCE_BOUNDS_WGSL=/* wgsl */`
@group(0) @binding(0) var coefficients:texture_3d<f32>;
@group(0) @binding(1) var<storage,read_write> sourceBounds:array<atomic<u32>,8>;
@compute @workgroup_size(64)
fn boundSource(@builtin(global_invocation_id) id:vec3<u32>){
 let dims=textureDimensions(coefficients);let i=id.x+id.y*DISPATCH_WIDTH;
 if(i>=dims.x*dims.y*dims.z){return;}
 let c=vec3<u32>(i%dims.x,(i/dims.x)%dims.y,i/(dims.x*dims.y));
 let m=textureLoad(coefficients,vec3<i32>(c),0);
 if(any(m.rgb!=vec3<f32>(0))||m.a>0.0){
  for(var a=0u;a<3u;a++){atomicMin(&sourceBounds[a],c[a]);atomicMax(&sourceBounds[a+4u],c[a]+1u);}
 }
}
`;
