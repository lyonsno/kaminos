import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeIncidentLightBatch, incidentLightBatchTimestampWrites } from '../volume-gpu-profile.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-physical-color-witness.mjs', import.meta.url), 'utf8');

assert.match(core, /async function sampleEmissiveFrameProfile\(\)/);
const lightProfile = core.split('async function sampleEmissiveLightProfile()')[1]?.split('\n  async function ')[0] ?? '';
const profile = core.split('async function sampleEmissiveFrameProfile()')[1]?.split('\n  function ')[0] ?? '';
assert.match(lightProfile, /const repeats = 8;/);
assert.match(lightProfile, /emissiveLightField\.encode\(encoder,currentFluid\);\s*encodeIncidentLightBatch/, 'warmup must execute before the measured batch');
assert.match(lightProfile, /encodeIncidentLightBatch\(emissiveLightField, encoder, currentFluid, query, repeats\)/);
assert.match(lightProfile, /const totalMs=Number\(times\[1\]-times\[0\]\)\/1e6/);
assert.match(lightProfile, /ms:totalMs\/repeats/);
assert.match(profile, /createQuerySet\(\{ type: 'timestamp', count: 4 \}\)/);
assert.match(profile, /encodeDraw\(encoder, frameTexture\.createView\(\), 'same-state emissive frame profile', readbackPipeline,/);
assert.match(profile, /emissiveTimestampWrites:\s*\{ querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 \}/);
assert.match(profile, /timestampWrites:\s*\{ querySet: query, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 \}/);
assert.match(profile, /incidentLightMs:\s*Number\(times\[1\]-times\[0\]\)\/1e6/);
assert.match(profile, /raymarchMs:\s*Number\(times\[3\]-times\[2\]\)\/1e6/);
assert.match(profile, /combinedGpuSpanMs:\s*Number\(times\[3\]-times\[0\]\)\/1e6/);
assert.doesNotMatch(profile, /times\[2\]\s*<\s*times\[1\]/, 'GPU pass boundaries may overlap across timestamp pipeline stages');
assert.match(core, /sampleEmissiveFrameProfile,/);

assert.match(witness, /core\.sampleEmissiveFrameProfile\(\)/);
assert.match(witness, /native frame timing failed:\s*'\s*\+\s*JSON\.stringify\(frameProfile\)/);
assert.match(witness, /frameProfile:result\.frameProfile/);

const querySet = { id: 'query-set' };
assert.deepEqual(incidentLightBatchTimestampWrites(querySet, 0, 8), { querySet, beginningOfPassWriteIndex: 0 });
for (let repeat = 1; repeat < 7; repeat++) assert.equal(incidentLightBatchTimestampWrites(querySet, repeat, 8), undefined);
assert.deepEqual(incidentLightBatchTimestampWrites(querySet, 7, 8), { querySet, endOfPassWriteIndex: 1 });
assert.deepEqual(incidentLightBatchTimestampWrites(querySet, 0, 1), { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
assert.throws(() => incidentLightBatchTimestampWrites(querySet, 8, 8), /invalid incident-light batch repetition/);

const encoder = { id: 'encoder' };
const fluid = { id: 'fluid' };
const calls = [];
encodeIncidentLightBatch({ encode: (...args) => calls.push(args) }, encoder, fluid, querySet, 8);
assert.equal(calls.length, 8);
assert.deepEqual(calls[0], [encoder, fluid, { querySet, beginningOfPassWriteIndex: 0 }]);
for (let repeat = 1; repeat < 7; repeat++) assert.deepEqual(calls[repeat], [encoder, fluid, undefined]);
assert.deepEqual(calls[7], [encoder, fluid, { querySet, endOfPassWriteIndex: 1 }]);

console.log('emissive frame profile: incident solve, raymarch, combined span, and witness custody contracts pass');
