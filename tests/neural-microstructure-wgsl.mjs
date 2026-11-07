// kaminos-test: node
import assert from 'node:assert/strict';
import {MICRO_DISC_WGSL,MICRO_NEAREST_WGSL} from '../neural-microstructure-core.mjs';
import {withKaminosGpu,withGpuErrorScopes,evalWgslBatch} from '../tools/shader-herder.mjs';

const cases=[
  {o:[0,0,1],d:[0,0,-1],p:[0,0,0],n:[0,0,1],r:.1,t:1},
  {o:[.5,0,1],d:[0,0,-1],p:[0,0,0],n:[0,0,1],r:.1,t:-1},
  {o:[0,0,1],d:[1,0,0],p:[0,0,0],n:[0,0,1],r:.1,t:-1},
  {o:[0,0,1],d:[0,0,1],p:[0,0,0],n:[0,0,1],r:.1,t:-1},
  {o:[0,0,1],d:[0,0,-2],p:[0,0,0],n:[0,0,2],r:.1,t:.5},
  {o:[-1,0,1],d:[1,0,-1],p:[0,0,0],n:[0,0,-1],r:.1,t:1},
];
const body=r=>`return micro_disc_hit(vec3<f32>(arg0,arg1,arg2),vec3<f32>(arg3,arg4,arg5),vec3<f32>(arg6,arg7,arg8),vec3<f32>(arg9,arg10,arg11),${r});`;
const check=results=>cases.forEach((c,i)=>assert.ok(Math.abs(results[i]-c.t)<1e-6,`disc ${i}: expected ${c.t}, got ${results[i]}`));
const code=`${MICRO_DISC_WGSL}\n${MICRO_NEAREST_WGSL}
@group(0) @binding(0) var<storage,read> rows:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> queries:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> result:array<vec2<f32>>;
@compute @workgroup_size(8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&queries)){return;}
 let q=queries[id.x];result[id.x]=micro_nearest(vec3<f32>(q.z,0.0,2.0),vec3<f32>(0.0,0.0,-1.0),.1,u32(q.x),u32(q.y),&rows);
}`;
await withKaminosGpu(async ctx=>{
  const options={preamble:MICRO_DISC_WGSL,argTypes:Array(13).fill('f32'),returnType:'f32',inputs:cases.map(c=>[...c.o,...c.d,...c.p,...c.n,c.r])};
  check(await evalWgslBatch(ctx,{...options,body:body('arg12')}));
  const filledGap=await evalWgslBatch(ctx,{...options,body:body('100.0')});
  assert.throws(()=>check(filledGap),/disc 1/,'The oracle must reject a valid shader that fills a real gap');
  const data=new Float32Array([
    0,0,1.5,0,0,1,1,0,0,0,.8,0,
    0,0,.5,0,0,1,1,0,0,0,.8,1,
    0,0,1,0,0,1,0,1,0,0,.8,1,
    1,0,1.8,0,0,1,0,0,1,0,.8,1,
  ]);
  const queries=new Float32Array([0,3,0,0, 0,2,0,0, 0,1,0,0, 3,1,1,0, 1,1,0,0]);
  const expected=[1,2, 1.5,1, -1,-1, .2,3, 1.5,1];
  const verify=values=>expected.forEach((n,i)=>assert.ok(Math.abs(n-values[i])<1e-6,`nearest ${i}: expected ${n}, got ${values[i]}`));
  const device=ctx.device,buffers=[];
  try{
    const module=await ctx.compileShaderModule({code,label:'microstructure-nearest'});
    const pipeline=await withGpuErrorScopes(device,'microstructure-nearest-pipeline',()=>device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}));
    const make=(size,usage)=>{const b=device.createBuffer({size,usage});buffers.push(b);return b;};
    const input=make(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),query=make(queries.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),output=make(expected.length*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),readback=make(expected.length*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(input,0,data);
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[input,query,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const run=async values=>{
      device.queue.writeBuffer(query,0,values);
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(output,0,readback,0,expected.length*4);device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);const result=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();return result;
    };
    verify(await run(queries));const wrong=queries.slice();wrong[1]=1;
    const narrowed=await run(wrong);assert.throws(()=>verify(narrowed),/nearest 0/,'A hidden range truncation must fail the oracle');
  }finally{for(const buffer of buffers)buffer.destroy();}
},{wgslSources:[{code,entryPoint:'main'}]});
console.log('microstructure WGSL: disc/range/alpha/nearest execution and solid-coverage/range-truncation fault controls passed');
