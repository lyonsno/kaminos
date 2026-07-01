import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const toolsPath = join(root, 'host-surface-tools.mjs');
const lermsFixturePath = join(root, 'tests/fixtures/lerms-moving-timeline-host-smoke.json');

assert.ok(existsSync(toolsPath), 'producer-side host-surface validator tool exists');

const toolsSource = readFileSync(toolsPath, 'utf8');
assert.match(toolsSource, /lintHostSurfacePacket/, 'tool exports lintHostSurfacePacket');
assert.match(toolsSource, /buildHostSurfaceSmokeUrl/, 'tool exports buildHostSurfaceSmokeUrl');
assert.match(toolsSource, /buildHostSurfaceWitnessCommand/, 'tool exports buildHostSurfaceWitnessCommand');
assert.match(toolsSource, /host-surface-witness\.mjs/, 'tool emits generic host-surface witness command');

const tools = await import(toolsPath);

assert.equal(tools.KAMINOS_HOST_SURFACE_TOOLS_REPORT_SCHEMA, 'kaminos.host-surface.tools-report.v0');
assert.equal(typeof tools.lintHostSurfacePacket, 'function');
assert.equal(typeof tools.buildHostSurfaceSmokeUrl, 'function');
assert.equal(typeof tools.buildHostSurfaceWitnessCommand, 'function');

const lermsPacket = JSON.parse(readFileSync(lermsFixturePath, 'utf8'));
assert.equal(lermsPacket.timeline.timeline.length, 8, 'fixture should carry the current LERMS contested timeline, not the old tiny host stub');
assert.equal(lermsPacket.timeline.durationMs, 8200, 'fixture should preserve LERMS source timeline pacing');
assert.ok(lermsPacket.timeline.timeline.some(frame => frame.label === 'contest'), 'fixture should include contested loose-goin behavior');
assert.ok(lermsPacket.timeline.timeline.some(frame => frame.actorMotion?.some(actor => actor.actorId === 'red-lerm-006')), 'fixture should include the contest loser identity');
assert.ok(lermsPacket.timeline.behaviorLedger?.beats?.some(beat => beat.visibleActivityCue?.style === 'partial-ground-ring'), 'fixture should carry source activity readout hints');
const lermsReport = tools.lintHostSurfacePacket(lermsPacket, {
  adapter: 'lerms-moving-timeline',
  sourceUrl: '/tests/fixtures/lerms-moving-timeline-host-smoke.json',
  serverOrigin: 'http://127.0.0.1:18142',
  debugPort: 9601,
  settleMs: 3000,
  hookWaitMs: 25000,
});

assert.equal(lermsReport.ok, true);
assert.equal(lermsReport.schema, 'kaminos.host-surface.tools-report.v0');
assert.equal(lermsReport.hostId, 'lerms-moving-timeline');
assert.equal(lermsReport.hostRoute, 'kaminos/lerms-moving-timeline-host');
assert.equal(lermsReport.packetSchema, 'lerms.preview-bench-actor-motion-timeline.v0');
assert.equal(lermsReport.packetRoute, 'lerms/preview-bench/actor-motion-timeline-file');
assert.equal(lermsReport.sourceAuthority, 'source-owned-timeline-packet');
assert.equal(lermsReport.sourceTruthAuthority, 'lerms.timelineBehaviorTruth');
assert.ok(lermsReport.downgrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(lermsReport.sourceDowngrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(lermsReport.sourceCustody.lermsOwns.includes('timelineBehaviorTruth'));
assert.ok(lermsReport.sourceCustody.gutterglassOwns.includes('Preview Bench playback and camera witness mechanics'));
assert.ok(lermsReport.sourceCustody.kaminosOwns.includes('Preview Bench playback and camera witness mechanics'), 'generic host-surface custody aliases Gutterglass display ownership into kaminosOwns');
assert.equal(lermsReport.sourceCustody.kaminosOwnsSourceAlias, 'gutterglassOwns');
assert.ok(lermsReport.rejectedDebugSurfaces.some(surface => surface.surface === 'old_8790_actor_timeline_debug_route' && surface.acceptanceSurface === false));
assert.equal(lermsReport.errorCount, 0);
assert.equal(lermsReport.smokeUrl, 'http://127.0.0.1:18142/index.html?kaminos_lerms_moving_timeline_host=1&world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview&lerms_actor_motion_timeline_url=%2Ftests%2Ffixtures%2Flerms-moving-timeline-host-smoke.json');
assert.match(lermsReport.witnessCommand, /node host-surface-witness\.mjs/);
assert.match(lermsReport.witnessCommand, /--url 'http:\/\/127\.0\.0\.1:18142\/index\.html\?kaminos_lerms_moving_timeline_host=1&/, 'witness command quotes URLs that contain shell separators');
assert.match(lermsReport.witnessCommand, /--expected-host-id lerms-moving-timeline/);
assert.match(lermsReport.witnessCommand, /--expected-packet-schema lerms\.preview-bench-actor-motion-timeline\.v0/);
assert.match(lermsReport.witnessCommand, /--expected-downgrade timeline_playback_not_behavior_engine/);
assert.match(lermsReport.witnessCommand, /--debug-port 9601/);
assert.match(lermsReport.witnessCommand, /--settle-ms 3000/);
assert.match(lermsReport.witnessCommand, /--hook-wait-ms 25000/);

const badLermsPacket = structuredClone(lermsPacket);
badLermsPacket.timeline.downgrades = [];
badLermsPacket.timeline.custody = {};
const badReport = tools.lintHostSurfacePacket(badLermsPacket, {
  adapter: 'lerms-moving-timeline',
  sourceUrl: '/tests/fixtures/bad.json',
});
assert.equal(badReport.ok, false);
assert.ok(badReport.errors.some(error => error.includes('missing required downgrade: timeline_playback_not_behavior_engine')));
assert.ok(badReport.errors.some(error => error.includes('custody missing lermsOwns')));
assert.ok(badReport.errors.some(error => error.includes('custody missing kaminosOwns')));
assert.ok(badReport.smokeUrl, 'bad reports still emit a route for local repro');
assert.ok(badReport.witnessCommand, 'bad reports still emit witness command text for local repro');

const missingCustodyPacket = structuredClone(lermsPacket);
delete missingCustodyPacket.timeline.custody;
const missingCustodyReport = tools.lintHostSurfacePacket(missingCustodyPacket, {
  adapter: 'lerms-moving-timeline',
  sourceUrl: '/tests/fixtures/missing-custody.json',
});
assert.equal(missingCustodyReport.ok, false);
assert.ok(missingCustodyReport.errors.some(error => error.includes('custody missing lermsOwns')), 'absent producer custody must not be filled by host defaults');
assert.ok(missingCustodyReport.errors.some(error => error.includes('custody missing kaminosOwns')), 'absent producer custody must fail all required custody fields');

const nullCustodyPacket = structuredClone(lermsPacket);
nullCustodyPacket.timeline.custody = null;
const nullCustodyReport = tools.lintHostSurfacePacket(nullCustodyPacket, {
  adapter: 'lerms-moving-timeline',
  sourceUrl: '/tests/fixtures/null-custody.json',
});
assert.equal(nullCustodyReport.ok, false);
assert.ok(nullCustodyReport.errors.some(error => error.includes('custody missing lermsOwns')), 'null producer custody must not be filled by host defaults');

const emptyCustodyArraysPacket = structuredClone(lermsPacket);
emptyCustodyArraysPacket.timeline.custody = { lermsOwns: [], kaminosOwns: [] };
const emptyCustodyArraysReport = tools.lintHostSurfacePacket(emptyCustodyArraysPacket, {
  adapter: 'lerms-moving-timeline',
  sourceUrl: '/tests/fixtures/empty-custody-arrays.json',
});
assert.equal(emptyCustodyArraysReport.ok, false);
assert.ok(emptyCustodyArraysReport.errors.some(error => error.includes('custody missing lermsOwns')), 'empty producer custody arrays must fail');

const missingRouteReport = tools.lintHostSurfacePacket(lermsPacket, {
  adapter: 'lerms-moving-timeline',
});
assert.equal(missingRouteReport.ok, false);
assert.ok(missingRouteReport.errors.some(error => error.includes('missing source route')), 'producer reports must fail without source URL or root/path route');
assert.equal(missingRouteReport.smokeUrl, null, 'reports without a source route must not emit an acceptance-looking smoke URL');
assert.equal(missingRouteReport.witnessCommand, null, 'reports without a source route must not emit an acceptance-looking witness command');

const partialRouteReport = tools.lintHostSurfacePacket(lermsPacket, {
  adapter: 'lerms-moving-timeline',
  root: 'scratch',
});
assert.equal(partialRouteReport.ok, false);
assert.ok(partialRouteReport.errors.some(error => error.includes('missing source route')), 'partial root/path source routes must fail');

const fingerPacket = {
  schema: 'big-papa-finger-juice.host-packet.v0',
  route: 'big-papa/finger-juice/host-packet',
  source: {
    producerDiaulos: 'big-papa-finger-juice-fucker',
    authority: 'host-packet-fixture',
    sourceTruthAuthority: 'big-papa-render-packet',
  },
  freshness: { status: 'fresh', budgetMs: 1000 },
  render: {
    payload: {
      schema: 'big-papa-finger-juice.render-payload.preview.v0',
      downgraded: true,
      particleSamples: [{ id: 'p0', position: [0, 0.25, 0], radius: 0.05 }],
    },
  },
  custody: {
    bigPapaOwns: ['finger juice packet truth'],
    kaminosOwns: ['host display'],
    downgrades: ['host_packet_preview_payload_not_native_render_buffer'],
    rejectedDebugSurfaces: [{ surface: 'direct_lerms_finger_juice_debug_route', acceptanceSurface: false }],
  },
};
const fingerReport = tools.lintHostSurfacePacket(fingerPacket, {
  adapter: 'finger-juice',
  root: 'scratch',
  path: 'big-papa-finger-juice-host-packet.json',
  serverOrigin: 'http://127.0.0.1:18142',
});
assert.equal(fingerReport.ok, true);
assert.equal(fingerReport.hostId, 'finger-juice');
assert.equal(fingerReport.hostRoute, 'kaminos/finger-juice-host');
assert.equal(fingerReport.packetSchema, 'big-papa-finger-juice.host-packet.v0');
assert.equal(fingerReport.packetRoute, 'big-papa/finger-juice/host-packet');
assert.equal(fingerReport.smokeUrl, 'http://127.0.0.1:18142/index.html?kaminos_finger_juice_host=1&finger_juice_host_root=scratch&finger_juice_host_path=big-papa-finger-juice-host-packet.json');
assert.match(fingerReport.witnessCommand, /--expected-host-id finger-juice/);
assert.match(fingerReport.witnessCommand, /--expected-packet-route big-papa\/finger-juice\/host-packet/);

const cliOutput = execFileSync('node', [
  toolsPath,
  '--adapter', 'lerms-moving-timeline',
  '--packet', lermsFixturePath,
  '--source-url', '/tests/fixtures/lerms-moving-timeline-host-smoke.json',
  '--server-origin', 'http://127.0.0.1:18142',
  '--debug-port', '9601',
  '--settle-ms', '3000',
  '--hook-wait-ms', '25000',
], { cwd: root, encoding: 'utf8' });
const cliReport = JSON.parse(cliOutput);
assert.equal(cliReport.ok, true);
assert.equal(cliReport.hostId, 'lerms-moving-timeline');
assert.equal(cliReport.smokeUrl, lermsReport.smokeUrl);
assert.equal(cliReport.witnessCommand, lermsReport.witnessCommand);
