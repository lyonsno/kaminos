import assert from 'node:assert/strict';
import * as sampler from '../scene-volume-gather.mjs';
assert.equal(typeof sampler.sourceGuideRaySample,'function','emitter guide must expose its actual ray and mixture density');
assert.equal(typeof sampler.sourceGuidePdf,'function','guide weight must use angular density, not selected-cell density');
assert.equal(typeof sampler.deriveSourceGuide,'function','guide must derive from authored emitter coordinates');
const {sourceGuideRaySample,sourceGuidePdf,deriveSourceGuide}=sampler;
const guide=deriveSourceGuide({position:[0,-.76,0],radius:.19,height:2.2,depth:.24});
assert.deepEqual(guide.lo,[-.38,-1,-.38].map(Math.fround));
assert.deepEqual(guide.hi,[.38,1.44,.38].map(Math.fround));
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<t,`${a} != ${b}`);
const g={lo:[-.4,-1,-.4],hi:[.4,1.5,.4]};
// Independently derived axis-aligned angular Jacobian over both full chords.
near(sourceGuidePdf([0,1,5],[0,0,-1],g,12),.25*(6**3-4**3)/48+.75*(5.4**3-4.6**3)/(3*.8*2.5*.8));
near(sourceGuidePdf([0,1,5],[0,0,-1],g,10),.3*(6**3-4**3)/48+.7*(5.4**3-4.6**3)/(3*.8*2.5*.8));
for(const p of [[0,1,5],[0,1,0],[1,1,0],[-1,3,-1]]){
  for(let i=0;i<96;i++){
    const ray=sourceGuideRaySample(p,i,g,96);
    assert(ray.pdf>0&&Number.isFinite(ray.pdf));near(Math.hypot(...ray.direction),1);
    assert.deepEqual(ray,sourceGuideRaySample(p,i,g,96),'no simulation/history seed');
    assert.deepEqual(ray.point,sourceGuideRaySample(p.map(x=>x+1e-5),i,g,96).point,'shared points across neighbors');
    assert.deepEqual(ray.point,sourceGuideRaySample(p,i,g,12).point,'count changes retain cached progressive directions');
  }
}
// Broad support remains measurable even for a compact focus region.
const count=65536,omega=4*Math.atan(2/(4*Math.sqrt(21)));
let sum=0;for(let i=0;i<count;i++)sum+=1/sourceGuideRaySample([0,1,5],i,g,count).pdf;
near(sum/count,omega,.003);
const full={lo:[-1,-1,-1],hi:[1,3,1]};
near(sourceGuidePdf([0,1,5],[0,0,-1],full,12),(6**3-4**3)/48);
const shifted=deriveSourceGuide({position:[2,-.52,0],radius:.19,height:2.2,depth:.24},{translate:[2,.24,0],scale:1});
assert.deepEqual(shifted,guide,'world/domain translation must not shift the local guide');
const outside=deriveSourceGuide({position:[20,-.76,0],radius:.19,height:2.2,depth:.24});
assert.equal(outside.effective,'full-volume');assert.equal(outside.reason,'emitter-envelope-outside-volume');
for(const bad of [{...g,lo:[NaN,-1,-.4]},{...g,hi:g.lo},{...g,hi:[2,1.5,.4]}])assert.throws(()=>sourceGuidePdf([0,1,5],[0,0,-1],bad,12));
for(const count of [0,1,3,NaN])assert.throws(()=>sourceGuidePdf([0,1,5],[0,0,-1],g,count));
assert.throws(()=>deriveSourceGuide({position:[0,0,0],radius:0,height:2,depth:.2}));
console.log('stable guide angular density, full support, source-frame and progressive contracts passed');
