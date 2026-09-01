import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const coreUrl = new URL('../volume-core.js', import.meta.url);
const core = await readFile(coreUrl, 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertNoExplicitPeriodicity(source, label) {
  assert.doesNotMatch(source, /Math\.(?:sin|cos|tan)\s*\(/, `${label} must not author explicit trigonometric motion`);
  assert.doesNotMatch(source, /(?:^|[^\w])(?:sin|cos|tan)\s*\(/, `${label} must not hide explicit trigonometric motion behind an unqualified call`);
}

const instanceLayoutSource = sourceBetween(
  core,
  'export function boundarySplatInstanceLayout(',
  'export function boundarySplatProjectedInstanceDiameterPx(',
);
const syntheticTrailSource = sourceBetween(
  core,
  'function externalEmitterNowMs(',
  'function normalizeExternalEmitters(',
);

assertNoExplicitPeriodicity(instanceLayoutSource, 'multi-splat diagnostic layout');
assertNoExplicitPeriodicity(syntheticTrailSource, 'synthetic hand-trail diagnostic generator');
assert.doesNotMatch(instanceLayoutSource, /(?:nowMs|Date|performance|externalEmitterNowMs)/, 'static multi-splat placement must remain clock-free');
assert.match(syntheticTrailSource, /deterministic-nonperiodic-hand-trail-v0/, 'synthetic trail declares its nonperiodic diagnostic motion identity');
assert.doesNotMatch(syntheticTrailSource, /%/, 'synthetic trail motion must not become a short looping phase through modulo arithmetic');

assert.throws(
  () => assertNoExplicitPeriodicity(
    syntheticTrailSource.replace(
      'function syntheticTrailSignedUnit(',
      'function restoredPeriodicHelper(value) { return Math.sin(value); }\n\nfunction syntheticTrailSignedUnit(',
    ),
    'mutated synthetic hand-trail diagnostic generator',
  ),
  /must not author explicit trigonometric motion/,
  'the diagnostic barrier rejects helper-hidden trigonometric restoration',
);

const {
  SYNTHETIC_HAND_TRAIL_MOTION_IDENTITY,
  boundarySplatInstanceLayout,
  syntheticHandTrailEmitters,
} = await import(coreUrl);

assert.equal(SYNTHETIC_HAND_TRAIL_MOTION_IDENTITY, 'deterministic-nonperiodic-hand-trail-v0');
assert.deepEqual(boundarySplatInstanceLayout(1), [[0, 0, 0, 1]]);
assert.deepEqual(boundarySplatInstanceLayout(9), boundarySplatInstanceLayout(9), 'static diagnostic placement is deterministic');

const first = syntheticHandTrailEmitters(12_345);
const repeated = syntheticHandTrailEmitters(12_345);
const advanced = syntheticHandTrailEmitters(12_445);
assert.deepEqual(first, repeated, 'a named timestamp produces repeatable synthetic diagnostic emitters');
assert.equal(first.length, 5);
assert.notDeepEqual(first, advanced, 'the opt-in moving-source diagnostic still exercises external emitter updates');
for (const emitter of first) {
  assert.equal(emitter.active, true);
  assert.equal(emitter.motionIdentity, SYNTHETIC_HAND_TRAIL_MOTION_IDENTITY);
  for (const point of [emitter.start, emitter.end]) {
    assert.equal(point.length, 3);
    assert.ok(point.every(Number.isFinite));
    assert.ok(point[0] >= -0.45 && point[0] <= 0.45, 'synthetic trail x stays inside its narrow diagnostic band');
    assert.ok(point[1] >= -0.95 && point[1] <= -0.20, 'synthetic trail y stays near the source region');
    assert.ok(point[2] >= -0.15 && point[2] <= 0.15, 'synthetic trail z stays inside its narrow diagnostic band');
  }
}

console.log('volume diagnostic periodicity contracts passed');
