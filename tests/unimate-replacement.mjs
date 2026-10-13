import assert from 'node:assert/strict';
import fs from 'node:fs';
import {replacementSolve,alignOverlap,tailConstraint,seedConstraint} from '../models/unimate/unimate-replacement.js';
const noise=new Float32Array([2,3]),known=new Float32Array([10,999]),mask=new Uint8Array([1,0]),seen=[];
const out=await replacementSolve({noise,known,mask,steps:2,drift:async(t,x)=>{seen.push([t,...x]);return new Float32Array([100,1]);}});
assert.equal(seen[1][1],6,'kept feature must follow interpolant before second evaluation');
assert.deepEqual([...out],[10,4]);
await assert.rejects(replacementSolve({noise,known,mask:new Uint8Array([1]),drift:async()=>noise}),/shape/);
await assert.rejects(replacementSolve({noise,known,mask,steps:0,drift:async()=>noise}),/interval/);
await assert.rejects(replacementSolve({noise,known,mask,drift:async()=>new Float32Array([NaN,0])}),/nonfinite/);
console.log('replacement clamps the path and leaves unknown channels to the drift');
const fixture=process.argv[process.argv.indexOf('--fixture')+1];
if(process.argv.includes('--fixture')) {
 const data=JSON.parse(fs.readFileSync(fixture,'utf8')),s=data.solver,r=data.rotation;
 const measured=[];
 const result=await replacementSolve({noise:Float32Array.from(s.noise),known:Float32Array.from(s.known),mask:Uint8Array.from(s.mask),times:s.times,drift:async(t,x)=>{
  measured.push([t,[...x]]);return Float32Array.from(x,v=>Math.fround(Math.fround(Math.cos(t))+Math.fround(v*Math.fround(.01))));
 }});
 const difference=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
 assert.equal(measured.length,s.seen.length);
 const defaultTimes=[];
 await replacementSolve({noise:Float32Array.from(s.noise),known:Float32Array.from(s.known),mask:Uint8Array.from(s.mask),drift:async(t,x)=>{defaultTimes.push(t);return new Float32Array(x.length);}});
 assert.deepEqual(defaultTimes,s.times.slice(0,-1),'default time grid must match upstream torch.linspace');
 assert.ok(difference([...result],s.result)<2e-6,'upstream Euler result');
 for(let i=0;i<s.seen.length;i++){assert.equal(measured[i][0],s.seen[i][0]);assert.ok(difference(measured[i][1],s.seen[i][1])<2e-6);}
 const aligned=alignOverlap({...r,state:Float32Array.from(r.state)}),back=alignOverlap({...r,state:aligned.state,inverse:true,facing:aligned.facing});
 assert.ok(difference([...aligned.state],r.aligned)<2e-5,'upstream normalized facing alignment');
 assert.ok(difference([...back.state],r.reverted)<2e-5,'upstream inverse facing alignment');
 const tail=tailConstraint(Float32Array.from(r.state),r.parents.length,r.frames,3),seed=seedConstraint(tail,r.parents.length,r.frames,3);
 assert.equal(seed.mask.reduce((a,b)=>a+b,0),r.parents.length*12*3);
 console.log(JSON.stringify({source:data.source,solverMax:difference([...result],s.result),rotationMax:difference([...aligned.state],r.aligned),inverseMax:difference([...back.state],r.reverted)}));
}
