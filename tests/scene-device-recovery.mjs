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
{
 const first=device(),next=device();let builds=0,checks=0,stops=0;
 const recovery=createDeviceRecovery({device:first,automatic:false,stop:()=>{stops++;},
  rebuild:async({watch,assertCurrent})=>{assertCurrent();builds++;watch(next);}});
 first.destroy();await tick();
 assert.equal(stops,1,'device loss must stop admission before a recovery command arrives');
 assert.equal(builds,0,'explicit worker recovery must wait for a fresh ordered command');
 assert.equal(recovery.state().phase,'recovering');
 assert.throws(()=>recovery.recover(),/command.*assertCurrent/,'explicit recovery needs its command epoch guard');
 await recovery.recover({assertCurrent:()=>{checks++;}});
 assert.equal(builds,1);assert.ok(checks>0);assert.equal(recovery.state().phase,'active');recovery.dispose();
}
{
 const first=device(),candidate=device(),last=device(),gate=deferred();let builds=0;const published=[];
 const recovery=createDeviceRecovery({device:first,automatic:false,stop:()=>{},rebuild:async({watch,assertCurrent})=>{
  const i=++builds;watch(i===1?candidate:last);if(i===1)await gate.promise;assertCurrent();published.push(i);
 }});
 first.destroy();await tick();const old=recovery.recover({assertCurrent:()=>{}});
 await tick();candidate.destroy();await tick();gate.resolve();await assert.rejects(old,/superseded/);
 assert.equal(builds,1,'a lost candidate cannot trigger another build in the stale command');
 assert.deepEqual(published,[]);assert.equal(recovery.state().phase,'recovering');
 await recovery.recover({assertCurrent:()=>{}});
 assert.deepEqual(published,[2]);assert.equal(recovery.state().phase,'active');recovery.dispose();
}
{
 const first=device(),candidate=device(),gate=deferred();let current=true,published=false;
 const recovery=createDeviceRecovery({device:first,automatic:false,stop:()=>{},rebuild:async({watch,assertCurrent})=>{
  watch(candidate);await gate.promise;assertCurrent();published=true;
 }});
 first.destroy();await tick();const task=recovery.recover({assertCurrent:()=>{if(!current)throw Error('command epoch changed');}});
 await tick();current=false;gate.resolve();await assert.rejects(task,/command epoch changed/);
 assert.equal(published,false);assert.equal(recovery.state().phase,'failed');assert.match(recovery.state().error,/command epoch changed/);recovery.dispose();
}
{
 const first=device();let fail=true,builds=0;
 const recovery=createDeviceRecovery({device:first,automatic:false,stop:()=>{},rebuild:async({watch})=>{
  builds++;if(fail)throw Error('replacement denied');watch(device());
 }});
 first.destroy();await tick();await assert.rejects(recovery.recover({assertCurrent:()=>{}}),/replacement denied/);
 assert.equal(recovery.state().phase,'failed');assert.throws(()=>recovery.retry(),/command.*assertCurrent/);
 fail=false;await recovery.retry({assertCurrent:()=>{}});
 assert.equal(builds,2);assert.equal(recovery.state().phase,'active');
 assert.throws(()=>recovery.recover({assertCurrent:()=>{}}),/No pending device recovery/);
 assert.throws(()=>recovery.retry({assertCurrent:()=>{}}),/No failed device recovery/);recovery.dispose();
}
{
 const first=device();let builds=0;
 const recovery=createDeviceRecovery({device:first,automatic:false,stop:()=>{},rebuild:async()=>{builds++;}});
 first.destroy();await tick();const task=recovery.recover({assertCurrent:()=>{}});recovery.dispose();
 await assert.rejects(task,/disposed/);assert.equal(builds,0);
}
console.log('ordered worker recovery waits for fresh commands, fences stale contexts and retries without auto-looping');
{
 const first=device(),gate=deferred();
 const recovery=createDeviceRecovery({device:first,automatic:false,stop:()=>{},rebuild:()=>gate.promise});
 first.destroy();await tick();const task=recovery.recover({assertCurrent(){}});await tick();
 assert.throws(()=>recovery.recover(),/command.*assertCurrent/,'an in-flight rebuild cannot bypass command admission');
 assert.throws(()=>recovery.recover({assertCurrent(){}}),/already in progress/,'a second command cannot inherit the first command result');
 gate.resolve();await task;recovery.dispose();
}
