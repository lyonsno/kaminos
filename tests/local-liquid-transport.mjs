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
