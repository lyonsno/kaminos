import { performance } from 'node:perf_hooks';

export const FORCED_SPLAT_RESPONSE_SCHEMA = 'kaminos.boundary-splat-forced-response.v0';
export const FORCED_SPLAT_CONTROLS_SCHEMA = 'kaminos.boundary-splat-forced-controls.v0';
export const FORCED_SPLAT_RESPONSE_COST_SCHEMA = 'kaminos.boundary-splat-forced-response-cost.v0';
export const ANALYTICAL_FORCED_RESPONSE_IDENTITY = 'boundary-splat-analytical-age-height-forcing-warp-v0';
export const RIGID_TRANSFORMED_HISTORY_IDENTITY = 'boundary-splat-rigid-transformed-history-control-v0';
export const MAX_INITIAL_RESIDUAL_SPLINE_KNOTS = 8;
export const FORCED_SPLAT_RESPONSE_TARGET_MS = 1.0;
export const FORCED_SPLAT_RESPONSE_FIRST_FRONTIER_MS = 1.5;
export const FORCED_SPLAT_RESPONSE_STOP_CEILING_MS = 2.0;

const FORBIDDEN_INFERENCE_FLAGS = Object.freeze({
  usesDenseGridInference: false,
  usesPerSplatNeuralInference: false,
  predictsLongHorizonTurbulence: false,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

function vec3(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value)) return [...fallback];
  return [0, 1, 2].map(index => finiteNumber(value[index], fallback[index] ?? 0));
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(a, scale) {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function lengthVec(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function rotateYaw(vec, yawRadians) {
  const yaw = finiteNumber(yawRadians, 0);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    vec[0] * c - vec[2] * s,
    vec[1],
    vec[0] * s + vec[2] * c,
  ];
}

function rotateYawInverse(vec, yawRadians) {
  return rotateYaw(vec, -finiteNumber(yawRadians, 0));
}

function transformPoint(point, transform = {}) {
  const translation = vec3(transform.translation);
  const scaled = scaleVec(vec3(point), finiteNumber(transform.scale, 1));
  return add(rotateYaw(scaled, transform.yawRadians), translation);
}

function descriptorIdentity(descriptor = {}) {
  return {
    schema: String(descriptor.schema || 'unknown-instance-descriptor'),
    historySchema: String(descriptor.historySchema || descriptor.history?.schema || 'unknown-history-schema'),
    historyAuthority: String(descriptor.history?.authority || 'unknown-history-authority'),
    instanceId: String(descriptor.instanceId || 'anonymous-instance'),
  };
}

function recentForcingSummary(recentForcing = []) {
  const rows = Array.isArray(recentForcing) ? recentForcing : [];
  if (!rows.length) {
    return {
      sampleCount: 0,
      meanAccelerationWorld: [0, 0, 0],
      meanWindWorld: [0, 0, 0],
      durationSeconds: 0,
    };
  }
  let totalWeight = 0;
  const acceleration = [0, 0, 0];
  const wind = [0, 0, 0];
  for (const row of rows) {
    const weight = Math.max(0.0001, finiteNumber(row?.dtSeconds, 1 / rows.length));
    const rowAcceleration = vec3(row?.linearAccelerationWorld);
    const rowWind = vec3(row?.windWorld);
    totalWeight += weight;
    for (let index = 0; index < 3; index += 1) {
      acceleration[index] += rowAcceleration[index] * weight;
      wind[index] += rowWind[index] * weight;
    }
  }
  return {
    sampleCount: rows.length,
    meanAccelerationWorld: acceleration.map(value => value / totalWeight),
    meanWindWorld: wind.map(value => value / totalWeight),
    durationSeconds: totalWeight,
  };
}

export function buildForcedSplatResponseControls({
  descriptor = {},
  dtSeconds = 1 / 60,
  gravityWorld = [0, -9.81, 0],
  windWorld = [0, 0, 0],
  objectLinearVelocityWorld = [0, 0, 0],
  objectLinearAccelerationWorld = [0, 0, 0],
  objectAngularVelocityWorld = [0, 0, 0],
  recentForcing = [],
} = {}) {
  const transform = descriptor.transform || {};
  const yaw = finiteNumber(transform.yawRadians, 0);
  const dt = clamp(dtSeconds, 1 / 240, 1 / 10);
  const gravity = vec3(gravityWorld, [0, -9.81, 0]);
  const wind = vec3(windWorld);
  const linearVelocity = vec3(objectLinearVelocityWorld);
  const acceleration = vec3(objectLinearAccelerationWorld);
  const angularVelocity = vec3(objectAngularVelocityWorld);
  const recent = recentForcingSummary(recentForcing);
  const relativeWindWorld = sub(wind, linearVelocity);
  const gravityLocal = rotateYawInverse(gravity, yaw);
  const relativeWindLocal = rotateYawInverse(relativeWindWorld, yaw);
  const accelerationLocal = rotateYawInverse(acceleration, yaw);
  const angularVelocityLocal = rotateYawInverse(angularVelocity, yaw);
  const meanAccelerationLocal = rotateYawInverse(recent.meanAccelerationWorld, yaw);
  const accelerationLagLocal = scaleVec(add(scaleVec(accelerationLocal, -0.72), scaleVec(meanAccelerationLocal, -0.28)), dt);
  return {
    schema: FORCED_SPLAT_CONTROLS_SCHEMA,
    effectiveControlIdentity: 'object-motion-gravity-wind-source-local-forcing-v0',
    descriptorIdentity: descriptorIdentity(descriptor),
    dtSeconds: dt,
    gravityWorld: gravity,
    gravityLocal,
    windWorld: wind,
    objectLinearVelocityWorld: linearVelocity,
    objectLinearAccelerationWorld: acceleration,
    objectAngularVelocityWorld: angularVelocity,
    relativeWindWorld,
    relativeWindLocal,
    accelerationLagLocal,
    angularVelocityLocal,
    sourceAttachment: clamp(descriptor.sourceAttachment ?? 1, 0, 1),
    recentForcing: recent,
    ...FORBIDDEN_INFERENCE_FLAGS,
  };
}

export function buildRigidTransformedHistoryControl(splat = {}, descriptor = {}) {
  const canonicalPosition = vec3(splat.position);
  const highFrequencyOffset = vec3(splat.highFrequencyOffset);
  const position = transformPoint(add(canonicalPosition, highFrequencyOffset), descriptor.transform || {});
  const shape = Array.isArray(splat.shape) ? splat.shape.map(value => finiteNumber(value, 0)) : [0, 0, 0, 0];
  const colorOpacity = Array.isArray(splat.colorOpacity) ? splat.colorOpacity.map(value => finiteNumber(value, 0)) : [0, 0, 0, 0];
  return {
    responseIdentity: RIGID_TRANSFORMED_HISTORY_IDENTITY,
    descriptorIdentity: descriptorIdentity(descriptor),
    position,
    shape,
    colorOpacity,
    highFrequencyOffset,
    canonicalPosition,
    history: descriptor.history ? { ...descriptor.history } : null,
    ...FORBIDDEN_INFERENCE_FLAGS,
  };
}

export function warpBoundarySplatByForcing(splat = {}, descriptor = {}, controls = null) {
  const effectiveControls = controls || buildForcedSplatResponseControls({ descriptor });
  const rigid = buildRigidTransformedHistoryControl(splat, descriptor);
  const age = clamp(splat.age ?? splat.normalizedAge ?? 0.5, 0, 1);
  const height = clamp(splat.height ?? splat.normalizedHeight ?? Math.max(0, vec3(splat.position)[1]), 0, 1);
  const sourceAttachment = clamp(effectiveControls.sourceAttachment ?? descriptor.sourceAttachment ?? 1, 0, 1);
  const sourceAttachmentRetention = clamp(sourceAttachment * (1 - age * 0.35) * (1 - height * 0.15), 0, 1);
  const freePlume = 1 - sourceAttachmentRetention;
  const ageEase = age * age * (3 - 2 * age);
  const heightEase = height * height * (3 - 2 * height);
  const windLocal = vec3(effectiveControls.relativeWindLocal);
  const lagLocal = vec3(effectiveControls.accelerationLagLocal);
  const gravityLocal = vec3(effectiveControls.gravityLocal, [0, -9.81, 0]);
  const angularLocal = vec3(effectiveControls.angularVelocityLocal);
  const windBendLocal = scaleVec(windLocal, freePlume * (0.012 + ageEase * 0.028) * (0.35 + heightEase * 0.65));
  const lagBendLocal = scaleVec(lagLocal, (0.15 + ageEase * 0.85) * (0.35 + heightEase * 0.65));
  const buoyancyLocal = [0, Math.max(0, -gravityLocal[1]) * effectiveControls.dtSeconds * effectiveControls.dtSeconds * (0.15 + heightEase * 0.85) * (0.2 + ageEase * 0.8), 0];
  const swirlLocal = [
    angularLocal[2] * 0.0035 * ageEase * freePlume,
    0,
    -angularLocal[0] * 0.0035 * ageEase * freePlume + angularLocal[1] * 0.004 * heightEase * freePlume,
  ];
  const responseLocal = add(add(windBendLocal, lagBendLocal), add(buoyancyLocal, swirlLocal));
  const lowFrequencyResponse = rotateYaw(responseLocal, descriptor.transform?.yawRadians || 0);
  const lagMagnitude = lengthVec(lagLocal);
  const windMagnitude = lengthVec(windLocal);
  const verticalStretch = 1 + heightEase * ageEase * 0.18 + Math.min(0.20, lengthVec(add(windBendLocal, lagBendLocal)) * 1.8);
  const horizontalStretch = 1 + Math.min(0.18, windMagnitude * freePlume * 0.018);
  const opacityDamping = clamp(1 - Math.min(0.28, lagMagnitude * 0.9 + freePlume * windMagnitude * 0.006), 0.5, 1);
  const shape = [...rigid.shape];
  if (shape.length >= 2) {
    shape[0] *= horizontalStretch;
    shape[1] *= verticalStretch;
  }
  const colorOpacity = [...rigid.colorOpacity];
  if (colorOpacity.length >= 4) colorOpacity[3] *= opacityDamping;
  return {
    responseIdentity: ANALYTICAL_FORCED_RESPONSE_IDENTITY,
    descriptorIdentity: descriptorIdentity(descriptor),
    position: add(rigid.position, lowFrequencyResponse),
    canonicalPositionBeforeResponse: rigid.position,
    lowFrequencyResponse,
    lowFrequencyResponseLocal: responseLocal,
    highFrequencyOffset: rigid.highFrequencyOffset,
    sourceAttachmentRetention,
    shape,
    colorOpacity,
    controls: effectiveControls,
    ...FORBIDDEN_INFERENCE_FLAGS,
  };
}

export function buildAnalyticalForcedResponseReceipt({
  requestedRoute,
  effectiveRoute,
  descriptor = {},
  controls = null,
  splatCount = 0,
  instanceCount = 0,
  timing = null,
} = {}) {
  const effectiveControls = controls || buildForcedSplatResponseControls({ descriptor });
  return {
    schema: FORCED_SPLAT_RESPONSE_SCHEMA,
    status: 'analytical-control',
    responseIdentity: ANALYTICAL_FORCED_RESPONSE_IDENTITY,
    requestedRoute: String(requestedRoute || ANALYTICAL_FORCED_RESPONSE_IDENTITY),
    effectiveRoute: String(effectiveRoute || ANALYTICAL_FORCED_RESPONSE_IDENTITY),
    descriptorIdentity: descriptorIdentity(descriptor),
    controlIdentity: effectiveControls.effectiveControlIdentity,
    history: descriptor.history ? { ...descriptor.history } : null,
    sourceAuthority: 'canonical-history-plus-invocation-forcing',
    modelIdentity: 'none-analytical-only',
    neuralInference: {
      perSplat: false,
      denseFullGrid: false,
      longHorizonTurbulence: false,
      residualHead: 'not-admitted',
      residualSplineKnotBudget: MAX_INITIAL_RESIDUAL_SPLINE_KNOTS,
      deformationLattice: 'not-admitted',
    },
    requiredWitnessArms: [
      'rigid-transformed-history-control',
      'analytical-age-height-forcing-warp',
    ],
    splatCount: Math.max(0, Math.trunc(finiteNumber(splatCount, 0))),
    instanceCount: Math.max(0, Math.trunc(finiteNumber(instanceCount, 0))),
    timing,
    ...FORBIDDEN_INFERENCE_FLAGS,
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function measureForcedSplatResponsePath({
  descriptors = [],
  splats = [],
  forcing = {},
  instanceCounts = [1, 16, 100],
  iterations = 9,
} = {}) {
  const descriptorList = Array.isArray(descriptors) ? descriptors : [];
  const splatList = Array.isArray(splats) ? splats : [];
  const counts = (Array.isArray(instanceCounts) ? instanceCounts : [1, 16, 100])
    .map(count => Math.max(1, Math.trunc(finiteNumber(count, 1))));
  const iterationCount = Math.max(1, Math.trunc(finiteNumber(iterations, 9)));
  const rows = counts.map(instanceCount => {
    const samples = [];
    const controlSamples = [];
    const materializationSamples = [];
    let appliedSplatCount = 0;
    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      const start = performance.now();
      const controlStart = start;
      const controlRows = [];
      for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
        const descriptor = descriptorList[instanceIndex % Math.max(1, descriptorList.length)] || {};
        controlRows.push({
          descriptor,
          controls: buildForcedSplatResponseControls({ descriptor, ...forcing }),
        });
      }
      const materializationStart = performance.now();
      appliedSplatCount = 0;
      for (const { descriptor, controls } of controlRows) {
        for (const splat of splatList) {
          warpBoundarySplatByForcing(splat, descriptor, controls);
          appliedSplatCount += 1;
        }
      }
      const end = performance.now();
      controlSamples.push(materializationStart - controlStart);
      materializationSamples.push(end - materializationStart);
      samples.push(end - start);
    }
    const completeResponseMs = percentile(samples, 50);
    const controlCompressionMs = percentile(controlSamples, 50);
    const responseMaterializationMs = percentile(materializationSamples, 50);
    const p95Ms = percentile(samples, 95);
    const dominantStage = responseMaterializationMs >= controlCompressionMs
      ? 'responseMaterialization'
      : 'controlCompression';
    return {
      instanceCount,
      splatCountPerInstance: splatList.length,
      appliedSplatCount,
      samples,
      completeResponseMs,
      p95Ms,
      stageProfile: {
        controlCompressionMs,
        responseMaterializationMs,
        controlCompressionP95Ms: percentile(controlSamples, 95),
        responseMaterializationP95Ms: percentile(materializationSamples, 95),
      },
      dominantStage,
      targetMs: FORCED_SPLAT_RESPONSE_TARGET_MS,
      firstFrontierMs: FORCED_SPLAT_RESPONSE_FIRST_FRONTIER_MS,
      stopCeilingMs: FORCED_SPLAT_RESPONSE_STOP_CEILING_MS,
      status: completeResponseMs > FORCED_SPLAT_RESPONSE_STOP_CEILING_MS ? 'stop-ceiling-exceeded' : 'measured',
      effectiveRoute: ANALYTICAL_FORCED_RESPONSE_IDENTITY,
      timingAuthority: 'cpu-js-analytical-path-proxy-not-gpu-exclusive',
      ...FORBIDDEN_INFERENCE_FLAGS,
    };
  });
  return {
    schema: FORCED_SPLAT_RESPONSE_COST_SCHEMA,
    responseIdentity: ANALYTICAL_FORCED_RESPONSE_IDENTITY,
    instanceCounts: counts,
    rows,
    completePathIncludes: [
      'control-compression',
      'rigid-transformed-history-control',
      'analytical-age-height-forcing-warp',
      'position-shape-opacity-response-materialization',
    ],
    stopCeilingExceeded: rows.some(row => row.status === 'stop-ceiling-exceeded'),
    boundedRepair: rows.some(row => row.status === 'stop-ceiling-exceeded')
      ? 'WGSL response materialization over the compact boundary-splat candidate/instance buffers; keep CPU JS as an evidence proxy only and avoid object allocation in the production path.'
      : null,
    timingAuthority: 'cpu-js-analytical-path-proxy-not-gpu-exclusive',
    ...FORBIDDEN_INFERENCE_FLAGS,
  };
}
