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
        sourceLaw: descriptor?.sourceLaw ?? 'legacy-volume',
        sourceDepth: descriptor?.sourceDepth ?? 0.04,
        inletProfile: descriptor?.inletProfile ?? 'plug',
        momentumLinked: descriptor?.momentumLinked ?? true,
        inletVelocity: descriptor?.inletVelocity ?? 0.04,
        effectiveInletVelocity: descriptor?.effectiveInletVelocity ?? 0.04,
        shearWidthCells: descriptor?.shearWidthCells ?? 3,
        edgeEntrainment: descriptor?.edgeEntrainment ?? 0.65,
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

const clusterEditPrototype = makePrototype();
const clusterBeforeEdit = applyVolumeEmitterFamilyRuntime({
  prototype: clusterEditPrototype,
  family: 'cluster',
  controls: {
    ...HELD_CONTROLS,
    emitterSourceLaw: 'legacy-volume',
    emitterSourceDepth: 0.04,
  },
  timestampMs: 1_000,
  frameId: 'cluster-before-source-edit',
});
const clusterAfterEdit = applyVolumeEmitterFamilyRuntime({
  prototype: clusterEditPrototype,
  family: 'cluster',
  controls: {
    ...HELD_CONTROLS,
    emitterSourceLaw: 'shallow-primary',
    emitterSourceDepth: 0.09,
  },
  timestampMs: 1_001,
  frameId: 'cluster-after-source-edit',
});
assert.deepEqual(
  [clusterBeforeEdit.requested.sourceLaw, clusterBeforeEdit.requested.sourceDepth],
  ['legacy-volume', 0.04],
  'the initial Cluster receipt captures its requested analytic settings without claiming they ran',
);
assert.deepEqual(
  [clusterAfterEdit.requested.sourceLaw, clusterAfterEdit.requested.sourceDepth],
  ['shallow-primary', 0.09],
  'a Cluster-mode source edit publishes the newly requested law and depth',
);
assert.deepEqual(
  [clusterAfterEdit.effective.sourceLaw, clusterAfterEdit.effective.sourceDepth],
  ['inactive', null],
  'the same Cluster-mode edit keeps the analytic law and depth explicitly inactive',
);
assert.equal(clusterEditPrototype.calls.controls.length, 2, 'each Cluster-mode edit traverses the runtime composition boundary');

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
assert.equal(synthetic.prototype.calls.external.length, 1);

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
