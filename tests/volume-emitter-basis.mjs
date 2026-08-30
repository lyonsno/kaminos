import assert from 'node:assert/strict';

import {
  VOLUME_EMITTER_BASIS_SCHEMA,
  VOLUME_EMITTER_FAMILIES,
  compileVolumeEmitterFamily,
} from '../volume-emitter-basis.mjs';

const HELD_REQUEST = Object.freeze({
  origin: [0, -0.76, 0],
  direction: [0, 2, 0],
  supportAxis: [2, 0, 0],
  radius: 0.04,
  length: 0.32,
  ringRadius: 0.24,
  ringSegments: 12,
  strength: 1.2,
  velocitySpeed: 0.22,
  chemistry: {
    smoke: 0.24,
    heat: 1.32,
    fuel: 0.78,
    flame: 1.16,
    detail: 0.72,
  },
  temporal: {
    mode: 'steady',
    frequencyHz: 0,
    phase: 0,
    dutyCycle: 1,
  },
  lifetime: 0.55,
  frameId: 'held-source-shape-frame',
  timestampMs: 1_000,
});

function compile(family, overrides = {}) {
  return compileVolumeEmitterFamily({
    ...HELD_REQUEST,
    ...overrides,
    family,
  });
}

function assertVectorClose(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message} dimensionality`);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= 1e-9, `${message}[${index}] ${value} != ${expected[index]}`);
  });
}

function assertCommonReceipt(result, family, expectedEmitterCount) {
  assert.equal(result.schema, VOLUME_EMITTER_BASIS_SCHEMA);
  assert.equal(result.identity, 'kaminos-volume-emitter-basis-v0');
  assert.equal(result.family, family);
  assert.equal(result.requested.family, family);
  assert.equal(result.effective.family, family);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.failures, []);
  assert.equal(result.carrier.mode, 'emitter_basis_assay');
  assert.equal(result.carrier.coordinateSpace, 'volume-local');
  assert.equal(result.carrier.frameId, HELD_REQUEST.frameId);
  assert.equal(result.carrier.timestampMs, HELD_REQUEST.timestampMs);
  assert.equal(result.carrier.emitters.length, expectedEmitterCount);
  assertVectorClose(result.effective.direction, [0, 1, 0], `${family} normalized direction`);
  assert.equal(new Set(result.carrier.emitters.map(emitter => emitter.id)).size, expectedEmitterCount, `${family} emitter ids are unique`);
  for (const emitter of result.carrier.emitters) {
    assert.equal(emitter.active, true);
    assert.equal(emitter.strength, HELD_REQUEST.strength);
    assert.equal(emitter.smoke, HELD_REQUEST.chemistry.smoke);
    assert.equal(emitter.heat, HELD_REQUEST.chemistry.heat);
    assert.equal(emitter.fuel, HELD_REQUEST.chemistry.fuel);
    assert.equal(emitter.flame, HELD_REQUEST.chemistry.flame);
    assert.equal(emitter.detail, HELD_REQUEST.chemistry.detail);
    assert.equal(emitter.lifetime, HELD_REQUEST.lifetime);
  }
}

assert.deepEqual(VOLUME_EMITTER_FAMILIES, ['wick', 'nozzle', 'ribbon', 'ring']);

const wick = compile('wick');
assertCommonReceipt(wick, 'wick', 1);
assert.equal(wick.effective.support.primitive, 'ellipsoid-capsule');
assertVectorClose(wick.carrier.emitters[0].velocity, [0, 0.22, 0], 'wick velocity');
assert.ok(wick.carrier.emitters[0].end[1] > wick.carrier.emitters[0].start[1], 'wick support is vertically elongated');

const nozzle = compile('nozzle');
assertCommonReceipt(nozzle, 'nozzle', 1);
assert.equal(nozzle.effective.support.primitive, 'oriented-capsule');
assertVectorClose(nozzle.carrier.emitters[0].start, HELD_REQUEST.origin, 'nozzle starts at source origin');
assertVectorClose(nozzle.carrier.emitters[0].end, [0, -0.44, 0], 'nozzle follows injection direction');

const ribbon = compile('ribbon');
assertCommonReceipt(ribbon, 'ribbon', 1);
assert.equal(ribbon.effective.support.primitive, 'finite-line-capsule');
assertVectorClose(ribbon.carrier.emitters[0].start, [-0.16, -0.76, 0], 'ribbon negative support endpoint');
assertVectorClose(ribbon.carrier.emitters[0].end, [0.16, -0.76, 0], 'ribbon positive support endpoint');
assertVectorClose(ribbon.carrier.emitters[0].velocity, [0, 0.22, 0], 'ribbon injection is independent of support axis');

const ring = compile('ring');
assertCommonReceipt(ring, 'ring', HELD_REQUEST.ringSegments);
assert.equal(ring.effective.support.primitive, 'segmented-annulus');
assert.equal(ring.effective.support.segmentCount, HELD_REQUEST.ringSegments);
ring.carrier.emitters.forEach((emitter, index) => {
  const next = ring.carrier.emitters[(index + 1) % ring.carrier.emitters.length];
  assertVectorClose(emitter.end, next.start, `ring segment ${index} joins its successor`);
});

const downstreamGeometry = result => result.carrier.emitters.map(({ id, ...emitter }) => emitter);
for (const left of VOLUME_EMITTER_FAMILIES) {
  for (const right of VOLUME_EMITTER_FAMILIES) {
    if (left >= right) continue;
    assert.notDeepEqual(
      downstreamGeometry(compile(left)),
      downstreamGeometry(compile(right)),
      `${left} and ${right} remain distinct after diagnostic-only ids are discarded`,
    );
  }
}

assert.throws(
  () => compileVolumeEmitterFamily({ ...HELD_REQUEST, family: 'cluster' }),
  /unsupported emitter family: cluster/,
  'the focused compiler fails loud instead of falling back to the clustered flame bowl',
);
assert.throws(
  () => compile('ring', { ringSegments: 33 }),
  /ring segment count 33 exceeds external emitter capacity 32/,
  'ring compilation exposes the carrier capacity instead of silently truncating requested geometry',
);
assert.throws(
  () => compile('wick', { direction: [0, 0, 0] }),
  /direction must be a finite non-zero vec3/,
  'invalid injection direction cannot masquerade as a default',
);
assert.throws(
  () => compile('nozzle', { origin: [1.45, 0, 0], direction: [1, 0, 0], length: 0.2 }),
  /generated emitter support exceeds volume-local carrier bounds \[-1\.5, 1\.5\]/,
  'geometry outside the downstream carrier range fails instead of being silently clamped',
);
assert.throws(
  () => compile('wick', { velocitySpeed: 3.1 }),
  /velocitySpeed 3\.1 must be within \[0, 3\]/,
  'velocity honors the existing GPU carrier range instead of publishing a pre-clamp request',
);
assert.throws(
  () => compile('wick', { timestampMs: -1 }),
  /timestampMs -1 must be within \[0, 9007199254740991\]/,
  'negative timestamps cannot become fresh-looking emitter evidence after downstream clamping',
);
assert.throws(
  () => compile('wick', { frameId: '   ' }),
  /frameId must be a non-empty string/,
  'blank frame identity cannot masquerade as an assay receipt',
);
assert.doesNotThrow(
  () => compile('wick', { radius: 0.18, ringRadius: 'malformed-ring-radius', ringSegments: 'malformed-ring-segments' }),
  'wick compilation does not reject irrelevant ring-only geometry controls',
);
assert.doesNotThrow(
  () => compile('nozzle', { supportAxis: [0, Number.NaN, 0] }),
  'nozzle compilation does not reject an irrelevant support axis',
);
assert.throws(
  () => compile('ribbon', { supportAxis: [0, 1, 0] }),
  /supportAxis projected perpendicular to direction must be a finite non-zero vec3/,
  'ribbon rejects a support axis that would become the same downstream segment as wick',
);

console.log('volume emitter basis contracts passed');
