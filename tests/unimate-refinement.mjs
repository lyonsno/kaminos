// kaminos-test: node
import assert from 'node:assert/strict';
import {dopri5Solve} from '../models/unimate/unimate-dopri5.js';
const input={y0:new Float32Array([1,2]),outputTimes:[0,.2,.5,1],drift:async(t,y)=>Float32Array.from(y,x=>-x)};
const baseline=await dopri5Solve(input),samples=[];
const observed=await dopri5Solve({...input,onSample:async sample=>{samples.push({...sample,state:sample.state.slice()});sample.state.fill(123);}});
assert.deepEqual(samples.map(s=>s.t),input.outputTimes,'stream every output time, including initial and final');
assert.deepEqual(observed,baseline,'observation cannot mutate integration or output');
for(let i=0;i<samples.length;i++)assert.deepEqual(samples[i].state,baseline.solution[i]);
const stopped=[];await assert.rejects(dopri5Solve({...input,onSample:s=>{stopped.push(s);if(s.t===.5)throw Error('stop');}}),/stop/);
assert.deepEqual(stopped.map(s=>s.t),[0,.2,.5]);
for(const rtol of [0,-1,NaN,Infinity])await assert.rejects(dopri5Solve({...input,rtol}),/tolerance/);
console.log('streamed refinement preserves numerical result and stopped samples');
