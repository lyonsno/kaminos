// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {THERMAL_LUT_COUNT} from '../volume-physical-color.mjs';
import {extractWgslBlock,withKaminosGpu} from '../tools/shader-herder.mjs';
import {SHARED_ASH_UNIFORM_OFFSET,WORLD_CALIBRATION_UNIFORM_OFFSET,VOLUME_UNIFORM_FLOATS} from '../volume-core.js';
const uniformStruct=extractWgslBlock(readFileSync(new URL('../volume-core.js',import.meta.url),'utf8'),'struct Uniforms').replaceAll('${THERMAL_LUT_COUNT}',String(THERMAL_LUT_COUNT));
const code=`${uniformStruct}
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read_write> output:array<vec4<f32>>;
@compute @workgroup_size(1) fn readComposedUniforms(){output[0]=u.shared_ash;output[1]=u.world_calibration;output[2]=u.calibration_pose;}`;
test('main ash and calibrated fire uniforms retain distinct GPU values after composition',async()=>{
 const expected=[11,12,13,14,21,22,23,24,31,32,33,34],data=new Float32Array(VOLUME_UNIFORM_FLOATS);data.set(expected.slice(0,4),SHARED_ASH_UNIFORM_OFFSET);data.set(expected.slice(4,12),WORLD_CALIBRATION_UNIFORM_OFFSET);
 await withKaminosGpu(async ctx=>{
  const {device}=ctx,U=GPUBufferUsage,input=device.createBuffer({size:data.byteLength,usage:U.UNIFORM|U.COPY_DST}),output=device.createBuffer({size:48,usage:U.STORAGE|U.COPY_SRC}),copy=device.createBuffer({size:48,usage:U.COPY_DST|U.MAP_READ});device.queue.writeBuffer(input,0,data);
  async function read(shader){
   const module=await ctx.compileShaderModule({label:'composed simulation uniforms',code:shader}),pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'readComposedUniforms'}}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]}));pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(output,0,copy,0,48);device.queue.submit([encoder.finish()]);await copy.mapAsync(GPUMapMode.READ);try{return Array.from(new Float32Array(copy.getMappedRange()));}finally{copy.unmap();}
  }
  try{
   const actual=await read(code);assert.deepEqual(actual,expected);
   // A valid shader with the two calibration fields exchanged must expose the
   // CPU/WGSL offset mismatch, rather than pass through compiler validation.
   const swapped=code.replace('world_calibration:','temporary_calibration:').replace('calibration_pose:','world_calibration:').replace('temporary_calibration:','calibration_pose:');
   const wrong=await read(swapped);assert.notDeepEqual(wrong,expected);console.log('composed-uniform-values:'+JSON.stringify({actual,expected,swapped:wrong}));
  }finally{input.destroy();output.destroy();copy.destroy();}
 },{wgslSources:[{label:'composed ash and world calibration',code,entryPoint:'readComposedUniforms'}]});
});
