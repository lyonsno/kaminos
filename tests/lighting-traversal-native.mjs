// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createLightingSourceBounds} from '../scene-source-bounds.mjs';
import {FINE_LIGHTING_TRAVERSAL_WGSL,LIGHTING_INTERVAL_WGSL,lightingCellTraversalCode} from '../scene-lighting-traversal.mjs';
import {SOURCE_AWARE_WGSL} from '../scene-source-aware.mjs';
await withKaminosGpu(async ctx=>{
 const {device}=ctx,dimensions=[16,16,16],n=16**3;
 const texture=device.createTexture({size:dimensions,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const settings=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const bounds=createLightingSourceBounds(device);
 const output=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const staging=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{
  for(const cellMode of [false,true])for(const emptySkip of [false,true]){
   const code=`const SOURCE_PATTERN:bool=${cellMode};
@group(0) @binding(3) var<storage,read> directions:array<vec4<f32>>;
@group(0) @binding(5) var coefficients:texture_3d<f32>;
@group(0) @binding(8) var<uniform> settings:vec4<f32>;
@group(0) @binding(27) var<storage,read> sourceBounds:array<vec4<u32>,2>;
@group(0) @binding(60) var<storage,read_write> output:array<vec4<f32>,2>;
${LIGHTING_INTERVAL_WGSL}
${lightingCellTraversalCode(SOURCE_AWARE_WGSL)}
${FINE_LIGHTING_TRAVERSAL_WGSL}
@compute @workgroup_size(1) fn main(){
 output[0]=integrateFineRayPhased(vec3<f32>(-2,0,0),vec3<f32>(1,0,0),4.0,.5);
 output[1]=vec4<f32>(f32(fineRaySourceReads),0,0,0);
}`;
   const module=await ctx.compileShaderModule({code,label:'production fine lighting traversal'});
   const resources={5:texture.createView(),8:{buffer:settings},27:{buffer:bounds.buffer},60:{buffer:output}};
   // An explicit layout admits the real bounds buffer in both pre-fix and fixed shaders.
   const layout=device.createBindGroupLayout({entries:[
    {binding:5,visibility:GPUShaderStage.COMPUTE,texture:{viewDimension:'3d',sampleType:'unfilterable-float'}},
    {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    {binding:27,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:60,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   ]});
   const actual=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'main'}});
   const group=device.createBindGroup({layout,entries:Object.entries(resources).map(([binding,resource])=>({binding:Number(binding),resource}))});
   for(const name of ['empty','slab','dense']){
    const data=new Float32Array(n*4);for(let i=0;i<n;i++)if(name==='dense'||name==='slab'&&i%16===8){data[i*4]=2;data[i*4+3]=.3;}
    device.queue.writeTexture({texture},data,{bytesPerRow:256,rowsPerImage:16},dimensions);
    device.queue.writeBuffer(settings,0,new Float32Array([1,.125,0,0]));
    const encoder=device.createCommandEncoder();bounds.encode(encoder,texture,dimensions,{enabled:emptySkip});
    const pass=encoder.beginComputePass();pass.setPipeline(actual);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(output,0,staging,0,32);device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(staging.getMappedRange()));staging.unmap();
    const length=name==='empty'?0:name==='slab'?.125:2,trans=Math.exp(-.3*length),radiance=2*(1-trans)/.3;
    assert(Math.abs(values[0]-radiance)<1e-5,`${cellMode}/${name} radiance ${values[0]}`);assert(Math.abs(values[3]-trans)<1e-5);
    assert.equal(values[4],!emptySkip?16:name==='empty'?0:name==='slab'?1:16,`${cellMode}/${name} production source reads`);
   }
  }
 }finally{bounds.destroy();texture.destroy();settings.destroy();output.destroy();staging.destroy();}
});
