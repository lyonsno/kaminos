import assert from 'node:assert/strict';
import * as sampler from '../scene-volume-gather.mjs';

assert.equal(typeof sampler.sourceRaySample,'function',
  'source-aware mode must provide a weighted ray covering the finite source domain');
const {sourceRaySample,integrateCellRay}=sampler;
assert.equal(typeof integrateCellRay,'function','source-aware rays need cell-boundary integration');
const near=(a,b,tol=1e-10)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=tol,`${a} != ${b}`);
for(const p of [[0,1,5],[0,1,0],[1,1,0],[-1,3,-1],[3,5,4]]) {
  for(let i=0;i<96;i++) {
    const s=sourceRaySample(p,i);
    near(Math.hypot(...s.direction),1);
    assert.ok(s.pdf>0&&Number.isFinite(s.pdf));
    assert.ok(s.span[1]>s.span[0]);
    assert.ok(s.point.every((v,a)=>v>[-1,-1,-1][a]&&v<[1,3,1][a]));
    assert.deepEqual(s,sourceRaySample(p,i),'no frame/history/vertex-index seed');
    const peer=sourceRaySample(p.map(v=>v+1e-5),i);
    assert.deepEqual(s.point,peer.point,'neighbors see the same progressive source samples');
  }
}
for(const n of [12,16,24,48,96]) {
  const small=Array.from({length:n},(_,i)=>sourceRaySample([0,1,5],i));
  assert.deepEqual(small,Array.from({length:96},(_,i)=>sourceRaySample([0,1,5],i)).slice(0,n));
}
// Independent analytic rectangular solid angle, not an implementation-shaped PDF oracle.
const n=131072;
const solidAngle=4*Math.atan(2/(4*Math.sqrt(21)));
near(Array.from({length:n},(_,i)=>1/sourceRaySample([0,1,5],i).pdf).reduce((a,b)=>a+b)/n,solidAngle,.002);
near(Array.from({length:n},(_,i)=>1/sourceRaySample([0,1,0],i).pdf).reduce((a,b)=>a+b)/n,4*Math.PI,.025);
assert.notDeepEqual(sourceRaySample([0,1,5],0,1),sourceRaySample([0,1,5],0,0));

const sample=c=>c[0]===0?[2,0,0,0]:[0,3,0,2];
const ray=(p,d,limit=Infinity)=>integrateCellRay(sample,[2,4,2],p,d,limit);
let result=ray([-2,0,0],[1,0,0]);
near(result[0],2);near(result[1],3*(1-Math.exp(-2))/2);
result=ray([2,0,0],[-1,0,0]);
near(result[0],2*Math.exp(-2));near(result[1],3*(1-Math.exp(-2))/2);
assert.deepEqual(ray([-2,0,0],[-1,0,0]),[0,0,0]);
near(ray([-2,0,0],[1,0,0],1.25)[0],.5);
near(ray([0,0,0],[-1,0,0])[0],2);
const uniform=c=>[2,1,.5,3];
for(const [p,d,L] of [[[0,1,0],[1,0,0],1],[[0,1,0],[0,1,0],2],[[0,1,0],[1/Math.sqrt(3),1/Math.sqrt(3),1/Math.sqrt(3)],Math.sqrt(3)]]) {
  const actual=integrateCellRay(uniform,[2,4,2],p,d);
  for(let k=0;k<3;k++)near(actual[k],[2,1,.5][k]*(1-Math.exp(-3*L))/3);
}
console.log('source-aware progressive coverage, PDF and exact-cell contracts passed');
