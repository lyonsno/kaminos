import assert from 'node:assert/strict';

import {
  KAMINOS_VOLUME_BASIN_SLOT_STORAGE_PREFIX,
  KAMINOS_VOLUME_BASIN_STORAGE_KEY,
  VOLUME_BASIN_SNAPSHOT_IDENTITY,
  buildVolumeBasinUrl,
  persistVolumeBasinSnapshot,
  restoreVolumeBasinState,
} from '../volume-basin-runtime.mjs';
import {
  applyVolumeEmitterFamilyRuntime,
  resolveVolumeCoreEmitterSource,
  resolveVolumeEmitterRoute,
} from '../volume-emitter-runtime.mjs';

const ROUTE_FIELDS = [
  ['emitterFamily', 'volume_emitter_family'],
  ['inputRadius', 'volume_input_radius'],
  ['flowRate', 'volume_flow_rate'],
];
const HELD_CONTROLS = Object.freeze({ inputRadius: 0.12, flowRate: 1.2, fire: 1.4, smoke: 2.8 });

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function makePrototype() {
  let controls = HELD_CONTROLS;
  return {
    setControls(next) { controls = structuredClone(next); },
    setCoreEmitterSourceMode(mode) {
      return resolveVolumeCoreEmitterSource({ mode, controlFlowRate: controls.flowRate });
    },
    setAnalyticEmitterDescriptor(descriptor) {
      return {
        mode: descriptor ? 'analytic-fixed' : 'off',
        family: descriptor?.family ?? 'cluster',
        coordinateSpace: descriptor ? 'volume-local' : 'none',
        count: descriptor ? 1 : 0,
        frameId: descriptor?.frameId ?? null,
      };
    },
    setExternalEmitters(payload) {
      return {
        mode: payload.mode,
        coordinateSpace: payload.emitters.length ? 'volume-local' : 'none',
        count: payload.emitters.length,
        frameId: payload.frameId,
      };
    },
  };
}

function runtimeFor(prototype, controls, frameId) {
  const route = resolveVolumeEmitterRoute({ requestedFamily: controls.emitterFamily });
  const receipt = applyVolumeEmitterFamilyRuntime({
    prototype,
    family: route.effectiveFamily,
    controls,
    timestampMs: 1_000,
    frameId,
  });
  receipt.routeReceipt = route;
  return receipt;
}

for (const family of ['wick', 'nozzle', 'ribbon', 'ring']) {
  const storage = memoryStorage();
  const controls = { ...HELD_CONTROLS, emitterFamily: family };
  const copiedUrl = buildVolumeBasinUrl({
    href: 'http://127.0.0.1:8430/?stale=1',
    controls,
    routeFields: ROUTE_FIELDS,
  });
  assert.equal(new URL(copiedUrl).searchParams.get('volume_emitter_family'), family);
  const replayed = resolveVolumeEmitterRoute({
    requestedFamily: new URL(copiedUrl).searchParams.get('volume_emitter_family'),
  });
  assert.equal(replayed.effectiveFamily, family);
  assert.equal(replayed.sourceMode, 'analytic-only');

  const snapshot = persistVolumeBasinSnapshot({
    storage,
    storageKey: KAMINOS_VOLUME_BASIN_STORAGE_KEY,
    reason: 'copy-basin',
    controls,
    href: copiedUrl,
    routeFields: ROUTE_FIELDS,
    now: '2026-09-01T00:00:00.000Z',
  });
  storage.setItem(`${KAMINOS_VOLUME_BASIN_SLOT_STORAGE_PREFIX}b`, JSON.stringify(snapshot));

  for (const storageKey of [
    KAMINOS_VOLUME_BASIN_STORAGE_KEY,
    `${KAMINOS_VOLUME_BASIN_SLOT_STORAGE_PREFIX}b`,
  ]) {
    let activeControls = { ...HELD_CONTROLS, emitterFamily: family === 'ring' ? 'wick' : 'ring' };
    const callOrder = [];
    const result = restoreVolumeBasinState({
      storage,
      storageKey,
      applyControls(saved) {
        callOrder.push('dom');
        activeControls = structuredClone(saved);
      },
      readControls() {
        callOrder.push('read');
        return structuredClone(activeControls);
      },
      applyRuntime(restored) {
        callOrder.push('runtime');
        return runtimeFor(makePrototype(), restored, `${family}-${storageKey}`);
      },
    });
    assert.deepEqual(callOrder, ['dom', 'read', 'runtime']);
    assert.equal(result.ok, true);
    assert.equal(activeControls.emitterFamily, family);
    assert.equal(result.restoredControls.emitterFamily, family);
    assert.equal(result.runtimeReceipt.requested.family, family);
    assert.equal(result.runtimeReceipt.effective.family, family);
    assert.equal(result.runtimeReceipt.coreSourceReceipt.effectiveOwner, 'analytic-emitter');
    assert.equal(result.runtimeReceipt.coreSourceReceipt.effectiveFlowRate, 0);
    assert.equal(result.runtimeReceipt.fallbackUsed, false);
    assert.equal(result.runtimeReceipt.compilerReceipt.descriptor.family, family);
  }
}

const legacyRoute = resolveVolumeEmitterRoute({ requestedFamily: new URL('http://127.0.0.1:8430/?kaminos_volume_smoke=1').searchParams.get('volume_emitter_family') });
assert.equal(legacyRoute.effectiveFamily, 'cluster');
assert.equal(legacyRoute.legacyFamilyDefault, true);

assert.throws(
  () => buildVolumeBasinUrl({
    href: 'http://127.0.0.1:8430/',
    controls: { ...HELD_CONTROLS, emitterFamily: 'ring' },
    routeFields: ROUTE_FIELDS.filter(([key]) => key !== 'emitterFamily'),
  }),
  /volume_emitter_family is required/,
);
assert.equal(VOLUME_BASIN_SNAPSHOT_IDENTITY, 'kaminos-volume-basin-snapshot-v1');

console.log('volume Basin emitter URL, autosave, slot restore, and runtime roundtrip contracts passed');
