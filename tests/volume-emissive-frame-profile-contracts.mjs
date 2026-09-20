import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-physical-color-witness.mjs', import.meta.url), 'utf8');

assert.match(core, /async function sampleEmissiveFrameProfile\(\)/);
const lightProfile = core.split('async function sampleEmissiveLightProfile()')[1]?.split('\n  async function ')[0] ?? '';
const profile = core.split('async function sampleEmissiveFrameProfile()')[1]?.split('\n  function ')[0] ?? '';
assert.match(lightProfile, /const repeats = 8;/);
assert.match(lightProfile, /emissiveLightField\.encode\(encoder,currentFluid\);\s*for/, 'warmup must execute before the measured batch');
assert.match(lightProfile, /for \(let repeat = 0; repeat < repeats; repeat\+\+\)/);
assert.match(lightProfile, /let timestampWrites;/);
assert.doesNotMatch(lightProfile, /const timestampWrites = \{ querySet: query \}/, 'a timestamp descriptor without either write index invalidates the command buffer');
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

console.log('emissive frame profile: incident solve, raymarch, combined span, and witness custody contracts pass');
