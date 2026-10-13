import assert from 'node:assert/strict';
import * as clock from '../finger-fluid-box-clock.mjs';
assert.equal(typeof clock.createFixedStepPlayback,'function','Clock must expose playback rate independently of physics dt');
const {createFixedStepPlayback}=clock;
for(const rate of [.25,1,2]){
 const c=createFixedStepPlayback({dt:1/240,rate});
 c.advance(0);let steps=0;
 for(let ms=10;ms<=1000/rate+1e-8;ms+=10)steps+=c.advance(ms).steps;
 assert.equal(steps,240,'same simulated duration keeps dt and step count');
 assert.equal(c.state().dt,1/240);
}
const c=createFixedStepPlayback({dt:1/240,rate:1});c.advance(0);assert.equal(c.advance(100).steps,24);
c.advance(10000,{paused:true});assert.equal(c.advance(10010).steps,2,'paused time is not simulated');
c.setRate(2);assert.equal(c.advance(10020).steps,5);assert.equal(c.state().dt,1/240);
assert.throws(()=>c.setRate(0),/positive/);
console.log('Fixed-dt playback rates and pause invariants pass');
