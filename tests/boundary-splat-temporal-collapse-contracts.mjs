import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  measureBoundarySplatTemporalFrame,
  summarizeBoundarySplatTemporalCollapse,
  validateBoundarySplatTemporalSequence,
} from '../boundary-splat-temporal-collapse.mjs';

const thinFixture = makeRgbPng(64, 64, (x, y) => (
  [8, 22, 36, 50].some(left => x >= left && x < left + 4 && y >= 18 && y < 48)
    ? [255, 120, 24]
    : [0, 0, 0]
));
const broadFixture = makeRgbPng(64, 64, (x, y) => (
  x >= 8 && x < 54 && y >= 18 && y < 48 ? [255, 120, 24] : [0, 0, 0]
));
const thinMetrics = measureBoundarySplatTemporalFrame(thinFixture);
const broadMetrics = measureBoundarySplatTemporalFrame(broadFixture);
assert.equal(thinMetrics.litComponentCount, 4, 'four separated flame footprints must remain four lit components');
assert.equal(broadMetrics.litComponentCount, 1, 'one broad sheet must remain one lit component');
assert.ok(
  broadMetrics.largestLitComponentFraction > thinMetrics.largestLitComponentFraction * 3,
  'component concentration must distinguish a broad sheet from separated flames at equal height',
);

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

const footprintSummary = summarizeBoundarySplatTemporalCollapse([
  { index: 0, frameCount: 200, historyWriteSlot: 0, metrics: { litDensity: 0.24, largestLitComponentFraction: 0.08 } },
  { index: 1, frameCount: 208, historyWriteSlot: 1, metrics: { litDensity: 0.22, largestLitComponentFraction: 0.11 } },
  { index: 2, frameCount: 216, historyWriteSlot: 2, metrics: { litDensity: 0.08, largestLitComponentFraction: 0.88 } },
  { index: 3, frameCount: 224, historyWriteSlot: 3, metrics: { litDensity: 0.20, largestLitComponentFraction: 0.09 } },
]);
assert.equal(footprintSummary.candidateBasis, 'operator-calibrated-connected-footprint-v0');
assert.deepEqual(footprintSummary.candidateSampleIndices, [2], 'camera density must not hide an operator-shaped broad connected footprint');
assert.equal(footprintSummary.classification, 'candidate-temporal-collapse');

const thinFootprintSummary = summarizeBoundarySplatTemporalCollapse([
  { index: 0, frameCount: 300, historyWriteSlot: 0, metrics: { litDensity: 0.08, largestLitComponentFraction: 0.08 } },
  { index: 1, frameCount: 308, historyWriteSlot: 1, metrics: { litDensity: 0.24, largestLitComponentFraction: 0.11 } },
  { index: 2, frameCount: 316, historyWriteSlot: 2, metrics: { litDensity: 0.05, largestLitComponentFraction: 0.07 } },
]);
assert.equal(thinFootprintSummary.classification, 'no-relative-collapse-candidate', 'large camera-driven density changes must not classify separated flames as collapse');

const zeroSummary = summarizeBoundarySplatTemporalCollapse([
  { index: 0, frameCount: 1, historyWriteSlot: 0, metrics: { litWidthRatio: 0, litHeightRatio: 0, litDensity: 0 } },
  { index: 1, frameCount: 2, historyWriteSlot: 1, metrics: { litWidthRatio: 0, litHeightRatio: 0, litDensity: 0 } },
  { index: 2, frameCount: 3, historyWriteSlot: 2, metrics: { litWidthRatio: 0, litHeightRatio: 0, litDensity: 0 } },
]);
assert.equal(zeroSummary.classification, 'no-relative-collapse-candidate', 'blank equal-zero samples must never classify as collapse');
assert.deepEqual(zeroSummary.candidateSampleIndices, [], 'zero-score threshold must not admit every sample');

const advancingSequence = [
  { index: 0, elapsedMs: 0, frameCount: 100, simStepCount: 200, image: { sha256: 'a' } },
  { index: 1, elapsedMs: 250, frameCount: 112, simStepCount: 212, image: { sha256: 'b' } },
  { index: 2, elapsedMs: 500, frameCount: 124, simStepCount: 224, image: { sha256: 'c' } },
];
const advancement = validateBoundarySplatTemporalSequence(advancingSequence, { requestedDurationMs: 500, sampleMs: 250 });
assert.equal(advancement.ok, true, 'advancing distinct sequence must carry live temporal authority');
assert.equal(advancement.distinctImageCount, 3, 'advancement must account for distinct retained frames');
const delayedFirstCapture = validateBoundarySplatTemporalSequence([
  { index: 0, elapsedMs: 268, frameCount: 400, simStepCount: 500, image: { sha256: 'd' } },
  { index: 1, elapsedMs: 480, frameCount: 410, simStepCount: 510, image: { sha256: 'e' } },
  { index: 2, elapsedMs: 723, frameCount: 420, simStepCount: 520, image: { sha256: 'f' } },
], { requestedDurationMs: 1000, sampleMs: 500 });
assert.equal(delayedFirstCapture.durationComplete, true, 'duration authority starts at sequence start, not after first screenshot latency');
assert.equal(delayedFirstCapture.actualDurationMs, 723);
assert.throws(
  () => validateBoundarySplatTemporalSequence(advancingSequence.map(sample => ({
    ...sample,
    frameCount: 100,
    simStepCount: 200,
    image: { sha256: 'same' },
  })), { requestedDurationMs: 500, sampleMs: 250 }),
  /temporal-sequence-did-not-advance/,
  'frozen screenshots and telemetry must fail instead of certifying a live sequence',
);

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
assert.match(witness, /captureBoundarySplatWitnessFrame/, 'witness must freeze and identify the exact rendered frame before CDP capture');
assert.match(witness, /resumeBoundarySplatWitnessFrame/, 'witness must resume the same live simulator after every frozen capture');
assert.match(witness, /document\.visibilityState/, 'witness must fail when the supposedly live page is hidden');
assert.match(witness, /validateBoundarySplatTemporalSequence/, 'completed report must prove temporal and image advancement');
assert.match(witness, /sampleBoundarySplatCandidateGeometry/, 'operator-shaped candidates must preserve paused-frame source geometry before the simulator resumes');
assert.match(witness, /lastTrustworthyEvidence/, 'failure before completion must still leave a durable report');
assert.match(witness, /requestedEffectiveRouteAgreement/, 'report must preserve requested/effective route agreement');
assert.doesNotMatch(witness, /slice\(0,\s*\d+\)/, 'witness must not silently retain only a capped prefix of the sequence');

const invalidOutDir = mkdtempSync(join(tmpdir(), 'kaminos-temporal-witness-invalid-'));
const invalidReport = join(invalidOutDir, 'nested', 'report.json');
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

function makeRgbPng(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      raw[row + 1 + x * 3] = red;
      raw[row + 2 + x * 3] = green;
      raw[row + 3 + x * 3] = blue;
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
