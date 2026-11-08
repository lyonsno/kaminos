// kaminos-test: node
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='three/webgpu')return {url:new URL('../lib/three.webgpu.js',import.meta.url).href,shortCircuit:true};
 if(specifier==='three/tsl')return {url:new URL('../lib/three.tsl.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
const W=await import('../lib/three.webgpu.js'),T=await import('../lib/three.tsl.js');
const {ssgiHorizonSide,ssgiHorizonInterval}=await import('../lib/addons/tsl/display/SSGIHorizon.js');
const {withKaminosGpu,evalWgslBatch,extractWgslFunction}=await import('../tools/shader-herder.mjs');
const renderer=new W.WebGPURenderer({canvas:{style:{},width:4,height:4,addEventListener(){},removeEventListener(){},getContext:()=>null}});
const material=new W.NodeMaterial(),geometry=new W.PlaneGeometry(2,2),scene=new W.Scene(),camera=new W.PerspectiveCamera();
material.colorNode=T.vec3(ssgiHorizonInterval(T.vec2(.707,.447),T.float(-Math.PI/4),ssgiHorizonSide(T.float(1),T.float(-1),T.bool(true))),0);
const builder=new W.WGSLNodeBuilder(new W.Mesh(geometry,material),renderer);Object.assign(builder,{scene,camera,material});builder.build();
const preamble=['ssgiHorizonSide','ssgiHorizonInterval'].map(name=>extractWgslFunction(builder.fragmentShader,name)).join('\n');
const inputs=[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1],[1,-1,0],[-1,1,0]];
const spec={preamble,argTypes:['f32','f32','f32'],returnType:'vec2<f32>',inputs,
 body:'let side=ssgiHorizonSide(arg0,arg1,arg2>0.5); let h=ssgiHorizonInterval(vec2f(0.70710678,0.4472136),-0.78539816,side); return vec2f(side,h.y-h.x);'};
const oracle=rows=>{assert.deepEqual(rows.map(r=>r[0]),[-1,1,1,-1,1,-1],'Retained points choose their actual slice half-plane; ordinary sampling retains the requested side');assert.ok(rows[0][1]<0.002,'A coplanar retained point behind the receiver must not become a finite self-occluding horizon');};
try {await withKaminosGpu(async ctx=>{
 oracle(await evalWgslBatch(ctx,spec));
 const faulty=await evalWgslBatch(ctx,{...spec,body:spec.body.replace('ssgiHorizonSide(arg0,arg1,arg2>0.5)','arg0')});
 assert.throws(()=>oracle(faulty),/actual slice half-plane/,'A compiling requested-side regression must fail the native oracle');
},{wgslSources:[{label:'production-ssgi-horizon',code:preamble+'\n@compute @workgroup_size(1) fn main() { _ = ssgiHorizonSide(1.0,-1.0,true); _ = ssgiHorizonInterval(vec2f(0.7,0.4),-0.78,-1.0); }',entryPoint:'main'}]});}
finally {material.dispose();geometry.dispose();}
