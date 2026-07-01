export const LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA = 'lerms.world-finger-juice-emitters.v0';
export const LERMS_WORLD_FINGER_JUICE_ROUTE = 'world-space-ballistic-surface-flow-particles-v0';
export const LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT = 'hill-of-hills-heightfield-collision-v0';
export const LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT = 'finger-aim-ballistic-arc-range-v0';
export const FINGER_JUICE_SUPPORT_FRAME_SCHEMA = 'big-papa-finger-juice.support-frame.v0';
export const FINGER_JUICE_RESERVOIR_DIAGNOSTICS_SCHEMA = 'big-papa-finger-juice.substrate-reservoir-diagnostics.v0';
export const FINGER_JUICE_PREVIEW_BENCH_PAYLOAD_SCHEMA = 'big-papa-finger-juice.preview-bench-payload.v0';
export const FINGER_JUICE_HOST_PACKET_SCHEMA = 'big-papa-finger-juice.host-packet.v0';
export const FINGER_JUICE_HOST_PACKET_ROUTE = 'big-papa/finger-juice/host-packet';
export const FINGER_JUICE_HOST_RENDER_PAYLOAD_PREVIEW_SCHEMA = 'big-papa-finger-juice.render-payload.preview.v0';
export const HILL_OF_HILLS_PREVIEW_BENCH_PAYLOAD_SCHEMA = 'lerms.hill-of-hills.preview-bench-payload.v0';
export const FINGER_JUICE_HILL_SUPPORT_FRAME_INGESTION_CONTRACT = 'hill-preview-bench-support-frame-ingestion-v0';
export const HILL_OF_HILLS_TERRAIN_SAMPLE_PACKET_SCHEMA = 'kaminos.preview-bench.terrain-sample-packet.v0';
export const HILL_OF_HILLS_TERRAIN_SAMPLE_DATA_SCHEMA = 'lerms.hill-of-hills.terrain-sample-data.v0';
export const FINGER_JUICE_TERRAIN_SAMPLE_SURFACE_SCHEMA = 'big-papa-finger-juice.terrain-sample-surface.v0';
export const FINGER_JUICE_HILL_TERRAIN_SAMPLE_INGESTION_CONTRACT = 'hill-terrain-sample-collision-ingestion-v0';
export const LERMS_WORLD_FINGER_JUICE_AUTHORITY_VALUES = [
  'live_simulation',
  'synthetic_fixture',
  'visual_only',
  'stale_hold',
  'invalid',
];

const DEFAULT_FINGER_IDS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const DEFAULT_CHEMISTRY = {
  thumb: 'splash',
  index: 'knockback',
  middle: 'pooling',
  ring: 'weird',
  pinky: 'weird',
};
const DEFAULT_TIP_INDEX = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
};
const SUPPORT_GRID_X = 80;
const SUPPORT_GRID_Z = 120;
const SUPPORT_WORLD_BOUNDS = Object.freeze({
  x: Object.freeze({ min: -0.75, max: 0.75 }),
  z: Object.freeze({ min: -0.95, max: 2.25 }),
});
const SUPPORT_TILE_CELLS = Object.freeze({ x: 8, z: 8 });
const LOCAL_COLLISION_DOWNGRADE = 'fluid_collision_heightfield_still_local_procedural';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function vec3(value, fallback = [0, 0, 0]) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value.x, value.y, value.z]
      : fallback;
  return [
    finite(raw[0], fallback[0] || 0),
    finite(raw[1], fallback[1] || 0),
    finite(raw[2], fallback[2] || 0),
  ];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function length3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize3(value, fallback = [0, 0.34, 0.94]) {
  const source = vec3(value, fallback);
  const len = length3(source);
  if (len < 0.00001) return normalize3(fallback, [0, 0, 1]);
  return [source[0] / len, source[1] / len, source[2] / len];
}

function axisVec3(value) {
  const out = value.map(component => round(component, 4));
  out.x = out[0];
  out.y = out[1];
  out.z = out[2];
  return out;
}

function optionalVec2(value) {
  if (!value || typeof value !== 'object') return null;
  const x = finite(Array.isArray(value) ? value[0] : value.x, NaN);
  const y = finite(Array.isArray(value) ? value[1] : value.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round(x, 4), y: round(y, 4) };
}

function stringOrNull(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function checksumString(input) {
  let hash = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(value => value !== undefined && value !== null && value !== '').map(String))];
}

function supportCellForWorld(position) {
  const p = vec3(position);
  const u = clamp((p[0] - SUPPORT_WORLD_BOUNDS.x.min) / (SUPPORT_WORLD_BOUNDS.x.max - SUPPORT_WORLD_BOUNDS.x.min), 0, 1);
  const v = clamp((p[2] - SUPPORT_WORLD_BOUNDS.z.min) / (SUPPORT_WORLD_BOUNDS.z.max - SUPPORT_WORLD_BOUNDS.z.min), 0, 1);
  return {
    x: Math.max(0, Math.min(SUPPORT_GRID_X - 1, Math.floor(u * SUPPORT_GRID_X))),
    z: Math.max(0, Math.min(SUPPORT_GRID_Z - 1, Math.floor(v * SUPPORT_GRID_Z))),
    u: round(u, 5),
    v: round(v, 5),
  };
}

function domainBoundsFromCells(cells) {
  const xs = cells.map(cell => cell.x);
  const zs = cells.map(cell => cell.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    u: {
      min: round(minX / SUPPORT_GRID_X, 5),
      max: round((maxX + 1) / SUPPORT_GRID_X, 5),
    },
    v: {
      min: round(minZ / SUPPORT_GRID_Z, 5),
      max: round((maxZ + 1) / SUPPORT_GRID_Z, 5),
    },
  };
}

function worldBoundsFromDomain(domainBounds) {
  return {
    x: {
      min: round(SUPPORT_WORLD_BOUNDS.x.min + domainBounds.u.min * (SUPPORT_WORLD_BOUNDS.x.max - SUPPORT_WORLD_BOUNDS.x.min), 4),
      max: round(SUPPORT_WORLD_BOUNDS.x.min + domainBounds.u.max * (SUPPORT_WORLD_BOUNDS.x.max - SUPPORT_WORLD_BOUNDS.x.min), 4),
    },
    z: {
      min: round(SUPPORT_WORLD_BOUNDS.z.min + domainBounds.v.min * (SUPPORT_WORLD_BOUNDS.z.max - SUPPORT_WORLD_BOUNDS.z.min), 4),
      max: round(SUPPORT_WORLD_BOUNDS.z.min + domainBounds.v.max * (SUPPORT_WORLD_BOUNDS.z.max - SUPPORT_WORLD_BOUNDS.z.min), 4),
    },
  };
}

export function createFingerJuiceSupportFrame(options = {}) {
  const stepCount = Math.max(0, Math.floor(finite(options.stepCount, 0)));
  const cellSize = {
    x: round((SUPPORT_WORLD_BOUNDS.x.max - SUPPORT_WORLD_BOUNDS.x.min) / SUPPORT_GRID_X, 5),
    z: round((SUPPORT_WORLD_BOUNDS.z.max - SUPPORT_WORLD_BOUNDS.z.min) / SUPPORT_GRID_Z, 5),
  };
  const supportFrameSeed = JSON.stringify({
    schema: FINGER_JUICE_SUPPORT_FRAME_SCHEMA,
    supportClass: 'single_valued_heightfield',
    mappingMode: 'static_domain_to_world',
    stepCount,
    grid: [SUPPORT_GRID_X, SUPPORT_GRID_Z],
    bounds: SUPPORT_WORLD_BOUNDS,
  });
  return {
    schema: FINGER_JUICE_SUPPORT_FRAME_SCHEMA,
    supportClass: 'single_valued_heightfield',
    mappingMode: 'static_domain_to_world',
    domainBounds: { u: { min: 0, max: 1 }, v: { min: 0, max: 1 } },
    worldBounds: SUPPORT_WORLD_BOUNDS,
    supportEpoch: stepCount,
    topologyEpoch: 0,
    substrateCellCount: SUPPORT_GRID_X * SUPPORT_GRID_Z,
    substrateGrid: { x: SUPPORT_GRID_X, z: SUPPORT_GRID_Z, cellSize },
    substrateTileSize: SUPPORT_TILE_CELLS,
    substrateTileCount: Math.ceil(SUPPORT_GRID_X / SUPPORT_TILE_CELLS.x) * Math.ceil(SUPPORT_GRID_Z / SUPPORT_TILE_CELLS.z),
    dirtySubstrateTileCount: 0,
    dirtySubstrateSampleCount: 0,
    dirtySubstrateRegionChecksum: 'none',
    minSupportWavelength: round(Math.max(cellSize.x, cellSize.z) * 3, 5),
    maxHeightDelta: 0,
    maxSurfaceSpeed: 0,
    motionClassCounts: { stable: SUPPORT_GRID_X * SUPPORT_GRID_Z, phase_morph: 0, shock_reset: 0 },
    shockClassCounts: { none: SUPPORT_GRID_X * SUPPORT_GRID_Z, shock_reset: 0 },
    supportFrameChecksum: checksumString(supportFrameSeed),
  };
}

function hillPayloadFromReport(report) {
  if (!report || typeof report !== 'object') return null;
  if (report.schema === HILL_OF_HILLS_PREVIEW_BENCH_PAYLOAD_SCHEMA) return report;
  const payload = report.payload;
  return payload?.schema === HILL_OF_HILLS_PREVIEW_BENCH_PAYLOAD_SCHEMA ? payload : null;
}

function terrainSamplePacketFromReport(report) {
  if (!report || typeof report !== 'object') return null;
  if (report.schema === HILL_OF_HILLS_TERRAIN_SAMPLE_PACKET_SCHEMA) return report;
  const payload = report.payload || report.terrainSamplePacket;
  return payload?.schema === HILL_OF_HILLS_TERRAIN_SAMPLE_PACKET_SCHEMA ? payload : null;
}

function terrainSampleDataFromReport(report) {
  if (!report || typeof report !== 'object') return null;
  if (report.schema === HILL_OF_HILLS_TERRAIN_SAMPLE_DATA_SCHEMA) return report;
  const payload = report.payload || report.terrainSampleData;
  return payload?.schema === HILL_OF_HILLS_TERRAIN_SAMPLE_DATA_SCHEMA ? payload : null;
}

function decodeBase64Bytes(data) {
  if (typeof data !== 'string' || !data) return new Uint8Array();
  if (globalThis.Buffer) return new Uint8Array(globalThis.Buffer.from(data, 'base64'));
  const binary = globalThis.atob ? globalThis.atob(data) : '';
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeF32Channel(channel, expectedValues = 0) {
  if (!channel || channel.encoding !== 'base64-f32-le') return null;
  const bytes = decodeBase64Bytes(channel.data);
  const valueCount = Math.floor(bytes.byteLength / 4);
  if (expectedValues > 0 && valueCount < expectedValues) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(valueCount);
  for (let i = 0; i < valueCount; i += 1) out[i] = view.getFloat32(i * 4, true);
  return out;
}

function sampleGridIndex(grid, x, z) {
  const columns = Math.max(1, Math.floor(finite(grid?.columns, grid?.x || 1)));
  const rows = Math.max(1, Math.floor(finite(grid?.rows, grid?.z || 1)));
  return {
    columns,
    rows,
    index: Math.max(0, Math.min(rows - 1, z)) * columns + Math.max(0, Math.min(columns - 1, x)),
  };
}

function bilinearScalar(channel, grid, worldBounds, x, z, fallback = 0) {
  if (!channel) return fallback;
  const columns = Math.max(1, Math.floor(finite(grid?.columns, 1)));
  const rows = Math.max(1, Math.floor(finite(grid?.rows, 1)));
  const xRange = Math.max(0.000001, finite(worldBounds?.x?.max, 1) - finite(worldBounds?.x?.min, -1));
  const zRange = Math.max(0.000001, finite(worldBounds?.z?.max, 1) - finite(worldBounds?.z?.min, -1));
  const gx = clamp((finite(x, 0) - finite(worldBounds?.x?.min, -1)) / xRange, 0, 1) * Math.max(0, columns - 1);
  const gz = clamp((finite(z, 0) - finite(worldBounds?.z?.min, -1)) / zRange, 0, 1) * Math.max(0, rows - 1);
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(columns - 1, x0 + 1);
  const z1 = Math.min(rows - 1, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const i00 = sampleGridIndex(grid, x0, z0).index;
  const i10 = sampleGridIndex(grid, x1, z0).index;
  const i01 = sampleGridIndex(grid, x0, z1).index;
  const i11 = sampleGridIndex(grid, x1, z1).index;
  const a = finite(channel[i00], fallback) * (1 - tx) + finite(channel[i10], fallback) * tx;
  const b = finite(channel[i01], fallback) * (1 - tx) + finite(channel[i11], fallback) * tx;
  return a * (1 - tz) + b * tz;
}

function bilinearVector(channel, components, grid, worldBounds, x, z, fallback) {
  if (!channel || components <= 0) return fallback.slice();
  const out = [];
  for (let component = 0; component < components; component += 1) {
    const scalarView = {
      get length() { return Math.floor(channel.length / components); },
    };
    const proxy = new Proxy(scalarView, {
      get(target, prop) {
        if (prop === 'length') return target.length;
        const index = Number(prop);
        if (!Number.isInteger(index)) return target[prop];
        return channel[index * components + component];
      },
    });
    out.push(bilinearScalar(proxy, grid, worldBounds, x, z, fallback[component] || 0));
  }
  return out;
}

function terrainSampleDiagnosticsFromSurface(surface) {
  if (!surface) {
    return {
      schema: 'big-papa-finger-juice.terrain-sample-diagnostics.v0',
      terrainSampleCouplingMode: 'local_procedural_heightfield_v0',
      terrainSampleStatus: 'missing',
    };
  }
  return {
    schema: 'big-papa-finger-juice.terrain-sample-diagnostics.v0',
    terrainSampleCouplingMode: 'source_height_samples_v0',
    terrainSampleStatus: surface.status,
    sourceAuthority: surface.sourceAuthority,
    sourceRoute: surface.sourceRoute,
    sourceFrameId: surface.sourceFrameId,
    supportFrameChecksum: surface.checksums.supportFrame || null,
    topologyChecksum: surface.checksums.topology || null,
    sampleChecksum: surface.checksums.sample || null,
    channelChecksum: surface.checksums.channels || null,
    grid: surface.grid,
    worldBounds: surface.worldBounds,
    heightRange: surface.heightRange,
    channelLayout: surface.channelLayout,
  };
}

export function normalizeHillTerrainSamplePacket(packetReport, dataReport, options = {}) {
  const packet = terrainSamplePacketFromReport(packetReport);
  const data = terrainSampleDataFromReport(dataReport || packet?.terrainSampleData);
  const sample = packet?.terrainSample || {};
  if (!packet || !data || !data.channels) return null;
  const grid = {
    columns: Math.max(1, Math.floor(finite(data.grid?.columns, sample.grid?.columns || 1))),
    rows: Math.max(1, Math.floor(finite(data.grid?.rows, sample.grid?.rows || 1))),
    sampleCount: Math.max(1, Math.floor(finite(data.grid?.sampleCount, sample.grid?.sampleCount || 1))),
    spacing: data.grid?.spacing || sample.grid?.spacing || null,
  };
  const sampleCount = grid.columns * grid.rows;
  const channels = {
    height: decodeF32Channel(data.channels.height, sampleCount),
    normal: decodeF32Channel(data.channels.normal, sampleCount * 3),
    gradient: decodeF32Channel(data.channels.gradient, sampleCount * 2),
    heightDelta: decodeF32Channel(data.channels.heightDelta, sampleCount),
    surfaceVelocity: decodeF32Channel(data.channels.surfaceVelocity, sampleCount * 3),
  };
  if (!channels.height) return null;
  const worldBounds = data.worldBounds || sample.worldBounds || SUPPORT_WORLD_BOUNDS;
  const checksums = data.checksums || sample.checksums || {};
  const sourceTruth = data.sourceTruth || sample.sourceTruth || packet.source || {};
  const source = packet.source || {};
  const heightRange = sample.heightRange || {
    min: finite(worldBounds?.y?.min, Math.min(...channels.height)),
    max: finite(worldBounds?.y?.max, Math.max(...channels.height)),
  };
  const supportFrame = {
    ...createFingerJuiceSupportFrame({ stepCount: options.stepCount || 0 }),
    supportFrameIngestionContract: FINGER_JUICE_HILL_TERRAIN_SAMPLE_INGESTION_CONTRACT,
    supportFrameSource: 'hill_terrain_sample_packet_v0',
    sourceSupportFrameSchema: packet.schema,
    sourceRoute: stringOrNull(sourceTruth.route || source.route || packet.route),
    sourceAuthority: stringOrNull(sourceTruth.authority || source.authority) || 'unknown',
    sourceDiaulos: stringOrNull(source.producerDiaulos || sourceTruth.diaulos),
    sourceFrameId: stringOrNull(sourceTruth.frameId || packet.frameId),
    sourceBackend: stringOrNull(sourceTruth.backend || source.backend),
    sourceConfigId: stringOrNull(sourceTruth.configId || source.configId),
    sourceRef: source.sourceRef || null,
    supportFrameChecksum: stringOrNull(checksums.supportFrame) || checksumString(JSON.stringify(checksums)),
    terrainSampleChecksum: stringOrNull(checksums.sample),
    terrainTopologyChecksum: stringOrNull(checksums.topology),
    terrainChannelChecksum: stringOrNull(checksums.channels),
    terrainSampleSchema: stringOrNull(sample.schema || data.schema),
    terrainBufferTransport: stringOrNull(sample.transport?.kind || sample.transport || 'source-owned-fetch-url'),
    terrainSampleCount: sampleCount,
    terrainHeightRange: heightRange,
    substrateCellCount: sampleCount,
    substrateGrid: {
      x: grid.columns,
      z: grid.rows,
      cellSize: {
        x: round((finite(worldBounds?.x?.max, 1) - finite(worldBounds?.x?.min, -1)) / Math.max(1, grid.columns), 5),
        z: round((finite(worldBounds?.z?.max, 1) - finite(worldBounds?.z?.min, -1)) / Math.max(1, grid.rows), 5),
      },
    },
    worldBounds,
    maxHeightDelta: channels.heightDelta ? round(Math.max(...Array.from(channels.heightDelta).map(Math.abs)), 6) : 0,
    maxSurfaceSpeed: channels.surfaceVelocity
      ? round(Math.max(...Array.from({ length: sampleCount }, (_, index) => Math.hypot(
        channels.surfaceVelocity[index * 3],
        channels.surfaceVelocity[index * 3 + 1],
        channels.surfaceVelocity[index * 3 + 2],
      ))), 6)
      : 0,
    heightfieldCouplingMode: 'source_height_samples_v0',
    supportFrameDowngrades: uniqueStrings([...(packet.downgrades || []), 'host_visualization_not_source_truth']),
  };
  const surface = {
    schema: FINGER_JUICE_TERRAIN_SAMPLE_SURFACE_SCHEMA,
    terrainSampleIngestionContract: FINGER_JUICE_HILL_TERRAIN_SAMPLE_INGESTION_CONTRACT,
    sourceAuthority: supportFrame.sourceAuthority,
    sourceRoute: supportFrame.sourceRoute,
    sourceFrameId: supportFrame.sourceFrameId,
    status: packet.status || 'fresh-live-terrain-sample',
    grid,
    worldBounds,
    domainBounds: data.domainBounds || sample.domainBounds || { u: { min: 0, max: 1 }, v: { min: 0, max: 1 } },
    heightRange,
    channelLayout: sample.channelLayout || Object.keys(channels).filter(key => channels[key]),
    checksums,
    channels,
    supportFrame,
    sampleHeightAt(x, z) {
      return round(bilinearScalar(channels.height, grid, worldBounds, x, z, terrainHeightAt(x, z)), 6);
    },
    sampleNormalAt(x, z) {
      if (channels.normal) return normalize3(bilinearVector(channels.normal, 3, grid, worldBounds, x, z, [0, 1, 0]), [0, 1, 0]);
      const gradient = channels.gradient
        ? bilinearVector(channels.gradient, 2, grid, worldBounds, x, z, [0, 0])
        : [0, 0];
      return normalize3([-gradient[0], 1, -gradient[1]], [0, 1, 0]);
    },
    sampleGradientAt(x, z) {
      return channels.gradient ? bilinearVector(channels.gradient, 2, grid, worldBounds, x, z, [0, 0]).map(value => round(value, 6)) : [0, 0];
    },
    sampleHeightDeltaAt(x, z) {
      return channels.heightDelta ? round(bilinearScalar(channels.heightDelta, grid, worldBounds, x, z, 0), 6) : 0;
    },
    sampleSurfaceVelocityAt(x, z) {
      return channels.surfaceVelocity
        ? bilinearVector(channels.surfaceVelocity, 3, grid, worldBounds, x, z, [0, 0, 0]).map(value => round(value, 6))
        : [0, 0, 0];
    },
  };
  surface.diagnostics = terrainSampleDiagnosticsFromSurface(surface);
  return surface;
}

export function normalizeHillSupportFramePayload(report, options = {}) {
  const payload = hillPayloadFromReport(report);
  const sourceSupportFrame = payload?.supportFrame;
  if (!sourceSupportFrame || typeof sourceSupportFrame !== 'object') return null;
  const base = createFingerJuiceSupportFrame({ stepCount: options.stepCount || sourceSupportFrame.supportEpoch || 0 });
  const sourceTruth = payload.sourceTruth || payload.source || {};
  const source = payload.source || sourceTruth;
  const terrainBuffer = payload.terrainBuffer || {};
  const phase = payload.phase || {};
  const gridResolution = terrainBuffer.gridResolution || {};
  const gridX = Math.max(1, Math.floor(finite(gridResolution.x, base.substrateGrid.x)));
  const gridZ = Math.max(1, Math.floor(finite(gridResolution.z, base.substrateGrid.z)));
  const sampleCount = Math.max(0, Math.floor(finite(terrainBuffer.sampleCount, gridX * gridZ)));
  const dirtyTileCount = Math.max(0, Math.floor(finite(sourceSupportFrame.dirtySubstrateTileCount, 0)));
  const transport = stringOrNull(terrainBuffer.transport) || 'unknown';
  const cellSize = {
    x: round((SUPPORT_WORLD_BOUNDS.x.max - SUPPORT_WORLD_BOUNDS.x.min) / gridX, 5),
    z: round((SUPPORT_WORLD_BOUNDS.z.max - SUPPORT_WORLD_BOUNDS.z.min) / gridZ, 5),
  };
  const checksumSeed = JSON.stringify({
    schema: HILL_OF_HILLS_PREVIEW_BENCH_PAYLOAD_SCHEMA,
    sourceChecksum: sourceSupportFrame.supportFrameChecksum,
    terrainSampleChecksum: terrainBuffer.sampleChecksum,
    topologyChecksum: terrainBuffer.topologyChecksum,
    grid: [gridX, gridZ],
  });
  return {
    ...base,
    supportFrameIngestionContract: FINGER_JUICE_HILL_SUPPORT_FRAME_INGESTION_CONTRACT,
    supportFrameSource: 'hill_preview_bench_payload_v0',
    sourceSupportFrameSchema: payload.schema,
    sourceRoute: stringOrNull(sourceTruth.route || source.route || payload.route),
    sourceAuthority: stringOrNull(sourceTruth.authority || source.authority) || 'unknown',
    sourceDiaulos: stringOrNull(sourceTruth.diaulos || source.diaulos),
    sourceFrameId: stringOrNull(sourceTruth.frameId || source.frameId),
    sourceBackend: stringOrNull(sourceTruth.backend || source.backend),
    sourceConfigId: stringOrNull(sourceTruth.configId || source.configId),
    sourceRef: payload.sourceRef || null,
    supportClass: stringOrNull(sourceSupportFrame.supportClass) || base.supportClass,
    mappingMode: stringOrNull(sourceSupportFrame.mappingMode) || base.mappingMode,
    supportEpoch: Math.max(0, Math.floor(finite(sourceSupportFrame.supportEpoch, base.supportEpoch))),
    topologyEpoch: Math.max(0, Math.floor(finite(sourceSupportFrame.topologyEpoch, base.topologyEpoch))),
    substrateCellCount: sampleCount || gridX * gridZ,
    substrateGrid: { x: gridX, z: gridZ, cellSize },
    substrateTileCount: Math.max(0, Math.floor(finite(sourceSupportFrame.substrateTileCount, base.substrateTileCount))),
    dirtySubstrateTileCount: dirtyTileCount,
    dirtySubstrateSampleCount: Math.max(0, Math.floor(finite(sourceSupportFrame.dirtySubstrateSampleCount, dirtyTileCount > 0 ? sampleCount : 0))),
    dirtySubstrateRegionChecksum: stringOrNull(sourceSupportFrame.dirtySubstrateRegionChecksum) || terrainBuffer.topologyChecksum || 'hill-summary',
    minSupportWavelength: round(Math.max(cellSize.x, cellSize.z) * 3, 5),
    maxHeightDelta: round(sourceSupportFrame.maxHeightDelta, 6),
    maxSurfaceSpeed: round(sourceSupportFrame.maxSurfaceSpeed, 6),
    supportFrameChecksum: stringOrNull(sourceSupportFrame.supportFrameChecksum) || checksumString(checksumSeed),
    terrainBufferSchema: stringOrNull(terrainBuffer.schema),
    terrainSampleSchema: stringOrNull(terrainBuffer.sampleSchema),
    terrainBufferTransport: transport,
    terrainSampleCount: sampleCount,
    terrainSampleChecksum: stringOrNull(terrainBuffer.sampleChecksum),
    terrainTopologyChecksum: stringOrNull(terrainBuffer.topologyChecksum),
    terrainProxyMaterialChecksum: stringOrNull(terrainBuffer.proxyMaterialChecksum),
    terrainHeightRange: terrainBuffer.heightRange || null,
    motionClassCounts: { stable: 0, phase_morph: sampleCount || gridX * gridZ, shock_reset: 0 },
    shockClassCounts: { none: sampleCount || gridX * gridZ, shock_reset: 0 },
    phaseMode: stringOrNull(phase.mode),
    terrainEpoch: Math.max(0, Math.floor(finite(phase.terrainEpoch, sourceSupportFrame.supportEpoch || 0))),
    activePhaseCount: Math.max(0, Math.floor(finite(phase.activePhaseCount, 0))),
    phaseChecksum: stringOrNull(phase.phaseChecksum),
    heightfieldCouplingMode: transport === 'summary_only_typed_arrays_remain_source_owned'
      ? 'support_frame_identity_only_v0'
      : 'support_frame_with_source_height_samples_v0',
    supportFrameDowngrades: uniqueStrings([
      ...(payload.downgrades || []),
      transport === 'summary_only_typed_arrays_remain_source_owned' ? LOCAL_COLLISION_DOWNGRADE : null,
    ]),
  };
}

export function createReservoirDomainDiagnostics(particles = [], supportFrame = createFingerJuiceSupportFrame()) {
  const surfaceParticles = (particles || [])
    .filter(particle => particle?.surface_flow || particle?.phase === 'surface_flow')
    .filter(particle => Array.isArray(particle.position));
  const occupied = new Map();
  for (const particle of surfaceParticles) {
    const cell = supportCellForWorld(particle.position);
    const key = `${cell.x},${cell.z}`;
    const entry = occupied.get(key) || {
      x: cell.x,
      z: cell.z,
      particles: [],
      chemistryCounts: {},
    };
    entry.particles.push(particle);
    const chemistry = particle.chemistry || 'unknown';
    entry.chemistryCounts[chemistry] = (entry.chemistryCounts[chemistry] || 0) + 1;
    occupied.set(key, entry);
  }
  const visited = new Set();
  const componentEntries = [];
  for (const [startKey, startCell] of occupied) {
    if (visited.has(startKey)) continue;
    const queue = [startCell];
    const cells = [];
    visited.add(startKey);
    while (queue.length) {
      const cell = queue.shift();
      cells.push(cell);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${cell.x + dx},${cell.z + dz}`;
        if (!occupied.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push(occupied.get(key));
      }
    }
    const componentParticles = cells.flatMap(cell => cell.particles);
    const domainBounds = domainBoundsFromCells(cells);
    const chemistryCounts = {};
    for (const particle of componentParticles) {
      const chemistry = particle.chemistry || 'unknown';
      chemistryCounts[chemistry] = (chemistryCounts[chemistry] || 0) + 1;
    }
    const estimatedFluidVolume = componentParticles.reduce((sum, particle) => {
      const radius = Math.max(0.004, finite(particle.radius, 0.04));
      return sum + (4 / 3) * Math.PI * radius ** 3;
    }, 0);
    componentEntries.push({
      id: `reservoir-domain-${componentEntries.length}`,
      particleCount: componentParticles.length,
      occupiedCellCount: cells.length,
      estimatedFluidVolume: round(estimatedFluidVolume, 6),
      domainBounds,
      worldBounds: worldBoundsFromDomain(domainBounds),
      chemistryCounts,
    });
  }
  componentEntries.sort((a, b) => b.particleCount - a.particleCount || b.occupiedCellCount - a.occupiedCellCount);
  const occupiedTiles = new Set([...occupied.values()].map(cell => {
    const tileX = Math.floor(cell.x / SUPPORT_TILE_CELLS.x);
    const tileZ = Math.floor(cell.z / SUPPORT_TILE_CELLS.z);
    return `${tileX},${tileZ}`;
  }));
  const checksumSeed = JSON.stringify({
    supportFrameChecksum: supportFrame.supportFrameChecksum,
    cells: [...occupied.keys()].sort(),
    components: componentEntries.map(component => [component.particleCount, component.occupiedCellCount, component.domainBounds]),
  });
  return {
    schema: FINGER_JUICE_RESERVOIR_DIAGNOSTICS_SCHEMA,
    supportFrameChecksum: supportFrame.supportFrameChecksum,
    supportFrameSchema: supportFrame.schema,
    reservoirMode: 'surface_particle_domain_components_v0',
    occupiedCellCount: occupied.size,
    activeSubstrateTileCount: occupiedTiles.size,
    surfaceParticleCount: surfaceParticles.length,
    estimatedFluidVolume: round(componentEntries.reduce((sum, component) => sum + component.estimatedFluidVolume, 0), 6),
    reservoirChecksum: checksumString(checksumSeed),
    activeReservoirDomains: {
      componentCount: componentEntries.length,
      largestComponent: componentEntries[0] || null,
      components: componentEntries.slice(0, 8),
    },
  };
}

export function createFingerJuicePreviewBenchPayload(debugState = {}, options = {}) {
  const supportFrame = debugState.supportFrame || createFingerJuiceSupportFrame({ stepCount: debugState.stepCount || 0 });
  const substrateReservoirDiagnostics = debugState.substrateReservoirDiagnostics
    || createReservoirDomainDiagnostics(debugState.particles || [], supportFrame);
  const source = debugState.sourceTruth || {
    schema: 'lerms.source-truth.v0',
    authority: debugState.sourceDiagnostics?.authority || debugState.simulation_authority || 'synthetic_fixture',
    route: debugState.source_route || 'kaminos.lerms-finger-juice.synthetic-caster',
    frameId: debugState.source_frame_id || debugState.packet_id || null,
    backend: debugState.source_backend || debugState.solver_backend || null,
    configId: debugState.activeWitnessEmitterConfig || debugState.route_identity || null,
  };
  const largest = substrateReservoirDiagnostics.activeReservoirDomains?.largestComponent || null;
  const hillSupportFrameLoaded = supportFrame.supportFrameSource === 'hill_preview_bench_payload_v0';
  const supportFrameDowngrades = hillSupportFrameLoaded
    ? uniqueStrings([...(supportFrame.supportFrameDowngrades || []), 'host_visualization_not_source_truth'])
    : ['local_procedural_support_frame_not_live_hill', 'host_visualization_not_source_truth'];
  return {
    ok: true,
    schema: 'kaminos.preview-bench.payload-report.v0',
    route: 'kaminos/preview-bench/payload-file',
    reportPath: options.reportPath || null,
    payload: {
      schema: FINGER_JUICE_PREVIEW_BENCH_PAYLOAD_SCHEMA,
      route: 'big-papa-finger-juice/support-reservoir-preview-bench-v0',
      label: 'Big Papa Finger Juice support reservoirs',
      acceptanceSurface: {
        kind: 'kaminos_preview_bench_payload',
        worldChamberId: 'lerms-underhill',
        posture: 'inspect',
        bench: 'terrain-preview',
        routeQuery: 'world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview',
        sourceOwnsPayloadTruth: true,
        hostOwnsVisualization: true,
      },
      source,
      summary: {
        particleCount: debugState.particleCount || 0,
        surfaceFlowCount: substrateReservoirDiagnostics.surfaceParticleCount || debugState.surfaceFlowCount || 0,
        supportFrameChecksum: supportFrame.supportFrameChecksum,
        supportFrameSource: supportFrame.supportFrameSource || 'local_procedural_support_frame_v0',
        sourceAuthority: supportFrame.sourceAuthority || source.authority || null,
        terrainSampleCount: supportFrame.terrainSampleCount || null,
        maxSurfaceSpeed: supportFrame.maxSurfaceSpeed ?? null,
        activeDomains: substrateReservoirDiagnostics.activeReservoirDomains?.componentCount || 0,
        occupiedCellCount: substrateReservoirDiagnostics.occupiedCellCount || 0,
        largestDomainParticleCount: largest?.particleCount || 0,
        estimatedFluidVolume: substrateReservoirDiagnostics.estimatedFluidVolume || 0,
      },
      fields: [
        { label: 'Active domains', value: String(substrateReservoirDiagnostics.activeReservoirDomains?.componentCount || 0) },
        { label: 'Occupied cells', value: String(substrateReservoirDiagnostics.occupiedCellCount || 0) },
        { label: 'Largest domain particles', value: String(largest?.particleCount || 0) },
        { label: 'Support checksum', value: supportFrame.supportFrameChecksum },
        { label: 'Support source', value: supportFrame.supportFrameSource || 'local_procedural_support_frame_v0' },
        { label: 'Hill authority', value: supportFrame.sourceAuthority || 'none' },
      ],
      supportFrame,
      reservoir: substrateReservoirDiagnostics,
      custody: {
        sourceOwns: ['fluid reservoir/domain truth', 'support-frame checksum', 'source authority and freshness'],
        kaminosOwns: ['Preview Bench host display', 'route badges', 'fallback/rejection surfacing'],
      },
      downgrades: supportFrameDowngrades,
      rejectedSurfaces: [
        {
          surface: 'direct_lerms_finger_juice_debug_route',
          acceptanceSurface: false,
          reason: 'debug route is useful evidence but not a Kaminos Preview Bench acceptance surface',
        },
      ],
    },
  };
}

function particlePosition(particle) {
  return vec3(particle?.position || particle?.world || particle?.position_world || particle?.positionWorld, [0, 0, 0]);
}

function particleBounds(particles = [], fallback = null) {
  const positions = (Array.isArray(particles) ? particles : [])
    .map(particlePosition)
    .filter(position => position.every(Number.isFinite));
  if (!positions.length) {
    return fallback || {
      x: { min: -0.75, max: 0.75 },
      y: { min: 0, max: 1 },
      z: { min: -0.95, max: 2.25 },
    };
  }
  const xs = positions.map(position => position[0]);
  const ys = positions.map(position => position[1]);
  const zs = positions.map(position => position[2]);
  return {
    x: { min: round(Math.min(...xs), 4), max: round(Math.max(...xs), 4) },
    y: { min: round(Math.min(...ys), 4), max: round(Math.max(...ys), 4) },
    z: { min: round(Math.min(...zs), 4), max: round(Math.max(...zs), 4) },
  };
}

function chemistryCounts(particles = []) {
  return (Array.isArray(particles) ? particles : []).reduce((counts, particle) => {
    const chemistry = stringOrNull(particle?.chemistry) || 'unknown';
    counts[chemistry] = (counts[chemistry] || 0) + 1;
    return counts;
  }, {});
}

function sourceTruthForHostPacket(debugState = {}) {
  return debugState.sourceTruth || {
    schema: 'lerms.source-truth.v0',
    authority: debugState.sourceDiagnostics?.authority || debugState.simulation_authority || debugState.evidence_kind || 'synthetic_fixture',
    route: debugState.sourceDiagnostics?.route || debugState.source_route || 'kaminos.lerms-finger-juice.synthetic-caster',
    frameId: debugState.sourceDiagnostics?.frameId || debugState.source_frame_id || debugState.packet_id || null,
    backend: debugState.sourceDiagnostics?.backend || debugState.source_backend || debugState.solver_backend || null,
    configId: debugState.sourceDiagnostics?.configId || debugState.activeWitnessEmitterConfig || debugState.route_identity || null,
    sampleAgeMs: debugState.sourceDiagnostics?.sampleAgeMs ?? null,
  };
}

function createHostRenderPayload(debugState = {}) {
  const particles = Array.isArray(debugState.particles) ? debugState.particles : [];
  const trails = Array.isArray(debugState.trails) ? debugState.trails : [];
  return {
    schema: FINGER_JUICE_HOST_RENDER_PAYLOAD_PREVIEW_SCHEMA,
    representation: 'debug-particle-samples-v0',
    downgraded: true,
    downgradeReason: 'full_gpu_particle_buffer_not_exposed_to_host_packet_yet',
    sourceSampleCount: particles.length,
    sourceTrailCount: trails.length,
    particleSamples: particles.map(particle => ({
      id: stringOrNull(particle.id),
      emitterId: stringOrNull(particle.emitter_id || particle.emitterId),
      chemistry: stringOrNull(particle.chemistry) || 'unknown',
      phase: stringOrNull(particle.phase) || (particle.surface_flow ? 'surface_flow' : 'unknown'),
      surfaceFlow: Boolean(particle.surface_flow || particle.surfaceFlow),
      pooling: Boolean(particle.pooling),
      position: particlePosition(particle).map(value => round(value, 4)),
      velocity: vec3(particle.velocity, [0, 0, 0]).map(value => round(value, 4)),
      radius: round(particle.radius ?? 0.04, 4),
    })),
    trailSamples: trails.map(trail => ({
      id: stringOrNull(trail.id),
      emitterId: stringOrNull(trail.emitter_id || trail.emitterId),
      chemistry: stringOrNull(trail.chemistry) || 'unknown',
      phase: stringOrNull(trail.phase) || 'unknown',
      surfaceFlow: Boolean(trail.surface_flow || trail.surfaceFlow),
      samples: (trail.samples || []).map(sample => ({
        position: particlePosition(sample).map(value => round(value, 4)),
        phase: stringOrNull(sample.phase) || null,
        velocityHint: vec3(sample.velocity_hint || sample.velocityHint, [0, 0, 0]).map(value => round(value, 4)),
      })),
    })),
    downgrades: ['preview_particle_samples_not_full_render_buffer'],
  };
}

export function createFingerJuiceHostPacket(debugState = {}, options = {}) {
  const supportFrame = debugState.supportFrame || createFingerJuiceSupportFrame({ stepCount: debugState.stepCount || 0 });
  const terrainSampleDiagnostics = debugState.terrainSampleDiagnostics || {};
  const sourceTruth = sourceTruthForHostPacket(debugState);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const observedAt = options.observedAt || sourceTruth.observedAt || sourceTruth.generatedAt || generatedAt;
  const renderPayload = createHostRenderPayload(debugState);
  const fallbackBounds = terrainSampleDiagnostics.worldBounds || supportFrame.worldBounds || {
    x: SUPPORT_WORLD_BOUNDS.x,
    y: supportFrame.terrainHeightRange || { min: 0, max: 1 },
    z: SUPPORT_WORLD_BOUNDS.z,
  };
  const bounds = particleBounds(debugState.particles, fallbackBounds);
  const sourcePacketId = debugState.sourceDiagnostics?.sourcePacketId
    || debugState.emitterPacket?.packet_id
    || debugState.packet_id
    || sourceTruth.frameId
    || null;
  const sourceAuthority = sourceTruth.authority || debugState.sourceDiagnostics?.authority || debugState.simulation_authority || 'synthetic_fixture';
  const terrainCouplingMode = terrainSampleDiagnostics.terrainSampleCouplingMode
    || supportFrame.heightfieldCouplingMode
    || 'local_procedural_heightfield_v0';
  const terrainGpuMode = terrainSampleDiagnostics.terrainSampleGpuCollisionMode
    || debugState.terrainSampleGpuCollisionMode
    || (terrainCouplingMode === 'source_height_samples_v0'
      ? 'source_height_samples_gpu_storage_v0'
      : 'local_procedural_heightfield_gpu_v0');
  const hitEvents = Array.isArray(debugState.juiceHitEvents) ? debugState.juiceHitEvents : [];
  const supportFrameDowngrades = Array.isArray(supportFrame.supportFrameDowngrades) ? supportFrame.supportFrameDowngrades : [];
  const downgrades = uniqueStrings([
    ...supportFrameDowngrades,
    ...renderPayload.downgrades,
    'host_packet_preview_payload_not_native_render_buffer',
  ]);
  return {
    ok: true,
    schema: FINGER_JUICE_HOST_PACKET_SCHEMA,
    route: FINGER_JUICE_HOST_PACKET_ROUTE,
    packetUrl: options.packetUrl || null,
    source: {
      schema: 'big-papa-finger-juice.host-packet-source.v0',
      producerDiaulos: 'big-papa-finger-juice-fucker',
      route: FINGER_JUICE_HOST_PACKET_ROUTE,
      sourceRef: options.sourceRef || debugState.sourceRef || supportFrame.sourceRef || null,
      sourcePacketId,
      authority: sourceAuthority,
      sourceTruthAuthority: sourceTruth.authority || sourceAuthority,
      sourceTruth,
      generatedAt,
      observedAt,
    },
    freshness: {
      status: options.freshnessStatus || debugState.freshness?.status || 'host-packet-generated-from-current-debug-state',
      budgetMs: Math.max(0, finite(options.freshnessBudgetMs ?? debugState.freshness?.budgetMs, 2000)),
      observedAt,
      generatedAt,
      sampleAgeMs: sourceTruth.sampleAgeMs ?? debugState.sourceDiagnostics?.sampleAgeMs ?? null,
    },
    terrain: {
      terrainContract: debugState.terrainContract || LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT,
      supportFrameSchema: supportFrame.schema || FINGER_JUICE_SUPPORT_FRAME_SCHEMA,
      supportFrameSource: supportFrame.supportFrameSource || 'local_procedural_support_frame_v0',
      supportFrameChecksum: supportFrame.supportFrameChecksum || terrainSampleDiagnostics.supportFrameChecksum || null,
      topologyChecksum: terrainSampleDiagnostics.topologyChecksum || supportFrame.terrainTopologyChecksum || null,
      sampleChecksum: terrainSampleDiagnostics.sampleChecksum || supportFrame.terrainSampleChecksum || null,
      channelChecksum: terrainSampleDiagnostics.channelChecksum || supportFrame.terrainChannelChecksum || null,
      terrainSampleSchema: supportFrame.terrainSampleSchema || null,
      terrainBufferTransport: supportFrame.terrainBufferTransport || null,
      terrainSourceRoute: terrainSampleDiagnostics.sourceRoute || supportFrame.sourceRoute || null,
      terrainSourceAuthority: terrainSampleDiagnostics.sourceAuthority || supportFrame.sourceAuthority || null,
      terrainSourceFrameId: terrainSampleDiagnostics.sourceFrameId || supportFrame.sourceFrameId || null,
      couplingMode: terrainCouplingMode,
      gpuCollisionMode: terrainGpuMode,
      grid: terrainSampleDiagnostics.grid || supportFrame.substrateGrid || null,
      worldBounds: terrainSampleDiagnostics.worldBounds || supportFrame.worldBounds || null,
      heightRange: terrainSampleDiagnostics.heightRange || supportFrame.terrainHeightRange || null,
      channelLayout: terrainSampleDiagnostics.channelLayout || null,
    },
    solver: {
      solverRoute: debugState.solverRoute || debugState.effectiveRoute || LERMS_WORLD_FINGER_JUICE_ROUTE,
      effectiveRoute: debugState.effectiveRoute || LERMS_WORLD_FINGER_JUICE_ROUTE,
      shaderRoute: debugState.shaderRoute || null,
      backend: debugState.solver_backend || 'cpu_fallback',
      emitterBufferRoute: debugState.emitterBufferRoute || null,
      respawnContract: debugState.respawnContract || null,
      pressureContract: debugState.pressureContract || null,
      spatialPressureContract: debugState.spatialPressureContract || null,
      fluidDepthContract: debugState.fluidDepthContract || null,
      densityContinuityProjectionContract: debugState.densityContinuityProjectionContract || null,
      particleSupportBudgetContract: debugState.particleSupportBudgetContract || null,
      particleCount: Math.max(0, Math.floor(finite(debugState.particleCount, (debugState.particles || []).length))),
      surfaceFlowCount: Math.max(0, Math.floor(finite(debugState.surfaceFlowCount, 0))),
      airborneCount: Math.max(0, Math.floor(finite(debugState.airborneCount, 0))),
      chemistryCounts: chemistryCounts(debugState.particles),
      materialChannels: Object.keys(chemistryCounts(debugState.particles)),
      frameId: sourceTruth.frameId || debugState.source_frame_id || debugState.packet_id || null,
      timestamp: observedAt,
      bounds,
      supportFrame,
      reservoir: debugState.substrateReservoirDiagnostics || createReservoirDomainDiagnostics(debugState.particles || [], supportFrame),
    },
    render: {
      renderRoute: debugState.renderRoute || null,
      renderShaderRoute: debugState.renderShaderRoute || null,
      backend: debugState.render_backend || 'cpu_canvas_render',
      payload: renderPayload,
      downgraded: true,
      downgrades: renderPayload.downgrades,
    },
    hitRefs: {
      schema: 'big-papa-finger-juice.host-packet.hit-refs.v0',
      sourcePacketId,
      eventSchema: 'lerms.juice-hit-event.v0',
      events: hitEvents.map(event => ({
        schema: event.schema || 'lerms.juice-hit-event.v0',
        targetKind: event.targetKind || event.target_kind || null,
        targetId: event.targetId || event.target_id || null,
        contactWorld: Array.isArray(event.contactWorld) ? event.contactWorld.map(value => round(value, 4)) : null,
        impulse: Array.isArray(event.impulse) ? event.impulse.map(value => round(value, 4)) : null,
        chemistry: event.chemistry || null,
        sourcePacketId: event.sourcePacketId || sourcePacketId,
      })),
    },
    visual: {
      cameraHints: {
        bounds,
        lookAt: [
          round((bounds.x.min + bounds.x.max) / 2, 4),
          round((bounds.y.min + bounds.y.max) / 2, 4),
          round((bounds.z.min + bounds.z.max) / 2, 4),
        ],
        up: [0, 1, 0],
        near: 0.01,
        far: 24,
        presets: [
          { id: 'operator-oblique', yaw: -0.52, pitch: -0.42, zoom: 1.4 },
          { id: 'terrain-overview', yaw: 0, pitch: -0.75, zoom: 0.9 },
          { id: 'fluid-close', yaw: -0.34, pitch: -0.28, zoom: 2.1 },
        ],
      },
      materialHints: {
        renderStyle: 'source-legible-phase-breadcrumbs-v2',
        chemistryColors: {
          knockback: '#ff5f55',
          pooling: '#4bd5c6',
          weird: '#d89cff',
          splash: '#ffd05b',
        },
      },
    },
    custody: {
      bigPapaOwns: ['fluid law', 'solver/source truth', 'terrain coupling checksums', 'hit event semantics'],
      sourceOwns: ['fluid law', 'solver/source truth', 'terrain coupling checksums', 'hit event semantics'],
      kaminosOwns: ['native host camera', 'viewport composition', 'operator display', 'interaction controls'],
      downgrades,
      rejectedDebugSurfaces: [
        {
          surface: 'direct_lerms_finger_juice_debug_route',
          acceptanceSurface: false,
          reason: 'debug route is useful evidence but not the first-class Kaminos host acceptance surface',
        },
      ],
      syntheticOrLocal: uniqueStrings([
        terrainCouplingMode === 'source_height_samples_v0' ? null : 'terrain_collision',
        debugState.solver_backend === 'webgpu_compute' ? null : 'solver_backend',
        renderPayload.downgraded ? 'native_render_buffer_transport' : null,
      ]),
    },
  };
}

function normalizeHandSampleSpace(packet) {
  const raw = packet.hand_sample_space || packet.handSampleSpace || {};
  return {
    id: stringOrNull(raw.id),
    convention: stringOrNull(raw.convention || raw.pose_convention || raw.poseConvention),
    handedness: stringOrNull(raw.handedness),
    screen_x: stringOrNull(raw.screen_x || raw.screenX),
    screen_coordinates: stringOrNull(raw.screen_coordinates || raw.screenCoordinates),
    camera_coordinates: stringOrNull(raw.camera_coordinates || raw.cameraCoordinates),
    world_coordinates: stringOrNull(raw.world_coordinates || raw.worldCoordinates),
    local_coordinates: stringOrNull(raw.local_coordinates || raw.localCoordinates),
  };
}

function normalizeLermsWorldFrame(packet) {
  const terrainFrame = packet.terrain_frame || packet.terrainFrame || {};
  const raw = packet.lerms_world_frame || packet.lermsWorldFrame || {};
  return {
    id: stringOrNull(raw.id || terrainFrame.id),
    units: stringOrNull(raw.units || terrainFrame.units || 'normalized_world'),
    terrain_frame_id: stringOrNull(raw.terrain_frame_id || raw.terrainFrameId || terrainFrame.id),
    heightfield_contract: stringOrNull(raw.heightfield_contract || raw.heightfieldContract || terrainFrame.height_contract || LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT),
    projection_contract: stringOrNull(raw.projection_contract || raw.projectionContract),
    camera_contract: stringOrNull(raw.camera_contract || raw.cameraContract),
    world_from_hand_sample: stringOrNull(raw.world_from_hand_sample || raw.worldFromHandSample),
  };
}

function missingFrameReasons(packet, handSampleSpace, lermsWorldFrame) {
  const missing = [];
  if (!packet.source_route && !packet.sourceRoute) missing.push('source_route');
  if (!packet.source_frame_id && !packet.sourceFrameId) missing.push('source_frame_id');
  if (!handSampleSpace.id) missing.push('hand_sample_space.id');
  if (!lermsWorldFrame.id) missing.push('lerms_world_frame.id');
  if (!lermsWorldFrame.world_from_hand_sample) missing.push('lerms_world_frame.world_from_hand_sample');
  return missing;
}

function normalizePacketAuthority(packet, handSampleSpace, lermsWorldFrame) {
  let requested = stringOrNull(packet.simulation_authority || packet.simulationAuthority);
  const stale = Boolean(packet.stale_visual_only || packet.visual_only || packet.authority?.stale_visual_only);
  if (!requested && stale) requested = packet.visual_only ? 'visual_only' : 'stale_hold';
  if (!requested) requested = 'invalid';
  if (!LERMS_WORLD_FINGER_JUICE_AUTHORITY_VALUES.includes(requested)) requested = 'invalid';
  const missing = missingFrameReasons(packet, handSampleSpace, lermsWorldFrame);
  if ((requested === 'live_simulation' || requested === 'synthetic_fixture') && missing.length > 0) {
    return {
      simulation_authority: 'invalid',
      stale_visual_only: stale,
      simulation_safe: false,
      reason: `missing frame identity: ${missing.join(', ')}`,
    };
  }
  const simulationSafe = requested === 'live_simulation' || requested === 'synthetic_fixture';
  return {
    simulation_authority: requested,
    stale_visual_only: stale || requested === 'stale_hold',
    simulation_safe: simulationSafe,
    reason: simulationSafe ? null : `packet authority is ${requested}`,
  };
}

function terrainHeightAt(x, z) {
  const bowl = -0.08 + 0.11 * x * x + 0.035 * Math.cos(z * 1.65);
  const hillA = 0.11 * Math.exp(-((x - 0.46) ** 2 + (z - 0.28) ** 2) / 0.18);
  const hillB = 0.09 * Math.exp(-((x + 0.36) ** 2 + (z + 0.1) ** 2) / 0.11);
  const valley = -0.08 * Math.exp(-((x - 0.05) ** 2 + (z + 0.08) ** 2) / 0.08);
  return bowl + hillA + hillB + valley;
}

function terrainNormalAt(x, z) {
  const eps = 0.015;
  const dx = (terrainHeightAt(x + eps, z) - terrainHeightAt(x - eps, z)) / (eps * 2);
  const dz = (terrainHeightAt(x, z + eps) - terrainHeightAt(x, z - eps)) / (eps * 2);
  return normalize3([-dx, 1, -dz], [0, 1, 0]);
}

function slideVelocityOnTerrain(velocity, normal, chemistry) {
  const normalComponent = normal[0] * velocity[0] + normal[1] * velocity[1] + normal[2] * velocity[2];
  const tangent = sub(velocity, mul(normal, normalComponent));
  const viscosity = chemistry === 'pooling' ? 0.66 : chemistry === 'weird' ? 0.77 : 0.84;
  const downhill = normalize3([normal[0], 0, normal[2]], [0, 0, 1]);
  return add(mul(tangent, viscosity), mul(downhill, chemistry === 'pooling' ? 0.1 : 0.04));
}

function trailSample(position, phase = 'airborne', velocity = [0, 0, 0]) {
  return {
    position: vec3(position).map(value => round(value, 4)),
    phase,
    velocity_hint: vec3(velocity).map(value => round(value, 4)),
  };
}

function normalizeEmitter(raw = {}, index = 0, packetAuthority = { simulation_safe: false }) {
  const id = String(raw.id || DEFAULT_FINGER_IDS[index] || `finger-${index}`);
  const aim = normalize3(raw.aim_world || raw.aimWorld || raw.aim, [0, 0.34, 0.94]);
  const chemistry = String(raw.chemistry || DEFAULT_CHEMISTRY[id] || 'knockback');
  const extension = clamp(raw.extension ?? 1, 0, 1);
  const stale = Boolean(raw.stale_visual_only || raw.visual_only || raw.staleVisualOnly);
  const rawAuthority = raw.authority || {};
  const confidence = clamp(rawAuthority.confidence ?? raw.confidence ?? 1, 0, 1);
  const authority = {
    valid: rawAuthority.valid !== false && raw.valid !== false,
    stale: Boolean(rawAuthority.stale || raw.stale || stale),
    confidence: round(confidence, 4),
    force_safe: false,
    render_safe: rawAuthority.render_safe !== false,
    reason: null,
  };
  authority.force_safe = packetAuthority.simulation_safe
    && authority.valid
    && !authority.stale
    && authority.render_safe
    && rawAuthority.force_safe !== false
    && raw.force_safe !== false
    && confidence > 0;
  if (!packetAuthority.simulation_safe) authority.reason = packetAuthority.reason || 'packet is not simulation-safe';
  else if (!authority.valid) authority.reason = 'emitter authority invalid';
  else if (authority.stale) authority.reason = 'emitter authority stale';
  else if (rawAuthority.force_safe === false || raw.force_safe === false) authority.reason = 'emitter force unsafe';
  else if (confidence <= 0) authority.reason = 'emitter confidence is zero';
  const active = raw.active !== false && extension > 0.08 && !stale && authority.force_safe;
  const strength = clamp(raw.strength ?? raw.dye_strength ?? 1, 0, 4);
  return {
    id,
    tip_index: Math.round(finite(raw.tip_index ?? raw.tipIndex, DEFAULT_TIP_INDEX[id] ?? index)),
    origin_world: vec3(raw.origin_world || raw.originWorld || raw.origin, [index * 0.08 - 0.16, 0.34, -0.82]),
    origin_screen: optionalVec2(raw.origin_screen || raw.originScreen),
    aim_world: axisVec3(aim),
    aim_screen: optionalVec2(raw.aim_screen || raw.aimScreen),
    motion_world: vec3(raw.motion_world || raw.motionWorld || raw.motion, [0, 0, 0]).map(value => round(value, 4)),
    extension: round(extension, 4),
    emission_state: String(raw.emission_state || raw.emissionState || (extension > 0.72 ? 'jet' : extension > 0.28 ? 'dribble' : 'off')),
    chemistry,
    radius: round(clamp(raw.radius ?? 0.045, 0.01, 0.18), 4),
    strength: round(strength, 4),
    active,
    stale_visual_only: stale,
    authority,
  };
}

export function normalizeWorldFingerJuiceEmitterPacket(packet = {}) {
  if (Array.isArray(packet)) packet = { emitters: packet };
  const handSampleSpace = normalizeHandSampleSpace(packet);
  const lermsWorldFrame = normalizeLermsWorldFrame(packet);
  const packetAuthority = normalizePacketAuthority(packet, handSampleSpace, lermsWorldFrame);
  const emitters = (Array.isArray(packet) ? packet : packet.emitters || [])
    .slice(0, 5)
    .map((emitter, index) => normalizeEmitter(emitter, index, packetAuthority));
  while (emitters.length < 5) emitters.push(normalizeEmitter({ active: false, extension: 0 }, emitters.length, packetAuthority));
  const packetId = stringOrNull(packet.packet_id || packet.packetId) || `finger-juice-${Math.round(finite(packet.timestamp_ms ?? packet.timestampMs ?? 0, 0))}`;
  const sourceFrameId = stringOrNull(packet.source_frame_id || packet.sourceFrameId);
  return {
    schema: LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA,
    packet_id: packetId,
    source_route: stringOrNull(packet.source_route || packet.sourceRoute),
    source_backend: String(packet.source_backend || packet.sourceBackend || 'unknown'),
    source_frame_id: sourceFrameId,
    sidecar_sequence: packet.sidecar_sequence ?? packet.sidecarSequence ?? null,
    sample_age_ms: Math.max(0, finite(packet.sample_age_ms ?? packet.sampleAgeMs, 0)),
    timestamp_ms: finite(packet.timestamp_ms ?? packet.timestampMs ?? Date.now(), Date.now()),
    evidence_kind: stringOrNull(packet.evidence_kind || packet.evidenceKind) || packetAuthority.simulation_authority,
    simulation_authority: packetAuthority.simulation_authority,
    route_identity: packet.route_identity || packet.routeIdentity || null,
    hand_sample_space: handSampleSpace,
    lerms_world_frame: lermsWorldFrame,
    terrain_frame: {
      id: lermsWorldFrame.terrain_frame_id || lermsWorldFrame.id || 'kaminos-hill-of-hills-local-v0',
      units: lermsWorldFrame.units || 'normalized_world',
      height_contract: lermsWorldFrame.heightfield_contract || LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT,
    },
    authority: {
      stale_visual_only: packetAuthority.stale_visual_only,
      simulation_safe: packetAuthority.simulation_safe,
      reason: packetAuthority.reason,
    },
    active_emitter_count: emitters.filter(emitter => emitter.active).length,
    emitters,
  };
}

function makeRng(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function createWorldFingerJuiceTransportPrototype(options = {}) {
  const maxParticles = Math.max(16, Math.floor(options.maxParticles || 768));
  const rng = makeRng(options.seed || 1);
  let emitters = normalizeWorldFingerJuiceEmitterPacket();
  let particles = [];
  const lerms = (options.lerms || []).map(target => ({ ...target, impulse: [0, 0, 0], hits: 0 }));
  const goins = (options.goins || []).map(target => ({ ...target, impulse: [0, 0, 0], hits: 0 }));
  let stepCount = 0;
  let lermImpulseCount = 0;
  let goinImpulseCount = 0;
  let maxRangeZ = 0;
  let eventLog = [];
  let terrainSampleSurface = options.terrainSampleSurface || null;

  function currentTerrainHeightAt(x, z) {
    return terrainSampleSurface?.sampleHeightAt ? terrainSampleSurface.sampleHeightAt(x, z) : terrainHeightAt(x, z);
  }

  function currentTerrainNormalAt(x, z) {
    return terrainSampleSurface?.sampleNormalAt ? terrainSampleSurface.sampleNormalAt(x, z) : terrainNormalAt(x, z);
  }

  function currentSurfaceVelocityAt(x, z) {
    return terrainSampleSurface?.sampleSurfaceVelocityAt ? terrainSampleSurface.sampleSurfaceVelocityAt(x, z) : [0, 0, 0];
  }

  function currentSupportFrame() {
    return terrainSampleSurface?.supportFrame || createFingerJuiceSupportFrame({ stepCount, particles });
  }

  function currentTerrainSampleDiagnostics() {
    return terrainSampleSurface?.diagnostics || terrainSampleDiagnosticsFromSurface(null);
  }

  function spawnParticles(dt) {
    if (!emitters.authority.simulation_safe) return;
    for (const emitter of emitters.emitters) {
      if (!emitter.active || emitter.emission_state === 'off') continue;
      const rate = emitter.emission_state === 'jet' ? 4 : 2;
      for (let i = 0; i < rate && particles.length < maxParticles; i += 1) {
        const jitter = [(rng() - 0.5) * emitter.radius, (rng() - 0.5) * emitter.radius, (rng() - 0.5) * emitter.radius];
        const start = add(emitter.origin_world, jitter);
        const aim = normalize3(emitter.aim_world);
        const motion = vec3(emitter.motion_world);
        const arcBoost = 0.42 + Math.max(0, aim[1]) * 1.6;
        const speed = (emitter.emission_state === 'jet' ? 2.15 : 1.18) * (0.35 + emitter.strength * 0.65);
        const velocity = add(add(mul(aim, speed), motion), [0, arcBoost, 0]);
        const particle = {
          id: `fj-${stepCount}-${particles.length}-${i}`,
          emitter_id: emitter.id,
          chemistry: emitter.chemistry,
          radius: emitter.radius,
          strength: emitter.strength,
          age: 0,
          life: emitter.chemistry === 'pooling' ? 2.9 : 2.15,
          phase: 'airborne',
          position: start,
          velocity,
          surface_flow: false,
          pooling: false,
          source_anchor: trailSample(start, 'source_anchor', velocity),
          phase_markers: [trailSample(start, 'airborne', velocity)],
          visual_trail: [trailSample(start, 'airborne', velocity)],
          hitTargets: new Set(),
        };
        particles.push(particle);
      }
    }
  }

  function applyTargetImpulses(particle) {
    for (const target of lerms) {
      const position = vec3(target.position);
      const delta = sub(position, particle.position);
      const distance = length3(delta);
      const radius = finite(target.radius, 0.16) + particle.radius;
      if (distance > radius) continue;
      const hitKey = `lerm:${target.id}`;
      if (particle.hitTargets?.has(hitKey)) continue;
      particle.hitTargets?.add(hitKey);
      const direction = normalize3(sub(particle.position, position), [0, 0, -1]);
      const impulse = mul(direction, particle.strength * (particle.chemistry === 'knockback' ? 1.2 : 0.54));
      target.impulse = add(target.impulse, impulse);
      target.hits += 1;
      lermImpulseCount += 1;
      eventLog.push({ type: 'lerm_impulse', id: target.id, emitter_id: particle.emitter_id, impulse: impulse.map(value => round(value, 3)) });
    }
    for (const target of goins) {
      const position = vec3(target.position);
      const delta = sub(position, particle.position);
      const distance = length3(delta);
      const radius = finite(target.radius, 0.13) + particle.radius;
      if (distance > radius) continue;
      const hitKey = `goin:${target.id}`;
      if (particle.hitTargets?.has(hitKey)) continue;
      particle.hitTargets?.add(hitKey);
      const direction = normalize3(sub(particle.position, position), [0, 0, -1]);
      const impulse = mul(direction, particle.strength * (particle.chemistry === 'pooling' ? 0.42 : 0.72));
      target.impulse = add(target.impulse, impulse);
      target.hits += 1;
      goinImpulseCount += 1;
      eventLog.push({ type: 'goin_impulse', id: target.id, emitter_id: particle.emitter_id, impulse: impulse.map(value => round(value, 3)) });
    }
    if (eventLog.length > 32) eventLog = eventLog.slice(-32);
  }

  function step(dt = 1 / 60) {
    const safeDt = clamp(dt, 1 / 240, 1 / 20);
    stepCount += 1;
    spawnParticles(safeDt);
    const next = [];
    for (const particle of particles) {
      particle.age += safeDt;
      if (particle.age >= particle.life) continue;
      if (particle.phase === 'airborne') {
        particle.velocity[1] -= 5.2 * safeDt;
        particle.position = add(particle.position, mul(particle.velocity, safeDt));
        const ground = currentTerrainHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.35;
        if (particle.position[1] <= ground) {
          particle.position[1] = ground;
          particle.phase = 'surface_flow';
          particle.surface_flow = true;
          particle.velocity = add(
            slideVelocityOnTerrain(particle.velocity, currentTerrainNormalAt(particle.position[0], particle.position[2]), particle.chemistry),
            mul(currentSurfaceVelocityAt(particle.position[0], particle.position[2]), 0.18),
          );
          particle.visual_trail = [...(particle.visual_trail || []), trailSample(particle.position, 'impact', particle.velocity)];
          particle.phase_markers = [...(particle.phase_markers || []), trailSample(particle.position, 'impact', particle.velocity)].slice(-6);
        }
      } else {
        particle.surface_flow = true;
        particle.pooling = particle.chemistry === 'pooling' || length3(particle.velocity) < 0.18;
        particle.velocity = add(
          slideVelocityOnTerrain(particle.velocity, currentTerrainNormalAt(particle.position[0], particle.position[2]), particle.chemistry),
          mul(currentSurfaceVelocityAt(particle.position[0], particle.position[2]), 0.12),
        );
        particle.position = add(particle.position, mul(particle.velocity, safeDt));
        particle.position[1] = currentTerrainHeightAt(particle.position[0], particle.position[2]) + particle.radius * 0.25;
      }
      maxRangeZ = Math.max(maxRangeZ, particle.position[2] + 0.82);
      particle.visual_trail = [...(particle.visual_trail || []), trailSample(particle.position, particle.phase, particle.velocity)];
      if (particle.visual_trail.length > 24) particle.visual_trail = particle.visual_trail.slice(-24);
      applyTargetImpulses(particle);
      next.push(particle);
    }
    particles = next.slice(-maxParticles);
    return debugState();
  }

  function debugState() {
    const airborneCount = particles.filter(particle => particle.phase === 'airborne').length;
    const surfaceFlowCount = particles.filter(particle => particle.surface_flow).length;
    const poolingCount = particles.filter(particle => particle.pooling || particle.chemistry === 'pooling' && particle.surface_flow).length;
    const trailCandidates = particles
      .filter(particle => (particle.visual_trail || []).length >= 2)
      .map(particle => ({
        id: particle.id,
        emitter_id: particle.emitter_id,
        chemistry: particle.chemistry,
        phase: particle.phase,
        surface_flow: particle.surface_flow,
        source_anchor: particle.source_anchor ? {
          position: particle.source_anchor.position.map(value => round(value, 4)),
          phase: particle.source_anchor.phase,
        } : null,
        phase_markers: (particle.phase_markers || []).map(sample => ({
          position: sample.position.map(value => round(value, 4)),
          phase: sample.phase,
          velocity_hint: sample.velocity_hint.map(value => round(value, 4)),
        })),
        samples: particle.visual_trail.map(sample => ({
          position: sample.position.map(value => round(value, 4)),
          phase: sample.phase,
          velocity_hint: sample.velocity_hint.map(value => round(value, 4)),
        })),
      }));
    const trailsByEmitter = new Map();
    for (const trail of trailCandidates) {
      const list = trailsByEmitter.get(trail.emitter_id) || [];
      list.push(trail);
      trailsByEmitter.set(trail.emitter_id, list);
    }
    const trails = [...trailsByEmitter.values()].flatMap(list => list.slice(-54));
    const trailSamples = trails.flatMap(trail => trail.samples);
    const phaseMarkers = trails.flatMap(trail => trail.phase_markers || []);
    const trailEmitterCount = new Set(trails.map(trail => trail.emitter_id)).size;
    const surfaceStreakCount = trails.filter(trail => trail.surface_flow || trail.samples.some(sample => sample.phase === 'surface_flow')).length;
    const zValues = trailSamples.map(sample => sample.position[2]);
    const trailSpanZ = zValues.length > 0 ? Math.max(...zValues) - Math.min(...zValues) : 0;
    const sourceAnchorCount = new Set(trails.filter(trail => trail.source_anchor).map(trail => trail.emitter_id)).size;
    const segmentLengths = trails.flatMap(trail => trail.samples.slice(1).map((sample, index) => {
      const previous = trail.samples[index];
      return length3(sub(sample.position, previous.position));
    }));
    const maxTrailSegmentLength = segmentLengths.length > 0 ? Math.max(...segmentLengths) : 0;
    const airborneBreadcrumbCount = [...trailSamples, ...phaseMarkers].filter(sample => sample.phase === 'airborne').length;
    const impactRingCount = [...trailSamples, ...phaseMarkers].filter(sample => sample.phase === 'impact').length;
    const surfaceSmearCount = trailSamples.filter(sample => sample.phase === 'surface_flow').length;
    const supportFrame = currentSupportFrame();
    const substrateReservoirDiagnostics = createReservoirDomainDiagnostics(particles, supportFrame);
    return {
      schema: 'lerms.world-finger-juice-debug.v0',
      effectiveRoute: LERMS_WORLD_FINGER_JUICE_ROUTE,
      emitterSchema: LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA,
      terrainContract: LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT,
      arcContract: LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT,
      packet_id: emitters.packet_id,
      source_route: emitters.source_route,
      source_backend: emitters.source_backend,
      source_frame_id: emitters.source_frame_id,
      sidecar_sequence: emitters.sidecar_sequence,
      evidence_kind: emitters.evidence_kind,
      simulation_authority: emitters.simulation_authority,
      stepCount,
      particleCount: particles.length,
      airborneCount,
      surfaceFlowCount,
      poolingCount,
      trailSampleCount: trailSamples.length,
      trailEmitterCount,
      surfaceStreakCount,
      trailSpanZ: round(trailSpanZ, 4),
      sourceAnchorCount,
      maxTrailSegmentLength: round(maxTrailSegmentLength, 4),
      airborneBreadcrumbCount,
      impactRingCount,
      surfaceSmearCount,
      lermImpulseCount,
      goinImpulseCount,
      maxRangeZ: round(maxRangeZ, 4),
      terrain_frame: emitters.terrain_frame,
      hand_sample_space: emitters.hand_sample_space,
      lerms_world_frame: emitters.lerms_world_frame,
      authority: emitters.authority,
      activeEmitterCount: emitters.active_emitter_count,
      supportFrame,
      terrainSampleDiagnostics: currentTerrainSampleDiagnostics(),
      substrateReservoirDiagnostics,
      activeReservoirDomains: substrateReservoirDiagnostics.activeReservoirDomains,
      heightfieldSamples: [-0.75, -0.35, 0, 0.35, 0.75].map(x => ({ x, z: 0, y: round(currentTerrainHeightAt(x, 0), 4) })),
      particles: particles.slice(0, 96).map(particle => ({
        id: particle.id,
        emitter_id: particle.emitter_id,
        chemistry: particle.chemistry,
        phase: particle.phase,
        surface_flow: particle.surface_flow,
        pooling: particle.pooling,
        source_anchor: particle.source_anchor ? {
          position: particle.source_anchor.position.map(value => round(value, 4)),
          phase: particle.source_anchor.phase,
          velocity_hint: particle.source_anchor.velocity_hint.map(value => round(value, 4)),
        } : null,
        phase_markers: (particle.phase_markers || []).map(sample => ({
          position: sample.position.map(value => round(value, 4)),
          phase: sample.phase,
          velocity_hint: sample.velocity_hint.map(value => round(value, 4)),
        })),
        visual_trail: (particle.visual_trail || []).slice(-6).map(sample => ({
          position: sample.position.map(value => round(value, 4)),
          phase: sample.phase,
          velocity_hint: sample.velocity_hint.map(value => round(value, 4)),
        })),
        position: particle.position.map(value => round(value, 4)),
        velocity: particle.velocity.map(value => round(value, 4)),
      })),
      trails,
      targets: {
        lerms: lerms.map(target => ({
          id: target.id,
          position: vec3(target.position).map(value => round(value, 4)),
          radius: round(target.radius ?? 0.16, 4),
          hits: target.hits,
          impulse: target.impulse.map(value => round(value, 4)),
        })),
        goins: goins.map(target => ({
          id: target.id,
          position: vec3(target.position).map(value => round(value, 4)),
          radius: round(target.radius ?? 0.13, 4),
          hits: target.hits,
          impulse: target.impulse.map(value => round(value, 4)),
        })),
      },
      recentEvents: eventLog.slice(-12),
    };
  }

  return {
    setEmitters(packet) {
      emitters = normalizeWorldFingerJuiceEmitterPacket(packet);
      return emitters;
    },
    setTerrainSampleSurface(surface = null) {
      terrainSampleSurface = surface;
      return currentTerrainSampleDiagnostics();
    },
    step,
    debugState,
    terrainHeightAt: currentTerrainHeightAt,
  };
}
