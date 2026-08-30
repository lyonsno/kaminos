import {
  VOLUME_EMITTER_FAMILIES,
  compileVolumeEmitterFamily,
} from './volume-emitter-basis.mjs';

export const VOLUME_EMITTER_RUNTIME_SCHEMA = 'kaminos.volume-emitter-runtime.v0';

export const VOLUME_RUNTIME_EMITTER_FAMILIES = Object.freeze([
  'cluster',
  ...VOLUME_EMITTER_FAMILIES,
]);

export const VOLUME_CORE_EMITTER_SOURCE_MODES = Object.freeze([
  'cluster',
  'external-only',
]);

export function resolveVolumeCoreEmitterSource({
  mode = 'cluster',
  controlFlowRate,
  primitiveFlowRate = null,
  primitiveId = null,
} = {}) {
  const requestedMode = String(mode || '');
  if (!VOLUME_CORE_EMITTER_SOURCE_MODES.includes(requestedMode)) {
    throw new Error(`unsupported volume core emitter source mode: ${requestedMode || 'missing-mode'}`);
  }
  const requestedControlFlowRate = finiteNumber(controlFlowRate, 'controlFlowRate');
  if (requestedControlFlowRate < 0) throw new Error('controlFlowRate must be non-negative');
  const requestedPrimitiveFlowRate = primitiveFlowRate === null || primitiveFlowRate === undefined
    ? null
    : finiteNumber(primitiveFlowRate, 'primitiveFlowRate');
  if (requestedPrimitiveFlowRate !== null && requestedPrimitiveFlowRate < 0) {
    throw new Error('primitiveFlowRate must be non-negative');
  }
  const requestedOwner = requestedPrimitiveFlowRate === null ? 'control' : 'volume-primitive';
  const requestedFlowRate = requestedPrimitiveFlowRate ?? requestedControlFlowRate;
  const externalOnly = requestedMode === 'external-only';
  return {
    schema: 'kaminos.volume-core-emitter-source.v0',
    requestedMode,
    effectiveMode: requestedMode,
    requestedControlFlowRate,
    requestedPrimitiveFlowRate,
    primitiveId: requestedPrimitiveFlowRate === null ? null : String(primitiveId || ''),
    requestedOwner,
    requestedFlowRate,
    effectiveOwner: externalOnly ? 'external-emitter' : requestedOwner,
    effectiveFlowRate: externalOnly ? 0 : requestedFlowRate,
    fallbackUsed: false,
    failures: [],
  };
}

const HELD_ASSAY_CHEMISTRY = Object.freeze({
  smoke: 0.24,
  heat: 1.32,
  fuel: 0.78,
  flame: 1.16,
  detail: 0.72,
});

const HELD_ASSAY_TEMPORAL = Object.freeze({
  mode: 'steady',
  frequencyHz: 0,
  phase: 0,
  dutyCycle: 1,
});

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function requiredMethod(prototype, name) {
  if (typeof prototype?.[name] !== 'function') {
    throw new Error(`prototype.${name} is required`);
  }
}

function verifyCarrierReceipt(requested, receipt) {
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('external emitter carrier returned no receipt');
  }
  if (receipt.mode !== requested.mode) {
    throw new Error(`external emitter carrier mode mismatch: requested ${requested.mode}, effective ${receipt.mode ?? 'missing'}`);
  }
  if (receipt.count !== requested.emitters.length) {
    throw new Error(`external emitter carrier count mismatch: requested ${requested.emitters.length}, effective ${receipt.count ?? 'missing'}`);
  }
  const expectedSpace = requested.emitters.length ? 'volume-local' : 'none';
  if (receipt.coordinateSpace !== expectedSpace) {
    throw new Error(`external emitter carrier coordinate space mismatch: requested ${expectedSpace}, effective ${receipt.coordinateSpace ?? 'missing'}`);
  }
  if (receipt.frameId !== requested.frameId) {
    throw new Error(`external emitter carrier frame mismatch: requested ${requested.frameId}, effective ${receipt.frameId ?? 'missing'}`);
  }
}

function assayGeometry(family, inputRadius) {
  const radius = inputRadius * 0.2;
  if (family === 'wick') return { radius, length: inputRadius * 1.6 };
  if (family === 'nozzle') return { radius, length: inputRadius * 2.4 };
  if (family === 'ribbon') return { radius, length: inputRadius * 2.2 };
  return { radius, length: inputRadius * 1.6, ringRadius: inputRadius, ringSegments: 12 };
}

export function applyVolumeEmitterFamilyRuntime({
  prototype,
  family,
  controls,
  timestampMs = 0,
  frameId = 'emitter-runtime-frame',
  externalRequest: requestedExternalRequest = null,
} = {}) {
  requiredMethod(prototype, 'setControls');
  requiredMethod(prototype, 'setCoreEmitterSourceMode');
  requiredMethod(prototype, 'setExternalEmitters');

  const requestedFamily = String(family || '');
  if (!VOLUME_RUNTIME_EMITTER_FAMILIES.includes(requestedFamily)) {
    throw new Error(`unsupported runtime emitter family: ${requestedFamily || 'missing-family'}`);
  }
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
    throw new Error('controls must be an object');
  }
  const inputRadius = finiteNumber(controls.inputRadius, 'controls.inputRadius');
  const requestedCoreFlowRate = finiteNumber(controls.flowRate, 'controls.flowRate');
  if (inputRadius < 0.08 || inputRadius > 0.7) {
    throw new Error(`controls.inputRadius ${inputRadius} must be within [0.08, 0.7]`);
  }
  if (requestedCoreFlowRate < 0 || requestedCoreFlowRate > 4) {
    throw new Error(`controls.flowRate ${requestedCoreFlowRate} must be within [0, 4]`);
  }

  let compilerReceipt = null;
  let externalRequest;
  let effectiveControls;
  let coreSourceMode;
  if (requestedFamily === 'cluster') {
    effectiveControls = controls;
    coreSourceMode = 'cluster';
    externalRequest = requestedExternalRequest || {
      mode: 'off',
      frameId,
      timestampMs,
      coordinateSpace: 'volume-local',
      emitters: [],
    };
  } else {
    if (requestedExternalRequest !== null) {
      throw new Error(`externalRequest cannot compose with emitter family ${requestedFamily}`);
    }
    compilerReceipt = compileVolumeEmitterFamily({
      family: requestedFamily,
      origin: [0, -0.76, 0],
      direction: [0, 1, 0],
      supportAxis: [1, 0, 0],
      ...assayGeometry(requestedFamily, inputRadius),
      strength: requestedCoreFlowRate,
      velocitySpeed: 0.22,
      chemistry: HELD_ASSAY_CHEMISTRY,
      temporal: HELD_ASSAY_TEMPORAL,
      lifetime: 0.55,
      timestampMs,
      frameId,
    });
    effectiveControls = controls;
    coreSourceMode = 'external-only';
    externalRequest = compilerReceipt.carrier;
  }

  prototype.setControls(effectiveControls);
  const coreSourceReceipt = prototype.setCoreEmitterSourceMode(coreSourceMode);
  if (!coreSourceReceipt || coreSourceReceipt.requestedMode !== coreSourceMode || coreSourceReceipt.effectiveMode !== coreSourceMode) {
    throw new Error(`volume core emitter source mode mismatch: requested ${coreSourceMode}, effective ${coreSourceReceipt?.effectiveMode ?? 'missing'}`);
  }
  if (coreSourceMode === 'external-only' && coreSourceReceipt.effectiveFlowRate !== 0) {
    throw new Error(`external-only core source retained flow ${coreSourceReceipt.effectiveFlowRate}`);
  }
  const carrierReceipt = prototype.setExternalEmitters(externalRequest);
  verifyCarrierReceipt(externalRequest, carrierReceipt);

  return {
    schema: VOLUME_EMITTER_RUNTIME_SCHEMA,
    requested: {
      family: requestedFamily,
      coreFlowRate: requestedCoreFlowRate,
      inputRadius,
      frameId,
      timestampMs,
    },
    effective: {
      family: requestedFamily,
      coreFlowRate: coreSourceReceipt.effectiveFlowRate,
      externalStrength: compilerReceipt?.effective.strength ?? 0,
      externalEmitterCount: carrierReceipt.count,
      externalEmitterMode: carrierReceipt.mode,
      coordinateSpace: carrierReceipt.coordinateSpace,
    },
    compilerReceipt,
    coreSourceReceipt,
    carrierReceipt,
    fallbackUsed: false,
    failures: [],
  };
}
