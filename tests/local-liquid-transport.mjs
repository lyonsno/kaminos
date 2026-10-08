import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=()=>import('../local-liquid-transport.mjs').catch(()=>({}));
test('the first supported solid inside water terminates the water path before the air exit',async()=>{
 const m=await load();assert.equal(typeof m.resolveLiquidTermination,'function','submerged solids need an in-medium termination decision');
 assert.deepEqual(m.resolveLiquidTermination(2,.4),{kind:'solid',waterPath:.4});
 assert.deepEqual(m.resolveLiquidTermination(2,2),{kind:'solid',waterPath:2});
 for(const distance of [-.1,2.01,NaN,Infinity,null])assert.deepEqual(m.resolveLiquidTermination(2,distance),{kind:'exit',waterPath:2});
 assert.throws(()=>m.resolveLiquidTermination(-1,.4),/path/);
});
test('zero water path has no absorption or scatter and a valid metric path does not depend on overlap counts',async()=>{
 const m=await load();assert.equal(typeof m.liquidTransportWeights,'function');
 const zero=m.liquidTransportWeights(0);assert.deepEqual(zero.absorption,[1,1,1]);assert.deepEqual(zero.scatter,[0,0,0]);
 const short=m.liquidTransportWeights(.1),long=m.liquidTransportWeights(1);
 for(let i=0;i<3;i++){assert.ok(short.absorption[i]>long.absorption[i]);assert.ok(short.scatter[i]<long.scatter[i]);}
 assert.ok(Math.abs(short.absorption[0]-Math.exp(-.11))<1e-12);
});
test('one-sided valid surface tangents recover the same metric plane normal as an interior stencil',async()=>{
 const m=await load();assert.equal(typeof m.liquidDepthNormal,'function');
 const c=[0,0,2],left=[-1,0,1.5],right=[1,0,2.5],up=[0,-1,2],down=[0,1,2],view=[0,0,-1];
 const expected=[.5/Math.sqrt(1.25),0,-1/Math.sqrt(1.25)];
 for(const points of [[left,right,up,down],[left,null,up,down],[null,right,null,down]]){
  const normal=m.liquidDepthNormal(c,...points,view);for(let i=0;i<3;i++)assert.ok(Math.abs(normal[i]-expected[i])<1e-12);
 }
 assert.deepEqual(m.liquidDepthNormal(c,null,null,null,null,view),view);
});
test('the actual host shader resolves in-water geometry before outside refraction and does not fabricate a scatter floor',()=>{
 const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
 assert.match(source,/sampleHostWaterSegment/,'host shader currently only asks after water exit');
 assert.match(source,/liquidWorldNormalAtRadius/,'empty depth must not masquerade as camera geometry');
 assert.match(source,/waterScatter\s*=\s*vec3<f32>\(0\.055, 0\.30, 0\.42\)\s*\*\s*absorptionLoss/);
});
test('metric normal orientation does not disappear when the same tangent stencil is expressed at a smaller scale',async()=>{
 const {liquidDepthNormal}=await load();const expected=[.5/Math.sqrt(1.25),0,-1/Math.sqrt(1.25)];
 for(const scale of [1e-7,1,1e7]){
  const c=[0,0,2],n=liquidDepthNormal(c,[-scale,0,2-.5*scale],[scale,0,2+.5*scale],[0,-scale,2],[0,scale,2],[0,0,-1]);
  for(let i=0;i<3;i++)assert.ok(Math.abs(n[i]-expected[i])<1e-8);
 }
});
test('camera rays come from unprojected near/far endpoints so orthographic rays stay parallel',async()=>{
 const m=await load();assert.equal(typeof m.liquidCameraRayFromEndpoints,'function');
 for(const [x,y] of [[0,0],[2,-3]])assert.deepEqual(m.liquidCameraRayFromEndpoints([x,y,1],[x,y,10]),[0,0,1]);
 const ray=m.liquidCameraRayFromEndpoints([.1,.2,1],[1,2,10]),length=Math.sqrt(1.05);
 for(let i=0;i<3;i++)assert.ok(Math.abs(ray[i]-[.1,.2,1][i]/length)<1e-12);
 const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');assert.match(source,/viewDir = -liquidWorldDirectionToView\(liquidCameraDirection\(pixel\)\)/);
});
test('a solid between the water front and particle center must not discard the visible water interface',async()=>{
 const m=await load();assert.equal(typeof m.liquidFrontVisible,'function');
 assert.equal(m.liquidFrontVisible(1.8,1.9),true); // Particle center at2 is irrelevant.
 assert.equal(m.liquidFrontVisible(2,1.9),false);assert.equal(m.liquidFrontVisible(1.8,1.8),false);
 const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');const fs=source.slice(source.indexOf('fn fs_refraction('));
 assert.match(fs,/supportOrderingDepth = select\(readSupportOrderingDepth\(pixel\), readFrontDepth\(pixel\)/);
});
test('a metric depth span divides by actual forward ray rate rather than a fixed angle clamp',async()=>{
 const m=await load();assert.equal(typeof m.liquidMetricPath,'function');
 assert.equal(m.liquidMetricPath(.1,.1),1);assert.equal(m.liquidMetricPath(.1,.5),.2);assert.equal(m.liquidMetricPath(0,1),0);
 assert.throws(()=>m.liquidMetricPath(.1,0),/forward/);assert.throws(()=>m.liquidMetricPath(.1,-1),/forward/);
});
test('host shaded reflection and hit diagnostics share one origin rule',()=>{
 const s=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
 assert.match(s,/let rayOrigin = reflectionQueryOrigin\(worldPosition, worldNormal\)/);
 assert.match(s,/reflectionHit = sampleHybridOpticalQuery\(reflectionQueryOrigin\(worldPosition, worldNormal\), reflectionDirection\)/);
});
test('accepted f32 camera matrices yield finite liquid rays even when the far endpoint is at infinity',async()=>{
 const {PerspectiveCamera,OrthographicCamera,WebGPUCoordinateSystem}=await import('../lib/three.core.js');
 const {validateFingerFluidExternalCamera}=await import('../finger-fluid-webgpu-core.js');
 const {LOCAL_LIQUID_TRANSPORT_WGSL,liquidCameraRayFromEndpoints}=await load();
 const body=LOCAL_LIQUID_TRANSPORT_WGSL.slice(LOCAL_LIQUID_TRANSPORT_WGSL.indexOf('fn liquidCameraDirection('),LOCAL_LIQUID_TRANSPORT_WGSL.indexOf('fn liquidDepthPoint('));
 const depths=[...body.matchAll(/inverseViewProjection \* vec4<f32>\(ndc, ([0-9.]+), 1\.0\)/g)].map(m=>Number(m[1]));
 assert.equal(depths.length,2,'evaluate the actual two clip depths used by the WGSL camera helper');
 const mul=(matrix,v)=>Array.from({length:4},(_,row)=>v.reduce((sum,x,col)=>Math.fround(sum+Math.fround(matrix[col*4+row]*x)),0));
 for(const far of [100,1e8])for(const orthographic of [false,true]){
  const camera=orthographic?new OrthographicCamera(-2,2,1.5,-1.5,.1,far):new PerspectiveCamera(60,4/3,.1,far);
  camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const view=camera.matrixWorldInverse.elements,projection=camera.projectionMatrix.elements;
  const validated=validateFingerFluidExternalCamera({schema:'kaminos.finger-fluid.external-camera.v0',identity:'liquid-camera-regression',generation:0,projectionType:orthographic?'orthographic':'perspective',view,projection,viewProjection:projection,inverseViewProjection:camera.projectionMatrixInverse.elements,position:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],near:.1,far,viewport:{width:640,height:480}},{width:640,height:480});
  if(!orthographic&&far===1e8)assert.equal(mul(validated.inverseViewProjection,[0,0,1,1])[3],0,'regression really has an infinite f32 far endpoint');
  for(const [x,y] of [[0,0],[.5,-.25]]){
   const endpoints=depths.map(z=>{const h=mul(validated.inverseViewProjection,[x,y,z,1]);return h.slice(0,3).map(value=>Math.fround(value/h[3]));});
   assert.ok(endpoints.flat().every(Number.isFinite),'accepted camera must yield finite endpoints in the actual WGSL construction');
   const ray=liquidCameraRayFromEndpoints(...endpoints);
   const expected=orthographic?[0,0,-1]:[x/projection[0],y/projection[5],-1];const length=Math.hypot(...expected);
   for(let i=0;i<3;i++)assert.ok(Math.abs(ray[i]-expected[i]/length)<1e-6);
  }
 }
});
