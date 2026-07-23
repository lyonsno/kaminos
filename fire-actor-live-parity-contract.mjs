const DESCRIPTOR_SCHEMA = 'kaminos.fire-actor-live-parity-descriptor.v1';
const RECEIPT_SCHEMA = 'kaminos.fire-actor-live-parity-receipt.v1';
const REQUIRED_GPU_TIMING_STAGES = Object.freeze([
  'simulation',
  'sidecar',
  'compaction',
  'finalize',
  'candidateCopy',
  'indirectSetup',
  'splatRaster',
  'matchedRaymarchRaster',
  'total',
]);

export const FIRE_ACTOR_LIVE_PARITY_ARMS = Object.freeze(['splats', 'smoke', 'composite']);

export const FIRE_ACTOR_LIVE_PARITY_IDENTITY = Object.freeze({
  basinHandle: 'big-raymarch-hero-flamebowl-cotangent-covariance',
  basinRevision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95',
  packageSha256: 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc',
  engineSourceCommit: 'a556596a6ea1102bcd5bc287bf4c6645ce8e39f3',
  engineSha256: '1c934fc7cc2b1aea2c3b4410e97e97f701045b188a2ef19236a1345c49cba63d',
});

const ARM_PRESENTATION = Object.freeze({
  splats: Object.freeze({ smoke: 'off', splats: 'on', composition: 'splat-only-v0' }),
  smoke: Object.freeze({ smoke: 'on', splats: 'off', composition: 'smoke-raymarch-only-v0' }),
  composite: Object.freeze({ smoke: 'on', splats: 'on', composition: 'smoke-raymarch-under-splats-v0' }),
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function parityBasis() {
  return {
    schema: DESCRIPTOR_SCHEMA,
    basin: {
      handle: FIRE_ACTOR_LIVE_PARITY_IDENTITY.basinHandle,
      revision: FIRE_ACTOR_LIVE_PARITY_IDENTITY.basinRevision,
      packageSha256: FIRE_ACTOR_LIVE_PARITY_IDENTITY.packageSha256,
    },
    engine: {
      sourceCommit: FIRE_ACTOR_LIVE_PARITY_IDENTITY.engineSourceCommit,
      sha256: FIRE_ACTOR_LIVE_PARITY_IDENTITY.engineSha256,
    },
    state: {
      targetSimStep: 120,
      pauseAuthority: 'renderer-internal-exact-sim-step-pause-gpu-complete-v0',
      controlsSignature: 'vsp-0654d9edacf7215f6eaaae4bab5599873a34c877c4bcd8a1eabeeeef31147d5c',
      deterministicClock: {
        authority: 'same-route-controls-fixed-step-replay',
        startNowMs: 1000,
        stepDeltaMs: 1000 / 30,
      },
    },
    camera: {
      type: 'PerspectiveCamera',
      fov: 40,
      near: 0.01,
      far: 100,
      position: [1.65, 0.42, 3.15],
      target: [0, 0.08, 0],
      up: [0, 1, 0],
    },
    actor: {
      transform: { translate: [0, 0, 0], scale: 1 },
    },
    presentation: {
      arms: structuredClone(ARM_PRESENTATION),
      toneMap: 'shared-contribution-sum-then-global-exponential-v0',
      displayTransfer: 'global-exposure-vignette-gamma-temporal-resolve-v0',
    },
    controls: { basin: 186, renderer: 3 },
  };
}

export async function createFireActorLiveParityDescriptor() {
  const basis = parityBasis();
  return Object.freeze({ ...basis, descriptorId: `fireparity-${await sha256(canonicalJson(basis))}` });
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameCamera(left, right) {
  const close = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-9;
  const closeArray = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => close(value, b[index]));
  return left?.type === right?.type
    && close(left?.fov, right?.fov)
    && close(left?.near, right?.near)
    && close(left?.far, right?.far)
    && closeArray(left?.position, right?.position)
    && closeArray(left?.target, right?.target)
    && closeArray(left?.up, right?.up);
}

export function validateFireActorLiveParityReceipt(receipt, descriptor) {
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA || receipt.status !== 'effective') {
    throw new Error('live parity receipt is not effective');
  }
  if (receipt.descriptorId !== descriptor.descriptorId || !same(receipt.basin, descriptor.basin) || !same(receipt.engine, descriptor.engine)) {
    throw new Error('live parity route identity mismatch');
  }
  if (receipt.state?.requestedSimStep !== descriptor.state.targetSimStep
    || receipt.state?.effectiveSimStep !== descriptor.state.targetSimStep) {
    throw new Error('live parity simulation step mismatch');
  }
  if (receipt.state?.paused !== true || receipt.state?.gpuComplete !== true
    || receipt.state?.pauseAuthority !== descriptor.state.pauseAuthority) {
    throw new Error('live parity requires an exact GPU-complete pause');
  }
  if (receipt.state?.controlsSignature !== descriptor.state.controlsSignature) {
    throw new Error('live parity controls signature mismatch');
  }
  if (!same(receipt.state?.deterministicClock, descriptor.state.deterministicClock)) {
    throw new Error('live parity deterministic clock mismatch');
  }
  if (!sameCamera(receipt.camera, descriptor.camera)) {
    throw new Error(`live parity camera mismatch: requested ${canonicalJson(descriptor.camera)}, effective ${canonicalJson(receipt.camera)}`);
  }
  if (!same(receipt.actor, descriptor.actor)) throw new Error('live parity actor transform mismatch');
  const arm = receipt.presentation?.arm;
  if (!FIRE_ACTOR_LIVE_PARITY_ARMS.includes(arm) || !same(receipt.presentation, { arm, ...descriptor.presentation.arms[arm] })) {
    throw new Error('live parity presentation arm mismatch');
  }
  if (!receipt.viewport || receipt.viewport.cssWidth <= 0 || receipt.viewport.cssHeight <= 0
    || receipt.viewport.backingWidth <= 0 || receipt.viewport.backingHeight <= 0 || receipt.viewport.dpr <= 0) {
    throw new Error('live parity viewport receipt is incomplete');
  }
  if (!same(receipt.controls, descriptor.controls)) throw new Error('live parity control coverage mismatch');
  if (receipt.fallbackReason !== null) throw new Error(`live parity fallback is forbidden: ${receipt.fallbackReason}`);
  const gpuTiming = receipt.gpuStageTiming;
  const presentationUsesSplats = receipt.presentation.splats === 'on';
  const presentationUsesRaymarch = receipt.presentation.smoke === 'on';
  const expectedSample = {
    authority: 'same-state-selective-render-composition-gpu-timestamp-v0',
    arm,
    simStepCount: receipt.state.effectiveSimStep,
    advanceSim: false,
    presentation: receipt.presentation,
  };
  const expectedStageStatus = stage => {
    if (stage === 'simulation') return 'not-run-frozen-state';
    if (stage === 'candidateCopy') return 'removed';
    if (['compaction', 'finalize', 'indirectSetup', 'splatRaster'].includes(stage)) {
      return presentationUsesSplats ? 'sampled' : 'not-requested-by-presentation';
    }
    if (stage === 'matchedRaymarchRaster') {
      return presentationUsesRaymarch ? 'sampled' : 'not-requested-by-presentation';
    }
    return 'sampled';
  };
  if (gpuTiming?.identity !== 'selective-head-live-arm-gpu-timestamp-profile-v0'
    || gpuTiming.timestampStatus !== 'available'
    || gpuTiming.reason !== 'timestamp-query-sampled'
    || !same(gpuTiming.sample, expectedSample)
    || REQUIRED_GPU_TIMING_STAGES.some(stage => gpuTiming.stages?.[stage]?.status !== expectedStageStatus(stage)
      || !Number.isFinite(gpuTiming.stages?.[stage]?.ms)
      || gpuTiming.stages[stage].ms < 0)) {
    if (gpuTiming && !same(gpuTiming.sample, expectedSample)) {
      throw new Error('live parity GPU stage timing sample does not match the effective arm and step');
    }
    throw new Error('live parity GPU stage timing is missing or unsampled');
  }
  return receipt;
}

export function fireActorLiveParityPresentation(arm) {
  if (!FIRE_ACTOR_LIVE_PARITY_ARMS.includes(arm)) throw new Error(`unknown live parity presentation arm: ${arm}`);
  return { arm, ...ARM_PRESENTATION[arm] };
}
