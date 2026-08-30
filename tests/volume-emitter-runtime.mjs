import assert from 'node:assert/strict';

import {
  applyVolumeEmitterFamilyRuntime,
  resolveVolumeCoreEmitterSource,
} from '../volume-emitter-runtime.mjs';

const HELD_CONTROLS = Object.freeze({
  inputRadius: 0.12,
  flowRate: 1.2,
  fire: 1.4,
  smoke: 2.8,
});

function makePrototype({ carrierOverride = null, primitiveFlowRate = null } = {}) {
  const calls = { controls: [], coreSource: [], external: [] };
  let currentControls = HELD_CONTROLS;
  return {
    calls,
    setControls(controls) {
      currentControls = structuredClone(controls);
      calls.controls.push(structuredClone(controls));
    },
    setCoreEmitterSourceMode(mode) {
      calls.coreSource.push(mode);
      return resolveVolumeCoreEmitterSource({
        mode,
        controlFlowRate: currentControls.flowRate,
        primitiveFlowRate,
        primitiveId: primitiveFlowRate === null ? null : 'test-primitive',
      });
    },
    setExternalEmitters(payload) {
      calls.external.push(structuredClone(payload));
      return carrierOverride?.(payload) || {
        mode: payload.mode || (payload.emitters.length ? 'external' : 'off'),
        coordinateSpace: payload.emitters.length ? 'volume-local' : 'none',
        count: payload.emitters.length,
        ageMs: 0,
        frameId: payload.frameId,
      };
    },
  };
}

function apply(family, prototype = makePrototype(), overrides = {}) {
  return {
    prototype,
    receipt: applyVolumeEmitterFamilyRuntime({
      prototype,
      family,
      controls: HELD_CONTROLS,
      timestampMs: 1_000,
      frameId: 'runtime-held-frame',
      ...overrides,
    }),
  };
}

const cluster = apply('cluster');
assert.deepEqual(cluster.prototype.calls.controls, [HELD_CONTROLS]);
assert.deepEqual(cluster.prototype.calls.coreSource, ['cluster']);
assert.equal(cluster.prototype.calls.external.length, 1);
assert.equal(cluster.prototype.calls.external[0].mode, 'off');
assert.deepEqual(cluster.prototype.calls.external[0].emitters, []);
assert.equal(cluster.receipt.schema, 'kaminos.volume-emitter-runtime.v0');
assert.equal(cluster.receipt.requested.family, 'cluster');
assert.equal(cluster.receipt.effective.family, 'cluster');
assert.equal(cluster.receipt.effective.coreFlowRate, HELD_CONTROLS.flowRate);
assert.equal(cluster.receipt.effective.externalEmitterCount, 0);
assert.equal(cluster.receipt.fallbackUsed, false);
assert.deepEqual(cluster.receipt.failures, []);

const expectedCounts = { wick: 1, nozzle: 1, ribbon: 1, ring: 12 };
const compiled = Object.fromEntries(Object.entries(expectedCounts).map(([family, expectedCount]) => {
  const result = apply(family);
  assert.equal(result.prototype.calls.controls.length, 1, `${family} applies core controls once`);
  assert.equal(result.prototype.calls.controls[0].flowRate, HELD_CONTROLS.flowRate, `${family} preserves the requested source control for truthful readback`);
  assert.deepEqual(result.prototype.calls.coreSource, ['external-only'], `${family} selects external-only at the authoritative core boundary`);
  assert.equal(result.prototype.calls.controls[0].inputRadius, HELD_CONTROLS.inputRadius);
  assert.equal(result.prototype.calls.external.length, 1, `${family} applies the carrier once`);
  assert.equal(result.prototype.calls.external[0].mode, 'emitter_basis_assay');
  assert.equal(result.prototype.calls.external[0].coordinateSpace, 'volume-local');
  assert.equal(result.prototype.calls.external[0].emitters.length, expectedCount);
  assert.equal(result.receipt.requested.family, family);
  assert.equal(result.receipt.requested.coreFlowRate, HELD_CONTROLS.flowRate);
  assert.equal(result.receipt.effective.family, family);
  assert.equal(result.receipt.effective.coreFlowRate, 0);
  assert.equal(result.receipt.effective.externalStrength, HELD_CONTROLS.flowRate);
  assert.equal(result.receipt.effective.externalEmitterCount, expectedCount);
  assert.equal(result.receipt.carrierReceipt.count, expectedCount);
  assert.equal(result.receipt.fallbackUsed, false);
  assert.deepEqual(result.receipt.failures, []);
  return [family, result];
}));

const heldChemistry = compiled.wick.receipt.compilerReceipt.effective.chemistry;
const heldDirection = compiled.wick.receipt.compilerReceipt.effective.direction;
const heldTemporal = compiled.wick.receipt.compilerReceipt.effective.temporal;
for (const family of ['nozzle', 'ribbon', 'ring']) {
  assert.deepEqual(compiled[family].receipt.compilerReceipt.effective.chemistry, heldChemistry, `${family} holds chemistry fixed`);
  assert.deepEqual(compiled[family].receipt.compilerReceipt.effective.direction, heldDirection, `${family} holds direction fixed`);
  assert.deepEqual(compiled[family].receipt.compilerReceipt.effective.temporal, heldTemporal, `${family} holds temporal law fixed`);
}

assert.notEqual(
  compiled.wick.receipt.compilerReceipt.effective.support.primitive,
  compiled.nozzle.receipt.compilerReceipt.effective.support.primitive,
  'assay arms change support geometry rather than merely relabeling the same source',
);

const primitiveBackedWick = apply('wick', makePrototype({ primitiveFlowRate: 0.15 }));
assert.equal(primitiveBackedWick.receipt.coreSourceReceipt.requestedControlFlowRate, HELD_CONTROLS.flowRate);
assert.equal(primitiveBackedWick.receipt.coreSourceReceipt.requestedPrimitiveFlowRate, 0.15);
assert.equal(primitiveBackedWick.receipt.coreSourceReceipt.effectiveFlowRate, 0);
assert.equal(primitiveBackedWick.receipt.effective.coreFlowRate, 0);

const syntheticRequest = {
  mode: 'synthetic_hand_trails',
  frameId: 'runtime-held-frame',
  timestampMs: 1_000,
  coordinateSpace: 'volume-local',
  emitters: Array.from({ length: 5 }, (_, index) => ({
    id: `synthetic-${index}`,
    active: true,
    start: [index * 0.01, -0.6, 0],
    end: [index * 0.01, -0.5, 0],
  })),
};
const syntheticPrototype = makePrototype();
const syntheticFirst = apply('cluster', syntheticPrototype, { externalRequest: syntheticRequest });
const syntheticAfterControl = apply('cluster', syntheticPrototype, {
  controls: { ...HELD_CONTROLS, fire: 1.5 },
  externalRequest: { ...syntheticRequest, frameId: 'runtime-held-frame-2' },
  frameId: 'runtime-held-frame-2',
});
for (const result of [syntheticFirst, syntheticAfterControl]) {
  assert.equal(result.receipt.effective.externalEmitterMode, 'synthetic_hand_trails');
  assert.equal(result.receipt.effective.externalEmitterCount, 5);
  assert.equal(result.receipt.effective.coordinateSpace, 'volume-local');
}
assert.deepEqual(
  syntheticPrototype.calls.external.map(request => request.mode),
  ['synthetic_hand_trails', 'synthetic_hand_trails'],
  'an unrelated control change cannot briefly clear the synthetic route through an off writer',
);

assert.throws(
  () => apply('wick', makePrototype({ carrierOverride: payload => ({
    mode: 'fallback_cluster',
    coordinateSpace: 'volume-local',
    count: payload.emitters.length,
    frameId: payload.frameId,
  }) })),
  /external emitter carrier mode mismatch: requested emitter_basis_assay, effective fallback_cluster/,
  'a fallback route cannot masquerade as an effective emitter-family assay',
);
assert.throws(
  () => apply('ring', makePrototype({ carrierOverride: payload => ({
    mode: payload.mode,
    coordinateSpace: payload.coordinateSpace,
    count: payload.emitters.length - 1,
    frameId: payload.frameId,
  }) })),
  /external emitter carrier count mismatch: requested 12, effective 11/,
  'carrier truncation cannot masquerade as complete requested morphology',
);
assert.throws(
  () => apply('wick', makePrototype({ carrierOverride: payload => ({
    mode: payload.mode,
    coordinateSpace: 'world',
    count: payload.emitters.length,
    frameId: payload.frameId,
  }) })),
  /external emitter carrier coordinate space mismatch: requested volume-local, effective world/,
  'coordinate substitution cannot masquerade as volume-local source evidence',
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setControls() {}, setCoreEmitterSourceMode() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setExternalEmitters is required/,
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setCoreEmitterSourceMode() {}, setExternalEmitters() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setControls is required/,
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setControls() {}, setExternalEmitters() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setCoreEmitterSourceMode is required/,
);
assert.throws(
  () => apply('bonfire'),
  /unsupported runtime emitter family: bonfire/,
  'unknown families fail loud instead of silently selecting the incumbent source',
);

console.log('volume emitter runtime contracts passed');
