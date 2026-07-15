import { createHash } from 'node:crypto';

const BASELINE_INPUT_RADIUS = 0.68;
const MINIMUM_INPUT_RADIUS = 0.08;
const NATIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Identity(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function compareExpected(expected, effective, path, mismatches) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(effective) || expected.length !== effective.length) {
      mismatches.push(path);
      return;
    }
    expected.forEach((value, index) => compareExpected(value, effective[index], `${path}[${index}]`, mismatches));
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!effective || typeof effective !== 'object' || Array.isArray(effective)) {
      mismatches.push(path);
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      compareExpected(value, effective[key], path ? `${path}.${key}` : key, mismatches);
    }
    return;
  }
  if (!Object.is(expected, effective)) mismatches.push(path);
}

function validateCamera(camera, label = 'camera') {
  const value = requireObject(camera, label);
  for (const key of ['position', 'target']) {
    if (!Array.isArray(value[key]) || value[key].length !== 3 || value[key].some(item => !Number.isFinite(Number(item)))) {
      throw new Error(`${label}.${key} must contain three finite numbers`);
    }
  }
  for (const key of ['projectionMatrix', 'matrixWorldInverse']) {
    if (!Array.isArray(value[key]) || value[key].length !== 16 || value[key].some(item => !Number.isFinite(Number(item)))) {
      throw new Error(`${label}.${key} must contain sixteen finite numbers`);
    }
  }
  return {
    identity: 'checksum-bound-native-camera-matrices-v0',
    position: value.position.map(Number),
    target: value.target.map(Number),
    projectionMatrix: value.projectionMatrix.map(Number),
    matrixWorldInverse: value.matrixWorldInverse.map(Number),
  };
}

export function buildMinimumRadiusTeacherContract({
  heldManifest,
  heldManifestIdentity,
  requestedRoute,
  correctedInputRadius = MINIMUM_INPUT_RADIUS,
} = {}) {
  const held = requireObject(heldManifest, 'heldManifest');
  if (held.schema !== 'kaminos.volume.operator-basin-replay.v0' || held.status !== 'captured') {
    throw new Error('held manifest must be a captured operator basin replay');
  }
  if (held.grid !== 160 || held.controls?.resolution !== 160) throw new Error('held manifest must preserve the r160 grid');
  if (held.source?.effectiveRoute !== NATIVE_ROUTE) throw new Error('held manifest must preserve the native raymarch route');
  if (!String(held.source?.backend || '').startsWith('WebGPU:')) throw new Error('held manifest must preserve WebGPU backend identity');
  if (held.controls?.volumeScene !== 'tall_plume') throw new Error('held manifest must preserve the tall-plume source');
  if (!Number.isFinite(Number(held.controls?.inputRadius)) || Number(held.controls.inputRadius) !== BASELINE_INPUT_RADIUS) {
    throw new Error(`held manifest inputRadius must be ${BASELINE_INPUT_RADIUS}`);
  }
  const correctedRadius = finiteNumber(correctedInputRadius, 'correctedInputRadius');
  if (correctedRadius !== MINIMUM_INPUT_RADIUS) throw new Error(`corrected inputRadius must be ${MINIMUM_INPUT_RADIUS}`);
  const route = new URL(String(requestedRoute || ''));
  if (Number(route.searchParams.get('volume_input_radius')) !== correctedRadius) {
    throw new Error('requested route must carry the corrected volume_input_radius');
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(String(heldManifestIdentity || ''))) {
    throw new Error('held manifest identity must be checksum-bound');
  }
  const expectedControls = structuredClone(held.controls);
  expectedControls.inputRadius = correctedRadius;
  const expectedCamera = validateCamera(held.camera, 'heldManifest.camera');
  return {
    schema: 'kaminos.smoke-oracle-minimum-radius-teacher-contract.v0',
    identity: 'held-r160-single-control-radius-correction-v0',
    heldManifestIdentity,
    requestedRoute: route.href,
    effectiveRouteRequired: NATIVE_ROUTE,
    baseline: { inputRadius: BASELINE_INPUT_RADIUS },
    corrected: { inputRadius: correctedRadius },
    manifestDiff: [{ path: 'controls.inputRadius', before: BASELINE_INPUT_RADIUS, after: correctedRadius }],
    expectedControls,
    expectedCamera,
    cameraIdentity: sha256Identity(expectedCamera),
    admissionAuthority: 'machine-candidate-plus-agent-original-resolution-visual-disposition-v0',
  };
}

export function validateMinimumRadiusEffectiveState(contractValue, stateValue) {
  const contract = requireObject(contractValue, 'contract');
  const state = requireObject(stateValue, 'state');
  if (state.effectiveRoute !== contract.effectiveRouteRequired) {
    throw new Error(`effective route mismatch: ${state.effectiveRoute}`);
  }
  if (state.prototypeIdentity !== 'kaminos-volume-prototype-v0') throw new Error('prototype identity mismatch');
  if (!String(state.backend || '').startsWith('WebGPU:')) throw new Error('backend identity mismatch');
  const mismatches = [];
  compareExpected(contract.expectedControls, state.controls, 'controls', mismatches);
  if (mismatches.length) throw new Error(`minimum-radius effective state mismatch at ${mismatches.join(', ')}`);
  const camera = validateCamera(state.camera, 'state.camera');
  const cameraIdentity = sha256Identity(camera);
  if (cameraIdentity !== contract.cameraIdentity) {
    throw new Error(`camera identity mismatch: ${cameraIdentity} != ${contract.cameraIdentity}`);
  }
  return {
    ok: true,
    identity: 'minimum-radius-effective-state-parity-v0',
    effectiveRoute: state.effectiveRoute,
    prototypeIdentity: state.prototypeIdentity,
    backend: state.backend,
    cameraIdentity,
    manifestDiff: structuredClone(contract.manifestDiff),
  };
}

function normalizeProbe(probeValue, label) {
  const probe = requireObject(probeValue, label);
  const render = requireObject(probe.render, `${label}.render`);
  const support = requireObject(probe.support, `${label}.support`);
  return {
    ...probe,
    simStepCount: Math.floor(finiteNumber(probe.simStepCount, `${label}.simStepCount`)),
    render,
    support,
  };
}

export function assessMinimumRadiusMaturityCandidate({ current: currentValue, previous: previousValue } = {}) {
  const current = normalizeProbe(currentValue, 'current');
  const previous = previousValue ? normalizeProbe(previousValue, 'previous') : null;
  const pixelCount = Math.max(1, Number(current.render.width) * Number(current.render.height));
  const litFraction = Number(current.render.litPixels || 0) / pixelCount;
  const smokeFraction = Number(current.render.smokeLikePixels || 0) / pixelCount;
  const liveVoxels = Number(current.support.liveVoxels || 0);
  const smokeWeight = Number(current.support.smokeWeight || 0);
  const rise = Number(current.support.smokeVisualRiseDisplacement || 0);
  const lateral = Number(current.support.smokeVisualLateralDisplacement || 0);
  const reasons = [];
  if (litFraction <= 0.001 || smokeFraction <= 0.001) reasons.push('blank-render');
  if (!(liveVoxels > 0) || !(smokeWeight > 0)) reasons.push('missing-smoke-support');
  if (!(rise >= 0.55)) reasons.push('insufficient-rise');
  if (!(lateral >= 0.08)) reasons.push('insufficient-lateral-support');
  if (!previous) reasons.push('missing-adjacent-predecessor');
  if (previous && current.simStepCount !== previous.simStepCount + 1) reasons.push('non-adjacent-steps');
  if (previous && current.render.sha256 === previous.render.sha256) reasons.push('static-render');
  const liveDeltaFraction = previous
    ? Math.abs(liveVoxels - Number(previous.support.liveVoxels || 0)) / Math.max(1, Number(previous.support.liveVoxels || 0))
    : 0;
  const smokeDeltaFraction = previous
    ? Math.abs(smokeWeight - Number(previous.support.smokeWeight || 0)) / Math.max(1, Math.abs(Number(previous.support.smokeWeight || 0)))
    : 0;
  if (previous && Math.max(liveDeltaFraction, smokeDeltaFraction) < 0.001) reasons.push('insufficient-support-evolution');
  return {
    identity: 'minimum-radius-maturity-candidate-v0',
    candidate: reasons.length === 0,
    admitted: false,
    requiresVisualDisposition: true,
    reasons,
    previous,
    current,
    metrics: { litFraction, smokeFraction, liveVoxels, smokeWeight, rise, lateral, liveDeltaFraction, smokeDeltaFraction },
  };
}

export function admitMinimumRadiusTeacherWindow({ contract: contractValue, frames: frameValues, visualDisposition } = {}) {
  const contract = requireObject(contractValue, 'contract');
  if (!Array.isArray(frameValues) || frameValues.length < 2) throw new Error('teacher admission requires at least two frames');
  const frames = frameValues.map((frame, index) => normalizeProbe(frame, `frames[${index}]`));
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index].simStepCount !== frames[index - 1].simStepCount + 1) {
      throw new Error('teacher window must contain adjacent simulator steps');
    }
  }
  const disposition = requireObject(visualDisposition, 'visual disposition');
  if (disposition.identity !== 'agent-original-resolution-inspection-v0'
      || disposition.verdict !== 'mature-articulated-support-evolution'
      || !Array.isArray(disposition.inspectedArtifacts)
      || disposition.inspectedArtifacts.length < frames.length) {
    throw new Error('visual disposition must admit mature articulated support evolution from original-resolution artifacts');
  }
  return {
    schema: 'kaminos.smoke-oracle-minimum-radius-teacher-admission.v0',
    status: 'admitted',
    contractIdentity: contract.identity,
    heldManifestIdentity: contract.heldManifestIdentity,
    manifestDiff: structuredClone(contract.manifestDiff),
    cameraIdentity: contract.cameraIdentity,
    actualSteps: frames.map(frame => frame.simStepCount),
    visualDisposition: structuredClone(disposition),
    gaussianVerdict: null,
  };
}
