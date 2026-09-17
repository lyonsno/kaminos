import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/witness-kimodo-live-flame.mjs',import.meta.url),'utf8');
assert.match(source,/createWitnessWatchdog/,'witness must install the operator deadline/stall detector');
const {createWitnessWatchdog,createWitnessAbort}=await import('../lib/kimodo-witness-watchdog.mjs');
const a=createWitnessAbort(),reason=new Error('expiry'),neverSettles=new Promise(()=>{});
const waiting=a.wait(neverSettles);a.abort(reason);
await assert.rejects(waiting,e=>e===reason);
await assert.rejects(a.wait(neverSettles),e=>e===reason);
await assert.rejects(a.wait(Promise.resolve('late success')),e=>e===reason);
for(const phase of ['weights','generation','motion-export']){
  const w=createWitnessWatchdog(0);w.observe(phase,'started',0);
  if(phase==='generation')w.observe(phase,'step5',1000);
  assert.equal(w.check(121001)?.kind,'no-progress',phase);
}
const never=createWitnessWatchdog(0);assert.equal(never.check(120001)?.kind,'no-progress');
const slow=createWitnessWatchdog(0);
for(let t=0;t<600000;t+=10000){slow.observe('generation',String(t),t);assert.equal(slow.check(t),null);}
assert.equal(slow.check(600001)?.kind,'deadline','progress does not renew the whole witness cap');
console.log('Watchdog timer arithmetic and independent/previously-fired abort checks pass; CLI teardown coverage is in kimodo-witness-cleanup.mjs');
