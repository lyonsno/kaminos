import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const hostCorePath = join(root, 'finger-juice-host-core.js');
const hostWitnessPath = join(root, 'finger-juice-host-witness.mjs');
const indexPath = join(root, 'index.html');

assert.ok(existsSync(hostCorePath), 'Kaminos native finger-juice host core exists');
assert.ok(existsSync(hostWitnessPath), 'Kaminos native finger-juice host witness exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');

const hostCoreSource = readFileSync(hostCorePath, 'utf8');
const hostWitnessSource = readFileSync(hostWitnessPath, 'utf8');
const indexSource = readFileSync(indexPath, 'utf8');

assert.match(hostCoreSource, /KAMINOS_FINGER_JUICE_HOST_STATE_SCHEMA\s*=\s*'kaminos\.finger-juice-host\.state\.v0'/, 'native host state schema is explicit');
assert.match(hostCoreSource, /KAMINOS_FINGER_JUICE_HOST_ROUTE\s*=\s*'kaminos\/finger-juice-host'/, 'native host route identity is explicit');
assert.match(hostCoreSource, /BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA\s*=\s*'big-papa-finger-juice\.host-packet\.v0'/, 'host core preserves Big Papa packet schema identity');
assert.match(hostCoreSource, /BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE\s*=\s*'big-papa\/finger-juice\/host-packet'/, 'host core preserves Big Papa source route identity');
assert.match(hostCoreSource, /normalizeFingerJuiceHostPacket/, 'host core exports host packet normalization');
assert.match(hostCoreSource, /createFingerJuiceHostState/, 'host core exports Kaminos host-state creation');
assert.match(hostCoreSource, /host_packet_preview_payload_not_native_render_buffer/, 'host core keeps native render-buffer downgrade loud');
assert.match(hostCoreSource, /preview_particle_samples_not_full_render_buffer/, 'host core keeps preview sample downgrade loud');
assert.match(hostCoreSource, /direct_lerms_finger_juice_debug_route/, 'host core preserves rejected debug route evidence');

assert.match(indexSource, /data-tab="finger-juice-host"/, 'Kaminos sidebar exposes a native Finger Juice host tab');
assert.match(indexSource, /id="tab-finger-juice-host"/, 'Kaminos app shell contains native Finger Juice host content');
assert.match(indexSource, /kaminos_finger_juice_host=1/, 'Kaminos route can open directly into the native host');
assert.match(indexSource, /finger_juice_host_root/, 'native host supports file-root packet loading');
assert.match(indexSource, /finger_juice_host_path/, 'native host supports file-path packet loading');
assert.match(indexSource, /finger_juice_host_url/, 'native host supports direct packet URL loading');
assert.match(indexSource, /id="finger-juice-host-canvas"/, 'native host owns a canvas instead of accepting an iframe as the host surface');
assert.match(indexSource, /window\.kaminosFingerJuiceHostDebugState/, 'native host exposes state for browser witnesses');
assert.match(indexSource, /kaminos\/finger-juice-host/, 'native host displays its route identity');
assert.match(indexSource, /big-papa-finger-juice\.host-packet\.v0/, 'native host displays Big Papa packet schema identity');
assert.match(indexSource, /host_packet_preview_payload_not_native_render_buffer/, 'native host displays render-buffer downgrade');
assert.match(indexSource, /finger-juice-host-open-direct/, 'native host keeps direct debug route as an explicit escape hatch');

assert.match(hostWitnessSource, /kaminos_finger_juice_host=1/, 'host witness opens the native host route');
assert.match(hostWitnessSource, /kaminosFingerJuiceHostDebugState/, 'host witness reads native host debug state');
assert.match(hostWitnessSource, /big-papa-finger-juice\.host-packet\.v0/, 'host witness requires Big Papa packet schema');
assert.match(hostWitnessSource, /host_packet_preview_payload_not_native_render_buffer/, 'host witness requires downgraded render payload evidence');
assert.match(hostWitnessSource, /primary_output_written/, 'host witness writes durable failure reports even before the primary screenshot succeeds');

const mod = await import(hostCorePath);
assert.equal(mod.KAMINOS_FINGER_JUICE_HOST_STATE_SCHEMA, 'kaminos.finger-juice-host.state.v0');
assert.equal(mod.KAMINOS_FINGER_JUICE_HOST_ROUTE, 'kaminos/finger-juice-host');
assert.equal(mod.BIG_PAPA_FINGER_JUICE_HOST_PACKET_SCHEMA, 'big-papa-finger-juice.host-packet.v0');
assert.equal(mod.BIG_PAPA_FINGER_JUICE_HOST_PACKET_ROUTE, 'big-papa/finger-juice/host-packet');

const packet = {
  schema: 'big-papa-finger-juice.host-packet.v0',
  route: 'big-papa/finger-juice/host-packet',
  packetUrl: '/api/read?root=lerms-preview&path=big-papa-finger-juice-host-packet.json',
  source: {
    producerDiaulos: 'big-papa-finger-juice-fucker',
    route: 'big-papa/finger-juice/host-packet',
    sourceRef: 'cc/big-papa-finger-juice-0626@host-packet-test',
    authority: 'synthetic_fixture',
    sourceTruthAuthority: 'synthetic_fixture',
  },
  freshness: {
    status: 'fresh',
    budgetMs: 1500,
    observedAt: '2026-06-30T00:00:00.000Z',
    generatedAt: '2026-06-30T00:00:00.000Z',
  },
  terrain: {
    couplingMode: 'source_height_samples_v0',
    supportFrameChecksum: 'support-frame-test',
    sampleChecksum: 'hill-live-sample',
    channelChecksum: 'hill-live-channels',
    heightRange: { min: 0.2, max: 0.9 },
  },
  solver: {
    solverRoute: 'webgpu_particle_solver_v0',
    backend: 'webgpu_compute',
    particleCount: 3,
    chemistryCounts: { knockback: 1, pooling: 1, weird: 1 },
    bounds: { min: [-0.2, 0.1, -0.4], max: [0.3, 0.8, 0.5] },
  },
  render: {
    route: 'webgpu_particle_splat_renderer_v0',
    backend: 'webgpu_direct_render',
    payload: {
      schema: 'big-papa-finger-juice.render-payload.preview.v0',
      downgraded: true,
      downgrades: ['preview_particle_samples_not_full_render_buffer'],
      particleSamples: [
        { id: 'p0', position: [-0.2, 0.25, -0.25], color: [1, 0.25, 0.08, 0.9], radius: 0.04, chemistry: 'knockback' },
        { id: 'p1', position: [0.1, 0.45, 0.1], color: [0.3, 0.75, 1, 0.8], radius: 0.05, chemistry: 'pooling' },
        { id: 'p2', position: [0.25, 0.35, 0.35], color: [0.8, 0.35, 1, 0.75], radius: 0.045, chemistry: 'weird' },
      ],
      trailSamples: [
        { id: 't0', samples: [{ position: [-0.2, 0.22, -0.25] }, { position: [-0.05, 0.24, -0.05] }, { position: [0.1, 0.25, 0.12] }], color: [1, 0.25, 0.08, 0.75] },
      ],
    },
  },
  hitRefs: { events: [{ schema: 'lerms.juice-hit-event.v0', targetKind: 'goin' }] },
  visual: {
    bounds: { min: [-0.3, 0.1, -0.5], max: [0.4, 0.9, 0.6] },
    cameraHints: { presets: [{ id: 'operator-oblique', eye: [1.2, 1.0, 1.5], lookAt: [0, 0.35, 0], up: [0, 1, 0] }] },
    chemistryMaterials: { knockback: '#ff5a20', pooling: '#64c7ff', weird: '#d675ff' },
  },
  custody: {
    bigPapaOwns: ['fluid law', 'source packet semantics'],
    kaminosOwns: ['native host display', 'camera', 'interaction'],
    downgrades: ['host_packet_preview_payload_not_native_render_buffer'],
    rejectedDebugSurfaces: [{ surface: 'direct_lerms_finger_juice_debug_route', acceptanceSurface: false }],
  },
};

const normalized = mod.normalizeFingerJuiceHostPacket(packet);
assert.equal(normalized.schema, 'big-papa-finger-juice.host-packet.v0', 'normalizer preserves Big Papa schema');
assert.equal(normalized.route, 'big-papa/finger-juice/host-packet', 'normalizer preserves Big Papa route');
assert.equal(normalized.source.authority, 'synthetic_fixture', 'normalizer preserves source authority');
assert.equal(normalized.source.sourceTruthAuthority, 'synthetic_fixture', 'normalizer preserves source-truth authority separately');
assert.equal(normalized.terrain.sampleChecksum, 'hill-live-sample', 'normalizer preserves terrain sample checksum');
assert.equal(normalized.terrain.channelChecksum, 'hill-live-channels', 'normalizer preserves terrain channel checksum');
assert.equal(normalized.render.payload.downgraded, true, 'normalizer preserves render payload downgrade');
assert.equal(normalized.render.payload.particles.length, 3, 'normalizer preserves preview particle samples');
assert.deepEqual(normalized.render.payload.trails[0].samples[1], [-0.05, 0.24, -0.05], 'normalizer accepts trail sample position objects');
assert.ok(normalized.custody.downgrades.includes('host_packet_preview_payload_not_native_render_buffer'), 'normalizer preserves native render-buffer downgrade');
assert.ok(normalized.custody.rejectedDebugSurfaces.some(surface => surface.acceptanceSurface === false), 'normalizer preserves rejected debug surfaces');

const state = mod.createFingerJuiceHostState(normalized, {
  effectiveUrl: '/api/read?root=lerms-preview&path=big-papa-finger-juice-host-packet.json',
});
assert.equal(state.schema, 'kaminos.finger-juice-host.state.v0', 'host state uses Kaminos-owned schema');
assert.equal(state.route, 'kaminos/finger-juice-host', 'host state uses Kaminos-owned route');
assert.equal(state.packetSchema, 'big-papa-finger-juice.host-packet.v0', 'host state reports source packet schema');
assert.equal(state.packetRoute, 'big-papa/finger-juice/host-packet', 'host state reports source packet route');
assert.equal(state.sourceAuthority, 'synthetic_fixture', 'host state reports source authority');
assert.equal(state.sourceTruthAuthority, 'synthetic_fixture', 'host state reports source-truth authority');
assert.equal(state.renderPayloadSchema, 'big-papa-finger-juice.render-payload.preview.v0', 'host state reports downgraded render payload schema');
assert.equal(state.renderDowngraded, true, 'host state reports render downgrade');
assert.equal(state.previewParticleCount, 3, 'host state reports native preview particle count');
assert.equal(state.hitEventCount, 1, 'host state reports hit refs');
assert.equal(state.terrain.sampleChecksum, 'hill-live-sample', 'host state preserves terrain sample checksum');
assert.ok(state.downgrades.includes('host_packet_preview_payload_not_native_render_buffer'), 'host state surfaces native render-buffer downgrade');
assert.ok(state.rejectedDebugSurfaces.some(surface => surface.surface === 'direct_lerms_finger_juice_debug_route'), 'host state surfaces rejected debug route');
