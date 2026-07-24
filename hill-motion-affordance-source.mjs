const EPSILON = 1e-8;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function base64ToBytes(base64) {
  const text = String(base64 || '');
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(text, 'base64'));
  const binary = globalThis.atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function fnv1a32(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function decodeFloat32Channel(name, encoded, sampleCount) {
  if (encoded?.encoding !== 'base64-f32-le') {
    throw new Error(`Hill channel ${name} must use base64-f32-le`);
  }
  const components = Array.isArray(encoded.components) && encoded.components.length > 0
    ? encoded.components.map(String)
    : ['value'];
  const expectedLength = sampleCount * components.length;
  const bytes = base64ToBytes(encoded.data);
  if (bytes.byteLength !== expectedLength * 4 || Number(encoded.byteLength) !== bytes.byteLength) {
    throw new Error(`Hill channel ${name} byte length does not match its declared shape`);
  }
  const expectedShape = components.length === 1
    ? [sampleCount]
    : [sampleCount, components.length];
  if (!Array.isArray(encoded.shape)
      || encoded.shape.length !== expectedShape.length
      || encoded.shape.some((value, index) => Number(value) !== expectedShape[index])) {
    throw new Error(`Hill channel ${name} shape does not match its declared components`);
  }
  if (String(encoded.checksum || '') !== fnv1a32(bytes)) {
    throw new Error(`Hill channel ${name} checksum mismatch`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(expectedLength);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
    if (!Number.isFinite(values[index])) {
      throw new Error(`Hill channel ${name} contains a non-finite sample`);
    }
  }
  return {
    name,
    encoding: encoded.encoding,
    components,
    componentCount: components.length,
    shape: [...encoded.shape],
    checksum: encoded.checksum ?? null,
    values,
  };
}

export function decodeHillMotionAffordancePacket({ packet, data } = {}) {
  if (packet?.schema !== 'lerms.hill-of-hills.motion-affordance-packet.v0') {
    throw new Error('Hill motion packet schema mismatch');
  }
  if (data?.schema !== 'lerms.hill-of-hills.motion-affordance-data.v0') {
    throw new Error('Hill motion data schema mismatch');
  }
  if (packet.ok !== true
      || packet.status !== 'fresh-live-motion-affordance'
      || packet.route !== 'lerms/hill-of-hills/motion-affordance-packet-file'
      || packet.source?.route !== packet.route) {
    throw new Error('Hill motion route identity mismatch');
  }
  if (packet.source?.authority !== 'live_simulation'
      || data.sourceTruth?.authority !== 'live_simulation') {
    throw new Error('Hill motion source must retain live simulation authority');
  }
  if (packet.frameId !== data.sourceTruth.frameId
      || data.sourceTruth.route !== 'hill-of-hills/motion-affordance-packet'
      || packet.source?.backend !== data.sourceTruth.backend
      || packet.source?.configId !== data.sourceTruth.configId
      || packet.source?.configId !== 'hill-of-hills-motion-affordance-packet-v0') {
    throw new Error('Hill motion source truth identity mismatch');
  }
  const embedded = packet.motionAffordanceData;
  if (embedded?.schema !== data.schema
      || embedded?.sourceTruth?.frameId !== data.sourceTruth.frameId
      || embedded?.sourceTruth?.backend !== data.sourceTruth.backend
      || embedded?.sourceTruth?.configId !== data.sourceTruth.configId
      || JSON.stringify(embedded?.checksums) !== JSON.stringify(data.checksums)) {
    throw new Error('Hill packet and motion data identity disagree');
  }
  const columns = Number(data.grid?.columns);
  const rows = Number(data.grid?.rows);
  const sampleCount = Number(data.grid?.sampleCount);
  if (!Number.isInteger(columns) || !Number.isInteger(rows)
      || columns < 2 || rows < 2 || sampleCount !== columns * rows) {
    throw new Error('Hill motion data grid is incomplete');
  }
  const spacingX = Number(data.grid.spacing?.x);
  const spacingZ = Number(data.grid.spacing?.z);
  if (!(spacingX > 0) || !(spacingZ > 0)) {
    throw new Error('Hill motion data grid spacing must be finite and positive');
  }
  const worldBounds = structuredClone(data.worldBounds);
  const bounds = [
    Number(worldBounds?.x?.min),
    Number(worldBounds?.x?.max),
    Number(worldBounds?.y?.min),
    Number(worldBounds?.y?.max),
    Number(worldBounds?.z?.min),
    Number(worldBounds?.z?.max),
  ];
  if (!bounds.every(Number.isFinite)
      || bounds[1] <= bounds[0]
      || bounds[3] <= bounds[2]
      || bounds[5] <= bounds[4]) {
    throw new Error('Hill motion data world bounds must be finite and non-empty');
  }
  const expectedSpacingX = (bounds[1] - bounds[0]) / (columns - 1);
  const expectedSpacingZ = (bounds[5] - bounds[4]) / (rows - 1);
  if (Math.abs(spacingX - expectedSpacingX) > 1e-12
      || Math.abs(spacingZ - expectedSpacingZ) > 1e-12) {
    throw new Error('Hill motion data grid spacing disagrees with world bounds');
  }
  const channelLayout = Array.isArray(data.channelLayout) ? data.channelLayout.map(String) : [];
  if (channelLayout.length === 0 || new Set(channelLayout).size !== channelLayout.length) {
    throw new Error('Hill motion data requires a unique channel layout');
  }
  const channels = Object.fromEntries(channelLayout.map(name => [
    name,
    decodeFloat32Channel(name, data.channels?.[name], sampleCount),
  ]));
  if (!channels.height) throw new Error('Hill motion data requires a height channel');
  return {
    schema: 'kaminos.motion-terrain-affordance-source.v0',
    sourceRef: packet.source.sourceRef,
    route: packet.source.route,
    authority: packet.source.authority,
    backend: packet.source.backend ?? null,
    configId: packet.source.configId ?? null,
    producerSurface: packet.source.producerSurface,
    intendedConsumerSurface: packet.source.intendedConsumerSurface,
    intentEvidenceOnly: data.intentEvidenceOnly === true,
    grid: {
      columns,
      rows,
      sampleCount,
      spacing: {
        x: spacingX,
        z: spacingZ,
      },
    },
    worldBounds,
    channels,
  };
}

function normalize3(vector) {
  const magnitude = Math.hypot(...vector);
  if (!(magnitude > EPSILON)) return [0, 1, 0];
  return vector.map(value => value / magnitude);
}

export function sampleHillTerrainSurface(source, worldXInput, worldZInput) {
  const columns = Number(source?.grid?.columns);
  const rows = Number(source?.grid?.rows);
  const heights = source?.channels?.height?.values;
  const xMin = Number(source?.worldBounds?.x?.min);
  const xMax = Number(source?.worldBounds?.x?.max);
  const zMin = Number(source?.worldBounds?.z?.min);
  const zMax = Number(source?.worldBounds?.z?.max);
  if (columns < 2 || rows < 2 || !heights || heights.length < columns * rows
      || ![xMin, xMax, zMin, zMax].every(Number.isFinite)) {
    throw new Error('Hill terrain source is incomplete');
  }
  const worldX = Number(worldXInput);
  const worldZ = Number(worldZInput);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new Error('Hill terrain sample coordinates must be finite');
  }
  const gridX = (worldX - xMin) / (xMax - xMin) * (columns - 1);
  const gridZ = (worldZ - zMin) / (zMax - zMin) * (rows - 1);
  const clampedX = clamp(gridX, 0, columns - 1);
  const clampedZ = clamp(gridZ, 0, rows - 1);
  const column0 = Math.min(columns - 2, Math.floor(clampedX));
  const row0 = Math.min(rows - 2, Math.floor(clampedZ));
  const column1 = column0 + 1;
  const row1 = row0 + 1;
  const tx = clampedX - column0;
  const tz = clampedZ - row0;
  const at = (column, row) => {
    const value = Number(heights[row * columns + column]);
    if (!Number.isFinite(value)) throw new Error('Hill terrain source contains non-finite height');
    return value;
  };
  const near = mix(at(column0, row0), at(column1, row0), tx);
  const far = mix(at(column0, row1), at(column1, row1), tx);
  const height = mix(near, far, tz);
  const cellWidth = (xMax - xMin) / (columns - 1);
  const cellDepth = (zMax - zMin) / (rows - 1);
  const dhdx = mix(
    at(column1, row0) - at(column0, row0),
    at(column1, row1) - at(column0, row1),
    tz,
  ) / Math.max(EPSILON, cellWidth);
  const dhdz = mix(
    at(column0, row1) - at(column0, row0),
    at(column1, row1) - at(column1, row0),
    tx,
  ) / Math.max(EPSILON, cellDepth);
  return {
    schema: 'kaminos.hill-terrain-surface-sample.v0',
    world: [worldX, height, worldZ],
    height,
    normal: normalize3([-dhdx, 1, -dhdz]),
    grid: [clampedX, clampedZ],
    inBounds: gridX >= 0 && gridX <= columns - 1 && gridZ >= 0 && gridZ <= rows - 1,
  };
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3
      || value.some(component => !Number.isFinite(Number(component)))) {
    throw new Error(`${label} must be a finite vec3`);
  }
  return value.map(Number);
}

export function validateAxialCrawlerRegistration(registration) {
  if (registration?.schema !== 'kaminos.axial-crawler-registration.v0') {
    throw new Error('registration schema must be kaminos.axial-crawler-registration.v0');
  }
  const forward = requireVector3(registration.localForwardAxis, 'local forward axis');
  const up = requireVector3(registration.localUpAxis, 'local up axis');
  if (forward[0] !== 0 || forward[1] !== 0 || forward[2] !== -1
      || up[0] !== 0 || up[1] !== 1 || up[2] !== 0) {
    throw new Error('axial crawler registration must use -Z forward and +Y up');
  }
  const spineStations = registration.spineStations.map(station => ({
    id: String(station.id || ''),
    t: Number(station.t),
    localPosition: requireVector3(station.localPosition, `spine station ${station.id || '?'}`),
  }));
  if (spineStations.length !== 7) throw new Error('registration must contain exactly seven spine stations');
  for (let index = 1; index < spineStations.length; index += 1) {
    if (spineStations[index].localPosition[2] >= spineStations[index - 1].localPosition[2]) {
      throw new Error('spine stations must advance from tail to head along -Z');
    }
  }
  const tailZ = spineStations[0].localPosition[2];
  const headZ = spineStations.at(-1).localPosition[2];
  return {
    ...registration,
    localForwardAxis: forward,
    localUpAxis: up,
    spineStations,
    contactPlaneY: Number(registration.contactPlaneY),
    tailZ,
    headZ,
    axialSpan: tailZ - headZ,
  };
}
