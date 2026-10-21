// kaminos-test: node
import assert from 'node:assert/strict';
const module=await import('../volume-frame-timing.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof module.frameCadenceSummary,'function','FPS must distinguish elapsed average from inverse slow-tail interval');
const intervals=[...Array(90).fill(10),...Array(10).fill(100)];
const summary=module.frameCadenceSummary(intervals);
assert.equal(summary.meanFps,1000/19);assert.equal(summary.p95Ms,100);assert.equal(summary.p95EquivalentFps,10);assert.equal(summary.samples,100);
assert.equal(module.frameCadenceSummary([]).meanFps,0);
assert.equal(module.frameCadenceSummary([16,NaN,0,-1]).meanFps,62.5);
assert.equal(module.frameCadenceSummary([16,NaN,0,-1]).ignoredSamples,3);
assert.equal(module.frameCadenceSummary([0]).meanFps,0);
console.log('mean cadence and tail latency remain distinct');
