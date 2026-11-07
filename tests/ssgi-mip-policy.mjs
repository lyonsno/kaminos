// kaminos-test: node
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='three/webgpu')return {url:new URL('../lib/three.webgpu.js',import.meta.url).href,shortCircuit:true};
 if(specifier==='three/tsl')return {url:new URL('../lib/three.tsl.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
const W=await import('../lib/three.webgpu.js'), T=await import('../lib/three.tsl.js');
const {ssgiSourceMipLevel}=await import('../lib/addons/tsl/display/SSGIMipPolicy.js');
const {withKaminosGpu,evalWgslBatch,extractWgslFunction}=await import('../tools/shader-herder.mjs');
const renderer=new W.WebGPURenderer({canvas:{style:{},width:4,height:4,addEventListener(){},removeEventListener(){},getContext:()=>null}});
const material=new W.NodeMaterial(),geometry=new W.PlaneGeometry(2,2),scene=new W.Scene(),camera=new W.PerspectiveCamera();
material.colorNode=T.vec3(ssgiSourceMipLevel(T.uint(0),T.float(16),T.uint(1),T.float(4),T.float(3.15),T.float(4)));
const builder=new W.WGSLNodeBuilder(new W.Mesh(geometry,material),renderer);Object.assign(builder,{scene,camera,material});builder.build();
const preamble=extractWgslFunction(builder.fragmentShader,'ssgiSourceMipLevel');
try {
 await withKaminosGpu(async ctx=>{
  const rows=[[0,16,1,4,3.15,4],[3,16,0,4,3.15,4],[5,16,0,4,3.15,4],[7,16,0,4,3.15,4],
    [0,16,2,4,0,4],[7,16,2,4,0,4],[0,16,2,4,2,4],[0,0,2,4,0,4],[0,16,1,4,0,1]];
  const actual=await evalWgslBatch(ctx,{preamble,argTypes:['u32','f32','u32','f32','f32','f32'],returnType:'f32',
    body:'return ssgiSourceMipLevel(arg0,arg1,arg2,arg3,arg4,arg5);',inputs:rows});
  assert.equal(actual[0],4,'One-step fixed footprint must reach mip4 instead of being locked to mip0');
  assert.deepEqual(actual,[4,2,3,4,4,4,2,0,1],'Legacy sequence, source-distance invariance, detail bias and real mip availability');
 },{wgslSources:[{label:'production-ssgi-mip-policy',code:preamble+'\n@compute @workgroup_size(1) fn main() { _ = ssgiSourceMipLevel(0u,16.0,1u,4.0,3.15,4.0); }',entryPoint:'main'}]});
} finally { material.dispose();geometry.dispose(); }
