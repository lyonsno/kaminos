// kaminos-test: node
import assert from 'node:assert/strict';
import {createDeviceRecovery} from '../scene-device-recovery.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const device=()=>{const loss=deferred();return {lost:loss.promise,destroy(){loss.resolve({reason:'destroyed',message:'test loss'});}};};
const tick=()=>new Promise(r=>setImmediate(r));
{
 const first=device(),second=device(),third=device();let builds=0,stops=0;const published=[];
 const recovery=createDeviceRecovery({device:first,stop:()=>{stops++;},rebuild:async({watch,assertCurrent})=>{const next=[second,third][builds++];watch(next);assertCurrent();published.push(next);},changed:()=>{}});
 first.destroy();await tick();await recovery.whenSettled();
 assert.equal(recovery.state().phase,'active');assert.equal(builds,1);assert.equal(stops,1);
 second.destroy();await tick();await recovery.whenSettled();assert.equal(builds,2);assert.deepEqual(published,[second,third]);
 recovery.dispose();third.destroy();await tick();assert.equal(builds,2);
}
{
 const first=device(),candidate=device(),last=device(),gate=deferred();let builds=0;const published=[];
 const recovery=createDeviceRecovery({device:first,stop:()=>{},rebuild:async({watch,assertCurrent})=>{
  const i=++builds;watch(i===1?candidate:last);if(i===1)await gate.promise;assertCurrent();published.push(i);
 }});
 first.destroy();await tick();candidate.destroy();await tick();gate.resolve();await recovery.whenSettled();
 assert.deepEqual(published,[2],'a lost candidate cannot publish');assert.equal(recovery.state().phase,'active');recovery.dispose();
}
{
 const first=device();let fail=true,builds=0;
 const recovery=createDeviceRecovery({device:first,stop:()=>{},rebuild:async({watch})=>{builds++;if(fail)throw Error('adapter unavailable');watch(device());}});
 first.destroy();await tick();await recovery.whenSettled();assert.equal(recovery.state().phase,'failed');assert.match(recovery.state().error,/adapter unavailable/);assert.equal(builds,1);
 fail=false;await recovery.retry();assert.equal(recovery.state().phase,'active');assert.equal(builds,2);recovery.dispose();
}
console.log('device recovery repeated loss, stale candidate, failure and retry passed');
{
 const first=device(),candidate=device();let builds=0;
 const recovery=createDeviceRecovery({device:first,stop:()=>{},rebuild:async({watch})=>{
  builds++;const retire=watch(candidate);assert.equal(typeof retire,'function','candidate cleanup must detach its loss observer');retire();candidate.destroy();throw Error('initialization failed');
 }});
 first.destroy();await tick();await recovery.whenSettled();assert.equal(recovery.state().phase,'failed');assert.equal(builds,1);assert.match(recovery.state().error,/initialization failed/);recovery.dispose();
}
