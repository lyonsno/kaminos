import assert from 'node:assert/strict';

import { applyVolumeEmitterFamilyRuntime } from '../volume-emitter-runtime.mjs';

const HELD_CONTROLS = Object.freeze({
  inputRadius: 0.12,
  flowRate: 1.2,
  fire: 1.4,
  smoke: 2.8,
});

function makePrototype(carrierOverride = null) {
  const calls = { controls: [], external: [] };
  return {
    calls,
    setControls(controls) {
      calls.controls.push(structuredClone(controls));
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
  assert.equal(result.prototype.calls.controls[0].flowRate, 0, `${family} disables the clustered source`);
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

assert.throws(
  () => apply('wick', makePrototype(payload => ({
    mode: 'fallback_cluster',
    coordinateSpace: 'volume-local',
    count: payload.emitters.length,
    frameId: payload.frameId,
  }))),
  /external emitter carrier mode mismatch: requested emitter_basis_assay, effective fallback_cluster/,
  'a fallback route cannot masquerade as an effective emitter-family assay',
);
assert.throws(
  () => apply('ring', makePrototype(payload => ({
    mode: payload.mode,
    coordinateSpace: payload.coordinateSpace,
    count: payload.emitters.length - 1,
    frameId: payload.frameId,
  }))),
  /external emitter carrier count mismatch: requested 12, effective 11/,
  'carrier truncation cannot masquerade as complete requested morphology',
);
assert.throws(
  () => apply('wick', makePrototype(payload => ({
    mode: payload.mode,
    coordinateSpace: 'world',
    count: payload.emitters.length,
    frameId: payload.frameId,
  }))),
  /external emitter carrier coordinate space mismatch: requested volume-local, effective world/,
  'coordinate substitution cannot masquerade as volume-local source evidence',
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setControls() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setExternalEmitters is required/,
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setExternalEmitters() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setControls is required/,
);
assert.throws(
  () => apply('bonfire'),
  /unsupported runtime emitter family: bonfire/,
  'unknown families fail loud instead of silently selecting the incumbent source',
);

console.log('volume emitter runtime contracts passed');
