import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { simGpuProfileMismatch } from '../volume-arm-capture-checks.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
const closure = source.slice(source.indexOf('export function createKaminosVolumePrototype('));

// Sim-step GPU profile (Noah 2026-10-10: the solver should spend only the
// sweeps it needs; measure where the time goes first). N+1 consecutive sim
// steps are encoded with a timestamp at the end of each step's pressure
// projection, so consecutive differences are whole-step GPU times. Run at
// several sweep counts, the slope is the per-sweep cost and the intercept the
// rest of the step.

test('timestamps to step times: consecutive end-of-step differences in ms; unwritten or non-monotonic timestamps are refused', () => {
  const profile = core.simStepGpuProfileFromTimestamps([1000n, 3001000n, 6001000n, 9501000n], { requestedSteps: 3 });
  assert.equal(profile.status, 'sampled');
  assert.deepEqual(profile.stepMs, [3, 3, 3.5]);
  assert.equal(profile.steps, 3);
  assert.equal(profile.medianMs, 3);
  assert.ok(Math.abs(profile.meanMs - 9.5 / 3) < 1e-12);
  assert.equal(profile.minMs, 3); assert.equal(profile.maxMs, 3.5);
  assert.equal(profile.timestampAuthority, 'gpu-timestamp-query:end-of-pressure-projection');
  assert.equal(profile.requestedSteps, 3, 'metadata passes through');
  assert.deepEqual(core.simStepGpuProfileFromTimestamps([0n, 0n, 0n], {}), { status: 'invalid', reason: 'unwritten-timestamp' }, 'an unwritten query reads zero');
  assert.deepEqual(core.simStepGpuProfileFromTimestamps([5n, 4n, 9n], {}), { status: 'invalid', reason: 'non-monotonic-timestamps' });
  assert.deepEqual(core.simStepGpuProfileFromTimestamps([5n, 9n], {}), { status: 'invalid', reason: 'too-few-endpoints' });
  // Large absolute timestamps keep ns precision (differences are taken as BigInt).
  const big = core.simStepGpuProfileFromTimestamps([9007199254740993000n, 9007199254742993000n, 9007199254744993500n], {});
  assert.deepEqual(big.stepMs, [2, 2.0005]);
});

test('the API: refuses without a device or timestamp queries; encodes N+1 steps with end-of-projection timestamps; resolves and reads back', () => {
  const api = closure.slice(closure.indexOf('    async sampleSimStepGpuProfile(steps = 8) {'), closure.indexOf('    setConfinementEpsilonOverride(value) {'));
  assert.ok(api.length > 0, 'the API exists');
  assert.match(api, /const n = Math\.max\(2, Math\.min\(64, Math\.floor\(Number\(steps\) \|\| 8\)\)\);/);
  assert.match(api, /if \(!gpuInitialized \|\| !device\) return \{ status: 'unsupported', reason: 'gpu-not-initialized', \.\.\.meta \};/);
  assert.match(api, /if \(!timestampQueriesAvailable\(\)\) return \{ status: 'unsupported', reason: device\.features\?\.has\?\.\('timestamp-query'\) \? 'timestamp-query-write-api-unavailable' : 'timestamp-query-not-supported', \.\.\.meta \};/);
  assert.match(api, /for \(let i = 0; i < count; i \+= 1\) \{\n\s+if \(!encodeSim\(encoder, \{ finalTimestampWrites: \{ querySet, endOfPassWriteIndex: i \} \}\)\) throw new Error\('simulation-final-timestamp-unavailable'\);\n\s+\}/);
  assert.match(api, /encoder\.resolveQuerySet\(querySet, 0, count \+ draws, resolveBuffer, 0\);/);
  assert.match(api, /const timestamps = Array\.from\(new BigUint64Array\(readbackBuffer\.getMappedRange\(\)\.slice\(0\)\)\);/);
  assert.match(api, /const profile = simStepGpuProfileFromTimestamps\(timestamps\.slice\(0, count\), meta\);/);
  assert.match(api, /querySet\.destroy\(\); resolveBuffer\.destroy\(\); readbackBuffer\.destroy\(\);/, 'resources released on every path');
  assert.match(api, /iterations: state\.pressureSolver\?\.effective\?\.iterations \?\? null/, 'the receipt names the sweep count it measured');
});

test('capture: @simGpuProfile=N samples the profile and the arm fails unless it is a complete GPU sample', () => {
  assert.match(capture, /if \(cid === '@simGpuProfile'\) \{/);
  assert.match(capture, /const mismatch = simGpuProfileMismatch\(profile, steps\);/);
  assert.match(capture, /simGpuProfiles: arm\.simGpuProfiles \|\| \[\]/, 'the report keeps every profile');
  const good = core.simStepGpuProfileFromTimestamps([1000n, 3001000n, 6001000n], { requestedSteps: 2 });
  assert.equal(simGpuProfileMismatch(good, 2), null);
  assert.match(simGpuProfileMismatch({ status: 'unsupported', reason: 'timestamp-query-not-supported' }, 2), /unsupported \(timestamp-query-not-supported\)/);
  assert.match(simGpuProfileMismatch(null, 2), /missing/);
  assert.match(simGpuProfileMismatch(good, 3), /has 2 steps, requested 3/);
  assert.match(simGpuProfileMismatch({ ...good, stepMs: [3, Number.NaN] }, 2), /non-positive or non-finite/);
  assert.match(simGpuProfileMismatch({ ...good, stepMs: [3, 0] }, 2), /non-positive or non-finite/);
  assert.match(simGpuProfileMismatch({ ...good, timestampAuthority: 'cpu-clock' }, 2), /authority cpu-clock/);
});

// The frame also pays for the raymarch draw: the profile times K draws into the
// offscreen frame texture with end-of-pass timestamps only, each draw's time
// the gap from the previous end (the last sim step's end for the first draw).
// Begin-of-render-pass timestamps read back implausibly on the Apple route
// (each draw's begin-to-end grew by the previous draws' duration), so the
// profile does not use them.
test('draw timing: end-to-end differences after the last sim step; the API times K raymarch draws after the steps', () => {
  assert.deepEqual(core.gpuPassDurationsFromEndTimestamps(1000n, [1501000n, 3501000n]), { status: 'sampled', passMs: [1.5, 2], medianMs: 1.75 });
  assert.deepEqual(core.gpuPassDurationsFromEndTimestamps(0n, [10n]), { status: 'invalid', reason: 'unwritten-timestamp' });
  assert.deepEqual(core.gpuPassDurationsFromEndTimestamps(10n, [5n]), { status: 'invalid', reason: 'non-monotonic-timestamps' });
  assert.deepEqual(core.gpuPassDurationsFromEndTimestamps(10n, []), { status: 'invalid', reason: 'no-passes' });
  const api = closure.slice(closure.indexOf('    async sampleSimStepGpuProfile(steps = 8) {'), closure.indexOf('    setConfinementEpsilonOverride(value) {'));
  assert.match(api, /const draws = 4;/);
  assert.match(api, /const querySet = device\.createQuerySet\(\{ type: 'timestamp', count: count \+ draws \}\);/);
  assert.match(api, /encodeDraw\(encoder, frameTexture\.createView\(\), 'kaminos sim gpu profile raymarch', readbackPipeline, \{ timestampWrites: \{ querySet, endOfPassWriteIndex: count \+ j \} \}\);/);
  assert.ok(!api.includes('beginningOfPassWriteIndex'), 'no begin-of-pass timestamps');
  assert.match(api, /render: drawsAvailable\n\s+\? \{ \.\.\.gpuPassDurationsFromEndTimestamps\(timestamps\[count - 1\], timestamps\.slice\(count, count \+ draws\)\), size: \[state\.width, state\.height\], renderScale: state\.renderScale \?\? null, raymarchSteps: controlsSnapshot\.raySteps \?\? null, pipeline: 'readback-rgba8unorm' \}\n\s+: \{ status: 'unsupported', reason: 'readback-pipeline-unavailable' \}/);
});
