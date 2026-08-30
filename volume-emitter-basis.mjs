export const VOLUME_EMITTER_BASIS_SCHEMA = 'kaminos.volume-emitter-basis.v0';

export const VOLUME_EMITTER_BASIS_IDENTITY = 'kaminos-volume-emitter-basis-v0';

export const VOLUME_EXTERNAL_EMITTER_CAPACITY = 32;

export const VOLUME_EMITTER_FAMILIES = Object.freeze([
  'wick',
  'nozzle',
  'ribbon',
  'ring',
]);

const DEFAULT_CHEMISTRY = Object.freeze({
  smoke: 0.24,
  heat: 1.32,
  fuel: 0.78,
  flame: 1.16,
  detail: 0.72,
});

const DEFAULT_TEMPORAL = Object.freeze({
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

function numberInRange(value, label, min, max) {
  const number = finiteNumber(value, label);
  if (number < min || number > max) {
    throw new Error(`${label} ${number} must be within [${min}, ${max}]`);
  }
  return number;
}

function vec3(value, label, fallback) {
  const source = value ?? fallback;
  if (!Array.isArray(source) || source.length !== 3) {
    throw new Error(`${label} must be a finite vec3`);
  }
  const vector = source.map((component, index) => finiteNumber(component, `${label}[${index}]`));
  return vector;
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector, label) {
  const length = Math.sqrt(dot(vector, vector));
  if (!Number.isFinite(length) || length <= 1e-9) {
    throw new Error(`${label} must be a finite non-zero vec3`);
  }
  return scale(vector, 1 / length);
}

function normalizeChemistry(value = {}) {
  const chemistry = { ...DEFAULT_CHEMISTRY, ...value };
  return {
    smoke: numberInRange(chemistry.smoke, 'chemistry.smoke', 0, 3),
    heat: numberInRange(chemistry.heat, 'chemistry.heat', 0, 4),
    fuel: numberInRange(chemistry.fuel, 'chemistry.fuel', 0, 3),
    flame: numberInRange(chemistry.flame, 'chemistry.flame', 0, 4),
    detail: numberInRange(chemistry.detail, 'chemistry.detail', 0, 3),
  };
}

function normalizeTemporal(value = {}) {
  const temporal = { ...DEFAULT_TEMPORAL, ...value };
  if (!['steady', 'pulse'].includes(temporal.mode)) {
    throw new Error(`unsupported emitter temporal mode: ${temporal.mode}`);
  }
  const frequencyHz = numberInRange(temporal.frequencyHz, 'temporal.frequencyHz', 0, 60);
  if (temporal.mode === 'pulse' && frequencyHz <= 0) {
    throw new Error('pulse temporal mode requires frequencyHz > 0');
  }
  return {
    mode: temporal.mode,
    frequencyHz,
    phase: finiteNumber(temporal.phase, 'temporal.phase'),
    dutyCycle: numberInRange(temporal.dutyCycle, 'temporal.dutyCycle', 0.01, 1),
  };
}

function temporalStrengthMultiplier(temporal, timestampMs) {
  if (temporal.mode === 'steady') return 1;
  const cycles = timestampMs * 0.001 * temporal.frequencyHz + temporal.phase / (Math.PI * 2);
  const phase01 = ((cycles % 1) + 1) % 1;
  return phase01 < temporal.dutyCycle ? 1 : 0;
}

function assertEmitterCarrierBounds(emitters) {
  const outsideCarrier = emitters.some(emitter => (
    [...emitter.start, ...emitter.end].some(component => component < -1.5 || component > 1.5)
  ));
  if (outsideCarrier) {
    throw new Error('generated emitter support exceeds volume-local carrier bounds [-1.5, 1.5]');
  }
}

function emitterRecord({
  family,
  index,
  start,
  end,
  direction,
  radius,
  strength,
  velocitySpeed,
  chemistry,
  lifetime,
}) {
  return {
    id: `emitter-basis-${family}-${index}`,
    active: true,
    start,
    end,
    velocity: scale(direction, velocitySpeed),
    radius,
    strength,
    ageSeconds: 0,
    smoke: chemistry.smoke,
    heat: chemistry.heat,
    fuel: chemistry.fuel,
    flame: chemistry.flame,
    detail: chemistry.detail,
    lifetime,
  };
}

function orthogonalSupportAxis(direction, supportAxis) {
  const projected = subtract(supportAxis, scale(direction, dot(supportAxis, direction)));
  return normalize(projected, 'supportAxis projected perpendicular to direction');
}

export function compileVolumeEmitterFamily(request = {}) {
  const family = String(request.family || '');
  if (!VOLUME_EMITTER_FAMILIES.includes(family)) {
    throw new Error(`unsupported emitter family: ${family || 'missing-family'}`);
  }

  const origin = vec3(request.origin, 'origin', [0, -0.76, 0]);
  const requestedDirection = vec3(request.direction, 'direction', [0, 1, 0]);
  const requestedSupportAxis = vec3(request.supportAxis, 'supportAxis', [1, 0, 0]);
  const direction = normalize(requestedDirection, 'direction');
  const supportAxis = ['ribbon', 'ring'].includes(family)
    ? normalize(requestedSupportAxis, 'supportAxis')
    : requestedSupportAxis;
  const radius = numberInRange(request.radius ?? 0.04, 'radius', 0.006, 0.18);
  const length = numberInRange(request.length ?? 0.32, 'length', 0.012, 1.8);
  const requestedRingRadius = finiteNumber(request.ringRadius ?? Math.max(0.24, radius * 1.5), 'ringRadius');
  const ringRadius = family === 'ring'
    ? numberInRange(requestedRingRadius, 'ringRadius', radius * 1.5, 0.9)
    : requestedRingRadius;
  const ringSegments = finiteNumber(request.ringSegments ?? 12, 'ringSegments');
  if (family === 'ring' && (!Number.isInteger(ringSegments) || ringSegments < 3)) {
    throw new Error(`ring segment count ${ringSegments} must be an integer >= 3`);
  }
  if (family === 'ring' && ringSegments > VOLUME_EXTERNAL_EMITTER_CAPACITY) {
    throw new Error(`ring segment count ${ringSegments} exceeds external emitter capacity ${VOLUME_EXTERNAL_EMITTER_CAPACITY}`);
  }
  const strength = numberInRange(request.strength ?? 1, 'strength', 0, 4);
  const velocitySpeed = numberInRange(request.velocitySpeed ?? 0.22, 'velocitySpeed', 0, 3);
  const lifetime = numberInRange(request.lifetime ?? 0.55, 'lifetime', 0.016, 8);
  const timestampMs = numberInRange(request.timestampMs ?? 0, 'timestampMs', 0, Number.MAX_SAFE_INTEGER);
  const frameId = String(request.frameId ?? `${family}-emitter-frame`).trim();
  if (!frameId) throw new Error('frameId must be a non-empty string');
  const chemistry = normalizeChemistry(request.chemistry);
  const temporal = normalizeTemporal(request.temporal);
  const strengthMultiplier = temporalStrengthMultiplier(temporal, timestampMs);
  const effectiveStrength = strength * strengthMultiplier;

  let support;
  let emitters;
  if (family === 'wick') {
    const halfSpan = scale(direction, length * 0.5);
    support = {
      primitive: 'ellipsoid-capsule',
      origin,
      axis: direction,
      radius,
      length,
    };
    emitters = [emitterRecord({
      family,
      index: 0,
      start: subtract(origin, halfSpan),
      end: add(origin, halfSpan),
      direction,
      radius,
      strength: effectiveStrength,
      velocitySpeed,
      chemistry,
      lifetime,
    })];
  } else if (family === 'nozzle') {
    support = {
      primitive: 'oriented-capsule',
      origin,
      axis: direction,
      radius,
      length,
    };
    emitters = [emitterRecord({
      family,
      index: 0,
      start: origin,
      end: add(origin, scale(direction, length)),
      direction,
      radius,
      strength: effectiveStrength,
      velocitySpeed,
      chemistry,
      lifetime,
    })];
  } else if (family === 'ribbon') {
    const halfSpan = scale(supportAxis, length * 0.5);
    support = {
      primitive: 'finite-line-capsule',
      origin,
      axis: supportAxis,
      injectionDirection: direction,
      radius,
      length,
    };
    emitters = [emitterRecord({
      family,
      index: 0,
      start: subtract(origin, halfSpan),
      end: add(origin, halfSpan),
      direction,
      radius,
      strength: effectiveStrength,
      velocitySpeed,
      chemistry,
      lifetime,
    })];
  } else {
    const ringAxisA = orthogonalSupportAxis(direction, supportAxis);
    const ringAxisB = normalize(cross(direction, ringAxisA), 'ring secondary axis');
    const points = Array.from({ length: ringSegments }, (_, index) => {
      const angle = index / ringSegments * Math.PI * 2;
      return add(origin, add(
        scale(ringAxisA, Math.cos(angle) * ringRadius),
        scale(ringAxisB, Math.sin(angle) * ringRadius),
      ));
    });
    support = {
      primitive: 'segmented-annulus',
      origin,
      axis: direction,
      supportAxis: ringAxisA,
      secondaryAxis: ringAxisB,
      radius: ringRadius,
      tubeRadius: radius,
      segmentCount: ringSegments,
    };
    emitters = points.map((start, index) => emitterRecord({
      family,
      index,
      start,
      end: points[(index + 1) % points.length],
      direction,
      radius,
      strength: effectiveStrength,
      velocitySpeed,
      chemistry,
      lifetime,
    }));
  }
  assertEmitterCarrierBounds(emitters);

  const requested = {
    family,
    origin,
    direction: requestedDirection,
    supportAxis: requestedSupportAxis,
    radius,
    length,
    ringRadius,
    ringSegments,
    strength,
    velocitySpeed,
    chemistry,
    temporal,
    lifetime,
    frameId,
    timestampMs,
  };
  const effective = {
    family,
    direction,
    support,
    strength: effectiveStrength,
    velocitySpeed,
    chemistry,
    temporal: {
      ...temporal,
      strengthMultiplier,
    },
    emitterCount: emitters.length,
  };

  return {
    schema: VOLUME_EMITTER_BASIS_SCHEMA,
    identity: VOLUME_EMITTER_BASIS_IDENTITY,
    family,
    requested,
    effective,
    fallbackUsed: false,
    failures: [],
    carrier: {
      mode: 'emitter_basis_assay',
      frameId,
      timestampMs,
      coordinateSpace: 'volume-local',
      sourceIdentity: `${VOLUME_EMITTER_BASIS_IDENTITY}:${family}`,
      emitters,
    },
  };
}
