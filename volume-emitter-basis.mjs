export const VOLUME_EMITTER_BASIS_SCHEMA = 'kaminos.volume-emitter-basis.v1';

export const VOLUME_EMITTER_BASIS_IDENTITY = 'kaminos-volume-analytic-emitter-basis-v1';

export const VOLUME_EMITTER_FAMILIES = Object.freeze([
  'wick',
  'nozzle',
  'ribbon',
  'ring',
]);

export const VOLUME_EMITTER_SOURCE_LAWS = Object.freeze([
  'legacy-volume',
  'shallow-primary',
]);

const WRITABLE_FLUID_COMPONENT_INDICES = Object.freeze({
  'legacy-volume': Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15]),
  'shallow-primary': Object.freeze([0, 1, 2, 4, 5, 6]),
});

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
  return source.map((component, index) => finiteNumber(component, `${label}[${index}]`));
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

function normalize(vector, label) {
  const length = Math.sqrt(dot(vector, vector));
  if (!Number.isFinite(length) || length <= 1e-9) {
    throw new Error(`${label} must be a finite non-zero vec3`);
  }
  return scale(vector, 1 / length);
}

function orthogonalSupportAxis(direction, supportAxis) {
  const projected = subtract(supportAxis, scale(direction, dot(supportAxis, direction)));
  return normalize(projected, 'supportAxis projected perpendicular to direction');
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

function assertPointWithRadius(point, radius) {
  if (point.some(component => component - radius < -1.5 || component + radius > 1.5)) {
    throw new Error('generated emitter support exceeds volume-local analytic bounds [-1.5, 1.5]');
  }
}

function assertAnalyticBounds({ family, origin, axis, supportAxis, radius, extent }) {
  if (family === 'nozzle') {
    assertPointWithRadius(origin, radius);
    assertPointWithRadius(add(origin, scale(axis, extent)), radius);
    return;
  }
  if (family === 'wick') {
    const halfSpan = scale(axis, extent * 0.5);
    assertPointWithRadius(subtract(origin, halfSpan), radius);
    assertPointWithRadius(add(origin, halfSpan), radius);
    return;
  }
  if (family === 'ribbon') {
    const halfSpan = scale(supportAxis, extent * 0.5);
    assertPointWithRadius(subtract(origin, halfSpan), radius);
    assertPointWithRadius(add(origin, halfSpan), radius);
    return;
  }
  for (let component = 0; component < 3; component += 1) {
    const planarExtent = extent * Math.sqrt(Math.max(0, 1 - axis[component] * axis[component]));
    if (origin[component] - planarExtent - radius < -1.5
      || origin[component] + planarExtent + radius > 1.5) {
      throw new Error('generated emitter support exceeds volume-local analytic bounds [-1.5, 1.5]');
    }
  }
}

function supportFor({ family, origin, axis, supportAxis, radius, extent }) {
  if (family === 'wick') {
    return { primitive: 'analytic-capsule', origin, axis, radius, length: extent };
  }
  if (family === 'nozzle') {
    return { primitive: 'analytic-nozzle', origin, axis, radius, length: extent };
  }
  if (family === 'ribbon') {
    return {
      primitive: 'analytic-ribbon',
      origin,
      axis: supportAxis,
      injectionDirection: axis,
      radius,
      length: extent,
    };
  }
  return {
    primitive: 'analytic-annulus',
    origin,
    axis,
    radius: extent,
    tubeRadius: radius,
  };
}

export function compileVolumeEmitterFamily(request = {}) {
  const family = String(request.family || '');
  if (!VOLUME_EMITTER_FAMILIES.includes(family)) {
    throw new Error(`unsupported emitter family: ${family || 'missing-family'}`);
  }

  const origin = vec3(request.origin, 'origin', [0, -0.76, 0]);
  const requestedDirection = vec3(request.direction, 'direction', [0, 1, 0]);
  const axis = normalize(requestedDirection, 'direction');
  const radius = numberInRange(request.radius ?? 0.04, 'radius', 0.006, 0.18);
  const sourceLaw = String(request.sourceLaw ?? 'legacy-volume');
  if (!VOLUME_EMITTER_SOURCE_LAWS.includes(sourceLaw)) {
    throw new Error(`unsupported emitter source law: ${sourceLaw || 'missing-source-law'}`);
  }
  const sourceDepth = numberInRange(request.sourceDepth ?? 0.04, 'sourceDepth', 0.006, 0.36);
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

  let requestedSupportAxis = [1, 0, 0];
  let supportAxis = [1, 0, 0];
  let extent;
  let familyRequested;
  if (family === 'ring') {
    requestedSupportAxis = vec3(request.supportAxis, 'supportAxis', [1, 0, 0]);
    supportAxis = orthogonalSupportAxis(axis, requestedSupportAxis);
    extent = numberInRange(
      request.ringRadius ?? Math.max(0.24, radius * 1.5),
      'ringRadius',
      radius * 1.5,
      0.9,
    );
    familyRequested = { supportAxis: requestedSupportAxis, ringRadius: extent };
  } else {
    extent = numberInRange(request.length ?? 0.32, 'length', 0.012, 1.8);
    if (family === 'ribbon') {
      requestedSupportAxis = vec3(request.supportAxis, 'supportAxis', [1, 0, 0]);
      supportAxis = orthogonalSupportAxis(axis, requestedSupportAxis);
      familyRequested = { supportAxis: requestedSupportAxis, length: extent };
    } else {
      familyRequested = { length: extent };
    }
  }

  assertAnalyticBounds({ family, origin, axis, supportAxis, radius, extent });
  const support = supportFor({ family, origin, axis, supportAxis, radius, extent });
  const requested = {
    family,
    origin,
    direction: requestedDirection,
    radius,
    ...familyRequested,
    strength,
    velocitySpeed,
    sourceLaw,
    sourceDepth,
    chemistry,
    temporal,
    lifetime,
    frameId,
    timestampMs,
  };
  const effectiveTemporal = { ...temporal, strengthMultiplier };
  const descriptor = {
    schema: 'kaminos.volume-analytic-emitter-descriptor.v0',
    mode: 'analytic-fixed',
    family,
    coordinateSpace: 'volume-local',
    frameId,
    timestampMs,
    origin,
    axis,
    supportAxis,
    radius,
    extent,
    strength: effectiveStrength,
    velocitySpeed,
    sourceLaw,
    sourceDepth,
    chemistry,
    temporal: effectiveTemporal,
    support,
    injectedFields: sourceLaw === 'shallow-primary'
      ? ['velocity', 'smoke', 'heat', 'fuel']
      : ['velocity', 'density-carrier', 'smoke', 'heat', 'fuel', 'detail', 'flame', 'fire-detail', 'microstructure'],
    writableFluidComponentIndices: [...WRITABLE_FLUID_COMPONENT_INDICES[sourceLaw]],
    compactSupport: {
      interior: sourceLaw === 'shallow-primary' ? 'shallow-inlet' : 'full',
      transition: 'one-grid-cell-smoothstep',
      exterior: 'zero',
    },
  };

  return {
    schema: VOLUME_EMITTER_BASIS_SCHEMA,
    identity: VOLUME_EMITTER_BASIS_IDENTITY,
    family,
    requested,
    effective: {
      family,
      direction: axis,
      support,
      strength: effectiveStrength,
      velocitySpeed,
      sourceLaw,
      sourceDepth,
      chemistry,
      temporal: effectiveTemporal,
      sourceCount: 1,
    },
    descriptor,
    fallbackUsed: false,
    failures: [],
  };
}
