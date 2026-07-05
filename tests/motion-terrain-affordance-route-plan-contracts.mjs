import assert from 'node:assert/strict';

import {
  HILL_OF_HILLS_MOTION_AFFORDANCE_DATA_SCHEMA,
  HILL_OF_HILLS_MOTION_AFFORDANCE_PACKET_SCHEMA,
  MOTION_TERRAIN_AFFORDANCE_SOURCE_SCHEMA,
  MOTION_ROUTE_PLAN_SCHEMA,
  createMotionRoutePlanFromTerrainAffordance,
  decodeHillMotionAffordancePacket,
  sampleMotionRoutePlan,
} from '../motion-core.js';

function encodeF32(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(Number(value), index * 4));
  return buffer.toString('base64');
}

function channel(values, components = ['value']) {
  return {
    encoding: 'base64-f32-le',
    components,
    shape: components.length === 1 ? [values.length] : [values.length / components.length, components.length],
    byteLength: values.length * 4,
    checksum: `test-${components.join('-')}-${values.length}`,
    data: encodeF32(values),
  };
}

function makeHillPacketPair(overrides = {}) {
  const columns = 5;
  const rows = 5;
  const sampleCount = columns * rows;
  const scalar = Array.from({ length: sampleCount }, () => 0);
  const routePressure = Array.from({ length: sampleCount }, () => 0.82);
  const slope = Array.from({ length: sampleCount }, () => 0.08);
  const dirty = Array.from({ length: sampleCount }, () => 0);
  const shock = Array.from({ length: sampleCount }, () => 0);
  dirty[12] = 1;
  shock[12] = 1;
  routePressure[12] = 0;
  slope[12] = 1;
  const vec2 = [];
  const vec3 = [];
  for (let i = 0; i < sampleCount; i++) {
    vec2.push(0, 0);
    vec3.push(0, 1, 0);
  }
  const channelLayout = [
    'height',
    'normal',
    'gradient',
    'slope',
    'heightDelta',
    'surfaceVelocity',
    'routePressure',
    'flowAccumulation',
    'ridgeStrength',
    'valleyStrength',
    'ditchPotential',
    'growthPotential',
    'phaseAmount',
    'topologyAmount',
    'wetness',
    'growthTint',
    'materialClass',
    'regionClass',
    'motionHint',
    'assetHint',
    'dirty',
    'shock',
  ];
  const checksums = {
    supportFrame: 'support-test',
    topology: 'topology-test',
    material: 'material-test',
    phase: 'phase-test',
    phaseInfluence: 'phase-influence-test',
    dirtyRegion: 'dirty-test',
    channels: 'channels-test',
  };
  const sourceTruth = {
    schema: 'lerms.source-truth.v0',
    authority: 'live_simulation',
    route: 'hill-of-hills/motion-affordance-packet',
    frameId: 'test-hill-frame',
    timestampMs: 1783208595378,
    sampleAgeMs: 0,
    backend: 'deterministic-cpu-heightfield',
    configId: 'hill-of-hills-motion-affordance-packet-v0',
  };
  const grid = {
    columns,
    rows,
    sampleCount,
    spacing: { x: 1, z: 1 },
  };
  const worldBounds = {
    x: { min: 0, max: 4 },
    y: { min: 0, max: 1 },
    z: { min: 0, max: 4 },
    label: 'test-world',
  };
  const data = {
    schema: HILL_OF_HILLS_MOTION_AFFORDANCE_DATA_SCHEMA,
    sourceTruth,
    intentEvidenceOnly: true,
    grid,
    worldBounds,
    domainBounds: { u: { min: 0, max: 1 }, v: { min: 0, max: 1 } },
    checksums,
    channelLayout,
    channels: {
      height: channel(scalar, ['height']),
      normal: channel(vec3, ['x', 'y', 'z']),
      gradient: channel(vec2, ['x', 'z']),
      slope: channel(slope, ['slope']),
      heightDelta: channel(scalar, ['heightDelta']),
      surfaceVelocity: channel(vec3, ['x', 'y', 'z']),
      routePressure: channel(routePressure, ['routePressure']),
      flowAccumulation: channel(scalar, ['flowAccumulation']),
      ridgeStrength: channel(scalar, ['ridgeStrength']),
      valleyStrength: channel(scalar, ['valleyStrength']),
      ditchPotential: channel(scalar, ['ditchPotential']),
      growthPotential: channel(scalar, ['growthPotential']),
      phaseAmount: channel(scalar, ['phaseAmount']),
      topologyAmount: channel(scalar, ['topologyAmount']),
      wetness: channel(scalar, ['wetness']),
      growthTint: channel(scalar, ['growthTint']),
      materialClass: channel(scalar, ['materialClass']),
      regionClass: channel(scalar, ['regionClass']),
      motionHint: channel(scalar, ['motionHint']),
      assetHint: channel(scalar, ['assetHint']),
      dirty: channel(dirty, ['dirty']),
      shock: channel(shock, ['shock']),
    },
  };
  const packet = {
    ok: true,
    schema: HILL_OF_HILLS_MOTION_AFFORDANCE_PACKET_SCHEMA,
    route: 'lerms/hill-of-hills/motion-affordance-packet-file',
    frameId: 'test-hill-frame',
    label: 'Hill terrain motion affordance packet for Mushfinger',
    status: 'fresh-live-motion-affordance',
    freshness: {
      observedAt: '2026-07-04T23:43:15.378Z',
      generatedAt: '2026-07-04T23:43:15.378Z',
      budgetMs: 900000,
      status: 'fresh-live-motion-affordance',
      sampleAgeMs: 0,
    },
    source: {
      authority: 'live_simulation',
      producerDiaulos: 'hill-of-hills-fucker',
      intendedConsumerDiaulos: 'mushfinger-clayfucker',
      sourceRef: 'lerms:cc/hill-of-hills-live-terrain-server-0702@dc1a676',
      route: 'lerms/hill-of-hills/motion-affordance-packet-file',
      configId: 'hill-of-hills-motion-affordance-packet-v0',
      backend: 'deterministic-cpu-heightfield',
    },
    affordance: {
      schema: 'lerms.hill-of-hills.motion-affordance-summary.v0',
      route: 'lerms/hill-of-hills/motion-affordance-fetch',
      sourceTruth,
      intentEvidenceOnly: true,
      grid,
      worldBounds,
      domainBounds: data.domainBounds,
      supportFrame: {
        supportEpoch: 0,
        topologyEpoch: 0,
        checksum: checksums.supportFrame,
        supportClass: 'single_valued_heightfield',
        mappingMode: 'static_domain_to_world',
        maxHeightDelta: 0,
        maxSurfaceSpeed: 0,
      },
      dirty: { dirtyTileCount: 1, dirtySampleCount: 1, dirtyRegionChecksum: checksums.dirtyRegion, dirtyLayerKinds: ['test'] },
      shock: { classCounts: { none: 24, contact: 1 }, motionClassCounts: { stable: 24, phase_morph: 1 } },
      channelLayout,
      transport: { kind: 'source-owned-fetch-url', encoding: 'json-base64-f32-le', fetchUrl: '/test-data.json', dataPath: '/tmp/test-data.json', byteOrder: 'little-endian', byteLengths: {} },
      checksums,
    },
    rejectedDebugSurfaces: [{
      id: 'hill-local-canvas-debug',
      route: 'http://127.0.0.1:5187/',
      acceptanceSurface: false,
      reason: 'debug canvas is not evidence',
    }],
    custody: {
      sourceOwns: ['terrain affordance source truth'],
      mushfingerOwns: ['actor route intent interpretation'],
      kaminosOwns: ['packet mounting'],
    },
    ...overrides.packet,
  };
  return {
    packet,
    data: {
      ...data,
      ...overrides.data,
    },
  };
}

const pair = makeHillPacketPair();
const source = decodeHillMotionAffordancePacket(pair);

assert.equal(source.schema, MOTION_TERRAIN_AFFORDANCE_SOURCE_SCHEMA);
assert.equal(source.source.schema, HILL_OF_HILLS_MOTION_AFFORDANCE_PACKET_SCHEMA);
assert.equal(source.data.schema, HILL_OF_HILLS_MOTION_AFFORDANCE_DATA_SCHEMA);
assert.equal(source.sourceRef, 'lerms:cc/hill-of-hills-live-terrain-server-0702@dc1a676');
assert.equal(source.authority, 'live_simulation');
assert.equal(source.intentEvidenceOnly, true);
assert.equal(source.grid.sampleCount, 25);
assert.equal(source.channelLayout.length, 22);
assert.equal(source.checksums.channels, 'channels-test');
assert.equal(source.channels.routePressure.values[0], Math.fround(0.82));
assert.equal(source.channels.normal.componentCount, 3);
assert.equal(source.rejectedDebugSurfaces[0].acceptanceSurface, false);

assert.throws(
  () => decodeHillMotionAffordancePacket(makeHillPacketPair({ packet: { status: 'stale-motion-affordance' } })),
  /fresh-live-motion-affordance/,
  'adapter rejects stale Hill motion affordance packets',
);
assert.throws(
  () => decodeHillMotionAffordancePacket(makeHillPacketPair({ packet: { source: { ...pair.packet.source, authority: 'synthetic_fixture' } } })),
  /live_simulation/,
  'adapter rejects fallback or fixture authority for Hill live route planning',
);
assert.throws(
  () => decodeHillMotionAffordancePacket(makeHillPacketPair({ data: { checksums: { ...pair.data.checksums, channels: 'different' } } })),
  /checksum/i,
  'adapter rejects packet/data checksum identity mismatch',
);
const badShape = makeHillPacketPair();
badShape.data.channels.routePressure = { ...badShape.data.channels.routePressure, shape: [24] };
assert.throws(
  () => decodeHillMotionAffordancePacket(badShape),
  /shape/i,
  'adapter rejects missing or partial channel data instead of planning over it',
);

const plan = createMotionRoutePlanFromTerrainAffordance(source, {
  id: 'test-hill-route',
  start: [0, 0, 0],
  goal: [4, 0, 4],
  actorRadius: 0.2,
  costWeights: {
    routePressure: 2.4,
    slope: 4,
    dirty: 40,
    shock: 40,
    heightDelta: 2,
    surfaceVelocity: 1,
  },
});

assert.equal(plan.schema, MOTION_ROUTE_PLAN_SCHEMA);
assert.equal(plan.source.schema, MOTION_TERRAIN_AFFORDANCE_SOURCE_SCHEMA);
assert.equal(plan.source.sourceRef, source.sourceRef);
assert.equal(plan.source.checksums.channels, 'channels-test');
assert.equal(plan.authority, 'terrain-affordance-route-plan');
assert.equal(plan.routePoints[0].world[0], 0);
assert.equal(plan.routePoints.at(-1).world[0], 4);
assert.ok(plan.routePoints.length >= 5, 'route plan exposes a multi-point path');
assert.equal(
  plan.routePoints.some(point => point.grid.column === 2 && point.grid.row === 2),
  false,
  'route plan avoids the dirty/shock center cell when a clean route exists',
);
assert.ok(plan.cost.total > 0, 'route plan records accumulated route cost');
assert.ok(plan.evidence.costBasis.includes('routePressure'), 'route plan names Hill cost channels');
assert.ok(plan.evidence.costBasis.includes('dirty'), 'route plan names dirty/shock penalty channels');

const mid = sampleMotionRoutePlan(plan, 0.5);
assert.equal(mid.schema, 'kaminos.motion-route-plan-sample.v0');
assert.equal(mid.routePlanId, 'test-hill-route');
assert.ok(mid.progress >= 0.49 && mid.progress <= 0.51);
assert.equal(Array.isArray(mid.root), true);
assert.equal(Array.isArray(mid.facing), true);
