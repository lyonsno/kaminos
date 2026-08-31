import assert from 'node:assert/strict';

import {
  applyVolumeEmitterFamilyRuntime,
  resolveVolumeCoreEmitterSource,
  resolveVolumeEmitterActivity,
  resolveVolumeEmitterRoute,
} from '../volume-emitter-runtime.mjs';

const HELD_CONTROLS = Object.freeze({
  inputRadius: 0.12,
  flowRate: 1.2,
  fire: 1.4,
  smoke: 2.8,
});

function makePrototype({ analyticOverride = null, carrierOverride = null, primitiveFlowRate = null } = {}) {
  const calls = { controls: [], coreSource: [], analytic: [], external: [] };
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
    setAnalyticEmitterDescriptor(descriptor) {
      calls.analytic.push(structuredClone(descriptor));
      return analyticOverride?.(descriptor) || {
        mode: descriptor ? 'analytic-fixed' : 'off',
        family: descriptor?.family ?? 'cluster',
        coordinateSpace: descriptor ? 'volume-local' : 'none',
        count: descriptor ? 1 : 0,
        frameId: descriptor?.frameId ?? null,
      };
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
assert.equal(cluster.prototype.calls.analytic.length, 1);
assert.equal(cluster.prototype.calls.analytic[0], null);
assert.equal(cluster.prototype.calls.external.length, 1);
assert.equal(cluster.prototype.calls.external[0].mode, 'off');
assert.equal(cluster.receipt.schema, 'kaminos.volume-emitter-runtime.v1');
assert.equal(cluster.receipt.effective.coreFlowRate, HELD_CONTROLS.flowRate);
assert.equal(cluster.receipt.effective.sourceCount, 0);
assert.equal(cluster.receipt.effective.sourceMode, 'off');

const compiled = Object.fromEntries(['wick', 'nozzle', 'ribbon', 'ring'].map(family => {
  const result = apply(family);
  assert.equal(result.prototype.calls.controls.length, 1, `${family} applies controls once`);
  assert.deepEqual(result.prototype.calls.coreSource, ['analytic-only']);
  assert.equal(result.prototype.calls.analytic.length, 1);
  assert.equal(result.prototype.calls.analytic[0].family, family);
  assert.equal(result.prototype.calls.external.length, 0, `${family} performs no external carrier write`);
  assert.equal(result.receipt.effective.coreFlowRate, 0);
  assert.equal(result.receipt.effective.sourceStrength, HELD_CONTROLS.flowRate);
  assert.equal(result.receipt.effective.sourceCount, 1);
  assert.equal(result.receipt.effective.sourceMode, 'analytic-fixed');
  assert.equal(result.receipt.effective.coordinateSpace, 'volume-local');
  assert.equal(result.receipt.carrierReceipt, null);
  assert.equal(result.receipt.sourceReceipt.family, family);
  assert.equal(result.receipt.fallbackUsed, false);
  return [family, result];
}));

const heldChemistry = compiled.wick.receipt.compilerReceipt.effective.chemistry;
const heldDirection = compiled.wick.receipt.compilerReceipt.effective.direction;
const heldTemporal = compiled.wick.receipt.compilerReceipt.effective.temporal;
for (const family of ['nozzle', 'ribbon', 'ring']) {
  assert.deepEqual(compiled[family].receipt.compilerReceipt.effective.chemistry, heldChemistry);
  assert.deepEqual(compiled[family].receipt.compilerReceipt.effective.direction, heldDirection);
  assert.deepEqual(compiled[family].receipt.compilerReceipt.effective.temporal, heldTemporal);
}

const primitiveBackedWick = apply('wick', makePrototype({ primitiveFlowRate: 0.15 }));
assert.equal(primitiveBackedWick.receipt.coreSourceReceipt.requestedPrimitiveFlowRate, 0.15);
assert.equal(primitiveBackedWick.receipt.coreSourceReceipt.effectiveOwner, 'analytic-emitter');
assert.equal(primitiveBackedWick.receipt.coreSourceReceipt.effectiveFlowRate, 0);

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
const synthetic = apply('cluster', makePrototype(), { externalRequest: syntheticRequest });
assert.equal(synthetic.receipt.effective.sourceMode, 'synthetic_hand_trails');
assert.equal(synthetic.receipt.effective.sourceCount, 5);
assert.deepEqual(synthetic.prototype.calls.coreSource, ['external-only']);
assert.equal(synthetic.receipt.coreSourceReceipt.effectiveOwner, 'external-emitter');
assert.equal(synthetic.receipt.effective.coreFlowRate, 0);
assert.equal(synthetic.receipt.requested.externalSourceMode, 'synthetic_hand_trails');
assert.equal(synthetic.receipt.effective.externalSourceMode, 'synthetic_hand_trails');
assert.equal(synthetic.prototype.calls.external.length, 1);

for (const family of ['cluster', 'wick', 'nozzle', 'ribbon', 'ring']) {
  const route = resolveVolumeEmitterRoute({ requestedFamily: family });
  assert.equal(route.requestedFamily, family);
  assert.equal(route.effectiveFamily, family);
  assert.equal(route.requestedExternalMode, 'off');
  assert.equal(route.effectiveExternalMode, 'off');
  assert.equal(route.sourceMode, family === 'cluster' ? 'cluster' : 'analytic-only');
  assert.equal(route.fallbackUsed, false);
}
const legacyRoute = resolveVolumeEmitterRoute();
assert.equal(legacyRoute.requestedFamily, 'cluster');
assert.equal(legacyRoute.legacyFamilyDefault, true);
assert.equal(legacyRoute.legacyExternalDefault, true);
const syntheticRoute = resolveVolumeEmitterRoute({
  requestedFamily: 'cluster',
  requestedExternalMode: 'synthetic_hand_trails',
});
assert.equal(syntheticRoute.sourceMode, 'external-only');
assert.equal(syntheticRoute.effectiveExternalMode, 'synthetic_hand_trails');
const staleSources = { coreFlowRate: 1.2, analyticCount: 1, externalCount: 5 };
assert.deepEqual(resolveVolumeEmitterActivity({ mode: 'cluster', ...staleSources }), {
  mode: 'cluster', coreFlowRate: 1.2, analyticCount: 0, externalCount: 0, effectiveOwner: 'cluster',
});
assert.deepEqual(resolveVolumeEmitterActivity({ mode: 'analytic-only', ...staleSources }), {
  mode: 'analytic-only', coreFlowRate: 0, analyticCount: 1, externalCount: 0, effectiveOwner: 'analytic-emitter',
});
assert.deepEqual(resolveVolumeEmitterActivity({ mode: 'external-only', ...staleSources }), {
  mode: 'external-only', coreFlowRate: 0, analyticCount: 0, externalCount: 5, effectiveOwner: 'external-emitter',
});
assert.throws(
  () => resolveVolumeEmitterRoute({ requestedFamily: 'cluster', requestedExternalMode: 'synthetic_hand_trial' }),
  /unsupported volume_external_emitters route: synthetic_hand_trial/,
);
assert.throws(
  () => resolveVolumeEmitterRoute({ requestedFamily: 'ring', requestedExternalMode: 'synthetic_hand_trails' }),
  /volume emitter source conflict/,
);

assert.throws(
  () => apply('ring', makePrototype({ analyticOverride: descriptor => ({
    mode: 'fallback-cluster',
    family: descriptor.family,
    coordinateSpace: 'volume-local',
    count: 1,
  }) })),
  /analytic emitter mode mismatch: requested analytic-fixed, effective fallback-cluster/,
);
assert.throws(
  () => apply('wick', makePrototype({ analyticOverride: descriptor => ({
    mode: 'analytic-fixed',
    family: descriptor.family,
    coordinateSpace: 'volume-local',
    count: 0,
  }) })),
  /analytic emitter source count mismatch: requested 1, effective 0/,
);
assert.throws(
  () => apply('cluster', makePrototype({ carrierOverride: payload => ({
    mode: 'fallback_cluster',
    coordinateSpace: 'none',
    count: 0,
    frameId: payload.frameId,
  }) })),
  /external emitter carrier mode mismatch: requested off, effective fallback_cluster/,
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setControls() {}, setCoreEmitterSourceMode() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setAnalyticEmitterDescriptor is required/,
);
assert.throws(
  () => applyVolumeEmitterFamilyRuntime({
    prototype: { setCoreEmitterSourceMode() {}, setAnalyticEmitterDescriptor() {} },
    family: 'wick',
    controls: HELD_CONTROLS,
  }),
  /prototype\.setControls is required/,
);
assert.throws(
  () => apply('bonfire'),
  /unsupported runtime emitter family: bonfire/,
);

console.log('volume analytic emitter runtime contracts passed');
