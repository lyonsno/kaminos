import {BURN_STRESS_WGSL} from '../burn-fracture-gpu.mjs';
import {burnConnectionResponse} from '../burn-fracture-core.mjs';

// Diagnostic only. Runs the production stress function against analytic loads;
// the imported-object witness separately exercises the actual joint producer.
export async function probeBurnStress(){
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
 if(!adapter||adapter.isFallbackAdapter||adapter.info.vendor!=='apple')throw Error('Native Apple stress probe required');
 const device=await adapter.requestDevice(),owned=[];
 const cases=[
  {force:[-Math.PI*50,0,0],torque:[0,0,0]},
  {force:[Math.PI*50,0,0],torque:[0,0,0]},
  {force:[0,Math.PI*30,0],torque:[0,0,0]},
  {force:[0,0,0],torque:[Math.PI*20,0,0]},
  {force:[0,0,0],torque:[0,0,Math.PI*10]},
  {force:[0,-Math.PI*50,0],torque:[0,0,0],normal:[0,1,0]},
  {force:[0,0,0],torque:[0,0,Math.PI*10],fraction:.25},
 ].map(c=>({area:Math.PI,fraction:1,char:0,normal:[1,0,0],...c}));
 try{
  const input=Float32Array.from(cases.flatMap(c=>[c.area*c.fraction,...c.normal,...c.force,0,...c.torque,0]));
  const buffer=(data,usage)=>{const b=device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
  const source=buffer(input,GPUBufferUsage.STORAGE),result=buffer(new Float32Array(cases.length*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const module=device.createShaderModule({code:BURN_STRESS_WGSL+`
   @group(0) @binding(0) var<storage,read> source:array<vec4f>;
   @group(0) @binding(1) var<storage,read_write> result:array<vec4f>;
   @compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;let shape=source[i*3u];result[i]=vec4f(burnStress(shape.x,shape.yzw,source[i*3u+1u].xyz,source[i*3u+2u].xyz),0);
   }`});
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'probe'}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[source,result].map((b,binding)=>({binding,resource:{buffer:b}}))});
  const staging=device.createBuffer({size:result.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(staging);
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(cases.length);pass.end();encoder.copyBufferToBuffer(result,0,staging,0,result.size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);
  const raw=Array.from(new Float32Array(staging.getMappedRange()));staging.unmap();
  const rows=cases.map((c,i)=>{const expected=Object.values(burnConnectionResponse(c).stresses),actual=raw.slice(i*4,i*4+3);if(actual.some((v,k)=>!Number.isFinite(v)||Math.abs(v-expected[k])>Math.max(1,expected[k])*1e-5))throw Error('GPU stress diverged: '+JSON.stringify({c,expected,actual}));return {input:c,expected,actual};});
  return {adapter:{vendor:adapter.info.vendor,description:adapter.info.description},fallback:adapter.isFallbackAdapter,rows};
 }finally{for(const b of owned)b.destroy();device.destroy();}
}
