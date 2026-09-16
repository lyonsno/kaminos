import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/witness-kimodo-live-flame.mjs',import.meta.url),'utf8');
assert.match(source,/createWitnessWatchdog/,'witness must install the operator deadline/stall detector');
const {createWitnessWatchdog}=await import('../lib/kimodo-witness-watchdog.mjs');
for(const phase of ['weights','generation','motion-export']){
  const w=createWitnessWatchdog(0);w.observe(phase,'started',0);
  if(phase==='generation')w.observe(phase,'step5',1000);
  assert.equal(w.check(121001)?.kind,'no-progress',phase);
}
const never=createWitnessWatchdog(0);assert.equal(never.check(120001)?.kind,'no-progress');
const slow=createWitnessWatchdog(0);
for(let t=0;t<600000;t+=10000){slow.observe('generation',String(t),t);assert.equal(slow.check(t),null);}
assert.equal(slow.check(600001)?.kind,'deadline','progress does not renew the whole witness cap');
console.log('Watchdog: stalled load, progressed then stalled generation, never started, stalled download, overall deadline pass');
