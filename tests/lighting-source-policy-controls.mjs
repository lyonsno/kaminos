// kaminos-test: node
import assert from 'node:assert/strict';
import {normalizeLightingTransport} from '../scene-lighting-quality.mjs';
import * as quality from '../scene-lighting-quality.mjs';
for(const patch of [{sourceSamplesPerAxis:0},{sourceSamplesPerAxis:1.5},{sourceAxisPreference:-1},{sourceSplitHysteresis:-1},{importanceBankMultiplier:0},{importanceBankMultiplier:1.5},{importanceExploration:0},{importanceExploration:1.1},{importanceHistoryDecay:1.1},{importanceHistoryBlend:-1}])assert.throws(()=>normalizeLightingTransport(patch));
const defaults=normalizeLightingTransport();assert.equal(defaults.sourceSamplesPerAxis,2);assert.equal(defaults.sourceAxisPreference,.15);assert.equal(defaults.sourceSplitHysteresis,.75);assert.equal(defaults.importanceBankMultiplier,2);assert.equal(defaults.importanceExploration,.25);assert.equal(defaults.importanceHistoryDecay,.98);assert.equal(defaults.importanceHistoryBlend,.25);
const tuned={sourceSamplesPerAxis:1,sourceAxisPreference:0,sourceSplitHysteresis:0,importanceBankMultiplier:3,importanceExploration:.5,importanceHistoryDecay:.9,importanceHistoryBlend:.1};for(const [k,v]of Object.entries(tuned))assert.equal(normalizeLightingTransport(tuned)[k],v);
console.log('PASS source construction, partition stability and importance proposal controls have explicit defaults and validation');
assert.equal(typeof quality.lightingSourceSampleWork,'function','the source-sampling control must expose its cubic work before committing');
assert.deepEqual(quality.lightingSourceSampleWork([16,32,16],10),{
 dimensions:[16,32,16],samplesPerAxis:10,samplesPerCell:1000,sourceCells:'8192',materialSamples:'8192000',relativeToDefault:125,
});
assert.equal(quality.lightingSourceSampleWork(null,10),null,'missing runtime dimensions cannot invent a workload');
assert.throws(()=>quality.lightingSourceSampleWork([16,0,16],10));
assert.throws(()=>quality.lightingSourceSampleWork([16,32,16],1.5));
assert.equal(quality.lightingSourceSampleWork([2048,2048,2048],1000).materialSamples,'8589934592000000000','large analytical work counts retain integer precision');
