// kaminos-test: node
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='three/webgpu')return {url:new URL('../lib/three.webgpu.js',import.meta.url).href,shortCircuit:true};
 if(specifier==='three/tsl')return {url:new URL('../lib/three.tsl.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
const W=await import('../lib/three.webgpu.js'),{default:SSGI}=await import('../lib/addons/tsl/display/SSGINode.js');
for(const mipAvailable of [false,true])for(const perspective of [false,true]){
 const renderer=new W.WebGPURenderer({canvas:{style:{},width:4,height:4,addEventListener(){},removeEventListener(){},getContext:()=>null}});
 renderer.hasFeature=()=>mipAvailable;
 const camera=new W.PerspectiveCamera(50,1,.1,100);camera.updateProjectionMatrix();
 const inputs=Array.from({length:3},()=>new W.DataTexture(new Float32Array(4*4*4),4,4,W.RGBAFormat,W.FloatType));
 const effect=new SSGI(...inputs.map(t=>W.TSL.texture(t)),camera),scene=new W.Scene(),geometry=new W.PlaneGeometry(2,2);
 effect.useMipSampling.value=mipAvailable;effect.usePerspectiveReconstruction.value=perspective;
 const material=new W.NodeMaterial();material.colorNode=effect.getAONode();
 const errors=[],previous=console.error;console.error=(...args)=>errors.push(args.map(String).join(' '));
 try{
  for(const current of [material,effect._material]){const mesh=new W.Mesh(geometry,current),builder=new W.WGSLNodeBuilder(mesh,renderer);Object.assign(builder,{scene,camera,material:current});builder.build();assert.ok(builder.fragmentShader.length>0);}
 }finally{console.error=previous;effect.dispose();inputs.forEach(t=>t.dispose());geometry.dispose();material.dispose();}
 assert.deepEqual(errors,[],`Production SSGI branches must generate values only for value-returning callbacks (mips available: ${mipAvailable})`);
}
