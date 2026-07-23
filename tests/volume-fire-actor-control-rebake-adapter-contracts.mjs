import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as fireActor from '../volume-fire-actor-mount.mjs';

const controlIds = [
  'volume_reaction_boundary_fire_tip',
  'volume_reaction_boundary_topology',
  'volume_reaction_boundary_fire_erosion',
  'volume_reaction_boundary_cut',
  'volume_reaction_boundary_softness',
  'volume_reaction_boundary_core_reject',
  'volume_reaction_boundary_support_thermal',
  'volume_reaction_boundary_support_reaction',
  'volume_reaction_boundary_support_front',
  'volume_reaction_boundary_support_interface',
  'volume_reaction_boundary_fire_ridge',
  'volume_reaction_boundary_fire_ridge_cut',
  'volume_reaction_boundary_curl',
  'volume_reaction_boundary_divergence',
];

assert.equal(
  typeof fireActor.createFireActorControlRebakeAdapter,
  'function',
  'promoted FireActor does not expose the reusable control/rebake adapter factory',
);
assert.deepEqual(fireActor.FIRE_ACTOR_REBAKE_CONTROL_IDS, controlIds);

function sha256(values) {
  return createHash('sha256')
    .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
    .digest('hex');
}

function encodeFloat32(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64');
}

function tinyState(mode = 'frozen') {
  const grid = 7;
  const cellCount = grid ** 3;
  const fluid = new Float32Array(cellCount * 16);
  const front = new Float32Array(cellCount);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cell = x + y * grid + z * grid * grid;
        const offset = cell * 16;
        const radial = Math.hypot(x - 3, z - 3);
        const plume = Math.max(0, 1 - radial / 3.2) * Math.max(0, 1 - Math.abs(y - 3) / 4);
        fluid[offset] = (z - 3) * 0.025;
        fluid[offset + 1] = 0.04 + y * 0.018;
        fluid[offset + 2] = (3 - x) * 0.022;
        fluid[offset + 3] = plume * 0.32;
        fluid[offset + 4] = plume * 0.18;
        fluid[offset + 5] = plume * (0.28 + y * 0.05);
        fluid[offset + 6] = plume * Math.max(0.01, 0.24 - y * 0.025);
        fluid[offset + 7] = plume * 0.14;
        fluid[offset + 8] = plume * 0.52;
        fluid[offset + 9] = plume * 0.16;
        fluid[offset + 10] = plume * 0.48;
        fluid[offset + 11] = plume * (0.10 + y * 0.035);
        fluid[offset + 12] = plume * 0.11;
        fluid[offset + 13] = plume * (0.08 + Math.abs(x - 3) * 0.025);
        fluid[offset + 14] = plume * (0.10 + y * 0.026);
        fluid[offset + 15] = plume * 0.07;
        front[cell] = plume * (0.12 + y * 0.018);
      }
    }
  }
  return {
    grid,
    fluid,
    front,
    source: {
      mode,
      stateId: `${mode}-fixture-state-120`,
      fluidSha256: sha256(fluid),
      frontSha256: sha256(front),
      cameraIdentity: 'fire-actor-live-parity-camera-v1',
      simStepCount: 120,
      routeIdentity: 'kaminos-volume-live-v0',
      backend: 'webgpu',
      exportAuthority: 'debug-full-grid-webgpu-copy-buffer-readback',
      exportIdentity: 'full-grid-fluid-front-boundary-sidecars-v0',
    },
  };
}

function fakeVolumeEngine({
  initiallyPaused = false,
  advanceOnRelease = true,
  advanceOnExportRelease = false,
  exportAuthority = 'debug-full-grid-webgpu-copy-buffer-readback',
  exportIdentity = 'full-grid-fluid-front-boundary-sidecars-v0',
  chunkSchema = 'kaminos.volume.full-field-export.v0',
  chunkIdentity = 'full-grid-fluid-front-boundary-sidecars-v0',
  chunkDtype = 'float32',
} = {}) {
  const state = tinyState('live');
  let paused = initiallyPaused;
  let simStepCount = state.source.simStepCount;
  let cameraSignature = state.source.cameraIdentity;
  let released = false;
  const pauseTransitions = [];
  return {
    state,
    pauseTransitions,
    get paused() {
      return paused;
    },
    get released() {
      return released;
    },
    advanceStep() {
      simStepCount += 1;
    },
    setCameraSignature(value) {
      cameraSignature = value;
    },
    debugState() {
      return {
        selectiveHeadLiveCapturePaused: paused,
        simStepCount,
        cameraSignature,
      };
    },
    setSelectiveHeadLiveCapturePaused(next) {
      paused = next === true;
      pauseTransitions.push(paused);
      if (!paused && advanceOnRelease) simStepCount += 1;
    },
    async beginDebugFullFieldExport() {
      return {
        ok: true,
        status: 'captured',
        completeFieldCoverage: true,
        schema: 'kaminos.volume.full-field-export.v0',
        sessionId: 'fire-actor-live-lease-fixture',
        grid: state.grid,
        fluid: { floatCount: state.fluid.length },
        front: { floatCount: state.front.length },
        routeIdentity: state.source.routeIdentity,
        effectiveRoute: state.source.routeIdentity,
        backend: state.source.backend,
        authority: exportAuthority,
        identity: exportIdentity,
      };
    },
    readDebugFullFieldExportChunk({ kind, startFloat }) {
      const values = kind === 'fluid' ? state.fluid : state.front;
      assert.equal(startFloat, 0);
      return {
        ok: true,
        schema: chunkSchema,
        identity: chunkIdentity,
        dtype: chunkDtype,
        kind,
        startFloat,
        floatCount: values.length,
        base64: encodeFloat32(values),
        isFinal: true,
      };
    },
    releaseDebugFullFieldExport({ sessionId }) {
      assert.equal(sessionId, 'fire-actor-live-lease-fixture');
      released = true;
      if (advanceOnExportRelease) simStepCount += 1;
    },
  };
}

const mount = {
  schema: fireActor.FIRE_ACTOR_MOUNT_SCHEMA,
  status: 'mounted',
  mountId: `firemount-${'c'.repeat(64)}`,
  actorId: 'wake-kiln-flamebowl-hero',
  basin: {
    handle: 'big-raymarch-hero-flamebowl-cotangent-covariance',
    revision: `basinrev-${'d'.repeat(64)}`,
    stableRef: `big-raymarch-hero-flamebowl-cotangent-covariance@basinrev-${'d'.repeat(64)}`,
    sourceCommit: 'dcf2ee18a8ed726efde5bf2ae4a8e0f8cd804c10',
  },
  sourcePackage: { sha256: 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc' },
  representation: {
    composition: 'smoke-raymarch-under-splats-v0',
    rendererIdentity: 'exact-basin-selective-carrier-heads-160-to-128-v0',
    sourceSidecar: 'baked',
  },
};

const requestedControls = {
  volume_reaction_boundary_fire_tip: 2,
  volume_reaction_boundary_topology: 2.5,
  volume_reaction_boundary_fire_erosion: 0.3,
  volume_reaction_boundary_cut: 0.365,
  volume_reaction_boundary_softness: 0.135,
  volume_reaction_boundary_core_reject: 1,
  volume_reaction_boundary_support_thermal: 0.98,
  volume_reaction_boundary_support_reaction: 1,
  volume_reaction_boundary_support_front: 0.66,
  volume_reaction_boundary_support_interface: 0.78,
  volume_reaction_boundary_fire_ridge: 1.52,
  volume_reaction_boundary_fire_ridge_cut: 0.145,
  volume_reaction_boundary_curl: 1.18,
  volume_reaction_boundary_divergence: 0.22,
};

const liveEngine = fakeVolumeEngine();
const liveStateReader = fireActor.createVolumeEngineStageBStateReader(liveEngine);
const heldLeaseProbe = await liveStateReader();
assert.equal(
  heldLeaseProbe.schema,
  'kaminos.fire-actor-stage-b-capture-lease.v1',
  'the live reader must return an explicit held capture lease',
);
assert.equal(liveEngine.paused, true, 'a running engine must remain paused until analytical rebake releases its lease');
assert.equal(heldLeaseProbe.state.source.cameraIdentity, liveEngine.state.source.cameraIdentity);
assert.equal(heldLeaseProbe.verifyHeldState().preReleaseSimStepCount, 120);
const heldLeaseRelease = heldLeaseProbe.release();
assert.equal(liveEngine.released, true);
assert.equal(liveEngine.paused, false);
assert.equal(heldLeaseRelease.preReleaseSimStepCount, 120);
assert.equal(heldLeaseRelease.postReleaseSimStepCount, 121);
assert.equal(heldLeaseRelease.advancedDuringLease, false);
assert.equal(heldLeaseRelease.advancedAfterRelease, true);

let liveReads = 0;
const adapterLiveEngine = fakeVolumeEngine();
const adapter = fireActor.createFireActorControlRebakeAdapter({
  mount,
  readLiveState: async () => {
    liveReads += 1;
    return fireActor.createVolumeEngineStageBStateReader(adapterLiveEngine)();
  },
  bakedBoundary: {
    authority: 'baked',
    identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
  },
});

const frozenState = tinyState('frozen');
const result = await adapter.rebake({
  sourceMode: 'frozen',
  state: frozenState,
  requestedControls,
  width: 48,
  height: 48,
});

assert.equal(result.receipt.schema, 'kaminos.fire-actor-control-rebake-receipt.v1');
assert.equal(result.receipt.status, 'applied');
assert.equal(result.receipt.mountId, mount.mountId);
assert.equal(result.receipt.basinRevision, mount.basin.revision);
assert.equal(result.receipt.packageSha256, mount.sourcePackage.sha256);
assert.deepEqual(Object.keys(result.receipt.requestedControls), controlIds);
assert.deepEqual(Object.keys(result.receipt.effectiveControls), controlIds);
assert.equal(result.receipt.source.requestedMode, 'frozen');
assert.equal(result.receipt.source.effectiveMode, 'frozen');
assert.equal(result.receipt.source.stateId, frozenState.source.stateId);
assert.equal(result.receipt.source.simStepCount, 120);
assert.equal(result.receipt.source.captureCameraIdentity, frozenState.source.cameraIdentity);
assert.equal(result.receipt.source.cameraRole, 'capture-state-binding-only-not-pixel-projection');
assert.equal(result.receipt.source.exportAuthority, 'debug-full-grid-webgpu-copy-buffer-readback');
assert.equal(result.receipt.source.exportIdentity, 'full-grid-fluid-front-boundary-sidecars-v0');
assert.equal(result.receipt.source.exportAuthority, result.producerReceipts.treatment.source.exportAuthority);
assert.equal(result.receipt.source.exportIdentity, result.producerReceipts.treatment.source.exportIdentity);
assert.equal(result.receipt.projection.requested, 'stage-b-fixed-analytical-projection-v1');
assert.equal(result.receipt.projection.effective, 'stage-b-fixed-analytical-projection-v1');
assert.equal(result.receipt.projection.identity, result.producerReceipts.treatment.projection.identity);
assert.equal(result.receipt.projection.identity, result.producerReceipts.baseline.projection.identity);
assert.notEqual(result.receipt.projection.identity, result.receipt.source.captureCameraIdentity);
assert.deepEqual(result.receipt.boundary, {
  baseline: {
    authority: 'baked',
    identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
  },
  requested: 'analytical-recomputed',
  effective: 'analytical-recomputed',
});
assert.equal(result.receipt.deltas.candidate.beforeIdentity.length, 64);
assert.equal(result.receipt.deltas.candidate.afterIdentity.length, 64);
assert.equal(Number.isFinite(result.receipt.deltas.candidate.count), true);
assert.equal(result.receipt.deltas.coefficient.beforeIdentity.length, 64);
assert.equal(result.receipt.deltas.covariance.afterIdentity.length, 64);
assert.equal(Array.isArray(result.receipt.deltas.coefficient.summary), true);
assert.equal(Array.isArray(result.receipt.deltas.covariance.summary), true);
assert.deepEqual(result.receipt.passes.requested, result.receipt.passes.applied);
assert.deepEqual(result.receipt.passes.encoded, []);
assert.equal(result.receipt.simulatorAdvanced, false);
assert.equal(result.receipt.fallbackReason, null);
assert.equal(result.pixels.length, 48 * 48 * 4);
assert.equal(liveReads, 0);
for (const [field, substituted] of [
  ['exportAuthority', 'cached-fallback'],
  ['exportIdentity', 'not-full-grid'],
]) {
  const substitutedReceipt = structuredClone(result.receipt);
  substitutedReceipt.source[field] = substituted;
  assert.throws(
    () => fireActor.validateFireActorControlRebakeReceipt(substitutedReceipt, {
      mount,
      requestedControls,
      sourceMode: 'frozen',
    }),
    /fire-actor-rebake-receipt-source-lease-mismatch/,
    `public receipt validation must reject substituted ${field}`,
  );
}

const live = await adapter.rebake({
  sourceMode: 'live',
  requestedControls,
  width: 32,
  height: 32,
});
assert.equal(live.receipt.source.effectiveMode, 'live');
assert.equal(liveReads, 1);
assert.equal(live.receipt.source.captureSimStepCount, 120);
assert.equal(live.receipt.source.preReleaseSimStepCount, 120);
assert.equal(live.receipt.source.postReleaseSimStepCount, 121);
assert.equal(live.receipt.source.advancedDuringLease, false);
assert.equal(live.receipt.source.advancedAfterRelease, true);
assert.equal(live.receipt.source.priorPauseState, false);
assert.equal(live.receipt.source.restoredPauseState, false);
assert.equal(live.receipt.simulatorAdvanced, false);
assert.deepEqual(adapterLiveEngine.pauseTransitions, [true, false]);

for (const [label, engine, expectedError] of [
  [
    'fallback authority',
    fakeVolumeEngine({ exportAuthority: 'cached-fallback' }),
    /fire-actor-rebake-source-export-authority-mismatch/,
  ],
  [
    'wrong session identity',
    fakeVolumeEngine({ exportIdentity: 'not-full-grid' }),
    /fire-actor-rebake-source-export-identity-mismatch/,
  ],
  [
    'wrong chunk identity',
    fakeVolumeEngine({ chunkIdentity: 'not-full-grid' }),
    /fire-actor-rebake-source-chunk-identity-mismatch/,
  ],
  [
    'wrong chunk schema',
    fakeVolumeEngine({ chunkSchema: 'kaminos.volume.cached-export.v0' }),
    /fire-actor-rebake-source-chunk-schema-mismatch/,
  ],
  [
    'wrong chunk dtype',
    fakeVolumeEngine({ chunkDtype: 'float16' }),
    /fire-actor-rebake-source-chunk-dtype-mismatch/,
  ],
]) {
  const substitutedAdapter = fireActor.createFireActorControlRebakeAdapter({
    mount,
    readLiveState: fireActor.createVolumeEngineStageBStateReader(engine),
    bakedBoundary: {
      authority: 'baked',
      identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
    },
  });
  await assert.rejects(
    substitutedAdapter.rebake({
      sourceMode: 'live',
      requestedControls,
      width: 32,
      height: 32,
    }),
    expectedError,
    `${label} must not produce an applied FireActor rebake receipt`,
  );
  assert.equal(engine.released, true, `${label} rejection must release the full-field export`);
  assert.equal(engine.paused, false, `${label} rejection must restore the prior running state`);
}

const driftingEngine = fakeVolumeEngine();
const driftingReader = fireActor.createVolumeEngineStageBStateReader(driftingEngine);
const driftingAdapter = fireActor.createFireActorControlRebakeAdapter({
  mount,
  readLiveState: async () => {
    const lease = await driftingReader();
    driftingEngine.advanceStep();
    return lease;
  },
  bakedBoundary: {
    authority: 'baked',
    identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
  },
});
await assert.rejects(
  driftingAdapter.rebake({
    sourceMode: 'live',
    requestedControls,
    width: 32,
    height: 32,
  }),
  /fire-actor-rebake-source-advanced-during-lease/,
);
assert.equal(driftingEngine.released, true, 'a drifting source must still release its full-field export');
assert.equal(driftingEngine.paused, false, 'a drifting source must still restore the prior running state');

const cameraDriftEngine = fakeVolumeEngine();
const cameraDriftReader = fireActor.createVolumeEngineStageBStateReader(cameraDriftEngine);
const cameraDriftAdapter = fireActor.createFireActorControlRebakeAdapter({
  mount,
  readLiveState: async () => {
    const lease = await cameraDriftReader();
    cameraDriftEngine.setCameraSignature('stale-camera-substitution');
    return lease;
  },
  bakedBoundary: {
    authority: 'baked',
    identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
  },
});
await assert.rejects(
  cameraDriftAdapter.rebake({
    sourceMode: 'live',
    requestedControls,
    width: 32,
    height: 32,
  }),
  /fire-actor-rebake-source-camera-drift-during-lease/,
);
assert.equal(cameraDriftEngine.released, true, 'camera drift must still release its full-field export');
assert.equal(cameraDriftEngine.paused, false, 'camera drift must still restore the prior running state');

const pausedAdvanceEngine = fakeVolumeEngine({
  initiallyPaused: true,
  advanceOnRelease: false,
  advanceOnExportRelease: true,
});
const pausedAdvanceReader = fireActor.createVolumeEngineStageBStateReader(pausedAdvanceEngine);
const pausedAdvanceAdapter = fireActor.createFireActorControlRebakeAdapter({
  mount,
  readLiveState: pausedAdvanceReader,
  bakedBoundary: {
    authority: 'baked',
    identity: '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216',
  },
});
await assert.rejects(
  pausedAdvanceAdapter.rebake({
    sourceMode: 'live',
    requestedControls,
    width: 32,
    height: 32,
  }),
  /fire-actor-rebake-source-advanced-after-release-while-paused/,
  'an engine that was already paused must not advance when the capture lease is released',
);

await assert.rejects(
  adapter.rebake({
    sourceMode: 'frozen',
    state: { ...frozenState, source: { ...frozenState.source, mode: 'live' } },
    requestedControls,
  }),
  /fire-actor-rebake-source-mode-mismatch/,
);
await assert.rejects(
  adapter.rebake({
    sourceMode: 'frozen',
    state: frozenState,
    requestedControls: Object.fromEntries(Object.entries(requestedControls).slice(1)),
  }),
  /fire-actor-rebake-controls-incomplete/,
);
const mutatedFrozenState = tinyState('frozen');
mutatedFrozenState.fluid[0] += 0.5;
await assert.rejects(
  adapter.rebake({
    sourceMode: 'frozen',
    state: mutatedFrozenState,
    requestedControls,
  }),
  /fire-actor-rebake-field-hash-mismatch:fluid/,
  'frozen field bytes must not retain a stale declared source identity',
);
const mutatedFrozenFront = tinyState('frozen');
mutatedFrozenFront.front[0] += 0.5;
await assert.rejects(
  adapter.rebake({
    sourceMode: 'frozen',
    state: mutatedFrozenFront,
    requestedControls,
  }),
  /fire-actor-rebake-field-hash-mismatch:front/,
  'frozen front bytes must not retain a stale declared source identity',
);
assert.throws(
  () => fireActor.fireActorRebakeControlsFromVolumeControls({ reactionBoundaryFireTip: 1.23 }),
  /fire-actor-rebake-volume-controls-incomplete/,
  'partial live controls must not be padded with analytical defaults',
);
assert.deepEqual(
  fireActor.fireActorRebakeControlsFromVolumeControls({
    reactionBoundaryFireTip: requestedControls.volume_reaction_boundary_fire_tip,
    reactionBoundaryTopology: requestedControls.volume_reaction_boundary_topology,
    reactionBoundaryFireErosion: requestedControls.volume_reaction_boundary_fire_erosion,
    reactionBoundaryCut: requestedControls.volume_reaction_boundary_cut,
    reactionBoundarySoftness: requestedControls.volume_reaction_boundary_softness,
    reactionBoundaryCoreReject: requestedControls.volume_reaction_boundary_core_reject,
    reactionBoundarySupportThermal: requestedControls.volume_reaction_boundary_support_thermal,
    reactionBoundarySupportReaction: requestedControls.volume_reaction_boundary_support_reaction,
    reactionBoundarySupportFront: requestedControls.volume_reaction_boundary_support_front,
    reactionBoundarySupportInterface: requestedControls.volume_reaction_boundary_support_interface,
    reactionBoundaryFireRidge: requestedControls.volume_reaction_boundary_fire_ridge,
    reactionBoundaryFireRidgeCut: requestedControls.volume_reaction_boundary_fire_ridge_cut,
    reactionBoundaryCurl: requestedControls.volume_reaction_boundary_curl,
    reactionBoundaryDivergence: requestedControls.volume_reaction_boundary_divergence,
  }),
  requestedControls,
);
assert.throws(
  () => fireActor.createFireActorControlRebakeAdapter({
    mount,
    readLiveState: async () => tinyState('live'),
    bakedBoundary: { authority: 'analytical-recomputed', identity: 'wrong' },
  }),
  /fire-actor-rebake-baked-boundary-invalid/,
);

console.log('FireActor control/rebake adapter contracts passed');
