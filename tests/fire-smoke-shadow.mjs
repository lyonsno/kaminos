// kaminos-test: node
import assert from 'node:assert/strict';
const smoke=await import('../fire-smoke-shadow.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
import {integrateSceneMediumSegment} from '../scene-volume-source.mjs';
assert.equal(typeof smoke.smokeShadowPlan,'function','smoke attenuation needs a bounded light-space prefix atlas');
const plan=smoke.smokeShadowPlan({resolution:12,steps:18,count:4},{maxTextureDimension2D:8192});
assert.deepEqual(plan.size,[288,60]);
for(const bad of [{steps:0},{steps:1.5},{resolution:0},{count:-1},{resolution:9000}])
  assert.throws(()=>smoke.smokeShadowPlan({resolution:12,steps:18,count:4,...bad},{maxTextureDimension2D:8192}));
for(let face=0;face<6;face++)for(const uv of [[.5,.5],[.2,.3],[.8,.9]]){
  const ray=smoke.smokeCubeDirection(face,...uv),mapped=smoke.smokeCubeCoordinates(ray);
  assert.equal(mapped.face,face);mapped.uv.forEach((x,i)=>assert(Math.abs(x-uv[i])<1e-12));
}
const dimensions=[8,16,8],values=new Float32Array(8*16*8*4);
for(let i=3;i<values.length;i+=4)values[i]=2;
const field={dimensions,values};
for(const [source,direction] of [[[0,0,0],[1,0,0]],[[0,0,0],[0,1,0]],[[3,0,0],[-1,0,0]],[[3,0,0],[0,1,0]]]){
  const prefix=smoke.smokeShadowPrefixReference(field,source,direction,64);
  for(const t of [0,.2,.7,1,2,4,8]){
    const receiver=source.map((x,a)=>x+t*direction[a]);
    const tau=smoke.sampleSmokePrefix(prefix,t);
    const expected=integrateSceneMediumSegment(field,source,receiver,.01);
    assert(Math.abs(tau-expected)<.15,`${source} -> ${receiver}: ${tau} != ${expected}`);
  }
}
values.fill(0);
assert(smoke.smokeShadowPrefixReference(field,[0,0,0],[1,0,0],4).tau.every(x=>x===0));
console.log('smoke light-space prefix geometry, receiver depth and constant-medium reference passed');
