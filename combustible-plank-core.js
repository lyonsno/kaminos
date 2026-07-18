export const COMBUSTIBLE_PLANK_SCHEMA = 'kaminos.combustible-structural-plank.v0';
export const COMBUSTIBLE_PLANK_ROUTE = 'kaminos.combustible-plank-support-collapse.v0';
export const COMBUSTIBLE_PLANK_SOURCE_AUTHORITY = 'internal-object-side-combustion-v0';
export const COMBUSTIBLE_PLANK_MATERIAL_AUTHORITY = 'deterministic-fuel-char-support-capacity-v0';
export const COMBUSTIBLE_PLANK_MOTION_AUTHORITY = 'post-support-loss-gravity-hinge-v0';
export const COMBUSTIBLE_OBJECT_SOURCE_SCHEMA = 'kaminos.combustible-object-source-descriptor.v0';
export const COMBUSTIBLE_OBJECT_SOURCE_PACKING = 'gpu-sparse-combustible-object-source-vec4x8-v0';

const CHAR_YIELD = 0.22;
const VOLATILE_YIELD = 0.68;
const RESIDUE_YIELD = 0.10;
const IGNITION_THRESHOLD = 0.34;
const IMPACT_ANGLE = 0.43;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
}

function cloneEvents(events) {
  return events.map(event => ({ ...event }));
}

function materialAccounting(material) {
  const accounted = material.remainingFuel + material.charMass + material.emittedVolatiles + material.inertResidue;
  const rawResidual = material.initialFuel - accounted;
  return Math.abs(rawResidual) < 5e-9 ? 0 : round(rawResidual, 9);
}

function supportCapacity(material) {
  const virginSupport = material.remainingFuel * 0.85;
  const charSupport = material.charMass * 0.25;
  return round(clamp(0.15 + virginSupport + charSupport, 0, 1));
}

function nonnegativeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 0) throw new Error(`${label} must be a nonnegative integer`);
  return integer;
}

function finiteVector(value, length, label, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  if (!Array.isArray(source) || source.length !== length) throw new Error(`${label} must contain ${length} finite values`);
  const result = source.map(Number);
  if (result.some(component => !Number.isFinite(component))) throw new Error(`${label} must contain ${length} finite values`);
  return result;
}

function identityMatrix4() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

export function deriveCombustibleObjectSourceFrame(previous, current, options = {}) {
  if (!previous?.material || !current?.material || !current?.combustion || !current?.support || !current?.motion) {
    throw new Error('Combustible object source derivation requires consecutive material states');
  }
  if (current.step <= previous.step) throw new Error('Combustible object source write tick requires a newer material state');

  const capacity = nonnegativeInteger(options.capacity ?? 1, 'Combustible object source capacity');
  if (capacity < 1) throw new Error('Combustible object source capacity must be positive');
  const allocationGeneration = nonnegativeInteger(options.allocationGeneration ?? 1, 'Combustible object source generation');
  const topologyEpoch = nonnegativeInteger(options.topologyEpoch ?? 0, 'Combustible object topology epoch');
  const writeTick = nonnegativeInteger(options.writeTick ?? current.step, 'Combustible object source write tick');
  const sourceFrameId = String(options.sourceFrameId || 'combustible-object/material-frame');
  const sourceFrameHash = nonnegativeInteger(options.sourceFrameHash ?? 1, 'Combustible object source frame hash');
  if (!sourceFrameId || sourceFrameHash === 0) throw new Error('Combustible object source frame identity is required');
  const transformId = String(options.transformId || 'combustible-object-object-to-world-v0');
  if (!transformId) throw new Error('Combustible object transform identity is required');

  const objectToWorld = finiteVector(options.objectToWorld, 16, 'Combustible object transform', identityMatrix4());
  const localSourcePosition = finiteVector(options.localSourcePosition, 3, 'Combustible object local source position', [0, 0, 0]);
  const localSourceNormal = finiteVector(options.localSourceNormal, 3, 'Combustible object local source normal', [0, 1, 0]);
  const localVelocity = finiteVector(options.localVelocity, 3, 'Combustible object local source velocity', [0, 0, 0]);
  const radius = clamp(finite(options.sourceRadius, 0.08), 0.001, 4);
  const volatileDelta = Math.max(0, finite(current.material.emittedVolatiles) - finite(previous.material.emittedVolatiles));
  const emittedFuelMass = round(volatileDelta * 0.94, 12);
  const emittedSootMass = Math.max(0, volatileDelta - emittedFuelMass);
  const emittedVolatileMass = emittedFuelMass + emittedSootMass;
  const emittedHeat = emittedVolatileMass > 0
    ? round(emittedVolatileMass * (0.75 + clamp(finite(current.material.temperature), 0, 2)), 12)
    : 0;
  const smokeSignal = emittedVolatileMass > 0 ? round(emittedSootMass * 12 + emittedFuelMass * 0.08, 12) : 0;
  const sourceCount = emittedVolatileMass > 0 ? 1 : 0;
  const packedCount = Math.min(sourceCount, capacity);
  const overflowCount = Math.max(0, sourceCount - packedCount);
  const packedFraction = sourceCount > 0 ? packedCount / sourceCount : 0;
  const packedVolatileMass = emittedVolatileMass * packedFraction;
  const overflowVolatileMass = emittedVolatileMass - packedVolatileMass;
  const sourceIdHash = sourceFrameHash >>> 0;
  const record = {
    localPositionRadius: [...localSourcePosition, radius],
    localNormalExtent: [...localSourceNormal, radius * 2],
    velocityAngular: [...localVelocity, finite(current.motion.angularVelocity)],
    emission: [emittedHeat, emittedFuelMass, emittedSootMass, smokeSignal],
    material: [
      finite(current.material.remainingFuel),
      finite(current.material.charMass),
      finite(current.material.inertResidue),
      finite(current.material.temperature),
    ],
    sourceGenerationEpochTick: [allocationGeneration, topologyEpoch, writeTick, sourceIdHash],
    support: [
      finite(current.support.capacity),
      finite(current.support.demand),
      current.support.failed ? 1 : 0,
      finite(current.motion.angleRad),
    ],
    reserved: [current.step, 0, 0, 1],
  };
  const records = packedCount > 0 ? [record] : [];
  const accountingResidualRaw = emittedVolatileMass - packedVolatileMass - overflowVolatileMass;

  return {
    schema: COMBUSTIBLE_OBJECT_SOURCE_SCHEMA,
    packing: COMBUSTIBLE_OBJECT_SOURCE_PACKING,
    materialAuthority: COMBUSTIBLE_PLANK_SOURCE_AUTHORITY,
    device: options.device ?? null,
    queue: options.queue ?? options.device?.queue ?? null,
    headerBuffer: options.headerBuffer ?? null,
    recordsBuffer: options.recordsBuffer ?? null,
    headerBytes: 80,
    recordBytes: 128,
    recordFloats: 32,
    capacity,
    allocationGeneration,
    topologyEpoch,
    materialStep: current.step,
    writeTick,
    valid: true,
    complete: true,
    sourceFrameId,
    sourceFrameHash,
    transformId,
    objectToWorld,
    sourceCount,
    packedCount,
    rejectedCount: 0,
    overflowCount,
    malformedCount: 0,
    emittedVolatileMass,
    emittedFuelMass,
    emittedSootMass,
    emittedHeat,
    packedVolatileMass,
    rejectedVolatileMass: 0,
    overflowVolatileMass,
    accountingResidual: Math.abs(accountingResidualRaw) < 1e-12 ? 0 : accountingResidualRaw,
    records,
  };
}

export function createCombustiblePlankState(options = {}) {
  const ignition = options.ignition !== false;
  const supportDemand = clamp(finite(options.supportDemand, 0.56), 0.1, 1.2);
  return {
    schema: COMBUSTIBLE_PLANK_SCHEMA,
    route: COMBUSTIBLE_PLANK_ROUTE,
    sourceAuthority: COMBUSTIBLE_PLANK_SOURCE_AUTHORITY,
    materialAuthority: COMBUSTIBLE_PLANK_MATERIAL_AUTHORITY,
    motionAuthority: COMBUSTIBLE_PLANK_MOTION_AUTHORITY,
    step: 0,
    timeSeconds: 0,
    phase: ignition ? 'heating' : 'control',
    fallback: null,
    combustion: {
      ignitionRequested: ignition,
      active: false,
      ignitionStep: null,
      burnRate: 0,
      heatInput: ignition ? 1 : 0,
    },
    material: {
      initialFuel: 1,
      remainingFuel: 1,
      temperature: 0.08,
      consumedFuel: 0,
      charMass: 0,
      emittedVolatiles: 0,
      inertResidue: 0,
      accountingResidual: 0,
    },
    support: {
      demand: round(supportDemand),
      capacity: 1,
      margin: round(1 - supportDemand),
      failed: false,
      failureStep: null,
      failureTimeSeconds: null,
      failureCause: null,
    },
    motion: {
      angleRad: 0,
      angularVelocity: 0,
      verticalDrop: 0,
      impactStep: null,
      impactTimeSeconds: null,
      impacted: false,
    },
    events: [],
  };
}

export function stepCombustiblePlank(previous, dtSeconds = 1 / 60) {
  const dt = clamp(finite(dtSeconds, 1 / 60), 1 / 1000, 0.1);
  const next = {
    ...previous,
    step: previous.step + 1,
    timeSeconds: round(previous.timeSeconds + dt),
    combustion: { ...previous.combustion },
    material: { ...previous.material },
    support: { ...previous.support },
    motion: { ...previous.motion },
    events: cloneEvents(previous.events),
  };

  const ignition = next.combustion.ignitionRequested;
  const material = next.material;
  if (ignition && material.remainingFuel > 0) {
    material.temperature = clamp(material.temperature + (1.72 - material.temperature * 0.46) * dt, 0.08, 1.35);
  } else {
    material.temperature = clamp(material.temperature - material.temperature * 0.18 * dt, 0.08, 1.35);
  }

  const activelyBurning = ignition && material.temperature >= IGNITION_THRESHOLD && material.remainingFuel > 0;
  if (activelyBurning && next.combustion.ignitionStep === null) {
    next.combustion.ignitionStep = next.step;
    next.events.push({
      kind: 'ignition',
      step: next.step,
      timeSeconds: next.timeSeconds,
      temperature: round(material.temperature),
    });
  }

  const burnRate = activelyBurning
    ? clamp((material.temperature - IGNITION_THRESHOLD + 0.16) * 0.36, 0, 0.44)
    : 0;
  const consumed = Math.min(material.remainingFuel, burnRate * dt);
  material.consumedFuel = round(material.consumedFuel + consumed, 9);
  material.remainingFuel = round(material.initialFuel - material.consumedFuel, 9);
  material.charMass = round(material.consumedFuel * CHAR_YIELD, 9);
  material.emittedVolatiles = round(material.consumedFuel * VOLATILE_YIELD, 9);
  material.inertResidue = round(material.consumedFuel * RESIDUE_YIELD, 9);
  material.temperature = round(material.temperature);
  material.accountingResidual = materialAccounting(material);

  next.combustion.active = activelyBurning;
  next.combustion.burnRate = round(burnRate);
  next.support.capacity = supportCapacity(material);
  next.support.margin = round(next.support.capacity - next.support.demand);

  let supportFailedThisStep = false;
  if (!next.support.failed && next.support.capacity < next.support.demand) {
    supportFailedThisStep = true;
    next.support.failed = true;
    next.support.failureStep = next.step;
    next.support.failureTimeSeconds = next.timeSeconds;
    next.support.failureCause = 'combustion-support-capacity-below-load-demand';
    next.phase = 'support-lost';
    next.events.push({
      kind: 'support-loss',
      step: next.step,
      timeSeconds: next.timeSeconds,
      capacity: next.support.capacity,
      demand: next.support.demand,
      remainingFuel: material.remainingFuel,
      charMass: material.charMass,
      cause: next.support.failureCause,
    });
  }

  if (next.support.failed && !next.motion.impacted && !supportFailedThisStep) {
    const acceleration = 8.1 * Math.max(0.08, Math.cos(next.motion.angleRad)) - 2.2 * next.motion.angularVelocity;
    next.motion.angularVelocity = Math.max(0, next.motion.angularVelocity + acceleration * dt);
    next.motion.angleRad += next.motion.angularVelocity * dt;
    if (next.motion.angleRad >= IMPACT_ANGLE) {
      next.motion.angleRad = IMPACT_ANGLE;
      next.motion.angularVelocity = 0;
      next.motion.impacted = true;
      next.motion.impactStep = next.step;
      next.motion.impactTimeSeconds = next.timeSeconds;
      next.phase = 'fallen';
      next.events.push({
        kind: 'impact',
        step: next.step,
        timeSeconds: next.timeSeconds,
        angleRad: IMPACT_ANGLE,
      });
    } else {
      next.phase = 'falling';
    }
  } else if (!next.support.failed) {
    next.phase = ignition ? (activelyBurning ? 'burning' : 'heating') : 'control';
  }

  next.motion.angleRad = round(next.motion.angleRad);
  next.motion.angularVelocity = round(next.motion.angularVelocity);
  next.motion.verticalDrop = round(Math.sin(next.motion.angleRad) * 3.95);
  return next;
}

export function buildCombustiblePlankWitnessScenario(options = {}) {
  const steps = Math.max(1, Math.floor(finite(options.steps, 360)));
  const dt = clamp(finite(options.dt, 1 / 60), 1 / 1000, 0.1);
  let burning = createCombustiblePlankState({ ignition: true, supportDemand: options.supportDemand });
  let control = createCombustiblePlankState({ ignition: false, supportDemand: options.supportDemand });
  const timeline = [];
  for (let step = 0; step < steps; step += 1) {
    burning = stepCombustiblePlank(burning, dt);
    control = stepCombustiblePlank(control, dt);
    if (step % 30 === 0 || burning.events.at(-1)?.step === burning.step) {
      timeline.push({
        step: burning.step,
        timeSeconds: burning.timeSeconds,
        phase: burning.phase,
        remainingFuel: burning.material.remainingFuel,
        charMass: burning.material.charMass,
        supportCapacity: burning.support.capacity,
        supportDemand: burning.support.demand,
        angleRad: burning.motion.angleRad,
      });
    }
  }
  return {
    schema: COMBUSTIBLE_PLANK_SCHEMA,
    requestedRoute: COMBUSTIBLE_PLANK_ROUTE,
    effectiveRoute: COMBUSTIBLE_PLANK_ROUTE,
    sourceAuthority: COMBUSTIBLE_PLANK_SOURCE_AUTHORITY,
    materialAuthority: COMBUSTIBLE_PLANK_MATERIAL_AUTHORITY,
    motionAuthority: COMBUSTIBLE_PLANK_MOTION_AUTHORITY,
    fallback: null,
    steps,
    dt,
    burning,
    control,
    events: cloneEvents(burning.events),
    timeline,
  };
}
