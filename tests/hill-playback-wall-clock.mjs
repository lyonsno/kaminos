// kaminos-test: node
import assert from 'node:assert/strict';import {createVolumePlayback} from '../experiments/hill-terrain/volume-playback.mjs';
for(const hz of [60,120]){
 let now=0,completed=0;const clock=createVolumePlayback({dt:.0015,now:()=>now});
 for(let frame=0;frame<hz;frame++){
  clock.add(1/hz);const steps=clock.take();assert.ok(steps>0);now+=1/hz;clock.complete();completed+=steps;
 }
 assert.ok(Math.abs(completed*.0015-1)<.0015,`${hz}Hz: frame-delayed queue completion must not impose slow motion; actual physical seconds=${completed*.0015}`);
 assert.ok(Math.abs(clock.read().physicalSecondsPerWallSecond-1)<.002);
}
let now=0;const stalled=createVolumePlayback({dt:.0015,now:()=>now});stalled.add(1/120);stalled.take();for(let f=0;f<240;f++)stalled.add(1/120);now=2;stalled.complete();const next=stalled.take();assert.ok(next>=5&&next<=6,'A stall retains debt but does not submit two seconds in one batch');assert.ok(stalled.read().pendingSeconds>1.9);
