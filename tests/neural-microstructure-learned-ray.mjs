// kaminos-test: node
import assert from 'node:assert/strict';
import {packMicroField,microFieldWGSL} from '../neural-microstructure-field.mjs';
import {MICRO_FIELD_RAY_WGSL} from '../neural-microstructure-learned.mjs';
import {fieldFixture} from './fixtures/microstructure-field.mjs';
import {decodeFieldGpu} from '../tools/microstructure-field-gpu.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
const {meta,arrays}=fieldFixture();
arrays.grid=Float32Array.from({length:8},(_,i)=>i%2);arrays['layers.2.weight'][0]=10;arrays['layers.2.bias'][0]=-5;
const model=packMicroField(meta,arrays);
const code=`${microFieldWGSL(model)}\n${MICRO_FIELD_RAY_WGSL}
@group(0) @binding(0) var<storage,read> grid:array<f32>;
@group(0) @binding(1) var<storage,read> parameters:array<f32>;
@group(0) @binding(2) var<storage,read> points:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> result:array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 if(gid.x>=arrayLength(&points)){return;}
 let p=points[gid.x];let t=micro_field_ray(p.xyz,vec3<f32>(0.0,0.0,-1.0),vec3<f32>(0.0),vec3<f32>(1.0),0u,.1,&grid,&parameters);
 result[gid.x*3u]=vec4<f32>(t,0.0,0.0,0.0);result[gid.x*3u+1u]=vec4<f32>(0.0);result[gid.x*3u+2u]=vec4<f32>(0.0);
}`;
await withKaminosGpu(async ctx=>{
  const output=await decodeFieldGpu(ctx,model,new Float32Array([.5,.5,2,0, 2,.5,2,0, .5,.5,-1,0, .5,.5,.25,0]),code);
  for(const [i,expected]of [[0,1.675],[1,-1],[2,-1],[3,0]])assert.ok(Math.abs(output[i*9]-expected)<1e-5,`ray${i}: ${output[i*9]} != ${expected}`);
  const erased=packMicroField(meta,{...arrays,grid:new Float32Array(8)});
  const wrong=await decodeFieldGpu(ctx,erased,new Float32Array([.5,.5,2,0]),code);assert.ok(Math.abs(wrong[0]-1)<1e-6);
  assert.ok(Math.abs(wrong[0]-output[0])>.5,'Erased spatial structure must change ray depth');
  console.log('Learned production UDF ray: depth, parallel miss, backward miss, inside shell and erased-field fault passed');
},{wgslSources:[{code,entryPoint:'main',label:'learned-field-ray'}]});
