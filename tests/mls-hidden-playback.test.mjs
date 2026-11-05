// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredMlsHostFixture} from './helpers/authored-mls-host.mjs';
class Visibility extends EventTarget {
 hidden=false;
 change(hidden){this.hidden=hidden;this.dispatchEvent(new Event('visibilitychange'));}
}
let now=0;
const document=new Visibility();
const {host,solver}=await createAuthoredMlsHostFixture({document,now:()=>now});
try {
 host.setPaused(false);solver.advance();
 now=100;document.change(true); // Preserve visible work already owed before hiding.
 now=3600100;document.change(false);solver.advance();
 assert.equal(solver.read().clock.step,24,'Returning after an hour must owe only the 100ms of visible playback');
 assert.equal(host.paused,false,'Background suspension must preserve the user Play choice');
 now+=100;solver.advance();assert.equal(solver.read().clock.step,48);
 host.setPaused(true);document.change(true);now+=1800000;document.change(false);solver.advance();
 assert.equal(solver.read().clock.step,48,'Tab return must not resume an authored Pause');
 assert.equal(host.paused,true);
 document.change(true);host.setPaused(false);now+=1800000;solver.advance();
 assert.equal(solver.read().clock.step,48,'Play requested while hidden must remain suspended');
 document.change(false);now+=100;solver.advance();assert.equal(solver.read().clock.step,72);
 now+=2000;solver.advance();assert.equal(solver.read().clock.step,552,'Visible backlog must remain intact');
 host.dispose();const before=solver.read().clock.elapsedSeconds;now+=100;document.change(true);
 assert.equal(solver.read().clock.elapsedSeconds,before,'Disposed host must release its visibility listener');
} finally {host.dispose();}
const hidden=new Visibility();hidden.hidden=true;
const cold=await createAuthoredMlsHostFixture({document:hidden,now:()=>now});
try {
 cold.solver.advance();now+=3600000;hidden.change(false);cold.solver.advance();
 assert.equal(cold.solver.read().clock.step,0,'A host mounted in a hidden document must start suspended');
 await cold.host.advanceTo(5);
 assert.equal(cold.solver.read().clock.step,5,'Explicit authored stepping remains available');
} finally {cold.host.dispose();}
console.log('Hidden playback excludes background time, preserves visible debt and user pause, and releases listeners');
