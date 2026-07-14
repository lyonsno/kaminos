import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  summarizeBoundarySplatTemporalCollapse,
} from '../boundary-splat-temporal-collapse.mjs';

const samples = [
  { index: 0, frameCount: 100, historyWriteSlot: 12, metrics: { litWidthRatio: 0.72, litHeightRatio: 0.64, litDensity: 0.18 } },
  { index: 1, frameCount: 108, historyWriteSlot: 13, metrics: { litWidthRatio: 0.73, litHeightRatio: 0.63, litDensity: 0.19 } },
  { index: 2, frameCount: 116, historyWriteSlot: 14, metrics: { litWidthRatio: 0.91, litHeightRatio: 0.31, litDensity: 0.38 } },
  { index: 3, frameCount: 124, historyWriteSlot: 15, metrics: { litWidthRatio: 0.88, litHeightRatio: 0.35, litDensity: 0.35 } },
  { index: 4, frameCount: 132, historyWriteSlot: 0, metrics: { litWidthRatio: 0.71, litHeightRatio: 0.65, litDensity: 0.17 } },
];

const summary = summarizeBoundarySplatTemporalCollapse(samples);
assert.equal(summary.identity, 'boundary-splat-temporal-collapse-summary-v0');
assert.equal(summary.sampleCount, samples.length, 'summary must account for every sampled frame');
assert.equal(summary.worstSampleIndex, 2, 'broad low-profile frame must rank as the worst sample');
assert.deepEqual(summary.worstIntervalSampleIndices, [1, 2, 3], 'worst interval must retain both neighboring frames');
assert.equal(summary.worstHistoryWriteSlot, 14, 'summary must preserve the phase-ring slot at the visual minimum');
assert.ok(summary.worstCollapseScore > summary.medianCollapseScore, 'worst score must exceed the sequence median');
assert.equal(summary.classification, 'candidate-temporal-collapse', 'strong relative collapse must remain a candidate pending inspection');

assert.throws(
  () => summarizeBoundarySplatTemporalCollapse(samples.slice(0, 2)),
  /at-least-three-samples-required/,
  'selected-frame-only evidence must fail instead of pretending to establish a temporal interval',
);

const witness = readFileSync(new URL('../volume-boundary-splat-temporal-witness.mjs', import.meta.url), 'utf8');
assert.match(witness, /--duration-ms/, 'caller must own temporal witness duration');
assert.match(witness, /--sample-ms/, 'caller must own temporal sample stride');
assert.match(witness, /temporalSequence/, 'report must retain the complete temporal sequence');
assert.match(witness, /historyWriteSlot/, 'every visual sample must preserve the effective history-ring slot');
assert.match(witness, /boundarySplatPhaseSources/, 'every sample must preserve effective phase-source identities');
assert.match(witness, /Page\.captureScreenshot/, 'witness must capture the live composed canvas rather than a debug projection');
assert.match(witness, /lastTrustworthyEvidence/, 'failure before completion must still leave a durable report');
assert.match(witness, /requestedEffectiveRouteAgreement/, 'report must preserve requested/effective route agreement');
assert.doesNotMatch(witness, /slice\(0,\s*\d+\)/, 'witness must not silently retain only a capped prefix of the sequence');

const invalidOutDir = mkdtempSync(join(tmpdir(), 'kaminos-temporal-witness-invalid-'));
const invalidReport = join(invalidOutDir, 'report.json');
const invalidRun = spawnSync(process.execPath, [
  new URL('../volume-boundary-splat-temporal-witness.mjs', import.meta.url).pathname,
  '--url', 'http://127.0.0.1:1/?kaminos_volume_smoke=1',
  '--out-dir', invalidOutDir,
  '--report', invalidReport,
  '--duration-ms', '0',
], { encoding: 'utf8' });
assert.notEqual(invalidRun.status, 0, 'invalid invocation must fail');
const invalidFailure = JSON.parse(readFileSync(invalidReport, 'utf8'));
assert.equal(invalidFailure.status, 'failed', 'preflight failure must leave a durable failed report');
assert.equal(invalidFailure.failurePhase, 'startup', 'preflight report must name the failure phase');
assert.match(invalidFailure.error, /--duration-ms must be positive/, 'preflight report must preserve the exact rejected input');

console.log('boundary splat temporal-collapse contracts passed');
