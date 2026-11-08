// kaminos-test: node
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='three/webgpu')return {url:new URL('../lib/three.webgpu.js',import.meta.url).href,shortCircuit:true};
 if(specifier==='three/tsl')return {url:new URL('../lib/three.tsl.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
const {default:SSGI}=await import('../lib/addons/tsl/display/SSGINode.js');
const {PerspectiveCamera,OrthographicCamera,Vector2,Vector4,WebGPUCoordinateSystem,WebGLCoordinateSystem,TSL}=await import('../lib/three.webgpu.js');
const input=TSL.texture(),camera=new PerspectiveCamera(),effect=new SSGI(input,input,input,camera);
assert.equal(effect.useMipSampling?.value,false,'distance-dependent mips need an independent opt-in control');
assert.equal(effect.usePerspectiveReconstruction?.value,false,'perspective reconstruction needs an independent opt-in control');
assert.equal(typeof effect.getOptimizationState,'function','effective optimization state must be inspectable');
const coords=TSL.vec2(.27,.61),level=TSL.float(2);
for(let i=0;i<3;i++){
 const sample=effect._sourcePyramid.sample(i,coords,level,false);
 assert.equal(sample.uvNode,coords,'outward mip sample coordinates must survive cloning');
 assert.equal(sample.levelNode,level,'explicit mip level must survive cloning');
 assert.equal(sample.value,effect._sourcePyramid.target.textures[i]);
}
assert.equal(effect._sourcePyramid.depthNode.passNode,effect._sourcePyramid,'mip source retains its scheduling producer');
// A disabled pyramid must perform no source draw or allocation work.
effect._sourcePyramid.updateBefore({renderer:{}});
assert.equal(effect._sourcePyramid.frames,0);
effect.useMipSampling.value=true;
assert.equal(effect.getOptimizationState().mipSampling.effective,false,'request alone cannot claim effective mips');
effect.dispose();

const {updateSSGIPerspectiveParameters}=await import('../lib/addons/tsl/display/SSGIProjection.js');
const scale=new Vector4(),depthCoefficients=new Vector2();
for(const coordinateSystem of [WebGPUCoordinateSystem,WebGLCoordinateSystem]){
 for(const nearFar of [[.1,100],[.01,1000],[1,10]]){
  for(const offset of [false,true]){
   const view=new PerspectiveCamera(47,1.7,...nearFar);
   view.coordinateSystem=coordinateSystem;view.zoom=1.7;view.filmOffset=.4;
   if(offset)view.setViewOffset(2048,1024,211,71,1200,800);
   view.updateProjectionMatrix();
   // Also cover temporal projection jitter not expressed in camera properties.
   view.projectionMatrix.elements[8]+=.003;view.projectionMatrix.elements[9]-=.002;
   view.projectionMatrixInverse.copy(view.projectionMatrix).invert();
   assert.equal(updateSSGIPerspectiveParameters(view,scale,depthCoefficients),true);
   for(const u of [0,.17,.5,1])for(const v of [0,.33,.5,1])for(const d of [0,.01,.5,.99,1]){
    const zClip=coordinateSystem===WebGPUCoordinateSystem?d:d*2-1;
    const reference=new Vector4(u*2-1,1-v*2,zClip,1).applyMatrix4(view.projectionMatrixInverse);
    reference.divideScalar(reference.w);
    const z=-depthCoefficients.x/(zClip+depthCoefficients.y);
    const specialized=[-(u*2-1+scale.z)*z*scale.x,-(1-v*2+scale.w)*z*scale.y,z];
    for(const [i,expected] of [reference.x,reference.y,reference.z].entries()){
     assert(Math.abs(specialized[i]-expected)<=1e-9*Math.max(1,Math.abs(expected)),'actual projection reconstruction mismatch');
    }
   }
  }
 }
}
assert.equal(updateSSGIPerspectiveParameters(new OrthographicCamera(),scale,depthCoefficients),false);
const custom=new PerspectiveCamera();custom.projectionMatrix.elements[2]=.1;
assert.equal(updateSSGIPerspectiveParameters(custom,scale,depthCoefficients),false,'oblique projection must retain general reconstruction');
console.log('SSGI optimization controls pass');
