import {
  MANDATORY_STAGE_B_CONTROLS,
  defaultStageBControls,
  normalizeStageBControls,
  rebakeAnalyticalStageB,
} from './volume-stage-b-analytical-rebake.mjs';

export const FIRE_ACTOR_CONTROL_REBAKE_SCHEMA = 'kaminos.fire-actor-control-rebake-adapter.v0';
export const FIRE_ACTOR_CONTROL_REBAKE_RECEIPT_SCHEMA = 'kaminos.fire-actor-control-rebake-receipt.v0';
export const FIRE_ACTOR_REBAKE_CONTROL_IDS = MANDATORY_STAGE_B_CONTROLS;

const FIRE_ACTOR_MOUNT_SCHEMA = 'kaminos.fire-actor-mount.v1';
const HEX_64 = /^[0-9a-f]{64}$/;
const SOURCE_MODES = new Set(['live', 'frozen']);

const VOLUME_CONTROL_KEYS = Object.freeze({
  volume_reaction_boundary_fire_tip: 'reactionBoundaryFireTip',
  volume_reaction_boundary_topology: 'reactionBoundaryTopology',
  volume_reaction_boundary_fire_erosion: 'reactionBoundaryFireErosion',
  volume_reaction_boundary_cut: 'reactionBoundaryCut',
  volume_reaction_boundary_softness: 'reactionBoundarySoftness',
  volume_reaction_boundary_core_reject: 'reactionBoundaryCoreReject',
  volume_reaction_boundary_support_thermal: 'reactionBoundarySupportThermal',
  volume_reaction_boundary_support_reaction: 'reactionBoundarySupportReaction',
  volume_reaction_boundary_support_front: 'reactionBoundarySupportFront',
  volume_reaction_boundary_support_interface: 'reactionBoundarySupportInterface',
  volume_reaction_boundary_fire_ridge: 'reactionBoundaryFireRidge',
  volume_reaction_boundary_fire_ridge_cut: 'reactionBoundaryFireRidgeCut',
  volume_reaction_boundary_curl: 'reactionBoundaryCurl',
  volume_reaction_boundary_divergence: 'reactionBoundaryDivergence',
});

function clone(value) {
  return structuredClone(value);
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}

async function sha256Json(value) {
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
}

function validateMount(mount) {
  if (mount?.schema !== FIRE_ACTOR_MOUNT_SCHEMA || mount.status !== 'mounted') {
    throw new Error('fire-actor-rebake-mount-invalid');
  }
  if (!/^firemount-[0-9a-f]{64}$/.test(String(mount.mountId || ''))
    || !/^basinrev-[0-9a-f]{64}$/.test(String(mount.basin?.revision || ''))
    || !HEX_64.test(String(mount.sourcePackage?.sha256 || ''))) {
    throw new Error('fire-actor-rebake-mount-identity-invalid');
  }
  return mount;
}

function validateBakedBoundary(boundary) {
  if (boundary?.authority !== 'baked' || !HEX_64.test(String(boundary.identity || ''))) {
    throw new Error('fire-actor-rebake-baked-boundary-invalid');
  }
  return { authority: 'baked', identity: boundary.identity };
}

function exactControls(requested, label) {
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
    throw new Error(`fire-actor-rebake-controls-incomplete:${label}`);
  }
  const keys = Object.keys(requested);
  const missing = MANDATORY_STAGE_B_CONTROLS.filter(control => !Object.hasOwn(requested, control));
  const unknown = keys.filter(control => !MANDATORY_STAGE_B_CONTROLS.includes(control));
  if (missing.length || unknown.length || keys.length !== MANDATORY_STAGE_B_CONTROLS.length) {
    throw new Error(`fire-actor-rebake-controls-incomplete:${label}:missing=${missing.join(',')}:unknown=${unknown.join(',')}`);
  }
  const ordered = Object.fromEntries(MANDATORY_STAGE_B_CONTROLS.map(control => [control, requested[control]]));
  for (const [control, value] of Object.entries(ordered)) {
    if (!Number.isFinite(Number(value))) throw new Error(`fire-actor-rebake-control-invalid:${control}`);
  }
  return ordered;
}

function validateState(state, requestedMode) {
  if (!SOURCE_MODES.has(requestedMode)) throw new Error(`fire-actor-rebake-source-mode-invalid:${requestedMode}`);
  if (state?.source?.mode !== requestedMode) {
    throw new Error(`fire-actor-rebake-source-mode-mismatch:requested=${requestedMode}:effective=${state?.source?.mode || 'missing'}`);
  }
  if (!Number.isInteger(state.source?.simStepCount) || !state.source?.routeIdentity || !state.source?.backend) {
    throw new Error('fire-actor-rebake-source-identity-incomplete');
  }
  return state;
}

async function verifyFrozenStateHashes(state) {
  const actualFluidSha256 = await sha256Bytes(new Uint8Array(
    state.fluid.buffer,
    state.fluid.byteOffset,
    state.fluid.byteLength,
  ));
  if (actualFluidSha256 !== state.source.fluidSha256) {
    throw new Error(`fire-actor-rebake-field-hash-mismatch:fluid:declared=${state.source.fluidSha256}:actual=${actualFluidSha256}`);
  }
  const actualFrontSha256 = await sha256Bytes(new Uint8Array(
    state.front.buffer,
    state.front.byteOffset,
    state.front.byteLength,
  ));
  if (actualFrontSha256 !== state.source.frontSha256) {
    throw new Error(`fire-actor-rebake-field-hash-mismatch:front:declared=${state.source.frontSha256}:actual=${actualFrontSha256}`);
  }
}

function scalarDelta(before, after, key) {
  const beforeValue = Number(before[key]);
  const afterValue = Number(after[key]);
  return { key, before: beforeValue, after: afterValue, delta: afterValue - beforeValue };
}

function arrayDeltas(before, after, key) {
  return before[key].map((beforeValue, index) => ({
    key: `${key}[${index}]`,
    before: Number(beforeValue),
    after: Number(after[key][index]),
    delta: Number(after[key][index]) - Number(beforeValue),
  }));
}

function rebakeDeltas(before, after) {
  return {
    candidate: {
      beforeIdentity: before.candidateIdentity,
      afterIdentity: after.candidateIdentity,
      changed: before.candidateIdentity !== after.candidateIdentity,
      count: after.candidateCount - before.candidateCount,
      summary: [
        scalarDelta(before.geometrySummary, after.geometrySummary, 'candidateWeightSum'),
        scalarDelta(before.geometrySummary, after.geometrySummary, 'weightedCandidateSum'),
      ],
    },
    coefficient: {
      beforeIdentity: before.coefficientIdentity,
      afterIdentity: after.coefficientIdentity,
      changed: before.coefficientIdentity !== after.coefficientIdentity,
      summary: [
        scalarDelta(before.coefficientSummary, after.coefficientSummary, 'coefficientSum'),
        scalarDelta(before.coefficientSummary, after.coefficientSummary, 'weightedCoefficientSum'),
      ],
    },
    covariance: {
      beforeIdentity: before.covarianceIdentity,
      afterIdentity: after.covarianceIdentity,
      changed: before.covarianceIdentity !== after.covarianceIdentity,
      summary: [
        ...arrayDeltas(before.covarianceSummary, after.covarianceSummary, 'covarianceSum'),
        ...arrayDeltas(before.covarianceSummary, after.covarianceSummary, 'weightedCovarianceSum'),
      ],
    },
  };
}

function decodeFloat32(base64) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('fire-actor-rebake-source-chunk-byte-length-invalid');
  }
  return new Float32Array(bytes.buffer);
}

async function readExportField(engine, session, kind, expectedFloatCount) {
  const values = new Float32Array(expectedFloatCount);
  let startFloat = 0;
  while (startFloat < expectedFloatCount) {
    const chunk = engine.readDebugFullFieldExportChunk({ sessionId: session.sessionId, kind, startFloat });
    if (chunk?.ok !== true) throw new Error(`fire-actor-rebake-source-read-failed:${kind}:${chunk?.reason || 'unknown'}`);
    if (chunk.kind !== kind || chunk.startFloat !== startFloat || chunk.floatCount <= 0) {
      throw new Error(`fire-actor-rebake-source-chunk-invalid:${kind}:${startFloat}`);
    }
    const decoded = decodeFloat32(chunk.base64);
    if (decoded.length !== chunk.floatCount || startFloat + decoded.length > values.length) {
      throw new Error(`fire-actor-rebake-source-chunk-size-mismatch:${kind}:${startFloat}`);
    }
    values.set(decoded, startFloat);
    startFloat += decoded.length;
    if (chunk.isFinal !== (startFloat === expectedFloatCount)) {
      throw new Error(`fire-actor-rebake-source-finality-mismatch:${kind}:${startFloat}`);
    }
  }
  return values;
}

export function fireActorRebakeControlsFromVolumeControls(controls = {}) {
  const missing = MANDATORY_STAGE_B_CONTROLS.filter(control => {
    const volumeKey = VOLUME_CONTROL_KEYS[control];
    return !Object.hasOwn(controls, volumeKey) || !Number.isFinite(Number(controls[volumeKey]));
  });
  if (missing.length) {
    throw new Error(`fire-actor-rebake-volume-controls-incomplete:shape=volume-debug-controls-camel-v0:missing=${missing.join(',')}`);
  }
  return Object.fromEntries(MANDATORY_STAGE_B_CONTROLS.map(control => [control, controls[VOLUME_CONTROL_KEYS[control]]]));
}

export function createVolumeEngineStageBStateReader(engine) {
  const required = [
    'debugState',
    'setSelectiveHeadLiveCapturePaused',
    'beginDebugFullFieldExport',
    'readDebugFullFieldExportChunk',
    'releaseDebugFullFieldExport',
  ];
  for (const method of required) {
    if (typeof engine?.[method] !== 'function') throw new Error(`fire-actor-rebake-engine-api-missing:${method}`);
  }
  return async function readLiveState() {
    const before = engine.debugState();
    const wasPaused = before.selectiveHeadLiveCapturePaused === true;
    if (!wasPaused) engine.setSelectiveHeadLiveCapturePaused(true);
    let session = null;
    let stateReturned = false;
    let leaseReleased = false;
    const releaseCaptureLease = () => {
      if (leaseReleased) throw new Error('fire-actor-rebake-live-capture-lease-already-released');
      const beforeRelease = engine.debugState().simStepCount;
      if (!wasPaused) engine.setSelectiveHeadLiveCapturePaused(false);
      const afterRelease = engine.debugState().simStepCount;
      leaseReleased = true;
      return { beforeRelease, afterRelease, restoredPaused: wasPaused };
    };
    try {
      session = await engine.beginDebugFullFieldExport();
      if (session?.ok !== true || session.status !== 'captured' || session.completeFieldCoverage !== true) {
        throw new Error(`fire-actor-rebake-source-capture-failed:${session?.failurePhase || 'capture'}:${session?.reason || 'unknown'}`);
      }
      const fluid = await readExportField(engine, session, 'fluid', session.fluid.floatCount);
      const front = await readExportField(engine, session, 'front', session.front.floatCount);
      const captured = engine.debugState();
      if (captured.simStepCount !== before.simStepCount) {
        throw new Error(`fire-actor-rebake-source-advanced:${before.simStepCount}:${captured.simStepCount}`);
      }
      const fluidSha256 = await sha256Bytes(new Uint8Array(fluid.buffer, fluid.byteOffset, fluid.byteLength));
      const frontSha256 = await sha256Bytes(new Uint8Array(front.buffer, front.byteOffset, front.byteLength));
      const cameraIdentity = String(before.cameraSignature || '');
      if (!cameraIdentity) throw new Error('fire-actor-rebake-source-camera-identity-missing');
      const sourceBasis = {
        mode: 'live',
        grid: session.grid,
        fluidSha256,
        frontSha256,
        cameraIdentity,
        simStepCount: before.simStepCount,
        routeIdentity: session.routeIdentity,
        effectiveRoute: session.effectiveRoute,
        backend: session.backend,
        exportAuthority: session.authority,
        exportIdentity: session.identity,
      };
      const liveState = {
        grid: session.grid,
        fluid,
        front,
        source: {
          ...sourceBasis,
          stateId: `fireactor-live-${await sha256Json(sourceBasis)}`,
        },
        liveCaptureLease: Object.freeze({
          sourceSimStep: before.simStepCount,
          currentSimStep: () => engine.debugState().simStepCount,
          release: releaseCaptureLease,
        }),
      };
      stateReturned = true;
      return liveState;
    } finally {
      if (session?.sessionId) engine.releaseDebugFullFieldExport({ sessionId: session.sessionId });
      if (!stateReturned && !wasPaused && !leaseReleased) releaseCaptureLease();
    }
  };
}

export function validateFireActorControlRebakeReceipt(receipt, { mount, requestedControls, sourceMode } = {}) {
  const actorMount = validateMount(mount);
  if (receipt?.schema !== FIRE_ACTOR_CONTROL_REBAKE_RECEIPT_SCHEMA || receipt.status !== 'applied') {
    throw new Error('fire-actor-rebake-receipt-not-applied');
  }
  if (receipt.mountId !== actorMount.mountId
    || receipt.basinRevision !== actorMount.basin.revision
    || receipt.packageSha256 !== actorMount.sourcePackage.sha256) {
    throw new Error('fire-actor-rebake-receipt-actor-identity-mismatch');
  }
  if (receipt.source?.requestedMode !== sourceMode || receipt.source?.effectiveMode !== sourceMode) {
    throw new Error('fire-actor-rebake-receipt-source-mode-mismatch');
  }
  const orderedRequested = exactControls(requestedControls, 'receipt-requested');
  if (JSON.stringify(receipt.requestedControls) !== JSON.stringify(orderedRequested)) {
    throw new Error('fire-actor-rebake-receipt-requested-controls-mismatch');
  }
  if (receipt.boundary?.baseline?.authority !== 'baked'
    || receipt.boundary?.requested !== 'analytical-recomputed'
    || receipt.boundary?.effective !== 'analytical-recomputed') {
    throw new Error('fire-actor-rebake-receipt-boundary-authority-mismatch');
  }
  if (receipt.fallbackReason !== null || receipt.simulatorAdvanced !== false) {
    throw new Error('fire-actor-rebake-receipt-fallback-or-state-advance');
  }
  if (JSON.stringify(receipt.passes?.requested) !== JSON.stringify(receipt.passes?.applied)) {
    throw new Error('fire-actor-rebake-receipt-pass-mismatch');
  }
  return receipt;
}

export function createFireActorControlRebakeAdapter({ mount, readLiveState, bakedBoundary } = {}) {
  const actorMount = validateMount(mount);
  const baselineBoundary = validateBakedBoundary(bakedBoundary);
  if (readLiveState !== undefined && typeof readLiveState !== 'function') {
    throw new Error('fire-actor-rebake-live-source-reader-invalid');
  }
  return Object.freeze({
    schema: FIRE_ACTOR_CONTROL_REBAKE_SCHEMA,
    mountId: actorMount.mountId,
    controls: [...MANDATORY_STAGE_B_CONTROLS],
    async rebake({
      sourceMode,
      state,
      baselineControls = defaultStageBControls(),
      requestedControls,
      width = 320,
      height = 320,
    } = {}) {
      const requested = exactControls(requestedControls, 'requested');
      const baselineRequested = exactControls(baselineControls, 'baseline');
      const effective = normalizeStageBControls(requested);
      const effectiveBaseline = normalizeStageBControls(baselineRequested);
      let sourceState = state;
      if (sourceMode === 'live') {
        if (state !== undefined) throw new Error('fire-actor-rebake-live-source-state-substitution-forbidden');
        if (typeof readLiveState !== 'function') throw new Error('fire-actor-rebake-live-source-reader-missing');
        sourceState = await readLiveState();
      }
      validateState(sourceState, sourceMode);
      if (sourceMode === 'frozen') await verifyFrozenStateHashes(sourceState);
      const beforeSimStep = sourceState.source.simStepCount;
      const liveCaptureLease = sourceMode === 'live' ? sourceState.liveCaptureLease : null;
      if (sourceMode === 'live'
        && (typeof liveCaptureLease?.currentSimStep !== 'function' || typeof liveCaptureLease?.release !== 'function')) {
        throw new Error('fire-actor-rebake-live-capture-lease-missing');
      }
      let liveCaptureLeaseReleased = false;
      try {
        if (liveCaptureLease && liveCaptureLease.currentSimStep() !== beforeSimStep) {
          throw new Error('fire-actor-rebake-live-state-advanced-before-rebake');
        }
        const baseline = await rebakeAnalyticalStageB({
          state: sourceState,
          controls: baselineRequested,
          width,
          height,
        });
        const treatment = await rebakeAnalyticalStageB({
          state: sourceState,
          controls: requested,
          width,
          height,
        });
        if (baseline.receipt.sourceStateIdentity !== treatment.receipt.sourceStateIdentity) {
          throw new Error('fire-actor-rebake-source-state-drift');
        }
        if (treatment.receipt.fallback !== null || treatment.receipt.postLoadMutation !== 'analytical-rebake-only') {
          throw new Error('fire-actor-rebake-producer-authority-mismatch');
        }
        let leaseReceipt = null;
        if (liveCaptureLease) {
          if (liveCaptureLease.currentSimStep() !== beforeSimStep) {
            throw new Error('fire-actor-rebake-live-state-advanced-during-rebake');
          }
          leaseReceipt = liveCaptureLease.release();
          liveCaptureLeaseReleased = true;
          if (leaseReceipt.beforeRelease !== beforeSimStep || leaseReceipt.afterRelease !== beforeSimStep) {
            throw new Error(`fire-actor-rebake-live-state-advanced:${beforeSimStep}:${leaseReceipt.afterRelease}`);
          }
        }
        const appliedPasses = [...treatment.receipt.appliedPasses];
        const receipt = {
        schema: FIRE_ACTOR_CONTROL_REBAKE_RECEIPT_SCHEMA,
        status: 'applied',
        mountId: actorMount.mountId,
        actorId: actorMount.actorId,
        basinRevision: actorMount.basin.revision,
        packageSha256: actorMount.sourcePackage.sha256,
        requestedControls: clone(requested),
        effectiveControls: clone(effective),
        baselineControls: {
          requested: clone(baselineRequested),
          effective: clone(effectiveBaseline),
        },
        source: {
          requestedMode: sourceMode,
          effectiveMode: sourceState.source.mode,
          stateId: sourceState.source.stateId,
          sourceStateIdentity: treatment.receipt.sourceStateIdentity,
          fluidSha256: sourceState.source.fluidSha256,
          frontSha256: sourceState.source.frontSha256,
          cameraIdentity: sourceState.source.cameraIdentity,
          cameraRole: 'capture-context-not-analytical-projection',
          simStepCount: sourceState.source.simStepCount,
          routeIdentity: sourceState.source.routeIdentity,
          effectiveRoute: sourceState.source.effectiveRoute || sourceState.source.routeIdentity,
          backend: sourceState.source.backend,
          exportAuthority: sourceState.source.exportAuthority || null,
          exportIdentity: sourceState.source.exportIdentity || null,
          liveCaptureLease: leaseReceipt,
        },
        boundary: {
          baseline: clone(baselineBoundary),
          requested: 'analytical-recomputed',
          effective: 'analytical-recomputed',
        },
        deltas: rebakeDeltas(baseline.receipt, treatment.receipt),
        identities: {
          baselineStageB: baseline.receipt.stageBIdentity,
          treatmentStageB: treatment.receipt.stageBIdentity,
          deposition: treatment.receipt.depositionIdentity,
          pixels: treatment.receipt.pixelIdentity,
        },
        passes: {
          authority: 'cpu-analytical-recompute-no-gpu-command-encoding-v0',
          requested: appliedPasses,
          encoded: [],
          applied: appliedPasses,
        },
        simulatorAdvanced: sourceState.source.simStepCount !== beforeSimStep,
        fallbackReason: null,
        projection: clone(treatment.receipt.projection),
        output: clone(treatment.receipt.output),
        };
        validateFireActorControlRebakeReceipt(receipt, { mount: actorMount, requestedControls: requested, sourceMode });
        return {
          receipt,
          pixels: treatment.pixels,
          baselinePixels: baseline.pixels,
          producerReceipts: {
            baseline: baseline.receipt,
            treatment: treatment.receipt,
          },
        };
      } finally {
        if (liveCaptureLease && !liveCaptureLeaseReleased) liveCaptureLease.release();
      }
    },
  });
}
