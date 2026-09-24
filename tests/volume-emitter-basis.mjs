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
  return compileVolumeEmitterFamily({ ...HELD_REQUEST, ...overrides, family });
}

function assertVectorClose(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message} dimensionality`);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= 1e-9, `${message}[${index}] ${value} != ${expected[index]}`);
  });
}

function assertCommonReceipt(result, family) {
  assert.equal(result.schema, VOLUME_EMITTER_BASIS_SCHEMA);
  assert.equal(result.identity, 'kaminos-volume-analytic-emitter-basis-v1');
  assert.equal(result.family, family);
  assert.equal(result.requested.family, family);
  assert.equal(result.effective.family, family);
  assert.equal(result.effective.sourceCount, 1);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.failures, []);
  assert.equal(result.carrier, undefined);
  assert.equal(result.descriptor.mode, 'analytic-fixed');
  assert.equal(result.descriptor.coordinateSpace, 'volume-local');
  assert.equal(result.descriptor.frameId, HELD_REQUEST.frameId);
  assert.equal(result.descriptor.timestampMs, HELD_REQUEST.timestampMs);
  assert.equal(result.descriptor.compactSupport.exterior, 'zero');
  assertVectorClose(result.effective.direction, [0, 1, 0], `${family} normalized direction`);
  assert.equal(result.descriptor.strength, HELD_REQUEST.strength);
  assert.deepEqual(result.descriptor.chemistry, HELD_REQUEST.chemistry);
  assert.equal(result.descriptor.velocitySpeed, HELD_REQUEST.velocitySpeed);
}

assert.deepEqual(VOLUME_EMITTER_FAMILIES, ['wick', 'nozzle', 'ribbon', 'ring']);

const wick = compile('wick');
assertCommonReceipt(wick, 'wick');
assert.equal(wick.effective.support.primitive, 'analytic-capsule');
assert.equal(wick.descriptor.extent, HELD_REQUEST.length);
assertVectorClose(wick.descriptor.axis, [0, 1, 0], 'wick injection axis');

const nozzle = compile('nozzle');
assertCommonReceipt(nozzle, 'nozzle');
assert.equal(nozzle.effective.support.primitive, 'analytic-nozzle');
assertVectorClose(nozzle.effective.support.origin, HELD_REQUEST.origin, 'nozzle starts at source origin');

const ribbon = compile('ribbon');
assertCommonReceipt(ribbon, 'ribbon');
assert.equal(ribbon.effective.support.primitive, 'analytic-ribbon');
assertVectorClose(ribbon.descriptor.supportAxis, [1, 0, 0], 'ribbon support axis');
assertVectorClose(ribbon.descriptor.axis, [0, 1, 0], 'ribbon injection axis is independent');

const ring = compile('ring');
assertCommonReceipt(ring, 'ring');
assert.equal(ring.effective.support.primitive, 'analytic-annulus');
assert.equal(ring.effective.support.radius, HELD_REQUEST.ringRadius);
assert.equal(ring.effective.support.tubeRadius, HELD_REQUEST.radius);
assert.equal(Object.hasOwn(ring.requested, 'ringSegments'), false);

const downstreamGeometry = result => ({
  family: result.descriptor.family,
  support: result.descriptor.support,
  axis: result.descriptor.axis,
  supportAxis: result.descriptor.supportAxis,
  radius: result.descriptor.radius,
  extent: result.descriptor.extent,
});
for (const left of VOLUME_EMITTER_FAMILIES) {
  for (const right of VOLUME_EMITTER_FAMILIES) {
    if (left >= right) continue;
    assert.notDeepEqual(
      downstreamGeometry(compile(left)),
      downstreamGeometry(compile(right)),
      `${left} and ${right} remain distinct in the analytic consumer descriptor`,
    );
  }
}

assert.throws(
  () => compileVolumeEmitterFamily({ ...HELD_REQUEST, family: 'cluster' }),
  /unsupported emitter family: cluster/,
);
assert.doesNotThrow(
  () => compile('ring', { ringSegments: 'no-longer-a-control-axis' }),
  'analytic Ring does not expose tessellation as morphology or cost',
);
assert.throws(
  () => compile('wick', { direction: [0, 0, 0] }),
  /direction must be a finite non-zero vec3/,
);
assert.throws(
  () => compile('nozzle', { origin: [1.45, 0, 0], direction: [1, 0, 0], length: 0.2 }),
  /generated emitter support exceeds volume-local analytic bounds \[-1\.5, 1\.5\]/,
);
assert.throws(
  () => compile('wick', { velocitySpeed: 3.1 }),
  /velocitySpeed 3\.1 must be within \[0, 3\]/,
);
assert.throws(
  () => compile('wick', { timestampMs: -1 }),
  /timestampMs -1 must be within \[0, 9007199254740991\]/,
);
assert.throws(
  () => compile('wick', { frameId: '   ' }),
  /frameId must be a non-empty string/,
);
assert.doesNotThrow(
  () => compile('wick', { radius: 0.18, ringRadius: 'malformed-ring-radius', ringSegments: 'irrelevant' }),
);
assert.doesNotThrow(
  () => compile('nozzle', { supportAxis: [0, Number.NaN, 0] }),
);
assert.throws(
  () => compile('ribbon', { supportAxis: [0, 1, 0] }),
  /supportAxis projected perpendicular to direction must be a finite non-zero vec3/,
);

console.log('volume analytic emitter basis contracts passed');
