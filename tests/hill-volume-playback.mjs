// kaminos-test: node
import assert from 'node:assert/strict';import {createVolumePlayback} from '../experiments/hill-terrain/volume-playback.mjs';
let now=0;const dt=.0015,clock=createVolumePlayback({dt,now:()=>now});clock.add(1/60);assert.equal(clock.take(),6);clock.add(2);assert.equal(clock.take(),0,'In-flight work cannot be scheduled twice');now=.1;clock.complete();assert.equal(clock.take(),12,'Queue latency cannot throttle the current-frame physical service quantum');now+=.000001;clock.complete();
let completed=18;for(;;){const n=clock.take();if(!n)break;assert.ok(n>0);now+=n*.000001;clock.complete();completed+=n;}
assert.ok(clock.read().pendingSeconds<dt);assert.ok(Math.abs(completed*dt+clock.read().pendingSeconds-(2+1/60))<1e-12,'All frame credit is either completed or retained');
clock.add(10);assert.ok(clock.take()>1000,'The budget adapts to observed capacity rather than imposing a fixed substep cap');clock.reset();assert.equal(clock.read().pendingSeconds,0);assert.equal(clock.read().inFlightSteps,0);
assert.throws(()=>clock.add(-1),/finite and nonnegative/);assert.throws(()=>clock.add(NaN),/finite and nonnegative/);assert.throws(()=>createVolumePlayback({dt:0}),/positive timestep/);
const reportClock=createVolumePlayback({dt,now:()=>now});reportClock.add(1/120);const batch=reportClock.take();now+=.001;reportClock.complete();
assert.equal(reportClock.read().physicalSecondsPerWallSecond,batch*dt/(1/120),'Physical speed reports completed steps against host elapsed time, independently of render count');
assert.ok(reportClock.read().frameBudgetSeconds<=1/120/4,'The extra catch-up allowance is separate from current-frame physical demand');
assert.equal(reportClock.read().hostFrameHz,120);
