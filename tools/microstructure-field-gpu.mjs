import {microFieldWGSL} from '../neural-microstructure-field.mjs';
import {withGpuErrorScopes} from './shader-herder.mjs';

export function fieldComputeSource(model){
  return `${microFieldWGSL(model)}
@group(0) @binding(0) var<storage,read> grid:array<f32>;
@group(0) @binding(1) var<storage,read> parameters:array<f32>;
@group(0) @binding(2) var<storage,read> points:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> result:array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 if(gid.x>=arrayLength(&points)){return;}
 let p=points[gid.x];let decoded=micro_field_decode(u32(p.w),p.xyz,&grid,&parameters);
 result[gid.x*3u]=vec4<f32>(decoded[0],0.0);
 result[gid.x*3u+1u]=vec4<f32>(decoded[1],0.0);
 result[gid.x*3u+2u]=vec4<f32>(decoded[2],0.0);
}`;
}

export async function decodeFieldGpu(ctx,model,points){
  if(!(points instanceof Float32Array)||points.length===0||points.length%4||!points.every(Number.isFinite))throw Error('Finite packed xyz/carrier queries required');
  for(let i=3;i<points.length;i+=4)if(!Number.isInteger(points[i])||points[i]<0||points[i]>=model.meta.carrierCount)throw Error('Query carrier outside model');
  const {device}=ctx,buffers=[];
  try{
    const module=await ctx.compileShaderModule({code:fieldComputeSource(model),label:'microstructure-field-decoder'});
    const pipeline=await withGpuErrorScopes(device,'field-pipeline',()=>device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}));
    const make=(size,usage)=>{const buffer=device.createBuffer({size,usage});buffers.push(buffer);return buffer;};
    const upload=data=>{const buffer=make(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(buffer,0,data);return buffer;};
    const grid=upload(model.grid),parameters=upload(model.parameters),queries=upload(points),bytes=points.length/4*48;
    const output=make(bytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),readback=make(bytes,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[grid,parameters,queries,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
    await withGpuErrorScopes(device,'field-dispatch',async()=>{
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);
      const groups=Math.ceil(points.length/4/64);
      if(groups>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Query count exceeds one-dimensional dispatch capacity');
      pass.dispatchWorkgroups(groups);pass.end();encoder.copyBufferToBuffer(output,0,readback,0,bytes);device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);
    });
    const padded=new Float32Array(readback.getMappedRange()),values=new Float32Array(points.length/4*9);
    for(let i=0;i<values.length/9;i++)for(let channel=0;channel<9;channel++)values[i*9+channel]=padded[i*12+Math.floor(channel/3)*4+channel%3];
    readback.unmap();return values;
  }finally{for(const buffer of buffers)buffer.destroy();}
}
