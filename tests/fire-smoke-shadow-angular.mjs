// kaminos-test: node
import assert from 'node:assert/strict';
import * as smoke from '../fire-smoke-shadow.mjs';
assert.equal(typeof smoke.smokeAngularFilterFootprint,'function','smoke filter needs a resolution-independent angular footprint');
const footprint=smoke.smokeAngularFilterFootprint;
for(const direction of [[1,0,0],[1,1,1],[0,-1,.01]])for(const tapsPerAxis of [1,2,3,4,5,6]){
 const length=Math.hypot(...direction),d=direction.map(v=>v/length),taps=footprint({direction:d,angleDegrees:8,tapsPerAxis});
 assert.equal(taps.length,tapsPerAxis**2);assert(Math.abs(taps.reduce((sum,t)=>sum+t.weight,0)-1)<1e-12);
 for(const t of taps){assert(Math.abs(Math.hypot(...t.direction)-1)<1e-12);assert(t.weight>0);assert(d.reduce((s,v,a)=>s+v*t.direction[a],0)>Math.cos(12*Math.PI/180));}
}
for(const value of [{angleDegrees:-1},{angleDegrees:90},{tapsPerAxis:1.5},{tapsPerAxis:0}])assert.throws(()=>footprint({direction:[1,0,0],angleDegrees:8,tapsPerAxis:3,...value}));
const args={face:0,x:8,y:8,resolution:17,angleDegrees:8,tapsPerAxis:3};
for(const tau of [0,1e-6,2,65504])assert(Math.abs(smoke.filterSmokeDirectionReference({...args,read:()=>tau})-tau)<1e-10,'transmission identity survives angular interpolation');
const analytic=d=>.4+.2*d[1]+.1*d[2]*d[2];
const taps=footprint({direction:[1,0,0],angleDegrees:8,tapsPerAxis:3}),expected=taps.reduce((s,t)=>s+t.weight*analytic(t.direction),0);
const errors=[];
for(const resolution of [17,33,65]){
 const mid=(resolution-1)/2;
 const actual=Math.exp(-smoke.filterSmokeDirectionReference({...args,resolution,x:mid,y:mid,read:(face,x,y)=>-Math.log(analytic(smoke.smokeCubeDirection(face,(x+.5)/resolution,(y+.5)/resolution)))}));
 errors.push(Math.abs(actual-expected));
}
assert(errors.at(-1)<errors[0]);assert(errors.at(-1)<1e-4,'higher map resolution refines the same angular filter');
assert.equal(typeof smoke.smokeShadowWork,'function');
const work=smoke.smokeShadowWork({resolution:16,steps:12,count:6,filter:true,angleDegrees:8,tapsPerAxis:3});
assert.equal(work.integrationRays,9216);assert.equal(work.maximumMediumReads,110592);assert.equal(work.filterDirectionsPerPrefix,9);assert.equal(work.prefixReadsPerOutput,36);assert.equal(work.filterOutputs,27648);assert.equal(work.prefixReads,995328);
const doubled=smoke.smokeShadowWork({resolution:32,steps:12,count:6,filter:true,angleDegrees:8,tapsPerAxis:3});assert.equal(doubled.prefixReads,4*work.prefixReads);assert.equal(doubled.maximumMediumReads,4*work.maximumMediumReads);
console.log('PASS angular footprint, transmission interpolation, independent resolution and exact sample accounting');
assert.equal(smoke.filterSmokeDirectionReference({...args,angleDegrees:0,read:(face,x,y)=>face===0&&x===8&&y===8?65504:0}),65504,'zero-weight clear corners cannot underflow an opaque center');

for(const tapsPerAxis of [2,4,6]){const taps=footprint({direction:[1,0,0],angleDegrees:8,tapsPerAxis});for(let a=1;a<3;a++)assert(Math.abs(taps.reduce((sum,t)=>sum+t.direction[a]*t.weight,0))<1e-12,'even stencils must stay symmetric');const w=smoke.smokeShadowWork({resolution:16,steps:12,count:6,filter:true,angleDegrees:8,tapsPerAxis});assert.equal(w.prefixReadsPerOutput,4*tapsPerAxis*tapsPerAxis);assert(Math.abs(smoke.filterSmokeDirectionReference({...args,tapsPerAxis,read:()=>2})-2)<1e-12);}
