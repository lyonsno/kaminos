export const DYNAMIC_VOLUME_SOURCE_SCHEMA = 'kaminos.volume.dynamic-sources.v0';
export const DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY = 'kaminos-dynamic-volume-source-runtime-v0';
export const DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE = 'volume-local-normalized-cube-v0';
export const DYNAMIC_VOLUME_SOURCE_MAX_COUNT = 32;
export const DYNAMIC_VOLUME_SOURCE_APPLIED_CHANNELS = Object.freeze([
  'strength',
  'smoke',
  'heat',
  'fuel',
  'flame',
  'detail',
  'velocity',
  'lifetime-snapshot-fade',
]);

const SHAPES = new Set(['sphere', 'capsule']);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:non-finite:${label}`);
  return number;
}

function rangedNumber(value, min, max, label) {
  const number = finiteNumber(value, label);
  if (number < min || number > max) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:out-of-range:${label}:${number}:supported=${min}..${max}`);
  }
  return number;
}

function vector3(value, label, { min = -1.5, max = 1.5 } = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:vec3-required:${label}`);
  }
  return value.map((component, index) => rangedNumber(component, min, max, `${label}[${index}]`));
}

function rotateXyz([x, y, z], [rx, ry, rz]) {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x1 = x;
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;
  return [x2 * cz - y2 * sz, x2 * sz + y2 * cz, z2];
}

function transformPoint(point, transform) {
  const scaled = point.map((component, index) => component * transform.scale[index]);
  const rotated = rotateXyz(scaled, transform.rotation);
  return rotated.map((component, index) => component + transform.position[index]);
}

function normalizeTransform(source) {
  const transform = source.transform && typeof source.transform === 'object' ? source.transform : {};
  return {
    position: vector3(transform.position || [0, 0, 0], `${source.id}.transform.position`),
    rotation: vector3(transform.rotation || [0, 0, 0], `${source.id}.transform.rotation`, {
      min: -Math.PI * 4,
      max: Math.PI * 4,
    }),
    scale: vector3(transform.scale || [1, 1, 1], `${source.id}.transform.scale`, { min: 0.001, max: 8 }),
  };
}

function normalizeChannels(source, sourceAgeSeconds) {
  const channels = source.channels && typeof source.channels === 'object' ? source.channels : {};
  return {
    strength: rangedNumber(channels.strength ?? 1, 0, 4, `${source.id}.channels.strength`),
    smoke: rangedNumber(channels.smoke ?? 0, 0, 3, `${source.id}.channels.smoke`),
    heat: rangedNumber(channels.heat ?? 0, 0, 4, `${source.id}.channels.heat`),
    fuel: rangedNumber(channels.fuel ?? 0, 0, 3, `${source.id}.channels.fuel`),
    flame: rangedNumber(channels.flame ?? 0, 0, 4, `${source.id}.channels.flame`),
    detail: rangedNumber(channels.detail ?? 0, 0, 3, `${source.id}.channels.detail`),
    velocity: vector3(channels.velocity || [0, 0, 0], `${source.id}.channels.velocity`, { min: -3, max: 3 }),
    lifetime: rangedNumber(channels.lifetime ?? 0.5, 0.016, 8, `${source.id}.channels.lifetime`),
    ageSeconds: rangedNumber(channels.ageSeconds ?? sourceAgeSeconds, 0, 10, `${source.id}.channels.ageSeconds`),
  };
}

function normalizeSource(source, sourceAgeSeconds) {
  if (!source || typeof source !== 'object') {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:source-record-required`);
  }
  const id = String(source.id || '').trim();
  if (!id) throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:source-id-required`);
  const ownerObjectId = String(source.ownerObjectId || '').trim();
  if (!ownerObjectId) throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:owner-object-id-required:${id}`);
  const shape = String(source.shape || '');
  if (!SHAPES.has(shape)) throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:unsupported-shape:${shape || 'missing'}`);
  const transform = normalizeTransform({ ...source, id });
  if (Math.max(...transform.scale) - Math.min(...transform.scale) > 1e-6) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:nonuniform-scale-unsupported:${id}`);
  }
  const geometry = source.geometry && typeof source.geometry === 'object' ? source.geometry : {};
  const radius = rangedNumber(
    geometry.radius,
    0.006,
    0.18,
    `${id}.geometry.radius`,
  ) * Math.max(...transform.scale.map(Math.abs));
  if (radius > 0.18) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:out-of-range:${id}.effective-radius:${radius}:supported=0.006..0.18`);
  }
  const localStart = shape === 'sphere'
    ? [0, 0, 0]
    : vector3(geometry.start, `${id}.geometry.start`, { min: -1.5, max: 1.5 });
  const localEnd = shape === 'sphere'
    ? [0, 0, 0]
    : vector3(geometry.end, `${id}.geometry.end`, { min: -1.5, max: 1.5 });
  const start = transformPoint(localStart, transform);
  const end = transformPoint(localEnd, transform);
  for (const [label, point] of [['start', start], ['end', end]]) {
    point.forEach((component, index) => rangedNumber(component, -1.5, 1.5, `${id}.effective-${label}[${index}]`));
  }
  const channels = normalizeChannels({ ...source, id }, sourceAgeSeconds);
  return {
    id,
    ownerObjectId,
    shape,
    transform,
    geometry: { ...geometry, radius },
    channels,
    effectiveSegment: { start, end, radius },
  };
}

export function normalizeDynamicVolumeSourceFrame(payload = {}, { nowMs = performance.now() } = {}) {
  if (payload.schema !== DYNAMIC_VOLUME_SOURCE_SCHEMA) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:unsupported-schema:${payload.schema || 'missing'}`);
  }
  const coordinateSpace = String(payload.coordinateSpace || '');
  if (coordinateSpace !== DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:unsupported-coordinate-space:${coordinateSpace || 'missing'}`);
  }
  const producerIdentity = String(payload.producerIdentity || '').trim();
  if (!producerIdentity) {
    throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:producer-identity-required`);
  }
  const mode = String(payload.mode || 'dynamic-volume-sources').trim() || 'dynamic-volume-sources';
  const requestedSources = Array.isArray(payload.sources) ? payload.sources : [];
  if (requestedSources.length > DYNAMIC_VOLUME_SOURCE_MAX_COUNT) {
    throw new Error(
      `${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:source-count-exceeds-runtime-capacity:${requestedSources.length}:supported=${DYNAMIC_VOLUME_SOURCE_MAX_COUNT}`,
    );
  }
  const timestampMs = rangedNumber(payload.timestampMs ?? nowMs, 0, Number.MAX_SAFE_INTEGER, 'timestampMs');
  const sourceAgeMs = Math.max(0, nowMs - timestampMs);
  const sources = requestedSources.filter(source => source?.active !== false).map(source => normalizeSource(source, sourceAgeMs / 1000));
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`${DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY}:duplicate-source-id:${source.id}`);
    ids.add(source.id);
  }
  const externalEmitterPayload = {
    mode: sources.length > 0 ? mode : 'off',
    timestampMs,
    frameId: payload.frameId ?? null,
    coordinateSpace: 'volume-local',
    emitters: sources.map(source => ({
      start: [...source.effectiveSegment.start],
      end: [...source.effectiveSegment.end],
      radius: source.effectiveSegment.radius,
      strength: source.channels.strength,
      velocity: [...source.channels.velocity],
      smoke: source.channels.smoke,
      heat: source.channels.heat,
      fuel: source.channels.fuel,
      flame: source.channels.flame,
      detail: source.channels.detail,
      lifetime: source.channels.lifetime,
      ageSeconds: source.channels.ageSeconds,
      active: true,
    })),
  };
  return {
    schema: DYNAMIC_VOLUME_SOURCE_SCHEMA,
    identity: DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY,
    producerIdentity,
    mode,
    coordinateSpace,
    frameId: payload.frameId ?? null,
    timestampMs,
    sources,
    externalEmitterPayload,
    receipt: {
      identity: DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY,
      requestedSchema: payload.schema,
      effectiveSchema: DYNAMIC_VOLUME_SOURCE_SCHEMA,
      requestedProducerIdentity: payload.producerIdentity,
      effectiveProducerIdentity: producerIdentity,
      requestedMode: payload.mode || 'dynamic-volume-sources',
      effectiveMode: sources.length > 0 ? mode : 'off',
      requestedCoordinateSpace: coordinateSpace,
      effectiveCoordinateSpace: DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE,
      requestedSourceCount: requestedSources.length,
      effectiveSourceCount: sources.length,
      sourceIds: sources.map(source => source.id),
      ownerObjectIds: sources.map(source => source.ownerObjectId),
      effectiveShapes: sources.map(source => source.shape),
      effectiveSources: sources.map(source => ({
        id: source.id,
        ownerObjectId: source.ownerObjectId,
        shape: source.shape,
        segment: structuredClone(source.effectiveSegment),
        channels: structuredClone(source.channels),
      })),
      appliedChannels: [...DYNAMIC_VOLUME_SOURCE_APPLIED_CHANNELS],
      cadenceAuthority: 'producer-frame-submission-v0',
      expiryAuthority: 'producer-refresh-or-empty-frame-v0',
      sourceAgeMs,
      frameId: payload.frameId ?? null,
    },
  };
}

export function legacyExternalEmittersToDynamicSourceFrame(payload = {}, { nowMs = performance.now() } = {}) {
  const emitters = Array.isArray(payload.emitters) ? payload.emitters : [];
  return {
    schema: DYNAMIC_VOLUME_SOURCE_SCHEMA,
    coordinateSpace: DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE,
    producerIdentity: 'legacy-external-emitter-adapter-v0',
    mode: payload.mode || 'external',
    frameId: payload.frameId ?? null,
    timestampMs: payload.timestampMs ?? nowMs,
    sources: emitters.map((emitter, index) => {
      const start = emitter?.start || [0, -0.72, 0];
      const end = emitter?.end || start;
      const shape = arraysEqual(start, end) ? 'sphere' : 'capsule';
      return {
        id: `legacy-external-emitter-${index}`,
        ownerObjectId: `legacy-external-emitter-frame-${payload.frameId ?? 'unversioned'}`,
        active: emitter?.active !== false,
        shape,
        transform: {
          position: shape === 'sphere' ? start : [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        geometry: {
          ...(shape === 'capsule' ? { start, end } : {}),
          radius: emitter?.radius ?? 0.028,
        },
        channels: {
          strength: emitter?.strength ?? 1,
          smoke: emitter?.smoke ?? 0.62,
          heat: emitter?.heat ?? 1.08,
          fuel: emitter?.fuel ?? 0.72,
          flame: emitter?.flame ?? 1.18,
          detail: emitter?.detail ?? 0.82,
          velocity: emitter?.velocity || [0, 0.18, 0],
          lifetime: emitter?.lifetime ?? 0.55,
          ageSeconds: emitter?.ageSeconds,
        },
      };
    }),
  };
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Number(value) === Number(right[index]));
}
